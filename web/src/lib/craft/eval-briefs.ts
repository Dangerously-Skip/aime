/**
 * The fixed brief set for the P7 craft baseline.
 *
 * ## Why these are frozen
 *
 * A before/after is only a measurement if the *before* was captured with the
 * same briefs and the same instrument. Once P7.1 edits a prompt, the "before" is
 * gone and cannot be recreated — so this list is written once, run against
 * today's unmodified code surface, and then left alone. Adding a brief later is
 * fine; CHANGING one silently invalidates every prior comparison, which is why
 * each has a stable `id` that the stored artifacts are filed under.
 *
 * ## Why this shape of coverage
 *
 * They are chosen where the model's default house style diverges most from what
 * the brief actually needs — a dashboard and a marketing page want opposite
 * things, and a single "make a landing page" measures neither.
 *
 * `underspecified` is the most informative one and the reason it is included
 * despite looking lazy: DR-16 records that the underspecified brief is the main
 * cause of generic output, and P7.5 (a turn-1 question form) is a proposed fix.
 * Without a baseline for it there is nothing to show that fix worked.
 *
 * ## Why sixteen rather than eight
 *
 * The first eight were enough to prove the harness and not enough to conclude
 * anything. Samples of the same brief are correlated — an easy brief produces
 * correlated wins — so the effective sample size is governed by the number of
 * BRIEFS, not the number of runs. At eight briefs and three samples the
 * effective n is around twelve whatever the sample count, which is why the
 * binding constraint was here and not in `SAMPLES`. Doubling the briefs buys
 * more than doubling the samples would, and costs the same.
 *
 * The second eight also fix a coverage hole that only became obvious once the
 * medium question was asked properly: eleven of the first twelve artifacts were
 * screens. Decks, print and email are different media with different rules, they
 * are things this app is asked for constantly, and a craft claim that has only
 * ever been tested on web pages is a claim about web pages.
 */

export interface Brief {
  /** Stable — artifacts are filed under this. Never renumber. */
  id: string;
  /**
   * What kind of thing this is, for reading the results and for choosing which
   * craft skill should have fired.
   *
   * Unlike `prompt`, this is NOT frozen: it is never sent to the model, so
   * reclassifying one changes how a result reads and not what was measured.
   * `slide-deck` moved from `document` to `deck` for exactly that reason.
   */
  shape: 'app' | 'marketing' | 'data' | 'document' | 'deck' | 'print';
  /** Sent to the code surface verbatim. */
  prompt: string;
  /** What this brief is here to reveal. Not sent to the model. */
  probes: string;
}

export const EVAL_BRIEFS: Brief[] = [
  {
    id: 'dashboard-ops',
    shape: 'app',
    prompt:
      'Build a single-page operations dashboard for a delivery company: fleet status, ' +
      'today’s deliveries, exceptions needing attention, and a chart of on-time rate over ' +
      'the last 30 days. Dense, for someone watching it all day.',
    probes:
      'Data density and restraint. The warm-editorial default house style is wrong here, ' +
      'and "watching it all day" should push toward calm surfaces rather than decoration.',
  },
  {
    id: 'marketing-saas',
    shape: 'marketing',
    prompt:
      'Build a landing page for a B2B API monitoring product called Sentinel. Hero, three ' +
      'feature blocks, pricing table, footer.',
    probes:
      'The classic slop shape: this is where the two-stop gradient, emoji feature icons and ' +
      'default indigo appear if they are going to.',
  },
  {
    id: 'data-table',
    shape: 'data',
    prompt:
      'Build a table view of 200 customer invoices with sorting, filtering and pagination. ' +
      'Users scan it looking for overdue ones.',
    probes:
      'State coverage — empty, loading, error — and whether numeric columns get tabular ' +
      'figures and right alignment. "Looking for overdue ones" is a hierarchy test.',
  },
  {
    id: 'form-onboarding',
    shape: 'app',
    prompt:
      'Build a three-step account setup form: company details, team invites, billing. Show ' +
      'progress between steps and handle validation errors.',
    probes:
      'Error states are named in the brief, so omitting them is unambiguous. Also tests ' +
      'whether required/optional and inline validation are handled or just decorated.',
  },
  {
    id: 'mobile-screen',
    shape: 'app',
    prompt:
      'Build the main screen of a mobile app for tracking daily water intake. Single screen, ' +
      'no navigation.',
    probes:
      'Touch targets and whether the layout is designed for small screens rather than a ' +
      'squeezed desktop one.',
  },
  {
    id: 'dark-app-shell',
    shape: 'app',
    prompt:
      'Build a dark-mode application shell for a code review tool: sidebar of pull requests, ' +
      'main diff area, top bar with search.',
    probes:
      'Dark mode is where pure #000 and low-contrast greys show up. Also whether the dark ' +
      'palette is designed or is the light one inverted.',
  },
  {
    id: 'slide-deck',
    shape: 'deck',
    prompt:
      'Build a 5-slide deck introducing a quarterly engineering roadmap to non-engineers. ' +
      '1920x1080.',
    probes:
      'A deck is not a web page. Tests whether the output respects the medium — type scale ' +
      'for a projected slide, one idea per slide.',
  },
  {
    id: 'underspecified',
    shape: 'marketing',
    prompt: 'Make me a landing page.',
    probes:
      'The control, and the most informative brief here. With no direction, whatever appears ' +
      'IS the default house style. DR-16 records the underspecified brief as the main cause ' +
      'of generic output; P7.5 proposes a turn-1 question form as the fix, and this is the ' +
      'only thing that could show it worked.',
  },

  // ---------------------------------------------------------------------------
  // Added 2026-08-01. The first eight above are unchanged and their stored
  // artifacts remain comparable; these eight simply have no history yet.
  // ---------------------------------------------------------------------------

  {
    id: 'deck-pitch',
    shape: 'deck',
    prompt:
      'Build a 10-slide pitch deck for a seed-stage company selling warehouse robotics to ' +
      'mid-size logistics firms. Include the market, the product, traction and the ask.',
    probes:
      'A longer deck than slide-deck, with numbers in it. Tests whether headlines state the ' +
      'argument or label the topic, and whether the traction slide invents plausible figures ' +
      'rather than marking them as placeholders.',
  },
  {
    id: 'pdf-report',
    shape: 'print',
    prompt:
      'Build a printable quarterly performance report for a facilities management company. ' +
      'Around six pages, A4, with a summary, tables and two charts. It will be printed and ' +
      'handed out.',
    probes:
      'Print is a medium with rules screens do not have: page breaks that do not split a ' +
      'table row, margins that survive a printer, no hover state as the only affordance, and ' +
      'colour that still works in greyscale. "Printed and handed out" is stated, so ignoring ' +
      'it is unambiguous.',
  },
  {
    id: 'doc-invoice',
    shape: 'print',
    prompt:
      'Build an invoice template for a design studio billing a corporate client. Line items, ' +
      'tax, totals, payment terms.',
    probes:
      'The strictest numeric-alignment test in the set: tabular figures, right-aligned money, ' +
      'a total that is visually distinct from the line items. Also whether legally-required ' +
      'furniture (dates, references, terms) is treated as content or as decoration.',
  },
  {
    id: 'email-html',
    shape: 'document',
    prompt:
      'Build a transactional HTML email confirming a hotel booking. It needs to render in ' +
      'Outlook and Gmail.',
    probes:
      'A constrained medium the model knows about in theory. Naming Outlook should force ' +
      'table layout and inline styles; a flexbox-and-external-stylesheet answer is a clean ' +
      'demonstration of medium being ignored despite being stated.',
  },
  {
    id: 'settings-dense',
    shape: 'app',
    prompt:
      'Build the settings page for a team collaboration tool: profile, notifications, ' +
      'integrations, billing and danger zone. Around 30 individual settings.',
    probes:
      'Grouping and restraint at volume. Thirty controls is where an undisciplined design ' +
      'reaches for cards, borders and colour to create structure that spacing and type ' +
      'should be carrying. Also: is the destructive action distinguished without being loud?',
  },
  {
    id: 'pricing-tiers',
    shape: 'marketing',
    prompt:
      'Build a three-tier pricing section for a project management SaaS, with a monthly and ' +
      'annual toggle and a feature comparison.',
    probes:
      'The single most template-shaped component on the web. Tests whether the "most popular" ' +
      'tier is distinguished by one considered device or by a gradient, a badge, a scale ' +
      'transform and a shadow at once.',
  },
  {
    id: 'analytics-charts',
    shape: 'data',
    prompt:
      'Build an analytics overview page for a podcast platform: listens over time, top ' +
      'episodes, listener geography, and completion rate.',
    probes:
      'Chart craft specifically — series count, direct labelling versus a legend to match ' +
      'across the page, axes that start at a defensible number, and whether four charts get ' +
      'four different visual treatments or one coherent one.',
  },
  {
    id: 'search-results',
    shape: 'app',
    prompt:
      'Build a search results page for a job board, with filters for location, salary and ' +
      'contract type.',
    probes:
      'The zero-results state is the whole point and the brief deliberately does not mention ' +
      'it — a search page that cannot return nothing does not exist. Complements data-table, ' +
      'where the states are also unnamed but the emptiness is less inevitable.',
  },
];

/** Guard against a silent renumbering breaking every stored comparison. */
export const BRIEF_IDS = EVAL_BRIEFS.map((b) => b.id);

/**
 * The briefs that already have baseline artifacts on disk, and whose prompts
 * therefore must not change. Enforced by hash in `eval-briefs.test.ts`.
 *
 * The doc comment at the top of this file has said "CHANGING one silently
 * invalidates every prior comparison" since it was written, which is a rule with
 * nothing behind it. This is the same rule, able to fail a build.
 */
export const FROZEN_BRIEF_IDS = [
  'dashboard-ops',
  'marketing-saas',
  'data-table',
  'form-onboarding',
  'mobile-screen',
  'dark-app-shell',
  'slide-deck',
  'underspecified',
] as const;
