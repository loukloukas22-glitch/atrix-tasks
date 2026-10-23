// Δημιουργεί τους αρχικούς χρήστες και demo tasks. Χρήση: node seed.js  (--reset για καθαρή βάση)
const fs = require('fs'), path = require('path');
const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (process.argv.includes('--reset')) for (const f of ['atrix.db', 'atrix.db-wal', 'atrix.db-shm']) fs.rmSync(path.join(dir, f), { force: true });
const { db, hash, localStr } = require('./server');
if (process.argv.includes('--if-empty') && db.prepare('SELECT COUNT(*) c FROM users').get().c) { console.log('Users exist, skip seed.'); process.exit(0); }
// PINs από env SEED_PINS (JSON {"Όνομα":"PIN"}). Ο πρώτος χρήστης είναι admin.
let pins; try { pins = JSON.parse(process.env.SEED_PINS || ''); } catch { console.error('Λείπει/λάθος SEED_PINS (JSON {"Όνομα":"PIN",...}).'); process.exit(1); }
const users = Object.entries(pins).map(([n, p], i) => [n, String(p), i === 0 ? 1 : 0]);
const ins = db.prepare('INSERT OR IGNORE INTO users(name,pin_hash,is_admin) VALUES(?,?,?)');
for (const [n, p, a] of users) ins.run(n, hash(p), a);
const id = (n) => db.prepare('SELECT id FROM users WHERE name=?').get(n).id;
if (!process.argv.includes('--no-demo') && !db.prepare('SELECT COUNT(*) c FROM tasks').get().c) {
  const at = (days, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return localStr(d); };
  const T = db.prepare('INSERT INTO tasks(title,description,due,assignee_id,creator_id,status,done_note,done_at) VALUES(?,?,?,?,?,?,?,?)');
  const L = id(users[0][0]);
  T.run('Προσφορά leasing', 'Ετοιμάζουμε προσφορά.', at(0, 12), id('Δημήτρης'), L, 'open', null, null);
  T.run('Κλήση σε πελάτη', 'Επικοινωνία για ενδιαφέρον.', at(0, 15, 30), id('Θανάσης'), L, 'open', null, null);
  T.run('Ανανεώσεις συμβολαίων', '', at(1, 10), id('Δημήτρης'), L, 'open', null, null);
  T.run('Ενημέρωση αρχείου leads', '', at(1, 17), id('Χαρά'), L, 'open', null, null);
  T.run('Επίσκεψη πελάτη Πέραμα', '', at(3, 11), id('Γιώργος'), L, 'open', null, null);
  T.run('Παραγγελία υλικών καταστήματος', '', at(5, 9, 30), id('Γιάννης'), id('Δημήτρης'), 'open', null, null);
  T.run('Παρουσίαση νέων πακέτων', '', at(8, 13), id('Παναγιώτης'), L, 'open', null, null);
  T.run('Αποστολή logo στον τυπογράφο', 'Τελικό AtriX logo.', at(-1, 14), id('Δημήτρης'), L, 'done', 'Στάλθηκε, έρχονται δοκίμια την Τρίτη.', localStr(new Date()));
  db.prepare('INSERT INTO notifications(user_id,task_id,text) VALUES(?,?,?)').run(L, 8, '✔ Δημήτρης ολοκλήρωσε: «Αποστολή logo στον τυπογράφο» — Στάλθηκε, έρχονται δοκίμια την Τρίτη.');
}
console.log('OK. Χρήστες:', users.map(u => u[0]).join(', '));
process.exit(0);
