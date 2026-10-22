
import { getUser, login, logout, handleAuthCallback } from '@netlify/identity';

(() => {
  const STORAGE_KEY = 'ruangBerdua.v1';
  const defaultData = {
    trip:{name:'Little Escape to Bandung',description:'Waktunya istirahat sejenak, membuat kenangan baru, dan menikmati waktu berdua.',destination:'Bandung',start:'2026-12-12',end:'2026-12-14',budget:3500000},
    members:[{id:'A',name:'Ghazy',target:1750000,saved:800000},{id:'B',name:'Putri',target:1750000,saved:650000}],
    budgets:[
      {id:1,category:'Transportasi',name:'Transportasi & bensin',amount:600000},
      {id:2,category:'Penginapan',name:'Hotel 2 malam',amount:1000000},
      {id:3,category:'Konsumsi',name:'Makan & minum',amount:650000},
      {id:4,category:'Aktivitas',name:'Tiket wisata & aktivitas',amount:750000},
      {id:5,category:'Lainnya',name:'Oleh-oleh & dana cadangan',amount:500000}
    ],
    transactions:[
      {id:101,date:'2026-10-18',name:'Booking penginapan',category:'Penginapan',payer:'A',amount:650000},
      {id:102,date:'2026-10-19',name:'Tiket wisata',category:'Aktivitas',payer:'B',amount:250000},
      {id:103,date:'2026-10-20',name:'DP transportasi',category:'Transportasi',payer:'A',amount:200000},
      {id:104,date:'2026-10-21',name:'Makan bersama',category:'Konsumsi',payer:'B',amount:145000}
    ],
    itinerary:[
      {id:201,date:'2026-12-12',time:'09:00',name:'Berangkat & coffee stop',location:'Perjalanan menuju Bandung',cost:150000,status:'Direncanakan'},
      {id:202,date:'2026-12-12',time:'13:00',name:'Check-in penginapan',location:'Area Dago, Bandung',cost:500000,status:'Dipesan'},
      {id:203,date:'2026-12-13',time:'10:00',name:'Jalan-jalan di alam',location:'Taman wisata alam',cost:200000,status:'Direncanakan'},
      {id:204,date:'2026-12-13',time:'19:00',name:'Dinner date',location:'Restoran pilihan berdua',cost:250000,status:'Belum dipesan'},
      {id:205,date:'2026-12-14',time:'09:00',name:'Sarapan & pulang',location:'Bandung → rumah',cost:150000,status:'Direncanakan'}
    ]
  };
  const clone = x => JSON.parse(JSON.stringify(x));
  let data;
  let plans=[];
  let activePlanId='';
  let serverRevision=0;
  let remoteReady=false;
  let remoteSaving=false;
  let localDirty=false;
  let syncConflict=false;
  let lastRemotePayload='';
  let pollHandle=null;
  try {
    const stored=JSON.parse(localStorage.getItem(STORAGE_KEY));
    if(stored && Array.isArray(stored.plans) && stored.plans.length){
      plans=stored.plans;
      activePlanId=stored.activePlanId || plans.find(p=>!p.archived)?.id || plans[0].id;
      if(!plans.some(p=>p.id===activePlanId))activePlanId=plans[0].id;
      const active=plans.find(p=>p.id===activePlanId);data=active.data;
    } else {
      data=stored && stored.trip ? stored : clone(defaultData);
      activePlanId='plan-'+Date.now();plans=[{id:activePlanId,archived:false,data:clone(data)}];
    }
  } catch { data=clone(defaultData);activePlanId='plan-'+Date.now();plans=[{id:activePlanId,archived:false,data:clone(data)}]; }
  data.members.forEach(m=>{if(m.id==='A')m.name='Ghazy';if(m.id==='B')m.name='Putri';});
  const activePlan=()=>plans.find(p=>p.id===activePlanId);
  plans.forEach(p=>{p.archived=!!p.archived;p.data=p.data||clone(defaultData);p.data.members=p.data.members||clone(defaultData.members);p.data.members.forEach(m=>{if(m.id==='A')m.name='Ghazy';if(m.id==='B')m.name='Putri';});p.data.budgets=p.data.budgets||[];p.data.transactions=p.data.transactions||[];p.data.itinerary=p.data.itinerary||[];});
  data=activePlan().data;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const rupiah = n => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Math.round(Number(n)||0)).replace(/\u00a0/g,' ');
  const dateFormat = (s,opts={day:'numeric',month:'short'}) => {if(!s)return '—';return new Intl.DateTimeFormat('id-ID',opts).format(new Date(s+'T12:00:00'))};
  const escapeHtml = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sum = arr => arr.reduce((a,b)=>a+Number(b||0),0);
  const spent = () => sum(data.transactions.map(t=>t.amount));
  const savings = () => sum(data.members.map(m=>m.saved));
  const targetSavings = () => sum(data.members.map(m=>m.target));
  const remaining = () => data.trip.budget-spent();
  const categoryColors = {'Transportasi':'#71866b','Penginapan':'#d98270','Konsumsi':'#d6bd8c','Aktivitas':'#b8c8ae','Lainnya':'#e8e7dc'};
  const categoryIcons = {'Transportasi':'🚗','Penginapan':'🛏️','Konsumsi':'☕','Aktivitas':'🎟️','Lainnya':'🛍️'};
  function snapshot(){return {version:2,activePlanId,plans};}
  function save(){const p=activePlan();if(p)p.data=data;const snap=snapshot();localStorage.setItem(STORAGE_KEY,JSON.stringify(snap));render();if(remoteReady){localDirty=true;persistRemote(snap);}}
  async function apiState(method='GET',body){const res=await fetch('/api/shared-state',{method,headers:{'Content-Type':'application/json'},credentials:'same-origin',...(body?{body:JSON.stringify(body)}:{})});let json={};try{json=await res.json()}catch{}if(!res.ok){const e=new Error(json.error||`Permintaan gagal (${res.status})`);e.status=res.status;throw e;}return json;}
  function applySnapshot(snap){if(!snap||!Array.isArray(snap.plans)||!snap.plans.length)return false;plans=snap.plans;activePlanId=snap.activePlanId||plans.find(p=>!p.archived)?.id||plans[0].id;if(!plans.some(p=>p.id===activePlanId))activePlanId=plans[0].id;plans.forEach(p=>{p.archived=!!p.archived;p.data=p.data||clone(defaultData);p.data.members=p.data.members||clone(defaultData.members);p.data.members.forEach(m=>{if(m.id==='A')m.name='Ghazy';if(m.id==='B')m.name='Putri';});p.data.budgets=p.data.budgets||[];p.data.transactions=p.data.transactions||[];p.data.itinerary=p.data.itinerary||[];});data=activePlan().data;localStorage.setItem(STORAGE_KEY,JSON.stringify(snapshot()));return true;}
  async function persistRemote(snap){if(remoteSaving||syncConflict)return;remoteSaving=true;try{const result=await apiState('PUT',{payload:snap,expectedRevision:serverRevision});serverRevision=result.revision;lastRemotePayload=JSON.stringify(result.payload||snap);const latest=JSON.stringify(snapshot());localDirty=latest!==JSON.stringify(snap);}catch(e){if(e.status===409){syncConflict=true;showToast('Data berubah dari perangkat lain. Muat ulang halaman agar perubahan terbaru masuk.');}else{showToast('Gagal menyimpan online: '+e.message);}}finally{remoteSaving=false;if(localDirty&&!syncConflict&&remoteReady)persistRemote(snapshot());}}
  async function startSync(){try{const remote=await apiState('GET');serverRevision=remote.revision||0;if(remote.payload){applySnapshot(remote.payload);lastRemotePayload=JSON.stringify(remote.payload);}else{const local=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')||snapshot();const result=await apiState('PUT',{payload:local,expectedRevision:0});serverRevision=result.revision;applySnapshot(result.payload||local);lastRemotePayload=JSON.stringify(result.payload||local);}remoteReady=true;syncConflict=false;localDirty=false;$('#appShell').classList.remove('auth-hidden');$('#authScreen').style.display='none';render();if(pollHandle)clearInterval(pollHandle);pollHandle=setInterval(async()=>{if(!remoteReady||localDirty||remoteSaving||syncConflict)return;try{const r=await apiState('GET');if(r.payload&&r.revision>serverRevision){const next=JSON.stringify(r.payload);if(next!==lastRemotePayload){applySnapshot(r.payload);serverRevision=r.revision;lastRemotePayload=next;render();showToast('Data terbaru dari perangkat pasangan tersinkron.');}}}catch(e){if(e.status===401||e.status===403){remoteReady=false;showAuth('Sesi berakhir atau akun tidak memiliki akses. Silakan login kembali.');}}},5000);$('#authMessage').textContent='';}catch(e){showAuth(e.message||'Tidak dapat menghubungkan ke database. Pastikan situs sudah dideploy ke Netlify.');}}
  function showAuth(message=''){remoteReady=false;$('#appShell').classList.add('auth-hidden');$('#authScreen').style.display='grid';$('#authMessage').textContent=message;}
  async function checkAuth(){try{await handleAuthCallback();const user=await getUser();if(user){await startSync();}else{showAuth();}}catch(e){showAuth(e.message||'Login belum tersedia. Pastikan situs sudah dideploy ke Netlify.');}}

  function renderPlanManager(){
    const active=activePlan();
    const current=plans.filter(p=>!p.archived);
    const archived=plans.filter(p=>p.archived);
    const card=p=>{const d=p.data;const isCurrent=p.id===activePlanId;const total=sum(d.members.map(m=>m.saved));const target=sum(d.members.map(m=>m.target));const pct=target?Math.min(100,total/target*100):0;return `<article class="plan-card ${isCurrent?'current':''} ${p.archived?'archived':''}"><div class="plan-card-top"><div><h4>${escapeHtml(d.trip.name)}</h4><p>📍 ${escapeHtml(d.trip.destination||'Destinasi belum diisi')} · ${dateFormat(d.trip.start,{day:'numeric',month:'short',year:'numeric'})}</p></div><span class="plan-tag ${p.archived?'archived-tag':''}">${p.archived?'Diarsipkan':isCurrent?'Sedang dibuka':'Aktif'}</span></div><div class="plan-card-stats"><span>Anggaran <strong>${rupiah(d.trip.budget)}</strong></span><span>Tabungan <strong>${Math.round(pct)}%</strong></span></div><div class="plan-actions">${!p.archived&&!isCurrent?`<button class="btn secondary plan-open" data-id="${p.id}">Buka</button>`:''}${p.archived?`<button class="btn secondary plan-restore" data-id="${p.id}">Pulihkan</button>`:''}<button class="btn secondary plan-duplicate" data-id="${p.id}">Duplikat</button>${!p.archived?`<button class="btn secondary plan-archive" data-id="${p.id}">Arsipkan</button>`:''}<button class="btn secondary plan-delete" data-id="${p.id}">Hapus</button></div></article>`;};
    const el=$('#planManagerList');
    el.innerHTML=(current.length?current.map(card).join(''):'<div class="plan-empty">Belum ada rencana aktif. Pulihkan arsip atau tambahkan rencana baru.</div>')+(archived.length?`<div class="plan-section-label" style="grid-column:1/-1">Arsip (${archived.length})</div>${archived.map(card).join('')}`:'');
  }
  function activatePlan(id){const p=plans.find(x=>x.id===id);if(!p)return;p.archived=false;activePlanId=p.id;data=p.data;save();setPage('dashboard');showToast('Rencana dibuka: '+data.trip.name);}
  function openCreatePlanModal(){
    openModal('Tambah rencana liburan',`<form id="modalForm"><div class="form-grid"><div class="field full"><label for="newPlanName">Nama rencana</label><input id="newPlanName" name="name" required maxlength="100" placeholder="Contoh: Anniversary di Bali"></div><div class="field full"><label for="newPlanDestination">Destinasi</label><input id="newPlanDestination" name="destination" required placeholder="Contoh: Bali"></div><div class="field"><label for="newPlanStart">Tanggal berangkat</label><input id="newPlanStart" name="start" type="date" required value="2027-03-12"></div><div class="field"><label for="newPlanEnd">Tanggal pulang</label><input id="newPlanEnd" name="end" type="date" required value="2027-03-14"></div><div class="field full"><label for="newPlanBudget">Target anggaran (Rp)</label><input id="newPlanBudget" name="budget" type="number" min="0" step="any" required value="3000000"></div></div><p style="font-size:12px;color:var(--muted)">Rencana baru dimulai dengan tabungan, transaksi, anggaran kategori, dan itinerary yang kosong agar tidak tercampur dengan rencana lain.</p><div class="form-actions"><button type="button" class="btn secondary" id="cancelModal">Batal</button><button class="btn" type="submit">Buat rencana</button></div></form>`,f=>{
      const budget=Number(f.get('budget'));const d=clone(defaultData);d.trip={name:f.get('name').trim(),description:'Rencana perjalanan baru untuk Ghazy dan Putri.',destination:f.get('destination').trim(),start:f.get('start'),end:f.get('end'),budget};d.members=[{id:'A',name:'Ghazy',target:budget/2,saved:0},{id:'B',name:'Putri',target:budget/2,saved:0}];d.budgets=[];d.transactions=[];d.itinerary=[];const id='plan-'+Date.now();plans.push({id,archived:false,data:d});activePlanId=id;data=d;save();setPage('dashboard');showToast('Rencana baru berhasil dibuat.');
    });$('#cancelModal').onclick=closeModal;
  }
  function duplicatePlan(id){const source=plans.find(p=>p.id===id);if(!source)return;const d=clone(source.data);d.trip.name=(d.trip.name||'Rencana liburan')+' (Salinan)';const newId='plan-'+Date.now()+'-'+Math.floor(Math.random()*10000);plans.push({id:newId,archived:false,data:d});activePlanId=newId;data=d;save();setPage('dashboard');showToast('Rencana berhasil diduplikat.');}
  function archivePlan(id){const p=plans.find(x=>x.id===id);if(!p||p.archived)return;const alternatives=plans.filter(x=>x.id!==id&&!x.archived);if(!alternatives.length){alert('Sisakan minimal satu rencana aktif. Buat atau pulihkan rencana lain sebelum mengarsipkan rencana ini.');return;}if(!confirm(`Arsipkan rencana "${p.data.trip.name}"? Data tetap tersimpan dan bisa dipulihkan.`))return;p.archived=true;if(id===activePlanId){activePlanId=alternatives[0].id;data=alternatives[0].data;}save();showToast('Rencana dipindahkan ke arsip.');}
  function restorePlan(id){const p=plans.find(x=>x.id===id);if(!p)return;p.archived=false;activePlanId=p.id;data=p.data;save();setPage('dashboard');showToast('Rencana dipulihkan.');}
  function deletePlan(id){const p=plans.find(x=>x.id===id);if(!p)return;if(plans.length<=1){alert('Rencana terakhir tidak bisa dihapus. Buat rencana baru terlebih dahulu.');return;}if(!confirm(`Hapus permanen rencana "${p.data.trip.name}" beserta seluruh data anggaran, tabungan, transaksi, dan itinerary-nya? Tindakan ini tidak bisa dibatalkan.`))return;const wasActive=id===activePlanId;plans=plans.filter(x=>x.id!==id);if(wasActive){let next=plans.find(x=>!x.archived)||plans[0];next.archived=false;activePlanId=next.id;data=next.data;}save();showToast('Rencana dan datanya telah dihapus.');}
  function showToast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600);}
  function tripDates(){return `${dateFormat(data.trip.start,{day:'numeric',month:'long'})}–${dateFormat(data.trip.end,{day:'numeric',month:'long',year:'numeric'})}`;}
  function setPage(page){
    $$('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+page));
    $$('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    const titles={dashboard:'Halo, lovebirds! ♡',budget:'Anggaran perjalanan',savings:'Tabungan bersama ♡',itinerary:'Itinerary perjalanan',transactions:'Transaksi'};
    $('#pageHeading').textContent=titles[page]||'Rencana Kita';
    $('#sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'smooth'});
  }
  function budgetRows(){return data.budgets.map(b=>({...b,actual:sum(data.transactions.filter(t=>t.category===b.category).map(t=>t.amount))}));}
  function renderBudgetLegend(){
    const filter=$('#budgetFilter').value;
    const rows=budgetRows().filter(b=>filter==='all'||b.category===filter);
    const total=filter==='all'?data.trip.budget:sum(rows.map(b=>b.amount));
    const actual=filter==='all'?spent():sum(rows.map(b=>b.actual));
    const pct=total>0?Math.min(100,actual/total*100):0;
    $('#budgetSpentBig').textContent=rupiah(actual);$('#budgetPercent').textContent=(total>0?(actual/total*100):0).toLocaleString('id-ID',{maximumFractionDigits:1})+'%';
    $('#donutPercent').textContent=Math.round(pct)+'%';
    const colors=rows.map(b=>categoryColors[b.category]||'#d9ddd0');
    let offset=0;const parts=rows.map((b,i)=>{const value=total>0?b.amount/total*100:0;const part=`${colors[i]} ${offset}% ${offset+value}%`;offset+=value;return part;});
    $('#budgetDonut').style.background=parts.length?`conic-gradient(${parts.join(',')})`:'conic-gradient(#e8e7dc 0 100%)';
    $('#budgetLegend').innerHTML=rows.map((b,i)=>`<div class="legend-row"><span class="legend-dot" style="background:${colors[i]}"></span><div class="legend-name">${escapeHtml(b.category)}<small>${rupiah(b.actual)} aktual</small></div><span class="legend-value">${rupiah(b.amount)}</span></div>`).join('')||'<div class="tx-empty">Belum ada kategori anggaran.</div>';
  }
  function renderPeople(target){
    $(target).innerHTML=data.members.map(m=>`<div class="person-row"><div class="person-avatar ${m.id==='A'?'a':'b'}">${escapeHtml(m.id)}</div><div class="person-info"><strong>${escapeHtml(m.name)}</strong><span>Target ${rupiah(m.target)} · ${m.target?Math.round(m.saved/m.target*100):0}% tercapai</span></div><div class="person-amount">${rupiah(m.saved)}<small>terkumpul</small></div></div>`).join('');
  }
  function itineraryMarkup(items){
    if(!items.length)return '<div class="tx-empty">Belum ada agenda. Tambahkan aktivitas untuk perjalanan kalian.</div>';
    return items.map(i=>`<div class="itinerary-item"><div class="day-box"><strong>${dateFormat(i.date,{day:'numeric'})}</strong><span>${dateFormat(i.date,{month:'short'})}</span></div><div><div class="itin-title">${escapeHtml(i.name)}</div><div class="itin-sub">${escapeHtml(i.time)} · ${escapeHtml(i.location)}</div><span class="status ${i.status==='Belum dipesan'?'pending':''}">${escapeHtml(i.status)}</span><div style="margin-top:4px"><button class="link-btn edit-itinerary" data-id="${i.id}">Edit</button> <button class="link-btn delete-itinerary" data-id="${i.id}">Hapus</button></div></div><div class="itin-cost">${rupiah(i.cost)}</div></div>`).join('');
  }
  function transactionMarkup(items,limit=false){
    const list=limit?items.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4):items.slice().sort((a,b)=>b.date.localeCompare(a.date));
    if(!list.length)return '<div class="tx-empty">Belum ada transaksi. Mulai catat pengeluaran pertama kalian.</div>';
    return list.map(t=>`<div class="transaction"><div class="tx-icon">${categoryIcons[t.category]||'♡'}</div><div><div class="tx-title">${escapeHtml(t.name)}</div><div class="tx-meta">${dateFormat(t.date,{day:'numeric',month:'short',year:'numeric'})} · Dibayar ${escapeHtml(data.members.find(m=>m.id===t.payer)?.name || t.payer)}</div></div><div class="tx-amount">${rupiah(t.amount)}<small>${escapeHtml(t.category)}</small></div></div>`).join('');
  }
  function renderTables(){
    $('#budgetTable').innerHTML=budgetRows().map(b=>`<tr><td><strong>${escapeHtml(b.category)}</strong><div style="color:#92998e;font-size:10px;margin-top:3px">${escapeHtml(b.name)}</div></td><td>${rupiah(b.amount)}</td><td>${rupiah(b.actual)}</td><td style="color:${b.amount-b.actual<0?'#bd6d5d':'#4e6c4c'}">${rupiah(b.amount-b.actual)}</td><td><span class="pill ${b.actual>b.amount?'pending':''}">${b.actual>b.amount?'Melebihi batas':b.actual/b.amount>=.8?'Hampir penuh':'Aman'}</span></td><td><button class="link-btn edit-budget" data-id="${b.id}">Edit</button> <button class="link-btn delete-budget" data-id="${b.id}">Hapus</button></td></tr>`).join('');
    $('#transactionsTable').innerHTML=data.transactions.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(t=>`<tr><td>${dateFormat(t.date,{day:'numeric',month:'short',year:'numeric'})}</td><td><strong>${escapeHtml(t.name)}</strong></td><td>${escapeHtml(t.category)}</td><td>${escapeHtml(data.members.find(m=>m.id===t.payer)?.name || t.payer)}</td><td><strong>${rupiah(t.amount)}</strong></td><td><button class="link-btn delete-tx" data-id="${t.id}" aria-label="Hapus transaksi">Hapus</button></td></tr>`).join('')||'<tr><td colspan="6" class="tx-empty">Belum ada transaksi.</td></tr>';
  }
  function render(){
    const totalSpent=spent(), totalSave=savings(), target=targetSavings(), budget=data.trip.budget;
    $('#sideTripName').textContent=data.trip.name;$('#heroTripName').textContent=data.trip.name;$('#sideTripDate').textContent=tripDates();$('#dateRange').textContent=tripDates();$('#heroTripDates').textContent=tripDates();$('#heroTripDescription').textContent=data.trip.description;
    $('#statBudget').textContent=rupiah(budget);$('#statSpent').textContent=rupiah(totalSpent);$('#statRemaining').textContent=rupiah(budget-totalSpent);$('#statSavings').textContent=rupiah(totalSave);
    $('#spentNote').innerHTML=`<span class="${totalSpent>budget?'coral-text':'positive'}">${budget? (totalSpent/budget*100).toLocaleString('id-ID',{maximumFractionDigits:1}):0}%</span> dari anggaran`;
    $('#savingsNote').textContent=`${target?(totalSave/target*100).toLocaleString('id-ID',{maximumFractionDigits:1}):0}% dari target dana`;
    const savePct=target?Math.min(100,totalSave/target*100):0;$('#savingsBar').style.width=savePct+'%';$('#savingsCollected').textContent='Terkumpul '+rupiah(totalSave);$('#savingsPct').textContent=savePct.toLocaleString('id-ID',{maximumFractionDigits:1})+'%';$('#savingsTotal').textContent=rupiah(target);
    $('#sideProgress').style.width=savePct+'%';$('#sideProgressText').textContent=Math.round(savePct)+'% menuju target tabungan';
    renderPlanManager();renderBudgetLegend();renderPeople('#contributionPeople');renderPeople('#savingsPeople');
    $('#dashboardItinerary').innerHTML=itineraryMarkup(data.itinerary.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).slice(0,3));
    $('#fullItinerary').innerHTML=itineraryMarkup(data.itinerary.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)));
    $('#dashboardTransactions').innerHTML=transactionMarkup(data.transactions,true);
    $('#budgetPageTotal').textContent=rupiah(budget);$('#budgetPageSpent').textContent=rupiah(totalSpent);$('#budgetPageRemaining').textContent=rupiah(budget-totalSpent);$('#budgetCategoryCount').textContent=data.budgets.length+' kategori';
    $('#savingsPageCollected').textContent=rupiah(totalSave);$('#savingsPagePercent').textContent=savePct.toLocaleString('id-ID',{maximumFractionDigits:1})+'%';$('#savingsPageBar').style.width=savePct+'%';$('#savingsPageTarget').textContent='Target '+rupiah(target);$('#savingsPageGap').textContent='Kurang '+rupiah(Math.max(0,target-totalSave));
    $('#txCount').textContent=data.transactions.length;$('#txTotal').textContent=rupiah(totalSpent);renderTables();
  }
  function openModal(title,html,onSubmit){
    $('#modalTitle').textContent=title;$('#modalContent').innerHTML=html;$('#modalBackdrop').classList.add('open');
    $('#modalForm').addEventListener('submit',e=>{e.preventDefault();const form=new FormData(e.currentTarget);onSubmit(form);$('#modalBackdrop').classList.remove('open');});
  }
  function closeModal(){$('#modalBackdrop').classList.remove('open')}
  function openTripModal(){
    openModal('Edit rencana liburan',`<form id="modalForm"><div class="form-grid">
      <div class="field full"><label for="tripName">Nama liburan</label><input id="tripName" name="name" value="${escapeHtml(data.trip.name)}" required maxlength="100"></div>
      <div class="field full"><label for="tripDescription">Deskripsi</label><textarea id="tripDescription" name="description" rows="2">${escapeHtml(data.trip.description)}</textarea></div>
      <div class="field"><label for="tripDestination">Destinasi</label><input id="tripDestination" name="destination" value="${escapeHtml(data.trip.destination||'Bandung')}" required></div>
      <div class="field"><label for="tripBudget">Total anggaran (Rp)</label><input id="tripBudget" name="budget" type="number" min="0" step="any" value="${data.trip.budget}" required></div>
      <div class="field"><label for="tripStart">Tanggal berangkat</label><input id="tripStart" name="start" type="date" value="${data.trip.start}" required></div>
      <div class="field"><label for="tripEnd">Tanggal pulang</label><input id="tripEnd" name="end" type="date" value="${data.trip.end}" required></div>
      </div><div class="form-actions"><button type="button" class="btn secondary" id="cancelModal">Batal</button><button class="btn" type="submit">Simpan rencana</button></div></form>`,
      f=>{data.trip.name=f.get('name').trim();data.trip.description=f.get('description').trim();data.trip.destination=f.get('destination').trim();data.trip.budget=Number(f.get('budget'));data.trip.start=f.get('start');data.trip.end=f.get('end');save();showToast('Rencana liburan diperbarui.');});
    $('#cancelModal').onclick=closeModal;
  }
  function openTransactionModal(){
    openModal('Catat transaksi',`<form id="modalForm"><div class="form-grid">
      <div class="field full"><label for="txName">Nama transaksi</label><input id="txName" name="name" placeholder="Contoh: Tiket kereta" required maxlength="100"></div>
      <div class="field"><label for="txAmount">Nominal (Rp)</label><input id="txAmount" name="amount" type="number" min="1" step="any" placeholder="150000" required></div>
      <div class="field"><label for="txDate">Tanggal</label><input id="txDate" name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required></div>
      <div class="field"><label for="txCategory">Kategori</label><select id="txCategory" name="category">${data.budgets.map(b=>`<option>${escapeHtml(b.category)}</option>`).join('')}</select></div>
      <div class="field"><label for="txPayer">Dibayar oleh</label><select id="txPayer" name="payer"><option value="A">Ghazy</option><option value="B">Putri</option></select></div>
      </div><div class="form-actions"><button type="button" class="btn secondary" id="cancelModal">Batal</button><button class="btn" type="submit">Simpan transaksi</button></div></form>`,
      f=>{data.transactions.push({id:Date.now(),name:f.get('name').trim(),amount:Number(f.get('amount')),date:f.get('date'),category:f.get('category'),payer:f.get('payer')});save();showToast('Transaksi berhasil dicatat.');});
    $('#cancelModal').onclick=closeModal;
  }
  function openSavingsModal(){
    openModal('Catat setoran tabungan',`<form id="modalForm"><div class="form-grid">
      <div class="field full"><label for="savePerson">Setoran dari</label><select id="savePerson" name="person">${data.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select></div>
      <div class="field full"><label for="saveAmount">Nominal setoran (Rp)</label><input id="saveAmount" name="amount" type="number" min="1" step="any" placeholder="250000" required></div>
      </div><div class="form-actions"><button type="button" class="btn secondary" id="cancelModal">Batal</button><button class="btn" type="submit">Simpan setoran</button></div></form>`,
      f=>{const m=data.members.find(x=>x.id===f.get('person'));m.saved+=Number(f.get('amount'));save();showToast('Setoran tabungan berhasil ditambahkan.');});
    $('#cancelModal').onclick=closeModal;
  }
  function openItineraryModal(){
    openModal('Tambah agenda perjalanan',`<form id="modalForm"><div class="form-grid">
      <div class="field full"><label for="itName">Nama aktivitas</label><input id="itName" name="name" placeholder="Contoh: Sunset di tepi danau" required maxlength="100"></div>
      <div class="field"><label for="itDate">Tanggal</label><input id="itDate" name="date" type="date" value="${data.trip.start}" required></div>
      <div class="field"><label for="itTime">Waktu</label><input id="itTime" name="time" type="time" value="09:00" required></div>
      <div class="field full"><label for="itLocation">Lokasi / catatan</label><input id="itLocation" name="location" placeholder="Nama tempat atau alamat" required></div>
      <div class="field"><label for="itCost">Estimasi biaya (Rp)</label><input id="itCost" name="cost" type="number" min="0" step="any" value="0" required></div>
      <div class="field"><label for="itStatus">Status</label><select id="itStatus" name="status"><option>Direncanakan</option><option>Dipesan</option><option>Belum dipesan</option></select></div>
      </div><div class="form-actions"><button type="button" class="btn secondary" id="cancelModal">Batal</button><button class="btn" type="submit">Simpan agenda</button></div></form>`,
      f=>{data.itinerary.push({id:Date.now(),name:f.get('name').trim(),date:f.get('date'),time:f.get('time'),location:f.get('location').trim(),cost:Number(f.get('cost')),status:f.get('status')});save();showToast('Agenda baru berhasil ditambahkan.');});
    $('#cancelModal').onclick=closeModal;
  }
  function openEditItineraryModal(id){
    const i=data.itinerary.find(x=>String(x.id)===String(id));if(!i)return;
    openModal('Edit agenda perjalanan',`<form id="modalForm"><div class="form-grid">
      <div class="field full"><label for="editItName">Nama aktivitas</label><input id="editItName" name="name" value="${escapeHtml(i.name)}" required maxlength="100"></div>
      <div class="field"><label for="editItDate">Tanggal</label><input id="editItDate" name="date" type="date" value="${i.date}" required></div>
      <div class="field"><label for="editItTime">Waktu</label><input id="editItTime" name="time" type="time" value="${i.time}" required></div>
      <div class="field full"><label for="editItLocation">Lokasi / catatan</label><input id="editItLocation" name="location" value="${escapeHtml(i.location)}" required></div>
      <div class="field"><label for="editItCost">Estimasi biaya (Rp)</label><input id="editItCost" name="cost" type="number" min="0" step="any" value="${i.cost}" required></div>
      <div class="field"><label for="editItStatus">Status</label><select id="editItStatus" name="status">${['Direncanakan','Dipesan','Belum dipesan'].map(s=>`<option ${s===i.status?'selected':''}>${s}</option>`).join('')}</select></div>
      </div><div class="form-actions"><button type="button" class="btn secondary" id="cancelModal">Batal</button><button class="btn" type="submit">Simpan perubahan</button></div></form>`,
      f=>{i.name=f.get('name').trim();i.date=f.get('date');i.time=f.get('time');i.location=f.get('location').trim();i.cost=Number(f.get('cost'));i.status=f.get('status');save();showToast('Agenda diperbarui.');});
    $('#cancelModal').onclick=closeModal;
  }
  function openBudgetModal(){
    openModal('Tambah kategori anggaran',`<form id="modalForm"><div class="form-grid">
      <div class="field"><label for="bCategory">Kategori</label><select id="bCategory" name="category"><option>Transportasi</option><option>Penginapan</option><option>Konsumsi</option><option>Aktivitas</option><option>Lainnya</option></select></div>
      <div class="field"><label for="bAmount">Batas anggaran (Rp)</label><input id="bAmount" name="amount" type="number" min="1" step="any" required placeholder="300000"></div>
      <div class="field full"><label for="bName">Nama kebutuhan</label><input id="bName" name="name" required placeholder="Contoh: Tiket kereta pulang-pergi"></div>
      </div><div class="form-actions"><button type="button" class="btn secondary" id="cancelModal">Batal</button><button class="btn" type="submit">Tambah anggaran</button></div></form>`,
      f=>{data.budgets.push({id:Date.now(),category:f.get('category'),name:f.get('name').trim(),amount:Number(f.get('amount'))});data.trip.budget+=Number(f.get('amount'));save();showToast('Kategori anggaran berhasil ditambahkan.');});
    $('#cancelModal').onclick=closeModal;
  }
  function openEditBudgetModal(id){
    const b=data.budgets.find(x=>String(x.id)===String(id));if(!b)return;
    openModal('Edit anggaran',`<form id="modalForm"><div class="form-grid">
      <div class="field"><label for="editBCategory">Kategori</label><select id="editBCategory" name="category">${['Transportasi','Penginapan','Konsumsi','Aktivitas','Lainnya'].map(c=>`<option ${c===b.category?'selected':''}>${c}</option>`).join('')}</select></div>
      <div class="field"><label for="editBAmount">Batas anggaran (Rp)</label><input id="editBAmount" name="amount" type="number" min="0" step="any" value="${b.amount}" required></div>
      <div class="field full"><label for="editBName">Nama kebutuhan</label><input id="editBName" name="name" value="${escapeHtml(b.name)}" required></div>
      </div><div class="form-actions"><button type="button" class="btn secondary" id="cancelModal">Batal</button><button class="btn" type="submit">Simpan perubahan</button></div></form>`,
      f=>{b.category=f.get('category');b.amount=Number(f.get('amount'));b.name=f.get('name').trim();save();showToast('Anggaran diperbarui.');});
    $('#cancelModal').onclick=closeModal;
  }
  function editContributions(){
    openModal('Edit kontribusi per orang',`<form id="modalForm"><div class="form-grid">${data.members.map(m=>`<div class="field full"><label for="target${m.id}">Target tabungan ${escapeHtml(m.name)} (Rp)</label><input id="target${m.id}" name="target${m.id}" type="number" min="0" step="any" value="${m.target}" required></div><div class="field full"><label for="saved${m.id}">Nominal terkumpul dari ${escapeHtml(m.name)} (Rp)</label><input id="saved${m.id}" name="saved${m.id}" type="number" min="0" step="any" value="${m.saved}" required></div>`).join('')}</div><p style="font-size:12px;color:var(--muted);margin:12px 0 0">Nominal terkumpul bisa diubah langsung kapan saja. Perubahan ini memperbarui total tabungan di seluruh aplikasi.</p><div class="form-actions"><button type="button" class="btn secondary" id="cancelModal">Batal</button><button class="btn" type="submit">Simpan perubahan</button></div></form>`,
      f=>{data.members.forEach(m=>{m.target=Number(f.get('target'+m.id));m.saved=Number(f.get('saved'+m.id));});save();showToast('Kontribusi Ghazy dan Putri diperbarui.');});
    $('#cancelModal').onclick=closeModal;
  }
  $('#addPlanBtn').addEventListener('click',openCreatePlanModal);
  $('#planManagerList').addEventListener('click',e=>{const btn=e.target.closest('button[data-id]');if(!btn)return;const id=btn.dataset.id;if(btn.classList.contains('plan-open'))activatePlan(id);else if(btn.classList.contains('plan-duplicate'))duplicatePlan(id);else if(btn.classList.contains('plan-archive'))archivePlan(id);else if(btn.classList.contains('plan-restore'))restorePlan(id);else if(btn.classList.contains('plan-delete'))deletePlan(id);});
  $$('.nav button').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));
  $$('[data-goto]').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.goto)));
  $('#editTripBtn').addEventListener('click',openTripModal);
  $('#budgetTable').addEventListener('click',e=>{
    const edit=e.target.closest('.edit-budget'), del=e.target.closest('.delete-budget');
    if(edit)openEditBudgetModal(edit.dataset.id);
    if(del){const b=data.budgets.find(x=>String(x.id)===del.dataset.id);if(b&&confirm('Hapus kategori anggaran ini?')){data.budgets=data.budgets.filter(x=>String(x.id)!==del.dataset.id);save();showToast('Kategori anggaran dihapus.');}}
  });
  function handleItineraryAction(e){const edit=e.target.closest('.edit-itinerary'),del=e.target.closest('.delete-itinerary');if(edit)openEditItineraryModal(edit.dataset.id);if(del&&confirm('Hapus agenda ini?')){data.itinerary=data.itinerary.filter(x=>String(x.id)!==del.dataset.id);save();showToast('Agenda dihapus.');}}
  $('#fullItinerary').addEventListener('click',handleItineraryAction);$('#dashboardItinerary').addEventListener('click',handleItineraryAction);
  $('#menuToggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
  $('#quickAdd').addEventListener('click',openTransactionModal);$('#addTransactionBtn').addEventListener('click',openTransactionModal);
  $('#addSavingsBtn').addEventListener('click',openSavingsModal);$('#addItineraryBtn').addEventListener('click',openItineraryModal);$('#addBudgetBtn').addEventListener('click',openBudgetModal);$('#editContributions').addEventListener('click',editContributions);
  $('#budgetFilter').addEventListener('change',renderBudgetLegend);
  $('#closeModal').addEventListener('click',closeModal);$('#modalBackdrop').addEventListener('click',e=>{if(e.target===$('#modalBackdrop'))closeModal();});
  $('#transactionsTable').addEventListener('click',e=>{const btn=e.target.closest('.delete-tx');if(!btn)return;if(confirm('Hapus transaksi ini?')){data.transactions=data.transactions.filter(t=>String(t.id)!==btn.dataset.id);save();showToast('Transaksi dihapus.');}});
  $('#exportCsv').addEventListener('click',()=>{const rows=[['Tanggal','Nama transaksi','Kategori','Pembayar','Nominal (Rp)'],...data.transactions.map(t=>[t.date,t.name,t.category,(data.members.find(m=>m.id===t.payer)?.name || t.payer),t.amount])];const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='transaksi-rencana-kita.csv';a.click();URL.revokeObjectURL(url);showToast('File CSV berhasil disiapkan.');});
  const now=new Date();$('#todayLabel').textContent=new Intl.DateTimeFormat('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now).toUpperCase();
  render();
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const btn=$('#loginSubmit');btn.disabled=true;btn.textContent='Memeriksa…';$('#authMessage').textContent='';try{await login($('#loginEmail').value.trim(),$('#loginPassword').value);await startSync();}catch(err){showAuth(err.message||'Login gagal. Periksa email dan kata sandi.');}finally{btn.disabled=false;btn.textContent='Login ke Rencana Kita';}});
  $('#logoutBtn').addEventListener('click',async()=>{try{await logout();}finally{if(pollHandle)clearInterval(pollHandle);showAuth('Kamu sudah keluar dari aplikasi.');}});
  checkAuth();
})();
