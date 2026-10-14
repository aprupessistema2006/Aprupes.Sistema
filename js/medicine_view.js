// MedicineView - minimal uzraudzības skats
'use strict';

const MEDICINE_FIELDS = [
  { cat: 'temp', field: 'temperatura', unit: '°C' },
  { cat: 'edinasana', field: 'brokastis' },
  { cat: 'edinasana', field: 'pusdienas' },
  { cat: 'edinasana', field: 'launags' },
  { cat: 'edinasana', field: 'vakariņi' },
  { cat: 'sikdrumi', field: 'urina_daudzums', unit: 'ml' },
  { cat: 'sikdrumi', field: 'uznemts_ml', unit: 'ml' },
  { cat: 'fiziologija', field: 'vedera_izeja' }
];
const MEDICINE_FIELD_SET = new Set(MEDICINE_FIELDS.map(f => f.field));

function num(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(',', '.');
  if (s === '' || s === '-') return NaN;
  return parseFloat(s);
}

class MedicineView {
  constructor() {
    this.db = null;
    this.sync = null;
    this.currentUser = null;
    this.allClients = [];
    this.allEmployees = [];
    this.allMarks = [];
    this._byClientField = new Map();
    this._byClient = new Map();
    this.searchTerm = '';
    this.init();
  }

  async init() {
    const userData = sessionStorage.getItem('careUser');
    if (!userData) { window.location.href = 'index.html'; return; }
    this.currentUser = JSON.parse(userData);
    this.db = new CareDB();
    await this.db.init();
    window.careDB = this.db;
    this.sync = new CareSync(this.db, CONFIG);
    window.careSync = this.sync;
    const role = (this.currentUser.loma || '').toLowerCase();
    if (role.indexOf('medic') === -1 && role.indexOf('medicin') === -1 && role !== 'mediķis' && role !== 'arsts' && role !== 'medicinska' && role !== 'medicīnas darbinieks' && role !== 'administrators' && role !== 'kontroliere') {
      window.location.href = 'aprupe.html';
      return;
    }
    this.setupUI();
    this.setupLanguageSwitcher();
    try {
      await this.sync.bootstrapUI({
        onLocalReady: async () => { await this.loadData(); this.renderTabs(); },
        onServerData: async () => { await this.loadData(); this.renderTabs(); },
        onProgress: (msg) => this._setStatus(msg)
      });
    } catch (e) { console.warn('[medicine] ielādes kļūda:', e); }
    finally { this._setStatus(null); }
  }

  async loadData() {
    [this.allClients, this.allEmployees, this.allMarks] = await Promise.all([
      this.db.getAll('klienti'),
      this.db.getAll('darbinieki'),
      this.db.getAll('atzimes')
    ]);
    this._buildIndex();
  }

  _buildIndex() {
    this._byClientField = new Map();
    this._byClient = new Map();
    this.allMarks.forEach(raw => {
      if (!raw) return;
      const clientId = String(raw.clientId || raw.klients_id || raw.klienti_id || '').trim();
      if (!clientId) return;
      const field = String(raw.field || raw.lauka_nosaukums || '').trim();
      if (!field) return;
      const item = { raw, clientId, field, value: raw.value !== undefined && raw.value !== null ? raw.value : raw.vertiba, date: this._markDate(raw), time: String(raw.time || raw.laiks || '').slice(0,5), ts: raw.lastModified || raw.pedeja_laiks || raw.created || 0 };
      let list = this._byClient.get(clientId); if (!list) { list = []; this._byClient.set(clientId, list); }
      list.push(item);
      let byField = this._byClientField.get(clientId); if (!byField) { byField = new Map(); this._byClientField.set(clientId, byField); }
      let series = byField.get(field); if (!series) { series = []; byField.set(field, series); }
      series.push(item);
    });
    const bySort = (a,b) => (a.date+a.time).localeCompare(b.date+b.time);
    this._byClient.forEach(list => list.sort(bySort));
    this._byClientField.forEach(byField => byField.forEach(series => series.sort(bySort)));
  }

  _markDate(m) {
    if (!m) return '';
    const raw = m.date || m.datums || '';
    const s = String(raw);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (iso) return iso[1]+'-'+iso[2]+'-'+iso[3];
    const lv = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); if (lv) return lv[3]+'-'+lv[2]+'-'+lv[1];
    const idTs = String(m.id||'').match(/^[a-z]+_(\d{10,13})/);
    if (idTs) { const d=new Date(parseInt(idTs[1],10)); if(!isNaN(d.getTime())) return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
    const d2=new Date(s); if(!isNaN(d2.getTime())) return d2.getFullYear()+'-'+String(d2.getMonth()+1).padStart(2,'0')+'-'+String(d2.getDate()).padStart(2,'0');
    return '';
  }

  _today() {
    if (typeof TimezoneUtils !== 'undefined' && TimezoneUtils.getTodayRiga) return TimezoneUtils.getTodayRiga();
    const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  _val(v){ return v===undefined||v===null?'':String(v); }

  _getLatestByClient(clientId,date){
    const day=date||this._today();
    const fields=this._byClientField.get(String(clientId));
    const out={};
    if(!fields) return out;
    MEDICINE_FIELDS.forEach(f=>{
      const series=fields.get(f.field)||[];
      for(let i=series.length-1;i>=0;i--){
        if(series[i].date===day){ out[f.field]=series[i]; break; }
      }
    });
    return out;
  }

  _getPrevious(clientId,field,beforeDate){
    const fields=this._byClientField.get(String(clientId));
    if(!fields) return null;
    const series=fields.get(field)||[];
    for(let i=series.length-1;i>=0;i--){
      if(series[i].date<beforeDate) return series[i];
      if(series[i].date===beforeDate&&i>0) return series[i-1];
    }
    return series.length>1?series[series.length-2]:null;
  }

  _dirSymbol(curr,prev,field){
    if(!curr||!prev) return '→';
    const cv=num(curr.value), pv=num(prev.value);
    if(isNaN(cv)||isNaN(pv)){
      return String(curr.value)===String(prev.value)?'→':'↑';
    }
    if(field==='temperatura'){
      if(Math.abs(cv-pv)<0.2) return '→';
      return cv<pv?'↓':'↑';
    }
    if(field==='urina_daudzums'||field==='uznemts_ml'){
      if(Math.abs(cv-pv)<10) return '→';
      return cv<pv?'↑':'↓';
    }
    return String(curr.value)===String(prev.value)?'→':'↑';
  }

  _dirClass(curr,prev,field){
    const sym=this._dirSymbol(curr,prev,field);
    return sym==='↑'?'dir-up':sym==='↓'?'dir-down':'dir-flat';
  }

  renderTabs(){
    const splash=document.getElementById('medSplash');
    if(splash) setTimeout(()=>splash.classList.add('hidden'),200);
    this.renderAttention();
    this.renderAllTable();
    const back=document.getElementById('btnBack');
    if(back) back.onclick=()=>{window.location.href='control.html';};
    document.querySelectorAll('.med-tab').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('.med-tab').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const tab=btn.dataset.tab;
        document.querySelectorAll('.med-tab-panel').forEach(p=>p.classList.toggle('active',p.id===('panel-'+tab)));
      });
    });
    this._wireUi();
  }

  renderAllTable(){
    const tbody=document.getElementById('allTableBody');
    const dateEl=document.getElementById('dateFilter');
    const day=(dateEl&&dateEl.value)||this._today();
    if(!tbody) return;
    const term=(document.getElementById('clientSearch')&&document.getElementById('clientSearch').value||'').toLowerCase();
    const list=[];
    this.allClients.forEach(c=>{
      const name=((c.vards||c.Vārds||'')+' '+(c.uzvards||c.Uzvārds||'')).trim();
      if(term&&name.toLowerCase().indexOf(term)===-1) return;
      list.push({c,name});
    });
    list.sort((a,b)=>a.name.localeCompare(b.name));
    let html='';
    list.forEach(({c,name})=>{
      const cid=c.id||c.ID;
      const latest=this._getLatestByClient(cid,day);
      const t=latest['temperatura'], b=latest['brokastis'], l=latest['pusdienas'], sn=latest['launags'], d=latest['vakariņi'], ur=latest['urina_daudzums'], h2o=latest['uznemts_ml'], v=latest['vedera_izeja'];
      const pt=this._getPrevious(cid,'temperatura',day), pb=this._getPrevious(cid,'brokastis',day), pl=this._getPrevious(cid,'pusdienas',day), ps=this._getPrevious(cid,'launags',day), pd=this._getPrevious(cid,'vakariņi',day), pur=this._getPrevious(cid,'urina_daudzums',day), ph=this._getPrevious(cid,'uznemts_ml',day), pv=this._getPrevious(cid,'vedera_izeja',day);
      const when=(t&&t.time)?(t.date+' '+t.time):((latest['brokastis']||{}).date||day);
      html+='<tr><td>'+this.escapeHtml(name)+'</td><td>'+this.escapeHtml(when)+'</td>'+
        '<td>'+this.escapeHtml(this._val(t&&t.value))+'</td><td>'+this.escapeHtml(this._val(b&&b.value))+'</td><td>'+this.escapeHtml(this._val(l&&l.value))+'</td><td>'+this.escapeHtml(this._val(sn&&sn.value))+'</td><td>'+this.escapeHtml(this._val(d&&d.value))+'</td><td>'+this.escapeHtml(this._val(ur&&ur.value))+'</td><td>'+this.escapeHtml(this._val(h2o&&h2o.value))+'</td><td>'+this.escapeHtml(this._val(v&&v.value))+'</td>'+
        '<td><span class="'+this._dirClass(t,pt,'temperatura')+'">'+this._dirSymbol(t,pt,'temperatura')+'</span> T° · <span class="'+this._dirClass(b,pb,'brokastis')+'">'+this._dirSymbol(b,pb,'brokastis')+'</span> Br · <span class="'+this._dirClass(l,pl,'pusdienas')+'">'+this._dirSymbol(l,pl,'pusdienas')+'</span> P · <span class="'+this._dirClass(sn,ps,'launags')+'">'+this._dirSymbol(sn,ps,'launags')+'</span> L · <span class="'+this._dirClass(d,pd,'vakariņi')+'">'+this._dirSymbol(d,pd,'vakariņi')+'</span> V · <span class="'+this._dirClass(ur,pur,'urina_daudzums')+'">'+this._dirSymbol(ur,pur,'urina_daudzums')+'</span> U · <span class="'+this._dirClass(h2o,ph,'uznemts_ml')+'">'+this._dirSymbol(h2o,ph,'uznemts_ml')+'</span> H · <span class="'+this._dirClass(v,pv,'vedera_izeja')+'">'+this._dirSymbol(v,pv,'vedera_izeja')+'</span> Vz</td></tr>';
    });
    tbody.innerHTML = html || '<tr><td colspan="11" class="med-empty">Nav datu</td></tr>';
  }

  _hasFlagAttention(cid){
    const marks=this.allMarks||[];
    const now=Date.now();
    for(let i=marks.length-1;i>=0;i--){
      const m=marks[i]; const mcid=String(m.clientId||m.klients_id||'');
      if(mcid!==String(cid)) continue;
      const cat=String(m.category||m.kategorija||'').toLowerCase();
      const field=String(m.field||m.lauka_nosaukums||'').toLowerCase();
      if(cat==='pievienot'||field==='uzmaniba'){ const ts=m.lastModified||m.pedeja_laiks||m.created||m.eventTime||0; if(ts&&(now-ts)<7*24*3600*1000) return true; if(!ts) return true; }
    }
    return false;
  }

  _checkObjCrit(cid,day){
    const latest=this._getLatestByClient(cid,day);
    const t=latest['temperatura'], ur=latest['urina_daudzums'], h2o=latest['uznemts_ml'];
    const findings=[];
    const nT=t?num(t.value):NaN; if(!isNaN(nT)&&nT>=38.0) findings.push({sev:'crit',reason:'Temperatūra >= 38.0 °C',meta:(t.date||'')+(t.time?(' '+t.time):'')});
    const nU=ur?num(ur.value):NaN; if(!isNaN(nU)&&nU<400) findings.push({sev:'crit',reason:'Urīns 24h < 400 ml',meta:(ur.date||'')+(ur.time?(' '+ur.time):'')});
    const nH=h2o?num(h2o.value):NaN; if(!isNaN(nH)&&nH<800) findings.push({sev:'crit',reason:'H₂O 24h < 800 ml',meta:(h2o.date||'')+(h2o.time?(' '+h2o.time):'')});
    return findings;
  }

  renderAttention(){
    const box=document.getElementById('attentionList');
    if(!box) return;
    const dateEl=document.getElementById('dateFilter');
    const day=(dateEl&&dateEl.value)||this._today();
    const items=[];
    this.allClients.forEach(c=>{
      const cid=c.id||c.ID; const name=((c.vards||c.Vārds||'')+' '+(c.uzvards||c.Uzvārds||'')).trim();
      const flagged=this._hasFlagAttention(cid); const crit=this._checkObjCrit(cid,day);
      if(flagged||crit.length) items.push({cid,name,flagged,crit});
    });
    items.sort((a,b)=>a.name.localeCompare(b.name));
    if(!items.length){ box.innerHTML='<div class="med-empty">Nav klientu, kam nepieciešama uzmanība</div>'; return; }
    let html='';
    items.forEach(it=>{
      if(it.flagged){ html+='<div class="med-attn-item note"><div class="med-attn-header"><span>'+this.escapeHtml(it.name)+'</span><span>🟡 Manuāli atzīmēts</span></div><div class="med-attn-reason">Aprūpes lapā pievienota "Pievērst medicīnisko uzmanību" atzīme (aktīva ≤ 7 dienas)</div></div>'; }
      it.crit.forEach(x=>{ html+='<div class="med-attn-item crit"><div class="med-attn-header"><span>'+this.escapeHtml(it.name)+'</span><span>🔴 Objektīvs kritērijs</span></div><div class="med-attn-reason">'+this.escapeHtml(x.reason)+'</div>'+(x.meta?'<div class="med-attn-meta">'+this.escapeHtml(x.meta)+'</div>':'')+'</div>'; });
    });
    box.innerHTML=html;
  }

  _wireUi(){
    const search=document.getElementById('clientSearch');
    if(search) search.addEventListener('input',()=>this.renderAllTable());
    const date=document.getElementById('dateFilter');
    if(date){ date.value=this._today(); date.addEventListener('change',()=>{this.renderAllTable();this.renderAttention();}); }
    const off=document.getElementById('medOfflineBox');
    const hint=document.getElementById('medOnlineHint');
    const setNet=()=>{
      const online=navigator.onLine;
      if(off) off.style.display=online?'none':'block';
      if(hint) hint.style.display=online?'block':'none';
      if(hint&&online) hint.textContent='Skats ir tikai lasāms. Dati tiek ielādēti no Google Apps Script.';
    };
    setNet(); window.addEventListener('online',setNet); window.addEventListener('offline',setNet);
  }

  setupUI(){
    const logoutBtn=document.getElementById('logoutBtn');
    if(logoutBtn){
      logoutBtn.addEventListener('click',async(e)=>{
        e.preventDefault();
        if(window.Logout){ const pending=await (async()=>{ try{ if(window.careSync) return (await window.careSync.getUnsyncedItems()).length; }catch(err){} return 0; })(); const ok=await Logout.confirm({pending}); if(ok) Logout.performLogout(); }
        else { sessionStorage.removeItem('careUser'); window.location.href='index.html'; }
      });
    }
    const syncBtn=document.getElementById('manualSyncBtn');
    if(syncBtn){
      syncBtn.style.display=navigator.onLine?'inline-flex':'none';
      window.addEventListener('online',()=>{syncBtn.style.display='inline-flex';});
      window.addEventListener('offline',()=>{syncBtn.style.display='none';});
      syncBtn.addEventListener('click',async()=>{
        if(!navigator.onLine){ this._setStatus('Nav savienojuma'); return; }
        syncBtn.disabled=true; this._setStatus('Sinhronizē...');
        try{
          const result=await this.sync.forceFullSync((msg)=>this._setStatus(msg));
          if(result.offline){ this._setStatus('Sinhronizācija neizdevās'); }
          else { await this.loadData(); this.renderTabs(); this._setStatus(null); }
        }catch(err){ this._setStatus('Kļūda'); }
        finally { syncBtn.disabled=false; }
      });
    }
  }

  setupLanguageSwitcher(){
    document.querySelectorAll('.lang-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const lang=btn.dataset.lang;
        if(lang&&typeof setLang==='function'){ setLang(lang); document.querySelectorAll('.lang-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }
      });
    });
    if(typeof applyLanguage==='function') applyLanguage();
  }

  _setStatus(msg){
    let el=document.getElementById('medStatus');
    if(!el){ el=document.createElement('div'); el.id='medStatus'; document.body.appendChild(el); }
    if(msg){ el.textContent='🔄 '+msg; el.className='med-status on'; } else { el.className='med-status'; }
  }

  escapeHtml(text){
    return String(text===null||text===undefined?'':text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  render(){ this.renderTabs(); }
}

let medicineView;
document.addEventListener('DOMContentLoaded',()=>{ medicineView=new MedicineView(); });


