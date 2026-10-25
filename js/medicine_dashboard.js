// Medicine Dashboard - integrated with MedicineView
(function(){
  'use strict';

  let dashView = null;

  function init(){
    // Wait for medicineView if available
    if(window.medicineView){
      dashView = window.medicineView;
      setup();
      return;
    }
    // Try to create minimal instance
    try {
      if(typeof MedicineView === 'function'){
        // don't auto-init full UI if not needed
      }
    } catch(e){}
    setTimeout(init, 200);
  }

  function setup(){
    const dateEl = document.getElementById('mhDateFilter');
    if(dateEl && !dateEl.value){
      if(dashView && typeof dashView._today === 'function') dateEl.value = dashView._today();
      else {
        const d=new Date(); dateEl.value = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      }
    }
    const refresh = document.getElementById('mhDashRefresh');
    if(refresh){
      refresh.onclick = async ()=>{
        if(dashView && typeof dashView.loadData === 'function') await dashView.loadData();
        render();
      };
    }
    const cat = document.getElementById('mhDashCategory');
    if(cat){ cat.onchange = render; }
    if(dateEl){ dateEl.onchange = render; }
    document.getElementById('mhDashDetailClose').onclick = ()=>{
      document.getElementById('mhDashDetailPanel').classList.remove('active');
    };
    document.getElementById('mhDashDetailPanel').onclick = (e)=>{
      if(e.target.id === 'mhDashDetailPanel') document.getElementById('mhDashDetailPanel').classList.remove('active');
    };
    render();
  }

  function render(){
    if(!dashView){ setTimeout(render,300); return; }
    const day = document.getElementById('mhDateFilter').value || (dashView._today ? dashView._today() : '');
    const cat = document.getElementById('mhDashCategory').value || 'all';
    
    // Ensure data loaded
    if((!dashView.allClients || dashView.allClients.length===0) && typeof dashView.loadData === 'function'){
      dashView.loadData().then(render).catch(()=>{});
      return;
    }
    
    const clients = dashView.allClients || [];
    const filtered = clients.slice();
    const tbody = document.getElementById('mhDashTableBody');
    const alerts = document.getElementById('mhDashAlerts');
    const countEl = document.getElementById('mhDashCount');
    tbody.innerHTML = '';
    alerts.innerHTML = '';
    
    let crit=0, warn=0, ok=0, total=0;
    const rows = [];
    filtered.forEach(c=>{
      const cid = String(c.id||c.ID);
      const name = dashView._clientName ? dashView._clientName(c) : ((c.vards||'')+' '+(c.uzvards||'')).trim();
      const latest = typeof dashView._getLatestByClient === 'function' ? dashView._getLatestByClient(cid, day) : {};
      const items = typeof dashView._getItemsOnDate === 'function' ? dashView._getItemsOnDate(cid, day) : [];
      const status = typeof dashView._clientStatusOnDate === 'function' ? dashView._clientStatusOnDate(cid, day) : 'none';
      const attn = typeof dashView._clientAttentionOnDate === 'function' ? dashView._clientAttentionOnDate(cid, day) : false;
      
      // Category filter
      if(cat !== 'all'){
        const fields = (cat==='temp'?['temperatura']: cat==='food'?['brokastis','pusdienas','launags','vakariņi']: cat==='fluid'?['urina_daudzums','uznemts_ml']: ['vedera_izeja']);
        let has=false;
        fields.forEach(f=>{ if(latest[f]) has=true; });
        if(!has) return;
      }
      total++;
      if(status==='crit') crit++;
      else if(attn || status==='ok') { if(attn) warn++; else ok++; }
      else ok++;
      
      const getLast = (f)=>{ const it=latest[f]; return it ? (it.value + (it.time? ' '+it.time:'')) : '–'; };
      const temp = getLast('temperatura');
      const foodParts=[];
      ['brokastis','pusdienas','launags','vakariņi'].forEach(f=>{ if(latest[f]) foodParts.push(latest[f].value); });
      const foodStr = foodParts.length? foodParts.join(' / '): '–';
      const fluidStr = (latest['urina_daudzums']? latest['urina_daudzums'].value+' ml':'–') + ' / ' + (latest['uznemts_ml']? latest['uznemts_ml'].value+' ml':'–');
      const phys = latest['vedera_izeja'] ? latest['vedera_izeja'].value : '–';
      const lastItem = items.length ? items[items.length-1] : null;
      const lastStr = lastItem ? (lastItem.date + (lastItem.time?' '+lastItem.time:'')) : '–';
      
      let statusBadge = '<span class="mh-badge mh-badge-ok">Normāli</span>';
      if(status==='crit') statusBadge = '<span class="mh-badge mh-badge-crit">Kritiski</span>';
      else if(attn) statusBadge = '<span class="mh-badge mh-badge-warn">Uzmanība</span>';
      
      let alertsStr = [];
      if(status==='crit') alertsStr.push('Kritiski rādītāji');
      if(attn) alertsStr.push('Manuāli atzīmēts');
      if(!alertsStr.length) alertsStr.push('-');
      
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>'+dashView.escapeHtml(name)+'</td><td>'+dashView.escapeHtml(temp)+'</td><td>'+dashView.escapeHtml(foodStr)+'</td><td>'+dashView.escapeHtml(fluidStr)+'</td><td>'+dashView.escapeHtml(phys)+'</td><td>'+statusBadge+'</td><td>'+alertsStr.join(', ')+'</td><td><span class="mh-trend-flat">—</span></td><td>'+dashView.escapeHtml(lastStr)+'</td>';
      tr.style.cursor='pointer';
      tr.onclick = ()=> openDetail(cid, name, day, items, latest);
      tbody.appendChild(tr);
      rows.push({cid,name,crit:status==='crit',attn});
    });
    
    if(countEl) countEl.textContent = total + ' klienti';
    document.getElementById('kpiCritVal').textContent = crit;
    document.getElementById('kpiWarnVal').textContent = warn;
    document.getElementById('kpiOkVal').textContent = ok;
    document.getElementById('kpiTotalVal').textContent = total;
    
    // Alerts
    rows.filter(r=>r.crit||r.attn).slice(0,50).forEach(r=>{
      const div = document.createElement('div');
      div.className = 'mh-attn-item ' + (r.crit?'mh-attn-crit':'mh-attn-warn');
      div.innerHTML = '<span class="mh-attn-dot">'+(r.crit?'🔴':'🟡')+'</span><span class="mh-attn-name">'+dashView.escapeHtml(r.name)+'</span><span class="mh-attn-reason">'+(r.crit?'Kritiski rādītāji':'Uzmanība')+'</span>';
      div.style.cursor='pointer';
      div.onclick = ()=> openDetail(r.cid, r.name, day, typeof dashView._getItemsOnDate==='function'?dashView._getItemsOnDate(r.cid,day):[], typeof dashView._getLatestByClient==='function'?dashView._getLatestByClient(r.cid,day):{});
      alerts.appendChild(div);
    });
    if(!alerts.children.length){
      alerts.innerHTML = '<div class="mh-empty">Nav aktuālu brīdinājumu</div>';
    }
  }

  function openDetail(cid,name,day,items,latest){
    document.getElementById('mhDashDetailTitle').textContent = name;
    document.getElementById('mhDashDetailMeta').textContent = 'Klients ID: '+cid+' | Datums: '+day;
    const cont = document.getElementById('mhDashDetailContent');
    cont.innerHTML = '';
    const tbl = document.createElement('table');
    tbl.className = 'mh-table';
    tbl.innerHTML = '<thead><tr><th>Laiks</th><th>Lauks</th><th>Kategorija</th><th>Vērtība</th></tr></thead>';
    const tb = document.createElement('tbody');
    if(items && items.length){
      items.slice().reverse().forEach(it=>{
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>'+dashView.escapeHtml(it.time||'')+'</td><td>'+dashView.escapeHtml(it.field||'')+'</td><td>'+dashView.escapeHtml(it.raw && (it.raw.category||it.raw.kategorija) || '')+'</td><td>'+dashView.escapeHtml(it.value||'')+'</td>';
        tb.appendChild(tr);
      });
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4" class="mh-empty">Nav ierakstu šajā dienā</td>';
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    cont.appendChild(tbl);
    document.getElementById('mhDashDetailPanel').classList.add('active');
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
