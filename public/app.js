const $ = (s) => document.querySelector(s), V = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = localStorage.token, me = JSON.parse(localStorage.me || 'null'), users = [], calMonth = new Date(), selDay = ymd(new Date());
let STATUSES=[],ST={},myStatus=null,teamTimer=null;
const MON = ['Ιανουάριος','Φεβρουάριος','Μάρτιος','Απρίλιος','Μάιος','Ιούνιος','Ιούλιος','Αύγουστος','Σεπτέμβριος','Οκτώβριος','Νοέμβριος','Δεκέμβριος'];
const DOW = ['Δευ','Τρι','Τετ','Πεμ','Παρ','Σαβ','Κυρ'];
function pad(n){return String(n).padStart(2,'0')}
function ymd(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function fmt(due){if(!due)return 'Χωρίς προθεσμία';const d=new Date(due);return d.toLocaleDateString('el-GR',{weekday:'short',day:'numeric',month:'short'})+' · '+due.slice(11,16)}
function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(t._h);t._h=setTimeout(()=>t.hidden=true,2500)}
async function api(p,o={}){const r=await fetch('/api'+p,{method:o.method||(o.body?'POST':'GET'),headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:o.body&&JSON.stringify(o.body)});
  if(r.status===401&&p!=='/login'){logout();throw new Error('auth')}const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Σφάλμα');return j}
function logout(){token=null;me=null;myStatus=null;sumDate=null;$('#stsheet').hidden=true;localStorage.removeItem('token');localStorage.removeItem('me');location.hash='#login';route()}
const initials=(n)=>esc((n||'?')[0]);
function card(t){const late=t.status==='open'&&t.due&&new Date(t.due)<new Date();
  return `<a class="card ${t.status==='done'?'done':''} ${late?'late':''}" href="#task/${t.id}"><div class="t">${esc(t.title)}</div>
  <div class="meta"><span>🕒 ${fmt(t.due)}</span><span>👤 ${esc(t.assignee_name||'—')}</span>${t.status==='done'?'<span class="pill ok">Ολοκληρώθηκε</span>':late?'<span class="pill late">Εκπρόθεσμο</span>':''}</div></a>`}
function list(ts,empty='Δεν υπάρχουν εργασίες'){return ts.length?ts.map(card).join(''):`<div class="empty">${empty}</div>`}

// ── Team status helpers
const stOf=k=>ST[k]||{key:k,label:k,color:'#8e8e8e'};
function mins(since,now){return Math.max(0,Math.floor((Date.parse(now)-Date.parse(since))/60000))}
function dur(m){m=Math.round(m);if(m<60)return m+'′';return Math.floor(m/60)+'ω '+pad(m%60)+'′'}
async function loadStatuses(){if(STATUSES.length)return;const r=await api('/statuses');STATUSES=r.statuses;ST=Object.fromEntries(STATUSES.map(s=>[s.key,s]))}
function paintChip(){if(!myStatus)return;const s=stOf(myStatus.status);$('#stbtn .dot').style.background=s.color;$('#stlbl').textContent=s.label;
  $('#sttime').textContent='· '+dur(mins(myStatus.since,myStatus.now));$('#stbtn').title=myStatus.note||''}
async function refreshStatus(){if(!token)return;try{await loadStatuses();myStatus=await api('/status/me');paintChip()}catch{}}
function openSheet(){if(!myStatus)return;$('#stnote').value=myStatus.note||'';
  $('#stgrid').innerHTML=STATUSES.map(s=>`<button data-k="${s.key}" class="${s.key===myStatus.status?'on':''}"><i class="dot" style="background:${s.color}"></i>${esc(s.label)}</button>`).join('');
  $('#stgrid').querySelectorAll('button').forEach(b=>b.onclick=()=>setMyStatus(b.dataset.k));$('#stsheet').hidden=false}
async function setMyStatus(k){try{myStatus=await api('/status',{body:{status:k,note:$('#stnote').value}});paintChip();$('#stsheet').hidden=true;
  toast('Κατάσταση: '+stOf(k).label+(myStatus.note?' — '+myStatus.note:''));if(location.hash.startsWith('#team'))route(true)}catch(e){toast(e.message)}}
$('#stbtn').onclick=openSheet;$('#stclose').onclick=$('#stsheet .sheetbg').onclick=()=>$('#stsheet').hidden=true;
$('#stnote').onkeydown=e=>{if(e.key==='Enter'&&myStatus)setMyStatus(myStatus.status)};
let sumDate=null;
async function refreshBadge(){if(!token)return;try{const n=await api('/notifications');const u=n.filter(x=>!x.read).length;$('#badge').hidden=!u;$('#badge').textContent=u}catch{}}

const views={
async login(){ document.body.classList.add('auth');$('#top').hidden=$('#tabs').hidden=true;
  const us=await (await fetch('/api/users/public')).json(); let sel=null;
  V.innerHTML=`<div class="login"><div class="biglogo" data-svg="/brand/logo_vertical.svg"></div><p class="sub">TEAM TASKS</p>
  <label>Ποιος είσαι;</label><div class="users">${us.map(u=>`<button data-id="${u.id}"><div class="av">${initials(u.name)}</div>${esc(u.name)}</button>`).join('')}</div>
  <label>PIN</label><input id="pin" class="pin" type="password" readonly maxlength="8" placeholder="PIN">
  <div class="kp">${[1,2,3,4,5,6,7,8,9,'C',0,'⌫'].map(k=>`<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
  <button class="btn" id="go">Είσοδος</button></div>`;
  V.parentElement.style.padding=0;inlineSvgs();
  V.querySelectorAll('.users button').forEach(b=>b.onclick=()=>{V.querySelectorAll('.users button').forEach(x=>x.classList.remove('on'));b.classList.add('on');sel=+b.dataset.id});
  V.querySelectorAll('.kp button').forEach(b=>b.onclick=()=>{const p=$('#pin'),k=b.dataset.k;if(k==='C')p.value='';else if(k==='⌫')p.value=p.value.slice(0,-1);else if(p.value.length<8)p.value+=k;});
  const go=async()=>{if(!sel)return toast('Διάλεξε το όνομά σου');try{const r=await api('/login',{body:{user_id:sel,pin:$('#pin').value}});token=r.token;me=r.user;localStorage.token=token;localStorage.me=JSON.stringify(me);location.hash='#agenda';}catch(e){toast(e.message)}};
  $('#go').onclick=go;$('#pin').onkeydown=e=>e.key==='Enter'&&go();},
async cal(){ const y=calMonth.getFullYear(),m=calMonth.getMonth();const first=new Date(y,m,1),start=new Date(y,m,1-((first.getDay()+6)%7));
  const end=new Date(start);end.setDate(end.getDate()+42);
  const ts=await api(`/tasks?from=${ymd(start)}&to=${ymd(end)}`);const by={};ts.forEach(t=>(by[t.due.slice(0,10)]??=[]).push(t));
  let cells='';for(let i=0;i<42;i++){const d=new Date(start);d.setDate(d.getDate()+i);const k=ymd(d);const n=(by[k]||[]).length;
    cells+=`<div class="day ${d.getMonth()!==m?'out':''} ${k===ymd(new Date())?'today':''} ${k===selDay?'sel':''}" data-d="${k}">${d.getDate()}<div class="dots">${'<i></i>'.repeat(Math.min(n,3))}</div></div>`}
  const dayTs=(by[selDay]||[]);
  V.innerHTML=`<div class="cal"><div class="calh"><button id="pm">‹</button><b>${MON[m]} ${y}</b><button id="nm">›</button></div>
  <div class="grid">${DOW.map(d=>`<div class="dow">${d}</div>`).join('')}${cells}</div></div>
  <h2>${new Date(selDay).toLocaleDateString('el-GR',{weekday:'long',day:'numeric',month:'long'})}</h2>${list(dayTs,'Καμία εργασία αυτή τη μέρα')}`;
  $('#pm').onclick=()=>{calMonth=new Date(y,m-1,1);route()};$('#nm').onclick=()=>{calMonth=new Date(y,m+1,1);route()};
  V.querySelectorAll('.day').forEach(c=>c.onclick=()=>{selDay=c.dataset.d;route()});},
async agenda(){ const ts=await api('/tasks');const open=ts.filter(t=>t.status==='open'),done=ts.filter(t=>t.status==='done');
  const groups={};open.forEach(t=>{const k=t.due?t.due.slice(0,10):'—';(groups[k]??=[]).push(t)});
  const today=ymd(new Date()),tom=ymd(new Date(Date.now()+864e5));
  const lbl=k=>k==='—'?'Χωρίς ημερομηνία':k<today?'Εκπρόθεσμα · '+new Date(k).toLocaleDateString('el-GR',{day:'numeric',month:'short'}):k===today?'Σήμερα':k===tom?'Αύριο':new Date(k).toLocaleDateString('el-GR',{weekday:'long',day:'numeric',month:'long'});
  V.innerHTML=`<h1>Ατζέντα ομάδας</h1>${Object.keys(groups).sort().map(k=>`<h2>${lbl(k)}</h2>${list(groups[k])}`).join('')||'<div class="empty">Όλα έτοιμα 🎉</div>'}
  ${done.length?`<h2>Ολοκληρωμένα</h2>${list(done.slice(0,10))}`:''}`},
async mine(){ const ts=await api('/tasks?mine=1');
  V.innerHTML=`<h1>Οι εργασίες μου</h1><h2>Ανοιχτές</h2>${list(ts.filter(t=>t.status==='open'),'Δεν έχεις ανοιχτές εργασίες 👌')}<h2>Ολοκληρωμένες</h2>${list(ts.filter(t=>t.status==='done'),'—')}`},
async task(id){ const t=await api('/tasks/'+id);const canDone=t.status==='open'&&(t.assignee_id===me.id||t.creator_id===me.id||me.is_admin);const canEdit=t.creator_id===me.id||me.is_admin;
  V.innerHTML=`<a href="javascript:history.back()" style="color:var(--b);text-decoration:none;font-weight:700">‹ Πίσω</a>
  <h1 style="margin-top:10px">${esc(t.title)}</h1>
  ${t.status==='done'?'<span class="pill ok">✔ Ολοκληρώθηκε</span>':'<span class="pill">Ανοιχτή</span>'}
  <div class="card" style="margin-top:12px"><div class="meta" style="flex-direction:column;gap:6px;font-size:14px">
  <span>🕒 <b>Προθεσμία:</b> ${fmt(t.due)}</span><span>👤 <b>Ανατέθηκε σε:</b> ${esc(t.assignee_name||'—')}</span><span>✍️ <b>Από:</b> ${esc(t.creator_name)}</span>
  <span>⏰ <b>Υπενθύμιση:</b> ${t.reminder_min?t.reminder_min+' λεπτά πριν':'Καμία'}</span></div>
  ${t.description?`<p style="white-space:pre-wrap;margin:12px 0 0">${esc(t.description)}</p>`:''}</div>
  ${t.status==='done'?`<div class="note"><b>Ολοκληρώθηκε</b> ${t.done_at?new Date(t.done_at.replace(' ','T')+(t.done_at.includes('T')?'':'Z')).toLocaleString('el-GR',{dateStyle:'short',timeStyle:'short'}):''}${t.done_note?`<br>📝 ${esc(t.done_note)}`:''}</div>
     <button class="btn ghost" id="reopen">Επαναφορά σε ανοιχτή</button>`:''}
  ${canDone?`<label>Σημείωση ολοκλήρωσης (προαιρετικό)</label><textarea id="note" placeholder="π.χ. Έγινε, ο πελάτης θα απαντήσει αύριο"></textarea><button class="btn gold" id="done">✔ Ολοκληρώθηκε</button>`:''}
  ${canEdit?`<div class="row"><button class="btn ghost" id="edit">Επεξεργασία</button><button class="btn danger" id="del">Διαγραφή</button></div>`:''}`;
  $('#done')&&($('#done').onclick=async()=>{await api(`/tasks/${id}/done`,{body:{note:$('#note').value}});toast('Μπράβο! Ενημερώθηκε ο υπεύθυνος');route()});
  $('#reopen')&&($('#reopen').onclick=async()=>{await api(`/tasks/${id}/reopen`,{body:{}});route()});
  $('#edit')&&($('#edit').onclick=()=>location.hash='#edit/'+id);
  $('#del')&&($('#del').onclick=async()=>{if(confirm('Διαγραφή εργασίας;')){await api('/tasks/'+id,{method:'DELETE'});location.hash='#agenda'}});},
async new(id){ users=await api('/users');const t=id?await api('/tasks/'+id):{due:selDay+'T10:00',assignee_id:me.id,reminder_min:30};
  V.innerHTML=`<h1>${id?'Επεξεργασία':'Νέα εργασία'}</h1>
  <label>Τίτλος</label><input id="ti" value="${esc(t.title||'')}" placeholder="π.χ. Κλήση σε πελάτη">
  <label>Περιγραφή</label><textarea id="de" placeholder="Λεπτομέρειες…">${esc(t.description||'')}</textarea>
  <div class="row"><div><label>Ημερομηνία</label><input id="dd" type="date" value="${(t.due||'').slice(0,10)}"></div><div><label>Ώρα</label><input id="dt" type="time" value="${(t.due||'').slice(11,16)}"></div></div>
  <label>Ανάθεση σε</label><select id="as">${users.map(u=>`<option value="${u.id}" ${u.id===t.assignee_id?'selected':''}>${esc(u.name)}${u.id===me.id?' (εγώ)':''}</option>`).join('')}</select>
  <label>Υπενθύμιση</label><select id="rm">${[[0,'Καμία'],[10,'10 λεπτά πριν'],[30,'30 λεπτά πριν'],[60,'1 ώρα πριν'],[1440,'1 μέρα πριν']].map(([v,l])=>`<option value="${v}" ${v==t.reminder_min?'selected':''}>${l}</option>`).join('')}</select>
  <button class="btn" id="sv">${id?'Αποθήκευση':'Δημιουργία & ανάθεση'}</button>`;
  $('#sv').onclick=async()=>{const b={title:$('#ti').value.trim(),description:$('#de').value,due:$('#dd').value?$('#dd').value+'T'+($('#dt').value||'09:00'):null,assignee_id:+$('#as').value,reminder_min:+$('#rm').value};
    try{if(id){await api('/tasks/'+id,{method:'PUT',body:b});location.hash='#task/'+id}else{const r=await api('/tasks',{body:b});toast('Η εργασία ανατέθηκε');location.hash='#task/'+r.id}}catch(e){toast(e.message)}};},
async team(){ await loadStatuses();const r=await api('/team');const cnt={};r.team.forEach(u=>cnt[u.status]=(cnt[u.status]||0)+1);
  let sum='';if(me.is_admin){sumDate=sumDate||r.now&&new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Athens'}).format(new Date(r.now));const q=await api('/status/summary?date='+sumDate);
    sum=`<h2 id="sumh" style="margin-top:26px">Σήμερα · χρόνος ανά κατάσταση</h2><input type="date" id="sumd" value="${q.date}" style="margin-bottom:10px">
    ${q.people.map(p=>{const tot=Object.values(p.minutes).reduce((a,b)=>a+b,0)||1;const ks=STATUSES.filter(s=>p.minutes[s.key]).map(s=>s.key).concat(Object.keys(p.minutes).filter(k=>!ST[k]));
      const tm=x=>x?new Date(x).toLocaleTimeString('el-GR',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Europe/Athens'}):'';
      return `<div class="card"><div class="sumh"><b>${esc(p.name)}</b><small>Ενεργός ${dur(p.active_minutes)}${p.first_active?' · '+tm(p.first_active)+'–'+tm(p.last_active):''}</small></div>
      <div class="bar">${ks.map(k=>`<i style="width:${p.minutes[k]/tot*100}%;background:${stOf(k).color}" title="${esc(stOf(k).label)}"></i>`).join('')}</div>
      <div class="legend">${ks.length?ks.map(k=>`<span><i class="dot" style="background:${stOf(k).color}"></i>${esc(stOf(k).label)} <b>${dur(p.minutes[k])}</b></span>`).join(''):'<span>Καμία καταγραφή</span>'}</div></div>`}).join('')}
    <p class="upd">Ώρες Ελλάδας · «Ενεργός» = όλες οι καταστάσεις εκτός από Not ready</p>`}
  V.innerHTML=`<h1>Ομάδα τώρα</h1><div class="stsum">${STATUSES.filter(s=>cnt[s.key]).map(s=>`<span class="stpill"><i class="dot" style="background:${s.color}"></i>${esc(s.label)} ${cnt[s.key]}</span>`).join('')}</div>
  ${r.team.map(u=>{const s=stOf(u.status);return `<div class="card member" style="border-left-color:${s.color}"><div class="av">${initials(u.name)}<i class="dot" style="background:${s.color}"></i></div>
    <div class="who"><div class="t">${esc(u.name)}${u.id===me.id?' <span class="pill">εγώ</span>':''}</div><div class="st">${esc(s.label)} <span>· ${dur(mins(u.since,r.now))}</span></div>${u.note?`<div class="nt">📝 ${esc(u.note)}</div>`:''}</div></div>`}).join('')}
  <p class="upd">Ανανέωση αυτόματα κάθε 15″ · ${new Date(r.now).toLocaleTimeString('el-GR',{hourCycle:'h23',timeZone:'Europe/Athens'})}</p>${sum}`;
  $('#sumd')&&($('#sumd').onchange=e=>{sumDate=e.target.value;route(true)});
  teamTimer=setInterval(()=>{if(location.hash.startsWith('#team')&&!document.hidden&&!$('#sumd:focus'))route(true)},15000);},
async notif(){ const n=await api('/notifications');
  V.innerHTML=`<h1>Ειδοποιήσεις</h1>${n.length?n.map(x=>`<a class="card n ${x.read?'':'unread'}" href="${x.task_id?'#task/'+x.task_id:'#notif'}"><div>${esc(x.text)}<small>${new Date(x.created.replace(' ','T')+'Z').toLocaleString('el-GR',{dateStyle:'short',timeStyle:'short'})}</small></div></a>`).join(''):'<div class="empty">Καμία ειδοποίηση</div>'}`;
  await api('/notifications/read',{body:{}});refreshBadge();},
async more(){ users=await api('/users');
  V.innerHTML=`<h1>Περισσότερα</h1><div class="card">Συνδεδεμένος ως <b>${esc(me.name)}</b>${me.is_admin?' · Διαχειριστής':''}</div>
  <a class="btn gold" href="#targets" style="text-align:center;text-decoration:none">Στόχοι</a>
  ${me.is_admin?'<a class="btn gold" href="#invoices" style="text-align:center;text-decoration:none">Τιμολόγια αγορών και ΦΠΑ</a>':''}
  <h2>Ειδοποιήσεις στο κινητό</h2><div class="card" id="pushst" style="font-size:14px"></div>
  <button class="btn gold" id="push">🔔 Ενεργοποίηση ειδοποιήσεων</button><button class="btn ghost" id="ptest">Δοκιμαστική ειδοποίηση</button>
  <h2>Αλλαγή PIN</h2><input id="np" type="tel" pattern="[0-9]*" autocomplete="off" style="-webkit-text-security:disc" inputmode="numeric" placeholder="Νέο PIN (4-8 ψηφία)"><button class="btn ghost" id="cp">Αλλαγή PIN</button>
  ${me.is_admin?`<h2>Ομάδα</h2>${users.map(u=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center"><span>${esc(u.name)} ${u.is_admin?'<span class="pill">admin</span>':''}</span>${u.id!==me.id?`<button class="iconbtn" data-del="${u.id}">🗑️</button>`:''}</div>`).join('')}
  <label>Νέο μέλος</label><div class="row"><input id="nn" placeholder="Όνομα"><input id="npin" inputmode="numeric" placeholder="PIN"></div>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="nadm" style="width:auto"> Διαχειριστής</label><button class="btn" id="add">Προσθήκη μέλους</button>`:''}
  <button class="btn danger" id="lo">Αποσύνδεση</button>`;
  const st=$('#pushst');const ios=/iPhone|iPad/.test(navigator.userAgent),standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  st.innerHTML=!('serviceWorker' in navigator)||!('PushManager' in window)?(ios&&!standalone?'Στο iPhone: πάτα <b>Κοινοποίηση → Προσθήκη στην οθόνη Αφετηρίας</b>, άνοιξε την εφαρμογή από το εικονίδιο και έλα ξανά εδώ (iOS 16.4+).':'Ο browser δεν υποστηρίζει push.'):
    'Κατάσταση: <b>'+({granted:'Ενεργές ✅',denied:'Μπλοκαρισμένες ❌ (άλλαξέ το από τις ρυθμίσεις)',default:'Ανενεργές'}[Notification.permission])+'</b>';
  $('#push').onclick=enablePush;$('#ptest').onclick=async()=>{await api('/push/test',{body:{}});toast('Στάλθηκε');refreshBadge()};
  $('#cp').onclick=async()=>{try{await api(`/users/${me.id}/pin`,{body:{pin:$('#np').value}});toast('Το PIN άλλαξε')}catch(e){toast(e.message)}};
  $('#lo').onclick=async()=>{await api('/logout',{body:{}}).catch(()=>{});logout()};
  $('#add')&&($('#add').onclick=async()=>{try{await api('/users',{body:{name:$('#nn').value,pin:$('#npin').value,is_admin:$('#nadm').checked}});toast('Προστέθηκε');route()}catch(e){toast(e.message)}});
  V.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(confirm('Αφαίρεση μέλους;')){await api('/users/'+b.dataset.del,{method:'DELETE'});route()}});}
};
async function enablePush(){try{const reg=await navigator.serviceWorker.ready;const p=await Notification.requestPermission();if(p!=='granted')return toast('Δεν δόθηκε άδεια');
  const {key}=await api('/push/key');const raw=atob(key.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-key.length%4)%4));
  const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
  await api('/push/subscribe',{body:sub.toJSON()});toast('Οι ειδοποιήσεις ενεργοποιήθηκαν');route()}catch(e){toast('Σφάλμα: '+e.message)}}
async function route(silent){if(silent instanceof Event)silent=false;clearInterval(teamTimer);teamTimer=null;const y=scrollY;const [v,arg]=(location.hash.slice(1)||'agenda').split('/');
  if(!token&&v!=='login'){location.hash='#login';return}
  if(v!=='login'){document.body.classList.remove('auth');$('#top').hidden=$('#tabs').hidden=false;V.parentElement.style.padding='';}
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('on',a.dataset.t===(v==='invoices'||v==='invoice'||v==='targets'?'more':v)));
  try{if(v==='edit')await views.new(arg);else await (views[v]||views.agenda)(arg)}catch(e){if(e.message!=='auth')V.innerHTML=`<div class="empty">${esc(e.message)}</div>`}
  refreshBadge();if(v!=='login')refreshStatus();silent?window.scrollTo(0,y):window.scrollTo(0,0)}
async function inlineSvgs(){for(const el of document.querySelectorAll('[data-svg]:not([data-done])')){el.dataset.done=1;el.innerHTML=await (await fetch(el.dataset.svg)).text();}}
inlineSvgs();
$('#bell').onclick=()=>location.hash='#notif';
addEventListener('hashchange',route);
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');
setInterval(refreshBadge,30000);setInterval(refreshStatus,15000);
route();
