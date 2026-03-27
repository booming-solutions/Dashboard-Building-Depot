'use client';

import { useState, useMemo } from 'react';

const GROUPS = [
  {id:"DANIEL",budget:5835151,invY:5682124,inv1m:5487609,inv12m:6152088,nd:19},
  {id:"GIJS",budget:4112363,invY:4084716,inv1m:3936797,inv12m:4330613,nd:18},
  {id:"HENK",budget:2990184,invY:3480579,inv1m:3564623,inv12m:3170179,nd:9},
  {id:"JOHN",budget:2467401,invY:2517472,inv1m:2471984,inv12m:2708188,nd:9},
  {id:"PASCAL",budget:6370980,invY:5551448,inv1m:5861389,inv12m:5741289,nd:9},
];

const DEPTS = [
  {g:"DANIEL",id:"28",name:"28 DISC KITCHEN APPL BUILT-IN",budget:426019,invY:0,inv1m:0,inv2m:0,inv3m:610354,inv6m:584839,inv12m:497359},
  {g:"DANIEL",id:"34",name:"34 HARDWARE",budget:448044,invY:462113,inv1m:468482,inv2m:439973,inv3m:471969,inv6m:507951,inv12m:571997},
  {g:"DANIEL",id:"36",name:"36 HAND TOOLS",budget:86796,invY:63281,inv1m:68736,inv2m:59525,inv3m:66137,inv6m:74329,inv12m:92522},
  {g:"DANIEL",id:"37",name:"37 SAFETY-TOOLS ACCESSORIES",budget:193596,invY:207845,inv1m:211253,inv2m:204017,inv3m:210699,inv6m:265372,inv12m:210416},
  {g:"DANIEL",id:"50",name:"50 TOYS",budget:225000,invY:373567,inv1m:395350,inv2m:400595,inv3m:417679,inv6m:439993,inv12m:435556},
  {g:"DANIEL",id:"51",name:"51 SPORT",budget:218748,invY:153683,inv1m:168401,inv2m:219777,inv3m:201208,inv6m:227997,inv12m:275371},
  {g:"DANIEL",id:"52",name:"52 LUGGAGE-TRAVEL",budget:49776,invY:30825,inv1m:37607,inv2m:41341,inv3m:44299,inv6m:51397,inv12m:80950},
  {g:"DANIEL",id:"61",name:"61 HOUSEHOLD ITEMS",budget:457140,invY:256847,inv1m:285792,inv2m:281869,inv3m:214315,inv6m:321822,inv12m:238896},
  {g:"DANIEL",id:"62",name:"62 CONSUMABLES",budget:25068,invY:55562,inv1m:41706,inv2m:49203,inv3m:38703,inv6m:36824,inv12m:33941},
  {g:"DANIEL",id:"65",name:"65 STORAGE SOLUTIONS",budget:180252,invY:139347,inv1m:130007,inv2m:127289,inv3m:152540,inv6m:113491,inv12m:92277},
  {g:"DANIEL",id:"66",name:"66 COOKWARE-CUTLERY",budget:283248,invY:208539,inv1m:224646,inv2m:259982,inv3m:263548,inv6m:275178,inv12m:205161},
  {g:"DANIEL",id:"67",name:"67 DRINKWARE-DINNERWARE",budget:133752,invY:142147,inv1m:102002,inv2m:102368,inv3m:120816,inv6m:99975,inv12m:110548},
  {g:"DANIEL",id:"69",name:"69 SCHOOL-OFFICE SUPPLY",budget:93780,invY:85731,inv1m:91503,inv2m:96456,inv3m:99173,inv6m:114349,inv12m:75639},
  {g:"DANIEL",id:"77",name:"77 SMALL APPLIANCES 220V",budget:360000,invY:426288,inv1m:488145,inv2m:459532,inv3m:460928,inv6m:457349,inv12m:314155},
  {g:"DANIEL",id:"78",name:"78 SMALL APPLIANCES 110V",budget:406668,invY:307629,inv1m:332327,inv2m:323483,inv3m:381850,inv6m:306890,inv12m:224609},
  {g:"DANIEL",id:"79",name:"79 AIRCO-FANS",budget:506004,invY:746386,inv1m:504016,inv2m:521691,inv3m:553121,inv6m:584439,inv12m:631538},
  {g:"DANIEL",id:"86",name:"86 APPLIANCES 110 VOLT",budget:616248,invY:521922,inv1m:508435,inv2m:634265,inv3m:648412,inv6m:943152,inv12m:753709},
  {g:"DANIEL",id:"87",name:"87 APPLIANCES 220 VOLT",budget:543756,invY:1088513,inv1m:983475,inv2m:783200,inv3m:807345,inv6m:940067,inv12m:762496},
  {g:"DANIEL",id:"88",name:"88 TELEVISION-AUDIO",budget:581256,invY:411900,inv1m:445725,inv2m:436978,inv3m:421553,inv6m:429344,inv12m:544947},
  {g:"GIJS",id:"54",name:"54 CURTAINS-RODS-BLINDS",budget:176902,invY:189685,inv1m:162897,inv2m:180193,inv3m:195905,inv6m:312170,inv12m:342334},
  {g:"GIJS",id:"56",name:"56 CARPETS",budget:51568,invY:22102,inv1m:26254,inv2m:28265,inv3m:31059,inv6m:51284,inv12m:38051},
  {g:"GIJS",id:"58",name:"58 LIGHTING",budget:216000,invY:238874,inv1m:251404,inv2m:268872,inv3m:277042,inv6m:228661,inv12m:285283},
  {g:"GIJS",id:"63",name:"63 HARDWOOD FURNITURE",budget:54672,invY:52009,inv1m:51258,inv2m:51258,inv3m:50008,inv6m:20633,inv12m:38575},
  {g:"GIJS",id:"68",name:"68 CHRISTMAS",budget:150000,invY:93287,inv1m:93289,inv2m:99804,inv3m:100184,inv6m:136058,inv12m:127269},
  {g:"GIJS",id:"70",name:"70 HOME DECORATION",budget:283332,invY:213372,inv1m:203094,inv2m:211796,inv3m:204978,inv6m:221367,inv12m:263027},
  {g:"GIJS",id:"71",name:"71 SOLOW",budget:41424,invY:53571,inv1m:49297,inv2m:60137,inv3m:67485,inv6m:56544,inv12m:43380},
  {g:"GIJS",id:"73",name:"73 BEDLINEN",budget:300000,invY:277996,inv1m:269460,inv2m:290937,inv3m:338695,inv6m:443526,inv12m:328575},
  {g:"GIJS",id:"75",name:"75 IMPULSE PRODUCTS",budget:55718,invY:58453,inv1m:61790,inv2m:59703,inv3m:63786,inv6m:89556,inv12m:132246},
  {g:"GIJS",id:"76",name:"76 BATHMATS-CURTAINS-TOWELS",budget:136500,invY:43876,inv1m:52995,inv2m:49674,inv3m:73129,inv6m:156579,inv12m:130235},
  {g:"GIJS",id:"80",name:"80 OUTDOOR FURNITURE",budget:586663,invY:517647,inv1m:547661,inv2m:407519,inv3m:394298,inv6m:478519,inv12m:369729},
  {g:"GIJS",id:"82",name:"82 OUTDOOR DECORATION",budget:146664,invY:175658,inv1m:183070,inv2m:148807,inv3m:147423,inv6m:163422,inv12m:192744},
  {g:"GIJS",id:"83",name:"83 ARTIFICIAL PLANTS-POTS",budget:190668,invY:272284,inv1m:196109,inv2m:198843,inv3m:189150,inv6m:162007,inv12m:216476},
  {g:"GIJS",id:"90",name:"90 MATTRESS-PILLOW-TOPPER",budget:153756,invY:188565,inv1m:108787,inv2m:125817,inv3m:154489,inv6m:167158,inv12m:142292},
  {g:"GIJS",id:"92",name:"92 BEDROOM FURNITURE",budget:375000,invY:465149,inv1m:507411,inv2m:475689,inv3m:360589,inv6m:425855,inv12m:397713},
  {g:"GIJS",id:"94",name:"94 INDOOR SEATING",budget:787668,invY:852692,inv1m:782809,inv2m:787170,inv3m:620719,inv6m:868761,inv12m:905816},
  {g:"GIJS",id:"95",name:"95 OFFICE FURNITURE",budget:83328,invY:83720,inv1m:97005,inv2m:83760,inv3m:93739,inv6m:76391,inv12m:71719},
  {g:"GIJS",id:"96",name:"96 INDOOR FURNITURE",budget:322500,invY:285775,inv1m:292207,inv2m:248614,inv3m:233286,inv6m:233392,inv12m:305148},
  {g:"HENK",id:"19",name:"19 VINYL-LAMINATE-CARPET",budget:208332,invY:242413,inv1m:280510,inv2m:241002,inv3m:199622,inv6m:214495,inv12m:185830},
  {g:"HENK",id:"20",name:"20 TILES",budget:567852,invY:1057463,inv1m:1039675,inv2m:1083845,inv3m:897056,inv6m:681960,inv12m:741936},
  {g:"HENK",id:"21",name:"21 SANITARY WARE",budget:297504,invY:350251,inv1m:240411,inv2m:257519,inv3m:199273,inv6m:128111,inv12m:306273},
  {g:"HENK",id:"22",name:"22 BATHROOM FURNITURE",budget:236004,invY:264370,inv1m:298197,inv2m:209003,inv3m:215195,inv6m:292982,inv12m:375134},
  {g:"HENK",id:"23",name:"23 FAUCETS-SHOWERSET-SINKS",budget:275328,invY:470522,inv1m:499828,inv2m:513617,inv3m:526009,inv6m:579279,inv12m:542379},
  {g:"HENK",id:"25",name:"25 KITCHEN-TOPS",budget:249996,invY:173261,inv1m:188039,inv2m:196858,inv3m:199647,inv6m:140881,inv12m:137788},
  {g:"HENK",id:"27",name:"27 KEUKEN DEPOT",budget:177672,invY:232535,inv1m:283582,inv2m:237050,inv3m:214402,inv6m:163107,inv12m:199288},
  {g:"HENK",id:"40",name:"40 PLUMBING",budget:812496,invY:655782,inv1m:694537,inv2m:744783,inv3m:678918,inv6m:710475,inv12m:549261},
  {g:"HENK",id:"44",name:"44 BATHROOM ACCESSORIES",budget:165000,invY:33982,inv1m:39844,inv2m:179664,inv3m:106336,inv6m:139174,inv12m:132291},
  {g:"JOHN",id:"11",name:"11 PAINT",budget:249996,invY:329567,inv1m:367321,inv2m:265022,inv3m:275886,inv6m:202915,inv12m:234530},
  {g:"JOHN",id:"12",name:"12 PAINT INTERNATIONAL",budget:167112,invY:0,inv1m:0,inv2m:130057,inv3m:134833,inv6m:181293,inv12m:251811},
  {g:"JOHN",id:"13",name:"13 PAINT ACCESSORIES",budget:240000,invY:154683,inv1m:161181,inv2m:145436,inv3m:146580,inv6m:196555,inv12m:233113},
  {g:"JOHN",id:"15",name:"15 ELECTRICAL SUPPLIES",budget:258000,invY:273911,inv1m:285370,inv2m:262481,inv3m:254071,inv6m:326316,inv12m:305517},
  {g:"JOHN",id:"30",name:"30 POWER TOOLS",budget:568404,invY:456921,inv1m:483280,inv2m:475146,inv3m:455946,inv6m:533101,inv12m:510670},
  {g:"JOHN",id:"39",name:"39 FASTENERS",budget:360000,invY:464343,inv1m:362877,inv2m:438705,inv3m:452839,inv6m:462939,inv12m:372517},
  {g:"JOHN",id:"41",name:"41 BARBEQUE-COOLERS",budget:280764,invY:269905,inv1m:200425,inv2m:252876,inv3m:326235,inv6m:326686,inv12m:292767},
  {g:"JOHN",id:"42",name:"42 LAWN-GARDEN",budget:240000,invY:207940,inv1m:217663,inv2m:203723,inv3m:218147,inv6m:188720,inv12m:250962},
  {g:"JOHN",id:"43",name:"43 POOLS-INFLATABLES",budget:103125,invY:360202,inv1m:393868,inv2m:236662,inv3m:157881,inv6m:197822,inv12m:256300},
  {g:"PASCAL",id:"01",name:"01 STEEL",budget:937500,invY:555035,inv1m:782164,inv2m:978369,inv3m:756276,inv6m:1165294,inv12m:843669},
  {g:"PASCAL",id:"02",name:"02 FENCING",budget:321600,invY:333654,inv1m:352208,inv2m:380165,inv3m:396610,inv6m:345330,inv12m:357414},
  {g:"PASCAL",id:"03",name:"03 LUMBER-MOULDING-PLINTHS",budget:1306248,invY:1011793,inv1m:1111900,inv2m:914984,inv3m:847501,inv6m:854040,inv12m:1340702},
  {g:"PASCAL",id:"04",name:"04 BOARDS",budget:1209096,invY:877564,inv1m:655473,inv2m:885196,inv3m:850076,inv6m:1031144,inv12m:1003401},
  {g:"PASCAL",id:"05",name:"05 CEMENT-TILE ADHESIVE",budget:94872,invY:119645,inv1m:56795,inv2m:116122,inv3m:106616,inv6m:91420,inv12m:120893},
  {g:"PASCAL",id:"06",name:"06 ROOFING",budget:637500,invY:498196,inv1m:401396,inv2m:386565,inv3m:484661,inv6m:538411,inv12m:334535},
  {g:"PASCAL",id:"07",name:"07 WOODEN DOORS",budget:446664,invY:295203,inv1m:362265,inv2m:407421,inv3m:438482,inv6m:411560,inv12m:279310},
  {g:"PASCAL",id:"08",name:"08 ALUMINUM DOORS-WINDOWS",budget:1417500,invY:1860357,inv1m:2139188,inv2m:1792715,inv3m:1678840,inv6m:1492933,inv12m:1461368},
  {g:"PASCAL",id:"09",name:"09 PROJECT COMMISION",budget:0,invY:0,inv1m:0,inv2m:0,inv3m:0,inv6m:0,inv12m:-4},
];

const fmt = n => (n||0).toLocaleString('nl-NL',{minimumFractionDigits:0,maximumFractionDigits:0});
const fmtM = n => {const a=Math.abs(n||0);return(n<0?'-':'')+(a>=1e6?(a/1e6).toFixed(2)+'M':fmt(Math.round(a)))};
const fmtP = n => (n||0).toFixed(1)+'%';
const pctDiff = (c,r) => r ? ((c-r)/Math.abs(r)*100) : null;

function Pill({label,active,onClick,count}){
  return <button className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all border whitespace-nowrap ${active?"bg-[#E84E1B] text-white border-[#E84E1B]":"bg-white text-[#6b5240] border-[#e5ddd4] hover:border-[#E84E1B]"}`} onClick={onClick}>
    {label}{count!==undefined&&<span className="ml-1 opacity-70">({count})</span>}
  </button>;
}

function KPI({label,value,sub1Label,sub1Value,sub2,borderColor}){
  return(
    <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 relative overflow-hidden shadow-sm">
      <div className="absolute top-0 left-0 right-0 h-[3px]" style={{backgroundColor:borderColor||'#E84E1B'}}/>
      <p className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[1px]">{label}</p>
      <p className="text-[36px] font-semibold text-[#1a0a04] mt-1 font-mono tracking-tight leading-tight">{value}</p>
      {sub1Label&&<p className="text-[13px] text-[#6b5240] font-mono mt-1">{sub1Label}: {sub1Value}</p>}
      {sub2!==null&&sub2!==undefined&&<span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono mt-1 ${sub2>=0?'bg-green-50 text-green-600':'bg-red-50 text-red-600'}`}>{sub2>=0?'+':''}{fmtP(sub2)}</span>}
    </div>
  );
}

function budgetColor(invY,budget){
  if(!budget||budget===0)return '#6b5240';
  const r=invY/budget;
  if(r>1.15)return '#dc2626';
  if(r>1.0)return '#d97706';
  if(r<0.7)return '#2563eb';
  return '#16a34a';
}

export default function InventoryBudgetPage(){
  const[selectedGroup,setSelectedGroup]=useState(null);
  const[sortCol,setSortCol]=useState('invY');
  const[sortDir,setSortDir]=useState('desc');
  const[search,setSearch]=useState('');

  const totalBudget=GROUPS.reduce((s,g)=>s+g.budget,0);
  const totalInvY=GROUPS.reduce((s,g)=>s+g.invY,0);
  const totalInv12m=GROUPS.reduce((s,g)=>s+g.inv12m,0);

  const filteredDepts=useMemo(()=>{
    let d=selectedGroup?DEPTS.filter(x=>x.g===selectedGroup):DEPTS;
    if(search)d=d.filter(x=>x.name.toLowerCase().includes(search.toLowerCase()));
    return[...d].sort((a,b)=>{
      if(sortCol==='name')return sortDir==='desc'?b.name.localeCompare(a.name):a.name.localeCompare(b.name);
      return sortDir==='desc'?(b[sortCol]||0)-(a[sortCol]||0):(a[sortCol]||0)-(b[sortCol]||0);
    });
  },[selectedGroup,sortCol,sortDir,search]);

  const maxInv=useMemo(()=>Math.max(...filteredDepts.map(d=>Math.max(d.budget,d.invY))),[filteredDepts]);

  function toggleSort(c){if(sortCol===c)setSortDir(d=>d==='desc'?'asc':'desc');else{setSortCol(c);setSortDir('desc')}}

  return(
    <div className="max-w-[1520px] mx-auto" style={{fontFamily:"'DM Sans',-apple-system,sans-serif",color:'#1a0a04'}}>

      {/* Header */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 mb-5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <img src="/logo.png" alt="Logo" className="h-12 rounded-lg"/>
          <div>
            <h1 style={{fontFamily:"'Playfair Display',Georgia,serif",fontSize:'24px',fontWeight:900}}>Inventory vs Budget Dashboard</h1>
            <p className="text-[13px] text-[#6b5240]">Building Depot — data per 26 Mrt 2026</p>
          </div>
        </div>
        <div className="border-2 border-[#E84E1B] text-[#E84E1B] px-4 py-1.5 rounded-full text-[13px] font-bold">Curaçao · ANG</div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-4 mb-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Store</span>
          <div className="flex gap-1">
            <Pill label="Curaçao" active={true} onClick={()=>{}}/>
            <Pill label="Bonaire" active={false} onClick={()=>{}}/>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.8px] w-24">Manager</span>
          <div className="flex gap-1">
            <Pill label="Alle" active={!selectedGroup} onClick={()=>setSelectedGroup(null)}/>
            {GROUPS.map(g=><Pill key={g.id} label={g.id} active={selectedGroup===g.id} onClick={()=>setSelectedGroup(g.id)} count={g.nd}/>)}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <KPI label="Voorraad Gisteren" value={fmtM(totalInvY)} sub1Label="Budget" sub1Value={fmtM(totalBudget)} sub2={pctDiff(totalInvY,totalBudget)} borderColor="#E84E1B"/>
        <KPI label="Budget Voorraad '26" value={fmtM(totalBudget)} sub1Label="Verschil" sub1Value={fmtM(totalInvY-totalBudget)} sub2={pctDiff(totalInvY,totalBudget)} borderColor="#2563eb"/>
        <KPI label="% van Budget" value={fmtP(totalInvY/totalBudget*100)} sub1Label="12M geleden" sub1Value={fmtP(totalInv12m/totalBudget*100)} sub2={pctDiff(totalInvY,totalInv12m)} borderColor={totalInvY>totalBudget?'#d97706':'#16a34a'}/>
      </div>

      {/* Group Summary */}
      {selectedGroup&&(()=>{
        const g=GROUPS.find(x=>x.id===selectedGroup);
        const ratio=g.budget>0?(g.invY/g.budget*100):0;
        const bc=budgetColor(g.invY,g.budget);
        return(
          <div className="bg-white rounded-[14px] border border-[#e5ddd4] border-l-4 p-4 mb-5 flex gap-8 flex-wrap items-center shadow-sm" style={{borderLeftColor:'#E84E1B'}}>
            <div><p className="text-[10px] text-[#6b5240] font-bold uppercase">Budget</p><p className="text-[20px] font-bold font-mono">{fmtM(g.budget)}</p></div>
            <div><p className="text-[10px] text-[#6b5240] font-bold uppercase">Voorraad</p><p className="text-[20px] font-bold font-mono" style={{color:bc}}>{fmtM(g.invY)}</p></div>
            <div><p className="text-[10px] text-[#6b5240] font-bold uppercase">% Budget</p><p className="text-[20px] font-bold font-mono" style={{color:bc}}>{ratio.toFixed(1)}%</p></div>
            <div><p className="text-[10px] text-[#6b5240] font-bold uppercase">vs 12M</p>{(()=>{const v=pctDiff(g.invY,g.inv12m);return v!==null?<span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono mt-1 ${v>=0?'bg-red-50 text-red-600':'bg-green-50 text-green-600'}`}>{v>=0?'+':''}{fmtP(v)}</span>:<span className="text-[#6b5240]">—</span>})()}</div>
          </div>
        );
      })()}

      {/* Detail Table */}
      <div className="bg-white rounded-[14px] border border-[#e5ddd4] p-5 shadow-sm mb-5">
        <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
          <h3 className="text-[15px] font-bold">Departments{selectedGroup?` — ${selectedGroup}`:''}</h3>
          <div className="flex gap-2 items-center">
            <input className="bg-[#faf7f4] border border-[#e5ddd4] px-3 py-1.5 rounded-lg text-[13px] w-[180px]" placeholder="Zoeken..." value={search} onChange={e=>setSearch(e.target.value)}/>
            <span className="text-[12px] text-[#6b5240]">{filteredDepts.length} departementen</span>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] bg-white sticky top-0">Department</th>
                {[['Budget \'26','budget'],['Gisteren','invY'],['% Budget',null],['1M','inv1m'],['3M','inv3m'],['6M','inv6m'],['12M','inv12m'],['vs 12M',null]].map(([l,k],i)=>
                  <th key={i} onClick={()=>k&&toggleSort(k)} className={`text-right p-3 text-[11px] text-[#6b5240] font-bold uppercase tracking-[0.6px] border-b-2 border-[#e5ddd4] bg-white sticky top-0 whitespace-nowrap ${k?'cursor-pointer hover:text-[#E84E1B]':''}`}>
                    {l}{k&&sortCol===k?(sortDir==='desc'?' ↓':' ↑'):''}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredDepts.map((d,i)=>{
                const ratio=d.budget>0?d.invY/d.budget:null;
                const bc=budgetColor(d.invY,d.budget);
                const v12=pctDiff(d.invY,d.inv12m);
                return(
                  <tr key={d.id+d.g} className="hover:bg-[#faf5f0]">
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] font-medium whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-[8px] h-[8px] rounded-full flex-shrink-0" style={{backgroundColor:bc}}/>
                        {d.name}
                      </div>
                    </td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(d.budget)}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold">{fmt(d.invY)}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono font-semibold" style={{color:bc}}>{ratio!==null?(ratio*100).toFixed(0)+'%':'—'}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(d.inv1m)}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(d.inv3m)}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(d.inv6m)}</td>
                    <td className="p-2.5 text-[13px] border-b border-[#e5ddd4] text-right font-mono text-[#6b5240]">{fmt(d.inv12m)}</td>
                    <td className="p-2.5 border-b border-[#e5ddd4] text-right">
                      {v12!==null?<span className={`inline-block px-2 py-0.5 rounded text-[12px] font-semibold font-mono ${v12>=0?'bg-red-50 text-red-600':'bg-green-50 text-green-600'}`}>{v12>=0?'+':''}{fmtP(v12)}</span>:<span className="text-[#6b5240]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="flex gap-5 mt-4 text-[11px] text-[#6b5240] flex-wrap">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#16a34a]"/>Onder budget</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#d97706]"/>0–15% boven</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#dc2626]"/>&gt;15% boven</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#2563eb]"/>&lt;70% van budget</span>
        </div>
      </div>
    </div>
  );
}
