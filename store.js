// Store-wide monthly target (Στόχος Καταστήματος): pieces sold for the WHOLE store (no per-person attribution), classified as Fix / GSM / EON TV.
// Everyone logged in can view it; only admins and members of the shared team group can log, undo or delete entries; target edit/copy stays admin-only.
const TEAM_GROUP = 'Λουκάς + Δημήτρης';
const CATS = [['fix', 'Fix'], ['gsm', 'GSM'], ['eon', 'EON TV']];
const CAT_KEYS = new Set(CATS.map(c => c[0]));
const DEFAULT_TARGET = 253;
const SEED_PERIODS = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
const isPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p || '');
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const nextPeriod = (p) => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

module.exports = function mount(app, { db, auth, admin, athensToday }) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS store_targets(period TEXT PRIMARY KEY, target INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS store_sales(id INTEGER PRIMARY KEY, period TEXT NOT NULL, sale_date TEXT NOT NULL, category TEXT NOT NULL, qty INTEGER NOT NULL,
    note TEXT DEFAULT '', user_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS idx_store_sales_p ON store_sales(period, sale_date);`);
  // Idempotent seed: OR IGNORE never overwrites an edited target; the flag stops deleted months from coming back.
  if (!db.prepare("SELECT 1 FROM settings WHERE k='store_seed_v1'").get()) {
    for (const p of SEED_PERIODS) db.prepare('INSERT OR IGNORE INTO store_targets(period,target) VALUES(?,?)').run(p, DEFAULT_TARGET);
    db.prepare("INSERT OR REPLACE INTO settings VALUES('store_seed_v1','1')").run();
  }
  const periodOf = (q) => isPeriod(q) ? q : athensToday().slice(0, 7);
  const targetOf = (p) => (db.prepare('SELECT target FROM store_targets WHERE period=?').get(p) || {}).target ?? null;
  const canLog = (u) => { if (u.is_admin) return true; const g = db.prepare('SELECT members FROM target_groups WHERE label=?').get(TEAM_GROUP); try { return !!g && JSON.parse(g.members).includes(u.id); } catch (e) { return false; } };
  const logger = (req, res, next) => canLog(req.user) ? next() : res.status(403).json({ error: 'Μόνο ο διαχειριστής ή η ομάδα Λουκάς + Δημήτρης μπορούν να καταχωρούν' });
  const dimOf = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

  app.get('/api/store', auth, (req, res) => {
    const period = periodOf(req.query.period), today = athensToday(), dim = dimOf(period), cur = today.slice(0, 7);
    const target = targetOf(period), rows = db.prepare('SELECT * FROM store_sales WHERE period=? ORDER BY sale_date, id').all(period);
    const total = rows.reduce((a, r) => a + r.qty, 0);
    const days_left = period < cur ? 0 : period > cur ? dim : dim - Number(today.slice(8, 10)) + 1; // today counts
    const remaining = target === null ? 0 : Math.max(0, target - total);
    const cats = CATS.map(([key, label]) => { const count = rows.filter(r => r.category === key).reduce((a, r) => a + r.qty, 0); return { key, label, count, share: total ? Math.round(count / total * 100) : 0 }; });
    const upto = period < cur ? dim : period > cur ? 0 : Number(today.slice(8, 10));
    const perDay = Array(dim + 1).fill(0); for (const r of rows) perDay[Number(r.sale_date.slice(8, 10))] += r.qty;
    let cum = 0; const daily = [];
    for (let d = 1; d <= dim; d++) { if (d <= upto) cum += perDay[d]; daily.push({ day: d, count: perDay[d], cum: d <= upto ? cum : null, pace: target === null ? null : Math.round(target * d / dim * 10) / 10 }); }
    const cname = Object.fromEntries(CATS), can = canLog(req.user);
    const recent = rows.slice().reverse().slice(0, 15).map(r => ({ id: r.id, sale_date: r.sale_date, category: r.category, label: cname[r.category] || r.category, qty: r.qty, note: r.note, can_delete: can }));
    const periods = [...new Set([...db.prepare('SELECT period FROM store_targets').all().map(r => r.period), cur])].sort();
    res.json({ period, periods, today, current_period: cur, target, total, pct: target ? Math.round(total / target * 100) : 0, remaining, surplus: target === null ? 0 : Math.max(0, total - target), reached: !!target && total >= target, days_in_month: dim, days_left,
      per_day: remaining > 0 && days_left > 0 ? Math.round(remaining / days_left * 10) / 10 : 0, categories: cats, daily, recent,
      is_admin: !!req.user.is_admin, can_log: can });
  });

  // Log pieces for the whole store. Logger only (admin or team group); any date, negative corrections allowed. A person param from the client is ignored.
  app.post('/api/store/sales', auth, logger, (req, res) => {
    const b = req.body || {}, qty = Number(b.qty);
    if (!CAT_KEYS.has(b.category)) return res.status(400).json({ error: 'Διάλεξε κατηγορία: Fix, GSM ή EON TV' });
    if (!Number.isInteger(qty) || qty === 0 || Math.abs(qty) > 1000) return res.status(400).json({ error: 'Δώσε έναν ακέραιο αριθμό κομματιών' });
    let date = athensToday();
    if (b.date) { if (!isDate(b.date)) return res.status(400).json({ error: 'Λάθος ημερομηνία' }); date = b.date; }
    // user_id column kept for audit only (who entered it); never taken from the client
    db.prepare('INSERT INTO store_sales(period,sale_date,category,qty,note,user_id,created_by) VALUES(?,?,?,?,?,?,?)').run(date.slice(0, 7), date, b.category, qty, String(b.note || '').trim().slice(0, 200), req.user.id, req.user.id);
    res.json({ ok: 1, period: date.slice(0, 7) });
  });
  // Undo the caller's own last entry
  app.post('/api/store/undo', auth, logger, (req, res) => {
    const last = db.prepare('SELECT * FROM store_sales WHERE created_by=? ORDER BY id DESC LIMIT 1').get(req.user.id);
    if (!last) return res.status(404).json({ error: 'Δεν υπάρχει δική σου καταχώρηση για αναίρεση' });
    db.prepare('DELETE FROM store_sales WHERE id=?').run(last.id); res.json({ ok: 1, undone: last.qty, category: last.category });
  });
  app.delete('/api/store/sales/:id', auth, logger, (req, res) => {
    const r = db.prepare('SELECT * FROM store_sales WHERE id=?').get(req.params.id); if (!r) return res.sendStatus(404);
    db.prepare('DELETE FROM store_sales WHERE id=?').run(r.id); res.json({ ok: 1 });
  });
  app.put('/api/store/target', auth, admin, (req, res) => {
    const t = Number(req.body && req.body.target), period = periodOf(req.body && req.body.period);
    if (!Number.isInteger(t) || t < 0 || t > 1e6) return res.status(400).json({ error: 'Ο στόχος πρέπει να είναι ακέραιος αριθμός' });
    db.prepare('INSERT INTO store_targets(period,target) VALUES(?,?) ON CONFLICT(period) DO UPDATE SET target=excluded.target').run(period, t); res.json({ ok: 1 });
  });
  app.post('/api/store/copy', auth, admin, (req, res) => { // copies the target only, never overwrites an existing month
    const from = periodOf(req.body && req.body.from), to = isPeriod(req.body && req.body.to) ? req.body.to : nextPeriod(from), t = targetOf(from);
    if (t === null) return res.status(400).json({ error: 'Δεν υπάρχει στόχος σε αυτή την περίοδο' });
    const r = db.prepare('INSERT OR IGNORE INTO store_targets(period,target) VALUES(?,?)').run(to, t); res.json({ ok: 1, copied: r.changes, to });
  });
};
module.exports._t = { nextPeriod };
