/* ============================================================
   BESTAND: page.js (sales / Forecast (concept))
   KOPIEER NAAR: src/app/dashboard/sales/forecast/page.js
   (deze map bestaat nog niet, moet aangemaakt worden)

   Aparte Forecast pagina met:
   - Maand-forecast (Run rate, Verkooppatroon LY, Budget status)
   - Catch-up tabel
   - FY forecast
   - Visualisatie chart
   ============================================================ */
'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import LoadingLogo from '@/components/LoadingLogo';
import { Chart, CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler } from 'chart.js';

Chart.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, BarController, LineController, Tooltip, Legend, Filler);

const MN=['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
const fmt=n=>(n||0).toLocaleString('nl-NL',{minimumFractionDigits:0,maximumFractionDigits:0});
const fmtM=n=>{const a=Math.abs(n||0);return(n<0?'-':'')+(a>=1e6?(a/1e6).toFixed(2)+'M':(a/1e3).toFixed(0)+'K')};
const fmtP=n=>(n||0).toFixed(1)+'%';
const pctChg=(c,p)=>p?((c-p)/Math.abs(p)*100):0;
const SN={'1':'Curaçao','B':'Bonaire'};
const daysInMonth=(y,m)=>new Date(y,m,0).getDate();

function Pill({label,active,onClick}){
  return <button className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ${active?"bg-[#E84E1B] text-white border-[#E84E1B]":"bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]"}`} onClick={onClick}>{label}</button>;
}

function ForecastKPI({label,forecast,sublabel,subvalue,compareLabel,comparePct,compareLabel2,comparePct2,note}){
  return(
    <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-[#E84E1B]"/>
      <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{label}</p>
      <p className="text-[32px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{forecast}</p>
      {sublabel&&<p className="text-[12px] text-[#6b5240] font-mono mt-1">{sublabel}: {subvalue}</p>}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {comparePct!==undefined&&comparePct!==null&&<span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold font-mono ${comparePct>=0?'bg-green-50 text-green-600':'bg-red-50 text-red-600'}`}>{compareLabel}: {comparePct>=0?'+':''}{fmtP(comparePct)}</span>}
        {comparePct2!==undefined&&comparePct2!==null&&<span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold font-mono ${comparePct2>=0?'bg-green-50 text-green-600':'bg-red-50 text-red-600'}`}>{compareLabel2}: {comparePct2>=0?'+':''}{fmtP(comparePct2)}</span>}
      </div>
      {note&&<p className="text-[10px] text-[#a08a74] italic mt-2">{note}</p>}
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

export default function ForecastPage(){
  const[data,setData]=useState([]);
  const[dailyData,setDailyData]=useState([]);
  const[budgetData,setBudgetData]=useState([]);
  const[corrections,setCorrections]=useState([]);
  const[lastDate,setLastDate]=useState(null);
  const[loading,setLoading]=useState(true);
  const[store,setStore]=useState('1');
  const[bum,setBum]=useState('all');
  const[budgetMode,setBudgetMode]=useState('target');
  const[dept,setDept]=useState('all');
  const[showCGFModal,setShowCGFModal]=useState(false);
  const[cgfUnlocked,setCgfUnlocked]=useState(false);
  useEffect(()=>{
    function onCGFToggle(){setCgfUnlocked(u=>{const nv=!u;if(!nv)setBudgetMode('target');return nv})}
    window.addEventListener('toggle-cgf',onCGFToggle);
    return()=>window.removeEventListener('toggle-cgf',onCGFToggle);
  },[]);

  const forecastChartRef=useRef(null);
  const chartsRef=useRef({});
  const supabase=createClient();

  useEffect(()=>{loadData();},[]);

  async function loadData(){
    let allSales=[],allBudget=[],allDaily=[],from=0;const step=1000;
    while(true){const{data:b}=await supabase.from('sales_monthly').select('*').order('year').order('month').range(from,from+step-1);if(!b||!b.length)break;allSales=allSales.concat(b);if(b.length<step)break;from+=step}
    from=0;while(true){const{data:b}=await supabase.from('budget_data').select('*').range(from,from+step-1);if(!b||!b.length)break;allBudget=allBudget.concat(b);if(b.length<step)break;from+=step}
    from=0;while(true){const{data:b}=await supabase.from('sales_daily').select('*').range(from,from+step-1);if(!b||!b.length)break;allDaily=allDaily.concat(b);if(b.length<step)break;from+=step}
    const{data:corr}=await supabase.from('corrections').select('*').order('created_at',{ascending:false});
    const{data:md}=await supabase.from('sales_data').select('sale_date').order('sale_date',{ascending:false}).limit(1);
    if(md&&md.length){const d=md[0].sale_date;const[y,m,day]=d.split('-').map(Number);setLastDate(new Date(y,m-1,day))}
    setData(allSales);setDailyData(allDaily);setBudgetData(allBudget);if(corr)setCorrections(corr);setLoading(false);
  }

  const isBonaire=store==='B';const curr=isBonaire?'US$':'XCG';
  const conv=useCallback(v=>v,[isBonaire]);
  const fmtMC=useCallback(n=>fmtM(conv(n)),[conv]);
  const salesType=budgetMode==='target'?'target_sales':'cgf_sales';
  const budgetLabel=budgetMode==='target'?'Target':'CGF';

  const dayFrac=useMemo(()=>{
    if(!lastDate)return{month:0,frac:1};
    return{month:lastDate.getMonth()+1,frac:lastDate.getDate()/new Date(lastDate.getFullYear(),lastDate.getMonth()+1,0).getDate(),year:lastDate.getFullYear(),day:lastDate.getDate()};
  },[lastDate]);

  const stores=useMemo(()=>[...new Set(data.map(r=>r.store_number))].sort(),[data]);
  const bums=useMemo(()=>[...new Set(data.filter(r=>r.year===2026&&(store==='all'||r.store_number===store)&&r.bum!=='OTHER').map(r=>r.bum))].sort(),[data,store]);
  const depts=useMemo(()=>[...new Set(data.map(r=>r.dept_code+'|'+r.dept_name))].sort((a,b)=>{const na=parseInt(a),nb=parseInt(b);if(isNaN(na)&&isNaN(nb))return a.localeCompare(b);if(isNaN(na))return 1;if(isNaN(nb))return -1;return na-nb}),[data]);
  const deptBumMap=useMemo(()=>{const m={};data.forEach(r=>{if(r.dept_code&&r.bum)m[r.dept_code]=r.bum});return m},[data]);

  const sum=(a,k)=>a.reduce((s,r)=>s+parseFloat(r[k]||0),0);

  // ============================================================
  // FORECAST BEREKENINGEN
  // ============================================================
  const forecastData=useMemo(()=>{
    if(!lastDate||!data.length)return null;
    const curMonth=dayFrac.month;
    const curYear=dayFrac.year;
    const lyYear=curYear-1;
    const dayOfMonth=dayFrac.day;
    const totalDaysInMonth=daysInMonth(curYear,curMonth);
    const remainingDaysMonth=totalDaysInMonth-dayOfMonth;

    const matchFilter=r=>(store==='all'||r.store_number===store)&&(bum==='all'||r.bum===bum)&&(dept==='all'||r.dept_code===dept);
    const matchBudget=b=>{
      if(store!=='all'&&b.store_number!==store)return false;
      if(dept!=='all'&&b.dept_code!==dept)return false;
      if(bum!=='all'&&deptBumMap[b.dept_code]!==bum)return false;
      return true;
    };
    const matchCorr=c=>(store==='all'||c.store_number===store)&&(bum==='all'||c.bum===bum)&&(dept==='all'||c.dept_code===dept);

    const mtdRows=data.filter(r=>matchFilter(r)&&r.year===curYear&&r.month===curMonth);
    let mtdSales=sum(mtdRows,'net_sales');
    const mtdCorrSales=sum(corrections.filter(c=>matchCorr(c)&&c.year===curYear&&c.month===curMonth),'sales_correction');
    mtdSales+=mtdCorrSales;

    const lyMonthRows=data.filter(r=>matchFilter(r)&&r.year===lyYear&&r.month===curMonth);
    const lyMonthSales=sum(lyMonthRows,'net_sales');

    // Echte daily LY pacing uit sales_daily
    const lyDailyRows=dailyData.filter(r=>matchFilter(r)&&r.year===lyYear&&r.month===curMonth);
    const lyDailySum=sum(lyDailyRows,'net_sales');
    const lyDailyToDay=dailyData.filter(r=>matchFilter(r)&&r.year===lyYear&&r.month===curMonth&&r.day<=dayOfMonth);
    const lyMTDSales=sum(lyDailyToDay,'net_sales');
    let lyPacingPct=lyDailySum>0?(lyMTDSales/lyDailySum):(dayOfMonth/totalDaysInMonth);
    if(lyPacingPct<=0.01||lyPacingPct>1)lyPacingPct=dayOfMonth/totalDaysInMonth;

    const monthBudgetRows=budgetData.filter(b=>{
      if(!matchBudget(b))return false;
      const[by,bm]=b.month.split('-').map(Number);
      return by===curYear&&bm===curMonth&&b.budget_type===salesType;
    });
    const monthBudgetSales=sum(monthBudgetRows,'amount');

    const runRateForecast=dayOfMonth>0?(mtdSales/dayOfMonth)*totalDaysInMonth:0;
    const lyPacingForecast=lyPacingPct>0?(mtdSales/lyPacingPct):0;
    const expectedBudgetMTD=monthBudgetSales*lyPacingPct;
    const budgetVarPct=expectedBudgetMTD?((mtdSales-expectedBudgetMTD)/expectedBudgetMTD*100):0;
    const budgetPaceForecast=expectedBudgetMTD?monthBudgetSales*(mtdSales/expectedBudgetMTD):monthBudgetSales;

    const dailyAvg=dayOfMonth>0?mtdSales/dayOfMonth:0;
    const requiredDailyForBudget=remainingDaysMonth>0?(monthBudgetSales-mtdSales)/remainingDaysMonth:0;
    const requiredDailyForLY=remainingDaysMonth>0?(lyMonthSales-mtdSales)/remainingDaysMonth:0;

    // YTD
    const ytdRows=data.filter(r=>matchFilter(r)&&r.year===curYear&&r.month<=curMonth);
    let ytdSales=sum(ytdRows,'net_sales');
    const ytdCorrSales=sum(corrections.filter(c=>matchCorr(c)&&c.year===curYear&&c.month<=curMonth),'sales_correction');
    ytdSales+=ytdCorrSales;

    const lyYTDFullRows=data.filter(r=>matchFilter(r)&&r.year===lyYear&&r.month<curMonth);
    const lyYTDFull=sum(lyYTDFullRows,'net_sales');
    const lyYTD=lyYTDFull+lyMTDSales;

    const lyFullYearRows=data.filter(r=>matchFilter(r)&&r.year===lyYear);
    const lyFullYear=sum(lyFullYearRows,'net_sales');

    const fyBudgetRows=budgetData.filter(b=>{
      if(!matchBudget(b))return false;
      const[by]=b.month.split('-').map(Number);
      return by===curYear&&b.budget_type===salesType;
    });
    const fyBudget=sum(fyBudgetRows,'amount');

    const dayOfYear=Math.floor((lastDate-new Date(curYear,0,0))/(1000*60*60*24));
    const totalDaysInYear=daysInMonth(curYear,2)===29?366:365;
    const fyRunRateForecast=dayOfYear>0?(ytdSales/dayOfYear)*totalDaysInYear:0;
    const fyLyPacingPct=lyFullYear?(lyYTD/lyFullYear):(dayOfYear/totalDaysInYear);
    const fyLyPacingForecast=fyLyPacingPct>0?(ytdSales/fyLyPacingPct):0;
    const fyExpectedBudgetYTD=fyBudget*fyLyPacingPct;
    const fyBudgetVarPct=fyExpectedBudgetYTD?((ytdSales-fyExpectedBudgetYTD)/fyExpectedBudgetYTD*100):0;
    const fyBudgetPaceForecast=fyExpectedBudgetYTD?fyBudget*(ytdSales/fyExpectedBudgetYTD):fyBudget;

    const monthlyActuals=Array(12).fill(0);
    const monthlyLY=Array(12).fill(0);
    const monthlyBudget=Array(12).fill(0);
    const monthlyForecast=Array(12).fill(null);

    data.filter(r=>matchFilter(r)&&r.year===curYear).forEach(r=>{monthlyActuals[r.month-1]+=parseFloat(r.net_sales)});
    corrections.filter(c=>matchCorr(c)&&c.year===curYear).forEach(c=>{monthlyActuals[c.month-1]+=parseFloat(c.sales_correction)});
    data.filter(r=>matchFilter(r)&&r.year===lyYear).forEach(r=>{monthlyLY[r.month-1]+=parseFloat(r.net_sales)});
    budgetData.filter(b=>{if(!matchBudget(b))return false;const[by]=b.month.split('-').map(Number);return by===curYear&&b.budget_type===salesType}).forEach(b=>{const[,bm]=b.month.split('-').map(Number);monthlyBudget[bm-1]+=parseFloat(b.amount)});

    const growthFactor=lyYTD>0?(ytdSales/lyYTD):1;
    monthlyForecast[curMonth-1]=lyPacingForecast;
    for(let m=curMonth;m<12;m++){
      monthlyForecast[m]=monthlyLY[m]*growthFactor;
    }

    return{
      curMonth,curYear,dayOfMonth,totalDaysInMonth,remainingDaysMonth,
      mtdSales,lyMonthSales,lyMTDSales,monthBudgetSales,
      runRateForecast,lyPacingForecast,budgetPaceForecast,
      lyPacingPct,expectedBudgetMTD,budgetVarPct,
      dailyAvg,requiredDailyForBudget,requiredDailyForLY,
      ytdSales,lyYTD,lyFullYear,fyBudget,
      fyRunRateForecast,fyLyPacingForecast,fyBudgetPaceForecast,
      fyExpectedBudgetYTD,fyBudgetVarPct,fyLyPacingPct,
      monthlyActuals,monthlyLY,monthlyBudget,monthlyForecast,
      growthFactor,dayOfYear,totalDaysInYear
    };
  },[data,dailyData,budgetData,corrections,lastDate,dayFrac,store,bum,dept,deptBumMap,salesType]);

  const renderForecastChart=useCallback(()=>{
    if(!forecastChartRef.current||!forecastData)return;
    if(chartsRef.current.forecast)chartsRef.current.forecast.destroy();
    const fd=forecastData;
    const labels=MN;
    const actualsSeries=fd.monthlyActuals.map((v,i)=>i<=fd.curMonth-1?conv(v):null);
    const forecastSeries=fd.monthlyForecast.map((v,i)=>i>=fd.curMonth-1?(v?conv(v):null):null);
    const lySeries=fd.monthlyLY.map(v=>conv(v));
    const budgetSeries=fd.monthlyBudget.map(v=>conv(v));
    chartsRef.current.forecast=new Chart(forecastChartRef.current,{
      type:'bar',
      data:{
        labels,
        datasets:[
          {label:fd.curYear+' Actual',data:actualsSeries,backgroundColor:'rgba(232,78,27,0.55)',borderColor:'#E84E1B',borderWidth:1,borderRadius:4,order:3},
          {label:fd.curYear+' Forecast',data:forecastSeries,backgroundColor:'rgba(232,78,27,0.18)',borderColor:'#E84E1B',borderWidth:1,borderDash:[4,4],borderRadius:4,order:2},
          {label:'LY '+(fd.curYear-1),data:lySeries,type:'line',borderColor:'#888',borderDash:[5,5],pointBackgroundColor:'#888',pointRadius:3,tension:0.3,fill:false,order:1},
          {label:budgetLabel+' Budget',data:budgetSeries,type:'line',borderColor:'#d97706',borderDash:[3,3],pointBackgroundColor:'#d97706',pointRadius:3,tension:0.3,fill:false,order:0}
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{position:'top',labels:{usePointStyle:true,pointStyle:'circle',padding:16,font:{size:11}}},
          tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.raw)} ${curr}`}}
        },
        scales:{y:{ticks:{callback:v=>fmtM(v)},grid:{color:'#f0ebe5'}},x:{grid:{display:false}}}
      }
    });
  },[forecastData,budgetLabel,conv,curr]);

  useEffect(()=>{if(data.length)renderForecastChart()},[renderForecastChart,data.length]);

  if(loading)return <LoadingLogo text="Forecast laden..." />;
  if(!data.length)return<div className="text-center py-16"><p className="text-[#6b5240]">Geen data beschikbaar.</p></div>;
  if(!forecastData)return<div className="text-center py-16"><p className="text-[#6b5240]">Forecast kan niet berekend worden.</p></div>;

  const storeName=store==='all'?'Alle':SN[store]||store;
  const currLabel=isBonaire?`${storeName} · US$`:`${storeName} · XCG`;

  return(
    <div className="max-w-[1520px] mx-auto" style={{fontFamily:"'DM Sans',-apple-system,sans-serif",color:'#1a0a04'}}>
      <CGFModal show={showCGFModal} onClose={()=>setShowCGFModal(false)} onUnlock={()=>{setCgfUnlocked(true);setBudgetMode('cgf')}}/>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:'22px',fontWeight:900}}>
            Forecast <span className="italic font-normal text-[14px] text-[#a08a74]">(concept)</span>
          </h1>
          <p className="text-[13px] text-[#6b5240]">Building Depot{lastDate?` — data t/m ${lastDate.getDate()} ${MN[lastDate.getMonth()]} ${lastDate.getFullYear()}`:''}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">{currLabel}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Store</span>
          <div className="flex gap-1">{stores.map(s=><Pill key={s} label={SN[s]||s} active={store===s} onClick={()=>setStore(s)}/>)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Manager</span>
          <div className="flex gap-1"><Pill label="Alle" active={bum==='all'} onClick={()=>setBum('all')}/>{bums.map(b=><Pill key={b} label={b} active={bum===b} onClick={()=>setBum(b)}/>)}</div>
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] ml-6">Budget</span>
          <div className="flex gap-1"><Pill label="Target (70M)" active={budgetMode==='target'} onClick={()=>setBudgetMode('target')}/>{cgfUnlocked&&<Pill label="CGF (65M)" active={budgetMode==='cgf'} onClick={()=>setBudgetMode('cgf')}/>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Departement</span>
          <select value={dept} onChange={e=>setDept(e.target.value)} className="bg-white border border-[#e5ddd4] text-[#1a0a04] text-[13px] px-3 py-1.5 rounded-lg">
            <option value="all">Alle Departementen</option>
            {depts.map(d=>{const[c2,n]=d.split('|');return<option key={c2} value={c2}>{n}</option>})}
          </select>
        </div>
      </div>

      {/* Context bar */}
      <div className="bg-[#faf7f4] rounded-[14px] border border-[#e5ddd4] p-4 mb-5">
        <p className="text-[12px] text-[#6b5240]">
          Forecast op basis van data t/m <strong>{lastDate.getDate()} {MN[lastDate.getMonth()]} {lastDate.getFullYear()}</strong>
          {' — '}<strong>dag {forecastData.dayOfMonth} van {forecastData.totalDaysInMonth}</strong> in {MN[forecastData.curMonth-1]}
          {' ('}{((forecastData.dayOfMonth/forecastData.totalDaysInMonth)*100).toFixed(0)}% verstreken{')'}
          {' · '}<strong>dag {forecastData.dayOfYear} van {forecastData.totalDaysInYear}</strong> in {forecastData.curYear}
          {' ('}{((forecastData.dayOfYear/forecastData.totalDaysInYear)*100).toFixed(0)}% verstreken{')'}
        </p>
      </div>

      {/* SECTIE A: Maand-forecast */}
      <h3 className="text-[15px] font-bold text-[#1a0a04] mb-3">Forecast Huidige Maand — {MN[forecastData.curMonth-1]} {forecastData.curYear}</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <ForecastKPI
          label="Run Rate Forecast"
          forecast={fmtMC(forecastData.runRateForecast)+' '+curr}
          sublabel="MTD actual"
          subvalue={fmtMC(forecastData.mtdSales)}
          compareLabel="vs Budget"
          comparePct={pctChg(forecastData.runRateForecast,forecastData.monthBudgetSales)}
          compareLabel2="vs LY"
          comparePct2={pctChg(forecastData.runRateForecast,forecastData.lyMonthSales)}
          note={`Methode: MTD ÷ ${forecastData.dayOfMonth} dagen × ${forecastData.totalDaysInMonth} dagen`}
        />
        <ForecastKPI
          label="Verkooppatroon LY"
          forecast={fmtMC(forecastData.lyPacingForecast)+' '+curr}
          sublabel="MTD actual"
          subvalue={fmtMC(forecastData.mtdSales)}
          compareLabel="vs Budget"
          comparePct={pctChg(forecastData.lyPacingForecast,forecastData.monthBudgetSales)}
          compareLabel2="vs LY"
          comparePct2={pctChg(forecastData.lyPacingForecast,forecastData.lyMonthSales)}
          note={`Methode: MTD ÷ ${(forecastData.lyPacingPct*100).toFixed(1)}% — werkelijke LY pacing op dag ${forecastData.dayOfMonth}`}
        />
        <ForecastKPI
          label="Budget Status"
          forecast={(forecastData.budgetVarPct>=0?'+':'')+fmtP(forecastData.budgetVarPct)}
          sublabel="MTD vs verwacht"
          subvalue={fmtMC(forecastData.mtdSales)+' / '+fmtMC(forecastData.expectedBudgetMTD)}
          note={`Forecast eindstand bij dit tempo: ${fmtMC(forecastData.budgetPaceForecast)} ${curr}`}
        />
      </div>

      {/* SECTIE B: Catch-up tabel */}
      <h3 className="text-[15px] font-bold text-[#1a0a04] mb-3">Wat Moet Er Per Dag — Resterende {forecastData.remainingDaysMonth} Dagen</h3>
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-6 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left p-2.5 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Doel</th>
              <th className="text-right p-2.5 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Maand-doel</th>
              <th className="text-right p-2.5 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Te gaan</th>
              <th className="text-right p-2.5 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">Per dag nodig</th>
              <th className="text-right p-2.5 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4]">vs huidig daily avg</th>
            </tr>
          </thead>
          <tbody>
            {[
              {label:'Budget halen',target:forecastData.monthBudgetSales,required:forecastData.requiredDailyForBudget},
              {label:'LY evenaren',target:forecastData.lyMonthSales,required:forecastData.requiredDailyForLY},
              {label:'Run rate volhouden',target:forecastData.runRateForecast,required:forecastData.dailyAvg}
            ].map((row,i)=>{
              const togo=row.target-forecastData.mtdSales;
              const deltaVsAvg=row.required-forecastData.dailyAvg;
              const deltaPct=forecastData.dailyAvg?(deltaVsAvg/forecastData.dailyAvg*100):0;
              return(
                <tr key={i} className="hover:bg-[#faf5f0]">
                  <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] font-semibold">{row.label}</td>
                  <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono">{fmtMC(row.target)} {curr}</td>
                  <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={{color:togo>0?'#dc2626':'#16a34a'}}>{togo>0?'+':''}{fmtMC(togo)}</td>
                  <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold">{fmtMC(row.required)}</td>
                  <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono" style={{color:deltaVsAvg>0?'#dc2626':'#16a34a'}}>{deltaVsAvg>0?'+':''}{fmtP(deltaPct)}</td>
                </tr>
              );
            })}
            <tr className="bg-[#faf7f4]">
              <td className="p-2.5 text-[12px] border-b border-[#e5ddd4] text-[#6b5240] italic" colSpan={5}>
                Huidig daily average: <strong>{fmtMC(forecastData.dailyAvg)} {curr}/dag</strong> · MTD: <strong>{fmtMC(forecastData.mtdSales)} {curr}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* SECTIE C: FY forecast */}
      <h3 className="text-[15px] font-bold text-[#1a0a04] mb-3">Forecast Heel Jaar — {forecastData.curYear}</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <ForecastKPI
          label="FY Run Rate Forecast"
          forecast={fmtMC(forecastData.fyRunRateForecast)+' '+curr}
          sublabel="YTD actual"
          subvalue={fmtMC(forecastData.ytdSales)}
          compareLabel="vs FY Budget"
          comparePct={pctChg(forecastData.fyRunRateForecast,forecastData.fyBudget)}
          compareLabel2="vs LY"
          comparePct2={pctChg(forecastData.fyRunRateForecast,forecastData.lyFullYear)}
          note={`Methode: YTD ÷ ${forecastData.dayOfYear} dagen × ${forecastData.totalDaysInYear} dagen`}
        />
        <ForecastKPI
          label="FY Verkooppatroon LY"
          forecast={fmtMC(forecastData.fyLyPacingForecast)+' '+curr}
          sublabel="YTD actual"
          subvalue={fmtMC(forecastData.ytdSales)}
          compareLabel="vs FY Budget"
          comparePct={pctChg(forecastData.fyLyPacingForecast,forecastData.fyBudget)}
          compareLabel2="vs LY"
          comparePct2={pctChg(forecastData.fyLyPacingForecast,forecastData.lyFullYear)}
          note={`Methode: YTD ÷ ${(forecastData.fyLyPacingPct*100).toFixed(1)}% — werkelijke LY YTD pacing`}
        />
        <ForecastKPI
          label="FY Budget Status"
          forecast={(forecastData.fyBudgetVarPct>=0?'+':'')+fmtP(forecastData.fyBudgetVarPct)}
          sublabel="YTD vs verwacht"
          subvalue={fmtMC(forecastData.ytdSales)+' / '+fmtMC(forecastData.fyExpectedBudgetYTD)}
          note={`Forecast eindstand bij dit tempo: ${fmtMC(forecastData.fyBudgetPaceForecast)} ${curr}`}
        />
      </div>

      {/* SECTIE D: Forecast chart */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
        <h3 className="text-[15px] font-bold mb-4">Maandelijks Verloop — Actual + Forecast vs LY & Budget</h3>
        <div style={{height:'320px'}}><canvas ref={forecastChartRef}/></div>
        <p className="text-[11px] text-[#a08a74] italic mt-3">
          Donker oranje = werkelijke maanden t/m {MN[forecastData.curMonth-1]} · Lichter oranje = forecast (Verkooppatroon LY, gegroeid met factor {forecastData.growthFactor.toFixed(2)})
        </p>
      </div>
    </div>
  );
}
