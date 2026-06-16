// ============================================================================
//  BESTEMMING:  src/app/dashboard/finance/reports/page.jsx
//  Data-import:  src/data/statements-data.json   (account-level + budget 2026)
//  Building Depot — Financiële Overzichten  (W&V · Balans · Kasstroom)  v2
// ============================================================================
'use client';
import { useState, useMemo } from 'react';
import DATA from '@/data/statements-data.json';

/* ------------------------------- rekenkern ------------------------------- */
function makeLib(DATA){
  const META=DATA.meta, ROWS=DATA.rows, BUD=DATA.budget||{};
  const YEARS=META.years, PERIODS=META.periodsAvailable, USD_RATE=META.usdRate||1.82;
  const OPEX_C2=[
    ['Personnel expenses (including management)','Personeelskosten (incl. management)'],
    ['Office expenses','Kantoorkosten'],
    ['Selling expenses','Verkoopkosten'],
    ['General operating expenses','Algemene bedrijfskosten'],
    ['Transportation','Transport'],
    ['Depreciation expenses','Afschrijvingen'],
    ['Profit sharing','Winstdeling'],
    ['Other expenses/(income)','Overige lasten/(baten)'],
  ];
  function val(r,y,p,mode){y=String(y);const a=r.m[y];if(!a)return 0;const end=a[p-1]||0;
    if(r.t==='B'||mode==='ytd')return end;const prev=p===1?(r.b[y]||0):(a[p-2]||0);return end-prev;}
  function pool(ent){return ent==='CONS'?ROWS:ROWS.filter(r=>r.e===ent);}
  function sumP(rows,pred,y,p,mode){let s=0;for(const r of rows)if(r.t==='P'&&pred(r))s+=val(r,y,p,mode);return s;}
  const H=h=>r=>r.h===h, C2=c=>r=>r['2']===c;
  function pnl(ent,y,p,mode){
    const rs=pool(ent);
    const omzet=-sumP(rs,H('Totale omzet'),y,p,mode);
    const kp=sumP(rs,H('Totale kostprijs verkopen'),y,p,mode);
    const bruto=omzet-kp;
    const okp=sumP(rs,H('Totale Overige kostprijs verkopen'),y,p,mode);
    const netto=bruto-okp;
    const opexLines=OPEX_C2.map(([c,lbl])=>({key:c,label:lbl,value:sumP(rs,C2(c),y,p,mode)}));
    const opex=opexLines.reduce((s,l)=>s+l.value,0);
    const ebit=netto-opex;
    const fin=sumP(rs,H('Total financieringskosten'),y,p,mode);
    const overige=sumP(rs,H('Overige'),y,p,mode);
    return {omzet,kp,bruto,okp,netto,opexLines,opex,ebit,fin,overige,resultaat:ebit-fin-overige};
  }
  function budPnl(ent,y,p,mode){
    if(String(y)!==String(META.budgetYear))return null;
    const ents = ent==='CONS' ? (META.budgetEntities||[]) : (BUD[ent]?[ent]:[]);
    if(ents.length===0)return null;
    const idx = mode==='ytd' ? Array.from({length:p},(_,i)=>i) : [p-1];
    const pick=(g)=>{let s=0;for(const e of ents){const arr=g(BUD[e]);if(arr)for(const i of idx)s+=arr[i]||0;}return s;};
    const omzet=pick(b=>b.omzet), kp=pick(b=>b.kp), okp=pick(b=>b.okp);
    const bruto=omzet-kp, netto=bruto-okp;
    const opexLines=OPEX_C2.map(([c,lbl])=>({key:c,label:lbl,
      value: c==='Other expenses/(income)' ? pick(b=>b.other) : pick(b=>b.opex[c]) }));
    const opex=opexLines.reduce((s,l)=>s+l.value,0);
    const ebit=netto-opex, fin=pick(b=>b.fin), overige=pick(b=>b.overige);
    return {omzet,kp,bruto,okp,netto,opexLines,opex,ebit,fin,overige,resultaat:ebit-fin-overige};
  }
  function c1Breakdown(ent,c2,y,p,mode){
    const rs=pool(ent).filter(r=>r.t==='P'&&r['2']===c2);
    const m=new Map();
    for(const r of rs){const v=val(r,y,p,mode);m.set(r['1'],(m.get(r['1'])||0)+v);}
    return [...m.entries()].filter(([,v])=>Math.abs(v)>0.5).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  }
  function glBreakdown(ent,c2,c1,y,p,mode){
    const rs=pool(ent).filter(r=>r.t==='P'&&r['2']===c2&&r['1']===c1);
    return rs.map(r=>({acc:r.a,desc:r.d,value:val(r,y,p,mode)})).filter(o=>Math.abs(o.value)>0.5)
      .sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
  }
  return {META,YEARS,PERIODS,USD_RATE,OPEX_C2,pnl,budPnl,c1Breakdown,glBreakdown,pool,val,H,C2,sumP};
}

const MONTHS=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
const NF =new Intl.NumberFormat('nl-NL',{maximumFractionDigits:0});
const NF1=new Intl.NumberFormat('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1});

/* ============================== component ================================= */
export default function StatementsDashboard(){
  const L = useMemo(()=>makeLib(DATA),[]);
  const META=L.META, YEARS=L.YEARS, PERIODS=L.PERIODS, RATE=L.USD_RATE;
  const ENAMES=META.entityNames||{}, USD_ENTS=META.usdEntities||['BDB'];

  const [entity,setEntity]=useState('CONS');
  const [year,setYear]=useState('2026');
  const [period,setPeriod]=useState(Math.min(4,PERIODS['2026']||12));
  const [cur,setCur]=useState('XCG');
  const [tab,setTab]=useState('pnl');
  const [open,setOpen]=useState({});
  const [openc1,setOpenc1]=useState({});
  const [chartC2,setChartC2]=useState('Personnel expenses (including management)');
  const [chartC1,setChartC1]=useState('');
  const [chartGL,setChartGL]=useState('');
  const [balOpen,setBalOpen]=useState({});
  const [balOpenY,setBalOpenY]=useState({});

  const maxP=PERIODS[year]||12;
  const p=Math.min(period,maxP);
  const py=String(+year-1);
  const prevMax=PERIODS[py]||12, pPrev=Math.min(p,prevMax);
  const showUsd=USD_ENTS.includes(entity);
  const usdActive=cur==='USD'&&showUsd;
  const curLabel=usdActive?'US$':META.currency;

  /* ---- formatting ---- */
  const cf=(v)=>{ if(v==null||isNaN(v))return'–'; let t=v/1000; if(usdActive)t/=RATE;
    if(Math.abs(t)<0.05)return'–'; return NF.format(Math.round(t)); };
  const pct=(c,r)=> (r==null||Math.abs(r)<1)?null:((c-r)/Math.abs(r))*100;

  const Num=({v,b,acc,tot})=>{const neg=v<-0.5;
    return <span className={'num'+(b||tot?' b':'')+(acc?' acc':'')+(neg?' neg':'')}>{cf(v)}</span>;};
  const RefCell=({actual,refv,sep})=>{
    if(refv==null)return <td className={'r refc'+(sep?' sep':'')}><span className="num muted">–</span></td>;
    const d=actual-refv, pp=pct(actual,refv), good=d>=-0.5;
    const dtxt=`${d>=0?'+':'−'}${cf(Math.abs(d))}${pp!=null?` · ${d>=0?'+':'−'}${NF1.format(Math.abs(pp))}%`:''}`;
    return <td className={'r refc'+(sep?' sep':'')}><span className="num muted">{cf(refv)}</span><span className={'dv '+(good?'up':'down')}>{dtxt}</span></td>;
  };

  /* ---- data ---- */
  const mAct=L.pnl(entity,year,p,'month'), yAct=L.pnl(entity,year,p,'ytd');
  const mVj=YEARS.includes(py)?L.pnl(entity,py,pPrev,'month'):null;
  const yVj=YEARS.includes(py)?L.pnl(entity,py,pPrev,'ytd'):null;
  const mBud=L.budPnl(entity,year,p,'month'), yBud=L.budPnl(entity,year,p,'ytd');

  const periodLabel=`${MONTHS[p-1]} ${year}`, ytdLabel=`t/m ${MONTHS[p-1]} ${year}`;
  const entLabel=entity==='CONS'?'Geconsolideerd (groep)':`${entity} — ${ENAMES[entity]||''}`;

  const toggleOpen=k=>setOpen(o=>({...o,[k]:!o[k]}));
  const toggleC1=k=>setOpenc1(o=>({...o,[k]:!o[k]}));

  /* ---- P&L rows ---- */
  function DataRow({label,mA,yA,mB,yB,mV,yV,o={},k}){
    const cls=['sd-row']; if(o.ind)cls.push('ind'); if(o.strong)cls.push('strong');
    if(o.sub)cls.push('sub'); if(o.tot)cls.push('tot');
    return (<tr className={cls.join(' ')} key={k}>
      <td className="lbl">{o.exp&&<button className="exp" onClick={()=>toggleOpen(o.exp)}>{open[o.exp]?'−':'+'}</button>}{label}</td>
      <td className="r"><Num v={mA} b={o.strong||o.sub} tot={o.tot}/></td>
      <RefCell actual={mA} refv={mB}/>
      <RefCell actual={mA} refv={mV}/>
      <td className="r sep"><Num v={yA} b={o.strong||o.sub} tot={o.tot}/></td>
      <RefCell actual={yA} refv={yB}/>
      <RefCell actual={yA} refv={yV}/>
    </tr>);
  }
  function detailRows(c2,idx){
    const out=[];
    const mc1=L.c1Breakdown(entity,c2,year,p,'month');
    const yc1=new Map(L.c1Breakdown(entity,c2,year,p,'ytd'));
    const mvj=YEARS.includes(py)?new Map(L.c1Breakdown(entity,py,pPrev,'month')):new Map();
    const yvj=YEARS.includes(py)?new Map(L.c1Breakdown(entity,py,pPrev,'ytd')):new Map();
    for(const [c1,mv] of mc1){
      const key=c2+'||'+c1, yv=yc1.get(c1)||0;
      out.push(<tr className="sd-row det c1" key={'c1_'+idx+'_'+c1}>
        <td className="lbl"><button className="exp" onClick={()=>toggleC1(key)}>{openc1[key]?'−':'+'}</button>{c1.toLowerCase()}</td>
        <td className="r"><Num v={-mv}/></td><td className="r refc"></td>
        <RefCell actual={-mv} refv={-(mvj.get(c1)||0)}/>
        <td className="r sep"><Num v={-yv}/></td><td className="r refc"></td>
        <RefCell actual={-yv} refv={-(yvj.get(c1)||0)}/>
      </tr>);
      if(openc1[key]){
        const gl=L.glBreakdown(entity,c2,c1,year,p,'month');
        const ygl=new Map(L.glBreakdown(entity,c2,c1,year,p,'ytd').map(o=>[o.acc,o.value]));
        for(const g of gl){
          out.push(<tr className="sd-row det gl" key={'gl_'+idx+'_'+c1+'_'+g.acc}>
            <td className="lbl">{g.acc} · {g.desc}</td>
            <td className="r"><Num v={-g.value}/></td><td className="r"></td><td className="r"></td>
            <td className="r sep"><Num v={-(ygl.get(g.acc)||0)}/></td><td className="r"></td><td className="r"></td>
          </tr>);
        }
      }
    }
    return out;
  }

  const pnlRows=[];
  pnlRows.push(<DataRow key="omz" label="Totale omzet" mA={mAct.omzet} yA={yAct.omzet} mB={mBud?.omzet} yB={yBud?.omzet} mV={mVj?.omzet} yV={yVj?.omzet} o={{strong:1}}/>);
  pnlRows.push(<DataRow key="kp" label="Kostprijs verkopen" mA={-mAct.kp} yA={-yAct.kp} mB={mBud?-mBud.kp:null} yB={yBud?-yBud.kp:null} mV={mVj?-mVj.kp:null} yV={yVj?-yVj.kp:null}/>);
  pnlRows.push(<DataRow key="okp" label="Overige kostprijs verkopen" mA={-mAct.okp} yA={-yAct.okp} mB={mBud?-mBud.okp:null} yB={yBud?-yBud.okp:null} mV={mVj?-mVj.okp:null} yV={yVj?-yVj.okp:null}/>);
  pnlRows.push(<DataRow key="bruto" label="Brutomarge" mA={mAct.bruto} yA={yAct.bruto} mB={mBud?.bruto} yB={yBud?.bruto} mV={mVj?.bruto} yV={yVj?.bruto} o={{sub:1}}/>);
  pnlRows.push(<DataRow key="netto" label="Nettomarge" mA={mAct.netto} yA={yAct.netto} mB={mBud?.netto} yB={yBud?.netto} mV={mVj?.netto} yV={yVj?.netto} o={{sub:1}}/>);
  pnlRows.push(<tr className="sd-group" key="g-opex"><td colSpan={7}>Operationele kosten</td></tr>);
  mAct.opexLines.forEach((line,i)=>{
    const yA=yAct.opexLines[i].value, mB=mBud?mBud.opexLines[i].value:null, yB=yBud?yBud.opexLines[i].value:null;
    const mV=mVj?mVj.opexLines[i].value:null, yV=yVj?yVj.opexLines[i].value:null;
    pnlRows.push(<DataRow key={'opex'+i} label={line.label} mA={-line.value} yA={-yA} mB={mB!=null?-mB:null} yB={yB!=null?-yB:null} mV={mV!=null?-mV:null} yV={yV!=null?-yV:null} o={{ind:1,exp:'opex_'+i}}/>);
    if(open['opex_'+i]) detailRows(line.key,i).forEach(r=>pnlRows.push(r));
  });
  pnlRows.push(<DataRow key="opextot" label="Totaal operationele kosten" mA={-mAct.opex} yA={-yAct.opex} mB={mBud?-mBud.opex:null} yB={yBud?-yBud.opex:null} mV={mVj?-mVj.opex:null} yV={yVj?-yVj.opex:null} o={{sub:1}}/>);
  pnlRows.push(<DataRow key="ebit" label="EBIT" mA={mAct.ebit} yA={yAct.ebit} mB={mBud?.ebit} yB={yBud?.ebit} mV={mVj?.ebit} yV={yVj?.ebit} o={{strong:1}}/>);
  pnlRows.push(<DataRow key="fin" label="Financieringskosten" mA={-mAct.fin} yA={-yAct.fin} mB={mBud?-mBud.fin:null} yB={yBud?-yBud.fin:null} mV={mVj?-mVj.fin:null} yV={yVj?-yVj.fin:null}/>);
  if(Math.abs(mAct.overige)>0.5||Math.abs(yAct.overige)>0.5)
    pnlRows.push(<DataRow key="ov" label="Overige" mA={-mAct.overige} yA={-yAct.overige} mB={mBud?-mBud.overige:null} yB={yBud?-yBud.overige:null} mV={mVj?-mVj.overige:null} yV={yVj?-yVj.overige:null}/>);
  pnlRows.push(<DataRow key="res" label="Resultaat" mA={mAct.resultaat} yA={yAct.resultaat} mB={mBud?.resultaat} yB={yBud?.resultaat} mV={mVj?.resultaat} yV={yVj?.resultaat} o={{tot:1}}/>);

  /* ---- Balans (stand per laatst bekende maand + uitklapbaar verloop per jaar/maand) ---- */
  const rs=L.pool(entity);
  // stand (eindwaarde) van een balanspost in een specifieke maand van een specifiek jaar
  const balValAt=(h,y,pp)=>{let s=0;const ys=String(y);for(const r of rs)if(r.t==='B'&&r.h===h){const arr=r.m[ys];if(arr)s+=arr[pp-1]||0;}return s;};
  const BalRow=({lbl,v,o={},k})=>{const cls=['sd-row'];if(o.ind)cls.push('ind');if(o.tot)cls.push('tot');if(o.sub)cls.push('sub');if(o.warn)cls.push('warn');
    return <tr className={cls.join(' ')} key={k}><td className="lbl">{lbl}</td><td className="r"><Num v={v} tot={o.tot}/></td></tr>;};
  const resJTD=yAct.resultaat;

  const FIX=[['Goodwill','Goodwill'],['Total fixed assets','Materiële vaste activa'],['Financial fixed assets','Financiële vaste activa']];
  const CUR=[['Total inventory','Voorraden'],['Accounts receivable','Debiteuren'],['Intercompany receivables','Intercompany vorderingen'],['C/A Management','Rekening-courant management'],['Prepaid expenses and other receivables','Vooruitbetaald & overige vorderingen'],['Other receivables','Overige vorderingen'],['Liquide middelen','Liquide middelen']];
  const LIA=[['Provisions','Voorzieningen'],['Long term Liabilities','Langlopende schulden'],['Accounts payable','Crediteuren'],['other payables','Overige schulden']];
  const totA_fn=(y,pp)=>[...FIX,...CUR].reduce((s,[h])=>s+balValAt(h,y,pp),0);
  const ev_fn  =(y,pp)=>-balValAt('Total equity',y,pp);
  const res_fn =(y,pp)=>L.pnl(entity,y,pp,'ytd').resultaat;
  const totL_fn=(y,pp)=>ev_fn(y,pp)+res_fn(y,pp)+LIA.reduce((s,[h])=>s+(-balValAt(h,y,pp)),0);
  const diff_fn=(y,pp)=>totA_fn(y,pp)-totL_fn(y,pp);

  const balDefs=[
    {g:'Activa — Vaste activa'},
    ...FIX.map(([h,l])=>({label:l,fn:(y,pp)=>balValAt(h,y,pp),o:{ind:1}})),
    {g:'Activa — Vlottende activa'},
    ...CUR.map(([h,l])=>({label:l,fn:(y,pp)=>balValAt(h,y,pp),o:{ind:1}})),
    {label:'Totaal activa',fn:totA_fn,o:{tot:1}},
    {g:'Passiva'},
    {label:'Eigen vermogen (begin/cumulatief)',fn:ev_fn,o:{ind:1}},
    {label:'Resultaat lopend boekjaar',fn:res_fn,o:{ind:1}},
    ...LIA.map(([h,l])=>({label:l,fn:(y,pp)=>-balValAt(h,y,pp),o:{ind:1}})),
    {label:'Totaal passiva',fn:totL_fn,o:{tot:1}},
    {label:'Aansluitingsverschil (ruwe GL)',fn:diff_fn,o:{warn:1}},
  ];
  const drillYears=[...YEARS].sort().reverse().slice(0,3);  // 3 meest recente jaren
  const balRows=[];
  balDefs.forEach((d,bi)=>{
    if(d.g){balRows.push(<tr className="sd-group" key={'bg'+bi}><td colSpan={2}>{d.g}</td></tr>);return;}
    const cls=['sd-row'];if(d.o.ind)cls.push('ind');if(d.o.tot)cls.push('tot');if(d.o.warn)cls.push('warn');
    const opened=!!balOpen[bi];
    balRows.push(<tr className={cls.join(' ')} key={'br'+bi}>
      <td className="lbl"><button className="exp" onClick={()=>setBalOpen(o=>({...o,[bi]:!o[bi]}))}>{opened?'−':'+'}</button>{d.label}</td>
      <td className="r"><Num v={d.fn(year,p)} tot={d.o.tot}/></td></tr>);
    if(opened){
      drillYears.forEach(Y=>{
        const cutoff=Y===year?p:(PERIODS[Y]||12);
        const yk=bi+'|'+Y, yo=!!balOpenY[yk];
        balRows.push(<tr className="sd-row det baly" key={'by'+yk}>
          <td className="lbl"><button className="exp" onClick={()=>setBalOpenY(o=>({...o,[yk]:!o[yk]}))}>{yo?'−':'+'}</button>{Y}</td>
          <td className="r"><Num v={d.fn(Y,cutoff)}/></td></tr>);
        if(yo){
          for(let m=1;m<=cutoff;m++){
            balRows.push(<tr className="sd-row det balm" key={'bm'+yk+'_'+m}>
              <td className="lbl">{MONTHS[m-1]} {Y}</td>
              <td className="r"><Num v={d.fn(Y,m)}/></td></tr>);
          }
        }
      });
    }
  });

  /* ---- Kasstroom ---- */
  const dlt=(h)=>{let s=0;for(const r of rs)if(r.t==='B'&&r.h===h){const a=r.m[year];if(a){s+=(a[p-1]||0)-(r.b[year]||0);}}return -s;};
  const cashRows=[];
  cashRows.push(<BalRow key="nr" lbl="Nettoresultaat" v={resJTD}/>);
  cashRows.push(<tr className="sd-group" key="gop"><td colSpan={2}>Operationele kasstroom</td></tr>);
  let opCf=resJTD;
  [['Total inventory','Mutatie voorraden'],['Accounts receivable','Mutatie debiteuren'],['Prepaid expenses and other receivables','Mutatie vooruitbetaald & ov. vord.'],['Other receivables','Mutatie overige vorderingen'],['Accounts payable','Mutatie crediteuren'],['other payables','Mutatie overige schulden'],['Provisions','Mutatie voorzieningen']].forEach(([h,l])=>{const v=dlt(h);opCf+=v;cashRows.push(<BalRow key={'op'+h} lbl={l} v={v} o={{ind:1}}/>);});
  cashRows.push(<BalRow key="opT" lbl="Kasstroom uit operationele activiteiten" v={opCf} o={{sub:1}}/>);
  cashRows.push(<tr className="sd-group" key="giv"><td colSpan={2}>Investeringen</td></tr>);
  let ivCf=0;
  [['Goodwill','Mutatie goodwill'],['Total fixed assets','Investeringen (netto)'],['Financial fixed assets','Mutatie financiële vaste activa']].forEach(([h,l])=>{const v=dlt(h);ivCf+=v;cashRows.push(<BalRow key={'iv'+h} lbl={l} v={v} o={{ind:1}}/>);});
  cashRows.push(<BalRow key="ivT" lbl="Kasstroom uit investeringen" v={ivCf}/>);
  cashRows.push(<tr className="sd-group" key="gfi"><td colSpan={2}>Financiering & intercompany</td></tr>);
  let fiCf=0;
  [['Long term Liabilities','Mutatie langlopende schulden'],['Total equity','Mutatie eigen vermogen (excl. resultaat)'],['Intercompany receivables','Mutatie intercompany'],['C/A Management','Mutatie r-c management']].forEach(([h,l])=>{const v=dlt(h);fiCf+=v;cashRows.push(<BalRow key={'fi'+h} lbl={l} v={v} o={{ind:1}}/>);});
  cashRows.push(<BalRow key="fiT" lbl="Kasstroom uit financiering" v={fiCf}/>);
  const indic=opCf+ivCf+fiCf;
  let actCash=0;for(const r of rs)if(r.t==='B'&&r.h==='Liquide middelen'){const a=r.m[year];if(a)actCash+=(a[p-1]||0)-(r.b[year]||0);}
  cashRows.push(<BalRow key="ind" lbl="Indicatieve mutatie" v={indic}/>);
  cashRows.push(<BalRow key="diffC" lbl="Aansluitingsverschil (ruwe GL)" v={actCash-indic} o={{warn:1}}/>);
  cashRows.push(<BalRow key="actc" lbl="Werkelijke mutatie liquide middelen" v={actCash}/>);

  /* ---- Chart ---- */
  const chartSubjects=()=>{
    const subs=[
      {id:'omzet',label:'Omzet',pred:L.H('Totale omzet'),flip:true,bud:b=>b.omzet},
      {id:'kp',label:'Kostprijs verkopen',pred:L.H('Totale kostprijs verkopen'),bud:b=>b.kp},
    ];
    L.OPEX_C2.forEach(([c,lbl])=>subs.push({id:c,label:lbl,pred:L.C2(c),drill:true,bud:c==='Other expenses/(income)'?b=>b.other:b=>b.opex[c]}));
    subs.push({id:'fin',label:'Financieringskosten',pred:L.H('Total financieringskosten'),bud:b=>b.fin});
    return subs;
  };
  const monthly=(ent,pred,y,flip)=>{const rr=L.pool(ent).filter(r=>r.t==='P'&&pred(r));const out=[];for(let pp=1;pp<=12;pp++){let s=0;for(const r of rr)s+=L.val(r,y,pp,'month');out.push(flip?-s:s);}return out;};
  const budMonthly=(ent,fn)=>{const ents=ent==='CONS'?(META.budgetEntities||[]):(DATA.budget[ent]?[ent]:[]);if(!ents.length)return null;const out=[];for(let i=0;i<12;i++){let s=0;for(const e of ents){const arr=fn(DATA.budget[e]);if(arr)s+=arr[i]||0;}out.push(s);}return out;};

  const subs=chartSubjects();
  const sub=subs.find(s=>s.id===chartC2)||subs[0];
  const c1opts=sub.drill?L.c1Breakdown(entity,sub.id,year,12,'ytd').map(([c])=>c):[];
  const effC1=(chartC1&&c1opts.includes(chartC1))?chartC1:'';
  const glopts=(sub.drill&&effC1)?L.glBreakdown(entity,sub.id,effC1,year,12,'ytd').map(o=>o.acc+' · '+o.desc):[];
  const effGL=(glopts.includes(chartGL))?chartGL:'';
  let pred,flip=false,budArr=null,title=sub.label;
  if(sub.drill&&effC1&&effGL){const acc=effGL.split(' · ')[0];pred=r=>r['2']===sub.id&&r['1']===effC1&&r.a===acc;title=effGL;}
  else if(sub.drill&&effC1){pred=r=>r['2']===sub.id&&r['1']===effC1;title=sub.label+' › '+effC1.toLowerCase();}
  else{pred=sub.pred;flip=!!sub.flip;if(sub.bud)budArr=budMonthly(entity,sub.bud);}
  const showAbs=!sub.flip;
  const act=monthly(entity,pred,year,flip);
  const vj=YEARS.includes(py)?monthly(entity,pred,py,flip):null;
  const A=act.map(v=>showAbs?Math.abs(v):v);
  const B=budArr?budArr.map(v=>showAbs?Math.abs(v):v):null;
  const V=vj?vj.map(v=>showAbs?Math.abs(v):v):null;
  const conv=v=>v/1000/(usdActive?RATE:1);
  const W=820,Hh=210,padL=44,padR=12,padT=12,padB=22;
  const ser=[['act',A],['bud',B],['vj',V]].filter(s=>s[1]);
  let allv=[];ser.forEach(([id,arr])=>arr.forEach((v,i)=>{if((id==='act'&&i<maxP)||id!=='act'){if(v!=null)allv.push(conv(v));}}));
  const maxV=Math.max(1,...allv),minV=Math.min(0,...allv);
  const X=i=>padL+(W-padL-padR)*(i/11);
  const Y=v=>padT+(Hh-padT-padB)*(1-(v-minV)/((maxV-minV)||1));
  const mkPath=(arr,onlyTo)=>{let d='';for(let i=0;i<12;i++){if(onlyTo!=null&&i>=onlyTo)break;const v=arr[i];if(v==null)continue;d+=(d?'L':'M')+X(i).toFixed(1)+' '+Y(conv(v)).toFixed(1)+' ';}return d;};
  const grid=[];for(let g=0;g<=4;g++){const vv=minV+(maxV-minV)*g/4;const yy=Y(vv);grid.push(<g key={'g'+g}><line x1={padL} x2={W-padR} y1={yy} y2={yy} className="grid"/><text x={padL-6} y={yy+3} className="gy">{NF.format(Math.round(vv))}</text></g>);}
  const dots=[];for(let i=0;i<maxP;i++){if(A[i]!=null)dots.push(<circle key={'d'+i} cx={X(i)} cy={Y(conv(A[i]))} r={2.4} className="dot act"/>);}
  const xlabs=MONTHS.map((m,i)=><text key={'x'+i} x={X(i)} y={Hh-6} className={'gx'+(i+1===p?' cur':'')}>{m}</text>);

  /* ---------------------------- render ---------------------------- */
  return (
  <div className="sd-root">
    <style>{CSS}</style>
    <header className="sd-head">
      <div className="sd-title"><span className="sd-mark">BD</span>
        <div><h1>Financiële Overzichten</h1><p>Winst &amp; Verlies · Balans · Kasstroom — Building Depot</p></div></div>
      <div className="sd-meta"><div className="sd-bigsel">{entLabel}</div>
        <div className="sd-period">{ytdLabel} · × 1.000 {curLabel}</div></div>
    </header>

    <div className="sd-controls">
      <label>Entiteit
        <select value={entity} onChange={e=>{setEntity(e.target.value);if(!USD_ENTS.includes(e.target.value))setCur('XCG');setOpen({});setOpenc1({});}}>
          <option value="CONS">Geconsolideerd (alle)</option>
          {META.entities.map(en=><option key={en} value={en}>{en} — {ENAMES[en]||''}</option>)}
        </select></label>
      <label>Jaar
        <select value={year} onChange={e=>{setYear(e.target.value);setPeriod(pp=>Math.min(pp,PERIODS[e.target.value]||12));}}>
          {YEARS.map(y=><option key={y}>{y}</option>)}
        </select></label>
      <label>Periode
        <select value={p} onChange={e=>setPeriod(+e.target.value)}>
          {Array.from({length:maxP},(_,i)=>i+1).map(mo=><option key={mo} value={mo}>{MONTHS[mo-1]} ({mo})</option>)}
        </select></label>
      {showUsd&&<div className="cgrp"><span className="clbl">Valuta</span>
        <div className="sd-seg cur">
          <button className={cur==='XCG'?'on':''} onClick={()=>setCur('XCG')}>ƒ XCG</button>
          <button className={cur==='USD'?'on':''} onClick={()=>setCur('USD')}>US$</button>
        </div></div>}
    </div>

    <div className="sd-kpis">
      <Kpi cf={cf} pct={pct} l="Omzet YTD" v={yAct.omzet} refv={yBud?.omzet}/>
      <Kpi cf={cf} pct={pct} l="Brutomarge YTD" v={yAct.bruto} refv={yBud?.bruto}/>
      <Kpi cf={cf} pct={pct} l="EBIT YTD" v={yAct.ebit} refv={yBud?.ebit}/>
      <Kpi cf={cf} pct={pct} l="Resultaat YTD" v={yAct.resultaat} refv={yBud?.resultaat} acc/>
    </div>

    <nav className="sd-tabs">
      {[['pnl','Winst & Verlies'],['balans','Balans'],['cash','Kasstroom']].map(([k,l])=>
        <button key={k} className={tab===k?'on':''} onClick={()=>setTab(k)}>{l}</button>)}
    </nav>

    <div className="sd-panel">
      {tab==='pnl'&&<>
        <div className="tablewrap"><table className="sd-table wv">
          <thead>
            <tr className="grp"><th></th><th colSpan={3} className="gh">Maand · {periodLabel}</th><th colSpan={3} className="gh sep">YTD · {ytdLabel}</th></tr>
            <tr><th>Post</th><th className="r">Werkelijk</th><th className="r">Budget Δ</th><th className="r">Vorig jaar Δ</th>
              <th className="r sep">Werkelijk</th><th className="r">Budget Δ</th><th className="r">Vorig jaar Δ</th></tr>
          </thead>
          <tbody>{pnlRows}</tbody>
        </table></div>

        <div className="chart-sec">
          <div className="chart-head"><h3>Ontwikkeling — {title}</h3>
            <div className="chart-leg"><span className="lg act">Werkelijk {year}</span>
              {B&&<span className="lg bud">Budget</span>}{V&&<span className="lg vj">{+year-1}</span>}</div></div>
          <div className="chart-ctrls">
            <label>Categorie
              <select value={chartC2} onChange={e=>{setChartC2(e.target.value);setChartC1('');setChartGL('');}}>
                {subs.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
            {sub.drill&&<label>Subcategorie
              <select value={effC1} onChange={e=>{setChartC1(e.target.value);setChartGL('');}}>
                <option value="">Alle</option>{c1opts.map(c=><option key={c} value={c}>{c.toLowerCase()}</option>)}</select></label>}
            {sub.drill&&effC1&&<label>GL-rekening
              <select value={effGL} onChange={e=>setChartGL(e.target.value)}>
                <option value="">Alle</option>{glopts.map(g=><option key={g} value={g}>{g}</option>)}</select></label>}
          </div>
          <svg viewBox={`0 0 ${W} ${Hh}`} className="chart">
            {grid}
            <path d={mkPath(A,maxP)} className="ln act"/>
            {B&&<path d={mkPath(B)} className="ln bud"/>}
            {V&&<path d={mkPath(V)} className="ln vj"/>}
            {dots}{xlabs}
          </svg>
          <p className="chart-note">Maandontwikkeling × 1.000 {curLabel}. Budget alleen op categorieniveau (2026). Kies een subcategorie of GL-rekening om dieper in te zoomen.</p>
        </div>
      </>}

      {tab==='balans'&&<><table className="sd-table">
        <thead><tr><th>Post</th><th className="r">Stand · {MONTHS[p-1]} {year}</th></tr></thead>
        <tbody>{balRows}</tbody></table>
        <p className="chart-note" style={{padding:'2px 12px 8px'}}>Klik op <b>+</b> achter een post voor het verloop per jaar ({drillYears.join(' · ')}), en nogmaals op <b>+</b> bij een jaar voor de maandstanden. Bedragen × 1.000 {curLabel}.</p></>}

      {tab==='cash'&&<table className="sd-table">
        <thead><tr><th>Post</th><th className="r">YTD {ytdLabel}</th></tr></thead>
        <tbody>{cashRows}</tbody></table>}
    </div>

    <footer className="sd-foot">Bron: GL-actuals 2022–2026 + mapping · budget 2026 uit de maandmodellen · bedragen × 1.000 {curLabel}
      {usdActive?` (omgerekend à ${NF1.format(RATE)} XCG/US$)`:''} · ruwe GL (v1), kan licht afwijken van de gereclasseerde aandeelhoudersrapportage · kasstroom indirect (indicatief).</footer>
  </div>);
}

function Kpi({cf,pct,l,v,refv,acc}){
  const p=pct(v,refv);
  return (<div className={'sd-kpi'+(acc?' acc':'')}>
    <span className="k-l">{l}</span><span className="k-v">{cf(v)}</span>
    <span className="k-s">{refv!=null&&p!=null?<>vs budget <span className={'delta '+(v-refv>=0?'up':'down')}>{v-refv>=0?'▲':'▼'} {NF1.format(Math.abs(p))}%</span></>:''}</span>
  </div>);
}

/* ------------------------------- styles ---------------------------------- */
const CSS=`
.sd-root{--ink:#10243b;--ink2:#22405e;--paper:#f7f4ee;--card:#fffdf8;--line:#e4ddcf;--gold:#b8893b;--gold2:#9a6f28;--green:#1f7a4d;--red:#b23b3b;
  max-width:1180px;margin:0 auto;font-family:'IBM Plex Sans',system-ui,sans-serif;color:var(--ink);line-height:1.4}
.sd-root *{box-sizing:border-box}
.sd-head{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;border-bottom:2px solid var(--ink);padding-bottom:16px}
.sd-title{display:flex;gap:14px;align-items:center}
.sd-mark{font-family:Georgia,serif;font-weight:600;background:var(--ink);color:var(--paper);width:46px;height:46px;display:grid;place-items:center;font-size:20px;border-radius:8px}
.sd-head h1{font-family:Georgia,serif;font-weight:600;font-size:27px;margin:0;letter-spacing:-.01em}
.sd-head p{margin:2px 0 0;font-size:12.5px;color:#5d6b7a}
.sd-meta{text-align:right}
.sd-bigsel{font-family:Georgia,serif;font-size:16px;color:var(--gold2);font-weight:600}
.sd-period{font-size:12px;color:#5d6b7a;font-variant-numeric:tabular-nums}
.sd-controls{display:flex;flex-wrap:wrap;gap:14px 18px;align-items:flex-end;margin:18px 0 4px}
.sd-controls label{display:flex;flex-direction:column;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6a7785;gap:5px;font-weight:600}
.sd-controls select{font-family:inherit;font-size:13.5px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:7px;padding:7px 9px;min-width:120px}
.cgrp{display:flex;flex-direction:column;gap:5px}
.clbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6a7785;font-weight:600}
.sd-seg{display:flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}
.sd-seg button{font-family:inherit;font-size:12.5px;padding:7px 13px;border:0;background:var(--card);color:#6a7785;cursor:pointer;font-weight:600}
.sd-seg button.on{background:var(--ink);color:var(--paper)}
.sd-seg.cur button{min-width:54px}
.sd-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}
.sd-kpi{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--ink);border-radius:9px;padding:13px 15px;display:flex;flex-direction:column;gap:3px}
.sd-kpi.acc{border-top-color:var(--gold)}
.k-l{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#6a7785;font-weight:600}
.k-v{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
.k-s{font-size:11.5px;color:#6a7785;display:flex;gap:8px;align-items:center;min-height:16px}
.sd-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line)}
.sd-tabs button{font-family:Georgia,serif;font-size:16px;font-weight:600;background:none;border:0;border-bottom:2.5px solid transparent;padding:9px 16px;color:#8a96a3;cursor:pointer;margin-bottom:-1px}
.sd-tabs button.on{color:var(--ink);border-bottom-color:var(--gold)}
.sd-panel{background:var(--card);border:1px solid var(--line);border-top:0;border-radius:0 0 9px 9px;padding:6px 4px}
.tablewrap{overflow-x:auto}
.sd-table{width:100%;border-collapse:collapse;font-size:13px}
.sd-table th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#7a8693;font-weight:600;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:bottom}
.sd-table th.r,.sd-table td.r{text-align:right}
.sd-table tr.grp th{border-bottom:0;padding-bottom:2px}
.sd-table th.gh{font-family:Georgia,serif;font-size:13px;text-transform:none;letter-spacing:0;color:var(--ink);font-weight:600;text-align:center;border-bottom:1px solid var(--line)}
.sd-table .sep{border-left:2px solid var(--line)}
.sd-row td{padding:6px 12px;border-bottom:1px solid #f0ebe0;vertical-align:top}
.sd-row td.lbl{white-space:nowrap}
.sd-row.ind td.lbl{padding-left:24px;color:#3e4d5c}
.sd-row.det.c1 td.lbl{padding-left:40px;font-size:12px;color:#52606e;text-transform:capitalize}
.sd-row.det.gl td.lbl{padding-left:58px;font-size:11.5px;color:#8a96a3}
.sd-row.det.baly td.lbl{padding-left:34px;font-size:12.5px;color:#3e4d5c;font-weight:600}
.sd-row.det.baly .num{font-size:12.5px}
.sd-row.det.balm td.lbl{padding-left:54px;font-size:11.5px;color:#8a96a3}
.sd-row.det.balm .num{font-size:11.5px;color:#52606e}
.sd-row.det td{border-bottom:0;padding-top:3px;padding-bottom:3px}
.sd-group td{background:#f3eee2;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--gold2);font-weight:700;padding:7px 12px}
.sd-row.strong td{font-weight:600}
.sd-row.sub td{font-weight:600;border-top:1px solid var(--line);background:#faf7f0}
.sd-row.tot td{font-weight:700;border-top:2px solid var(--ink);border-bottom:2px solid var(--ink);background:#f3eee2;font-size:14px}
.sd-row.warn td{color:var(--red);font-style:italic;font-size:12px}
.num{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.num.b{font-weight:600}.num.acc{color:var(--gold2)}.num.neg{color:var(--red)}
.num.muted{color:#9aa3ad;font-size:12px}
.refc{line-height:1.25}
.dv{display:block;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;font-variant-numeric:tabular-nums;margin-top:1px}
.dv.up{color:var(--green)}.dv.down{color:var(--red)}
.delta{font-size:11.5px;font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.delta.up{color:var(--green)}.delta.down{color:var(--red)}
.exp{font-family:'IBM Plex Mono',ui-monospace,monospace;width:16px;height:16px;line-height:13px;border:1px solid var(--line);background:var(--paper);border-radius:4px;margin-right:7px;cursor:pointer;color:var(--gold2);font-weight:700;padding:0}
.chart-sec{border-top:1px solid var(--line);margin-top:8px;padding:16px 12px 6px}
.chart-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
.chart-head h3{font-family:Georgia,serif;font-size:16px;font-weight:600;margin:0;color:var(--ink)}
.chart-leg{display:flex;gap:12px;font-size:11px;color:#6a7785}
.chart-leg .lg{display:flex;align-items:center;gap:5px}
.chart-leg .lg::before{content:'';width:14px;height:3px;border-radius:2px;background:currentColor;display:inline-block}
.lg.act{color:var(--ink)}.lg.bud{color:var(--gold)}.lg.vj{color:#9aa3ad}
.chart-ctrls{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}
.chart-ctrls label{display:flex;flex-direction:column;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#6a7785;gap:4px;font-weight:600}
.chart-ctrls select{font-family:inherit;font-size:13px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:7px;padding:6px 9px;min-width:200px}
.chart{width:100%;height:210px;display:block;margin-top:4px}
.chart .grid{stroke:#efe8da;stroke-width:1}
.chart .gy{font-size:8.5px;fill:#aab2bb;font-family:'IBM Plex Mono',monospace;text-anchor:end}
.chart .gx{font-size:9px;fill:#9aa3ad;text-anchor:middle;font-family:'IBM Plex Mono',monospace}
.chart .gx.cur{fill:var(--gold2);font-weight:700}
.chart .ln{fill:none;stroke-width:2}
.chart .ln.act{stroke:var(--ink)}
.chart .ln.bud{stroke:var(--gold);stroke-dasharray:5 3}
.chart .ln.vj{stroke:#b6bec7;stroke-dasharray:2 3}
.chart .dot.act{fill:var(--ink)}
.chart-note{font-size:10.5px;color:#9aa3ad;margin:6px 2px 0}
.sd-foot{font-size:11px;color:#8a96a3;margin-top:16px;line-height:1.5;border-top:1px solid var(--line);padding-top:12px}
@media(max-width:760px){.sd-kpis{grid-template-columns:repeat(2,1fr)}.sd-head{flex-direction:column;align-items:flex-start}.sd-meta{text-align:left}}
`;
