import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { S3_PRESETS } from '@/lib/publish/s3-storage';

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
const SECTION = read('src/components/settings/sections/sharing-section.tsx');
const NAV = read('src/components/settings/settings-nav.tsx');
const DIALOG = read('src/components/settings/settings-dialog.tsx');
const STORE = read('src/stores/settings-store.ts');

/**
 * A settings section that exists and is not reachable is the "capability built
 * but unadvertised" shape this branch keeps finding — the S3 publish tier was
 * exactly that for a day: a working route with no way to configure it.
 */
describe('the Sharing section is reachable', () => {
  it('is in the nav', () => {
    expect(NAV).toContain('id: "sharing"');
  });

  it('is wired in the dialog', () => {
    expect(DIALOG).toContain('sharing: SharingSection');
    expect(DIALOG).toContain('./sections/sharing-section');
  });
});

/**
 * The whole point of the two tiers is that they promise different things. A
 * user choosing a bucket has to be told, in the UI, that it cannot restrict who
 * opens the deck — otherwise "share" reads as "share privately".
 */
describe('it says what each tier can promise', () => {
  it('says Drive can restrict to named people', () => {
    expect(SECTION).toMatch(/named people/i);
  });

  it('says a bucket cannot', () => {
    expect(SECTION).toMatch(/anyone holding it can open/i);
    expect(SECTION, 'the UI does not say a link is not access control').toMatch(/not access control/i);
  });

  it('explains the public base URL, which is not the endpoint on R2', () => {
    expect(SECTION).toMatch(/not the endpoint/i);
  });
});

/**
 * The secret must not reach the settings store. It goes to the encrypted
 * credential store and is read server-side; localStorage in a desktop app is a
 * plain file on disk.
 */
describe('the secret key does not go into settings', () => {
  it('is POSTed to the credential store', () => {
    expect(SECTION).toContain('/api/models/providers/credentials');
    expect(SECTION).toContain('DECK_STORAGE_CREDENTIAL_ID');
  });

  it('is not part of what setDeckStorage persists', () => {
    // Read to end of LINE, not to the first `}` — the earlier version of this
    // assertion matched nothing once the call grew a cast, so it passed for a
    // sabotage that did persist the secret.
    const i = SECTION.indexOf('setDeckStorage({');
    expect(i, 'setDeckStorage is not called at all').toBeGreaterThan(-1);
    const call = SECTION.slice(i, SECTION.indexOf('\n', i));
    expect(call, 'the secret was written into the settings store').not.toMatch(/secret/i);
  });

  it('is cleared from component state once stored', () => {
    expect(SECTION).toContain("setSecret('')");
  });

  it('is absent from the persisted settings shape', () => {
    const shape = /deckStorage: \{[\s\S]*?\} \| null;/.exec(STORE)?.[0] ?? '';
    expect(shape).toContain('accessKeyId');
    expect(shape, 'the secret key is part of the persisted settings').not.toMatch(/secretAccessKey/);
  });
});

/** Every preset the implementation serves must be offerable. */
describe('the picker covers the presets', () => {
  it('renders from S3_PRESETS rather than a second hardcoded list', () => {
    expect(SECTION).toContain('S3_PRESETS.map');
  });

  it('has presets to render', () => {
    expect(S3_PRESETS.length).toBeGreaterThan(1);
  });
});
