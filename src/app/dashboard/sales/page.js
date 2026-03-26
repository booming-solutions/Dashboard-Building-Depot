'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler);

const MN = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
const fmt = n => (n||0).toLocaleString('nl-NL',{minimumFractionDigits:0,maximumFractionDigits:0});
const fmtM = n => {const a=Math.abs(n||0);return(n<0?'-':'')+(a>=1e6?(a/1e6).toFixed(2)+'M':(a/1e3).toFixed(0)+'K')};
const fmtP = n => (n||0).toFixed(1)+'%';
const pctChange = (cur,prev) => prev?((cur-prev)/Math.abs(prev)*100):0;
const STORE_NAMES = {'1':'Curaçao','B':'Bonaire'};

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

export default function SalesDashboard(){
  const [data,setData]=useState([]);
  const [budgetData,setBudgetData]=useState([]);
  const [loading,setLoading]=useState(true);
  const [store,setStore]=useState('1');
  const [year,setYear]=useState(2026);
  const [month,setMonth]=useState('all');
  const [bum,setBum]=useState('all');
  const [budgetMode,setBudgetMode]=useState('target');
  const [dept,setDept]=useState('all');
  const [mgrMetric,setMgrMetric]=useState('sales');
  const [deptMetric,setDeptMetric]=useState('sales');
  const [search,setSearch]=useState('');
  const [sortCol,setSortCol]=useState('net_sales');
  const [sortDir,setSortDir]=useState('desc');
  const [tableRows,setTableRows]=useState(20);
  const monthlyRef=useRef(null);
  const gmRef=useRef(null);
  const mgrRef=useRef(null);
  const deptRef=useRef(null);
  const chartsRef=useRef({});
  const supabase=createClient();

  useEffect(()=>{loadData()},[]);

  async function loadData(){
    const [{data:sd},{data:bd}]=await Promise.all([
      supabase.from('sales_monthly').select('*').order('year').order('month').limit(15000),
      supabase.from('budget_data').select('*').limit(15000)
    ]);
    if(sd)setData(sd);
    if(bd)setBudgetData(bd);
    setLoading(false);
  }

  const currentYear=year;
  const priorYear=year-1;
  const isYTD=month==='ytd';
  const selectedMonth=month==='all'||month==='ytd'?null:parseInt(month);

  const maxDataMonth=useMemo(()=>{
    let max=0;
    data.forEach(r=>{if(r.year===currentYear&&r.month>max)max=r.month});
    return max;
  },[data,currentYear]);

  const filtered=useMemo(()=>data.filter(r=>{
    if(store!=='all'&&r.store_number!==store)return false;
    if(bum!=='all'&&r.bum!==bum)return false;
    if(dept!=='all'&&r.dept_code!==dept)return false;
    if(r.year!==currentYear)return false;
    if(selectedMonth&&r.month!==selectedMonth)return false;
    if(isYTD&&r.month>maxDataMonth)return false;
    return true;
  }),[data,store,currentYear,month,bum,dept,maxDataMonth,selectedMonth,isYTD]);

  const priorFiltered=useMemo(()=>data.filter(r=>{
    if(store!=='all'&&r.store_number!==store)return false;
    if(bum!=='all'&&r.bum!==bum)return false;
    if(dept!=='all'&&r.dept_code!==dept)return false;
    if(r.year!==priorYear)return false;
    if(selectedMonth&&r.month!==selectedMonth)return false;
    if(isYTD&&r.month>maxDataMonth)return false;
    return true;
  }),[data,store,priorYear,month,bum,dept,maxDataMonth,selectedMonth,isYTD]);

  const salesType=budgetMode==='target'?'target_sales':'cgf_sales';
  const marginType=budgetMode==='target'?'target_margin':'cgf_margin';

  const budgetFiltered=useMemo(()=>budgetData.filter(b=>{
    if(store!=='all'&&b.store_number!==store)return false;
    if(dept!=='all'&&b.dept_code!==dept)return false;
    const [by,bm]=b.month.split('-').map(Number);
    if(by!==currentYear)return false;
    if(selectedMonth&&bm!==selectedMonth)return false;
    if(isYTD&&bm>maxDataMonth)return false;
    return b.budget_type===salesType||b.budget_type===marginType;
  }),[budgetData,store,currentYear,month,dept,budgetMode,maxDataMonth,selectedMonth,isYTD,salesType,marginType]);

  const sum=(arr,key)=>arr.reduce((s,r)=>s+parseFloat(r[key]||0),0);
  const totalSales=sum(filtered,'net_sales');
  const totalGM=sum(filtered,'gross_margin');
  const gmPct=totalSales?totalGM/totalSales*100:0;
  const lySales=sum(priorFiltered,'net_sales');
  const lyGM=sum(priorFiltered,'gross_margin');
  const lyGmPct=lySales?lyGM/lySales*100:0;
  const budgetSales=sum(budgetFiltered.filter(b=>b.budget_type===salesType),'amount');
  const budgetMargin=sum(budgetFiltered.filter(b=>b.budget_type===marginType),'amount');
  const budgetGmPct=budgetSales?budgetMargin/budgetSales*100:0;

  const stores=useMemo(()=>[...new Set(data.map(r=>r.store_number))].sort(),[data]);
  const years=useMemo(()=>[...new Set(data.map(r=>r.year))].sort(),[data]);
  const bums=useMemo(()=>[...new Set(data.filter(r=>r.year===currentYear&&(store==='all'||r.store_number===store)).map(r=>r.bum))].sort(),[data,currentYear,store]);
  const depts=useMemo(()=>[...new Set(data.map(r=>r.dept_code+'|'+r.dept_name))].sort((a,b)=>parseInt(a)-parseInt(b)),[data]);

  const budgetLabel=budgetMode==='target'?'Target':'CGF';

  const renderCharts=useCallback(()=>{
    Object.values(chartsRef.current).forEach(c=>c?.destroy());
    chartsRef.current={};

    const curMonthly={};
    filtered.forEach(r=>{const mo=r.month-1;if(!curMonthly[mo])curMonthly[mo]={s:0,g:0};curMonthly[mo].s+=parseFloat(r.net_sales);curMonthly[mo].g+=parseFloat(r.gross_margin)});
    const lyMonthly={};
    priorFiltered.forEach(r=>{const mo=r.month-1;if(!lyMonthly[mo])lyMonthly[mo]={s:0,g:0};lyMonthly[mo].s+=parseFloat(r.net_sales);lyMonthly[mo].g+=parseFloat(r.gross_margin)});
    const budMonthly={};
    budgetFiltered.forEach(b=>{const mo=parseInt(b.month.split('-')[1])-1;if(!budMonthly[mo])budMonthly[mo]={s:0,g:0};if(b.budget_type===salesType)budMonthly[mo].s+=parseFloat(b.amount);if(b.budget_type===marginType)budMonthly[mo].g+=parseFloat(b.amount)});

    let allMonths=[];
    if(selectedMonth){allMonths=[selectedMonth-1]}
    else{
      const allKeys=new Set([...Object.keys(curMonthly),...Object.keys(lyMonthly),...Object.keys(budMonthly)].map(Number));
      allMonths=[...allKeys].sort((a,b)=>a-b);
      if(!allMonths.length)for(let i=0;i<12;i++)allMonths.push(i);
    }
    const labels=allMonths.map(i=>MN[i]);

    if(monthlyRef.current){
      chartsRef.current.monthly=new Chart(monthlyRef.current,{
        type:'bar',
        data:{labels,datasets:[
          {label:currentYear+' TY',data:allMonths.map(m=>curMonthly[m]?.s||0),backgroundColor:'rgba(232,78,27,0.25)',borderColor:'#E84E1B',borderWidth:1,borderRadius:4,order:2},
          {label:priorYear+' LY',data:allMonths.map(m=>lyMonthly[m]?.s||0),type:'line',borderColor:'#888',borderDash:[5,5],pointBackgroundColor:'#888',pointRadius:4,tension:0.3,fill:false,order:1},
          {label:budgetLabel+' Budget',data:allMonths.map(m=>budMonthly[m]?.s||0),type:'line',borderColor:'#d97706',borderDash:[3,3],pointBackgroundColor:'#d97706',pointRadius:4,tension:0.3,fill:false,order:0},
        ]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,pointStyle:'circle',padding:16,font:{size:11}}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.raw)} XCG`}}},scales:{y:{ticks:{callback:v=>fmt(v)},grid:{color:'#f0ebe5'}},x:{grid:{display:false}}}}
      });
    }

    if(gmRef.current){
      chartsRef.current.gm=new Chart(gmRef.current,{
        type:'line',
        data:{labels,datasets:[
          {label:currentYear+' TY',data:allMonths.map(m=>curMonthly[m]&&curMonthly[m].s?(curMonthly[m].g/curMonthly[m].s*100):null),borderColor:'#E84E1B',pointBackgroundColor:'#E84E1B',pointRadius:4,tension:0.3,fill:false},
          {label:priorYear+' LY',data:allMonths.map(m=>lyMonthly[m]&&lyMonthly[m].s?(lyMonthly[m].g/lyMonthly[m].s*100):null),borderColor:'#888',borderDash:[5,5],pointBackgroundColor:'#888',pointRadius:4,tension:0.3,fill:false},
          {label:budgetLabel+' Budget',data:allMonths.map(m=>budMonthly[m]&&budMonthly[m].s?(budMonthly[m].g/budMonthly[m].s*100):null),borderColor:'#d97706',borderDash:[3,3],pointBackgroundColor:'#d97706',pointRadius:4,tension:0.3,fill:false},
        ]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{usePointStyle:true,pointStyle:'circle',padding:16,font:{size:11}}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmtP(c.raw)}`}}},scales:{y:{ticks:{callback:v=>v+'%'},grid:{color:'#f0ebe5'}},x:{grid:{display:false}}}}
      });
    }

    const bumAgg={};
    filtered.forEach(r=>{if(!bumAgg[r.bum])bumAgg[r.bum]={s:0,g:0};bumAgg[r.bum].s+=parseFloat(r.net_sales);bumAgg[r.bum].g+=parseFloat(r.gross_margin)});
    const bumSorted=Object.entries(bumAgg).sort((a,b)=>b[1].s-a[1].s);
    const totalForPct=bumSorted.reduce((s,b)=>s+b[1].s,0);

    if(mgrRef.current&&bumSorted.length){
      const mgrData=mgrMetric==='sales'?bumSorted.map(b=>totalForPct?b[1].s/totalForPct*100:0):mgrMetric==='margin'?bumSorted.map(b=>b[1].g):bumSorted.map(b=>b[1].s?b[1].g/b[1].s*100:0);
      chartsRef.current.mgr=new Chart(mgrRef.current,{
        type:'bar',
        data:{labels:bumSorted.map(b=>b[0]),datasets:[{data:mgrData,backgroundColor:'rgba(232,78,27,0.3)',borderColor:'#E84E1B',borderWidth:1,borderRadius:4}]},
        options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>mgrMetric==='gm'||mgrMetric==='sales'?fmtP(c.raw):fmt(c.raw)+' XCG'}}},scales:{x:{ticks:{callback:v=>mgrMetric==='gm'||mgrMetric==='sales'?v+'%':fmtM(v)},grid:{color:'#f0ebe5'}},y:{grid:{display:false}}}}
      });
    }

    const deptAgg={};
    filtered.forEach(r=>{const name=r.dept_name;if(!deptAgg[name])deptAgg[name]={s:0,g:0};deptAgg[name].s+=parseFloat(r.net_sales);deptAgg[name].g+=parseFloat(r.gross_margin)});
    const deptSorted=Object.entries(deptAgg).sort((a,b)=>b[1].s-a[1].s).slice(0,15);

    if(deptRef.current&&deptSorted.length){
      const dData=deptMetric==='sales'?deptSorted.map(d=>d[1].s):deptMetric==='margin'?deptSorted.map(d=>d[1].g):deptSorted.map(d=>d[1].s?d[1].g/d[1].s*100:0);
      chartsRef.current.dept=new Chart(deptRef.current,{
        type:'bar',
        data:{labels:deptSorted.map(d=>{const n=d[0].replace(/^\d+\s/,'');return n.length>25?n.substring(0,22)+'...':n}),datasets:[{data:dData,backgroundColor:'rgba(232,78,27,0.3)',borderColor:'#E84E1B',borderWidth:1,borderRadius:4}]},
        options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>deptMetric==='gm'?fmtP(c.raw):fmt(c.raw)+' XCG'}}},scales:{x:{ticks:{callback:v=>deptMetric==='gm'?v+'%':fmtM(v)},grid:{color:'#f0ebe5'}},y:{grid:{display:false}}}}
      });
    }
  },[filtered,priorFiltered,budgetFiltered,currentYear,priorYear,budgetLabel,mgrMetric,deptMetric,selectedMonth,salesType,marginType]);

  useEffect(()=>{if(data.length)renderCharts()},[renderCharts,data.length]);

  const tableData=useMemo(()=>{
    const lyAgg={};
    priorFiltered.forEach(r=>{
      const key=`${r.month}-${r.dept_name}-${r.bum}`;
      if(!lyAgg[key])lyAgg[key]={net_sales:0};
      lyAgg[key].net_sales+=parseFloat(r.net_sales);
    });
    return filtered.map(r=>{
      const lyKey=`${r.month}-${r.dept_name}-${r.bum}`;
      const ly=lyAgg[lyKey]?.net_sales||0;
      const varPct=ly?((parseFloat(r.net_sales)-ly)/Math.abs(ly)*100):0;
      const gmPct=parseFloat(r.net_sales)?parseFloat(r.gross_margin)/parseFloat(r.net_sales)*100:0;
      return{year:r.year,month:r.month,dept:r.dept_name,bum:r.bum,net_sales:parseFloat(r.net_sales),gross_margin:parseFloat(r.gross_margin),ly,varPct,gmPct};
    }).filter(r=>!search||r.dept.toLowerCase().includes(search.toLowerCase())||r.bum.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>sortDir==='desc'?b[sortCol]-a[sortCol]:a[sortCol]-b[sortCol]);
  },[filtered,priorFiltered,search,sortCol,sortDir]);

  function toggleSort(col){if(sortCol===col)setSortDir(d=>d==='desc'?'asc':'desc');else{setSortCol(col);setSortDir('desc');}}

  if(loading)return<div className="flex items-center justify-center h-64"><p className="text-[#6b5240]">Dashboard laden...</p></div>;
  if(!data.length)return<div className="text-center py-16"><p className="text-[#6b5240]">Geen data beschikbaar.</p></div>;

  const storeName=store==='all'?'Alle':STORE_NAMES[store]||store;

  return(
    <div className="max-w-[1520px] mx-auto" style={{fontFamily:"'DM Sans',-apple-system,sans-serif",color:'#1a0a04'}}>
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 mb-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Logo" className="h-12 rounded-lg"/>
          <div>
            <h1 style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:'24px',fontWeight:900}}>Sales Performance Dashboard</h1>
            <p className="text-[13px] text-[#6b5240]">Building Depot Trading B.V.</p>
          </div>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{storeName} · XCG</div>
      </div>

      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Store</span>
          <div className="flex gap-1">{stores.map(s=><Pill key={s} label={STORE_NAMES[s]||s} active={store===s} onClick={()=>setStore(s)}/>)}</div>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-6">Jaar</span>
          <div className="flex gap-1">{years.map(y=><Pill key={y} label={y+' TY'} active={currentYear===y} onClick={()=>setYear(y)}/>)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Maand</span>
          <div className="flex gap-1 flex-wrap">
            <Pill label="Alle" active={month==='all'} onClick={()=>setMonth('all')}/>
            <Pill label="YTD" active={month==='ytd'} onClick={()=>setMonth('ytd')}/>
            {MN.map((m,i)=><Pill key={i} label={m} active={month===String(i+1)} onClick={()=>setMonth(String(i+1))}/>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Manager</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={bum==='all'} onClick={()=>setBum('all')}/>
            {bums.map(b=><Pill key={b} label={b} active={bum===b} onClick={()=>setBum(b)}/>)}
          </div>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-6">Budget</span>
          <div className="flex gap-1">
            <Pill label="Target (70M)" active={budgetMode==='target'} onClick={()=>setBudgetMode('target')}/>
            <Pill label="CGF (65M)" active={budgetMode==='cgf'} onClick={()=>setBudgetMode('cgf')}/>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Departement</span>
          <select value={dept} onChange={e=>setDept(e.target.value)} className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg">
            <option value="all">Alle Departementen</option>
            {depts.map(d=>{const[code,name]=d.split('|');return<option key={code} value={code}>{name}</option>})}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <KPI label="Netto Omzet" value={fmtM(totalSales)} ly={fmtM(lySales)} varLy={pctChange(totalSales,lySales)} budget={fmtM(budgetSales)} budgetLabel={budgetLabel} varBudget={pctChange(totalSales,budgetSales)}/>
        <KPI label="Bruto Marge" value={fmtM(totalGM)} ly={fmtM(lyGM)} varLy={pctChange(totalGM,lyGM)} budget={fmtM(budgetMargin)} budgetLabel={budgetLabel} varBudget={pctChange(totalGM,budgetMargin)}/>
        <KPI label="Bruto Marge %" value={fmtP(gmPct)} ly={fmtP(lyGmPct)} varLy={gmPct-lyGmPct} budget={fmtP(budgetGmPct)} budgetLabel={budgetLabel} varBudget={gmPct-budgetGmPct}/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4">Maandelijkse Omzet</h3>
          <div style={{height:'280px'}}><canvas ref={monthlyRef}/></div>
        </div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <h3 className="text-[15px] font-bold mb-4">Bruto Marge %</h3>
          <div style={{height:'280px'}}><canvas ref={gmRef}/></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[15px] font-bold">Manager Vergelijking</h3>
            <div className="flex gap-1">
              <Pill label="Omzet" active={mgrMetric==='sales'} onClick={()=>setMgrMetric('sales')}/>
              <Pill label="BM €" active={mgrMetric==='margin'} onClick={()=>setMgrMetric('margin')}/>
              <Pill label="BM %" active={mgrMetric==='gm'} onClick={()=>setMgrMetric('gm')}/>
            </div>
          </div>
          <div style={{height:'260px'}}><canvas ref={mgrRef}/></div>
        </div>
        <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-[15px] font-bold">Top 15 Departementen</h3>
            <div className="flex gap-1">
              <Pill label="Omzet" active={deptMetric==='sales'} onClick={()=>setDeptMetric('sales')}/>
              <Pill label="BM €" active={deptMetric==='margin'} onClick={()=>setDeptMetric('margin')}/>
              <Pill label="BM %" active={deptMetric==='gm'} onClick={()=>setDeptMetric('gm')}/>
            </div>
          </div>
          <div style={{height:'320px'}}><canvas ref={deptRef}/></div>
        </div>
      </div>

      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
          <h3 className="text-[15px] font-bold">Detail Tabel</h3>
          <div className="flex gap-2 items-center">
            <input className="bg-[#faf7f4] border border-[#e5ddd4] px-3 py-1.5 rounded-lg text-[13px] w-[180px]" placeholder="Zoeken..." value={search} onChange={e=>setSearch(e.target.value)}/>
            <select className="bg-[#faf7f4] border border-[#e5ddd4] px-2 py-1.5 rounded-lg text-[13px]" value={tableRows} onChange={e=>setTableRows(Number(e.target.value))}>
              <option value={20}>20 rijen</option><option value={50}>50 rijen</option><option value={100}>100 rijen</option><option value={9999}>Alle</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {[['Jaar','year'],['Mnd','month'],['Departement','dept'],['Manager','bum']].map(([l,k])=>(
                  <th key={k} className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] bg-white sticky top-0">{l}</th>
                ))}
                {[['Omzet (x1.000)','net_sales'],['LY (PR)','ly'],['Var %','varPct'],['BM (x1.000)','gross_margin'],['BM %','gmPct']].map(([l,k])=>(
                  <th key={k} onClick={()=>toggleSort(k)} className="text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] bg-white sticky top-0 cursor-pointer hover:text-[#E84E1B]">{l}{sortCol===k?(sortDir==='desc'?' ↓':' ↑'):''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.slice(0,tableRows).map((r,i)=>{
                const gmColor=r.gmPct>=35?'#16a34a':r.gmPct>=25?'#d97706':'#dc2626';
                return(
                  <tr key={i} className="hover:bg-[#faf5f0]">
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4]">{r.year}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4]">{MN[r.month-1]}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4]">{r.dept}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4]">{r.bum}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(r.net_sales/1000))}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(r.ly/1000))}</td>
                    <td className={`p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold ${r.varPct>=0?'text-green-600':'text-red-600'}`}>{r.varPct>=0?'+':''}{fmtP(r.varPct)}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{fmt(Math.round(r.gross_margin/1000))}</td>
                    <td className="p-2.5 border-b border-[#e5ddd4] text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-[8px] h-[8px] rounded-full" style={{backgroundColor:gmColor}}/>
                        <span className="font-mono text-[13px] font-semibold" style={{color:gmColor}}>{fmtP(r.gmPct)}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
