I'll build this as an interactive HTML artifact. Let me pull in the builder skill first.Building a dark, high-density layout — the kind you can leave on a wall monitor. Exceptions and the on-time trend get the most visual weight, since those are what actually demand a decision.

:::artifact{title="Fleet Operations — Live Control Board" type="html"}
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fleet Operations — Live</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box}
:root{
  --bg:#070a12;--panel:#0f1421;--panel2:#141b2b;--line:#1d2537;--line2:#2b3purple;
  --line2:#2b3548;--txt:#e4eaf5;--mut:#8494ad;--mut2:#5d6d88;
  --ok:#28c76f;--warn:#f5a524;--crit:#f4525f;--info:#3fb6f0;--acc:#8b5cf6;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
html,body{margin:0;background:var(--bg);color:var(--txt);
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
.wrap{padding:9px;display:flex;flex-direction:column;gap:9px}

/* ---------- top bar ---------- */
.top{display:flex;align-items:center;gap:14px;background:linear-gradient(180deg,#151d2e,#0f1421);
  border:1px solid var(--line);border-radius:10px;padding:0 12px;height:46px;flex-wrap:wrap}
.brand{display:flex;align-items:baseline;gap:9px}
.brand b{font-size:14px;letter-spacing:.02em}
.brand span{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut2)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(40,199,111,.15)}
.dot.pulse{animation:pulse 1.9s ease-in-out infinite}
.live{display:flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ok)}
.live.off{color:var(--warn)}.live.off .dot{background:var(--warn);box-shadow:0 0 0 3px rgba(245,165,36,.15);animation:none}
.clock{margin-left:auto;display:flex;align-items:center;gap:12px}
.clock .t{font-size:19px;letter-spacing:.02em}
.clock .d{font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;text-align:right;line-height:1.35}
.tools{display:flex;gap:6px}

/* ---------- buttons ---------- */
.btn{appearance:none;background:#182033;border:1px solid var(--line2);color:var(--mut);
  font:600 10px/1 system-ui;letter-spacing:.06em;text-transform:uppercase;padding:7px 9px;
  border-radius:6px;cursor:pointer;transition:120ms ease;white-space:nowrap}
.btn:hover{color:var(--txt);border-color:#3d4b68;background:#1e2740}
.btn.on{background:rgba(139,92,246,.18);border-color:rgba(139,92,246,.5);color:#cdbcff}
.btn.tiny{padding:4px 7px;font-size:9px}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px;border-radius:6px}

/* ---------- alert strip ---------- */
.alert{display:none;align-items:center;gap:10px;border-radius:8px;padding:7px 11px;font-size:12px;
  background:rgba(244,82,95,.1);border:1px solid rgba(244,82,95,.4);color:#ffc2c7}
.alert.show{display:flex}
.alert b{color:#fff}
.alert .sq{width:8px;height:8px;background:var(--crit);border-radius:2px;animation:pulse 1.1s infinite}

/* ---------- kpis ---------- */
.kpis{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
.k{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:8px 10px;position:relative;overflow:hidden}
.k::after{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--line2)}
.k.a::after{background:var(--acc)}.k.g::after{background:var(--ok)}
.k.w::after{background:var(--warn)}.k.r::after{background:var(--crit)}.k.i::after{background:var(--info)}
.k label{display:block;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut2);margin-bottom:3px}
.k .v{font-size:23px;line-height:1.05;letter-spacing:-.01em}
.k .v small{font-size:12px;color:var(--mut);letter-spacing:0}
.k .s{font-size:10.5px;color:var(--mut);margin-top:3px;display:flex;align-items:center;gap:5px}
.up{color:var(--ok)}.down{color:var(--crit)}
.track{height:3px;background:#1a2233;border-radius:2px;margin-top:6px;overflow:hidden}
.track i{display:block;height:100%;background:var(--acc);border-radius:2px;transition:width .5s ease}

/* ---------- panels ---------- */
.main{display:grid;grid-template-columns:1.52fr 1fr;gap:9px;align-items:start}
.col{display:grid;gap:9px}
.lower{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.p{background:var(--panel);border:1px solid var(--line);border-radius:10px;display:flex;flex-direction:column;overflow:hidden}
.p>h2{margin:0;padding:7px 10px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--mut);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;
  background:linear-gradient(180deg,#151d2e,#101623)}
.p>h2 .r{margin-left:auto;display:flex;align-items:center;gap:6px}
.p .body{padding:10px}
.badge{font:600 9.5px/1 var(--mono);padding:3px 5px;border-radius:4px;background:#1c2436;color:var(--mut);letter-spacing:.04em}
.badge.r{background:rgba(244,82,95,.16);color:#ff9ba3}
.badge.w{background:rgba(245,165,36,.14);color:#ffd08a}
.badge.g{background:rgba(40,199,111,.14);color:#8ae8b4}
.lgd{display:flex;gap:9px;font-size:9.5px;color:var(--mut2);letter-spacing:.06em;text-transform:uppercase}
.lgd i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}

/* ---------- chart ---------- */
.chartbox{position:relative;height:236px;padding:8px 6px 2px}
.cstat{display:flex;gap:0;border-top:1px solid var(--line)}
.cstat div{flex:1;padding:7px 10px;border-right:1px solid var(--line)}
.cstat div:last-child{border-right:0}
.cstat label{display:block;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut2)}
.cstat b{font-family:var(--mono);font-size:15px;font-weight:500}

/* ---------- exceptions ---------- */
.filters{display:flex;gap:5px;padding:7px 8px;border-bottom:1px solid var(--line);flex-wrap:wrap;background:#0c111c}
.exlist{max-height:352px;overflow-y:auto}
.ex{display:flex;gap:9px;padding:7px 9px 7px 0;border-bottom:1px solid #151c2a;align-items:flex-start}
.ex:last-child{border-bottom:0}
.ex .stripe{width:3px;align-self:stretch;border-radius:0 2px 2px 0;flex:none}
.ex .mid{flex:1;min-width:0}
.ex .r1{display:flex;align-items:center;gap:7px;margin-bottom:2px}
.ex .ty{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ex .r2{font-size:10.5px;color:var(--mut);display:flex;gap:9px;flex-wrap:wrap;font-family:var(--mono)}
.ex .r2 em{font-style:normal;color:var(--mut2)}
.ex .rt{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none;padding-right:2px}
.sla{font:600 10.5px/1 var(--mono);padding:3px 5px;border-radius:4px;white-space:nowrap}
.sla.ok{background:rgba(40,199,111,.12);color:#7fe3ac}
.sla.soon{background:rgba(245,165,36,.14);color:#ffd08a}
.sla.brk{background:rgba(244,82,95,.18);color:#ff9ba3}
.sev{font:700 8.5px/1 system-ui;letter-spacing:.09em;text-transform:uppercase;padding:3px 5px;border-radius:3px}
.ex.acked{opacity:.42}.ex.acked .ty{text-decoration:line-through}
.empty{padding:26px 12px;text-align:center;color:var(--mut2);font-size:11.5px}

/* ---------- fleet ---------- */
.segbar{display:flex;height:9px;border-radius:5px;overflow:hidden;background:#1a2233;margin-bottom:8px}
.segbar i{display:block;transition:width .4s ease}
.fkeys{display:grid;grid-template-columns:repeat(2,1fr);gap:3px 12px;margin-bottom:9px}
.fk{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--mut)}
.fk i{width:8px;height:8px;border-radius:2px;flex:none}
.fk b{margin-left:auto;font-family:var(--mono);color:var(--txt);font-weight:500}
.vlist{max-height:212px;overflow-y:auto;border-top:1px solid var(--line)}
.v{display:flex;align-items:center;gap:8px;padding:5px 9px;border-bottom:1px solid #141b28;font-size:11.5px}
.v:last-child{border-bottom:0}
.v .id{font-family:var(--mono);width:62px;flex:none;letter-spacing:-.02em}
.v .dr{flex:1;min-width:0;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.v .st{width:7px;height:7px;border-radius:50%;flex:none}
.mini{width:58px;height:4px;background:#1a2233;border-radius:2px;overflow:hidden;flex:none}
.mini i{display:block;height:100%;background:var(--info)}
.v .pc{width:34px;text-align:right;font-family:var(--mono);font-size:10.5px;color:var(--mut2);flex:none}
.v.late .id{color:#ffb3b9}

/* ---------- hourly ---------- */
.hrs{display:flex;align-items:flex-end;gap:3px;height:132px;padding-top:4px}
.hr{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;height:100%}
.hr .bar{width:100%;background:#1a2233;border-radius:2px 2px 0 0;position:relative;display:flex;align-items:flex-end;overflow:hidden}
.hr .bar i{display:block;width:100%;background:linear-gradient(180deg,#8b5cf6,#5b3fd6);border-radius:2px 2px 0 0}
.hr.now .bar i{background:linear-gradient(180deg,#3fb6f0,#1f7fbd)}
.hr .lb{font:9.5px/1 var(--mono);color:var(--mut2)}
.hr.now .lb{color:var(--info);font-weight:600}

/* ---------- table ---------- */
table{width:100%;border-collapse:collapse;font-size:11.5px}
th{text-align:left;font:600 9px/1 system-ui;letter-spacing:.1em;text-transform:uppercase;color:var(--mut2);
  padding:6px 9px;border-bottom:1px solid var(--line);background:#0c111c}
td{padding:6px 9px;border-bottom:1px solid #141b28;font-family:var(--mono);font-size:11.5px}
tr:last-child td{border-bottom:0}
td.nm{font-family:system-ui;font-weight:500}
th.n,td.n{text-align:right}

/* ---------- footer ---------- */
.foot{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:0 4px;
  font:10px/1 var(--mono);color:var(--mut2);letter-spacing:.05em;text-transform:uppercase}
.foot .sp{margin-left:auto}

@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes fl{0%{background:rgba(139,92,246,.26)}100%{background:transparent}}
.fl{animation:fl 1.3s ease-out}
@keyframes num{0%{color:#cdbcff}100%{color:inherit}}
.nf{animation:num 1s ease-out}

::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:#0b1018}
::-webkit-scrollbar-thumb{background:#28324a;border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:#38456180}

@media(max-width:1280px){.kpis{grid-template-columns:repeat(4,1fr)}.main{grid-template-columns:1fr}}
@media(max-width:820px){.kpis{grid-template-columns:repeat(2,1fr)}.lower{grid-template-columns:1fr}
  .btn{padding:13px 11px}.btn.tiny{padding:10px 9px}.clock{margin-left:0}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="wrap">

  <div class="top">
    <div class="brand"><b>MERIDIAN LOGISTICS</b><span>Regional Ops · Control Board</span></div>
    <div class="live" id="liveTag"><span class="dot pulse"></span><span id="liveTxt">Live</span></div>
    <span class="badge" id="syncTag">sync 0s</span>
    <div class="clock">
      <div class="d"><div id="dateTxt">—</div><div id="shiftTxt">—</div></div>
      <div class="t num" id="timeTxt">--:--:--</div>
      <div class="tools">
        <button class="btn" id="pauseBtn" aria-pressed="false">Pause feed</button>
        <button class="btn" id="resetBtn">Reset</button>
      </div>
    </div>
  </div>

  <div class="alert" id="alertBar">
    <span class="sq"></span>
    <span id="alertTxt"></span>
    <button class="btn tiny" id="jumpBtn" style="margin-left:auto">Go to queue</button>
  </div>

  <div class="kpis" id="kpis"></div>

  <div class="main">
    <div class="col">

      <section class="p">
        <h2>On-time delivery rate
          <span class="lgd" style="margin-left:10px">
            <span><i style="background:#8b5cf6"></i>On-time %</span>
            <span><i style="background:rgba(63,182,240,.45)"></i>Volume</span>
            <span><i style="background:rgba(244,82,95,.6)"></i>Target 95%</span>
          </span>
          <span class="r">
            <button class="btn tiny" data-range="7">7d</button>
            <button class="btn tiny" data-range="14">14d</button>
            <button class="btn tiny on" data-range="30">30d</button>
          </span>
        </h2>
        <div class="chartbox"><canvas id="otChart"></canvas></div>
        <div class="cstat">
          <div><label>Rolling 7d</label><b id="s7">—</b></div>
          <div><label>Rolling 30d</label><b id="s30">—</b></div>
          <div><label>Best / worst day</label><b id="sbw">—</b></div>
          <div><label>Days below target</label><b id="sbt">—</b></div>
          <div><label>Trend vs prior wk</label><b id="strend">—</b></div>
        </div>
      </section>

      <div class="lower">
        <section class="p">
          <h2>Throughput by hour<span class="r"><span class="badge" id="thrTag">—</span></span></h2>
          <div class="body"><div class="hrs" id="hrs"></div></div>
        </section>

        <section class="p">
          <h2>Depot performance</h2>
          <table>
            <thead><tr><th>Depot</th><th class="n">Veh</th><th class="n">Done</th><th class="n">On-time</th><th class="n">Exc</th></tr></thead>
            <tbody id="depotBody"></tbody>
          </table>
        </section>
      </div>
    </div>

    <div class="col">
      <section class="p" id="exPanel">
        <h2>Exceptions — action queue
          <span class="r"><span class="badge r" id="exCount">0</span>
          <button class="btn tiny" id="ackAll">Ack low</button></span>
        </h2>
        <div class="filters" id="filters"></div>
        <div class="exlist" id="exlist"></div>
      </section>

      <section class="p">
        <h2>Fleet status<span class="r"><span class="badge" id="fleetTag">—</span></span></h2>
        <div class="body" style="padding-bottom:8px">
          <div class="segbar" id="segbar"></div>
          <div class="fkeys" id="fkeys"></div>
        </div>
        <div class="vlist" id="vlist"></div>
      </section>
    </div>
  </div>

  <div class="foot">
    <span>Telematics: connected</span><span>WMS: connected</span>
    <span>Route engine: v4.2</span><span id="footEx">—</span>
    <span class="sp" id="footUp">—</span>
  </div>
</div>

<script>
(function(){
"use strict";

/* ============ deterministic rng ============ */
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
var rnd=mulberry(20260801);
function ri(a,b){return a+Math.floor(rnd()*(b-a+1))}
function pick(a){return a[Math.floor(rnd()*a.length)]}

/* ============ reference data ============ */
var DEPOTS=[{c:'DC-N',n:'North Hub'},{c:'DC-E',n:'East Hub'},{c:'DC-S',n:'South Hub'},
            {c:'DC-W',n:'West Hub'},{c:'DC-C',n:'Central Hub'}];
var NAMES=['A. Okafor','J. Whitfield','M. Haugen','R. Delacroix','S. Bhatt','T. Nakamura','L. Fenwick',
 'D. Kowalski','P. Adeyemi','C. Marchetti','H. Lindqvist','N. Baptiste','E. Volkov','G. Mensah',
 'K. Ferreira','O. Dunne','V. Sørensen','B. Achterberg','F. Castellanos','Y. Demir','W. Osei',
 'I. Kaur','Z. Petrov','Q. Laurent','U. Nwosu','X. Beaumont','J. Rasmussen','M. Silvestri',
 'A. Thorne','R. Villalobos','S. Kirkbride','T. Ellsworth'];
var STATUS={
  on_route:{l:'On route',c:'#28c76f'}, loading:{l:'Loading',c:'#3fb6f0'},
  idle:{l:'Idle at depot',c:'#8494ad'}, maint:{l:'Maintenance',c:'#f5a524'},
  offline:{l:'Offline / no signal',c:'#f4525f'}
};
var SEV={critical:{c:'#f4525f',bg:'rgba(244,82,95,.16)',t:'#ff9ba3',r:0},
         high:{c:'#f5a524',bg:'rgba(245,165,36,.14)',t:'#ffd08a',r:1},
         medium:{c:'#3fb6f0',bg:'rgba(63,182,240,.14)',t:'#9ad9f7',r:2},
         low:{c:'#8494ad',bg:'rgba(132,148,173,.14)',t:'#aebbcd',r:3}};
var EXTYPES=[
 {t:'Vehicle breakdown',s:'critical',sla:30,n:'Recovery required — reassign remaining stops'},
 {t:'Cold-chain breach',s:'critical',sla:20,n:'Temp above 8°C for 14 min — quarantine load'},
 {t:'Driver hours limit',s:'critical',sla:45,n:'Legal driving limit reached in 25 min'},
 {t:'Route delay > 60 min',s:'high',sla:60,n:'Congestion on arterial — 11 stops at risk'},
 {t:'Address not found',s:'high',sla:90,n:'Geocode mismatch — needs contact centre call'},
 {t:'Missed collection',s:'high',sla:75,n:'Booked pickup not completed on first pass'},
 {t:'Consignee unreachable',s:'high',sla:60,n:'Two contact attempts failed'},
 {t:'Failed delivery — no access',s:'medium',sla:120,n:'Gated site, no code on manifest'},
 {t:'Customer refused',s:'medium',sla:150,n:'Return to depot, restock required'},
 {t:'Damaged parcel',s:'medium',sla:120,n:'Photo logged, claim to be raised'},
 {t:'Oversize misload',s:'medium',sla:100,n:'Item on wrong vehicle for van class'},
 {t:'Signature missing',s:'low',sla:240,n:'POD incomplete — request driver re-scan'},
 {t:'Late depart from hub',s:'low',sla:180,n:'Left 22 min after cutoff'}
];

/* ============ state ============ */
var S={live:true,sev:'all',hideAck:false,range:30,vehicles:[],ex:[],series:[],seq:4820,
       sync:0,started:Date.now(),failed:0,ackd:0,resolved:0};
var chart=null;

function opHour(){var h=new Date().getHours();return(h<6||h>20)?15:h}
function dayFrac(){var n=new Date();var h=opHour();
  var m=(h===n.getHours())?n.getMinutes():18;
  return Math.min(1,Math.max(.04,((h-6)+m/60)/14))}

function buildVehicles(){
  var v=[],f=dayFrac();
  for(var i=0;i<48;i++){
    var hgv=i%9===0;
    var st;var r=rnd();
    if(r<.70)st='on_route';else if(r<.80)st='loading';else if(r<.89)st='idle';
    else if(r<.955)st='maint';else st='offline';
    var total=hgv?ri(22,34):ri(52,94);
    var prog=st==='on_route'?f*(0.80+rnd()*0.38):st==='loading'?f*0.18:st==='idle'?f*0.42:f*0.30;
    var done=Math.min(total,Math.round(total*Math.min(1,prog)));
    v.push({id:(hgv?'HGV-':'VAN-')+(101+i),hgv:hgv,driver:NAMES[i%NAMES.length],
      depot:DEPOTS[i%DEPOTS.length].c,status:st,done:done,total:total,
      failed:rnd()<.30?ri(1,3):0,late:st==='on_route'&&rnd()<.20});
  }
  return v;
}
function buildEx(){
  var out=[];
  for(var i=0;i<15;i++)out.push(mkEx(ri(3,190)));
  return out.sort(function(a,b){return SEV[a.sev].r-SEV[b.sev].r||a.age-b.age});
}
function mkEx(age){
  var t=EXTYPES[Math.floor(rnd()*EXTYPES.length)];
  var v=S.vehicles.length?S.vehicles[Math.floor(rnd()*S.vehicles.length)]:{id:'VAN-101',depot:'DC-N'};
  return {id:'EX-'+(++S.seq),type:t.t,sev:t.s,sla:t.sla,note:t.n,age:age,
    order:'ORD-'+ri(410000,499999),veh:v.id,depot:v.depot,ack:false,fresh:false};
}
function buildSeries(){
  var out=[],now=new Date();
  for(var i=29;i>=0;i--){
    var d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i);
    var dow=d.getDay(),base=94.4;
    if(dow===6)base-=1.5; if(dow===0)base-=2.6; if(dow===1)base-=0.7;
    if(i===19)base-=7.4;            // storm day
    if(i===18)base-=3.1;            // recovery
    if(i<7)base+=1.5;               // recent improvement
    var val=Math.max(80,Math.min(99.2,base+(rnd()*2.4-1.2)));
    var vol=Math.round((dow===0?2180:dow===6?2760:3260)*(0.92+rnd()*0.17));
    out.push({d:d,label:(d.getDate()+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]),
      ot:Math.round(val*10)/10,vol:vol});
  }
  return out;
}

/* ============ derived ============ */
function M(){
  var planned=0,done=0,failed=0,act=0,late=0,counts={on_route:0,loading:0,idle:0,maint:0,offline:0};
  S.vehicles.forEach(function(v){planned+=v.total;done+=v.done;failed+=v.failed;
    counts[v.status]++;if(v.status==='on_route'||v.status==='loading')act++;if(v.late)late++});
  failed+=S.failed;
  var open=S.ex.filter(function(e){return !e.ack}).length;
  var crit=S.ex.filter(function(e){return !e.ack&&e.sev==='critical'}).length;
  var brk=S.ex.filter(function(e){return !e.ack&&(e.sla-e.age)<0}).length;
  var otToday=Math.round((93.9-late*0.16-brk*0.09)*10)/10;
  var hrsIn=(opHour()-6)+new Date().getMinutes()/60;
  return {planned:planned,done:done,failed:failed,transit:Math.max(0,planned-done-failed),
    act:act,late:late,counts:counts,open:open,crit:crit,brk:brk,ot:otToday,
    rate:Math.round(done/Math.max(1,hrsIn)),stops:Math.round(done/Math.max(1,act)*10)/10};
}
function fmt(n){return n.toLocaleString('en-GB')}
function avg(a){return a.reduce(function(x,y){return x+y},0)/a.length}

/* ============ kpi render ============ */
var KDEF=[
 {id:'planned',cls:'i',lab:'Planned today',v:function(m){return fmt(m.planned)},
  s:function(m){return 'across '+m.act+' active vehicles'}},
 {id:'done',cls:'a',lab:'Delivered',v:function(m){return fmt(m.done)},
  s:function(m){return Math.round(m.done/m.planned*100)+'% of plan'},bar:function(m){return m.done/m.planned*100}},
 {id:'transit',cls:'i',lab:'In transit',v:function(m){return fmt(m.transit)},
  s:function(m){return m.rate+' stops/hr current'}},
 {id:'failed',cls:'r',lab:'Failed / returned',v:function(m){return fmt(m.failed)},
  s:function(m){return (Math.round(m.failed/Math.max(1,m.done)*1000)/10)+'% of attempts'}},
 {id:'ot',cls:'g',lab:'On-time today',v:function(m){return m.ot+'<small>%</small>'},
  s:function(m){return m.ot>=95?'<span class="up">▲ at target</span>':'<span class="down">▼ '+(Math.round((95-m.ot)*10)/10)+'pt below target</span>'}},
 {id:'open',cls:'w',lab:'Open exceptions',v:function(m){return fmt(m.open)},
  s:function(m){return m.crit+' critical · '+m.brk+' SLA breached'}},
 {id:'fleet',cls:'g',lab:'Fleet active',v:function(m){return m.act+'<small>/48</small>'},
  s:function(m){return m.late+' running late'},bar:function(m){return m.act/48*100}}
];
function drawKpis(){
  document.getElementById('kpis').innerHTML=KDEF.map(function(k){
    return '<div class="k '+k.cls+'"><label>'+k.lab+'</label>'+
      '<div class="v num" id="kv-'+k.id+'"></div><div class="s" id="ks-'+k.id+'"></div>'+
      (k.bar?'<div class="track"><i id="kb-'+k.id+'"></i></div>':'')+'</div>';
  }).join('');
}
function upKpis(m){
  KDEF.forEach(function(k){
    var v=document.getElementById('kv-'+k.id),s=document.getElementById('ks-'+k.id),
        nv=k.v(m);
    if(v.innerHTML!==nv){v.innerHTML=nv;v.classList.remove('nf');void v.offsetWidth;v.classList.add('nf')}
    s.innerHTML=k.s(m);
    if(k.bar){document.getElementById('kb-'+k.id).style.width=Math.min(100,k.bar(m))+'%'}
  });
}

/* ============ exceptions ============ */
var SEVS=['all','critical','high','medium','low'];
function drawFilters(){
  var f=document.getElementById('filters');
  f.innerHTML=SEVS.map(function(s){
    var n=s==='all'?S.ex.filter(function(e){return !e.ack}).length
                   :S.ex.filter(function(e){return !e.ack&&e.sev===s}).length;
    return '<button class="btn tiny'+(S.sev===s?' on':'')+'" data-sev="'+s+'">'+s+' <span class="num">'+n+'</span></button>';
  }).join('')+'<button class="btn tiny'+(S.hideAck?' on':'')+'" id="hideAck" style="margin-left:auto">Hide acked</button>';
}
function slaCls(left){return left<0?'brk':left<15?'soon':'ok'}
function slaTxt(left){return left<0?'BREACH +'+Math.abs(left)+'m':left+'m left'}
function drawEx(){
  var box=document.getElementById('exlist'),top=box.scrollTop;
  var list=S.ex.filter(function(e){
    if(S.hideAck&&e.ack)return false;
    return S.sev==='all'||e.sev===S.sev});
  list.sort(function(a,b){return (a.ack-b.ack)||((a.sla-a.age)-(b.sla-b.age))});
  box.innerHTML=list.length?list.map(function(e){
    var left=e.sla-e.age,sv=SEV[e.sev];
    return '<div class="ex'+(e.ack?' acked':'')+(e.fresh?' fl':'')+'" data-id="'+e.id+'">'+
      '<span class="stripe" style="background:'+sv.c+'"></span><div class="mid">'+
      '<div class="r1"><span class="sev" style="background:'+sv.bg+';color:'+sv.t+'">'+e.sev+'</span>'+
      '<span class="ty">'+e.type+'</span></div>'+
      '<div class="r2"><span>'+e.order+'</span><span>'+e.veh+'</span><span>'+e.depot+'</span>'+
      '<span><em>open</em> '+e.age+'m</span></div>'+
      '<div class="r2" style="margin-top:2px;font-family:system-ui;color:var(--mut2)">'+e.note+'</div>'+
      '</div><div class="rt">'+
      '<span class="sla '+slaCls(left)+'" data-sla="'+e.id+'">'+slaTxt(left)+'</span>'+
      (e.ack?'<span class="badge g">acked</span>'
            :'<button class="btn tiny" data-ack="'+e.id+'">Ack</button>')+
      '</div></div>';
  }).join(''):'<div class="empty">No exceptions match this filter. Queue clear.</div>';
  list.forEach(function(e){e.fresh=false});
  box.scrollTop=top;
  var m=M();
  var c=document.getElementById('exCount');
  c.textContent=m.open;c.className='badge '+(m.crit?'r':m.open?'w':'g');
  var a=document.getElementById('alertBar');
  if(m.crit||m.brk){a.classList.add('show');
    document.getElementById('alertTxt').innerHTML='<b>'+m.crit+' critical</b> and <b>'+m.brk+
      ' SLA-breached</b> exceptions are unresolved — oldest open '+
      Math.max.apply(null,S.ex.filter(function(e){return !e.ack}).map(function(e){return e.age}))+' min';
  } else a.classList.remove('show');
  document.getElementById('footEx').textContent='queue '+m.open+' open / '+S.ackd+' acked / '+S.resolved+' cleared';
}
function tickSla(){
  document.querySelectorAll('[data-sla]').forEach(function(el){
    var e=S.ex.find(function(x){return x.id===el.getAttribute('data-sla')});
    if(!e)return;var left=e.sla-e.age;
    el.textContent=slaTxt(left);el.className='sla '+slaCls(left);
  });
}

/* ============ fleet ============ */
function drawFleet(m){
  var order=['on_route','loading','idle','maint','offline'];
  document.getElementById('segbar').innerHTML=order.map(function(k){
    return '<i style="width:'+(m.counts[k]/48*100)+'%;background:'+STATUS[k].c+'"></i>'}).join('');
  document.getElementById('fkeys').innerHTML=order.map(function(k){
    return '<div class="fk"><i style="background:'+STATUS[k].c+'"></i>'+STATUS[k].l+
      '<b>'+m.counts[k]+'</b></div>'}).join('');
  document.getElementById('fleetTag').textContent=m.act+' moving · '+m.late+' late';
  var box=document.getElementById('vlist'),top=box.scrollTop;
  var vs=S.vehicles.slice().sort(function(a,b){
    var w={offline:0,maint:1,on_route:2,loading:3,idle:4};
    return w[a.status]-w[b.status]||(b.late-a.late)||a.id.localeCompare(b.id)});
  box.innerHTML=vs.map(function(v){
    var p=Math.round(v.done/v.total*100);
    return '<div class="v'+(v.late?' late':'')+'">'+
      '<span class="st" style="background:'+STATUS[v.status].c+'"></span>'+
      '<span class="id">'+v.id+'</span>'+
      '<span class="dr">'+v.driver+' · '+v.depot+(v.late?' · late':'')+'</span>'+
      '<span class="mini"><i style="width:'+p+'%;background:'+(v.late?'#f5a524':'#3fb6f0')+'"></i></span>'+
      '<span class="pc">'+v.done+'/'+v.total+'</span></div>';
  }).join('');
  box.scrollTop=top;
}

/* ============ hourly ============ */
function drawHours(m){
  var h=opHour(),now=new Date(),html='',peak=0,vals=[];
  for(var i=6;i<=20;i++){
    var shape=[.55,.82,.95,1,.93,.72,.86,1,.97,.88,.74,.58,.4,.26,.12][i-6];
    var plan=Math.round(m.planned/14*shape*1.02);
    var act=i<h?Math.round(plan*(0.9+rnd()*0.16)):i===h?Math.round(plan*(now.getMinutes()/60)):0;
    vals.push({i:i,plan:plan,act:act});peak=Math.max(peak,plan);
  }
  vals.forEach(function(v){
    html+='<div class="hr'+(v.i===h?' now':'')+'">'+
      '<div class="bar" style="height:'+(v.plan/peak*100)+'%">'+
      '<i style="height:'+(v.plan?Math.min(100,v.act/v.plan*100):0)+'%"></i></div>'+
      '<span class="lb">'+String(v.i).padStart(2,'0')+'</span></div>';
  });
  document.getElementById('hrs').innerHTML=html;
  var cur=vals.find(function(v){return v.i===h});
  document.getElementById('thrTag').textContent=String(h).padStart(2,'0')+':00 — '+
    fmt(cur.act)+' of '+fmt(cur.plan)+' planned';
}

/* ============ depots ============ */
function drawDepots(){
  document.getElementById('depotBody').innerHTML=DEPOTS.map(function(d){
    var vs=S.vehicles.filter(function(v){return v.depot===d.c});
    var done=0,tot=0,act=0;
    vs.forEach(function(v){done+=v.done;tot+=v.total;
      if(v.status==='on_route'||v.status==='loading')act++});
    var late=vs.filter(function(v){return v.late}).length;
    var ot=Math.round((95.6-late*1.35-(rnd()*0.6))*10)/10;
    var exc=S.ex.filter(function(e){return !e.ack&&e.depot===d.c}).length;
    var col=ot>=95?'var(--ok)':ot>=92?'var(--warn)':'var(--crit)';
    return '<tr><td class="nm">'+d.n+' <span style="color:var(--mut2);font-family:var(--mono);font-size:10px">'+d.c+'</span></td>'+
      '<td class="n">'+act+'/'+vs.length+'</td>'+
      '<td class="n">'+Math.round(done/tot*100)+'%</td>'+
      '<td class="n" style="color:'+col+'">'+ot.toFixed(1)+'</td>'+
      '<td class="n" style="color:'+(exc>3?'var(--crit)':exc?'var(--warn)':'var(--mut2)')+'">'+exc+'</td></tr>';
  }).join('');
}

/* ============ chart ============ */
function initChart(){
  var cv=document.getElementById('otChart');
  if(!window.Chart){cv.parentNode.innerHTML='<div class="empty">Chart library unavailable offline — '+
    '30-day on-time figures are summarised in the strip below.</div>';return}
  var cx=cv.getContext('2d');
  var g=cx.createLinearGradient(0,0,0,220);
  g.addColorStop(0,'rgba(139,92,246,.38)');g.addColorStop(1,'rgba(139,92,246,0)');
  Chart.defaults.font.family='ui-monospace,SFMono-Regular,Menlo,monospace';
  Chart.defaults.font.size=10;Chart.defaults.color='#7b8aa3';
  chart=new Chart(cx,{type:'bar',
    data:{labels:[],datasets:[
      {type:'bar',label:'Volume',data:[],yAxisID:'y1',backgroundColor:'rgba(63,182,240,.16)',
       hoverBackgroundColor:'rgba(63,182,240,.3)',borderRadius:2,barPercentage:.74,categoryPercentage:.86,order:3},
      {type:'line',label:'Target',data:[],yAxisID:'y',borderColor:'rgba(244,82,95,.55)',
       borderWidth:1,borderDash:[5,4],pointRadius:0,pointHitRadius:0,fill:false,order:2},
      {type:'line',label:'On-time %',data:[],yAxisID:'y',borderColor:'#8b5cf6',borderWidth:2,
       pointRadius:0,pointHoverRadius:4,pointHoverBackgroundColor:'#fff',pointHoverBorderColor:'#8b5cf6',
       tension:.32,fill:true,backgroundColor:g,order:1}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:260},
      interaction:{mode:'index',intersect:false},
      layout:{padding:{top:4,right:2,left:2}},
      plugins:{legend:{display:false},
        tooltip:{backgroundColor:'#0d1220',borderColor:'#2b3548',borderWidth:1,padding:9,
          titleColor:'#e4eaf5',bodyColor:'#b9c5d8',displayColors:true,boxWidth:8,boxHeight:8,
          callbacks:{label:function(c){
            if(c.dataset.label==='Volume')return ' Volume  '+c.parsed.y.toLocaleString('en-GB')+' stops';
            if(c.dataset.label==='Target')return ' Target  95.0%';
            return ' On-time  '+c.parsed.y.toFixed(1)+'%'}}}},
      scales:{
        y:{min:80,max:100,position:'left',border:{display:false},
           grid:{color:'rgba(255,255,255,.045)'},
           ticks:{stepSize:5,callback:function(v){return v+'%'},padding:6}},
        y1:{min:0,max:9000,position:'right',border:{display:false},grid:{display:false},
            ticks:{callback:function(v){return v?(v/1000)+'k':'0'},padding:4,color:'#4e5d76',maxTicksLimit:4}},
        x:{border:{display:false},grid:{display:false},
           ticks:{maxRotation:0,autoSkip:true,maxTicksLimit:12,padding:4}}}}});
}
function upChart(){
  var d=S.series.slice(-S.range);
  var ots=d.map(function(x){return x.ot});
  if(chart){
    chart.data.labels=d.map(function(x){return x.label});
    chart.data.datasets[0].data=d.map(function(x){return x.vol});
    chart.data.datasets[1].data=d.map(function(){return 95});
    chart.data.datasets[2].data=ots;
    chart.options.scales.y1.max=Math.max.apply(null,d.map(function(x){return x.vol}))*2.5;
    chart.update();
  }
  var all=S.series.map(function(x){return x.ot});
  var l7=all.slice(-7),p7=all.slice(-14,-7);
  var dl=avg(l7)-avg(p7);
  var mx=S.series.reduce(function(a,b){return b.ot>a.ot?b:a});
  var mn=S.series.reduce(function(a,b){return b.ot<a.ot?b:a});
  document.getElementById('s7').textContent=avg(l7).toFixed(1)+'%';
  document.getElementById('s30').textContent=avg(all).toFixed(1)+'%';
  document.getElementById('sbw').innerHTML='<span style="color:var(--ok)">'+mx.ot.toFixed(1)+
    '</span> / <span style="color:var(--crit)">'+mn.ot.toFixed(1)+'</span>';
  var below=all.filter(function(v){return v<95}).length;
  document.getElementById('sbt').innerHTML='<span style="color:'+(below>12?'var(--crit)':'var(--warn)')+'">'+
    below+'</span><span style="color:var(--mut2);font-size:11px"> /30</span>';
  document.getElementById('strend').innerHTML='<span class="'+(dl>=0?'up':'down')+'">'+
    (dl>=0?'▲ +':'▼ ')+dl.toFixed(1)+'pt</span>';
}

/* ============ live simulation ============ */
function tickData(){
  var moved=false;
  S.vehicles.forEach(function(v){
    if(v.status==='on_route'&&v.done<v.total){v.done=Math.min(v.total,v.done+ri(0,2));moved=true}
    if(rnd()<.012){ // status churn
      var r=rnd();
      v.status=r<.62?'on_route':r<.76?'loading':r<.88?'idle':r<.96?'maint':'offline';
      if(v.status!=='on_route')v.late=false;
    }
    if(v.status==='on_route'&&rnd()<.008)v.late=!v.late;
  });
  if(rnd()<.33){var e=mkEx(0);e.fresh=true;S.ex.unshift(e);
    if(S.ex.length>44){S.resolved+=S.ex.length-44;S.ex.length=44}
    drawFilters();drawEx();}
  if(rnd()<.14)S.failed+=ri(1,2);
  var m=M();
  upKpis(m);drawFleet(m);drawHours(m);drawDepots();
  if(!moved)return;
}
function tickClock(){
  var n=new Date();
  document.getElementById('timeTxt').textContent=
    String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')+':'+
    String(n.getSeconds()).padStart(2,'0');
  document.getElementById('dateTxt').textContent=n.toLocaleDateString('en-GB',
    {weekday:'short',day:'numeric',month:'short',year:'numeric'});
  var h=n.getHours();
  document.getElementById('shiftTxt').textContent=(h<6?'Night shift':h<14?'Early shift':h<22?'Late shift':'Night shift')+' · Zone 4';
  if(S.live){S.sync++;S.ex.forEach(function(e){if(!e.ack&&S.sync%12===0)e.age++});tickSla()}
  document.getElementById('syncTag').textContent='sync '+(S.live?S.sync%4:'—')+'s';
  var up=Math.floor((Date.now()-S.started)/1000);
  document.getElementById('footUp').textContent='session '+Math.floor(up/60)+'m '+(up%60)+'s · '+
    (S.live?'streaming':'feed paused');
}

/* ============ events ============ */
document.getElementById('filters').addEventListener('click',function(ev){
  var b=ev.target.closest('button');if(!b)return;
  if(b.id==='hideAck'){S.hideAck=!S.hideAck}
  else if(b.dataset.sev){S.sev=b.dataset.sev}
  drawFilters();drawEx();
});
document.getElementById('exlist').addEventListener('click',function(ev){
  var b=ev.target.closest('button[data-ack]');if(!b)return;
  var e=S.ex.find(function(x){return x.id===b.dataset.ack});
  if(e&&!e.ack){e.ack=true;S.ackd++;drawFilters();drawEx();upKpis(M())}
});
document.getElementById('ackAll').addEventListener('click',function(){
  var n=0;S.ex.forEach(function(e){if(!e.ack&&(e.sev==='low'||e.sev==='medium')){e.ack=true;n++}});
  S.ackd+=n;drawFilters();drawEx();upKpis(M());
});
document.getElementById('jumpBtn').addEventListener('click',function(){
  S.sev='critical';S.hideAck=true;drawFilters();drawEx();
  document.getElementById('exPanel').scrollIntoView({behavior:'smooth',block:'center'});
});
document.querySelectorAll('[data-range]').forEach(function(b){
  b.addEventListener('click',function(){
    S.range=+b.dataset.range;
    document.querySelectorAll('[data-range]').forEach(function(x){x.classList.toggle('on',x===b)});
    upChart();
  });
});
document.getElementById('pauseBtn').addEventListener('click',function(){
  S.live=!S.live;this.textContent=S.live?'Pause feed':'Resume feed';
  this.setAttribute('aria-pressed',String(!S.live));this.classList.toggle('on',!S.live);
  var t=document.getElementById('liveTag');
  t.classList.toggle('off',!S.live);
  document.getElementById('liveTxt').textContent=S.live?'Live':'Paused';
});
document.getElementById('resetBtn').addEventListener('click',function(){
  rnd=mulberry(Date.now()&0xffffff);
  S.failed=0;S.ackd=0;S.resolved=0;S.sync=0;S.started=Date.now();
  S.vehicles=buildVehicles();S.ex=buildEx();S.series=buildSeries();
  S.sev='all';S.hideAck=false;
  drawFilters();drawEx();upChart();
  var m=M();upKpis(m);drawFleet(m);drawHours(m);drawDepots();
});

/* ============ boot ============ */
S.vehicles=buildVehicles();
S.ex=buildEx();
S.series=buildSeries();
drawKpis();drawFilters();initChart();upChart();
var m0=M();upKpis(m0);drawFleet(m0);drawHours(m0);drawDepots();drawEx();
tickClock();
setInterval(tickClock,1000);
setInterval(function(){if(S.live)tickData()},4000);
})();
</script>
</body>
</html>
:::

The layout assumes the operator's eye lands top-left and sweeps right, so the KPI strip carries the seven numbers you'd read every few minutes, the on-time chart sits under it for trend context, and the exception queue occupies the right rail where it stays visible without scrolling. Exceptions sort by time-to-SLA rather than by severity alone, which is usually what you actually want at 15:40 when three mediums are about to breach and a critical has an hour of slack. Breached items show a red `BREACH +Nm` counter, and a red banner appears whenever anything critical is unacknowledged.

The feed simulates live telemetry every four seconds: vehicles advance through stops, statuses churn, and new exceptions arrive with a brief highlight so you notice them peripherally. Pause freezes it for handover discussions; Reset reseeds the whole day. Ack clears individual items, "Ack low" bulk-clears the medium and low tiers, and the banner's "Go to queue" jumps you straight to unacknowledged criticals.

Two judgement calls worth flagging. Fleet totals are derived from the vehicle list rather than stored separately, so the delivered count, in-transit figure and depot percentages can never disagree with each other. And the on-time chart overlays delivery volume as faint bars on a second axis, because a dip to 88 percent on a 2,200-stop Sunday means something very different from the same dip on a 3,400-stop Tuesday.