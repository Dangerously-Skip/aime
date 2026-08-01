:::artifact{title="Fleet Ops — Live Dashboard" type="html"}
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet Ops — Live Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#0a1120; --panel:#111a2b; --panel2:#0e1626; --line:#1e2b40; --line2:#26364f;
    --tx:#dce4f0; --mu:#7c8ca6; --mu2:#5b6b85;
    --grn:#34d399; --amb:#fbbf24; --red:#f87171; --blu:#60a5fa; --vio:#a78bfa; --sl:#64748b;
  }
  html,body{height:100%}
  body{
    background:var(--bg); color:var(--tx);
    font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;
    font-variant-numeric:tabular-nums;
    -webkit-font-smoothing:antialiased;
    padding:8px; display:flex; flex-direction:column; gap:8px;
  }
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
  :focus-visible{outline:2px solid var(--vio);outline-offset:1px;border-radius:3px}

  /* ── top bar ── */
  header{
    display:flex;align-items:center;gap:14px;flex-wrap:wrap;
    background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:7px 11px;
  }
  .brand{display:flex;align-items:baseline;gap:8px}
  .brand b{font-size:14px;letter-spacing:-.2px}
  .brand span{color:var(--mu2);font-size:10.5px;text-transform:uppercase;letter-spacing:.09em}
  .clock{font-size:15px;font-weight:600;letter-spacing:.5px}
  .cdate{color:var(--mu);font-size:10.5px}
  .spacer{flex:1}
  .pill{
    display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:20px;
    background:#0c1524;border:1px solid var(--line2);font-size:10.5px;color:var(--mu)
  }
  .pill b{color:var(--tx);font-weight:600}
  .dot{width:6px;height:6px;border-radius:50%;flex:none}
  .live .dot{background:var(--grn);animation:pulse 1.6s infinite}
  .paused .dot{background:var(--amb);animation:none}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
  .btn{
    padding:4px 10px;border:1px solid var(--line2);border-radius:6px;background:#0c1524;
    font-size:11px;color:var(--mu);transition:150ms ease
  }
  .btn:hover{background:#16223a;color:var(--tx);border-color:#33456a}

  /* ── kpi strip ── */
  .kpis{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}
  .kpi{
    background:var(--panel);border:1px solid var(--line);border-radius:8px;
    padding:7px 10px;position:relative;overflow:hidden
  }
  .kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--sl)}
  .kpi.g::before{background:var(--grn)} .kpi.a::before{background:var(--amb)}
  .kpi.r::before{background:var(--red)} .kpi.b::before{background:var(--blu)}
  .kpi .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--mu2);white-space:nowrap}
  .kpi .v{font-size:20px;font-weight:650;letter-spacing:-.5px;line-height:1.25}
  .kpi .v small{font-size:11px;font-weight:500;color:var(--mu)}
  .kpi .s{font-size:10px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .up{color:var(--grn)} .dn{color:var(--red)} .fl{color:var(--amb)}

  /* ── layout ── */
  .grid{display:grid;grid-template-columns:300px minmax(0,1fr) 320px;gap:8px;flex:1;min-height:0}
  .col{display:flex;flex-direction:column;gap:8px;min-height:0;min-width:0}
  .panel{
    background:var(--panel);border:1px solid var(--line);border-radius:8px;
    display:flex;flex-direction:column;min-height:0;overflow:hidden
  }
  .ph{
    display:flex;align-items:center;gap:8px;padding:6px 9px;border-bottom:1px solid var(--line);
    background:var(--panel2);flex:none
  }
  .ph h2{font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.07em;color:#aebbcf}
  .ph .n{font-size:10px;color:var(--mu2)}
  .body{overflow:auto;flex:1;min-height:0;scrollbar-width:thin;scrollbar-color:#2b3a52 transparent}
  .body::-webkit-scrollbar{width:8px;height:8px}
  .body::-webkit-scrollbar-thumb{background:#2b3a52;border-radius:4px}

  /* ── chips ── */
  .chips{display:flex;gap:3px;flex-wrap:wrap}
  .chip{
    padding:2px 7px;border-radius:5px;border:1px solid var(--line2);background:#0c1524;
    font-size:10px;color:var(--mu);transition:150ms ease;white-space:nowrap
  }
  .chip:hover{color:var(--tx);border-color:#3a4d72}
  .chip.on{background:#22304d;color:#fff;border-color:#42568099}
  .chip i{font-style:normal;color:var(--mu2);margin-left:3px}
  .chip.on i{color:#b9c6da}

  /* ── fleet ── */
  .veh{
    display:grid;grid-template-columns:8px 62px 1fr 46px 38px;gap:7px;align-items:center;
    padding:5px 9px;border-bottom:1px solid #16202f;font-size:11px
  }
  .veh:hover{background:#16203300}
  .veh:hover{background:#151f31}
  .veh .drv{color:var(--mu);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .veh .id{font-size:10.5px;font-weight:600}
  .bar{height:3px;background:#1b2740;border-radius:2px;overflow:hidden;margin-top:3px}
  .bar i{display:block;height:100%;background:var(--blu);border-radius:2px}
  .drift{text-align:right;font-size:10.5px}
  .stops{text-align:right;color:var(--mu);font-size:10px}

  /* ── deliveries table ── */
  table{width:100%;border-collapse:collapse;font-size:11px}
  thead th{
    position:sticky;top:0;z-index:2;background:#101a2a;text-align:left;
    padding:5px 7px;font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;
    color:var(--mu2);border-bottom:1px solid var(--line2);white-space:nowrap;cursor:pointer;user-select:none
  }
  thead th:hover{color:var(--tx)}
  thead th.num,td.num{text-align:right}
  tbody td{padding:3px 7px;border-bottom:1px solid #151e2c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  tbody tr:hover td{background:#151f31}
  tbody tr.late td{background:#2a17174d} tbody tr.late:hover td{background:#341b1b}
  tbody tr.failed td{background:#33121266} tbody tr.failed:hover td{background:#3d1717}
  .tag{
    display:inline-block;padding:1px 6px;border-radius:4px;font-size:9.5px;font-weight:600;
    letter-spacing:.03em;text-transform:uppercase
  }
  .t-delivered{background:#0f3a2d;color:#5eead4} .t-transit{background:#12304f;color:#93c5fd}
  .t-scheduled{background:#1c2434;color:#94a3b8} .t-late{background:#40300d;color:#fcd34d}
  .t-failed{background:#3f1414;color:#fca5a5}
  .srch{
    background:#0c1524;border:1px solid var(--line2);border-radius:5px;color:var(--tx);
    padding:3px 7px;font-size:10.5px;width:120px
  }
  .srch::placeholder{color:var(--mu2)}

  /* ── exceptions ── */
  .exc{padding:7px 9px;border-bottom:1px solid #16202f;display:flex;gap:8px;align-items:flex-start}
  .exc:hover{background:#151f31}
  .exc.new{animation:flash 2.4s ease-out}
  @keyframes flash{0%{background:#2a2140}60%{background:#1a1b2e}100%{background:transparent}}
  .sev{width:3px;border-radius:2px;align-self:stretch;flex:none;min-height:30px}
  .sev.critical{background:var(--red)} .sev.warn{background:var(--amb)} .sev.info{background:var(--blu)}
  .exc .t{font-size:11px;font-weight:600;line-height:1.3}
  .exc .d{font-size:10px;color:var(--mu);line-height:1.4;margin-top:1px}
  .exc .m{display:flex;gap:7px;align-items:center;margin-top:4px;font-size:9.5px;color:var(--mu2)}
  .ack{
    padding:2px 7px;border:1px solid #33456a;border-radius:4px;font-size:9.5px;color:#9fb2cf;
    background:#141f33;transition:150ms ease
  }
  .ack:hover{background:#22304d;color:#fff}
  .empty{padding:26px 12px;text-align:center;color:var(--mu2);font-size:11px}

  /* ── chart ── */
  .chartwrap{position:relative;padding:6px 4px 2px}
  svg{display:block;width:100%;height:auto}
  .tip{
    position:absolute;pointer-events:none;background:#0a1120ee;border:1px solid #33456a;
    border-radius:6px;padding:5px 8px;font-size:10.5px;line-height:1.5;opacity:0;
    transition:opacity 100ms;white-space:nowrap;z-index:5;backdrop-filter:blur(2px)
  }
  .lg{display:flex;gap:12px;font-size:9.5px;color:var(--mu2);padding:0 10px 7px}
  .lg span{display:flex;align-items:center;gap:4px}
  .sw{width:9px;height:2px;border-radius:1px}

  /* ── hubs ── */
  .hub{display:grid;grid-template-columns:1fr 40px 44px 40px;gap:6px;padding:4px 9px;
    border-bottom:1px solid #16202f;font-size:10.5px;align-items:center}
  .hub:hover{background:#151f31}
  .hub .nm{font-weight:600} .hub .x{text-align:right;color:var(--mu)}

  @media(max-width:1180px){
    .kpis{grid-template-columns:repeat(4,1fr)}
    .grid{grid-template-columns:1fr;overflow:auto}
    .panel{max-height:420px}
  }
  @media(max-width:640px){
    .kpis{grid-template-columns:repeat(2,1fr)}
    .btn,.ack,.chip{min-height:32px;display:inline-flex;align-items:center}
  }
</style>
</head>
<body>

<header>
  <div class="brand"><b>MERIDIAN LOGISTICS</b><span>Ops Control · North Region</span></div>
  <div>
    <div class="clock mono" id="clock">--:--:--</div>
    <div class="cdate" id="cdate">—</div>
  </div>
  <div class="spacer"></div>
  <span class="pill" id="livePill"><i class="dot"></i><span id="liveTxt">Live</span> · <b id="tickN">0</b> upd</span>
  <span class="pill">Acked today <b id="ackN">0</b></span>
  <span class="pill">SLA target <b>95.0%</b></span>
  <button class="btn" id="pauseBtn" aria-pressed="false">Pause feed</button>
  <button class="btn" id="resetBtn">Reset</button>
</header>

<div class="kpis" id="kpis"></div>

<div class="grid">

  <!-- LEFT: fleet -->
  <div class="col">
    <section class="panel" style="flex:1">
      <div class="ph">
        <h2>Fleet status</h2>
        <span class="n" id="fleetN"></span>
        <div class="spacer"></div>
      </div>
      <div class="ph" style="padding:5px 9px">
        <div class="chips" id="fleetChips"></div>
      </div>
      <div class="body" id="fleetList"></div>
    </section>
    <section class="panel" style="flex:none">
      <div class="ph"><h2>Depot throughput</h2><div class="spacer"></div><span class="n">bays · dwell</span></div>
      <div id="hubList"></div>
    </section>
  </div>

  <!-- CENTER: chart + deliveries -->
  <div class="col">
    <section class="panel" style="flex:none">
      <div class="ph">
        <h2>On-time rate — last 30 days</h2>
        <div class="spacer"></div>
        <span class="n" id="chartMeta"></span>
      </div>
      <div class="chartwrap" id="chartWrap">
        <div id="chart"></div>
        <div class="tip" id="tip"></div>
      </div>
      <div class="lg">
        <span><i class="sw" style="background:var(--vio)"></i>On-time %</span>
        <span><i class="sw" style="background:#3b4a6b;height:7px;width:7px;border-radius:1px"></i>Volume</span>
        <span><i class="sw" style="background:var(--grn)"></i>95% target</span>
      </div>
    </section>

    <section class="panel" style="flex:1">
      <div class="ph">
        <h2>Today's deliveries</h2>
        <span class="n" id="delN"></span>
        <div class="spacer"></div>
        <input class="srch" id="q" type="search" placeholder="Filter customer / ref / city" aria-label="Search deliveries">
      </div>
      <div class="ph" style="padding:5px 9px"><div class="chips" id="delChips"></div></div>
      <div class="body">
        <table>
          <thead><tr>
            <th data-k="id">Ref</th>
            <th data-k="win">Window</th>
            <th data-k="cust">Customer</th>
            <th data-k="city">City</th>
            <th data-k="van">Van</th>
            <th data-k="drv">Driver</th>
            <th data-k="status">Status</th>
            <th data-k="delay" class="num">Δ</th>
          </tr></thead>
          <tbody id="delBody"></tbody>
        </table>
      </div>
    </section>
  </div>

  <!-- RIGHT: exceptions -->
  <div class="col">
    <section class="panel" style="flex:1">
      <div class="ph">
        <h2>Exceptions</h2>
        <span class="n" id="exN"></span>
        <div class="spacer"></div>
        <button class="btn" id="ackAll" style="padding:2px 8px;font-size:10px">Ack all info</button>
      </div>
      <div class="body" id="exList"></div>
    </section>
  </div>

</div>

<script>
(() => {
"use strict";

/* ─────────── data ─────────── */
const DRIVERS = ["A. Okafor","J. Whitfield","S. Nowak","R. Mehta","T. Bergström","L. Duarte","M. Kowalski",
  "K. Adeyemi","D. Fitzgerald","P. Ramos","N. Haddad","C. Lindqvist","E. Baptiste","H. Yilmaz","G. Mbeki",
  "V. Petrov","O. Sørensen","F. Castellano","B. Nakamura","W. Achebe","I. Kovač","Z. Ferreira","Q. Zhang","U. Bello"];
const CITIES = ["Manchester","Leeds","Sheffield","Liverpool","Bradford","Bolton","Stockport","Oldham","Rochdale",
  "Warrington","Preston","Wigan","Salford","Huddersfield","Wakefield","Chester"];
const CO = ["Northgate","Ashfield","Vertex","Brightline","Halcyon","Kestrel","Ironbridge","Waverly","Peninsula",
  "Cobalt","Marchmont","Redwood","Stanhope","Lattice","Fenwick","Orion","Thornbury","Quayside","Granby","Silverdale"];
const SUF = ["Retail","Pharmacy","Foods","Supplies","Group","& Co","Trading","Clinic","Hardware","Interiors","Motors","Labs"];
const HUBS = [["Trafford Park DC","MCR-1"],["Leeds East","LDS-2"],["Sheffield Tinsley","SHF-1"],["Speke Cross","LVP-3"]];
const V_STAT = {rolling:"var(--grn)",loading:"var(--blu)",delayed:"var(--amb)",idle:"var(--sl)",maintenance:"var(--red)"};
const EX_TYPES = [
  ["critical","Vehicle breakdown","Immobilised — recovery required, {n} stops to reassign"],
  ["critical","Cold chain breach","Reefer temp {t}°C for {n} min — pharma consignment at risk"],
  ["critical","Failed delivery — high value","3rd attempt failed, £{v} consignment returning to depot"],
  ["warn","Driver hours limit","{n} min of legal driving time remaining, {s} stops outstanding"],
  ["warn","Route overrun","Projected +{n} min vs plan — {s} windows at risk"],
  ["warn","Address not found","Geocode mismatch, driver holding at nearest postcode"],
  ["warn","Recipient unavailable","No answer, awaiting instruction — window closes in {n} min"],
  ["warn","Depot bay blocked","Bay {b} occupied {n} min past slot, {s} loads queued"],
  ["info","Damaged parcel reported","Photo logged at scan, claim ref pending"],
  ["info","GPS signal lost","Last ping {n} min ago near {c}"],
  ["info","Missed pickup window","Collection rescheduled to next available slot"],
];

const ri=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const pick=a=>a[Math.floor(Math.random()*a.length)];
const pad=n=>String(n).padStart(2,"0");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const S = {
  paused:false, tick:0, acked:0, exSeq:0,
  vehicles:[], deliveries:[], exceptions:[], hist:[], hubs:[],
  fFilter:"all", dFilter:"all", q:"", sort:{k:"win",dir:1}
};

function build(){
  const now = new Date();
  const mins = now.getHours()*60 + now.getMinutes();

  // vehicles
  S.vehicles = Array.from({length:24},(_,i)=>{
    const st = Math.random()<.06 ? "maintenance" : Math.random()<.1 ? "idle"
             : Math.random()<.16 ? "loading" : Math.random()<.24 ? "delayed" : "rolling";
    const total = ri(18,34);
    const prog = st==="idle"||st==="maintenance" ? 0 : st==="loading" ? ri(0,2)
               : clamp(Math.round(total*(mins-480)/660)+ri(-3,3),0,total);
    return { id:"VAN-"+(101+i), drv:DRIVERS[i], route:"R-"+pad(i+1), status:st,
      done:prog, total, drift: st==="delayed"?ri(14,52):ri(-9,11), load:ri(28,99),
      hub:HUBS[i%4][1] };
  });

  // deliveries
  S.deliveries = [];
  for(let i=0;i<156;i++){
    const v = pick(S.vehicles);
    const h = ri(8,19), w0 = h*60, w1 = w0+ri(60,120);
    let status, delay=0;
    if(w1 < mins-20){
      const r=Math.random();
      status = r<.845?"delivered" : r<.955?"late" : "failed";
      delay = status==="late" ? ri(12,74) : status==="delivered" ? ri(-22,9) : 0;
    } else if(w0 <= mins+45){
      status = "transit"; delay = ri(-14,38);
    } else { status="scheduled"; delay=0; }
    S.deliveries.push({
      id:"DL-"+(48210+i*7), w0, w1,
      cust: pick(CO)+" "+pick(SUF), city: pick(CITIES),
      van: v.id, drv: v.drv, status, delay
    });
  }

  // 30-day history
  S.hist = [];
  let base = 94.1;
  for(let d=29;d>=0;d--){
    const dt = new Date(now); dt.setDate(dt.getDate()-d);
    const dow = dt.getDay(), we = dow===0||dow===6;
    base += (Math.random()-.44)*0.62;
    base = clamp(base, 88.6, 98.4);
    const shock = Math.random()<.09 ? -ri(2,5) : 0;
    S.hist.push({
      dt, otr: clamp(base + shock + (we?0.7:-0.25), 84, 99.4),
      vol: we ? ri(74,132) : ri(168,262)
    });
  }

  // hubs
  S.hubs = HUBS.map(([nm,code])=>({
    nm, code, bays:ri(3,9), cap:12, dwell:ri(14,58), out:ri(4,11)
  }));

  // exceptions
  S.exceptions = [];
  for(let i=0;i<8;i++) newEx(ri(40,2100)*1000);
  S.exceptions.sort((a,b)=>sevRank(a.sev)-sevRank(b.sev));
}

const sevRank = s => s==="critical"?0:s==="warn"?1:2;

function newEx(ageMs){
  const [sev,title,tpl] = pick(EX_TYPES);
  const v = pick(S.vehicles);
  const d = pick(S.deliveries);
  const detail = tpl
    .replace("{n}", ri(6,64)).replace("{s}", ri(2,14))
    .replace("{t}", (ri(82,141)/10).toFixed(1)).replace("{v}", (ri(9,44)*100).toLocaleString())
    .replace("{b}", ri(1,9)).replace("{c}", pick(CITIES));
  const e = { key:"e"+(++S.exSeq), sev, title, detail, van:v.id, drv:v.drv,
    ref: Math.random()<.5 ? v.id : d.id, hub:v.hub, at: Date.now()-(ageMs||0), fresh: !ageMs };
  S.exceptions.unshift(e);
  return e;
}

/* ─────────── formatting ─────────── */
const hhmm = m => pad(Math.floor(m/60)%24)+":"+pad(m%60);
const STAT_LABEL = {delivered:"Delivered",transit:"In transit",scheduled:"Scheduled",late:"Late",failed:"Failed"};
function fmtAge(ms){
  const s=Math.floor(ms/1000);
  if(s<60) return s+"s";
  const m=Math.floor(s/60);
  if(m<60) return m+"m "+pad(s%60)+"s";
  return Math.floor(m/60)+"h "+pad(m%60)+"m";
}
function fmtDelay(d,st){
  if(st==="scheduled"||st==="failed") return '<span style="color:var(--mu2)">—</span>';
  if(d>10) return '<span class="dn">+'+d+'m</span>';
  if(d>0) return '<span class="fl">+'+d+'m</span>';
  if(d<-1) return '<span class="up">'+d+'m</span>';
  return '<span style="color:var(--mu)">on time</span>';
}

/* ─────────── derived ─────────── */
function metrics(){
  const d = S.deliveries;
  const by = {delivered:0,transit:0,scheduled:0,late:0,failed:0};
  let delaySum=0, delayN=0;
  d.forEach(x=>{ by[x.status]++; if(x.status==="transit"&&x.delay>0){delaySum+=x.delay;delayN++;} });
  const done = by.delivered+by.late+by.failed;
  const otr = done ? (by.delivered/done)*100 : 100;
  const veh = {};
  Object.keys(V_STAT).forEach(k=>veh[k]=0);
  S.vehicles.forEach(v=>veh[v.status]++);
  const stops = S.vehicles.reduce((a,v)=>a+v.done,0);
  const stopsT = S.vehicles.reduce((a,v)=>a+v.total,0);
  return { by, done, total:d.length, otr, veh,
    active: veh.rolling+veh.loading+veh.delayed,
    avgDelay: delayN?delaySum/delayN:0,
    crit: S.exceptions.filter(e=>e.sev==="critical").length,
    routePct: stopsT?stops/stopsT*100:0, stops, stopsT };
}

/* ─────────── renders ─────────── */
function renderKpis(){
  const m = metrics(), y = S.hist[S.hist.length-2].otr;
  const dl = m.otr - y;
  const k = [
    {c: m.otr>=95?"g":m.otr>=92?"a":"r", k:"On-time rate · today", v:m.otr.toFixed(1)+"<small>%</small>",
     s:(dl>=0?'<span class="up">▲ '+dl.toFixed(1):'<span class="dn">▼ '+Math.abs(dl).toFixed(1))+" pts</span> vs yesterday"},
    {c:"b", k:"Deliveries completed", v:m.done+'<small>/'+m.total+"</small>",
     s:(m.done/m.total*100).toFixed(0)+"% of manifest · "+m.by.transit+" in flight"},
    {c:"b", k:"Active vehicles", v:m.active+'<small>/'+S.vehicles.length+"</small>",
     s:m.veh.loading+" loading · "+m.veh.idle+" idle · "+m.veh.maintenance+" workshop"},
    {c:m.avgDelay>25?"r":m.avgDelay>12?"a":"g", k:"Avg running delay", v:"+"+m.avgDelay.toFixed(0)+"<small>min</small>",
     s:m.veh.delayed+" vehicles behind plan"},
    {c: m.crit?"r":"a", k:"Open exceptions", v:S.exceptions.length,
     s:m.crit+" critical · "+S.exceptions.filter(e=>e.sev==="warn").length+" warning"},
    {c:"a", k:"Late / failed", v:m.by.late+'<small> / '+m.by.failed+"</small>",
     s:"SLA breach cost ≈ £"+((m.by.late*14)+(m.by.failed*62)).toLocaleString()},
    {c:"b", k:"Route completion", v:m.routePct.toFixed(0)+"<small>%</small>",
     s:m.stops+" of "+m.stopsT+" stops scanned"},
  ];
  document.getElementById("kpis").innerHTML = k.map(x =>
    '<div class="kpi '+x.c+'"><div class="k">'+x.k+'</div><div class="v">'+x.v+'</div><div class="s">'+x.s+'</div></div>'
  ).join("");
}

function renderFleetChips(){
  const m = metrics();
  const order = ["all","rolling","delayed","loading","idle","maintenance"];
  document.getElementById("fleetChips").innerHTML = order.map(k=>{
    const n = k==="all" ? S.vehicles.length : m.veh[k];
    const lbl = k==="all" ? "All" : k[0].toUpperCase()+k.slice(1);
    return '<button class="chip'+(S.fFilter===k?" on":"")+'" data-f="'+k+'">'+
      (k!=="all"?'<span class="dot" style="display:inline-block;background:'+V_STAT[k]+'"></span> ':'')+
      lbl+'<i>'+n+'</i></button>';
  }).join("");
}

function renderFleet(){
  const list = S.vehicles.filter(v=>S.fFilter==="all"||v.status===S.fFilter)
    .sort((a,b)=> sevOrder(a)-sevOrder(b) || b.drift-a.drift);
  document.getElementById("fleetN").textContent = list.length+" shown";
  document.getElementById("fleetList").innerHTML = list.length ? list.map(v=>{
    const pct = v.total? v.done/v.total*100 : 0;
    const dr = v.status==="idle"||v.status==="maintenance" ? '<span style="color:var(--mu2)">—</span>'
      : v.drift>12 ? '<span class="dn">+'+v.drift+'m</span>'
      : v.drift>0 ? '<span class="fl">+'+v.drift+'m</span>' : '<span class="up">'+v.drift+'m</span>';
    return '<div class="veh">'+
      '<span class="dot" style="background:'+V_STAT[v.status]+'"></span>'+
      '<div><div class="id mono">'+v.id+'</div><div class="drv">'+v.route+' · '+v.hub+'</div></div>'+
      '<div><div class="drv" style="color:var(--tx);font-size:10.5px">'+v.drv+'</div>'+
        '<div class="bar"><i style="width:'+pct.toFixed(0)+'%;background:'+V_STAT[v.status]+'"></i></div></div>'+
      '<div class="drift">'+dr+'</div>'+
      '<div class="stops mono">'+v.done+'/'+v.total+'</div>'+
    '</div>';
  }).join("") : '<div class="empty">No vehicles in this state.</div>';
}
const sevOrder = v => ({maintenance:0,delayed:1,loading:2,rolling:3,idle:4})[v.status];

function renderDelChips(){
  const m = metrics();
  const order = [["all","All"],["transit","In transit"],["late","Late"],["failed","Failed"],
                 ["delivered","Delivered"],["scheduled","Scheduled"]];
  document.getElementById("delChips").innerHTML = order.map(([k,l])=>{
    const n = k==="all" ? S.deliveries.length : m.by[k];
    return '<button class="chip'+(S.dFilter===k?" on":"")+'" data-d="'+k+'">'+l+'<i>'+n+'</i></button>';
  }).join("");
}

function renderDeliveries(){
  const q = S.q.trim().toLowerCase();
  let rows = S.deliveries.filter(d =>
    (S.dFilter==="all" || d.status===S.dFilter) &&
    (!q || d.cust.toLowerCase().includes(q) || d.id.toLowerCase().includes(q) ||
      d.city.toLowerCase().includes(q) || d.van.toLowerCase().includes(q) || d.drv.toLowerCase().includes(q))
  );
  const {k,dir} = S.sort;
  const val = d => k==="win" ? d.w0 : k==="delay" ? d.delay : k==="status" ? STAT_LABEL[d.status] : d[k];
  rows.sort((a,b)=>{ const x=val(a),y=val(b);
    return (typeof x==="number" ? x-y : String(x).localeCompare(String(y)))*dir; });

  document.getElementById("delN").textContent = rows.length+" of "+S.deliveries.length;
  document.getElementById("delBody").innerHTML = rows.length ? rows.map(d=>{
    const cls = d.status==="late"?" class=\"late\"" : d.status==="failed"?" class=\"failed\"" : "";
    return "<tr"+cls+">"+
      '<td class="mono" style="color:var(--mu)">'+d.id+"</td>"+
      '<td class="mono">'+hhmm(d.w0)+"–"+hhmm(d.w1)+"</td>"+
      "<td>"+d.cust+"</td><td>"+d.city+"</td>"+
      '<td class="mono">'+d.van+"</td><td>"+d.drv+"</td>"+
      '<td><span class="tag t-'+d.status+'">'+STAT_LABEL[d.status]+"</span></td>"+
      '<td class="num mono">'+fmtDelay(d.delay,d.status)+"</td></tr>";
  }).join("") : '<tr><td colspan="8"><div class="empty">Nothing matches that filter.</div></td></tr>';
}

function renderExceptions(){
  const list = S.exceptions.slice().sort((a,b)=>sevRank(a.sev)-sevRank(b.sev)||b.at-a.at);
  const m = metrics();
  document.getElementById("exN").textContent = m.crit ? m.crit+" critical" : list.length+" open";
  document.getElementById("exList").innerHTML = list.length ? list.map(e=>
    '<div class="exc'+(e.fresh?" new":"")+'" data-k="'+e.key+'">'+
      '<div class="sev '+e.sev+'"></div>'+
      '<div style="flex:1;min-width:0">'+
        '<div class="t">'+e.title+'</div>'+
        '<div class="d">'+e.detail+'</div>'+
        '<div class="m"><span class="mono" style="color:#8fa2bd">'+e.ref+'</span>'+
          '<span>·</span><span>'+e.drv+'</span><span>·</span><span>'+e.hub+'</span>'+
          '<span>·</span><span data-age="'+e.at+'">'+fmtAge(Date.now()-e.at)+'</span>'+
        '</div>'+
      '</div>'+
      '<button class="ack" data-ack="'+e.key+'">Ack</button>'+
    '</div>'
  ).join("") : '<div class="empty">Queue clear. Nothing needs attention.</div>';
  S.exceptions.forEach(e=>e.fresh=false);
}

function renderHubs(){
  document.getElementById("hubList").innerHTML = S.hubs.map(h=>{
    const p = h.bays/h.cap*100;
    const c = p>75?"var(--red)":p>50?"var(--amb)":"var(--grn)";
    return '<div class="hub"><div><div class="nm">'+h.nm+'</div>'+
      '<div class="bar" style="width:100%"><i style="width:'+p.toFixed(0)+'%;background:'+c+'"></i></div></div>'+
      '<div class="x mono">'+h.bays+'/'+h.cap+'</div>'+
      '<div class="x mono" style="color:'+(h.dwell>45?"var(--amb)":"var(--mu)")+'">'+h.dwell+'m</div>'+
      '<div class="x mono">'+h.out+' out</div></div>';
  }).join("");
}

/* ─────────── hand-rolled chart ─────────── */
const CW=760, CH=192, PL=32, PR=34, PT=10, PB=22;
const IW=CW-PL-PR, IH=CH-PT-PB;
let cScale = {lo:88, hi:100};

function renderChart(){
  const h = S.hist;
  const maxV = Math.max(...h.map(d=>d.vol))*1.05;
  const lo = Math.floor(Math.min(...h.map(d=>d.otr))-1.5);
  const hi = 100;
  cScale = {lo,hi};
  const Y = v => PT+IH-((v-lo)/(hi-lo))*IH;
  const X = i => PL+(IW/h.length)*(i+.5);
  const bw = Math.max(4,(IW/h.length)-3.5);

  let g = "";
  [lo, 90, 95, 100].filter(v=>v>=lo&&v<=hi).forEach(v=>{
    g += '<line x1="'+PL+'" x2="'+(CW-PR)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+
      '" stroke="'+(v===95?"#34d39955":"#1e2b40")+'" stroke-width="1"'+(v===95?' stroke-dasharray="3 3"':'')+'/>'+
      '<text x="'+(PL-6)+'" y="'+(Y(v)+3).toFixed(1)+'" fill="#5b6b85" font-size="9" text-anchor="end">'+v.toFixed(0)+'%</text>';
  });
  // target band
  g += '<rect x="'+PL+'" y="'+Y(100).toFixed(1)+'" width="'+IW+'" height="'+(Y(95)-Y(100)).toFixed(1)+
       '" fill="#34d399" opacity="0.05"/>';

  // volume bars
  let bars = "";
  h.forEach((d,i)=>{
    const bh = (d.vol/maxV)*IH*0.6;
    bars += '<rect x="'+(X(i)-bw/2).toFixed(1)+'" y="'+(PT+IH-bh).toFixed(1)+'" width="'+bw.toFixed(1)+
      '" height="'+bh.toFixed(1)+'" fill="#3b4a6b" opacity="0.55" rx="1"/>';
  });

  // line + dots
  const pts = h.map((d,i)=>X(i).toFixed(1)+","+Y(d.otr).toFixed(1)).join(" ");
  const area = 'M'+PL+','+(PT+IH)+' L'+pts.replace(/ /g," L")+' L'+(CW-PR)+','+(PT+IH)+' Z';
  let dots = h.map((d,i)=>{
    const last = i===h.length-1;
    return '<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(d.otr).toFixed(1)+'" r="'+(last?3:1.7)+
      '" fill="'+(last?(d.otr>=95?"#34d399":"#f87171"):"#a78bfa")+'"'+(last?' stroke="#0a1120" stroke-width="1.5"':'')+'/>';
  }).join("");

  // x labels
  let xl = "";
  h.forEach((d,i)=>{
    if(i%5===0 || i===h.length-1){
      const t = i===h.length-1 ? "today"
        : d.dt.getDate()+" "+d.dt.toLocaleString("en-GB",{month:"short"});
      xl += '<text x="'+X(i).toFixed(1)+'" y="'+(CH-6)+'" fill="#5b6b85" font-size="9" text-anchor="middle">'+t+'</text>';
    }
  });

  document.getElementById("chart").innerHTML =
    '<svg viewBox="0 0 '+CW+' '+CH+'" preserveAspectRatio="none" style="height:192px" role="img" '+
    'aria-label="On-time delivery rate over the last 30 days">'+
      '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">'+
        '<stop offset="0%" stop-color="#a78bfa" stop-opacity="0.22"/>'+
        '<stop offset="100%" stop-color="#a78bfa" stop-opacity="0"/></linearGradient></defs>'+
      g + bars +
      '<path d="'+area+'" fill="url(#ag)"/>'+
      '<polyline points="'+pts+'" fill="none" stroke="#a78bfa" stroke-width="1.8" stroke-linejoin="round"/>'+
      dots +
      '<line id="gd" x1="0" x2="0" y1="'+PT+'" y2="'+(PT+IH)+'" stroke="#8fa2bd" stroke-width="1" opacity="0"/>'+
      xl +
    '</svg>';

  const avg = h.reduce((a,d)=>a+d.otr,0)/h.length;
  const breaches = h.filter(d=>d.otr<95).length;
  document.getElementById("chartMeta").innerHTML =
    '30d avg <b style="color:'+(avg>=95?"var(--grn)":"var(--amb)")+'">'+avg.toFixed(1)+'%</b> · '+
    breaches+' days below target · '+h.reduce((a,d)=>a+d.vol,0).toLocaleString()+' drops';
}

function chartHover(ev){
  const svg = document.querySelector("#chart svg"); if(!svg) return;
  const r = svg.getBoundingClientRect();
  const sx = CW/r.width;
  const mx = (ev.clientX-r.left)*sx;
  const step = IW/S.hist.length;
  let i = Math.round((mx-PL)/step - .5);
  const tip = document.getElementById("tip");
  const gd = document.getElementById("gd");
  if(i<0 || i>=S.hist.length){ tip.style.opacity=0; if(gd) gd.setAttribute("opacity",0); return; }
  const d = S.hist[i];
  const px = (PL+step*(i+.5))/sx;
  if(gd){ gd.setAttribute("x1",PL+step*(i+.5)); gd.setAttribute("x2",PL+step*(i+.5)); gd.setAttribute("opacity",.45); }
  tip.innerHTML =
    '<b>'+d.dt.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})+'</b><br>'+
    '<span style="color:#a78bfa">On-time</span> <b>'+d.otr.toFixed(1)+'%</b>'+
      (d.otr<95?' <span style="color:var(--red)">▼ target</span>':' <span style="color:var(--grn)">✓</span>')+'<br>'+
    '<span style="color:#8fa2bd">Volume</span> <b>'+d.vol+'</b> · '+
    '<span style="color:#8fa2bd">missed</span> <b>'+Math.round(d.vol*(100-d.otr)/100)+'</b>';
  tip.style.opacity = 1;
  const w = tip.offsetWidth;
  tip.style.left = clamp(px-w/2, 2, r.width-w-2)+"px";
  tip.style.top = "8px";
}

/* ─────────── live tick ─────────── */
function advance(){
  S.tick++;
  const now = new Date(), mins = now.getHours()*60+now.getMinutes();

  // vehicles drift & progress
  S.vehicles.forEach(v=>{
    if(v.status==="rolling"||v.status==="delayed"){
      if(Math.random()<.3 && v.done<v.total) v.done++;
      v.drift = clamp(v.drift + ri(-2,2), -12, 68);
      if(v.drift>26 && v.status==="rolling" && Math.random()<.25) v.status="delayed";
      if(v.drift<14 && v.status==="delayed" && Math.random()<.2) v.status="rolling";
      v.load = clamp(v.load - (Math.random()<.3?ri(1,3):0), 2, 100);
      if(v.done>=v.total && Math.random()<.4){ v.status="idle"; v.drift=0; }
    } else if(v.status==="loading" && Math.random()<.18){ v.status="rolling"; v.load=ri(70,99); }
    else if(v.status==="idle" && Math.random()<.05){ v.status="loading"; v.done=0; v.load=ri(80,99); }
    else if(v.status==="maintenance" && Math.random()<.02){ v.status="idle"; }
  });

  // deliveries progress
  const transit = S.deliveries.filter(d=>d.status==="transit");
  for(let n=0;n<ri(1,3);n++){
    const d = pick(transit); if(!d) break;
    if(Math.random()<.55){
      const r=Math.random();
      d.status = r<.86 ? "delivered" : r<.965 ? "late" : "failed";
      if(d.status==="late") d.delay = Math.max(12, d.delay+ri(4,20));
      if(d.status==="failed") d.delay = 0;
    } else d.delay = clamp(d.delay+ri(-3,5), -20, 90);
  }
  const sched = S.deliveries.filter(d=>d.status==="scheduled" && d.w0<=mins+90);
  for(let n=0;n<ri(1,3);n++){ const d=pick(sched); if(d){ d.status="transit"; d.delay=ri(-12,26); } }

  // hubs
  S.hubs.forEach(h=>{ h.bays=clamp(h.bays+ri(-1,1),0,h.cap);
    h.dwell=clamp(h.dwell+ri(-4,4),8,92); h.out=clamp(h.out+ri(-1,1),0,16); });

  // today's live point
  const m = metrics(), last = S.hist[S.hist.length-1];
  last.otr = m.otr; last.vol = m.done;

  // new exceptions
  if(Math.random()<.22 && S.exceptions.length<14) newEx(0);

  renderKpis(); renderFleetChips(); renderFleet();
  renderDelChips(); renderDeliveries(); renderExceptions(); renderHubs(); renderChart();
  document.getElementById("tickN").textContent = S.tick;
}

/* ─────────── wiring ─────────── */
function clockTick(){
  const n = new Date();
  document.getElementById("clock").textContent = pad(n.getHours())+":"+pad(n.getMinutes())+":"+pad(n.getSeconds());
  document.getElementById("cdate").textContent =
    n.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  document.querySelectorAll("[data-age]").forEach(el=>{
    el.textContent = fmtAge(Date.now()-Number(el.dataset.age));
  });
}

document.getElementById("fleetChips").addEventListener("click",e=>{
  const b=e.target.closest("[data-f]"); if(!b) return;
  S.fFilter=b.dataset.f; renderFleetChips(); renderFleet();
});
document.getElementById("delChips").addEventListener("click",e=>{
  const b=e.target.closest("[data-d]"); if(!b) return;
  S.dFilter=b.dataset.d; renderDelChips(); renderDeliveries();
});
document.querySelectorAll("thead th").forEach(th=>{
  th.addEventListener("click",()=>{
    const k=th.dataset.k;
    S.sort = S.sort.k===k ? {k,dir:-S.sort.dir} : {k,dir:1};
    document.querySelectorAll("thead th").forEach(t=>t.textContent=t.textContent.replace(/ [▲▼]$/,""));
    th.textContent += S.sort.dir>0?" ▲":" ▼";
    renderDeliveries();
  });
});
document.getElementById("q").addEventListener("input",e=>{ S.q=e.target.value; renderDeliveries(); });
document.getElementById("exList").addEventListener("click",e=>{
  const b=e.target.closest("[data-ack]"); if(!b) return;
  S.exceptions = S.exceptions.filter(x=>x.key!==b.dataset.ack);
  S.acked++; document.getElementById("ackN").textContent=S.acked;
  renderExceptions(); renderKpis();
});
document.getElementById("ackAll").addEventListener("click",()=>{
  const n = S.exceptions.filter(e=>e.sev==="info").length;
  S.exceptions = S.exceptions.filter(e=>e.sev!=="info");
  S.acked+=n; document.getElementById("ackN").textContent=S.acked;
  renderExceptions(); renderKpis();
});

let timer=null;
const start=()=>{ timer=setInterval(()=>{ if(!S.paused) advance(); },2000); };
document.getElementById("pauseBtn").addEventListener("click",e=>{
  S.paused=!S.paused;
  e.target.textContent = S.paused?"Resume feed":"Pause feed";
  e.target.setAttribute("aria-pressed",String(S.paused));
  const p=document.getElementById("livePill");
  p.className="pill "+(S.paused?"paused":"live");
  document.getElementById("liveTxt").textContent = S.paused?"Paused":"Live";
});
document.getElementById("resetBtn").addEventListener("click",()=>{
  S.tick=0; S.acked=0; S.exSeq=0; S.fFilter="all"; S.dFilter="all"; S.q="";
  document.getElementById("q").value=""; document.getElementById("ackN").textContent=0;
  document.getElementById("tickN").textContent=0;
  boot();
});
const cw = document.getElementById("chartWrap");
cw.addEventListener("mousemove",chartHover);
cw.addEventListener("mouseleave",()=>{
  document.getElementById("tip").style.opacity=0;
  const gd=document.getElementById("gd"); if(gd) gd.setAttribute("opacity",0);
});

function boot(){
  build();
  renderKpis(); renderFleetChips(); renderFleet();
  renderDelChips(); renderDeliveries(); renderExceptions(); renderHubs(); renderChart();
  clockTick();
}
boot();
document.getElementById("livePill").className="pill live";
setInterval(clockTick,1000);
start();
})();
</script>
</body>
</html>
:::

Built as a live control-room view rather than a report. A few decisions worth flagging:

**Density** — 11–12px base type, tabular figures, 26px table rows, and a seven-tile KPI strip across the top. Everything fits one viewport at 1400px wide with no page scroll; the three panels scroll independently so the KPI strip and chart never leave the screen.

**Fleet column** — 24 vehicles sorted by severity first (workshop, then delayed, then rolling), so the ones you care about are always at the top without you touching a filter. Each row carries a status dot, route, driver, a progress bar for stops scanned, and ETA drift. Status chips double as filters with live counts.

**Deliveries table** — 156 rows, sortable on every column, filter chips plus free-text search across customer, ref, city, van and driver. Late rows are tinted amber and failed rows red so breaches register peripherally rather than needing to be read.

**Exceptions** — severity-ordered with a coloured spine, live-incrementing age counters, and an Ack button per item that clears it and bumps the acked-today count. New ones flash in. "Ack all info" clears the noise floor in one click.

**Chart** — hand-rolled SVG rather than Chart.js, so there's no CDN dependency and I could put volume bars behind the on-time line with a shaded 95–100% target band. Days below target are visibly under the band; hovering gives the date, rate, volume and implied missed drops. Today's point is live and turns red if it drops under SLA.

The feed updates every two seconds — vehicles progress, deliveries resolve, new exceptions arrive. Pause freezes it for when someone needs to actually read a row, and Reset regenerates the whole shift. Data is simulated; wiring it to a real telematics and TMS feed would mean replacing `build()` and `advance()` and leaving the render functions alone.