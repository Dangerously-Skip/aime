/**
 * The rubric the pairwise judge scores against.
 *
 * ## Why a rubric rather than "which is better"
 *
 * An unguided pairwise judge agrees with human raters noticeably less than one
 * given explicit dimensions, and — worse for our purpose — it drifts. A bare
 * preference question invites the judge to reward whatever is showier, which is
 * precisely the failure mode P7 exists to remove. Naming the dimensions fixes
 * what "better" means across runs so a later comparison is against the same
 * question.
 *
 * ## Why these dimensions
 *
 * Each one is something `slop-tells.ts` CANNOT decide. The deterministic checker
 * already covers the countable tells (a specific hex, a missing property, a
 * ratio); duplicating those here would double-count them and let a judge's
 * opinion overwrite a fact. So the rubric deliberately starts where the regex
 * stops: hierarchy, restraint, fit to the medium, and whether the thing actually
 * answers the brief.
 *
 * `brief-fit` is first on purpose. The most expensive failure in generated UI is
 * not ugliness, it is a beautiful answer to a different question — and a judge
 * shown two artifacts without the brief will happily prefer one that ignored it.
 */

export interface RubricDimension {
  /** Stable. Appears in stored verdicts; renaming invalidates comparisons. */
  id: string;
  title: string;
  /** Asked of the judge verbatim. */
  question: string;
}

export const CRAFT_RUBRIC: RubricDimension[] = [
  {
    id: 'brief-fit',
    title: 'Answers the brief',
    question:
      'Which one actually does what the brief asked, at the scope it asked for — ' +
      'neither missing the ask nor inventing scope around it?',
  },
  {
    id: 'hierarchy',
    title: 'Hierarchy',
    question:
      'In which one is it clearer what matters most? Consider whether the thing ' +
      'the brief says the user is looking for is the thing the eye lands on.',
  },
  {
    id: 'restraint',
    title: 'Restraint',
    question:
      'Which one is more disciplined with colour, weight, borders and effects — ' +
      'using emphasis where it carries meaning rather than as decoration?',
  },
  {
    id: 'medium-fit',
    title: 'Fit to the medium',
    question:
      'Which one is better designed for where it will actually be seen — a dense ' +
      'screen watched all day, a slide read from across a room, a page that will ' +
      'be printed, a small touch screen?',
  },
  {
    id: 'completeness',
    title: 'Completeness',
    question:
      'Which one handles more of the states a real user hits — empty, loading, ' +
      'error, long strings, keyboard focus — rather than only the happy path?',
  },
  {
    id: 'distinctiveness',
    title: 'Distinctiveness',
    question:
      'Which one looks less like generic machine-generated output? Judge whether ' +
      'the choices look considered, not whether they are unusual for its own sake.',
  },
];

export const RUBRIC_IDS = CRAFT_RUBRIC.map((d) => d.id);
