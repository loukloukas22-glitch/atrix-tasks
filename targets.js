// Sales targets (στόχοι) with progress logging. Monthly periods 'YYYY-MM'.
// Per-person targets (user_id) and shared group targets (group_label, members in target_groups).
const DEFAULT_METRICS = [['lines', 'Γραμμές'], ['vehicles', 'Οχήματα'], ['renewals', 'Ανανεώσεις'], ['leads', 'Leads']];
const TEAM = 'Λουκάς + Δημήτρης';
const SEED_PERIOD = '2026-10';
const SEED = [ // [user name | null for team, metric, target]
  [null, 'lines', 253], [null, 'vehicles', 5],
  ['Χαρά', 'leads', 44], ['Χαρά', 'lines', 12], ['Χαρά', 'vehicles', 2],
  ['Θανάσης', 'lines', 12], ['Θανάσης', 'vehicles', 2],
  ['Γιάννης', 'lines', 85], ['Γιάννης', 'renewals', 45],
  ['Γιώργος', 'lines', 85], ['Γιώργος', 'renewals', 45],
  ['Παναγιώτης', 'renewals', 250],
];
const isPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p || '');
const nextPeriod = (p) => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

module.exports = function mount(app, { db, auth, admin, athensToday }) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS target_metrics(key TEXT PRIMARY KEY, label TEXT NOT NULL, sort INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS target_groups(label TEXT PRIMARY KEY, members TEXT NOT NULL DEFAULT '[]');
  CREATE TABLE IF NOT EXISTS targets(id INTEGER PRIMARY KEY, user_id INTEGER, group_label TEXT, period TEXT NOT NULL, metric TEXT NOT NULL, target INTEGER NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_targets ON targets(IFNULL(user_id,0), IFNULL(group_label,''), period, metric);
  CREATE TABLE IF NOT EXISTS target_progress(id INTEGER PRIMARY KEY, user_id INTEGER, group_label TEXT, metric TEXT NOT NULL, period TEXT NOT NULL, delta INTEGER NOT NULL,
    note TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP, created_by INTEGER);
  CREATE INDEX IF NOT EXISTS idx_tprog ON target_progress(period, metric, user_id, group_label);`);
  DEFAULT_METRICS.forEach(([k, l], i) => db.prepare('INSERT OR IGNORE INTO target_metrics(key,label,sort) VALUES(?,?,?)').run(k, l, i));

  // Idempotent seed: INSERT OR IGNORE never overwrites edited targets; the flag stops deleted ones from coming back once everyone exists.
  function seed() {
    if (db.prepare("SELECT 1 FROM settings WHERE k='targets_seed_v1'").get()) return;
    const uid = (n) => (db.prepare('SELECT id FROM users WHERE name=? AND active=1').get(n) || {}).id;
    const members = ['Λουκάς', 'Δημήτρης'].map(uid).filter(Boolean);
    if (!members.length) return; // fresh DB, users not created yet: try again at next start
    db.prepare('INSERT OR IGNORE INTO target_groups(label,members) VALUES(?,?)').run(TEAM, JSON.stringify(members));
    let all = members.length === 2;
    for (const [name, metric, t] of SEED) {
      const id = name ? uid(name) : null;
      if (name && !id) { all = false; continue; }
      db.prepare('INSERT OR IGNORE INTO targets(user_id,group_label,period,metric,target) VALUES(?,?,?,?,?)').run(id, name ? null : TEAM, SEED_PERIOD, metric, t);
    }
    if (all) db.prepare("INSERT OR REPLACE INTO settings VALUES('targets_seed_v1','1')").run();
  }
  seed();

  const metrics = () => db.prepare('SELECT key,label FROM target_metrics ORDER BY sort,key').all();
  const groupMembers = (g) => { const r = db.prepare('SELECT members FROM target_groups WHERE label=?').get(g); return r ? JSON.parse(r.members) : []; };
  const inGroup = (u, g) => groupMembers(g).includes(u.id);
  const canLog = (u, uid, g) => u.is_admin || (g ? inGroup(u, g) : uid === u.id);
  const periodOf = (q) => isPeriod(q) ? q : athensToday().slice(0, 7);
  function pace(period, remaining) {
    const today = athensToday(), [y, m] = period.split('-').map(Number), dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let left; const cur = today.slice(0, 7);
    if (period < cur) left = 0; else if (period > cur) left = dim; else left = dim - Number(today.slice(8, 10)) + 1; // today counts
    return { days_in_month: dim, days_left: left, per_day: remaining > 0 && left > 0 ? Math.round(remaining / left * 10) / 10 : 0 };
  }
  const doneOf = (period, metric, uid, g) => (uid
    ? db.prepare('SELECT COALESCE(SUM(delta),0) s FROM target_progress WHERE period=? AND metric=? AND user_id=? AND group_label IS NULL').get(period, metric, uid)
    : db.prepare('SELECT COALESCE(SUM(delta),0) s FROM target_progress WHERE period=? AND metric=? AND group_label=?').get(period, metric, g)).s;
  const row = (period, t, label) => { const done = doneOf(period, t.metric, t.user_id, t.group_label), rem = Math.max(0, t.target - done);
    return { id: t.id, metric: t.metric, label: label[t.metric] || t.metric, target: t.target, done, pct: t.target ? Math.round(done / t.target * 100) : 0, remaining: rem, surplus: Math.max(0, done - t.target), reached: t.target > 0 && done >= t.target, ...pace(period, rem) }; };

  app.get('/api/targets', auth, (req, res) => {
    const period = periodOf(req.query.period), ms = metrics(), label = Object.fromEntries(ms.map(m => [m.key, m.label])), order = Object.fromEntries(ms.map((m, i) => [m.key, i]));
    const byOrder = (a, b) => (order[a.metric] ?? 99) - (order[b.metric] ?? 99);
    const users = db.prepare('SELECT id,name FROM users WHERE active=1 ORDER BY name').all();
    const people = []; 
    for (const u of users) {
      if (!req.user.is_admin && u.id !== req.user.id) continue;
      const ts = db.prepare('SELECT * FROM targets WHERE period=? AND user_id=?').all(period, u.id).sort(byOrder);
      if (ts.length) people.push({ user_id: u.id, name: u.name, me: u.id === req.user.id, targets: ts.map(t => row(period, t, label)) });
    }
    people.sort((a, b) => (b.me - a.me) || a.name.localeCompare(b.name, 'el'));
    const groups = db.prepare('SELECT * FROM target_groups').all().filter(g => req.user.is_admin || inGroup(req.user, g.label)).map(g => ({
      label: g.label, members: JSON.parse(g.members).map(id => (users.find(u => u.id === id) || {}).name).filter(Boolean),
      targets: db.prepare('SELECT * FROM targets WHERE period=? AND group_label=?').all(period, g.label).sort(byOrder).map(t => row(period, t, label)) }));
    const periods = [...new Set([...db.prepare('SELECT DISTINCT period FROM targets').all().map(r => r.period), athensToday().slice(0, 7)])].sort();
    res.json({ period, periods, metrics: ms, ...pace(period, 1), people, groups, is_admin: !!req.user.is_admin, users: req.user.is_admin ? users : undefined,
      group_labels: req.user.is_admin ? db.prepare('SELECT label FROM target_groups').all().map(g => g.label) : undefined });
  });

  // Log progress. Users: only for themselves (or a group they belong to), positive amounts only. Admin: anyone, negative corrections allowed.
  const subject = (b) => ({ uid: b.group_label ? null : (+b.user_id || null), g: b.group_label ? String(b.group_label) : null });
  app.post('/api/targets/progress', auth, (req, res) => {
    const b = req.body || {}, { uid, g } = subject(b), delta = Number(b.delta), period = periodOf(b.period);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) return res.status(400).json({ error: 'Δώσε έναν ακέραιο αριθμό' });
    if (delta < 0 && !req.user.is_admin) return res.status(403).json({ error: 'Μόνο ο διαχειριστής μπορεί να αφαιρέσει' });
    if ((!uid && !g) || !canLog(req.user, uid, g)) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα να καταχωρήσεις εδώ' });
    if (!db.prepare('SELECT 1 FROM target_metrics WHERE key=?').get(b.metric)) return res.status(400).json({ error: 'Άγνωστος δείκτης' });
    if (g && !db.prepare('SELECT 1 FROM target_groups WHERE label=?').get(g)) return res.status(400).json({ error: 'Άγνωστη ομάδα' });
    db.prepare('INSERT INTO target_progress(user_id,group_label,metric,period,delta,note,created_by) VALUES(?,?,?,?,?,?,?)').run(uid, g, b.metric, period, delta, String(b.note || '').trim().slice(0, 200), req.user.id);
    res.json({ ok: 1, done: doneOf(period, b.metric, uid, g) });
  });
  // Undo the last logged entry for a subject/metric/period (same permissions as logging)
  app.post('/api/targets/progress/undo', auth, (req, res) => {
    const b = req.body || {}, { uid, g } = subject(b), period = periodOf(b.period);
    if ((!uid && !g) || !canLog(req.user, uid, g)) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
    const last = uid ? db.prepare('SELECT * FROM target_progress WHERE period=? AND metric=? AND user_id=? AND group_label IS NULL ORDER BY id DESC LIMIT 1').get(period, b.metric, uid)
      : db.prepare('SELECT * FROM target_progress WHERE period=? AND metric=? AND group_label=? ORDER BY id DESC LIMIT 1').get(period, b.metric, g);
    if (!last) return res.status(404).json({ error: 'Δεν υπάρχει καταχώρηση για αναίρεση' });
    db.prepare('DELETE FROM target_progress WHERE id=?').run(last.id);
    res.json({ ok: 1, undone: last.delta, done: doneOf(period, b.metric, uid, g) });
  });
  app.get('/api/targets/log', auth, (req, res) => {
    const { uid, g } = subject(req.query), period = periodOf(req.query.period);
    if ((!uid && !g) || !canLog(req.user, uid, g)) return res.status(403).json({ error: 'Δεν έχεις δικαίωμα' });
    const w = (uid ? 'user_id=? AND group_label IS NULL' : 'group_label=?') + (req.query.metric ? ' AND metric=?' : '');
    res.json(db.prepare(`SELECT p.id,p.metric,p.delta,p.note,p.created_at,u.name by_name FROM target_progress p LEFT JOIN users u ON u.id=p.created_by WHERE p.period=? AND ${w} ORDER BY p.id DESC LIMIT 100`)
      .all(period, uid || g, ...(req.query.metric ? [req.query.metric] : [])));
  });

  // Admin: targets CRUD, metrics, copy to another period
  app.post('/api/targets', auth, admin, (req, res) => {
    const b = req.body || {}, { uid, g } = subject(b), t = Number(b.target), period = periodOf(b.period);
    if (!Number.isInteger(t) || t < 0 || t > 1e7) return res.status(400).json({ error: 'Ο στόχος πρέπει να είναι ακέραιος αριθμός' });
    if (!db.prepare('SELECT 1 FROM target_metrics WHERE key=?').get(b.metric)) return res.status(400).json({ error: 'Άγνωστος δείκτης' });
    if (uid ? !db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(uid) : !(g && db.prepare('SELECT 1 FROM target_groups WHERE label=?').get(g))) return res.status(400).json({ error: 'Διάλεξε πωλητή ή ομάδα' });
    db.prepare(`INSERT INTO targets(user_id,group_label,period,metric,target) VALUES(?,?,?,?,?) ON CONFLICT(IFNULL(user_id,0),IFNULL(group_label,''),period,metric) DO UPDATE SET target=excluded.target`).run(uid, g, period, b.metric, t);
    res.json({ ok: 1 });
  });
  app.put('/api/targets/:id', auth, admin, (req, res) => {
    const t = Number(req.body && req.body.target); if (!Number.isInteger(t) || t < 0 || t > 1e7) return res.status(400).json({ error: 'Ο στόχος πρέπει να είναι ακέραιος αριθμός' });
    const r = db.prepare('UPDATE targets SET target=? WHERE id=?').run(t, req.params.id); r.changes ? res.json({ ok: 1 }) : res.sendStatus(404);
  });
  app.delete('/api/targets/:id', auth, admin, (req, res) => { const r = db.prepare('DELETE FROM targets WHERE id=?').run(req.params.id); r.changes ? res.json({ ok: 1 }) : res.sendStatus(404); });
  app.post('/api/targets/copy', auth, admin, (req, res) => { // copies targets only (not progress); never overwrites existing ones
    const from = periodOf(req.body && req.body.from), to = isPeriod(req.body && req.body.to) ? req.body.to : nextPeriod(from);
    if (from === to) return res.status(400).json({ error: 'Η περίοδος προορισμού πρέπει να είναι διαφορετική' });
    const r = db.prepare('INSERT OR IGNORE INTO targets(user_id,group_label,period,metric,target) SELECT user_id,group_label,?,metric,target FROM targets WHERE period=?').run(to, from);
    res.json({ ok: 1, copied: r.changes, to });
  });
  app.post('/api/targets/metrics', auth, admin, (req, res) => {
    const key = String((req.body && req.body.key) || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30), label = String((req.body && req.body.label) || '').trim().slice(0, 40);
    if (!key || !label) return res.status(400).json({ error: 'Δώσε κωδικό (λατινικά) και όνομα' });
    db.prepare('INSERT INTO target_metrics(key,label,sort) VALUES(?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM target_metrics)) ON CONFLICT(key) DO UPDATE SET label=excluded.label').run(key, label);
    res.json({ ok: 1 });
  });
};
module.exports._t = { nextPeriod, isPeriod };
