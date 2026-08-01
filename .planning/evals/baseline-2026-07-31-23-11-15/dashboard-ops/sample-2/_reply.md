I'll build this as a live, self-contained dashboard: real-time clock, simulated telemetry ticking every few seconds, sortable fleet table, acknowledgeable exception queue, and a 30-day on-time chart with a rolling average against target.

:::artifact{title="Meridian Logistics — Ops Control" type="html"}
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meridian Logistics — Ops Control</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
:root{
  --bg:#0a0e1a;--panel:#111726;--head:#0f1523;--line:#1e2740;--line2:#161d2e;
  --tx:#e2e8f0;--mut:#8494b4;--dim:#5f6d8c;
  --acc:#8b5cf6;--ok:#22c55e;--warn:#f59e0b;--crit:#ef4444;--info:#38bdf8;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--tx);font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;-webkit-font-smoothing:antialiased}
.num{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
:focus-visible{outline:2px solid var(--acc);outline-offset:1px}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-thumb{background:#26314d;border-radius:8px}
::-webkit-scrollbar-track{background:transparent}

.wrap{display:grid;grid-template-rows:auto auto 1fr;gap:8px;height:100%;padding:8px}

/* ---- top bar ---- */
.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.brand{display:flex;align-items:baseline;gap:8px}
.brand b{font-size:14px;letter-spacing:.02em}
.brand span{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--acc);font-weight:700}
.top .sep{flex:1}
.clock{font-size:19px;font-weight:700;letter-spacing:.02em}
.date{font-size:10px;color:var(--mut);letter-spacing:.08em;text-transform:uppercase}
.live{display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);font-weight:700}
.dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:pulse 2s infinite}
.dot.off{background:var(--dim);animation:none}
@keyframes pulse{70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.chip{background:#151d2e;border:1px solid var(--line);color:var(--mut);border-radius:5px;padding:4px 8px;font-size:10px;cursor:pointer;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.chip:hover{color:var(--tx);border-color:#2e3a5c}
.chip[aria-pressed="true"]{background:#291f5e;border-color:#5b3fd6;color:#ddd6fe}
input[type="search"]{background:#0c1220;border:1px solid var(--line);color:var(--tx);border-radius:5px;padding:4px 7px;font-size:11px;width:132px}
input[type="search"]::placeholder{color:var(--dim)}

/* ---- kpi strip ---- */
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:7px 10px 8px;position:relative;overflow:hidden}
.kpi::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--acc)}
.kpi.ok::before{background:var(--ok)}.kpi.warn::before{background:var(--warn)}.kpi.crit::before{background:var(--crit)}
.kpi .k{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);font-weight:700}
.kpi .v{font-size:22px;font-weight:700;line-height:1.12;margin-top:2px;letter-spacing:-.01em}
.kpi .s{font-size:10px;color:var(--mut);margin-top:1px}
.up{color:var(--ok)}.dn{color:var(--crit)}

/* ---- layout ---- */
.main{display:grid;grid-template-columns:1.45fr 1.1fr 1fr;gap:8px;min-height:0}
.col{display:grid;grid-template-rows:auto 1fr auto;gap:8px;min-height:0}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.ph{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--line);background:linear-gradient(#141b2c,#111726);flex-wrap:wrap}
.ph h2{margin:0;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--mut);font-weight:700;white-space:nowrap}
.ph .sep{flex:1}
.tag{font-size:9.5px;font-weight:700;letter-spacing:.06em;color:var(--dim)}
.pb{flex:1;min-height:0;overflow:auto}
.pb.pad{padding:8px}

/* ---- table ---- */
table{width:100%;border-collapse:collapse}
th{position:sticky;top:0;background:var(--head);z-index:2;font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);cursor:pointer;white-space:nowrap;user-select:none;font-weight:700}
th:hover{color:var(--tx)}
th .ar{color:var(--acc)}
td{padding:3px 6px;border-bottom:1px solid var(--line2);white-space:nowrap}
tbody tr:hover{background:#171f33}
.r{text-align:right}
.pill{display:inline-block;padding:1px 5px;border-radius:4px;font-size:9px;font-weight:800;letter-spacing:.05em}
.s-route{background:#0d2c20;color:#4ade80;box-shadow:inset 0 0 0 1px #1c5539}
.s-load{background:#0b2434;color:#5cc8f5;box-shadow:inset 0 0 0 1px #17506e}
.s-delay{background:#33230a;color:#fbbf24;box-shadow:inset 0 0 0 1px #6b4a10}
.s-idle{background:#1b2233;color:#93a3c2;box-shadow:inset 0 0 0 1px #2b3category}
.s-idle{box-shadow:inset 0 0 0 1px #2b3550}
.s-maint{background:#331014;color:#f87171;box-shadow:inset 0 0 0 1px #6d1f26}
.s-off{background:#161b28;color:#697899;box-shadow:inset 0 0 0 1px #242d44}
.bar{position:relative;height:5px;border-radius:3px;background:#1c2438;overflow:hidden;min-width:52px}
.bar i{position:absolute;inset:0 auto 0 0;background:var(--acc);border-radius:3px}
.bar i.g{background:var(--ok)}.bar i.a{background:var(--warn)}
.mono-s{font-size:11px}

/* ---- throughput ---- */
.hours{display:flex;align-items:flex-end;gap:3px;height:78px;padding-top:4px}
.hr{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:3px;min-width:0}
.hr .stack{position:relative;width:100%;height:64px;background:#151d2e;border-radius:2px;display:flex;align-items:flex-end;overflow:hidden}
.hr .stack u{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(#a78bfa,#7c3aed);border-radius:2px 2px 0 0}
.hr .stack em{position:absolute;left:0;right:0;height:1px;background:#3d4b70}
.hr b{font-size:8.5px;color:var(--dim);font-weight:700}
.hr.now .stack{box-shadow:inset 0 0 0 1px var(--acc)}
.hr.now b{color:var(--acc)}
.legend{display:flex;gap:10px;font-size:9.5px;color:var(--mut);letter-spacing:.04em}
.legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}

/* ---- split stats ---- */
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px}
.st{background:#0d1322;border:1px solid var(--line2);border-radius:6px;padding:5px 7px}
.st .k{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);font-weight:700}
.st .v{font-size:15px;font-weight:700;margin-top:1px}

/* ---- chart ---- */
.cwrap{position:relative;flex:1;min-height:120px;padding:6px 8px 8px}

/* ---- exceptions ---- */
.ex{display:grid;grid-template-columns:3px 1fr;border-bottom:1px solid var(--line2)}
.ex .sv{background:var(--warn)}
.ex.crit .sv{background:var(--crit)}
.ex.info .sv{background:var(--info)}
.ex.done{opacity:.42}
.ex .body{padding:5px 8px 6px;min-width:0}
.ex .l1{display:flex;align-items:center;gap:7px}
.ex .ty{font-size:10.5px;font-weight:800;letter-spacing:.05em}
.ex.crit .ty{color:#fca5a5}.ex.warn .ty{color:#fcd34d}.ex.info .ty{color:#7dd3fc}
.ex .id{font-size:9.5px;color:var(--dim);font-weight:700}
.ex .l2{font-size:10.5px;color:var(--mut);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ex .l2 b{color:#b9c6e0;font-weight:600}
.ex .sla{font-size:9.5px;font-weight:800;letter-spacing:.03em;color:var(--mut)}
.ex .sla.bad{color:#fca5a5}
.ackb{background:#1a2337;border:1px solid #2c3856;color:#aab8d6;border-radius:4px;font-size:9px;font-weight:800;letter-spacing:.06em;padding:2px 6px;cursor:pointer}
.ackb:hover{background:#26325a;color:#fff}
.ackb.on{background:#0e2a1e;border-color:#1f5b3c;color:#6ee7a4;cursor:default}
.empty{padding:18px;text-align:center;color:var(--dim);font-size:11px}

/* ---- zones ---- */
.zt td,.zt th{padding:2.5px 6px}
.spark{display:inline-flex;gap:1.5px;align-items:flex-end;height:12px}
.spark i{width:3px;background:#3b4a6f;border-radius:1px}

@media (max-width:1180px){
  body{overflow:auto}
  .wrap{height:auto}
  .kpis{grid-template-columns:repeat(3,1fr)}
  .main{grid-template-columns:1fr}
  .panel{max-height:70vh}
  .chip{padding:11px 13px;font-size:11px}
  input[type="search"]{padding:11px 9px;width:100%}
  .ackb{padding:9px 11px}
}
</style>
</head>
<body>
<div class="wrap">

  <!-- TOP BAR -->
  <div class="top">
    <div class="brand"><b>MERIDIAN LOGISTICS</b><span>Ops Control · Depot 04 Rotterdam</span></div>
    <div class="sep"></div>
    <button class="chip" id="liveBtn" aria-pressed="true" onclick="toggleLive()">Live</button>
    <button class="chip" onclick="resetAll()">Reset</button>
    <div class="live"><span class="dot" id="dot"></span><span id="upd">updated 0s ago</span></div>
    <div style="text-align:right">
      <div class="clock num" id="clock">--:--:--</div>
      <div class="date" id="date">—</div>
    </div>
  </div>

  <!-- KPIS -->
  <div class="kpis" id="kpis"></div>

  <!-- MAIN -->
  <div class="main">

    <!-- FLEET -->
    <section class="panel" aria-label="Fleet status">
      <div class="ph">
        <h2>Fleet Status</h2>
        <span class="tag" id="fleetCount">—</span>
        <div class="sep"></div>
        <button class="chip" data-f="all" aria-pressed="true" onclick="setFleetFilter('all')">All</button>
        <button class="chip" data-f="route" aria-pressed="false" onclick="setFleetFilter('route')">Route</button>
        <button class="chip" data-f="delay" aria-pressed="false" onclick="setFleetFilter('delay')">Delayed</button>
        <button class="chip" data-f="off" aria-pressed="false" onclick="setFleetFilter('off')">Down</button>
        <input type="search" id="q" placeholder="Search  /" oninput="setQuery(this.value)" aria-label="Search fleet">
      </div>
      <div class="pb" id="fleetBox"></div>
    </section>

    <!-- CENTER COLUMN -->
    <div class="col">
      <section class="panel" aria-label="Today's deliveries">
        <div class="ph"><h2>Today’s Deliveries</h2><span class="tag" id="tpTag">—</span>
          <div class="sep"></div>
          <div class="legend"><span><i style="background:#7c3aed"></i>Completed</span><span><i style="background:#151d2e;box-shadow:inset 0 0 0 1px #3d4b70"></i>Planned</span></div>
        </div>
        <div class="pb pad" id="tpBox"></div>
      </section>

      <section class="panel" aria-label="On-time rate">
        <div class="ph"><h2>On-Time Rate — 30 Days</h2><div class="sep"></div>
          <div class="legend"><span><i style="background:#8b5cf6"></i>Daily</span><span><i style="background:#38bdf8"></i>7-day avg</span><span><i style="background:#22c55e"></i>Target 95%</span></div>
        </div>
        <div class="cwrap"><canvas id="otr"></canvas></div>
      </section>

      <section class="panel" aria-label="Zone performance">
        <div class="ph"><h2>Zone Performance</h2><div class="sep"></div><span class="tag">Vs 95% SLA</span></div>
        <div class="pb" id="zoneBox" style="max-height:132px"></div>
      </section>
    </div>

    <!-- EXCEPTIONS -->
    <section class="panel" aria-label="Exceptions">
      <div class="ph">
        <h2>Exceptions</h2><span class="tag" id="exCount">—</span>
        <div class="sep"></div>
        <button class="chip" data-e="open" aria-pressed="true" onclick="setExFilter('open')">Open</button>
        <button class="chip" data-e="crit" aria-pressed="false" onclick="setExFilter('crit')">Critical</button>
        <button class="chip" data-e="all" aria-pressed="false" onclick="setExFilter('all')">All</button>
        <button class="chip" onclick="ackAll()">Ack all</button>
      </div>
      <div class="pb" id="exBox"></div>
    </section>

  </div>
</div>

<script>
/* ---------- utils ---------- */
const $=s=>document.querySelector(s);
const pad=n=>String(n).padStart(2,'0');
const nf=n=>Math.round(n).toLocaleString('en-US');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
let rnd=mulberry32(20260801);
const pick=arr=>arr[Math.floor(Math.random()*arr.length)];

const DRIVERS=['R. Kowalski','A. Ndiaye','M. de Vries','J. Okafor','S. Bakker','T. Yilmaz','L. Moreau','P. Novak','H. Jansen','K. Adeyemi','E. Visser','D. Marchetti','B. Lindqvist','C. Rossi','F. Dubois','N. Petrov','O. Haddad','G. Meijer','V. Nowak','I. Costa','W. Smit','Z. Ahmed','Y. Tanaka','Q. Bergman','X. Ferrer','U. Larsen','A. Doyle','M. Fischer'];
const ZONES=['N','NE','E','SE','S','SW','W','NW','C'];
const ST={route:['EN ROUTE','s-route'],load:['LOADING','s-load'],delay:['DELAYED','s-delay'],idle:['IDLE','s-idle'],maint:['MAINT','s-maint'],off:['OFFLINE','s-off']};
const EXT=[
  ['BREAKDOWN','crit','Roadside assist dispatched, 18 stops need reassignment'],
  ['COLD CHAIN','crit','Reefer temp 8.4°C, above 5°C threshold for 22 min'],
  ['SLA AT RISK','crit','Priority freight will miss committed 14:00 window'],
  ['FAILED ATTEMPT','warn','2nd attempt — no safe place, signature required'],
  ['ADDRESS INVALID','warn','Geocode mismatch, unit number missing'],
  ['HOS LIMIT','warn','Driver hits 9h drive limit in 24 min'],
  ['DAMAGED PARCEL','warn','Carton crushed in transit, photo logged'],
  ['TRAFFIC HOLD','info','A15 closure eastbound, rerouting via N218'],
  ['CUSTOMER ABSENT','info','Recipient rescheduled to tomorrow AM']
];
let exSeq=4800;

/* ---------- state ---------- */
let state, chart;

function genFleet(){
  return Array.from({length:30},(_,i)=>{
    const r=rnd();
    const st=r<.60?'route':r<.70?'load':r<.83?'delay':r<.90?'idle':r<.955?'maint':'off';
    const total=16+Math.floor(rnd()*28);
    const done=(st==='off'||st==='maint')?Math.floor(total*rnd()*.45):Math.floor(total*(.2+rnd()*.65));
    return {id:'VN-'+(101+i),driver:DRIVERS[i%DRIVERS.length],zone:ZONES[i%ZONES.length],
      route:'R'+(210+i),status:st,done,total,
      load:clamp(Math.round(100*(1-done/total))-Math.floor(rnd()*8),0,100),
      etaMin:2+Math.floor(rnd()*26),
      delay:st==='delay'?9+Math.floor(rnd()*42):Math.floor(rnd()*8)-4};
  });
}
function newException(){
  const [ty,sev,note]=EXT[Math.floor(rnd()*EXT.length)];
  const v=state?pick(state.fleet):{id:'VN-101',driver:DRIVERS[0],zone:'N'};
  return {id:'EX-'+(++exSeq),ty,sev,note,veh:v.id,driver:v.driver,zone:v.zone,
    ref:'ORD-'+(70000+Math.floor(rnd()*29999)),ageMin:1+Math.floor(rnd()*4),
    slaMin:sev==='crit'?Math.floor(rnd()*40)-12:20+Math.floor(rnd()*130),ack:false};
}
function genHours(){
  const shape=[.42,.72,.94,1,.98,.84,.72,.88,1,.99,.88,.68,.48,.28];
  const hrs=shape.map((s,i)=>({h:6+i,planned:Math.round(148*s*(.9+rnd()*.2)),done:0}));
  const n=new Date(),h=n.getHours(),m=n.getMinutes();
  hrs.forEach(x=>{
    if(h>20||h>x.h) x.done=Math.round(x.planned*(.9+rnd()*.09));
    else if(h===x.h) x.done=Math.round(x.planned*(m/60)*.95);
    else x.done=0;
  });
  if(h<6) hrs.forEach(x=>x.done=0);
  return hrs;
}
function genOtr(){
  const a=[];let base=94.1;
  for(let i=0;i<30;i++){
    base+=(rnd()-.48)*.9;
    if(i===11||i===12)base-=2.6;      // storm week
    if(i>22)base+=.42;                // recovery
    a.push(+clamp(base,86,99.2).toFixed(2));
  }
  return a;
}
function genZones(){
  return ZONES.map(z=>({z,del:120+Math.floor(rnd()*260),otr:+(89+rnd()*9.5).toFixed(1),
    exc:Math.floor(rnd()*5),delay:+(rnd()*13).toFixed(1),
    trend:Array.from({length:8},()=>.3+rnd()*.7)}));
}
function init(){
  rnd=mulberry32(20260801);exSeq=4800;
  state={live:true,fleetFilter:'all',q:'',exFilter:'open',
    sort:{k:'delay',d:-1},fleet:genFleet(),hours:genHours(),otr:genOtr(),
    zones:genZones(),otrToday:93.42,otrYest:94.86,exceptions:[],updated:new Date()};
  state.exceptions=Array.from({length:13},()=>newException());
  state.exceptions.forEach((e,i)=>{e.ageMin=3+Math.floor(rnd()*180);});
}

/* ---------- derived ---------- */
function kpi(){
  const f=state.fleet;
  const active=f.filter(v=>v.status==='route'||v.status==='load'||v.status==='delay').length;
  const down=f.filter(v=>v.status==='off'||v.status==='maint').length;
  const planned=state.hours.reduce((a,b)=>a+b.planned,0);
  const done=state.hours.reduce((a,b)=>a+b.done,0);
  const open=state.exceptions.filter(e=>!e.ack);
  const crit=open.filter(e=>e.sev==='crit').length;
  const dly=f.filter(v=>v.status==='route'||v.status==='delay');
  const avgDelay=dly.length?dly.reduce((a,b)=>a+Math.max(0,b.delay),0)/dly.length:0;
  const stopsLeft=f.reduce((a,v)=>a+Math.max(0,v.total-v.done),0);
  return {active,total:f.length,down,planned,done,open:open.length,crit,avgDelay,stopsLeft};
}
function cutoff(){
  const n=new Date();const c=new Date(n);c.setHours(18,0,0,0);
  let d=Math.round((c-n)/60000);const past=d<0;d=Math.abs(d);
  return (past?'+':'')+Math.floor(d/60)+'h '+pad(d%60)+'m';
}

/* ---------- render: kpis ---------- */
function renderKpis(){
  const k=kpi(),pct=(k.done/k.planned*100);
  const otrCls=state.otrToday>=95?'ok':state.otrToday>=92?'warn':'crit';
  const d=(state.otrToday-state.otrYest);
  $('#kpis').innerHTML=`
  <div class="kpi ${k.down>3?'warn':'ok'}">
    <div class="k">Fleet Active</div>
    <div class="v num">${k.active}<span style="font-size:13px;color:var(--mut)"> / ${k.total}</span></div>
    <div class="s num">${k.down} down · ${k.total-k.active-k.down} idle</div></div>

  <div class="kpi">
    <div class="k">Deliveries</div>
    <div class="v num">${nf(k.done)}</div>
    <div class="s num">${pct.toFixed(1)}% of ${nf(k.planned)} planned</div></div>

  <div class="kpi ${otrCls}">
    <div class="k">On-Time Today</div>
    <div class="v num">${state.otrToday.toFixed(1)}%</div>
    <div class="s num"><span class="${d>=0?'up':'dn'}">${d>=0?'▲':'▼'} ${Math.abs(d).toFixed(2)}</span> vs yest · tgt 95.0</div></div>

  <div class="kpi ${k.crit?'crit':k.open>8?'warn':'ok'}">
    <div class="k">Open Exceptions</div>
    <div class="v num">${k.open}</div>
    <div class="s num">${k.crit} critical · ${k.open-k.crit} standard</div></div>

  <div class="kpi ${k.avgDelay>10?'warn':'ok'}">
    <div class="k">Avg Delay</div>
    <div class="v num">${k.avgDelay.toFixed(1)}<span style="font-size:13px;color:var(--mut)"> min</span></div>
    <div class="s num">${state.fleet.filter(v=>v.status==='delay').length} vehicles behind plan</div></div>

  <div class="kpi">
    <div class="k">Stops Remaining</div>
    <div class="v num">${nf(k.stopsLeft)}</div>
    <div class="s num">Depot cutoff in ${cutoff()}</div></div>`;
}

/* ---------- render: fleet ---------- */
const COLS=[['id','Veh'],['driver','Driver'],['route','Route'],['status','Status'],['prog','Stops'],['load','Load'],['eta','Next'],['delay','Δ min']];
function setSort(k){const s=state.sort;s.d=(s.k===k)?-s.d:(k==='id'||k==='driver'?1:-1);s.k=k;renderFleet();}
function setFleetFilter(f){state.fleetFilter=f;document.querySelectorAll('[data-f]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.f===f));renderFleet();}
function setQuery(v){state.q=v.toLowerCase();renderFleet();}
function fleetRows(){
  let r=state.fleet.slice();
  const f=state.fleetFilter;
  if(f==='off')r=r.filter(v=>v.status==='off'||v.status==='maint');
  else if(f!=='all')r=r.filter(v=>v.status===f);
  if(state.q)r=r.filter(v=>(v.id+' '+v.driver+' '+v.route+' '+v.zone).toLowerCase().includes(state.q));
  const {k,d}=state.sort;
  const val=v=>k==='prog'?v.done/v.total:k==='eta'?v.etaMin:v[k];
  r.sort((a,b)=>{const x=val(a),y=val(b);return (typeof x==='string'?x.localeCompare(y):x-y)*d});
  return r;
}
function renderFleet(){
  const box=$('#fleetBox'),top=box.scrollTop,rows=fleetRows(),now=new Date();
  const {k,d}=state.sort;
  $('#fleetCount').textContent=rows.length+' of '+state.fleet.length+' vehicles';
  box.innerHTML=`<table><thead><tr>${COLS.map(([key,lab])=>
    `<th tabindex="0" role="button" onclick="setSort('${key}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setSort('${key}')}"
      class="${['load','delay','prog'].includes(key)?'r':''}">${lab}${k===key?` <span class="ar">${d>0?'▲':'▼'}</span>`:''}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(v=>{
    const p=v.done/v.total*100, e=new Date(now.getTime()+v.etaMin*60000);
    const cls=p>75?'g':p>40?'':'a';
    const live=v.status==='route'||v.status==='delay'||v.status==='load';
    return `<tr>
      <td class="num" style="font-weight:700">${v.id}</td>
      <td>${v.driver}</td>
      <td class="num mono-s" style="color:var(--mut)">${v.route}·${v.zone}</td>
      <td><span class="pill ${ST[v.status][1]}">${ST[v.status][0]}</span></td>
      <td class="r"><div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
        <span class="num mono-s">${v.done}/${v.total}</span><span class="bar" style="width:46px"><i class="${cls}" style="width:${p}%"></i></span></div></td>
      <td class="r num mono-s">${v.load}%</td>
      <td class="num mono-s" style="color:${live?'var(--tx)':'var(--dim)'}">${live?pad(e.getHours())+':'+pad(e.getMinutes()):'—'}</td>
      <td class="r num mono-s" style="font-weight:700;color:${v.delay>15?'#fca5a5':v.delay>5?'#fbbf24':v.delay<0?'#6ee7a4':'var(--mut)'}">${v.delay>0?'+':''}${v.delay}</td>
    </tr>`}).join('')||`<tr><td colspan="8" class="empty">No vehicles match this filter.</td></tr>`}</tbody></table>`;
  box.scrollTop=top;
}

/* ---------- render: throughput ---------- */
function renderTp(){
  const h=state.hours,now=new Date().getHours();
  const max=Math.max(...h.map(x=>x.planned));
  const done=h.reduce((a,b)=>a+b.done,0),planned=h.reduce((a,b)=>a+b.planned,0);
  const fail=Math.round(done*0.021), transit=kpi().stopsLeft;
  $('#tpTag').textContent=nf(done)+' / '+nf(planned)+' completed';
  $('#tpBox').innerHTML=`
  <div class="grid4">
    <div class="st"><div class="k">Delivered</div><div class="v num" style="color:#6ee7a4">${nf(done)}</div></div>
    <div class="st"><div class="k">In Transit</div><div class="v num" style="color:#a78bfa">${nf(transit)}</div></div>
    <div class="st"><div class="k">Failed</div><div class="v num" style="color:#fca5a5">${nf(fail)}</div></div>
    <div class="st"><div class="k">Pickups</div><div class="v num">${nf(Math.round(done*0.14))}</div></div>
  </div>
  <div class="hours">${h.map(x=>{
    const ph=x.planned/max*100, dh=x.done/max*100;
    return `<div class="hr ${x.h===now?'now':''}" title="${pad(x.h)}:00 — ${x.done} of ${x.planned}">
      <div class="stack"><em style="bottom:${ph*.64}px"></em><u style="height:${dh*.64}px"></u></div>
      <b>${pad(x.h)}</b></div>`}).join('')}</div>`;
}

/* ---------- render: zones ---------- */
function renderZones(){
  const box=$('#zoneBox'),t=box.scrollTop;
  box.innerHTML=`<table class="zt"><thead><tr><th style="cursor:default">Zone</th><th style="cursor:default">Del.</th>
    <th style="cursor:default" class="r">On-time</th><th style="cursor:default" class="r">Avg Δ</th><th style="cursor:default" class="r">Exc</th><th style="cursor:default">7d</th></tr></thead><tbody>
  ${state.zones.map(z=>`<tr>
    <td style="font-weight:700">${z.z}</td>
    <td class="num mono-s">${nf(z.del)}</td>
    <td class="r num mono-s" style="font-weight:700;color:${z.otr>=95?'#6ee7a4':z.otr>=92?'#fbbf24':'#fca5a5'}">${z.otr.toFixed(1)}%</td>
    <td class="r num mono-s" style="color:var(--mut)">${z.delay}m</td>
    <td class="r num mono-s" style="color:${z.exc>2?'#fca5a5':'var(--mut)'}">${z.exc}</td>
    <td><span class="spark">${z.trend.map(v=>`<i style="height:${Math.round(v*12)}px"></i>`).join('')}</span></td>
  </tr>`).join('')}</tbody></table>`;
  box.scrollTop=t;
}

/* ---------- render: exceptions ---------- */
function setExFilter(f){state.exFilter=f;document.querySelectorAll('[data-e]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.e===f));renderEx();}
function ack(id){const e=state.exceptions.find(x=>x.id===id);if(e){e.ack=true;renderEx();renderKpis();}}
function ackAll(){state.exceptions.forEach(e=>{if(e.sev!=='crit')e.ack=true});renderEx();renderKpis();}
const RANK={crit:0,warn:1,info:2};
function renderEx(){
  const box=$('#exBox'),t=box.scrollTop;
  let r=state.exceptions.slice();
  if(state.exFilter==='open')r=r.filter(e=>!e.ack);
  if(state.exFilter==='crit')r=r.filter(e=>e.sev==='crit');
  r.sort((a,b)=>(a.ack-b.ack)||(RANK[a.sev]-RANK[b.sev])||(a.slaMin-b.slaMin));
  const open=state.exceptions.filter(e=>!e.ack).length;
  $('#exCount').innerHTML=`${open} open · ${state.exceptions.filter(e=>e.sev==='crit'&&!e.ack).length} critical`;
  box.innerHTML=r.map(e=>`
   <div class="ex ${e.sev} ${e.ack?'done':''}">
     <div class="sv"></div>
     <div class="body">
       <div class="l1">
         <span class="ty">${e.ty}</span>
         <span class="id num">${e.id}</span>
         <span style="flex:1"></span>
         <span class="sla num ${e.slaMin<0?'bad':''}">${e.slaMin<0?'SLA -'+Math.abs(e.slaMin)+'m':'SLA '+e.slaMin+'m'}</span>
         <button class="ackb ${e.ack?'on':''}" ${e.ack?'disabled':''} onclick="ack('${e.id}')">${e.ack?'ACKED':'ACK'}</button>
       </div>
       <div class="l2"><b class="num">${e.veh}</b> · ${e.driver} · zone ${e.zone} · <span class="num">${e.ref}</span> · ${e.ageMin}m old</div>
       <div class="l2" style="color:var(--dim)">${e.note}</div>
     </div>
   </div>`).join('')||`<div class="empty">Queue clear. No exceptions match this filter.</div>`;
  box.scrollTop=t;
}

/* ---------- chart ---------- */
function buildChart(){
  const labels=[],today=new Date();
  for(let i=29;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);
    labels.push(d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}));}
  const data=state.otr.slice();data[29]=state.otrToday;
  const roll=data.map((_,i)=>{const s=data.slice(Math.max(0,i-6),i+1);return +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2)});
  chart=new Chart($('#otr'),{
    type:'line',
    data:{labels,datasets:[
      {label:'Daily',data,borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,.16)',fill:true,borderWidth:1.6,pointRadius:0,pointHoverRadius:3,tension:.25},
      {label:'7-day avg',data:roll,borderColor:'#38bdf8',borderWidth:1.8,pointRadius:0,tension:.35},
      {label:'Target',data:new Array(30).fill(95),borderColor:'rgba(34,197,94,.75)',borderWidth:1,borderDash:[4,3],pointRadius:0}
    ]},
    options:{maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{display:false},tooltip:{backgroundColor:'#0c1220',borderColor:'#2a3category',borderWidth:1,titleFont:{size:11},bodyFont:{size:11},padding:8,
        callbacks:{label:c=>' '+c.dataset.label+': '+c.parsed.y.toFixed(2)+'%'}}},
      scales:{
        x:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#5f6d8c',font:{size:9},maxRotation:0,autoSkipPadding:14}},
        y:{min:84,max:100,grid:{color:'rgba(255,255,255,.05)'},ticks:{color:'#5f6d8c',font:{size:9},callback:v=>v+'%',stepSize:4}}}}
  });
}
function updateChart(){
  const d=chart.data.datasets;d[0].data[29]=+state.otrToday.toFixed(2);
  const a=d[0].data;d[1].data=a.map((_,i)=>{const s=a.slice(Math.max(0,i-6),i+1);return +(s.reduce((x,y)=>x+y,0)/s.length).toFixed(2)});
  chart.update('none');
}

/* ---------- loop ---------- */
function renderAll(){renderKpis();renderFleet();renderTp();renderZones();renderEx();}
function clockTick(){
  const n=new Date();
  $('#clock').textContent=pad(n.getHours())+':'+pad(n.getMinutes())+':'+pad(n.getSeconds());
  $('#date').textContent=n.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'long',year:'numeric'})+' · CEST';
  const s=Math.round((n-state.updated)/1000);
  $('#upd').textContent=state.live?'updated '+s+'s ago':'paused';
}
function sim(){
  const f=state.fleet;
  for(let i=0;i<6;i++){
    const v=pick(f);
    if(v.status==='route'||v.status==='delay'){
      if(v.done<v.total&&Math.random()<.55){v.done++;v.load=Math.max(0,v.load-Math.round(100/v.total));}
      v.etaMin=clamp(v.etaMin+(Math.random()<.5?-1:1),1,90);
      v.delay+=Math.random()<.45?1:-1;
      if(v.status==='route'&&v.delay>13&&Math.random()<.35)v.status='delay';
      if(v.status==='delay'&&v.delay<8&&Math.random()<.35)v.status='route';
      if(v.done>=v.total&&Math.random()<.4){v.status='idle';v.delay=0;}
    } else if(v.status==='load'&&Math.random()<.3)v.status='route';
    else if(v.status==='idle'&&Math.random()<.12){v.status='load';v.load=clamp(v.load+35,0,100);}
    else if(v.status==='maint'&&Math.random()<.05)v.status='idle';
  }
  const h=new Date().getHours(),slot=state.hours.find(x=>x.h===h);
  if(slot)slot.done=Math.min(slot.planned,slot.done+1+Math.floor(Math.random()*3));
  state.exceptions.forEach(e=>{if(Math.random()<.5)e.ageMin++;if(Math.random()<.6)e.slaMin--;});
  if(Math.random()<.28&&state.exceptions.filter(e=>!e.ack).length<18)state.exceptions.unshift(newException());
  if(Math.random()<.3){const i=state.exceptions.findIndex(e=>e.ack);if(i>=0)state.exceptions.splice(i,1);}
  state.zones.forEach(z=>{if(Math.random()<.3)z.del++;if(Math.random()<.15)z.otr=+clamp(z.otr+(Math.random()-.5)*.3,86,99).toFixed(1);});
  state.otrToday=clamp(state.otrToday+(Math.random()-.5)*.22,88,99);
  state.updated=new Date();
  renderAll();updateChart();
}
function toggleLive(){
  state.live=!state.live;
  $('#liveBtn').setAttribute('aria-pressed',state.live);
  $('#liveBtn').textContent=state.live?'Live':'Paused';
  $('#dot').classList.toggle('off',!state.live);
  if(state.live)state.updated=new Date();
}
function resetAll(){
  init();$('#q').value='';
  setFleetFilter('all');setExFilter('open');
  renderAll();
  chart.data.datasets[0].data=state.otr.slice();updateChart();
}
window.addEventListener('keydown',e=>{
  const typing=/INPUT|TEXTAREA/.test(e.target.tagName);
  if(e.key==='/'&&!typing){e.preventDefault();$('#q').focus();}
  if(e.key==='Escape'&&typing){$('#q').value='';setQuery('');$('#q').blur();}
  if(e.key.toLowerCase()==='p'&&!typing)toggleLive();
});

init();buildChart();renderAll();clockTick();
setInterval(clockTick,1000);
setInterval(()=>{if(state.live)sim()},4000);
</script>
</body>
</html>
:::

The layout assumes a wide screen and never scrolls the page — each panel scrolls internally so nothing shifts position while you're watching it. Density is deliberate: 12px base, tabular figures everywhere, 22px table rows, so roughly 30 vehicles and a dozen exceptions are visible without interaction.

Fleet rows sort on any column header (click, or tab to it and press Enter), default being delay descending so the worst offenders sit at the top. Filters narrow to en-route, delayed, or down vehicles, and pressing `/` jumps to search. The exception queue orders unacknowledged critical items first, breaks ties by SLA remaining, shows breached SLAs in red, and drops acknowledged items to the bottom greyed out until they age off. `Ack all` deliberately skips criticals — those need a human decision. `P` pauses the feed when you want to read something without it moving under you.

Telemetry simulates on a four-second tick: stops complete, delays drift, statuses transition, new exceptions arrive, and today's point on the on-time chart moves with its seven-day average recomputing against the 95 percent target line. The 30-day series has a deliberate dip around day twelve and a recovery trend, so the chart reads like real history rather than noise. Hourly throughput bars show completed against planned with the current hour outlined.

If you tell me the real shape of your data — vehicle counts, exception taxonomy, actual SLA windows, or the metrics your dispatchers actually escalate on — I can retarget it, and swapping the simulation for a fetch against your API is a small change.