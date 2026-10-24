const express = require('express');
const Database = require('better-sqlite3');
const webpush = require('web-push');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'atrix.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, is_admin INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '', due TEXT, assignee_id INTEGER, creator_id INTEGER,
  status TEXT DEFAULT 'open', done_note TEXT, done_at TEXT, reminder_min INTEGER DEFAULT 30, reminded INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY, user_id INTEGER, task_id INTEGER, text TEXT, read INTEGER DEFAULT 0, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS push_subs(endpoint TEXT PRIMARY KEY, user_id INTEGER, sub TEXT);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS status_log(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, status TEXT NOT NULL, note TEXT DEFAULT '', started_at TEXT NOT NULL, ended_at TEXT);
CREATE INDEX IF NOT EXISTS idx_status_log_user ON status_log(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_status_log_open ON status_log(user_id) WHERE ended_at IS NULL;
`);
// Safe migration helper for future columns (adds only if missing, never drops data)
const addColumn = (table, col, def) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); };
addColumn('status_log', 'note', "TEXT DEFAULT ''");
addColumn('status_log', 'ended_at', 'TEXT');

// ── Team status: the ONE place where the list of statuses is defined (order = display order).
// To add a status, append { key, label, color }. Keys are stored in status_log, so don't rename existing keys.
const STATUSES = [
  { key: 'ready',        label: 'Ready',               color: '#2e9e5b' }, // Διαθέσιμος
  { key: 'not_ready',    label: 'Not ready',           color: '#d93025' }, // Μη διαθέσιμος
  { key: 'break',        label: 'Break',               color: '#e8892b' }, // Διάλειμμα
  { key: 'meeting',      label: 'Meeting',             color: '#8a4fc2' }, // Σε meeting
  { key: 'call',         label: 'Call',                color: '#2f6fd6' }, // Σε κλήση
  { key: 'applications', label: 'Καταχώρηση', color: '#169c96' }, // teal
];
const DEFAULT_STATUS = 'not_ready';
const STATUS_KEYS = new Set(STATUSES.map(s => s.key));
const nowIso = () => new Date().toISOString(); // status times stored as UTC ISO strings
const openStatus = (uid) => db.prepare('SELECT * FROM status_log WHERE user_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get(uid);
const setStatus = db.transaction((uid, key, note = '') => {
  note = String(note || '').trim().slice(0, 120);
  const cur = openStatus(uid);
  if (cur && cur.status === key) { // same status: just update the note, keep the timer running
    if (cur.note !== note) db.prepare('UPDATE status_log SET note=? WHERE id=?').run(note, cur.id);
    return;
  }
  const t = nowIso();
  db.prepare('UPDATE status_log SET ended_at=? WHERE user_id=? AND ended_at IS NULL').run(t, uid);
  db.prepare('INSERT INTO status_log(user_id,status,note,started_at) VALUES(?,?,?,?)').run(uid, key, note, t);
});
const ensureStatus = (uid) => openStatus(uid) || (setStatus(uid, DEFAULT_STATUS), openStatus(uid));
// Every active user starts with an open status row (Not ready)
for (const u of db.prepare('SELECT id FROM users WHERE active=1').all()) ensureStatus(u.id);
// Athens-day boundaries (UTC ms) for 'YYYY-MM-DD', independent of the server TZ
const TZN = 'Europe/Athens';
function tzOffsetMs(ms) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZN, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; }
function athensMidnight(ymdStr) { const [y, m, d] = ymdStr.split('-').map(Number); const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess); t = guess - tzOffsetMs(t); return t; }
const athensToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZN }).format(new Date());

// VAPID keys: env or generated once & stored in DB
let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
if (!pub || !priv) {
  const row = db.prepare("SELECT v FROM settings WHERE k='vapid'").get();
  if (row) ({ pub, priv } = JSON.parse(row.v));
  else { const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey;
    db.prepare("INSERT INTO settings VALUES('vapid',?)").run(JSON.stringify({ pub, priv })); }
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@atrix.com.gr', pub, priv);

const hash = (pin) => { const salt = crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex'); };
const check = (pin, h) => { const [salt, x] = h.split(':');
  return crypto.timingSafeEqual(Buffer.from(x, 'hex'), crypto.scryptSync(String(pin), salt, 32)); };

async function notify(userId, taskId, text) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications(user_id,task_id,text) VALUES(?,?,?)').run(userId, taskId, text);
  for (const s of db.prepare('SELECT * FROM push_subs WHERE user_id=?').all(userId)) {
    try { await webpush.sendNotification(JSON.parse(s.sub), JSON.stringify({ title: 'AtriX Tasks', body: text, url: '/#task/' + taskId })); }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(s.endpoint); }
  }
}

const app = express();
const jsonSmall = express.json();
app.use((req, res, next) => req.path.startsWith('/api/invoices') ? next() : jsonSmall(req, res, next)); // invoices parse their own (large) bodies after auth
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.set('Cache-Control', 'no-cache'); } }));

const auth = (req, res, next) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const u = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1').get(t);
  if (!u) return res.status(401).json({ error: 'Μη εξουσιοδοτημένος' });
  req.user = u; next();
};
const admin = (req, res, next) => req.user.is_admin ? next() : res.status(403).json({ error: 'Μόνο για διαχειριστή' });
const pubUser = (u) => ({ id: u.id, name: u.name, is_admin: !!u.is_admin });
const TASK_SQL = `SELECT t.*, a.name assignee_name, c.name creator_name FROM tasks t LEFT JOIN users a ON a.id=t.assignee_id LEFT JOIN users c ON c.id=t.creator_id`;

app.get('/api/users/public', (req, res) => res.json(db.prepare('SELECT id,name FROM users WHERE active=1 ORDER BY name').all()));
app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(req.body.user_id);
  if (!u || !check(req.body.pin || '', u.pin_hash)) return res.status(401).json({ error: 'Λάθος PIN' });
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id) VALUES(?,?)').run(token, u.id);
  res.json({ token, user: pubUser(u) });
});
app.post('/api/logout', auth, (req, res) => { setStatus(req.user.id, DEFAULT_STATUS); db.prepare('DELETE FROM sessions WHERE token=?').run(req.headers.authorization.slice(7)); res.json({ ok: 1 }); });
app.get('/api/me', auth, (req, res) => res.json(pubUser(req.user)));
// Admin: who has logged in (sessions are removed on logout, so this lists currently open sessions)
app.get('/api/admin/logins', auth, admin, (req, res) => res.json(db.prepare(
  'SELECT u.id AS user_id, u.name, COUNT(s.token) AS sessions, MAX(s.created) AS last_login_utc FROM users u LEFT JOIN sessions s ON s.user_id=u.id WHERE u.active=1 GROUP BY u.id ORDER BY last_login_utc DESC').all()));
app.get('/api/users', auth, (req, res) => res.json(db.prepare('SELECT id,name,is_admin FROM users WHERE active=1 ORDER BY name').all()));
app.post('/api/users', auth, admin, (req, res) => {
  const { name, pin, is_admin } = req.body;
  if (!name || !/^\d{4,8}$/.test(pin || '')) return res.status(400).json({ error: 'Όνομα και PIN 4-8 ψηφία' });
  try { const r = db.prepare('INSERT INTO users(name,pin_hash,is_admin) VALUES(?,?,?)').run(name.trim(), hash(pin), is_admin ? 1 : 0); ensureStatus(r.lastInsertRowid); res.json({ id: r.lastInsertRowid }); }
  catch { res.status(400).json({ error: 'Υπάρχει ήδη χρήστης με αυτό το όνομα' }); }
});
app.post('/api/users/:id/pin', auth, (req, res) => {
  const id = +req.params.id; if (id !== req.user.id && !req.user.is_admin) return res.sendStatus(403);
  if (!/^\d{4,8}$/.test(req.body.pin || '')) return res.status(400).json({ error: 'PIN 4-8 ψηφία' });
  db.prepare('UPDATE users SET pin_hash=? WHERE id=?').run(hash(req.body.pin), id); res.json({ ok: 1 });
});
app.delete('/api/users/:id', auth, admin, (req, res) => {
  const r = db.prepare('UPDATE users SET active=0 WHERE id=? AND id<>?').run(req.params.id, req.user.id);
  if (r.changes) db.prepare('UPDATE status_log SET ended_at=? WHERE user_id=? AND ended_at IS NULL').run(nowIso(), +req.params.id);
  res.json({ ok: 1 }); });

// ── Team status API (no push notifications for status changes, by design)
const statusOut = (row) => ({ status: row.status, note: row.note || '', since: row.started_at });
app.get('/api/statuses', auth, (req, res) => res.json({ statuses: STATUSES, default: DEFAULT_STATUS }));
app.get('/api/status/me', auth, (req, res) => res.json({ ...statusOut(ensureStatus(req.user.id)), now: nowIso() }));
app.post('/api/status', auth, (req, res) => {
  const { status, note } = req.body || {};
  if (!STATUS_KEYS.has(status)) return res.status(400).json({ error: 'Άγνωστη κατάσταση' });
  setStatus(req.user.id, status, note); res.json({ ...statusOut(openStatus(req.user.id)), now: nowIso() });
});
app.get('/api/team', auth, (req, res) => {
  const order = Object.fromEntries(STATUSES.map((s, i) => [s.key, s.key === DEFAULT_STATUS ? 98 : i])); // Not ready last
  const team = db.prepare('SELECT id,name,is_admin FROM users WHERE active=1').all()
    .map(u => ({ id: u.id, name: u.name, is_admin: !!u.is_admin, ...statusOut(ensureStatus(u.id)) }))
    .sort((a, b) => (order[a.status] ?? 99) - (order[b.status] ?? 99) || a.name.localeCompare(b.name, 'el'));
  res.json({ now: nowIso(), statuses: STATUSES, team });
});
// Daily per-person summary (minutes per status within an Athens calendar day). Admin only.
app.get('/api/status/summary', auth, admin, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : athensToday();
  const from = athensMidnight(date), [y, m, d] = date.split('-').map(Number);
  const to = athensMidnight(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10));
  const now = Date.now(), end = Math.min(to, now);
  const rows = db.prepare('SELECT * FROM status_log WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)').all(new Date(to).toISOString(), new Date(from).toISOString());
  const users = db.prepare('SELECT id,name FROM users WHERE active=1 ORDER BY name').all();
  const by = Object.fromEntries(users.map(u => [u.id, { id: u.id, name: u.name, minutes: {}, first_active: null, last_active: null }]));
  for (const r of rows) { const p = by[r.user_id]; if (!p) continue;
    const s = Math.max(Date.parse(r.started_at), from), e = Math.min(r.ended_at ? Date.parse(r.ended_at) : now, end);
    if (e <= s) continue; p.minutes[r.status] = (p.minutes[r.status] || 0) + (e - s) / 60000;
    if (r.status !== DEFAULT_STATUS) { if (!p.first_active || s < Date.parse(p.first_active)) p.first_active = new Date(s).toISOString();
      if (!p.last_active || e > Date.parse(p.last_active)) p.last_active = new Date(e).toISOString(); } }
  const people = Object.values(by).map(p => { for (const k in p.minutes) p.minutes[k] = Math.round(p.minutes[k]);
    p.active_minutes = Object.entries(p.minutes).filter(([k]) => k !== DEFAULT_STATUS).reduce((a, [, v]) => a + v, 0); return p; });
  res.json({ date, from: new Date(from).toISOString(), to: new Date(to).toISOString(), now: new Date(now).toISOString(), statuses: STATUSES, people });
});

app.get('/api/tasks', auth, (req, res) => {
  const { from, to, mine } = req.query; const w = []; const p = [];
  if (from) { w.push('t.due>=?'); p.push(from); } if (to) { w.push('t.due<?'); p.push(to); }
  if (mine) { w.push('t.assignee_id=?'); p.push(req.user.id); }
  res.json(db.prepare(TASK_SQL + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY t.status DESC, t.due').all(...p));
});
app.get('/api/tasks/:id', auth, (req, res) => { const t = db.prepare(TASK_SQL + ' WHERE t.id=?').get(req.params.id); t ? res.json(t) : res.sendStatus(404); });
app.post('/api/tasks', auth, async (req, res) => {
  const { title, description, due, assignee_id, reminder_min } = req.body;
  if (!title) return res.status(400).json({ error: 'Ο τίτλος είναι υποχρεωτικός' });
  const r = db.prepare('INSERT INTO tasks(title,description,due,assignee_id,creator_id,reminder_min) VALUES(?,?,?,?,?,?)')
    .run(title, description || '', due || null, assignee_id || null, req.user.id, reminder_min ?? 30);
  const id = r.lastInsertRowid;
  if (assignee_id && +assignee_id !== req.user.id) await notify(+assignee_id, id, `${req.user.name} σου ανέθεσε: «${title}»`);
  res.json({ id });
});
app.put('/api/tasks/:id', auth, async (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id); if (!t) return res.sendStatus(404);
  if (t.creator_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Μόνο ο δημιουργός ή ο διαχειριστής' });
  const n = { ...t, ...req.body };
  db.prepare('UPDATE tasks SET title=?,description=?,due=?,assignee_id=?,reminder_min=?,reminded=? WHERE id=?')
    .run(n.title, n.description, n.due, n.assignee_id || null, n.reminder_min, n.due !== t.due ? 0 : t.reminded, t.id);
  if (n.assignee_id && +n.assignee_id !== t.assignee_id && +n.assignee_id !== req.user.id) await notify(+n.assignee_id, t.id, `${req.user.name} σου ανέθεσε: «${n.title}»`);
  res.json({ ok: 1 });
});
app.post('/api/tasks/:id/done', auth, async (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id); if (!t) return res.sendStatus(404);
  if (t.assignee_id !== req.user.id && t.creator_id !== req.user.id && !req.user.is_admin) return res.sendStatus(403);
  db.prepare("UPDATE tasks SET status='done', done_note=?, done_at=datetime('now') WHERE id=?").run(req.body.note || null, t.id);
  const text = `✔ ${req.user.name} ολοκλήρωσε: «${t.title}»` + (req.body.note ? ` — ${req.body.note}` : '');
  const targets = new Set([t.creator_id, ...db.prepare('SELECT id FROM users WHERE is_admin=1 AND active=1').all().map(x => x.id)]);
  targets.delete(req.user.id);
  for (const u of targets) await notify(u, t.id, text);
  res.json({ ok: 1 });
});
app.post('/api/tasks/:id/reopen', auth, (req, res) => { db.prepare("UPDATE tasks SET status='open',done_at=NULL WHERE id=?").run(req.params.id); res.json({ ok: 1 }); });
app.delete('/api/tasks/:id', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id); if (!t) return res.sendStatus(404);
  if (t.creator_id !== req.user.id && !req.user.is_admin) return res.sendStatus(403);
  db.prepare('DELETE FROM tasks WHERE id=?').run(t.id); res.json({ ok: 1 });
});

app.get('/api/notifications', auth, (req, res) => res.json(db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id)));
app.post('/api/notifications/read', auth, (req, res) => { db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id); res.json({ ok: 1 }); });
app.get('/api/push/key', (req, res) => res.json({ key: pub }));
app.post('/api/push/subscribe', auth, (req, res) => {
  db.prepare('INSERT OR REPLACE INTO push_subs(endpoint,user_id,sub) VALUES(?,?,?)').run(req.body.endpoint, req.user.id, JSON.stringify(req.body)); res.json({ ok: 1 });
});
app.post('/api/push/test', auth, async (req, res) => { await notify(req.user.id, null, 'Δοκιμαστική ειδοποίηση AtriX 🔔'); res.json({ ok: 1 }); });

// Reminders: every minute, tasks whose due is within reminder_min (due stored as local 'YYYY-MM-DDTHH:MM' in server TZ)
const pad = (n) => String(n).padStart(2, '0');
const localStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
async function reminders() {
  const now = new Date();
  for (const t of db.prepare("SELECT * FROM tasks WHERE status='open' AND reminded=0 AND due IS NOT NULL AND assignee_id IS NOT NULL").all()) {
    const due = new Date(t.due); if (isNaN(due)) continue;
    if (due - now <= t.reminder_min * 60000) {
      db.prepare('UPDATE tasks SET reminded=1 WHERE id=?').run(t.id);
      if (due > now) await notify(t.assignee_id, t.id, `⏰ Υπενθύμιση: «${t.title}» στις ${pad(due.getHours())}:${pad(due.getMinutes())}`);
    }
  }
}
setInterval(() => reminders().catch(console.error), 60000);
require('./invoices')(app, { db, DATA_DIR, auth, admin });
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
if (require.main === module) app.listen(PORT, () => console.log('AtriX Tasks στο http://localhost:' + PORT));
module.exports = { app, db, hash, localStr, STATUSES, setStatus, athensMidnight };
