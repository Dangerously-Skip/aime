import { describe, it, expect, vi, afterEach } from 'vitest';
import { connectConnector, verifyAwsCredentials, type ConnectDeps } from './connect';
import { CONNECTOR_MAP } from './registry';

/**
 * Real registry connectors, injected side effects. The decision table is the
 * unit under test: which flow runs for which auth type, what gets collected
 * first, and what a caller that cannot prompt is told.
 */

const NOW = 1_000_000;

function deps(over: Partial<ConnectDeps> = {}): ConnectDeps {
  return {
    runOAuth2: vi.fn(async () => ({ accessToken: 'oauth-tok', refreshToken: 'rt', expiresIn: 3600 })),
    runMcpOAuth: vi.fn(async () => ({ accessToken: 'mcp-tok', refreshToken: 'mrt', expiresIn: 7200 })),
    now: () => NOW,
    ...over,
  };
}

describe('connectConnector — api_key', () => {
  it('collects a token and reports connected', async () => {
    const requestSecret = vi.fn<NonNullable<ConnectDeps["requestSecret"]>>(async () => 'ghp_abc');
    const r = await connectConnector(CONNECTOR_MAP.github, deps({ requestSecret }));
    expect(r).toMatchObject({ status: 'connected', token: 'ghp_abc' });
    // the registry hint is what tells the user where to get the token
    expect(requestSecret.mock.calls[0][1].hint).toContain('github.com/settings/tokens');
  });

  it('reports cancelled when the user dismisses the prompt', async () => {
    const r = await connectConnector(CONNECTOR_MAP.github, deps({ requestSecret: async () => null }));
    expect(r).toEqual({ status: 'cancelled' });
  });

  it('tells a caller that cannot prompt what it needed, instead of hanging', async () => {
    const r = await connectConnector(CONNECTOR_MAP.github, deps());
    expect(r.status).toBe('unsupported');
    expect(r.message).toMatch(/API token/);
  });
});

describe('connectConnector — mcp-oauth (the DCR fast path)', () => {
  it('runs the MCP flow and returns token metadata', async () => {
    const runMcpOAuth = vi.fn<ConnectDeps["runMcpOAuth"]>(async () => ({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
    }));
    const r = await connectConnector(CONNECTOR_MAP.atlassian, deps({ runMcpOAuth }));
    expect(r).toEqual({
      status: 'connected',
      token: 'at',
      refreshToken: 'rt',
      expiresAt: NOW + 3_600_000,
    });
    expect(runMcpOAuth).toHaveBeenCalledWith('atlassian', 'https://mcp.atlassian.com/v1/mcp', {
      fallbackClientId: undefined,
      fallbackClientIdEnv: undefined,
    });
  });

  it('passes a published client_id through for servers without DCR', async () => {
    const runMcpOAuth = vi.fn<ConnectDeps["runMcpOAuth"]>(async () => ({ accessToken: 'at' }));
    await connectConnector(CONNECTOR_MAP.slack, deps({ runMcpOAuth }));
    expect(runMcpOAuth.mock.calls[0][2].fallbackClientId).toBe(
      CONNECTOR_MAP.slack.auth.fallbackClientId,
    );
  });

  it('needs no prompts at all — this is what "one click" means', async () => {
    // No requestSecret, no requestText supplied.
    const r = await connectConnector(CONNECTOR_MAP.figma, deps());
    expect(r.status).toBe('connected');
  });

  it('turns a DCR failure into who-can-fix-it rather than a protocol error', async () => {
    const runMcpOAuth = vi.fn(async () => {
      throw new Error('Server does not support Dynamic Client Registration');
    });
    // outlook-mail's endpoint is tenant-templated, so the resolver runs first.
    const r = await connectConnector(
      CONNECTOR_MAP['outlook-mail'],
      deps({ runMcpOAuth, resolveMcpUrl: async (_c, u) => u.replace('{tenant_id}', 't1') }),
    );
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/IT admin/);
    expect(r.message).toContain('MS365_CLIENT_ID');
  });

  it('treats a closed auth window as cancellation, not an error', async () => {
    const runMcpOAuth = vi.fn(async () => {
      throw new Error('OAuth flow was canceled');
    });
    const r = await connectConnector(CONNECTOR_MAP.miro, deps({ runMcpOAuth }));
    expect(r).toEqual({ status: 'cancelled' });
  });

  it('resolves a templated MCP URL before starting the flow', async () => {
    const templated = {
      ...CONNECTOR_MAP.atlassian,
      auth: { ...CONNECTOR_MAP.atlassian.auth, mcpUrl: 'https://x/{tenant_id}/mcp' },
    };
    const runMcpOAuth = vi.fn<ConnectDeps["runMcpOAuth"]>(async () => ({ accessToken: 'at' }));
    const resolveMcpUrl = vi.fn(async () => 'https://x/tenant-123/mcp');

    const r = await connectConnector(templated, deps({ runMcpOAuth, resolveMcpUrl }));
    expect(r.status).toBe('connected');
    expect(runMcpOAuth.mock.calls[0][1]).toBe('https://x/tenant-123/mcp');
  });

  it('does not start a flow against an unresolved templated URL', async () => {
    const templated = {
      ...CONNECTOR_MAP.atlassian,
      auth: { ...CONNECTOR_MAP.atlassian.auth, mcpUrl: 'https://x/{tenant_id}/mcp' },
    };
    const runMcpOAuth = vi.fn(async () => ({ accessToken: 'at' }));
    const r = await connectConnector(templated, deps({ runMcpOAuth }));
    expect(r.status).toBe('unsupported');
    expect(runMcpOAuth).not.toHaveBeenCalled();
  });
});

describe('connectConnector — oauth2', () => {
  it('runs the browser flow with no prompting for a shipped public client', async () => {
    const runOAuth2 = vi.fn<ConnectDeps["runOAuth2"]>(async () => ({ accessToken: 'at', expiresIn: 3600 }));
    const r = await connectConnector(CONNECTOR_MAP['m365-graph'], deps({ runOAuth2 }));
    expect(r).toMatchObject({ status: 'connected', token: 'at', expiresAt: NOW + 3_600_000 });
    // byoCreds must be undefined — we ship the client id
    expect(runOAuth2.mock.calls[0][1]).toBeUndefined();
  });

  it('collects a BYO OAuth app and returns it for unattended refresh', async () => {
    const requestText = vi.fn(async () => 'my-client-id');
    const requestSecret = vi.fn(async () => 'my-client-secret');
    const r = await connectConnector(
      CONNECTOR_MAP['google-personal'],
      deps({ requestText, requestSecret }),
    );
    expect(r).toMatchObject({
      status: 'connected',
      oauthClientId: 'my-client-id',
      oauthClientSecret: 'my-client-secret',
      // pinned by the provision guard to the registry origin
      oauthTokenEndpoint: 'https://oauth2.googleapis.com/token',
    });
  });

  it('reuses a stored OAuth app instead of asking again', async () => {
    const requestText = vi.fn(async () => 'should-not-be-called');
    const r = await connectConnector(
      CONNECTOR_MAP['google-personal'],
      deps({
        requestText,
        requestSecret: async () => 'x',
        getStoredOAuthApp: () => ({ clientId: 'stored-id', clientSecret: 'stored-secret' }),
      }),
    );
    expect(requestText).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: 'connected', oauthClientId: 'stored-id' });
  });

  it('cancels cleanly if the user abandons the client-secret step', async () => {
    const r = await connectConnector(
      CONNECTOR_MAP['google-personal'],
      deps({ requestText: async () => 'cid', requestSecret: async () => null }),
    );
    expect(r).toEqual({ status: 'cancelled' });
  });

  it('reports a flow failure as an error with the reason', async () => {
    const r = await connectConnector(
      CONNECTOR_MAP['m365-graph'],
      deps({
        runOAuth2: async () => {
          throw new Error('No OAuth credentials configured for m365-graph');
        },
      }),
    );
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/No OAuth credentials/);
  });

  it('omits refresh-app fields when the connector ships its own client', async () => {
    const r = await connectConnector(CONNECTOR_MAP['m365-graph'], deps());
    expect(r.oauthClientId).toBeUndefined();
    expect(r.oauthClientSecret).toBeUndefined();
  });
});

describe('connectConnector — ambient and deferred auth', () => {
  it('authenticates aws via the ambient credential flow and injects no real token', async () => {
    const runAwsAuth = vi.fn(async () => {});
    const r = await connectConnector(CONNECTOR_MAP.aws, deps({ runAwsAuth }));
    expect(runAwsAuth).toHaveBeenCalled();
    // A non-secret sentinel, not ''. The client store's isAuthenticated() requires
    // a truthy token, so '' left `authenticated: true` disagreeing with the very
    // accessor every badge reads. The provision route refuses to inject it.
    expect(r).toEqual({ status: 'connected', token: 'aws-iam' });
  });

  it('surfaces an aws auth failure rather than reporting success', async () => {
    const r = await connectConnector(
      CONNECTOR_MAP.aws,
      deps({
        runAwsAuth: async () => {
          throw new Error('SSO session expired');
        },
      }),
    );
    expect(r).toMatchObject({ status: 'error', message: 'SSO session expired' });
  });

  it('REGRESSION: refuses to claim connected when no credential check was supplied', async () => {
    // aws_iam was the ONLY optional dep whose absence was silently ignored: every
    // sibling returns 'unsupported'. Neither ConnectorRequestCard nor onboarding
    // passes runAwsAuth, so clicking Connect opened no window, checked nothing,
    // and told the paused agent turn `connected: true`.
    const r = await connectConnector(CONNECTOR_MAP.aws, deps());
    expect(r.status).toBe('unsupported');
    expect(r.message).toMatch(/AWS credentials/i);
  });

  it('never reports connected without the check actually having run', async () => {
    const runAwsAuth = vi.fn(async () => {});
    await connectConnector(CONNECTOR_MAP.aws, deps());
    expect(runAwsAuth).not.toHaveBeenCalled();
  });

  it('reports a deferred-auth connector with a sentinel too, not an empty token', async () => {
    const selfAuth = {
      ...CONNECTOR_MAP.aws,
      auth: { type: 'mcp-self-auth' as const, hint: 'sign in later' },
    };
    const r = await connectConnector(selfAuth, deps());
    expect(r).toMatchObject({
      status: 'connected',
      token: 'mcp-self-auth',
      deferredAuthHint: 'sign in later',
    });
  });
});

describe('verifyAwsCredentials — the real check the orchestrator depends on', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('resolves when the credential probe succeeds', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: true })) as typeof fetch;
    await expect(verifyAwsCredentials()).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/connectors/aws/auth', { method: 'POST' });
  });

  it('THROWS the actionable message when there are no usable credentials', async () => {
    // `aws sts get-caller-identity` failing is the whole point: without this the
    // orchestrator would report "connected" for a machine with no AWS access.
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: 'No valid AWS credentials found. Run `aws sso login`.' }, { status: 500 }),
    ) as typeof fetch;
    await expect(verifyAwsCredentials()).rejects.toThrow(/aws sso login/);
  });

  it('still throws when the error body is unreadable', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 502 })) as typeof fetch;
    await expect(verifyAwsCredentials()).rejects.toThrow(/AWS credentials/i);
  });

  it('makes the aws path connect end-to-end when wired in', async () => {
    globalThis.fetch = vi.fn(async () => Response.json({ ok: true })) as typeof fetch;
    const r = await connectConnector(CONNECTOR_MAP.aws, deps({ runAwsAuth: verifyAwsCredentials }));
    expect(r).toEqual({ status: 'connected', token: 'aws-iam' });
  });

  it('turns a failed check into an error outcome, not a connection', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: 'No valid AWS credentials found.' }, { status: 500 }),
    ) as typeof fetch;
    const r = await connectConnector(CONNECTOR_MAP.aws, deps({ runAwsAuth: verifyAwsCredentials }));
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/No valid AWS credentials/);
  });
});

describe('connectConnector — every registry connector is reachable', () => {
  it('no connector reports unsupported when all prompts are available', async () => {
    const full = deps({
      requestSecret: async () => 'secret',
      requestText: async () => 'text',
      runAwsAuth: async () => {},
      resolveMcpUrl: async (_c, u) => u.replace(/\{[a-z_]+\}/g, 'resolved'),
      // app-password connectors verify their credential server-side; a satisfied
      // dependency set includes the transport that check runs over.
      fetchImpl: (async () => ({ ok: true, json: async () => ({ ok: true }) })) as unknown as typeof fetch,
    });
    for (const connector of Object.values(CONNECTOR_MAP)) {
      const r = await connectConnector(connector, full);
      expect(r.status, `${connector.id} → ${r.message ?? ''}`).toBe('connected');
    }
  });

  it('never throws, whatever the flows do', async () => {
    const hostile = deps({
      requestSecret: async () => {
        throw new Error('prompt exploded');
      },
      requestText: async () => {
        throw new Error('prompt exploded');
      },
      runOAuth2: async () => {
        throw new Error('boom');
      },
      runMcpOAuth: async () => {
        throw new Error('boom');
      },
      runAwsAuth: async () => {
        throw new Error('boom');
      },
      resolveMcpUrl: async () => {
        throw new Error('boom');
      },
    });
    for (const connector of Object.values(CONNECTOR_MAP)) {
      const r = await connectConnector(connector, hostile);
      expect(['error', 'cancelled', 'unsupported', 'connected']).toContain(r.status);
    }
  });
});
