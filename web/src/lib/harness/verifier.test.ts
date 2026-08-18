import { describe, it, expect } from 'vitest';
import {
  buildVerifierPrompt,
  parseVerdict,
  treeUnchanged,
  createVerifier,
  VERIFIER_DENIED,
  VERIFIER_TOOLS,
} from './verifier';
import type { Goal, Task } from './ledger';

const goal: Goal = {
  version: 1,
  objective: 'Every embed in the deck plays',
  acceptanceCriteria: ['no Error 153'],
  budgetUsd: 5,
  deadlineIso: null,
  sessionCap: 10,
  createdAt: '',
};

const task: Task = {
  id: 't-003',
  title: 'Serve the deck over http',
  verify: ['curl the preview URL', 'expect HTTP 200'],
  status: 'doing',
  attempts: 1,
  lastVerdict: null,
};

const AT = '2026-08-16T00:00:00.000Z';

describe('the verifier cannot write', () => {
  it('denies every write tool', () => {
    for (const t of ['Write', 'Edit', 'NotebookEdit', 'ExcelWrite', 'ExcelEdit']) {
      expect(VERIFIER_DENIED).toContain(t);
    }
  });

  it('denies image generation, which writes files too', () => {
    expect(VERIFIER_DENIED).toContain('mcp__aime__CreateImage');
  });

  it('KEEPS Bash, because running the checks is the job', () => {
    /*
     * A verifier that can only read code and form an opinion is the rubber stamp
     * this module exists to prevent. The hole Bash leaves is closed by
     * `treeUnchanged`, not by taking Bash away.
     */
    expect(VERIFIER_TOOLS).toContain('Bash');
    expect(VERIFIER_DENIED).not.toContain('Bash');
  });

  it('the allowed set and the denied set do not overlap', () => {
    for (const t of VERIFIER_TOOLS) expect(VERIFIER_DENIED).not.toContain(t);
  });
});

describe('buildVerifierPrompt', () => {
  const p = () => buildVerifierPrompt(goal, task, 'I changed the preview to use http.');

  it('lists every verification step', () => {
    for (const v of task.verify) expect(p()).toContain(v);
  });

  it('says to RUN the checks rather than reason about them', () => {
    // The single biggest observed failure in a long-running harness was an agent
    // that made changes and never checked them.
    expect(p()).toMatch(/RUN the checks/);
    expect(p()).toMatch(/An assurance is not evidence/i);
  });

  it('tells it not to fix anything it finds', () => {
    expect(p()).toMatch(/not a problem for you to fix/i);
  });

  it('states that a pass without evidence is read as a failure', () => {
    expect(p()).toMatch(/pass with no evidence is/i);
  });

  it('distances it from the work', () => {
    expect(p()).toMatch(/no stake in it/i);
  });
});

describe('parseVerdict — the gate, not the request', () => {
  it('accepts a pass with evidence', () => {
    const v = parseVerdict(JSON.stringify({ passed: true, missing: [], evidence: ['curl → 200'] }), AT);
    expect(v.passed).toBe(true);
    expect(v.evidence).toEqual(['curl → 200']);
  });

  it('REFUSES a pass with no evidence', () => {
    /*
     * The rule that matters. A pass with nothing behind it is indistinguishable
     * from a guess, and is exactly the "all 9 videos are properly embedded"
     * failure wearing a different hat. Enforced here because a prompt is a
     * request and this is a gate.
     */
    const v = parseVerdict(JSON.stringify({ passed: true, missing: [], evidence: [] }), AT);
    expect(v.passed).toBe(false);
    expect(v.missing[0]).toMatch(/without citing any evidence/i);
  });

  it('refuses a pass whose evidence is blank strings', () => {
    const v = parseVerdict(JSON.stringify({ passed: true, evidence: ['', '   '] }), AT);
    expect(v.passed).toBe(false);
  });

  it('takes the pessimistic reading of a self-contradicting verdict', () => {
    // Passing while listing unmet steps is a contradiction, and the cost of a
    // wrong pass is the whole point of the gate.
    const v = parseVerdict(
      JSON.stringify({ passed: true, missing: ['step 2 still fails'], evidence: ['ran it'] }),
      AT,
    );
    expect(v.passed).toBe(false);
    expect(v.missing).toEqual(['step 2 still fails']);
  });

  it('carries a failure’s reasons through verbatim, for the next attempt', () => {
    const v = parseVerdict(
      JSON.stringify({ passed: false, missing: ['still returns Error 153'], evidence: ['opened slide 3'] }),
      AT,
    );
    expect(v.passed).toBe(false);
    expect(v.missing).toEqual(['still returns Error 153']);
  });

  it('fills in a reason when a failure gives none', () => {
    const v = parseVerdict(JSON.stringify({ passed: false, missing: [] }), AT);
    expect(v.passed).toBe(false);
    expect(v.missing[0]).toMatch(/without saying why/i);
  });

  it('reads a verdict out of a fenced block with prose around it', () => {
    const v = parseVerdict(
      'I ran the checks.\n```json\n{"passed": true, "evidence": ["curl → 200"]}\n```\nDone.',
      AT,
    );
    expect(v.passed).toBe(true);
  });

  it('treats an unreadable answer as a FAILURE, never a pass', () => {
    // Absence of a verdict is not a pass — the same reading of silence the
    // session parser and pending-questions both apply.
    for (const junk of ['', 'Looks good to me!', '{ "passed": tru', 'null']) {
      expect(parseVerdict(junk, AT).passed).toBe(false);
    }
  });

  it('treats a non-boolean passed as not passing', () => {
    expect(parseVerdict(JSON.stringify({ passed: 'yes', evidence: ['x'] }), AT).passed).toBe(false);
  });
});

describe('treeUnchanged', () => {
  it('accepts an identical tree', () => {
    expect(treeUnchanged(' M src/a.ts\n?? b.txt', ' M src/a.ts\n?? b.txt')).toBe(true);
  });

  it('ignores line order and blank lines, which git does not guarantee', () => {
    expect(treeUnchanged(' M a\n M b', ' M b\n\n M a\n')).toBe(true);
  });

  it('catches a new modification', () => {
    expect(treeUnchanged(' M a', ' M a\n M b')).toBe(false);
  });

  it('catches a modification that disappeared', () => {
    // A verifier that reverted something is as disqualifying as one that wrote.
    expect(treeUnchanged(' M a\n M b', ' M a')).toBe(false);
  });

  it('handles a clean tree on both sides', () => {
    expect(treeUnchanged('', '')).toBe(true);
  });
});

describe('createVerifier', () => {
  async function* chunks(...cs: { type: string; content?: unknown }[]) {
    for (const c of cs) yield c;
  }
  const clean = async () => ' M src/deck.html';

  it('passes work that checks out', async () => {
    const verify = createVerifier({
      query: () => chunks({ type: 'text', content: '{"passed": true, "evidence": ["curl → 200"]}' }),
      treeFingerprint: clean,
      nowIso: () => AT,
    });
    const v = await verify(goal, task, 'served it over http');
    expect(v.passed).toBe(true);
    expect(v.at).toBe(AT);
  });

  it('DISCARDS the verdict of a verifier that changed the tree', async () => {
    /*
     * The rule that closes the Bash hole. A verifier that edits has repaired the
     * gap it was meant to report, so the pass it issues describes a world it
     * created. Discarded rather than downgraded: we no longer know what was true
     * before it started.
     */
    let calls = 0;
    const verify = createVerifier({
      query: () => chunks({ type: 'text', content: '{"passed": true, "evidence": ["curl → 200"]}' }),
      treeFingerprint: async () => (++calls === 1 ? ' M src/deck.html' : ' M src/deck.html\n M src/cheat.ts'),
      nowIso: () => AT,
    });
    const v = await verify(goal, task, 'x');
    expect(v.passed).toBe(false);
    expect(v.missing[0]).toMatch(/changed the working tree/i);
    expect(v.missing[0]).toMatch(/only allowed to check/i);
  });

  it('does not discard a legitimate pass when the tree is untouched', async () => {
    const verify = createVerifier({
      query: () => chunks({ type: 'text', content: '{"passed": true, "evidence": ["ran the suite"]}' }),
      treeFingerprint: async () => ' M src/deck.html',
      nowIso: () => AT,
    });
    expect((await verify(goal, task, 'x')).passed).toBe(true);
  });

  it('a provider error is a failure, not a pass', async () => {
    const verify = createVerifier({
      query: () => chunks({ type: 'error', content: 'subprocess died' }),
      treeFingerprint: clean,
      nowIso: () => AT,
    });
    const v = await verify(goal, task, 'x');
    expect(v.passed).toBe(false);
    expect(v.missing[0]).toMatch(/failed to run/i);
  });

  it('a thrown provider is a failure, not a pass', async () => {
    const verify = createVerifier({
      // eslint-disable-next-line require-yield
      query: async function* () { throw new Error('network down'); },
      treeFingerprint: clean,
      nowIso: () => AT,
    });
    expect((await verify(goal, task, 'x')).passed).toBe(false);
  });

  it('THE TEST THAT MATTERS: broken work is not passed', async () => {
    /*
     * A green suite proves the verifier ran. Only a deliberately-broken task
     * proves it would notice. This is the exact failure this app shipped — an
     * agent reporting nine embedded videos over nine that returned Error 153.
     */
    const verify = createVerifier({
      query: () =>
        chunks({
          type: 'text',
          content: JSON.stringify({
            passed: false,
            missing: ['step 2 fails: the iframe returns Error 153'],
            evidence: ['opened the deck, read the player state'],
          }),
        }),
      treeFingerprint: clean,
      nowIso: () => AT,
    });
    const v = await verify(goal, task, 'All 9 videos are properly embedded.');
    expect(v.passed).toBe(false);
    expect(v.missing[0]).toContain('Error 153');
  });
});

describe('the verifier is told what the user decided', () => {
  const decisions = [
    { question: 'gross or net?', answer: 'net', taskId: 't-001', at: 'now' },
  ];

  it('puts the decision in the prompt, verbatim', () => {
    /*
     * The verifier reads the working tree and runs commands — it cannot see a
     * conversation. Without this it rejected a correctly finished task twice
     * with "the conversation does not contain an unambiguous user answer",
     * which was scepticism working exactly as designed against evidence it had
     * never been shown. Two wasted sessions, about half the run's cost.
     */
    const p = buildVerifierPrompt(goal, task, 'did it', decisions);
    expect(p).toContain('gross or net?');
    expect(p).toContain('net');
    expect(p).toMatch(/Decisions the user has already made/i);
  });

  it('tells it those are settled, and that an asking task is done once answered', () => {
    const p = buildVerifierPrompt(goal, task, 'did it', decisions).replace(/\s+/g, ' ');
    expect(p).toMatch(/These are settled/i);
    expect(p).toMatch(/complete once the answer above exists/i);
  });

  it('omits the section entirely when nothing has been decided', () => {
    // An empty header would invite the model to wonder what is missing.
    expect(buildVerifierPrompt(goal, task, 'did it', [])).not.toMatch(/Decisions the user/i);
  });

  it('passes decisions through createVerifier to the prompt', () => {
    let seen = '';
    const verify = createVerifier({
      query: (prompt) => { seen = prompt; return (async function* () {})(); },
      treeFingerprint: async () => 'x',
      nowIso: () => AT,
    });
    return verify(goal, task, 'did it', decisions).then(() => {
      expect(seen).toContain('gross or net?');
    });
  });
});
