/* ============================================================
   BESTAND: page_sales.js
   KOPIEER NAAR: src/app/dashboard/sales/page.js
   (hernoem naar page.js bij het plaatsen)
   ============================================================ */
'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler);

const MN=['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
const fmt=n=>(n||0).toLocaleString('nl-NL',{minimumFractionDigits:0,maximumFractionDigits:0});
const fmtM=n=>{const a=Math.abs(n||0);return(n<0?'-':'')+(a>=1e6?(a/1e6).toFixed(2)+'M':(a/1e3).toFixed(0)+'K')};
const fmtP=n=>(n||0).toFixed(1)+'%';
const pctChg=(c,p)=>p?((c-p)/Math.abs(p)*100):0;
const SN={'1':'Curaçao','B':'Bonaire'};
const XCG_USD=1.82;

function Pill({label,active,onClick}){
  return <button className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ${active?"bg-[#E84E1B] text-white border-[#E84E1B]":"bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]"}`} onClick={onClick}>{label}</button>;
}

function KPI({label,value,ly,budget,budgetLabel,varLy,varBudget}){
  return(
    <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]"/>
      <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{label}</p>
      <p className="text-[36px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{value}</p>
      {ly!==undefined&&<p className="text-[13px] text-[#6b5240] font-mono mt-1">LY: {ly}</p>}
      {varLy!==undefined&&<span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono mt-1 ${varLy>=0?'bg-green-50 text-green-600':'bg-red-50 text-red-600'}`}>{varLy>=0?'+':''}{fmtP(varLy)}</span>}
      {budget!==undefined&&<p className="text-[13px] text-[#6b5240] font-mono mt-1">{budgetLabel}: {budget}</p>}
      {varBudget!==undefined&&<span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono mt-1 ${varBudget>=0?'bg-green-50 text-green-600':'bg-red-50 text-red-600'}`}>{varBudget>=0?'+':''}{fmtP(varBudget)}</span>}
    </div>
  );
}

function LogoMenu({show,onClose,onCGF,onCorrections,cgfUnlocked,corrVisible}){
  if(!show)return null;
  return(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute top-[80px] left-[28px] bg-white border border-[#e5ddd4] rounded-xl shadow-xl min-w-[220px] overflow-hidden" onClick={e=>e.stopPropagation()}>
        <button onClick={onCGF} className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-[#faf7f4] border-b border-[#e5ddd4]">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${cgfUnlocked?'bg-green-50 text-green-600':'bg-orange-50 text-[#E84E1B]'}`}>{cgfUnlocked?'✓':'🔒'}</div>
          <div><p className="text-[13px] font-semibold text-[#1a0a04]">CGF Access</p><p className="text-[11px] text-[#6b5240]">{cgfUnlocked?'Ontgrendeld':'Vergrendeld'}</p></div>
        </button>
        <button onClick={onCorrections} className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-[#faf7f4]">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${corrVisible?'bg-green-50 text-green-600':'bg-blue-50 text-blue-600'}`}>{corrVisible?'✓':'🔒'}</div>
          <div><p className="text-[13px] font-semibold text-[#1a0a04]">Data Source</p><p className="text-[11px] text-[#6b5240]">{corrVisible?'Zichtbaar':'Verborgen'}</p></div>
        </button>
      </div>
    </div>
  );
}

function CGFModal({show,onClose,onUnlock}){
  const[pw,setPw]=useState('');
  const[err,setErr]=useState(false);
  if(!show)return null;
  function tryUnlock(){if(pw==='CGF2026!'){onUnlock();onClose();setPw('')}else setErr(true)}
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:'rgba(0,0,0,0.4)'}}>
      <div className="bg-white rounded-2xl p-7 w-[340px] shadow-xl text-center" onClick={e=>e.stopPropagation()}>
        <h3 className="text-[16px] font-bold text-[#1a0a04] mb-1">CGF Access</h3>
        <p className="text-[13px] text-[#6b5240] mb-4">Voer het wachtwoord in om het CGF budget te ontgrendelen</p>
        <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr(false)}} onKeyDown={e=>e.key==='Enter'&&tryUnlock()} className="w-full px-4 py-2.5 rounded-lg border border-[#e5ddd4] text-center text-[14px] tracking-[2px] mb-2 focus:outline-none focus:border-[#E84E1B]" placeholder="Wachtwoord"/>
        {err&&<p className="text-[12px] text-red-500 mb-2">Onjuist wachtwoord</p>}
        <div className="flex gap-2 mt-3">
          <button onClick={()=>{onClose();setPw('');setErr(false)}} className="flex-1 py-2 rounded-lg bg-[#faf7f4] text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Annuleren</button>
          <button onClick={tryUnlock} className="flex-1 py-2 rounded-lg bg-[#E84E1B] text-white text-[13px] font-semibold">Ontgrendelen</button>
        </div>
      </div>
    </div>
  );
}

export default function SalesDashboard(){
  const[data,setData]=useState([]);
  const[budgetData,setBudgetData]=useState([]);
  const[corrections,setCorrections]=useState([]);
  const[lastDate,setLastDate]=useState(null);
  const[loading,setLoading]=useState(true);
  const[store,setStore]=useState('1');
  const[year,setYear]=useState(2026);
  const[months,setMonths]=useState([String(new Date().getMonth()+1)]);
  const[bum,setBum]=useState('all');
  const[budgetMode,setBudgetMode]=useState('target');
  const[dept,setDept]=useState('all');
  const[mgrMetric,setMgrMetric]=useState('sales');
  const[deptMetric,setDeptMetric]=useState('sales');
  const[search,setSearch]=useState('');
  const[sortCol,setSortCol]=useState('dept_code_num');
  const[sortDir,setSortDir]=useState('asc');
  const[tableRows,setTableRows]=useState(20);
  const[tab,setTab]=useState('dashboard');
  const[isLoggedIn,setIsLoggedIn]=useState(false);
  const[isAdmin,setIsAdmin]=useState(false);
  const[showCGFModal,setShowCGFModal]=useState(false);
  const[cgfUnlocked,setCgfUnlocked]=useState(false);
  const[corrVisible,setCorrVisible]=useState(false);
  // Listen for CGF toggle from sidebar admin menu
  useEffect(()=>{
    function onCGFToggle(){setCgfUnlocked(u=>{const nv=!u;if(!nv)setBudgetMode('target');return nv})}
    function onCorrToggle(){setCorrVisible(v=>{if(!v)setTab('correcties');return!v})}
    window.addEventListener('toggle-cgf',onCGFToggle);
    window.addEventListener('toggle-corrections',onCorrToggle);
    return()=>{window.removeEventListener('toggle-cgf',onCGFToggle);window.removeEventListener('toggle-corrections',onCorrToggle)}
  },[]);
  // CGF is only unlocked via the admin menu toggle, never automatically
  const[corrStore,setCorrStore]=useState('1');
  const[corrYear,setCorrYear]=useState(2026);
  const[corrMonth,setCorrMonth]=useState(1);
  const[corrDept,setCorrDept]=useState('');
  const[corrBum,setCorrBum]=useState('');
  const[corrType,setCorrType]=useState('Afrondingsverschil');
  const[corrSales,setCorrSales]=useState('');
  const[corrMargin,setCorrMargin]=useState('');
  const[corrNotes,setCorrNotes]=useState('');
  const monthlyRef=useRef(null);const gmRef=useRef(null);const mgrRef=useRef(null);const deptRef=useRef(null);const chartsRef=useRef({});
  const supabase=createClient();

  useEffect(()=>{loadData();checkAuth();},[]);

  async function loadData(){
    let allSales=[],allBudget=[],from=0;const step=1000;
    while(true){const{data:b}=await supabase.from('sales_monthly').select('*').order('year').order('month').range(from,from+step-1);if(!b||!b.length)break;allSales=allSales.concat(b);if(b.length<step)break;from+=step}
    from=0;while(true){const{data:b}=await supabase.from('budget_data').select('*').range(from,from+step-1);if(!b||!b.length)break;allBudget=allBudget.concat(b);if(b.length<step)break;from+=step}
    const{data:corr}=await supabase.from('corrections').select('*').order('created_at',{ascending:false});
    const{data:md}=await supabase.from('sales_data').select('sale_date').order('sale_date',{ascending:false}).limit(1);
    if(md&&md.length){const d=md[0].sale_date;const[y,m,day]=d.split('-').map(Number);setLastDate(new Date(y,m-1,day))}
    setData(allSales);setBudgetData(allBudget);if(corr)setCorrections(corr);setLoading(false);
  }
  async function checkAuth(){
    const{data:{user}}=await supabase.auth.getUser();
    setIsLoggedIn(!!user);
    if(user){
      const{data:prof}=await supabase.from('profiles').select('role').eq('id',user.id).maybeSingle();
      setIsAdmin(prof?.role==='admin');
    }

  }

  const currentYear=year,priorYear=year-1;
  const isYTD=months.includes('ytd'),isAll=months.includes('all');
  const selectedMonths=useMemo(()=>{if(isAll||isYTD)return null;return months.map(m=>parseInt(m)).filter(m=>!isNaN(m))},[months,isAll,isYTD]);
  const isBonaire=store==='B';const curr=isBonaire?'US$':'XCG';
  const conv=useCallback(v=>v,[isBonaire]);
  const fmtMC=useCallback(n=>fmtM(conv(n)),[conv]);

  const dayFrac=useMemo(()=>{
    if(!lastDate)return{month:0,frac:1};
    return{month:lastDate.getMonth()+1,frac:lastDate.getDate()/new Date(lastDate.getFullYear(),lastDate.getMonth()+1,0).getDate(),year:lastDate.getFullYear()};
  },[lastDate]);

  const maxDataMonth=useMemo(()=>{let m=0;data.forEach(r=>{if(r.year===currentYear&&r.month>m)m=r.month});return m},[data,currentYear]);

  function needsProrate(m){
    if(!dayFrac.month||dayFrac.frac>=0.99)return false;
    if(m!==dayFrac.month||dayFrac.year!==currentYear)return false;
    if(isYTD||isAll)return true;
    if(selectedMonths&&selectedMonths.includes(m))return true;
    return false;
  }
  function matchMonth(m){if(isAll)return true;if(isYTD)return m<=maxDataMonth;if(selectedMonths)return selectedMonths.includes(m);return true}

  const filtered=useMemo(()=>data.filter(r=>((store==='all'||r.store_number===store)&&(bum==='all'||r.bum===bum)&&(dept==='all'||r.dept_code===dept)&&r.year===currentYear&&matchMonth(r.month))),[data,store,currentYear,months,bum,dept,maxDataMonth]);
  const priorFiltered=useMemo(()=>data.filter(r=>((store==='all'||r.store_number===store)&&(bum==='all'||r.bum===bum)&&(dept==='all'||r.dept_code===dept)&&r.year===priorYear&&matchMonth(r.month))),[data,store,priorYear,months,bum,dept,maxDataMonth]);
  const salesType=budgetMode==='target'?'target_sales':'cgf_sales';
  const marginType=budgetMode==='target'?'target_margin':'cgf_margin';

  // Build dept_code → bum mapping from sales data so we can filter budget by BUM
  const deptBumMap=useMemo(()=>{const m={};data.forEach(r=>{if(r.dept_code&&r.bum)m[r.dept_code]=r.bum});return m},[data]);

  const budgetFiltered=useMemo(()=>budgetData.filter(b=>{if(store!=='all'&&b.store_number!==store)return false;if(dept!=='all'&&b.dept_code!==dept)return false;if(bum!=='all'&&deptBumMap[b.dept_code]!==bum)return false;const[by,bm]=b.month.split('-').map(Number);if(by!==currentYear||!matchMonth(bm))return false;return b.budget_type===salesType||b.budget_type===marginType}),[budgetData,store,currentYear,months,dept,bum,deptBumMap,budgetMode,maxDataMonth,salesType,marginType]);
  const corrFiltered=useMemo(()=>corrections.filter(c=>((store==='all'||c.store_number===store)&&(bum==='all'||c.bum===bum)&&(dept==='all'||c.dept_code===dept)&&c.year===currentYear&&matchMonth(c.month))),[corrections,store,currentYear,months,bum,dept,maxDataMonth]);

  const sum=(a,k)=>a.reduce((s,r)=>s+parseFloat(r[k]||0),0);
  const corrS=sum(corrFiltered,'sales_correction'),corrG=sum(corrFiltered,'margin_correction');

  function proAdj(lyArr,budArr){
    let lyS=sum(lyArr,'net_sales'),lyG=sum(lyArr,'gross_margin');
    let bS=sum(budArr.filter(b=>b.budget_type===salesType),'amount'),bG=sum(budArr.filter(b=>b.budget_type===marginType),'amount');
    if(dayFrac.month){
      lyArr.filter(r=>needsProrate(r.month)).forEach(r=>{lyS-=parseFloat(r.net_sales)*(1-dayFrac.frac);lyG-=parseFloat(r.gross_margin)*(1-dayFrac.frac)});
      budArr.filter(b=>needsProrate(parseInt(b.month.split('-')[1]))).forEach(b=>{if(b.budget_type===salesType)bS-=parseFloat(b.amount)*(1-dayFrac.frac);if(b.budget_type===marginType)bG-=parseFloat(b.amount)*(1-dayFrac.frac)});
    }
    return{lyS,lyG,bS,bG};
  }

  const tS=sum(filtered,'net_sales')+corrS,tG=sum(filtered,'gross_margin')+corrG,tGP=tS?tG/tS*100:0;
  const adj=proAdj(priorFiltered,budgetFiltered);
  const lyS=adj.lyS,lyG=adj.lyG,lyGP=lyS?lyG/lyS*100:0;
  const bS=adj.bS,bG=adj.bG,bGP=bS?bG/bS*100:0;

  const stores=useMemo(()=>[...new Set(data.map(r=>r.store_number))].sort(),[data]);
  const years=useMemo(()=>[...new Set(data.map(r=>r.year))].sort(),[data]);
  const bums=useMemo(()=>[...new Set(data.filter(r=>r.year===currentYear&&(store==='all'||r.store_number===store)&&r.bum!=='OTHER').map(r=>r.bum))].sort(),[data,currentYear,store]);
  const depts=useMemo(()=>[...new Set(data.map(r=>r.dept_code+'|'+r.dept_name))].sort((a,b)=>{const na=parseInt(a),nb=parseInt(b);if(isNaN(na)&&isNaN(nb))return a.localeCompare(b);if(isNaN(na))return 1;if(isNaN(nb))return -1;return na-nb}),[data]);
  const budgetLabel=budgetMode==='target'?'Target':'CGF';

  function handleMonthClick(m,e){if(m==='all'||m==='ytd'){setMonths([m]);return}if(e&&e.ctrlKey){setMonths(prev=>{const c=prev.filter(x=>x!=='all'&&x!=='ytd');if(c.includes(m))return c.filter(x=>x!==m).length?c.filter(x=>x!==m):['all'];return[...c,m]})}else setMonths([m])}

  const renderCharts=useCallback(()=>{
    Object.values(chartsRef.current).forEach(c=>c?.destroy());chartsRef.current={};
    const cM={},lM={},bM={};
    filtered.forEach(r=>{const m=r.month-1;if(!cM[m])cM[m]={s:0,g:0};cM[m].s+=parseFloat(r.net_sales);cM[m].g+=parseFloat(r.gross_margin)});
    corrFiltered.forEach(c=>{const m=c.month-1;if(!cM[m])cM[m]={s:0,g:0};cM[m].s+=parseFloat(c.sales_correction);cM[m].g+=parseFloat(c.margin_correction)});
    priorFiltered.forEach(r=>{const m=r.month-1;if(!lM[m])lM[m]={s:0,g:0};lM[m].s+=parseFloat(r.net_sales);lM[m].g+=parseFloat(r.gross_margin)});
    budgetFiltered.forEach(b=>{const m=parseInt(b.month.split('-')[1])-1;if(!bM[m])bM[m]={s:0,g:0};if(b.budget_type===salesType)bM[m].s+=parseFloat(b.amount);if(b.budget_type===marginType)bM[m].g+=parseFloat(b.amount)});
    for(let i=0;i<12;i++){if(needsProrate(i+1)){if(lM[i]){lM[i].s*=dayFrac.frac;lM[i].g*=dayFrac.frac}if(bM[i]){bM[i].s*=dayFrac.frac;bM[i].g*=dayFrac.frac}}}
    let aM=[];if(selectedMonths&&selectedMonths.length)aM=selectedMonths.map(m=>m-1).sort((a,b)=>a-b);else{const k=new Set([...Object.keys(cM),...Object.keys(lM),...Object.keys(bM)].map(Number));aM=[...k].sort((a,b)=>a-b);if(!aM.length)for(let i=0;i<12;i++)aM.push(i)}
    const lb=aM.map(i=>MN[i]);
    const allV=[...aM.map(m=>conv(cM[m]?.s||0)),...aM.map(m=>conv(lM[m]?.s||0)),...aM.map(m=>conv(bM[m]?.s||0))].filter(v=>v>0);
    const mn=allV.length?Math.min(...allV):0;
    const yMin=Math.max(0,Math.floor((mn-500000)/500000)*500000);

    if(monthlyRef.current){chartsRef.current.monthly=new Chart(monthlyRef.current,{type:'bar',data:{labels:lb,datasets:[{label:currentYear+' TY',data:aM.map(m=>conv(cM[m]?.s||0)),backgroundColor:'rgba(232,78,27,0.25)',borderColor:'#E84E1B',borderWidth:1,borderRadius:4,order:2},{label:priorYear+' LY',data:aM.map(m=>conv(lM[m]?.s||0)),type:'line',borderColor:'#888',borderDash:[5,5],pointBackgroundColor:'#888',pointRadius:4,tension:0.3,fill:false,order:1},{label:budgetLabel+' Budget',data:aM.map(m=>conv(bM[m]?.s||0)),type:'line',borderColor:'#d97706',borderDash:[3,3],pointBackgroundColor:'#d97706',pointRadius:4,tension:0.3,fill:false,order:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,pointStyle:'circle',padding:16,font:{size:11}}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.raw)} ${curr}`}}},scales:{y:{min:yMin,ticks:{callback:v=>fmtM(v)},grid:{color:'#f0ebe5'}},x:{grid:{display:false}}}}})}
    if(gmRef.current){chartsRef.current.gm=new Chart(gmRef.current,{type:'line',data:{labels:lb,datasets:[{label:currentYear+' TY',data:aM.map(m=>cM[m]&&cM[m].s?(cM[m].g/cM[m].s*100):null),borderColor:'#E84E1B',pointBackgroundColor:'#E84E1B',pointRadius:4,tension:0.3,fill:false},{label:priorYear+' LY',data:aM.map(m=>lM[m]&&lM[m].s?(lM[m].g/lM[m].s*100):null),borderColor:'#888',borderDash:[5,5],pointBackgroundColor:'#888',pointRadius:4,tension:0.3,fill:false},{label:budgetLabel+' Budget',data:aM.map(m=>bM[m]&&bM[m].s?(bM[m].g/bM[m].s*100):null),borderColor:'#d97706',borderDash:[3,3],pointBackgroundColor:'#d97706',pointRadius:4,tension:0.3,fill:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,pointStyle:'circle',padding:16,font:{size:11}}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmtP(c.raw)}`}}},scales:{y:{ticks:{callback:v=>v+'%'},grid:{color:'#f0ebe5'}},x:{grid:{display:false}}}}})}
    const bumA={};filtered.forEach(r=>{if(!bumA[r.bum])bumA[r.bum]={s:0,g:0};bumA[r.bum].s+=parseFloat(r.net_sales);bumA[r.bum].g+=parseFloat(r.gross_margin)});const bumS=Object.entries(bumA).sort((a,b)=>b[1].s-a[1].s);const tP=bumS.reduce((s,b)=>s+b[1].s,0);
    if(mgrRef.current&&bumS.length){const md2=mgrMetric==='sales'?bumS.map(b=>tP?b[1].s/tP*100:0):mgrMetric==='margin'?bumS.map(b=>conv(b[1].g)):bumS.map(b=>b[1].s?b[1].g/b[1].s*100:0);chartsRef.current.mgr=new Chart(mgrRef.current,{type:'bar',data:{labels:bumS.map(b=>b[0]),datasets:[{data:md2,backgroundColor:'rgba(232,78,27,0.3)',borderColor:'#E84E1B',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>mgrMetric==='gm'||mgrMetric==='sales'?fmtP(c.raw):fmt(c.raw)+' '+curr}}},scales:{x:{ticks:{callback:v=>mgrMetric==='gm'||mgrMetric==='sales'?v+'%':fmtM(v)},grid:{color:'#f0ebe5'}},y:{grid:{display:false}}}}})}
    const dA={};filtered.forEach(r=>{const n=r.dept_name;if(!dA[n])dA[n]={s:0,g:0};dA[n].s+=parseFloat(r.net_sales);dA[n].g+=parseFloat(r.gross_margin)});const dSrt=Object.entries(dA).sort((a,b)=>b[1].s-a[1].s).slice(0,15);
    if(deptRef.current&&dSrt.length){const dd2=deptMetric==='sales'?dSrt.map(d=>conv(d[1].s)):deptMetric==='margin'?dSrt.map(d=>conv(d[1].g)):dSrt.map(d=>d[1].s?d[1].g/d[1].s*100:0);chartsRef.current.dept=new Chart(deptRef.current,{type:'bar',data:{labels:dSrt.map(d=>{const n=d[0].replace(/^\d+\s/,'');return n.length>25?n.substring(0,22)+'...':n}),datasets:[{data:dd2,backgroundColor:'rgba(232,78,27,0.3)',borderColor:'#E84E1B',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>deptMetric==='gm'?fmtP(c.raw):fmt(c.raw)+' '+curr}}},scales:{x:{ticks:{callback:v=>deptMetric==='gm'?v+'%':fmtM(v)},grid:{color:'#f0ebe5'}},y:{grid:{display:false}}}}})}
  },[filtered,priorFiltered,budgetFiltered,corrFiltered,currentYear,priorYear,budgetLabel,mgrMetric,deptMetric,selectedMonths,salesType,marginType,dayFrac,conv,curr]);

  useEffect(()=>{if(data.length&&tab==='dashboard')renderCharts()},[renderCharts,data.length,tab]);

  const tableData=useMemo(()=>{
    const agg={};filtered.forEach(r=>{const k=`${r.dept_name}-${r.bum}`;if(!agg[k])agg[k]={dept:r.dept_name,bum:r.bum,net_sales:0,gross_margin:0,dept_code:r.dept_code};agg[k].net_sales+=parseFloat(r.net_sales);agg[k].gross_margin+=parseFloat(r.gross_margin)});
    corrFiltered.forEach(c=>{const k=`${c.dept_name}-${c.bum}`;if(!agg[k])agg[k]={dept:c.dept_name,bum:c.bum,net_sales:0,gross_margin:0,dept_code:c.dept_code};agg[k].net_sales+=parseFloat(c.sales_correction);agg[k].gross_margin+=parseFloat(c.margin_correction)});
    const lyA={};priorFiltered.forEach(r=>{const k=`${r.dept_name}-${r.bum}`;if(!lyA[k])lyA[k]={s:0,g:0};lyA[k].s+=parseFloat(r.net_sales);lyA[k].g+=parseFloat(r.gross_margin)});
    const bA={};budgetFiltered.forEach(b=>{const k=b.dept_code;if(!bA[k])bA[k]={s:0,g:0};if(b.budget_type===salesType)bA[k].s+=parseFloat(b.amount);if(b.budget_type===marginType)bA[k].g+=parseFloat(b.amount)});
    return Object.values(agg).map(r=>{
      const lk=`${r.dept}-${r.bum}`;let lS=lyA[lk]?.s||0,lG=lyA[lk]?.g||0;
      if(dayFrac.month){priorFiltered.filter(p=>p.dept_name===r.dept&&p.bum===r.bum&&needsProrate(p.month)).forEach(p=>{lS-=parseFloat(p.net_sales)*(1-dayFrac.frac);lG-=parseFloat(p.gross_margin)*(1-dayFrac.frac)})}
      let bd={...bA[r.dept_code]||{s:0,g:0}};
      if(dayFrac.month){budgetFiltered.filter(b=>b.dept_code===r.dept_code&&needsProrate(parseInt(b.month.split('-')[1]))).forEach(b=>{if(b.budget_type===salesType)bd.s-=parseFloat(b.amount)*(1-dayFrac.frac);if(b.budget_type===marginType)bd.g-=parseFloat(b.amount)*(1-dayFrac.frac)})}
      return{...r,dept_code_num:parseInt(r.dept_code)||999,ly:conv(lS),varPct:lS?((r.net_sales-lS)/Math.abs(lS)*100):0,gmPct:r.net_sales?r.gross_margin/r.net_sales*100:0,net_sales_conv:conv(r.net_sales),gm_conv:conv(r.gross_margin),budMargin:conv(bd.g),budGmPct:bd.s?bd.g/bd.s*100:0};
    }).filter(r=>!search||r.dept.toLowerCase().includes(search.toLowerCase())||r.bum.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>{
      // Always sort 'Other' (dept_code OT) to bottom
      if(a.dept_code==='OT'&&b.dept_code!=='OT')return 1;
      if(b.dept_code==='OT'&&a.dept_code!=='OT')return -1;
      return sortDir==='desc'?(b[sortCol]||0)-(a[sortCol]||0):(a[sortCol]||0)-(b[sortCol]||0);
    });
  },[filtered,priorFiltered,budgetFiltered,corrFiltered,search,sortCol,sortDir,dayFrac,conv,salesType,marginType]);

  function toggleSort(c2){if(sortCol===c2)setSortDir(d=>d==='desc'?'asc':'desc');else{setSortCol(c2);setSortDir('desc')}}

  async function addCorrection(){
    if(!corrDept||!corrBum)return;
    const dn=(depts.find(d=>d.startsWith(corrDept+'|'))||'').split('|')[1]||'';
    await supabase.from('corrections').insert({store_number:corrStore,year:corrYear,month:corrMonth,dept_code:corrDept,dept_name:dn,bum:corrBum,correction_type:corrType,sales_correction:parseFloat(corrSales)||0,margin_correction:parseFloat(corrMargin)||0,notes:corrNotes});
    setCorrSales('');setCorrMargin('');setCorrNotes('');
    const{data:c2}=await supabase.from('corrections').select('*').order('created_at',{ascending:false});if(c2)setCorrections(c2);
  }
  async function deleteCorrection(id){await supabase.from('corrections').delete().eq('id',id);setCorrections(p=>p.filter(c=>c.id!==id))}
  async function clearAll(){if(!confirm('Weet je zeker dat je alle correcties wilt wissen?'))return;await supabase.from('corrections').delete().neq('id','00000000-0000-0000-0000-000000000000');setCorrections([])}

  if(loading)return(
    <div className="flex flex-col items-center justify-center h-[60vh] gap-6">
      <style>{`
        @keyframes logoPulse { 0%, 100% { opacity: 1; filter: brightness(1); } 50% { opacity: 0.3; filter: brightness(2); } }
        @keyframes barGrow { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 100%; } }
      `}</style>
      <img src="/logo.png" alt="Loading" className="h-16 w-16 rounded-xl" style={{ animation: 'logoPulse 2s ease-in-out infinite' }} />
      <div className="w-48 h-1.5 bg-[#e5ddd4] rounded-full overflow-hidden">
        <div className="h-full bg-[#E84E1B] rounded-full" style={{ animation: 'barGrow 2s ease-in-out infinite' }}></div>
      </div>
      <p className="text-[13px] text-[#6b5240]">Dashboard laden...</p>
    </div>
  );
  if(!data.length)return<div className="text-center py-16"><p className="text-[#6b5240]">Geen data beschikbaar.</p></div>;
  const storeName=store==='all'?'Alle':SN[store]||store;
  const currLabel=isBonaire?`${storeName} · US$`:`${storeName} · XCG`;

  return(
    <div className="max-w-[1520px] mx-auto" style={{fontFamily:"'DM Sans',-apple-system,sans-serif",color:'#1a0a04'}}>
      <CGFModal show={showCGFModal} onClose={()=>setShowCGFModal(false)} onUnlock={()=>{setCgfUnlocked(true);setBudgetMode('cgf')}}/>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:'22px',fontWeight:900}}>Omzet en Marge</h1>
          <p className="text-[13px] text-[#6b5240]">Building Depot{lastDate?` — data t/m ${lastDate.getDate()} ${MN[lastDate.getMonth()]} ${lastDate.getFullYear()}`:''}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{currLabel}</div>
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b-2 border-[#e5ddd4]">
        <button onClick={()=>setTab('dashboard')} className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] ${tab==='dashboard'?'text-[#E84E1B] border-[#E84E1B]':'text-[#6b5240] border-transparent'}`}>Dashboard</button>
        {corrVisible&&isAdmin&&<button onClick={()=>setTab('correcties')} className={`px-5 py-2.5 text-[13px] font-semibold border-b-[2.5px] -mb-[2px] ${tab==='correcties'?'text-[#E84E1B] border-[#E84E1B]':'text-[#6b5240] border-transparent'}`}>Data Source</button>}
      </div>

      {tab==='dashboard'&&<>
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3"><span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Store</span><div className="flex gap-1">{stores.map(s=><Pill key={s} label={SN[s]||s} active={store===s} onClick={()=>setStore(s)}/>)}</div><span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-6">Jaar</span><div className="flex gap-1">{years.map(y=><Pill key={y} label={y+' TY'} active={currentYear===y} onClick={()=>setYear(y)}/>)}</div></div>
        <div className="flex flex-wrap items-center gap-3"><span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Maand</span><div className="flex gap-1 flex-wrap"><Pill label="Alle" active={months.includes('all')} onClick={()=>setMonths(['all'])}/><Pill label="YTD" active={months.includes('ytd')} onClick={()=>setMonths(['ytd'])}/>{MN.map((m,i)=><Pill key={i} label={m} active={months.includes(String(i+1))} onClick={e=>handleMonthClick(String(i+1),e)}/>)}</div><span className="text-[10px] text-[#a08a74] ml-2">Ctrl+klik voor meerdere</span></div>
        <div className="flex flex-wrap items-center gap-3"><span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Manager</span><div className="flex gap-1"><Pill label="Alle" active={bum==='all'} onClick={()=>setBum('all')}/>{bums.map(b=><Pill key={b} label={b} active={bum===b} onClick={()=>setBum(b)}/>)}</div><span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-6">Budget</span><div className="flex gap-1"><Pill label="Target (70M)" active={budgetMode==='target'} onClick={()=>setBudgetMode('target')}/>{cgfUnlocked&&<Pill label="CGF (65M)" active={budgetMode==='cgf'} onClick={()=>setBudgetMode('cgf')}/>}</div></div>
        <div className="flex flex-wrap items-center gap-3"><span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Departement</span><select value={dept} onChange={e=>setDept(e.target.value)} className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg"><option value="all">Alle Departementen</option>{depts.map(d=>{const[c2,n]=d.split('|');return<option key={c2} value={c2}>{n}</option>})}</select></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <KPI label="Netto Omzet" value={fmtMC(tS)} ly={fmtMC(lyS)} varLy={pctChg(tS,lyS)} budget={fmtMC(bS)} budgetLabel={budgetLabel} varBudget={pctChg(tS,bS)}/>
        <KPI label="Bruto Marge" value={fmtMC(tG)} ly={fmtMC(lyG)} varLy={pctChg(tG,lyG)} budget={fmtMC(bG)} budgetLabel={budgetLabel} varBudget={pctChg(tG,bG)}/>
        <KPI label="Bruto Marge %" value={fmtP(tGP)} ly={fmtP(lyGP)} varLy={tGP-lyGP} budget={fmtP(bGP)} budgetLabel={budgetLabel} varBudget={tGP-bGP}/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm"><h3 className="text-[15px] font-bold mb-4">Maandelijkse Omzet</h3><div style={{height:'280px'}}><canvas ref={monthlyRef}/></div></div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm"><h3 className="text-[15px] font-bold mb-4">Bruto Marge %</h3><div style={{height:'280px'}}><canvas ref={gmRef}/></div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm"><div className="flex justify-between items-center mb-4"><h3 className="text-[15px] font-bold">Manager Vergelijking</h3><div className="flex gap-1"><Pill label="Omzet" active={mgrMetric==='sales'} onClick={()=>setMgrMetric('sales')}/><Pill label="BM €" active={mgrMetric==='margin'} onClick={()=>setMgrMetric('margin')}/><Pill label="BM %" active={mgrMetric==='gm'} onClick={()=>setMgrMetric('gm')}/></div></div><div style={{height:'260px'}}><canvas ref={mgrRef}/></div></div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm"><div className="flex justify-between items-center mb-4"><h3 className="text-[15px] font-bold">Top 15 Departementen</h3><div className="flex gap-1"><Pill label="Omzet" active={deptMetric==='sales'} onClick={()=>setDeptMetric('sales')}/><Pill label="BM €" active={deptMetric==='margin'} onClick={()=>setDeptMetric('margin')}/><Pill label="BM %" active={deptMetric==='gm'} onClick={()=>setDeptMetric('gm')}/></div></div><div style={{height:'320px'}}><canvas ref={deptRef}/></div></div>
      </div>

      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-3"><h3 className="text-[15px] font-bold">Detail Tabel</h3><div className="flex gap-2 items-center"><input className="bg-[#faf7f4] border border-[#e5ddd4] px-3 py-1.5 rounded-lg text-[13px] w-[180px]" placeholder="Zoeken..." value={search} onChange={e=>setSearch(e.target.value)}/><select className="bg-[#faf7f4] border border-[#e5ddd4] px-2 py-1.5 rounded-lg text-[13px]" value={tableRows} onChange={e=>setTableRows(Number(e.target.value))}><option value={20}>20 rijen</option><option value={50}>50 rijen</option><option value={100}>100 rijen</option><option value={9999}>Alle</option></select></div></div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full border-collapse"><thead><tr>
            {[['Departement','dept'],['Manager','bum']].map(([l,k])=><th key={k} className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] bg-white sticky top-0">{l}</th>)}
            {[['Omzet','net_sales_conv'],['LY','ly'],['Var %','varPct'],['BM','gm_conv'],['Bud BM','budMargin'],['BM %','gmPct'],['Bud BM %','budGmPct']].map(([l,k])=><th key={k} onClick={()=>toggleSort(k)} className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] bg-white sticky top-0 cursor-pointer hover:text-[#E84E1B] whitespace-nowrap">{l}{sortCol===k?(sortDir==='desc'?' ↓':' ↑'):''}</th>)}
          </tr></thead><tbody>
            {(function(){const tSales=tableData.reduce((s,r)=>s+r.net_sales_conv,0);const tLY=tableData.reduce((s,r)=>s+r.ly,0);const tGM=tableData.reduce((s,r)=>s+r.gm_conv,0);const tBudGM=tableData.reduce((s,r)=>s+r.budMargin,0);const tVarPct=tLY?((tSales-tLY)/Math.abs(tLY)*100):0;const tGmPct=tSales?tGM/tSales*100:0;const tBudGmPct=tSales?tBudGM/tSales*100:0;const tgc=tGmPct>=35?'#16a34a':tGmPct>=25?'#d97706':'#dc2626';const tbc=tBudGmPct>=35?'#16a34a':tBudGmPct>=25?'#d97706':'#dc2626';return(
              <tr className="bg-[#faf7f4] font-bold">
                <td className="p-2.5 text-[13px] border-b-2 border-[#c5bfb3]">TOTAAL</td>
                <td className="p-2.5 text-[13px] border-b-2 border-[#c5bfb3]"></td>
                <td className="p-2.5 text-[13px] border-b-2 border-[#c5bfb3] text-right font-mono">{fmt(Math.round(tSales/1000))}</td>
                <td className="p-2.5 text-[13px] border-b-2 border-[#c5bfb3] text-right font-mono">{fmt(Math.round(tLY/1000))}</td>
                <td className="p-2.5 text-[13px] border-b-2 border-[#c5bfb3] text-right font-mono font-semibold" style={{color:tVarPct>=0?'#16a34a':'#dc2626'}}>{tVarPct>=0?'+':''}{fmtP(tVarPct)}</td>
                <td className="p-2.5 text-[13px] border-b-2 border-[#c5bfb3] text-right font-mono">{fmt(Math.round(tGM/1000))}</td>
                <td className="p-2.5 text-[13px] border-b-2 border-[#c5bfb3] text-right font-mono">{fmt(Math.round(tBudGM/1000))}</td>
                <td className="p-2.5 border-b-2 border-[#c5bfb3] text-right"><div className="flex items-center justify-end gap-2"><div className="w-[8px] h-[8px] rounded-full" style={{backgroundColor:tgc}}/><span className="font-mono text-[13px] font-semibold" style={{color:tgc}}>{fmtP(tGmPct)}</span></div></td>
                <td className="p-2.5 border-b-2 border-[#c5bfb3] text-right"><span className="font-mono text-[13px]" style={{color:tbc}}>{fmtP(tBudGmPct)}</span></td>
              </tr>)})()}
            {tableData.slice(0,tableRows).map((r,i)=>{const gc=r.gmPct>=35?'#16a34a':r.gmPct>=25?'#d97706':'#dc2626';const bc=r.budGmPct>=35?'#16a34a':r.budGmPct>=25?'#d97706':'#dc2626';const isOther=r.dept_code==='OT';const rowStyle=isOther?{color:'#b0a090',fontStyle:'italic'}:{};return(
              <tr key={i} className="hover:bg-[#faf5f0]" style={isOther?{backgroundColor:'#f9f7f5'}:{}}>
                <td className="p-2.5 text-[13px] border-b border-[#e5ddd4]" style={rowStyle}>{r.dept}{isOther?' (FA/FB/FC/FF/XX)':''}</td>
                <td className="p-2.5 text-[13px] border-b border-[#e5ddd4]" style={rowStyle}>{r.bum}</td>
                <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={rowStyle}>{fmt(Math.round(r.net_sales_conv/1000))}</td>
                <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={rowStyle}>{fmt(Math.round(r.ly/1000))}</td>
                <td className={`p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold`} style={isOther?rowStyle:{color:r.varPct>=0?'#16a34a':'#dc2626'}}>{r.varPct>=0?'+':''}{fmtP(r.varPct)}</td>
                <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={rowStyle}>{fmt(Math.round(r.gm_conv/1000))}</td>
                <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={rowStyle}>{fmt(Math.round(r.budMargin/1000))}</td>
                <td className="p-2.5 border-b border-[#e5ddd4] text-right">{isOther?<span className="font-mono text-[13px]" style={rowStyle}>{fmtP(r.gmPct)}</span>:<div className="flex items-center justify-end gap-2"><div className="w-[8px] h-[8px] rounded-full" style={{backgroundColor:gc}}/><span className="font-mono text-[13px] font-semibold" style={{color:gc}}>{fmtP(r.gmPct)}</span></div>}</td>
                <td className="p-2.5 border-b border-[#e5ddd4] text-right"><span className="font-mono text-[13px]" style={isOther?rowStyle:{color:bc}}>{fmtP(r.budGmPct)}</span></td>
              </tr>)})}
          </tbody></table>
        </div>
      </div>
      </>}

      {tab==='correcties'&&<div className="bg-white rounded-[14px] border border-[#e5ddd4] p-6 shadow-sm mb-5">
        <h3 className="text-[16px] font-bold mb-1">Handmatige Correcties Invoeren</h3>
        <p className="text-[13px] text-[#6b5240] mb-5">Voer hier afrondingsverschillen, ontbrekende boekingen of andere handmatige correcties in. Deze worden automatisch verwerkt in alle dashboard cijfers en blijven bewaard bij refresh.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
          <div><label className="text-[10px] text-[#6b5240] font-bold uppercase">Winkel</label><select value={corrStore} onChange={e=>setCorrStore(e.target.value)} className="w-full mt-1 px-2 py-2 border border-[#e5ddd4] rounded-lg text-[13px]">{stores.map(s=><option key={s} value={s}>{SN[s]}</option>)}</select></div>
          <div><label className="text-[10px] text-[#6b5240] font-bold uppercase">Jaar</label><select value={corrYear} onChange={e=>setCorrYear(parseInt(e.target.value))} className="w-full mt-1 px-2 py-2 border border-[#e5ddd4] rounded-lg text-[13px]">{years.map(y=><option key={y} value={y}>{y}</option>)}</select></div>
          <div><label className="text-[10px] text-[#6b5240] font-bold uppercase">Maand</label><select value={corrMonth} onChange={e=>setCorrMonth(parseInt(e.target.value))} className="w-full mt-1 px-2 py-2 border border-[#e5ddd4] rounded-lg text-[13px]">{MN.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></div>
          <div><label className="text-[10px] text-[#6b5240] font-bold uppercase">Departement</label><select value={corrDept} onChange={e=>setCorrDept(e.target.value)} className="w-full mt-1 px-2 py-2 border border-[#e5ddd4] rounded-lg text-[13px]"><option value="">Kies...</option>{depts.map(d=>{const[c2,n]=d.split('|');return<option key={c2} value={c2}>{n}</option>})}</select></div>
          <div><label className="text-[10px] text-[#6b5240] font-bold uppercase">Manager</label><select value={corrBum} onChange={e=>setCorrBum(e.target.value)} className="w-full mt-1 px-2 py-2 border border-[#e5ddd4] rounded-lg text-[13px]"><option value="">Kies...</option>{bums.map(b=><option key={b} value={b}>{b}</option>)}</select></div>
          <div><label className="text-[10px] text-[#6b5240] font-bold uppercase">Type</label><select value={corrType} onChange={e=>setCorrType(e.target.value)} className="w-full mt-1 px-2 py-2 border border-[#e5ddd4] rounded-lg text-[13px]"><option>Afrondingsverschil</option><option>Ontbrekende boeking</option><option>Handmatige correctie</option><option>Overig</option></select></div>
          <div><label className="text-[10px] text-[#6b5240] font-bold uppercase">Omzet correctie (±)</label><input value={corrSales} onChange={e=>setCorrSales(e.target.value)} className="w-full mt-1 px-2 py-2 border border-[#e5ddd4] rounded-lg text-[13px]" placeholder="bv. -1500 of 2300"/></div>
          <div><label className="text-[10px] text-[#6b5240] font-bold uppercase">Marge correctie (±)</label><input value={corrMargin} onChange={e=>setCorrMargin(e.target.value)} className="w-full mt-1 px-2 py-2 border border-[#e5ddd4] rounded-lg text-[13px]" placeholder="bv. -500 of 800"/></div>
        </div>
        <div className="mb-4"><label className="text-[10px] text-[#6b5240] font-bold uppercase">Toelichting</label><textarea value={corrNotes} onChange={e=>setCorrNotes(e.target.value)} className="w-full mt-1 px-3 py-2 border border-[#e5ddd4] rounded-lg text-[13px] h-[60px]" placeholder="Korte omschrijving van de correctie..."/></div>
        <div className="flex gap-3">
          <button onClick={addCorrection} className="px-5 py-2 rounded-lg bg-[#E84E1B] text-white text-[13px] font-semibold">+ Correctie Toevoegen</button>
          <button onClick={clearAll} className="px-5 py-2 rounded-lg bg-white text-[#6b5240] text-[13px] font-semibold border border-[#e5ddd4]">Alles Wissen</button>
          <button onClick={()=>{const csv=['Winkel,Jaar,Maand,Dept,Manager,Type,Omzet,Marge,Toelichting',...corrections.map(c=>`${SN[c.store_number]||c.store_number},${c.year},${MN[c.month-1]},${c.dept_name},${c.bum},${c.correction_type},${c.sales_correction},${c.margin_correction},"${c.notes||''}"`)].join('\n');const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='correcties.csv';a.click()}} className="px-5 py-2 rounded-lg bg-white text-[#E84E1B] text-[13px] font-semibold border border-[#E84E1B]">Exporteer CSV</button>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6 mb-6">
          <div className="bg-[#faf7f4] rounded-xl p-4"><p className="text-[10px] text-[#6b5240] font-bold uppercase">Totaal correcties</p><p className="text-[20px] font-bold font-mono mt-1">{corrections.length}</p></div>
          <div className="bg-[#faf7f4] rounded-xl p-4"><p className="text-[10px] text-[#6b5240] font-bold uppercase">Omzet impact</p><p className={`text-[20px] font-bold font-mono mt-1 ${sum(corrections,'sales_correction')>=0?'text-green-600':'text-red-600'}`}>{sum(corrections,'sales_correction')>=0?'+':''}{fmt(sum(corrections,'sales_correction'))}</p></div>
          <div className="bg-[#faf7f4] rounded-xl p-4"><p className="text-[10px] text-[#6b5240] font-bold uppercase">Marge impact</p><p className={`text-[20px] font-bold font-mono mt-1 ${sum(corrections,'margin_correction')>=0?'text-green-600':'text-red-600'}`}>{sum(corrections,'margin_correction')>=0?'+':''}{fmt(sum(corrections,'margin_correction'))}</p></div>
        </div>

        {corrections.length>0&&<div className="overflow-x-auto"><table className="w-full border-collapse"><thead><tr>
          {['Winkel','Jaar','Mnd','Departement','Manager','Type','Omzet','Marge','Toelichting',''].map((h,i)=><th key={i} className="text-left p-2.5 text-[10px] text-[#6b5240] font-bold uppercase border-b-2 border-[#e5ddd4]">{h}</th>)}
        </tr></thead><tbody>
          {corrections.map(c=><tr key={c.id} className="hover:bg-[#faf5f0]">
            <td className="p-2 text-[13px] border-b border-[#e5ddd4]">{SN[c.store_number]||c.store_number}</td>
            <td className="p-2 text-[13px] border-b border-[#e5ddd4]">{c.year}</td>
            <td className="p-2 text-[13px] border-b border-[#e5ddd4]">{MN[c.month-1]}</td>
            <td className="p-2 text-[13px] border-b border-[#e5ddd4]">{c.dept_name}</td>
            <td className="p-2 text-[13px] border-b border-[#e5ddd4]">{c.bum}</td>
            <td className="p-2 text-[13px] border-b border-[#e5ddd4]">{c.correction_type}</td>
            <td className={`p-2 text-[13px] border-b border-[#e5ddd4] font-mono ${parseFloat(c.sales_correction)>=0?'text-green-600':'text-red-600'}`}>{parseFloat(c.sales_correction)>=0?'+':''}{fmt(c.sales_correction)}</td>
            <td className={`p-2 text-[13px] border-b border-[#e5ddd4] font-mono ${parseFloat(c.margin_correction)>=0?'text-green-600':'text-red-600'}`}>{parseFloat(c.margin_correction)>=0?'+':''}{fmt(c.margin_correction)}</td>
            <td className="p-2 text-[13px] border-b border-[#e5ddd4] text-[#6b5240]">{c.notes}</td>
            <td className="p-2 border-b border-[#e5ddd4]"><button onClick={()=>deleteCorrection(c.id)} className="text-red-400 hover:text-red-600 text-[12px]">✕</button></td>
          </tr>)}
        </tbody></table></div>}
      </div>}
    </div>
  );
}
