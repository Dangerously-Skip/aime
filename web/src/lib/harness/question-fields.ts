/**
 * A question with more than one part, and a control per part.
 *
 * The protocol was one line — `STATUS: QUESTION <text> || a | b`, taken with
 * `.split('\n')[0]` and capped at 700 characters. One question, up to five flat
 * options. A session that needs five answers has no way to say so, so it does
 * the only thing it can: writes all five into the question text and asks "what
 * are your answers to the 5 questions above (installation, under-bench space,
 * power socket, budget, chilled vs ambient)?"
 *
 * The user then gets a wall of prose with two buttons — "I'll type my answers
 * in chat" and "Other…" — and has to retype what the model already enumerated,
 * in a format it has to re-parse. Reported as "it's all bunched together as a
 * single blob rather than appropriate to the questions".
 *
 * WHY LINES AND NOT JSON. The session emits this as text, mid-reasoning, with
 * no schema validation between it and the parser. A JSON block is one missing
 * brace away from being unparseable, and the failure mode is a run that parks
 * on nothing. One field per line degrades instead: a malformed line is dropped
 * and the rest still work.
 *
 *     STATUS: QUESTION
 *     Q: Installation || DIY | Plumber
 *     Q: Under-bench space in mm ||
 *     Q: Power socket under the sink? || Yes | No
 *     Q: [] Which finishes would you consider? || Chrome | Brushed | Matte black
 *     Q: ... Anything else the installer should know?
 *
 * Options make it a choice; none makes it free text. `[]` is multi-select and
 * `...` is a long answer. Those two markers are deliberately the only syntax
 * beyond the existing `||` — every extra token is another thing a model gets
 * subtly wrong at 2am.
 *
 * The single-line form still parses, because sessions written against it are
 * still out there and a one-part question needs no ceremony.
 */

export type FieldKind = 'text' | 'longtext' | 'choice' | 'multi';

export interface QuestionField {
  /** Stable within one question; used as the React key and answer label. */
  id: string;
  label: string;
  kind: FieldKind;
  options: string[];
}

/** `Q:` lines, in order. Anything else on the line is ignored. */
const FIELD_LINE = /^\s*Q:\s*(.+)$/;

/** A label may not be blank, and a runaway one is a paste, not a question. */
const MAX_LABEL = 300;
const MAX_FIELDS = 12;
const MAX_OPTIONS = 8;

function slug(label: string, index: number): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base ? `${index}-${base}` : `f${index}`;
}

/**
 * Parse the multi-field form. Returns `[]` when the text has no `Q:` lines,
 * which is how the caller knows to fall back to the single-line parse.
 */
export function parseQuestionFields(text: string): QuestionField[] {
  const fields: QuestionField[] = [];

  for (const raw of text.split('\n')) {
    const m = FIELD_LINE.exec(raw);
    if (!m) continue;

    let body = m[1].trim();
    let kind: FieldKind = 'text';

    // Markers are a prefix, and only one applies.
    if (body.startsWith('[]')) {
      kind = 'multi';
      body = body.slice(2).trim();
    } else if (body.startsWith('...')) {
      kind = 'longtext';
      body = body.slice(3).trim();
    }

    const [labelPart, optsPart] = body.split('||');
    const label = labelPart.trim().slice(0, MAX_LABEL);
    if (!label) continue; // a marker with no question is not a question

    const options = (optsPart ?? '')
      .split('|')
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, MAX_OPTIONS);

    /*
     * Options decide the control unless a marker already did. `[]` with no
     * options would be a multi-select of nothing, so it falls back to text —
     * the user can still answer, which is the point.
     */
    if (options.length > 0) {
      // `[]` already means multi-select; anything else with options is a choice.
      if (kind !== 'multi') kind = 'choice';
    } else if (kind === 'multi') {
      // Multi-select of nothing is not a control. Text still lets them answer,
      // which is the point.
      kind = 'text';
    }

    fields.push({ id: slug(label, fields.length), label, kind, options });
    if (fields.length >= MAX_FIELDS) break;
  }

  return fields;
}

/**
 * One answer string from the filled-in fields.
 *
 * Labelled, because the session sees only this text and has to map it back to
 * what it asked. Unanswered fields are omitted rather than sent blank: "Budget:
 * " reads as an answer of empty, and the difference matters to whatever the run
 * does next.
 */
export function formatFieldAnswers(
  fields: QuestionField[],
  values: Record<string, string[]>,
): string {
  return fields
    .map((f) => {
      const v = (values[f.id] ?? []).map((s) => s.trim()).filter(Boolean);
      return v.length ? `${f.label}: ${v.join(', ')}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

/** Are all fields answered? Used to keep Send honest rather than to block it. */
export function allAnswered(
  fields: QuestionField[],
  values: Record<string, string[]>,
): boolean {
  return fields.every((f) => (values[f.id] ?? []).some((s) => s.trim()));
}
