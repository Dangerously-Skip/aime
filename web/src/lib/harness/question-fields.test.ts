import { describe, it, expect } from 'vitest';
import { parseQuestionFields, formatFieldAnswers, allAnswered } from './question-fields';
import { parseSessionQuestion } from './session';

/**
 * A QUESTION WITH FIVE PARTS GETS FIVE CONTROLS.
 *
 * The protocol allowed one question and up to five flat options, on ONE line.
 * A session needing five answers had nowhere to put them, so it wrote them into
 * the question text and asked "what are your answers to the 5 questions above
 * (installation, under-bench space, power socket, budget, chilled vs ambient)?"
 *
 * The user got a wall of prose and two buttons — "I'll type my answers in chat"
 * and "Other…" — and had to retype what the model had just enumerated, in a
 * format it then had to parse back out. Reported as "it's all bunched together
 * as a single blob rather than appropriate to the questions".
 */

describe('parsing the multi-field form', () => {
  const ASKED = [
    'Q: Installation || DIY | Plumber',
    'Q: Under-bench space in mm ||',
    'Q: [] Which finishes would you consider? || Chrome | Brushed | Matte black',
    'Q: ... Anything else the installer should know?',
  ].join('\n');

  it('gives each line its own field, in order', () => {
    const fields = parseQuestionFields(ASKED);
    expect(fields.map((f) => f.label)).toEqual([
      'Installation',
      'Under-bench space in mm',
      'Which finishes would you consider?',
      'Anything else the installer should know?',
    ]);
  });

  it('picks the control from what the session wrote', () => {
    const [install, space, finishes, notes] = parseQuestionFields(ASKED);
    expect(install.kind).toBe('choice'); // options → buttons
    expect(space.kind).toBe('text'); // `||` with nothing after it → text box
    expect(finishes.kind).toBe('multi'); // `[]` → several answers
    expect(notes.kind).toBe('longtext'); // `...` → bigger box
  });

  it('keeps the options with their field', () => {
    const [install] = parseQuestionFields(ASKED);
    expect(install.options).toEqual(['DIY', 'Plumber']);
  });

  it('gives fields distinct ids even when labels repeat', () => {
    // They become React keys and answer labels; a collision would drop one.
    const fields = parseQuestionFields('Q: Size ||\nQ: Size ||');
    expect(fields[0].id).not.toBe(fields[1].id);
  });

  it('drops a malformed line rather than the whole question', () => {
    /*
     * The reason this is line-based and not JSON: the session emits it as text,
     * mid-reasoning, with nothing validating it. One bad line must not park the
     * run on nothing.
     */
    const fields = parseQuestionFields('Q: Good || a | b\nQ:\nnot a field\nQ: Also good ||');
    expect(fields.map((f) => f.label)).toEqual(['Good', 'Also good']);
  });

  it('is empty for text with no Q: lines, so the caller can fall back', () => {
    expect(parseQuestionFields('Which total? || gross | net')).toEqual([]);
  });

  it('multi-select with no options falls back to text rather than nothing', () => {
    // A toggle group of zero options is not a control the user can answer.
    expect(parseQuestionFields('Q: [] Anything else? ||')[0].kind).toBe('text');
  });
});

describe('the session parser chooses between the forms', () => {
  it('uses the fields when there is more than one', () => {
    const parsed = parseSessionQuestion(
      'STATUS: QUESTION\nQ: Installation || DIY | Plumber\nQ: Budget || low | high',
    );
    expect(parsed?.fields).toHaveLength(2);
  });

  it('STILL parses the one-line form, which most questions are', () => {
    const parsed = parseSessionQuestion('STATUS: QUESTION Which total? || gross | net');
    expect(parsed?.question).toBe('Which total?');
    expect(parsed?.options).toEqual(['gross', 'net']);
    expect(parsed?.fields).toEqual([]);
  });

  it('a single Q: line is not worth the multi-field treatment', () => {
    // One question needs no ceremony; the existing card handles it better.
    const parsed = parseSessionQuestion('STATUS: QUESTION\nQ: Which total? || gross | net');
    expect(parsed?.fields).toEqual([]);
  });
});

describe('turning the answers back into text', () => {
  const FIELDS = parseQuestionFields(
    'Q: Installation || DIY | Plumber\nQ: Budget ||\nQ: [] Finishes || Chrome | Matte',
  );

  it('labels each answer, because the session only sees this string', () => {
    const out = formatFieldAnswers(FIELDS, {
      [FIELDS[0].id]: ['Plumber'],
      [FIELDS[1].id]: ['~$2,000'],
      [FIELDS[2].id]: ['Chrome', 'Matte'],
    });
    expect(out).toBe('Installation: Plumber\nBudget: ~$2,000\nFinishes: Chrome, Matte');
  });

  it('omits an unanswered field rather than sending it blank', () => {
    /*
     * "Budget: " reads as an answer of empty, and the run may act on it. Left
     * out, the model can see what it still does not know.
     */
    const out = formatFieldAnswers(FIELDS, { [FIELDS[0].id]: ['DIY'] });
    expect(out).toBe('Installation: DIY');
  });

  it('knows when something is still missing', () => {
    expect(allAnswered(FIELDS, { [FIELDS[0].id]: ['DIY'] })).toBe(false);
    expect(
      allAnswered(FIELDS, {
        [FIELDS[0].id]: ['DIY'],
        [FIELDS[1].id]: ['x'],
        [FIELDS[2].id]: ['Chrome'],
      }),
    ).toBe(true);
  });
});
