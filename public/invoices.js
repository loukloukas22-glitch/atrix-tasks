// Τιμολόγια αγορών + ΦΠΑ εισροών (admin). Loaded after app.js; adds views.invoices / views.invoice.
(function () {
  const fm = (n) => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (s) => { s = String(s ?? '').trim(); if (!s) return null; const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); else if (lc >= 0) s = s.replace(',', '.');
    const n = parseFloat(s.replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null; };
  const inp = (n) => n === null || n === undefined ? '' : String(n).replace('.', ',');
  const afmOk = (a) => { if (!/^\d{9}$/.test(a) || a === '000000000') return false; let s = 0; for (let i = 0; i < 8; i++) s += (+a[i]) * (2 ** (8 - i)); return (s % 11) % 10 === +a[8]; };
  const MONTHS = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];
  const now = new Date();
  const per = { year: now.getFullYear(), p: 'y' }; // p: y=all year, q1-q4, m1-m12
  let pending = null; // { file: dataURL, data, warnings, notice }

  function range() {
    const y = per.year, z = (n) => String(n).padStart(2, '0'), last = (m) => new Date(y, m, 0).getDate();
    if (per.p === 'y') return [`${y}-01-01`, `${y}-12-31`];
    if (per.p[0] === 'q') { const q = +per.p.slice(1), m1 = (q - 1) * 3 + 1, m2 = q * 3; return [`${y}-${z(m1)}-01`, `${y}-${z(m2)}-${last(m2)}`]; }
    const m = +per.p.slice(1); return [`${y}-${z(m)}-01`, `${y}-${z(m)}-${last(m)}`];
  }
  const qs = () => { const [f, t] = range(); return `from=${f}&to=${t}`; };
  async function authBlob(path) {
    const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Σφάλμα λήψης'); return r.blob();
  }
  async function download(path, name) {
    const b = await authBlob(path), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // Read a File: images are resized to max 1600px JPEG, PDFs are passed through
  function readFile(f) {
    return new Promise((ok, bad) => {
      if (f.type === 'application/pdf') { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error('Αδυναμία ανάγνωσης αρχείου')); r.readAsDataURL(f); return; }
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85)); };
      img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('Η εικόνα δεν μπορεί να ανοιχτεί (δοκίμασε JPG ή PNG)')); };
      img.src = url;
    });
  }
  async function picked(inputEl) {
    const f = inputEl.files && inputEl.files[0]; inputEl.value = ''; if (!f) return;
    const box = $('#invbusy'); box.hidden = false; box.textContent = 'Ανάγνωση τιμολογίου, περίμενε λίγα δευτερόλεπτα...';
    try {
      const file = await readFile(f), r = await api('/invoices/extract', { body: { file } });
      pending = r.ok ? { file, data: r.data, warnings: r.warnings || [], duplicate: r.duplicate, notice: r.duplicate ? 'Προσοχή: υπάρχει ήδη τιμολόγιο με το ίδιο ΑΦΜ και αριθμό.' : 'Έλεγξε τα στοιχεία που διαβάστηκαν πριν την αποθήκευση.' }
        : { file, data: {}, warnings: [], notice: r.error };
      location.hash = '#invoice/new';
    } catch (e) { box.hidden = true; if (e.message !== 'auth') toast(e.message); }
  }

  views.invoices = async function () {
    if (!me.is_admin) { V.innerHTML = '<div class="empty">Μόνο για διαχειριστή</div>'; return; }
    const r = await api('/invoices?' + qs()), t = r.totals;
    const yrs = []; for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) yrs.push(y);
    const popts = [['y', 'Όλο το έτος'], ['q1', 'Α τρίμηνο'], ['q2', 'Β τρίμηνο'], ['q3', 'Γ τρίμηνο'], ['q4', 'Δ τρίμηνο'], ...MONTHS.map((m, i) => ['m' + (i + 1), m])];
    V.innerHTML = `<h1>Τιμολόγια αγορών</h1>
    <div class="row"><select id="iy">${yrs.map(y => `<option ${y === per.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
    <select id="ip">${popts.map(([k, l]) => `<option value="${k}" ${k === per.p ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="card invtot"><div class="sumh"><b>ΦΠΑ εισροών</b><small>${t.count} τιμολόγια</small></div>
    <div class="invbig">${fm(t.vat)}</div>
    <div class="legend"><span>Καθαρή αξία <b>${fm(t.net)}</b></span><span>Σύνολο <b>${fm(t.total)}</b></span></div>
    ${t.by_rate.length ? `<table class="invtab"><tr><th>Συντελεστής</th><th>Καθαρή</th><th>ΦΠΑ</th></tr>${t.by_rate.map(x => `<tr><td>${x.rate}%</td><td>${fm(x.net)}</td><td>${fm(x.vat)}</td></tr>`).join('')}</table>` : ''}</div>
    <div id="invbusy" class="note" hidden></div>
    <div class="row"><label class="btn gold invfile">Φωτογραφία<input type="file" id="icam" accept="image/*" capture="environment" hidden></label>
    <label class="btn ghost invfile">Αρχείο<input type="file" id="ifile" accept="image/*,application/pdf" hidden></label></div>
    <div class="row"><button class="btn ghost" id="iman">Χειροκίνητη καταχώρηση</button><button class="btn ghost" id="icsv">Εξαγωγή CSV</button></div>
    ${r.ai_enabled ? '' : '<p class="upd">Η αυτόματη ανάγνωση δεν είναι ενεργή (λείπει το XAI_API_KEY). Μπορείς να καταχωρείς χειροκίνητα.</p>'}
    <h2>Τιμολόγια της περιόδου</h2>
    ${r.invoices.length ? r.invoices.map(i => `<a class="card" href="#invoice/${i.id}"><div class="sumh"><div class="t">${esc(i.supplier_name || i.supplier_afm)}</div><b>${fm(i.total_amount ?? i.net_amount + i.vat_amount)}</b></div>
      <div class="meta"><span>${esc(i.invoice_date)}</span><span>Αρ. ${esc(i.invoice_number || '-')}</span><span>ΦΠΑ ${fm(i.vat_amount)}</span>${i.has_file ? '<span>+ αρχείο</span>' : ''}</div></a>`).join('') : '<div class="empty">Δεν υπάρχουν τιμολόγια σε αυτή την περίοδο</div>'}`;
    $('#iy').onchange = (e) => { per.year = +e.target.value; route(); };
    $('#ip').onchange = (e) => { per.p = e.target.value; route(); };
    $('#icam').onchange = (e) => picked(e.target); $('#ifile').onchange = (e) => picked(e.target);
    $('#iman').onclick = () => { pending = null; location.hash = '#invoice/new'; };
    $('#icsv').onclick = () => download('/invoices/export.csv?' + qs(), 'timologia-agoron.csv').catch(e => toast(e.message));
  };

  views.invoice = async function (id) {
    if (!me.is_admin) { V.innerHTML = '<div class="empty">Μόνο για διαχειριστή</div>'; return; }
    const isNew = !id || id === 'new'; let d, file = null, notice = '', warn = [], hasFile = false;
    if (isNew) { const p = pending; pending = null; d = (p && p.data) || {}; file = p && p.file; notice = (p && p.notice) || ''; warn = (p && p.warnings) || []; }
    else { d = await api('/invoices/' + id); hasFile = d.has_file; }
    let bd = (d.vat_breakdown || []).map(x => ({ ...x }));
    if (isNew && !d.invoice_date) d.invoice_date = ymd(new Date());
    const rowsHtml = () => bd.map((x, i) => `<div class="row bdr" data-i="${i}"><input class="br" inputmode="decimal" placeholder="%" value="${esc(inp(x.rate))}"><input class="bn" inputmode="decimal" placeholder="Καθαρή" value="${esc(inp(x.net))}"><input class="bv" inputmode="decimal" placeholder="ΦΠΑ" value="${esc(inp(x.vat))}"><button type="button" class="iconbtn bdx" data-i="${i}">x</button></div>`).join('');
    V.innerHTML = `<a href="#invoices" style="color:var(--b);text-decoration:none;font-weight:700">Πίσω</a>
    <h1 style="margin-top:10px">${isNew ? 'Νέο τιμολόγιο αγοράς' : 'Τιμολόγιο αγοράς'}</h1>
    ${notice ? `<div class="note">${esc(notice)}</div>` : ''}
    ${file && file.startsWith('data:image') ? `<img class="invimg" src="${file}" alt="">` : ''}
    ${file && file.startsWith('data:application/pdf') ? '<div class="note">Επισυνάπτεται αρχείο PDF</div>' : ''}
    ${hasFile ? '<button class="btn ghost" id="iview">Προβολή αρχείου</button>' : ''}
    <label>Ημερομηνία</label><input type="date" id="fd" value="${esc(d.invoice_date || '')}">
    <label>Προμηθευτής (επωνυμία)</label><input id="fn" value="${esc(d.supplier_name || '')}">
    <div class="row"><div><label>ΑΦΜ προμηθευτή</label><input id="fa" inputmode="numeric" maxlength="11" value="${esc(d.supplier_afm || '')}"></div>
    <div><label>Αρ. τιμολογίου</label><input id="fi" value="${esc(d.invoice_number || '')}"></div></div>
    <div class="row"><div><label>Καθαρή αξία</label><input id="fnet" inputmode="decimal" value="${esc(inp(d.net_amount))}"></div>
    <div><label>ΦΠΑ</label><input id="fvat" inputmode="decimal" value="${esc(inp(d.vat_amount))}"></div></div>
    <div class="row"><div><label>Σύνολο</label><input id="ftot" inputmode="decimal" value="${esc(inp(d.total_amount))}"></div>
    <div><label>Συντελεστής ΦΠΑ %</label><input id="frate" inputmode="decimal" value="${esc(inp(d.vat_rate))}"></div></div>
    <label>Ανάλυση ΦΠΑ ανά συντελεστή (προαιρετικό, αν υπάρχουν πολλοί)</label><div id="bdrows">${rowsHtml()}</div>
    <div class="row"><button type="button" class="btn ghost" id="bdadd">+ Γραμμή ΦΠΑ</button><button type="button" class="btn ghost" id="bdsum">Υπολογισμός από γραμμές</button></div>
    <label>Σημειώσεις</label><input id="fno" value="${esc(d.notes || '')}">
    <div id="invwarn" class="note" ${warn.length ? '' : 'hidden'}>${warn.map(esc).join('<br>')}</div>
    <button class="btn gold" id="isave">Αποθήκευση</button>
    ${isNew ? '' : '<button class="btn danger" id="idel">Διαγραφή</button>'}`;
    const readBd = () => { bd = [...V.querySelectorAll('.bdr')].map(r => ({ rate: num(r.querySelector('.br').value), net: num(r.querySelector('.bn').value), vat: num(r.querySelector('.bv').value) })); };
    const bindBd = () => { $('#bdrows').innerHTML = rowsHtml(); V.querySelectorAll('.bdx').forEach(b => b.onclick = () => { readBd(); bd.splice(+b.dataset.i, 1); bindBd(); check(); }); V.querySelectorAll('.bdr input').forEach(i => i.oninput = check); };
    const payload = () => { readBd(); return { invoice_date: $('#fd').value, supplier_name: $('#fn').value, supplier_afm: $('#fa').value, invoice_number: $('#fi').value,
      net_amount: $('#fnet').value, vat_amount: $('#fvat').value, total_amount: $('#ftot').value, vat_rate: $('#frate').value, notes: $('#fno').value,
      vat_breakdown: bd.filter(x => x.rate !== null && (x.net !== null || x.vat !== null)), ...(file ? { file } : {}) }; };
    function check() {
      const net = num($('#fnet').value), vat = num($('#fvat').value), tot = num($('#ftot').value), w = [];
      if (net !== null && vat !== null && tot !== null && Math.abs(net + vat - tot) > 0.05) w.push('Προσοχή: καθαρή αξία + ΦΠΑ = ' + fm(net + vat) + ', ενώ το σύνολο είναι ' + fm(tot));
      const a = $('#fa').value.replace(/^EL/i, '').trim(); if (a && !afmOk(a)) w.push('Το ΑΦΜ δεν φαίνεται έγκυρο - έλεγξέ το');
      readBd(); const bs = bd.reduce((s, x) => s + (x.vat || 0), 0); if (bd.length && vat !== null && Math.abs(bs - vat) > 0.05) w.push('Το άθροισμα ΦΠΑ των γραμμών (' + fm(bs) + ') δεν συμφωνεί με το ΦΠΑ');
      const box = $('#invwarn'); box.hidden = !w.length; box.innerHTML = w.map(esc).join('<br>');
    }
    ['#fnet', '#fvat', '#ftot', '#fa'].forEach(s => $(s).oninput = check);
    $('#fnet').onchange = $('#fvat').onchange = () => { const n = num($('#fnet').value), v = num($('#fvat').value); if (n !== null && v !== null && !$('#ftot').value.trim()) $('#ftot').value = inp(Math.round((n + v) * 100) / 100); check(); };
    bindBd();
    $('#bdadd').onclick = () => { readBd(); bd.push({ rate: null, net: null, vat: null }); bindBd(); };
    $('#bdsum').onclick = () => { readBd(); const n = bd.reduce((s, x) => s + (x.net || 0), 0), v = bd.reduce((s, x) => s + (x.vat || 0), 0);
      $('#fnet').value = inp(Math.round(n * 100) / 100); $('#fvat').value = inp(Math.round(v * 100) / 100); $('#ftot').value = inp(Math.round((n + v) * 100) / 100); check(); };
    check(); if (warn.length) $('#invwarn').hidden = false;
    $('#iview') && ($('#iview').onclick = async () => { try { const b = await authBlob(`/invoices/${id}/file`); window.open(URL.createObjectURL(b), '_blank'); } catch (e) { toast(e.message); } });
    $('#isave').onclick = async () => {
      const p = payload(); const go = async (force) => api(isNew ? '/invoices' : '/invoices/' + id, { method: isNew ? 'POST' : 'PUT', body: { ...p, force } });
      try { await go(false); } catch (e) {
        if (/ίδιο ΑΦΜ/.test(e.message)) { if (!confirm('Υπάρχει ήδη τιμολόγιο με το ίδιο ΑΦΜ και αριθμό. Να αποθηκευτεί παρ\' όλα αυτά;')) return; try { await go(true); } catch (e2) { return toast(e2.message); } }
        else return toast(e.message);
      }
      toast('Αποθηκεύτηκε'); location.hash = '#invoices';
    };
    $('#idel') && ($('#idel').onclick = async () => { if (!confirm('Διαγραφή τιμολογίου;')) return; try { await api('/invoices/' + id, { method: 'DELETE' }); toast('Διαγράφηκε'); location.hash = '#invoices'; } catch (e) { toast(e.message); } });
  };
})();
