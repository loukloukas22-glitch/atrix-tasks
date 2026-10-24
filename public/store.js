// Στόχος Καταστήματος: κοινός μηνιαίος στόχος κομματιών (Fix / GSM / EON TV) με γραφήματα. Loaded after app.js; adds views.store.
(function () {
  let period = null, selCat = null;
  const COL = { fix: '#2f6fd6', gsm: '#169c96', eon: '#8a4fc2' };
  const f1 = (n) => Number(n).toLocaleString('el-GR', { maximumFractionDigits: 1 });
  const plabel = (p) => { const [y, m] = p.split('-').map(Number); return MON[m - 1] + ' ' + y; };
  const hbars = (rows, color) => { const mx = Math.max(1, ...rows.map(r => r.count));
    return rows.map(r => `<div class="hb"><div class="sumh"><span>${esc(r.name)}</span><span><b>${r.count}</b>${r.share !== undefined ? ' (' + r.share + '%)' : ''}</span></div>
      <div class="tbar"><i style="width:${r.count / mx * 100}%;background:${r.color || color}"></i></div></div>`).join(''); };

  function cumChart(r) {
    const W = 340, H = 180, L = 30, R = 8, T = 10, B = 22, pw = W - L - R, ph = H - T - B, n = r.days_in_month;
    const mx = Math.max(r.target || 0, r.total, 1), y = (v) => T + ph - v / mx * ph, bw = pw / n;
    const ticks = [0, Math.round(mx / 2), mx]; if (r.target !== null && r.target < mx) ticks.push(r.target);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Σωρευτική πρόοδος ανά ημέρα">`;
    for (const t of ticks) s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#d8ceb9" stroke-width="1"/><text x="${L - 4}" y="${y(t) + 3}" text-anchor="end" font-size="9" fill="#6d6252">${t}</text>`;
    r.daily.forEach((d, i) => { if (d.cum === null) return; const x = L + i * bw + 1, w = Math.max(1, bw - 2), cb = r.target !== null ? Math.min(d.cum, r.target) : d.cum, hb = cb / mx * ph, hs = (d.cum - cb) / mx * ph;
      s += `<rect x="${x}" y="${T + ph - hb}" width="${w}" height="${hb}" rx="1.5" fill="#8c6d3f"/>`; if (hs > 0) s += `<rect x="${x}" y="${T + ph - hb - hs}" width="${w}" height="${hs}" rx="1.5" fill="#2e9e5b"/>`; });
    if (r.target !== null) s += `<polyline fill="none" stroke="#111" stroke-width="1.6" stroke-dasharray="4 3" points="${r.daily.map((d, i) => `${L + i * bw + bw / 2},${y(d.pace)}`).join(' ')}"/>`;
    if (r.target !== null && r.total > r.target) s += `<line x1="${L}" x2="${W - R}" y1="${y(r.target)}" y2="${y(r.target)}" stroke="#111" stroke-width="1" stroke-dasharray="2 3" opacity=".55"/>`;
    for (const d of [1, 5, 10, 15, 20, 25, 30]) if (d <= n) s += `<text x="${L + (d - 1) * bw + bw / 2}" y="${H - 7}" text-anchor="middle" font-size="9" fill="#6d6252">${d}</text>`;
    return s + '</svg>';
  }

  views.store = async function () {
    const r = await api('/store' + (period ? '?period=' + period : '')); period = r.period;
    const ad = r.is_admin, canLog = ad || r.period === r.current_period, hasT = r.target !== null;
        const hint = !hasT ? 'Δεν έχει οριστεί στόχος για αυτή την περίοδο' : r.reached ? overText(r) : r.days_left > 0
      ? `Απομένουν <b>${r.days_left}</b> ημέρες - χρειάζονται <b>${f1(r.per_day)}</b> κομμάτια την ημέρα` : `Η περίοδος ολοκληρώθηκε - έλειψαν ${r.remaining} κομμάτια`;
    V.innerHTML = `<h1>Στόχος Καταστήματος</h1>
    <select id="sp">${r.periods.map(p => `<option value="${p}" ${p === period ? 'selected' : ''}>${plabel(p)}</option>`).join('')}</select>
    <div class="card shero"><div class="sumh"><small>Κομμάτια του μήνα</small><small>${r.days_in_month} ημέρες</small></div>
    <div class="invbig">${r.total}<span class="sof"> / ${hasT ? r.target : '-'}</span><span class="spct ${r.reached ? 'sover' : ''}">${hasT ? r.pct + '%' : ''}</span></div>
    ${hasT ? overBar(r.total, r.target, true) : '<div class="tbar big"></div>'}
    <div class="upd" style="text-align:left;margin-top:8px">${hint}</div>
    ${ad ? '<div class="tbtns tadm"><button class="ghost" id="stt">Αλλαγή στόχου</button><button class="ghost" id="stc">Αντιγραφή στον επόμενο μήνα</button></div>' : ''}</div>

    <h2>Καταχώρηση πώλησης</h2><div class="card" id="slog">
    ${canLog ? `<label style="margin-top:0">Κατηγορία</label><div class="cats">${r.categories.map(c => `<button data-c="${c.key}" class="${selCat === c.key ? 'on' : ''}" style="--cc:${COL[c.key]}">${esc(c.label)}</button>`).join('')}</div>
    ${ad ? `<div class="row" style="margin-top:10px"><select id="swho">${r.users.map(u => `<option value="${u.id}" ${u.id === r.me ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select><input type="date" id="sdt" value="${period === r.current_period ? r.today : period + '-01'}"></div>` : ''}
    <div class="tbtns" style="margin-top:10px"><button data-n="1">+1</button><button data-n="5">+5</button><button data-n="10">+10</button><button id="scust">+N</button><button class="ghost" id="sund">Αναίρεση</button></div>
    <div class="row" id="scw" hidden style="margin-top:8px"><input type="number" inputmode="numeric" id="sn" placeholder="Αριθμός${ad ? ' (αρνητικός για διόρθωση)' : ''}"><button class="btn gold" id="sgo" style="margin-top:0;flex:0 0 130px;padding:12px">Καταχώρηση</button></div>
    <input id="snote" class="tnote" maxlength="200" placeholder="Σημείωση (προαιρετικό)">`
      : '<div class="empty" style="padding:6px 0">Η καταχώρηση γίνεται μόνο στον τρέχοντα μήνα</div>'}</div>

    <h2>Ανά κατηγορία</h2><div class="card">${hbars(r.categories.map(c => ({ name: c.label, count: c.count, share: c.share, color: COL[c.key] })))}</div>
    <h2>Πρόοδος μήνα</h2><div class="card">${cumChart(r)}<div class="legend" style="margin-top:6px"><span><i class="dot" style="background:#8c6d3f;border-radius:2px"></i>Σωρευτικά κομμάτια</span><span><i class="dot" style="background:#111;border-radius:2px"></i>Ρυθμός στόχου</span>${r.reached ? '<span><i class="dot" style="background:#2e9e5b;border-radius:2px"></i>Πάνω από τον στόχο</span>' : ''}</div></div>
    <h2>Ανά πωλητή</h2><div class="card">${r.by_person.length ? hbars(r.by_person.map(p => ({ name: p.name + (p.user_id === r.me ? ' (εγώ)' : ''), count: p.count })), '#8c6d3f') : '<div class="empty" style="padding:6px 0">Δεν υπάρχουν καταχωρήσεις</div>'}</div>
    <h2>Τελευταίες καταχωρήσεις</h2>${r.recent.length ? r.recent.map(x => `<div class="card sr"><div class="sumh"><span><i class="dot" style="background:${COL[x.category] || '#999'}"></i> <b>${esc(x.label)}</b> ${x.qty > 0 ? '+' : ''}${x.qty}</span><small>${esc(x.sale_date.slice(8, 10) + '/' + x.sale_date.slice(5, 7))}</small></div>
      <div class="meta"><span>${esc(x.who)}${x.by !== x.who ? ' (καταχώρηση: ' + esc(x.by) + ')' : ''}</span>${x.note ? `<span>${esc(x.note)}</span>` : ''}</div>${x.can_delete ? `<button class="iconbtn sdel" data-id="${x.id}" style="margin-top:6px;font-size:13px">Διαγραφή</button>` : ''}</div>`).join('') : '<div class="empty">Δεν υπάρχουν καταχωρήσεις</div>'}`;
    const reload = () => route(true), fail = (e) => { if (e.message !== 'auth') toast(e.message); };
    $('#sp').onchange = (e) => { period = e.target.value; route(); };
    if (canLog) {
      V.querySelectorAll('.cats button').forEach(b => b.onclick = () => { selCat = b.dataset.c; V.querySelectorAll('.cats button').forEach(x => x.classList.toggle('on', x === b)); });
      const log = async (n) => { if (!selCat) return toast('Διάλεξε πρώτα κατηγορία (Fix, GSM ή EON TV)');
        const body = { category: selCat, qty: n, note: $('#snote').value, ...(ad ? { user_id: +$('#swho').value, date: $('#sdt').value } : {}) };
        try { await api('/store/sales', { body }); toast((n > 0 ? 'Προστέθηκε +' : 'Διορθώθηκε ') + n + ' ' + r.categories.find(c => c.key === selCat).label); reload(); } catch (e) { fail(e); } };
      V.querySelectorAll('#slog .tbtns [data-n]').forEach(b => b.onclick = () => log(+b.dataset.n));
      $('#scust').onclick = () => { const w = $('#scw'); w.hidden = !w.hidden; if (!w.hidden) $('#sn').focus(); };
      $('#sgo').onclick = () => { const n = parseInt($('#sn').value, 10); if (!n) return toast('Δώσε έναν αριθμό'); log(n); };
      $('#sund').onclick = async () => { try { const u = await api('/store/undo', { body: {} }); toast('Αναιρέθηκε η τελευταία σου καταχώρηση (' + (u.undone > 0 ? '+' : '') + u.undone + ')'); reload(); } catch (e) { fail(e); } };
    }
    V.querySelectorAll('.sdel').forEach(b => b.onclick = async () => { if (!confirm('Διαγραφή καταχώρησης;')) return; try { await api('/store/sales/' + b.dataset.id, { method: 'DELETE' }); reload(); } catch (e) { fail(e); } });
    if (ad) {
      $('#stt').onclick = async () => { const v = prompt('Νέος στόχος κομματιών', r.target ?? 253); if (v === null) return; try { await api('/store/target', { method: 'PUT', body: { period, target: parseInt(v, 10) } }); toast('Ο στόχος άλλαξε'); reload(); } catch (e) { fail(e); } };
      $('#stc').onclick = async () => { try { const c = await api('/store/copy', { body: { from: period } }); toast(c.copied ? 'Αντιγράφηκε ο στόχος στον ' + plabel(c.to) : 'Ο επόμενος μήνας έχει ήδη στόχο'); period = c.to; route(); } catch (e) { fail(e); } };
    }
  };
})();
