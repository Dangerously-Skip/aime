I'll build this as a working HTML artifact. Let me check the current directory first and then use the web artifacts builder skill.Let me fix two responsive issues I can see in the CSS before calling it done.The page is built and saved to `sentinel.html`.

:::artifact{title="Sentinel — API monitoring landing page" type="html" src="/private/var/folders/d0/txv3wxh52hz85x8vyxr_5ytw0000gn/T/aime-eval-marketing-saas-2-Jmj8yp/sentinel.html"}
:::

A few notes on the decisions I made, since they're the sort of thing you'll want to overrule if the real positioning differs:

**Positioning.** I wrote it around the SLA angle — the buyer is a platform team that has contractually promised uptime to customers, not a hobbyist checking whether a box is pingable. That drove the headline ("Know your API is down before your customers tell you") and the differentiator running through all three features: Sentinel verifies the API *works*, not that the server responds. If Sentinel is actually aimed at earlier-stage teams, this reads too enterprise and should soften.

**Hero visual.** Rather than a stock illustration, the hero has a working mock of the product dashboard in SVG — uptime and p95 stats, a p50/p99 latency chart with an SLO threshold line, and three endpoint rows with a warning and a failure visible. The visible bad row (`/v2/webhooks/replay` at 1.2s) is deliberate: a dashboard where everything is green demonstrates nothing.

**Pricing.** Three tiers at $49 / $249 / Custom, priced per monitored endpoint rather than per host, with the middle tier flagged as most popular. The tier axes are the ones that actually matter in this category — endpoint count, check interval, region coverage, retention, and alert routing — which gives a real reason to move up rather than arbitrary feature gating. The numbers are plausible for the category but invented, so replace them with yours.

**Content.** No placeholder text anywhere, but three things are fabricated and need your input before this goes near a customer: the six customer names in the trust bar, the SOC 2 / 99.99% SLA claims, and every price. The "19 regions" and interval figures are likewise made up.

Two things I'd add next if you want to keep going: a monthly/annual billing toggle on the pricing section, which needs a few lines of JS and would justify the "annual saves 20%" line that's currently just text, and a comparison row block below the tiers if you expect buyers to evaluate Sentinel against a named competitor.