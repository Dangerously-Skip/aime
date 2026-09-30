import { describe, it, expect } from 'vitest';
import { PERMISSION_MODES } from './permission-mode-menu';
import { CODE_PERMISSION_MODES, DEFAULT_CODE_PERMISSION_MODE } from '@/lib/surfaces/code-permission-mode';

/*
 * The menu and the server's allowlist are the same list. A mode the menu offers
 * that the route does not accept fails every turn with a 400; a mode the route
 * accepts that the menu does not show is a claim nobody can see. Each mode's
 * description is enforced — and tested sentence by sentence — in
 * claude-provider.permission-mode.test.ts.
 */
describe('permission-mode menu', () => {
  it('offers exactly the modes the server accepts', () => {
    expect(PERMISSION_MODES.map((m) => m.value).sort()).toEqual([...CODE_PERMISSION_MODES].sort());
  });

  it('lists the default first, since the trigger falls back to the first entry', () => {
    expect(PERMISSION_MODES[0].value).toBe(DEFAULT_CODE_PERMISSION_MODE);
  });
});
