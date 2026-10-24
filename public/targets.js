// Στόχοι πωλητών + καταγραφή προόδου. Loaded after app.js; adds views.targets.
(function () {
  let period = null;
  const fm1 = (n) => Number(n).toLocaleString('el-GR', { maximumFractionDigits: 1 });
  const plabel = (p) => { const [y, m] = p.split('-').map(Number); return MON[m - 1] + ' ' + y; };
  const subKey = (s) => s.group ? 'g:' + s.group : 'u:' + s.user;
  const subBody = (k) => k.startsWith('g:') ? { group_label: k.slice(2) } : { user_id: +k.slice(2) };

  function metricBlock(t, key, isAdmin) {
    const pct = Math.min(100, t.pct), done = t.done >= t.target && t.target > 0;
    const hint = done ? 'Ο στόχος ολοκληρώθηκε' : t.days_left > 0 ? `Χρειάζονται ${fm1(t.per_day)} την ημέρα (απομένουν ${t.remaining})` : `Απομένουν ${t.remaining}`;
    return `<div class="tm" data-sub="${esc(key)}" data-m="${esc(t.metric)}">
      <div class="sumh"><b>${esc(t.label)}</b><span><b>${t.done}</b> / ${t.target} (${t.pct}%)</span></div>
      <div class="tbar"><i class="${done ? 'ok' : ''}" style="width:${pct}%"></i></div>
      <div class="upd" style="text-align:left;margin:4px 0 8px">${hint}</div>
      <div class="tbtns"><button data-a="add" data-n="1">+1</button><button data-a="add" data-n="5">+5</button><button data-a="add" data-n="10">+10</button><button data-a="custom">+N</button><button data-a="undo" class="ghost">Αναίρεση</button>
</div>
      ${isAdmin ? `<div class="tbtns tadm"><button data-a="edit" data-id="${t.id}" data-t="${t.target}" class="ghost">Αλλαγή στόχου</button><button data-a="del" data-id="${t.id}" class="ghost">Διαγραφή</button></div>` : ''}
      <div class="row tcust" hidden><input type="number" inputmode="numeric" class="tn" placeholder="Αριθμός${isAdmin ? ' (αρνητικός για διόρθωση)' : ''}"><button class="btn gold" data-a="addn" style="margin-top:0">Καταχώρηση</button></div></div>`;
  }
  const card = (title, sub, key, targets, isAdmin, cls) => `<div class="card tcard ${cls || ''}" data-card="${esc(key)}"><div class="sumh"><div class="t">${esc(title)}</div>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    ${targets.map(t => metricBlock(t, key, isAdmin)).join('')}
    <input class="tnote" maxlength="200" placeholder="Σημείωση (προαιρετικό)"></div>`;

  views.targets = async function () {
    const r = await api('/targets' + (period ? '?period=' + period : '')); period = r.period;
    const ad = r.is_admin;
    V.innerHTML = `<h1>Στόχοι</h1>
    <select id="tp">${r.periods.map(p => `<option value="${p}" ${p === period ? 'selected' : ''}>${plabel(p)}</option>`).join('')}</select>
    <p class="upd" style="text-align:left">${r.days_left > 0 ? `Απομένουν <b>${r.days_left}</b> ημέρες από ${r.days_in_month} στον μήνα (με τη σημερινή)` : 'Η περίοδος έχει ολοκληρωθεί'}</p>
    ${r.groups.map(g => g.targets.length ? card('Κοινός στόχος: ' + g.label, 'ομάδα', 'g:' + g.label, g.targets, ad, 'team') : '').join('')}
    ${r.people.map(p => card(p.me ? p.name + ' (εγώ)' : p.name, '', 'u:' + p.user_id, p.targets, ad)).join('')}
    ${!r.people.length && !r.groups.some(g => g.targets.length) ? '<div class="empty">Δεν υπάρχουν στόχοι για αυτή την περίοδο</div>' : ''}
    ${ad ? `<h2>Διαχείριση (διαχειριστής)</h2><div class="card"><b>Προσθήκη ή αλλαγή στόχου</b>
      <select id="as" style="margin-top:8px">${r.users.map(u => `<option value="u:${u.id}">${esc(u.name)}</option>`).join('')}${r.group_labels.map(g => `<option value="g:${esc(g)}">Ομάδα: ${esc(g)}</option>`).join('')}</select>
      <div class="row" style="margin-top:8px"><select id="am">${r.metrics.map(m => `<option value="${esc(m.key)}">${esc(m.label)}</option>`).join('')}</select><input id="at" type="number" inputmode="numeric" placeholder="Στόχος"></div>
      <button class="btn gold" id="aadd">Αποθήκευση στόχου</button></div>
      <div class="card"><b>Νέος δείκτης</b><div class="row" style="margin-top:8px"><input id="mk" placeholder="κωδικός (λατινικά)"><input id="ml" placeholder="Όνομα"></div><button class="btn ghost" id="madd">Προσθήκη δείκτη</button></div>
      <button class="btn ghost" id="acopy">Αντιγραφή στόχων στον επόμενο μήνα</button>` : ''}`;
    const reload = () => route(true);
    const fail = (e) => { if (e.message !== 'auth') toast(e.message); };
    $('#tp').onchange = (e) => { period = e.target.value; route(); };
    const log = async (cardEl, tm, n) => {
      const note = cardEl.querySelector('.tnote').value;
      try { await api('/targets/progress', { body: { ...subBody(tm.dataset.sub), metric: tm.dataset.m, period, delta: n, note } }); toast(n > 0 ? 'Προστέθηκε +' + n : 'Διορθώθηκε ' + n); reload(); } catch (e) { fail(e); }
    };
    V.querySelectorAll('.tm button').forEach(b => b.onclick = async () => {
      const tm = b.closest('.tm'), c = b.closest('.tcard'), a = b.dataset.a;
      if (a === 'add') return log(c, tm, +b.dataset.n);
      if (a === 'custom') { const w = tm.querySelector('.tcust'); w.hidden = !w.hidden; if (!w.hidden) w.querySelector('input').focus(); return; }
      if (a === 'addn') { const n = parseInt(tm.querySelector('.tn').value, 10); if (!n) return toast('Δώσε έναν αριθμό'); return log(c, tm, n); }
      if (a === 'undo') { try { const r = await api('/targets/progress/undo', { body: { ...subBody(tm.dataset.sub), metric: tm.dataset.m, period } }); toast('Αναιρέθηκε ' + (r.undone > 0 ? '+' : '') + r.undone); reload(); } catch (e) { fail(e); } return; }
      if (a === 'edit') { const v = prompt('Νέος στόχος', b.dataset.t); if (v === null) return; try { await api('/targets/' + b.dataset.id, { method: 'PUT', body: { target: parseInt(v, 10) } }); toast('Ο στόχος άλλαξε'); reload(); } catch (e) { fail(e); } return; }
      if (a === 'del') { if (!confirm('Διαγραφή στόχου;')) return; try { await api('/targets/' + b.dataset.id, { method: 'DELETE' }); reload(); } catch (e) { fail(e); } }
    });
    if (ad) {
      $('#aadd').onclick = async () => { try { await api('/targets', { body: { ...subBody($('#as').value), metric: $('#am').value, target: parseInt($('#at').value, 10), period } }); toast('Αποθηκεύτηκε'); reload(); } catch (e) { fail(e); } };
      $('#madd').onclick = async () => { try { await api('/targets/metrics', { body: { key: $('#mk').value, label: $('#ml').value } }); toast('Προστέθηκε'); reload(); } catch (e) { fail(e); } };
      $('#acopy').onclick = async () => { try { const r = await api('/targets/copy', { body: { from: period } }); toast(`Αντιγράφηκαν ${r.copied} στόχοι στον ${plabel(r.to)}`); period = r.to; route(); } catch (e) { fail(e); } };
    }
  };
})();
