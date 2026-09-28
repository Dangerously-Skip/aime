import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/models/providers/credentials/route';
import { createCredentialStore } from '@/lib/models/credentials';
import { useSettingsStore } from '@/stores/settings-store';
import { openStorageGate } from '@/lib/gated-storage';
import { SECRETS_TO_MOVE_KEY, moveSecretsToKeychain } from './settings-secrets';

/**
 * Settings v14: secrets leave the plaintext settings payload.
 *
 * Driven end to end with the REAL pieces the move depends on — zustand's
 * rehydrate + migrate, the real credentials route, and the real AES-GCM store
 * on a temp HOME. The route is not mocked because the route answering 503 when
 * there is no master key is precisely the case that must not lose the key.
 */

const KEY = 'aime:settings';
const LEGACY_KEY = 'nibcowork:settings';

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

/** `fetch` that lands on the real credentials route handler. */
const routeFetch = (async (url: string | URL | Request, init?: RequestInit) =>
  POST(new NextRequest(new URL(String(url), 'http://localhost'), init as never))) as typeof fetch;

let home: string;
const originalHome = process.env.HOME;
const hexKey = randomBytes(32).toString('hex');

function stored() {
  return createCredentialStore(Buffer.from(hexKey, 'hex'), path.join(home, '.aime', 'credentials.enc'));
}

async function rehydrateWith(version: number, state: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify({ state, version }));
  await useSettingsStore.persist.rehydrate();
}

beforeAll(() => {
  vi.stubGlobal('localStorage', makeMemoryStorage());
});
afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-secrets-'));
  process.env.HOME = home;
  process.env.AIME_CRED_KEY = hexKey;
  localStorage.clear();
  useSettingsStore.getState().resetAll();
  // The store starts the move itself after hydration; point it at the route.
  vi.stubGlobal('fetch', vi.fn(routeFetch));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env.HOME = originalHome;
  delete process.env.AIME_CRED_KEY;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const V13 = {
  fullName: 'Ada',
  searchProvider: 'tavily',
  searchApiKey: 'tvly-secret',
  searchCredentialProviderId: null,
  githubToken: 'gho_secret',
  githubUser: 'ada',
  anthropicApiKey: 'sk-ant-stays',
};

describe('v14 migration (real rehydrate)', () => {
  it('lifts the secrets out of live state and points search at the credential store', async () => {
    await rehydrateWith(13, V13);
    const s = useSettingsStore.getState() as unknown as Record<string, unknown>;
    expect(s.searchApiKey).toBeUndefined();
    expect(s.githubToken).toBeUndefined();
    expect(s.githubUser).toBeUndefined();
    expect(s.searchCredentialProviderId).toBe('search');
    expect(s.fullName).toBe('Ada');
    expect(s.searchProvider).toBe('tavily');
  });

  it('moves the search key into the encrypted store and then forgets the browser copy', async () => {
    await rehydrateWith(13, V13);
    await vi.waitFor(() => expect(localStorage.getItem(SECRETS_TO_MOVE_KEY)).toBeNull());
    expect(await stored().get('search')).toEqual({ apiKey: 'tvly-secret' });
    // Nothing anywhere in localStorage still holds it.
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('tvly-secret');
    }
  });

  it('never writes the secrets back into the settings payload', async () => {
    openStorageGate();
    await rehydrateWith(13, V13);
    useSettingsStore.getState().setFullName('Ada L.');
    const persisted = (JSON.parse(localStorage.getItem(KEY)!) as { state: Record<string, unknown> }).state;
    expect(persisted).not.toHaveProperty('searchApiKey');
    expect(persisted).not.toHaveProperty('githubToken');
    expect(persisted).not.toHaveProperty('githubUser');
    expect(persisted.fullName).toBe('Ada L.');
  });

  it('keeps a borrowed credential choice rather than overwriting it', async () => {
    await rehydrateWith(13, { ...V13, searchProvider: 'openrouter', searchCredentialProviderId: 'or-uuid' });
    expect(useSettingsStore.getState().searchCredentialProviderId).toBe('or-uuid');
  });

  it('scrubs the same secrets from a pre-rename legacy payload', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ state: { githubToken: 'gho_old', searchApiKey: 'old-key' }, version: 6 }));
    await rehydrateWith(13, V13);
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)!).state;
    expect(legacy).not.toHaveProperty('githubToken');
    expect(legacy).not.toHaveProperty('searchApiKey');
  });
});

describe('when the credential store is unavailable (503)', () => {
  it('keeps the parked key rather than losing it, and a later launch completes the move', async () => {
    delete process.env.AIME_CRED_KEY; // the route now answers 503
    await rehydrateWith(13, V13);
    const first = await moveSecretsToKeychain(routeFetch);
    expect(first.status).toBe('failed');
    expect(localStorage.getItem(SECRETS_TO_MOVE_KEY)).toContain('tvly-secret');

    process.env.AIME_CRED_KEY = hexKey; // next launch: keyring back
    const second = await moveSecretsToKeychain(routeFetch);
    expect(second).toEqual({ status: 'moved', ids: ['search'] });
    expect(localStorage.getItem(SECRETS_TO_MOVE_KEY)).toBeNull();
    expect(await stored().get('search')).toEqual({ apiKey: 'tvly-secret' });
  });

  it('says what to do, not a status code', async () => {
    delete process.env.AIME_CRED_KEY;
    localStorage.setItem(SECRETS_TO_MOVE_KEY, JSON.stringify({ search: 'k' }));
    const r = await moveSecretsToKeychain(routeFetch);
    expect(r.status === 'failed' && r.error).toMatch(/Restart the app/);
  });
});

describe('nothing to move', () => {
  it('makes no request at all', async () => {
    const f = vi.fn(routeFetch);
    expect(await moveSecretsToKeychain(f)).toEqual({ status: 'nothing' });
    expect(f).not.toHaveBeenCalled();
  });
});
