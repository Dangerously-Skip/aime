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
 */

export interface Brief {
  /** Stable — artifacts are filed under this. Never renumber. */
  id: string;
  /** What kind of surface this is, for reading the results. */
  shape: 'app' | 'marketing' | 'data' | 'document';
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
    shape: 'document',
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
];

/** Guard against a silent renumbering breaking every stored comparison. */
export const BRIEF_IDS = EVAL_BRIEFS.map((b) => b.id);
