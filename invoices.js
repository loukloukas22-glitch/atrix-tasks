// Purchase invoices (τιμολόγια αγορών) + input VAT tracking. Admin only.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-4.7'; // override with env XAI_MODEL
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const cents = (n) => Math.round(Number(n) * 100);

// Accepts numbers or strings like "1.234,56", "1234.56", "24%", "€ 12,30"
function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? r2(v) : null;
  let s = String(v).replace(/[^\d,.\-]/g, '');
  if (!s || s === '-') return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = s.replace(',', '.');
  else if (ld >= 0 && (s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? r2(n) : null;
}
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) { m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})/); if (m) m = [null, m[3].length === 2 ? '20' + m[3] : m[3], m[2], m[1]]; }
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const cleanAfm = (v) => String(v || '').replace(/^EL/i, '').replace(/\D/g, '').slice(0, 9);
const cleanText = (v, n = 200) => String(v ?? '').trim().slice(0, n);
function afmValid(a) { // Greek AFM checksum
  if (!/^\d{9}$/.test(a) || a === '000000000') return false;
  let s = 0; for (let i = 0; i < 8; i++) s += (+a[i]) * (2 ** (8 - i));
  return (s % 11) % 10 === +a[8];
}

// Normalise the payload from the client (or the LLM) into DB-ready values
function normalise(b) {
  const net = parseAmount(b.net_amount), vat = parseAmount(b.vat_amount);
  let total = parseAmount(b.total_amount);
  if (total === null && net !== null && vat !== null) total = r2(net + vat);
  let bd = Array.isArray(b.vat_breakdown) ? b.vat_breakdown : [];
  bd = bd.map(x => ({ rate: parseAmount(x.rate), net: parseAmount(x.net), vat: parseAmount(x.vat) }))
    .filter(x => x.rate !== null && (x.net !== null || x.vat !== null)).map(x => ({ rate: x.rate, net: x.net ?? 0, vat: x.vat ?? 0 }));
  let rate = parseAmount(b.vat_rate);
  if (!bd.length && net !== null && vat !== null) {
    if (rate === null && net !== 0) rate = [0, 6, 13, 24].reduce((a, c) => Math.abs(net * c / 100 - vat) < Math.abs(net * a / 100 - vat) ? c : a, 24);
    if (rate !== null) bd = [{ rate, net, vat }];
  }
  if (rate === null && bd.length) rate = bd.length === 1 ? bd[0].rate : null;
  return {
    invoice_date: parseDate(b.invoice_date), supplier_name: cleanText(b.supplier_name), supplier_afm: cleanAfm(b.supplier_afm),
    invoice_number: cleanText(b.invoice_number, 60), net_amount: net, vat_amount: vat, total_amount: total, vat_rate: rate,
    vat_breakdown: bd, notes: cleanText(b.notes, 500),
  };
}
function validate(v) {
  const e = [];
  if (!v.invoice_date) e.push('Η ημερομηνία είναι υποχρεωτική (μορφή ΕΕΕΕ-ΜΜ-ΗΗ)');
  if (!v.supplier_name && !v.supplier_afm) e.push('Συμπλήρωσε επωνυμία ή ΑΦΜ προμηθευτή');
  if (v.net_amount === null || v.vat_amount === null) e.push('Η καθαρή αξία και το ΦΠΑ είναι υποχρεωτικά');
  return e;
}
function warnings(v) {
  const w = [];
  if (v.net_amount !== null && v.vat_amount !== null && v.total_amount !== null && Math.abs(v.net_amount + v.vat_amount - v.total_amount) > 0.05)
    w.push('Η καθαρή αξία + ΦΠΑ δεν συμφωνεί με το σύνολο');
  if (v.supplier_afm && !afmValid(v.supplier_afm)) w.push('Το ΑΦΜ δεν φαίνεται έγκυρο');
  if (v.vat_breakdown.length) {
    const sv = r2(v.vat_breakdown.reduce((a, x) => a + x.vat, 0));
    if (v.vat_amount !== null && Math.abs(sv - v.vat_amount) > 0.05) w.push('Το άθροισμα ΦΠΑ ανά συντελεστή δεν συμφωνεί με το συνολικό ΦΠΑ');
  }
  return w;
}

const PROMPT = `Διάβασε αυτό το ελληνικό τιμολόγιο ΑΓΟΡΑΣ (ο προμηθευτής είναι ο εκδότης του παραστατικού, όχι ο παραλήπτης/πελάτης) και επέστρεψε ΜΟΝΟ ένα JSON αντικείμενο, χωρίς άλλο κείμενο, με τα πεδία:
{"invoice_date":"ΕΕΕΕ-ΜΜ-ΗΗ","supplier_name":"επωνυμία εκδότη","supplier_afm":"9ψήφιο ΑΦΜ εκδότη","invoice_number":"σειρά και αριθμός παραστατικού","net_amount":αριθμός συνολική καθαρή αξία,"vat_amount":αριθμός συνολικό ΦΠΑ,"total_amount":αριθμός πληρωτέο σύνολο,"vat_rate":αριθμός κύριος συντελεστής ΦΠΑ π.χ. 24,"vat_breakdown":[{"rate":24,"net":0,"vat":0}]}
Οι αριθμοί να είναι δεκαδικοί με τελεία (π.χ. 1234.56), χωρίς σύμβολο νομίσματος. Στο vat_breakdown βάλε μία γραμμή για κάθε συντελεστή ΦΠΑ που εμφανίζεται. Αν ένα πεδίο δεν διαβάζεται, βάλε null. Μην μαντεύεις.`;

function parseJsonLoose(text) {
  const t = String(text || '').replace(/```json|```/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no json');
  return JSON.parse(t.slice(a, b + 1));
}

// Replaceable for tests: module.exports.llm.call = async (dataUrl) => text
const llm = {
  async call(dataUrl) {
    const key = process.env.XAI_API_KEY;
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 120000);
    try {
      const r = await fetch(XAI_URL, {
        method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: process.env.XAI_MODEL || DEFAULT_MODEL, temperature: 0, messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }, { type: 'text', text: PROMPT }] }] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const err = new Error('xai ' + r.status); err.status = r.status; throw err; }
      const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      return Array.isArray(c) ? c.map(x => x.text || '').join('') : c;
    } finally { clearTimeout(to); }
  },
};

function periodSql(q) {
  const w = [], p = [];
  const f = parseDate(q.from), t = parseDate(q.to);
  if (f) { w.push('invoice_date>=?'); p.push(f); }
  if (t) { w.push('invoice_date<=?'); p.push(t); }
  return { where: w.length ? ' WHERE ' + w.join(' AND ') : '', params: p };
}
const rowOut = (r) => ({ ...r, vat_breakdown: JSON.parse(r.vat_breakdown || '[]'), has_file: !!r.file_path });
function totals(rows) {
  let net = 0, vat = 0, total = 0; const by = {};
  for (const r of rows) {
    net += cents(r.net_amount); vat += cents(r.vat_amount); total += cents(r.total_amount ?? (r.net_amount + r.vat_amount));
    const bd = r.vat_breakdown.length ? r.vat_breakdown : [{ rate: r.vat_rate ?? 0, net: r.net_amount, vat: r.vat_amount }];
    for (const x of bd) { const k = String(x.rate); by[k] ??= { rate: x.rate, net: 0, vat: 0, count: 0 }; by[k].net += cents(x.net); by[k].vat += cents(x.vat); by[k].count++; }
  }
  return { count: rows.length, net: net / 100, vat: vat / 100, total: total / 100,
    by_rate: Object.values(by).sort((a, b) => a.rate - b.rate).map(x => ({ rate: x.rate, net: x.net / 100, vat: x.vat / 100, count: x.count })) };
}
const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const grNum = (n) => n === null || n === undefined ? '' : Number(n).toFixed(2).replace('.', ',');

module.exports = function mount(app, { db, DATA_DIR, auth, admin }) {
  const FILE_DIR = path.join(DATA_DIR, 'invoices');
  fs.mkdirSync(FILE_DIR, { recursive: true });
  db.exec(`CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY, invoice_date TEXT NOT NULL, supplier_name TEXT DEFAULT '', supplier_afm TEXT DEFAULT '',
    invoice_number TEXT DEFAULT '', net_amount REAL NOT NULL, vat_amount REAL NOT NULL, total_amount REAL, vat_rate REAL, vat_breakdown TEXT DEFAULT '[]',
    notes TEXT DEFAULT '', file_path TEXT, file_type TEXT, created_by INTEGER, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_dup ON invoices(supplier_afm, invoice_number);`);
  const big = require('express').json({ limit: '15mb' });
  const dupOf = (v, exceptId) => (v.supplier_afm && v.invoice_number)
    ? db.prepare('SELECT id,invoice_date,supplier_name,invoice_number,total_amount FROM invoices WHERE supplier_afm=? AND lower(invoice_number)=lower(?) AND id<>?').get(v.supplier_afm, v.invoice_number, exceptId || 0) : undefined;
  const parseDataUrl = (s) => {
    const m = /^data:(image\/jpeg|image\/png|application\/pdf);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(s || ''));
    if (!m) return null; const buf = Buffer.from(m[2], 'base64'); return buf.length && buf.length <= MAX_FILE_BYTES ? { mime: m[1], buf } : null;
  };
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
  const rm = (p) => { if (p) fs.rm(path.join(FILE_DIR, path.basename(p)), { force: true }, () => {}); };

  // Extract fields from a photo with the vision LLM. Does not save anything.
  app.post('/api/invoices/extract', auth, admin, big, async (req, res) => {
    const f = parseDataUrl(req.body && req.body.file);
    if (!f) return res.status(400).json({ error: 'Μη έγκυρο ή πολύ μεγάλο αρχείο (έως 10MB, JPG/PNG/PDF)' });
    if (f.mime === 'application/pdf') return res.json({ ok: false, manual: true, error: 'Τα PDF δεν διαβάζονται αυτόματα. Συμπλήρωσε τα στοιχεία χειροκίνητα.' });
    if (!process.env.XAI_API_KEY) return res.json({ ok: false, manual: true, error: 'Δεν έχει ρυθμιστεί η αυτόματη ανάγνωση (λείπει το XAI_API_KEY). Συμπλήρωσε τα στοιχεία χειροκίνητα.' });
    try {
      const raw = parseJsonLoose(await llm.call(`data:${f.mime};base64,${f.buf.toString('base64')}`));
      const v = normalise(raw);
      res.json({ ok: true, data: v, warnings: warnings(v), duplicate: dupOf(v) || null });
    } catch (e) {
      console.error('invoice extract failed:', e.status ? 'HTTP ' + e.status : e.name + ': ' + e.message);
      res.json({ ok: false, manual: true, error: e.status === 401 || e.status === 403 ? 'Το κλειδί XAI_API_KEY δεν είναι έγκυρο. Συμπλήρωσε τα στοιχεία χειροκίνητα.'
        : 'Η αυτόματη ανάγνωση απέτυχε. Δοκίμασε ξανά ή συμπλήρωσε τα στοιχεία χειροκίνητα.' });
    }
  });

  app.get('/api/invoices', auth, admin, (req, res) => {
    const { where, params } = periodSql(req.query);
    const rows = db.prepare(`SELECT * FROM invoices${where} ORDER BY invoice_date DESC, id DESC`).all(...params).map(rowOut);
    res.json({ invoices: rows, totals: totals(rows), ai_enabled: !!process.env.XAI_API_KEY });
  });
  app.get('/api/invoices/export.csv', auth, admin, (req, res) => {
    const { where, params } = periodSql(req.query);
    const rows = db.prepare(`SELECT * FROM invoices${where} ORDER BY invoice_date, id`).all(...params).map(rowOut);
    const head = ['Ημερομηνία', 'Προμηθευτής', 'ΑΦΜ', 'Αρ. τιμολογίου', 'Καθαρή αξία', 'ΦΠΑ', 'Σύνολο', 'Συντελεστές ΦΠΑ', 'Σημειώσεις'];
    const lines = [head.map(csvCell).join(';')];
    for (const r of rows) lines.push([r.invoice_date, r.supplier_name, r.supplier_afm, r.invoice_number, grNum(r.net_amount), grNum(r.vat_amount), grNum(r.total_amount),
      (r.vat_breakdown.length ? r.vat_breakdown.map(x => `${x.rate}%: ${grNum(x.net)} / ${grNum(x.vat)}`).join(' | ') : (r.vat_rate ?? '') + '%'), r.notes].map(csvCell).join(';'));
    const t = totals(rows);
    lines.push(['ΣΥΝΟΛΟ', '', '', '', grNum(t.net), grNum(t.vat), grNum(t.total), '', ''].map(csvCell).join(';'));
    for (const x of t.by_rate) lines.push([`ΦΠΑ ${x.rate}%`, '', '', '', grNum(x.net), grNum(x.vat), '', '', ''].map(csvCell).join(';'));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="timologia-agoron.csv"' });
    res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
  });
  app.get('/api/invoices/:id', auth, admin, (req, res) => {
    const r = db.prepare('SELECT * FROM invoices WHERE id=?').get(req.params.id); r ? res.json(rowOut(r)) : res.sendStatus(404);
  });
  app.get('/api/invoices/:id/file', auth, admin, (req, res) => {
    const r = db.prepare('SELECT file_path,file_type FROM invoices WHERE id=?').get(req.params.id);
    if (!r || !r.file_path) return res.sendStatus(404);
    const p = path.join(FILE_DIR, path.basename(r.file_path)); if (!fs.existsSync(p)) return res.sendStatus(404);
    res.type(r.file_type || 'application/octet-stream').sendFile(p);
  });

  const COLS = 'invoice_date,supplier_name,supplier_afm,invoice_number,net_amount,vat_amount,total_amount,vat_rate,vat_breakdown,notes';
  const vals = (v) => [v.invoice_date, v.supplier_name, v.supplier_afm, v.invoice_number, v.net_amount, v.vat_amount, v.total_amount, v.vat_rate, JSON.stringify(v.vat_breakdown), v.notes];
  app.post('/api/invoices', auth, admin, big, (req, res) => {
    const v = normalise(req.body || {}), errs = validate(v);
    if (errs.length) return res.status(400).json({ error: errs.join('. ') });
    const d = dupOf(v);
    if (d && !req.body.force) return res.status(409).json({ error: 'Υπάρχει ήδη τιμολόγιο με το ίδιο ΑΦΜ και αριθμό', duplicate: d });
    let fp = null, ft = null;
    if (req.body.file) {
      const f = parseDataUrl(req.body.file);
      if (!f) return res.status(400).json({ error: 'Μη έγκυρο ή πολύ μεγάλο αρχείο (έως 10MB, JPG/PNG/PDF)' });
      fp = crypto.randomBytes(12).toString('hex') + '.' + ext[f.mime]; ft = f.mime; fs.writeFileSync(path.join(FILE_DIR, fp), f.buf);
    }
    const r = db.prepare(`INSERT INTO invoices(${COLS},file_path,file_type,created_by) VALUES(${COLS.split(',').map(() => '?').join(',')},?,?,?)`).run(...vals(v), fp, ft, req.user.id);
    res.json({ id: r.lastInsertRowid, warnings: warnings(v) });
  });
  app.put('/api/invoices/:id', auth, admin, big, (req, res) => {
    const cur = db.prepare('SELECT id FROM invoices WHERE id=?').get(req.params.id); if (!cur) return res.sendStatus(404);
    const v = normalise(req.body || {}), errs = validate(v);
    if (errs.length) return res.status(400).json({ error: errs.join('. ') });
    const d = dupOf(v, cur.id);
    if (d && !req.body.force) return res.status(409).json({ error: 'Υπάρχει ήδη τιμολόγιο με το ίδιο ΑΦΜ και αριθμό', duplicate: d });
    db.prepare(`UPDATE invoices SET ${COLS.split(',').map(c => c + '=?').join(',')} WHERE id=?`).run(...vals(v), cur.id);
    res.json({ ok: 1, warnings: warnings(v) });
  });
  app.delete('/api/invoices/:id', auth, admin, (req, res) => {
    const r = db.prepare('SELECT file_path FROM invoices WHERE id=?').get(req.params.id); if (!r) return res.sendStatus(404);
    db.prepare('DELETE FROM invoices WHERE id=?').run(req.params.id); rm(r.file_path); res.json({ ok: 1 });
  });
};
module.exports.llm = llm;
module.exports._t = { parseAmount, parseDate, afmValid, normalise };
