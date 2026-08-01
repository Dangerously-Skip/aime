I'll use the canvas design skill for this.:::artifact{title="Sentinel — API Monitoring Landing Page" type="html"}
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sentinel — API monitoring for teams who ship</title>
<style>
  :root{
    --ink:#0A0B0D;
    --ink-2:#16181D;
    --paper:#FBFBFA;
    --line:#E5E4E0;
    --line-dark:#26292F;
    --muted:#6B6F76;
    --muted-dark:#9AA0A8;
    --accent:#00D68F;
    --accent-ink:#03301F;
  }
  *{box-sizing:border-box}
  html{-webkit-font-smoothing:antialiased}
  body{
    margin:0;
    background:var(--paper);
    color:var(--ink);
    font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    font-size:16px;
    line-height:1.55;
  }
  h1,h2,h3{font-family:'SF Pro Display',system-ui,sans-serif;letter-spacing:-.025em;line-height:1.05;margin:0}
  a{color:inherit;text-decoration:none}
  .wrap{max-width:1160px;margin:0 auto;padding:0 32px}
  .eyebrow{
    font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)
  }

  /* ---------- nav ---------- */
  .dark{background:var(--ink);color:#fff}
  nav{display:flex;align-items:center;justify-content:space-between;padding:22px 0}
  .brand{display:flex;align-items:center;gap:10px;font-weight:650;font-size:17px;letter-spacing:-.01em}
  .nav-links{display:flex;gap:32px;font-size:14.5px;color:var(--muted-dark)}
  .nav-links a:hover{color:#fff}
  .btn{
    display:inline-flex;align-items:center;gap:8px;border-radius:8px;
    font-size:14.5px;font-weight:600;padding:11px 18px;border:1px solid transparent;
    transition:transform .15s ease, opacity .15s ease;
  }
  .btn:hover{transform:translateY(-1px)}
  .btn-accent{background:var(--accent);color:var(--accent-ink)}
  .btn-ghost{border-color:var(--line-dark);color:#fff}
  .btn-lg{padding:14px 22px;font-size:15.5px}

  /* ---------- hero ---------- */
  .hero{
    position:relative;overflow:hidden;
    background:
      radial-gradient(900px 420px at 78% -8%, rgba(0,214,143,.16), transparent 60%),
      linear-gradient(180deg,#0A0B0D 0%,#101216 100%);
  }
  .hero:before{
    content:"";position:absolute;inset:0;
    background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),
                     linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);
    background-size:52px 52px;
    mask-image:radial-gradient(70% 60% at 50% 0%,#000,transparent);
  }
  .hero-grid{
    position:relative;display:grid;grid-template-columns:1.05fr .95fr;gap:56px;
    align-items:center;padding:88px 0 100px;
  }
  .pill{
    display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:550;
    color:#D6DAE0;border:1px solid var(--line-dark);background:rgba(255,255,255,.03);
    padding:6px 13px;border-radius:999px;margin-bottom:26px;
  }
  .dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(0,214,143,.18)}
  h1{font-size:60px;font-weight:680;color:#fff}
  h1 em{font-style:normal;color:var(--accent)}
  .lede{margin:22px 0 0;font-size:18.5px;color:var(--muted-dark);max-width:30em}
  .cta-row{display:flex;gap:12px;margin-top:34px;flex-wrap:wrap}
  .microcopy{margin-top:16px;font-size:13.5px;color:#71767E}

  /* hero card */
  .card{
    background:rgba(255,255,255,.035);border:1px solid var(--line-dark);
    border-radius:16px;padding:22px;backdrop-filter:blur(6px);
  }
  .card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
  .card-title{font-size:14px;font-weight:600;color:#fff}
  .card-sub{font-size:12px;color:#71767E;font-variant-numeric:tabular-nums}
  .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px}
  .metric{border:1px solid var(--line-dark);border-radius:11px;padding:13px 14px;background:rgba(0,0,0,.25)}
  .metric .k{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#71767E}
  .metric .v{font-size:23px;font-weight:650;color:#fff;font-variant-numeric:tabular-nums;letter-spacing:-.02em;margin-top:4px}
  .metric .v.up{color:var(--accent)}
  .legend{display:flex;gap:18px;font-size:11.5px;color:#71767E;margin-top:12px}
  .swatch{display:inline-block;width:9px;height:2px;vertical-align:3px;margin-right:6px;background:var(--accent)}
  .swatch.alt{background:#3B4048;height:2px}

  /* ---------- logos ---------- */
  .logos{border-top:1px solid var(--line-dark);padding:26px 0}
  .logos-inner{display:flex;align-items:center;gap:40px;flex-wrap:wrap;justify-content:space-between}
  .logos span{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5C6views}
  .logo-word{font-size:17px;font-weight:640;color:#5F646C;letter-spacing:-.01em}

  /* ---------- features ---------- */
  section.pad{padding:96px 0}
  .sec-head{max-width:34em}
  .sec-head h2{font-size:40px;font-weight:670;margin-top:14px}
  .sec-head p{color:var(--muted);font-size:17.5px;margin:16px 0 0}
  .features{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:56px}
  .feature{
    background:#fff;border:1px solid var(--line);border-radius:16px;padding:30px 28px 32px;
  }
  .ficon{
    width:42px;height:42px;border-radius:11px;display:grid;place-items:center;
    background:var(--ink);margin-bottom:22px;
  }
  .feature h3{font-size:20.5px;font-weight:650;margin-bottom:10px}
  .feature p{color:var(--muted);font-size:15px;margin:0}
  .flist{list-style:none;margin:20px 0 0;padding:0;border-top:1px solid var(--line);padding-top:16px}
  .flist li{font-size:14px;color:#40444A;padding:5px 0 5px 22px;position:relative}
  .flist li:before{
    content:"";position:absolute;left:0;top:11px;width:11px;height:11px;border-radius:50%;
    background:rgba(0,214,143,.16);box-shadow:inset 0 0 0 2px var(--accent);
  }

  /* ---------- pricing ---------- */
  .pricing{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  table{width:100%;border-collapse:collapse;margin-top:48px;font-variant-numeric:tabular-nums}
  th,td{text-align:left;padding:16px 20px;border-bottom:1px solid var(--line);vertical-align:middle}
  thead th{border-bottom:1px solid var(--ink);vertical-align:bottom}
  thead th:first-child{width:34%}
  .plan-name{font-size:13px;font-weight:650;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .plan-price{font-family:'SF Pro Display',system-ui,sans-serif;font-size:38px;font-weight:670;letter-spacing:-.03em;margin:8px 0 2px}
  .plan-price small{font-size:14px;font-weight:500;color:var(--muted);letter-spacing:0}
  .plan-note{font-size:13px;color:var(--muted);margin-bottom:18px;min-height:38px}
  .col-feat{background:rgba(0,214,143,.05)}
  th.col-feat{position:relative}
  .tag{
    position:absolute;top:-11px;left:20px;background:var(--accent);color:var(--accent-ink);
    font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:3px 9px;border-radius:5px;
  }
  td.row-label{font-weight:550;font-size:15px}
  td.row-label span{display:block;font-weight:400;font-size:13px;color:var(--muted);margin-top:2px}
  .val{font-size:15px;color:#2C3036}
  .yes:before{content:"✓";color:var(--accent);font-weight:700;margin-right:0}
  .no{color:#B6B9BD}
  tfoot td{border-bottom:none;padding-top:22px}
  .btn-dark{background:var(--ink);color:#fff}
  .btn-outline{border-color:var(--line);color:var(--ink);background:#fff}
  .btn-full{width:100%;justify-content:center}
  .price-foot{margin-top:22px;font-size:13.5px;color:var(--muted)}

  /* ---------- footer ---------- */
  footer{background:var(--ink);color:#fff;padding:72px 0 34px}
  .fgrid{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:40px}
  .ftag{color:var(--muted-dark);font-size:14.5px;max-width:24em;margin:16px 0 22px}
  .status{
    display:inline-flex;align-items:center;gap:9px;font-size:13px;color:#D6DAE0;
    border:1px solid var(--line-dark);border-radius:999px;padding:6px 13px;
  }
  .fcol h4{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#71767E;margin:0 0 16px;font-weight:650}
  .fcol ul{list-style:none;margin:0;padding:0}
  .fcol li{margin-bottom:11px}
  .fcol a{font-size:14.5px;color:var(--muted-dark)}
  .fcol a:hover{color:#fff}
  .fbot{
    display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;
    border-top:1px solid var(--line-dark);margin-top:56px;padding-top:24px;font-size:13.5px;color:#71767E;
  }
  .fbot nav{display:flex;gap:24px;padding:0}
  .fbot a:hover{color:#fff}

  @media (max-width:900px){
    .hero-grid,.features,.fgrid{grid-template-columns:1fr}
    h1{font-size:42px}.sec-head h2{font-size:31px}
    .nav-links{display:none}
    .wrap{padding:0 20px}
    table{display:block;overflow-x:auto;white-space:nowrap}
  }
</style>
</head>
<body>

<!-- ============ HERO ============ -->
<div class="hero">
  <div class="wrap">
    <nav>
      <div class="brand">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2.5 20 5.6v6.1c0 4.7-3.2 8.9-8 10.3-4.8-1.4-8-5.6-8-10.3V5.6L12 2.5Z" stroke="#00D68F" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M7.4 12.6h2.3l1.5-3.1 1.7 5 1.3-1.9h2.4" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Sentinel
      </div>
      <div class="nav-links">
        <a href="#features">Platform</a>
        <a href="#pricing">Pricing</a>
        <a href="#">Docs</a>
        <a href="#">Customers</a>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <a class="btn btn-ghost" href="#">Sign in</a>
        <a class="btn btn-accent" href="#pricing">Start free trial</a>
      </div>
    </nav>
  </div>

  <div class="wrap">
    <div class="hero-grid">
      <div>
        <div class="pill"><span class="dot"></span> 18 probe regions · 30-second resolution</div>
        <h1>Know your API is broken <em>before</em> your customers do.</h1>
        <p class="lede">Sentinel runs authenticated, multi-step checks against your endpoints from around the world, tracks latency against your SLOs, and pages the right engineer with the request that failed already attached.</p>
        <div class="cta-row">
          <a class="btn btn-accent btn-lg" href="#pricing">Start 14-day trial</a>
          <a class="btn btn-ghost btn-lg" href="#">
            Book a technical demo
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>
        </div>
        <p class="microcopy">No credit card. SSO and SOC 2 report available on day one.</p>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">POST /v2/payments · production</div>
            <div class="card-sub">Last 24 hours · p95 response time</div>
          </div>
          <span class="status" style="border-color:rgba(0,214,143,.4)"><span class="dot"></span> Healthy</span>
        </div>

        <div class="metrics">
          <div class="metric"><div class="k">Uptime</div><div class="v up">99.98%</div></div>
          <div class="metric"><div class="k">p95</div><div class="v">142<span style="font-size:13px;color:#71767E"> ms</span></div></div>
          <div class="metric"><div class="k">Error budget</div><div class="v">78%</div></div>
        </div>

        <svg viewBox="0 0 520 150" width="100%" height="150" preserveAspectRatio="none" aria-label="Latency chart">
          <defs>
            <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#00D68F" stop-opacity=".28"/>
              <stop offset="100%" stop-color="#00D68F" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <g stroke="#22252B" stroke-width="1">
            <line x1="0" y1="30" x2="520" y2="30"/><line x1="0" y1="70" x2="520" y2="70"/>
            <line x1="0" y1="110" x2="520" y2="110"/>
          </g>
          <path d="M0 108 L40 100 L80 106 L120 96 L160 102 L200 92 L240 98 L280 40 L300 26 L320 62 L360 88 L400 96 L440 90 L480 98 L520 94"
                fill="none" stroke="#00D68F" stroke-width="2.2" stroke-linejoin="round"/>
          <path d="M0 108 L40 100 L80 106 L120 96 L160 102 L200 92 L240 98 L280 40 L300 26 L320 62 L360 88 L400 96 L440 90 L480 98 L520 94 L520 150 L0 150 Z"
                fill="url(#fill)"/>
          <line x1="300" y1="8" x2="300" y2="150" stroke="#F4C542" stroke-width="1.4" stroke-dasharray="4 4"/>
          <circle cx="300" cy="26" r="4.5" fill="#F4C542"/>
          <text x="292" y="146" text-anchor="end" fill="#9AA0A8" font-size="11" font-family="system-ui">deploy 4f2a91 · alert sent in 34s</text>
        </svg>
        <div class="legend">
          <span><i class="swatch"></i>p95 latency</span>
          <span><i class="swatch alt" style="background:#F4C542"></i>Deploy marker</span>
          <span style="margin-left:auto;font-variant-numeric:tabular-nums">4.2M checks / day</span>
        </div>
      </div>
    </div>
  </div>

  <div class="wrap">
    <div class="logos">
      <div class="logos-inner">
        <span style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5F646C">Monitoring APIs at</span>
        <div class="logo-word">Ledgerly</div>
        <div class="logo-word">Northwind Pay</div>
        <div class="logo-word">Kestrel Health</div>
        <div class="logo-word">Onyx Logistics</div>
        <div class="logo-word">Fathom AI</div>
      </div>
    </div>
  </div>
</div>

<!-- ============ FEATURES ============ -->
<section class="pad" id="features">
  <div class="wrap">
    <div class="sec-head">
      <div class="eyebrow">The platform</div>
      <h2>Three things every API team needs, and nothing it doesn't.</h2>
      <p>Sentinel is built for backend and platform teams — not for marketing dashboards. Configure it in YAML, ship it in your pipeline, keep it in version control.</p>
    </div>

    <div class="features">
      <div class="feature">
        <div class="ficon">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#00D68F" stroke-width="1.8"/><path d="M3.2 9.5h17.6M3.2 14.5h17.6M12 3c-3.2 3.4-3.2 14.6 0 18M12 3c3.2 3.4 3.2 14.6 0 18" stroke="#00D68F" stroke-width="1.4"/></svg>
        </div>
        <h3>Synthetic checks that log in</h3>
        <p>Chain requests into real user journeys: fetch a token, create a resource, poll until ready, assert on the JSON body. Not just a ping to <code>/health</code>.</p>
        <ul class="flist">
          <li>OAuth2, mTLS, API key and HMAC signing</li>
          <li>18 public regions plus private agents in your VPC</li>
          <li>JSONPath and schema assertions per step</li>
        </ul>
      </div>

      <div class="feature">
        <div class="ficon">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M4 19V5" stroke="#00D68F" stroke-width="1.8" stroke-linecap="round"/><path d="M4 19h16" stroke="#00D68F" stroke-width="1.8" stroke-linecap="round"/><path d="M7.5 15l3.5-5 3 3 4.5-6.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <h3>SLOs and error budgets</h3>
        <p>Define the availability and latency targets you actually promise customers. Sentinel tracks burn rate continuously and tells you how much room is left this quarter.</p>
        <ul class="flist">
          <li>p50 / p95 / p99 broken out by region and route</li>
          <li>Multi-window burn-rate alerting</li>
          <li>Shareable status pages and monthly SLA reports</li>
        </ul>
      </div>

      <div class="feature">
        <div class="ficon">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none"><path d="M12 3a6 6 0 0 0-6 6v4l-1.8 3.2A.8.8 0 0 0 4.9 17h14.2a.8.8 0 0 0 .7-.8L18 13V9a6 6 0 0 0-6-6Z" stroke="#00D68F" stroke-width="1.7" stroke-linejoin="round"/><path d="M9.8 20a2.4 2.4 0 0 0 4.4 0" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>
        </div>
        <h3>Alerts on-call won't mute</h3>
        <p>Every page arrives with the failing request, response body, diff against the last good run, and the deploy that landed just before it. Flapping checks are held back automatically.</p>
        <ul class="flist">
          <li>PagerDuty, Opsgenie, Slack and webhook routing</li>
          <li>Deduplication and maintenance windows</li>
          <li>Escalation policies per service owner</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<!-- ============ PRICING ============ -->
<section class="pad pricing" id="pricing">
  <div class="wrap">
    <div class="sec-head">
      <div class="eyebrow">Pricing</div>
      <h2>Priced per check, not per seat.</h2>
      <p>Invite your whole engineering org on any plan. Annual billing saves two months.</p>
    </div>

    <table>
      <thead>
        <tr>
          <th></th>
          <th>
            <div class="plan-name">Developer</div>
            <div class="plan-price">$49<small>/mo</small></div>
            <div class="plan-note">For a single service or side project.</div>
            <a class="btn btn-outline btn-full" href="#">Start free trial</a>
          </th>
          <th class="col-feat">
            <span class="tag">Most popular</span>
            <div class="plan-name">Team</div>
            <div class="plan-price">$249<small>/mo</small></div>
            <div class="plan-note">For product teams running APIs in production.</div>
            <a class="btn btn-dark btn-full" href="#">Start free trial</a>
          </th>
          <th>
            <div class="plan-name">Enterprise</div>
            <div class="plan-price">Custom</div>
            <div class="plan-note">For regulated environments and large estates.</div>
            <a class="btn btn-outline btn-full" href="#">Talk to sales</a>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="row-label">Monitored endpoints</td>
          <td class="val">25</td>
          <td class="val col-feat">250</td>
          <td class="val">Unlimited</td>
        </tr>
        <tr>
          <td class="row-label">Check frequency<span>Minimum interval per check</span></td>
          <td class="val">1 minute</td>
          <td class="val col-feat">30 seconds</td>
          <td class="val">10 seconds</td>
        </tr>
        <tr>
          <td class="row-label">Probe regions</td>
          <td class="val">5</td>
          <td class="val col-feat">All 18</td>
          <td class="val">All 18 + private agents</td>
        </tr>
        <tr>
          <td class="row-label">Data retention</td>
          <td class="val">14 days</td>
          <td class="val col-feat">13 months</td>
          <td class="val">Custom, up to 5 years</td>
        </tr>
        <tr>
          <td class="row-label">Multi-step authenticated flows</td>
          <td class="val no">—</td>
          <td class="val col-feat yes"></td>
          <td class="val yes"></td>
        </tr>
        <tr>
          <td class="row-label">SLO tracking &amp; error budgets</td>
          <td class="val no">—</td>
          <td class="val col-feat yes"></td>
          <td class="val yes"></td>
        </tr>
        <tr>
          <td class="row-label">On-call escalation policies</td>
          <td class="val">Slack &amp; email</td>
          <td class="val col-feat">PagerDuty, Opsgenie, webhooks</td>
          <td class="val">Custom routing &amp; audit trail</td>
        </tr>
        <tr>
          <td class="row-label">SAML SSO &amp; SCIM provisioning</td>
          <td class="val no">—</td>
          <td class="val col-feat">SSO</td>
          <td class="val">SSO + SCIM</td>
        </tr>
        <tr>
          <td class="row-label">Support</td>
          <td class="val">Community</td>
          <td class="val col-feat">Email, 1 business day</td>
          <td class="val">Named engineer, 99.9% SLA</td>
        </tr>
        <tr>
          <td class="row-label">Team members</td>
          <td class="val">Unlimited</td>
          <td class="val col-feat">Unlimited</td>
          <td class="val">Unlimited</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td></td>
          <td><a class="btn btn-outline btn-full" href="#">Start free trial</a></td>
          <td class="col-feat"><a class="btn btn-dark btn-full" href="#">Start free trial</a></td>
          <td><a class="btn btn-outline btn-full" href="#">Talk to sales</a></td>
        </tr>
      </tfoot>
    </table>

    <p class="price-foot">All plans include unlimited seats, the Terraform provider, the CLI, and public status pages. Need volume pricing above 5,000 endpoints? <a href="#" style="color:var(--ink);text-decoration:underline;text-underline-offset:3px">Contact us</a>.</p>
  </div>
</section>

<!-- ============ FOOTER ============ -->
<footer>
  <div class="wrap">
    <div class="fgrid">
      <div>
        <div class="brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2.5 20 5.6v6.1c0 4.7-3.2 8.9-8 10.3-4.8-1.4-8-5.6-8-10.3V5.6L12 2.5Z" stroke="#00D68F" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M7.4 12.6h2.3l1.5-3.1 1.7 5 1.3-1.9h2.4" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Sentinel
        </div>
        <p class="ftag">Uptime, latency and SLO monitoring for the APIs your customers depend on.</p>
        <span class="status"><span class="dot"></span> All systems operational</span>
      </div>

      <div class="fcol">
        <h4>Product</h4>
        <ul>
          <li><a href="#">Synthetic monitoring</a></li>
          <li><a href="#">SLO tracking</a></li>
          <li><a href="#">Alerting &amp; on-call</a></li>
          <li><a href="#">Status pages</a></li>
          <li><a href="#">Integrations</a></li>
        </ul>
      </div>

      <div class="fcol">
        <h4>Developers</h4>
        <ul>
          <li><a href="#">Documentation</a></li>
          <li><a href="#">API reference</a></li>
          <li><a href="#">CLI</a></li>
          <li><a href="#">Terraform provider</a></li>
          <li><a href="#">Changelog</a></li>
        </ul>
      </div>

      <div class="fcol">
        <h4>Company</h4>
        <ul>
          <li><a href="#">About</a></li>
          <li><a href="#">Customers</a></li>
          <li><a href="#">Security &amp; SOC 2</a></li>
          <li><a href="#">Blog</a></li>
          <li><a href="#">Careers</a></li>
        </ul>
      </div>
    </div>

    <div class="fbot">
      <div>© 2026 Sentinel Labs, Inc. · SOC 2 Type II · GDPR ready</div>
      <nav>
        <a href="#">Privacy</a>
        <a href="#">Terms</a>
        <a href="#">DPA</a>
        <a href="#">Sub-processors</a>
      </nav>
    </div>
  </div>
</footer>

</body>
</html>
:::

The page is live in the canvas panel. A few decisions worth flagging, since they're easy to change:

The palette is near-black plus a single signal green, which reads as "healthy service" and is idiomatic for observability tooling. The hero pairs the headline with a working latency chart rather than a product screenshot, including a deploy marker and a 34-second time-to-alert annotation, because for this audience the proof is the data.

Pricing is per-check with unlimited seats. That's a deliberate positioning choice for developer tools, and it makes the "Team members: Unlimited" row a selling point rather than filler. The middle tier at $249 is anchored as most popular with the feature column tinted and the only dark CTA on the page.

Copy is concrete throughout — named regions, real auth mechanisms, specific retention windows. If you have actual numbers, swapping them in is a find-and-replace. Tell me if you'd rather go light-hero, add a testimonial or FAQ band above the footer, or shift the accent to something closer to an existing brand.