export const runtime = 'nodejs';

/**
 * POST /api/mcp/resolve-tenant
 * Body: { domain } — e.g. "nibtravel.com"
 * Returns: { tenantId } — the Azure AD tenant ID for that domain.
 *
 * Used by Microsoft MCP connectors to substitute {tenant_id} in the MCP URL
 * based on the user's email domain.
 */
export async function POST(request: Request) {
  try {
    const { domain } = await request.json();
    if (!domain || typeof domain !== 'string') {
      return Response.json({ error: 'Missing domain' }, { status: 400 });
    }

    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(domain)}/v2.0/.well-known/openid-configuration`
    );

    if (!res.ok) {
      return Response.json({ error: `Tenant discovery failed: ${res.status}` }, { status: 404 });
    }

    const data = await res.json();
    // Issuer format: https://login.microsoftonline.com/{tenant_id}/v2.0
    const issuer = data.issuer as string | undefined;
    if (!issuer) {
      return Response.json({ error: 'No issuer in discovery response' }, { status: 502 });
    }
    const match = issuer.match(/\/([0-9a-f-]{36})\//i);
    if (!match) {
      return Response.json({ error: 'Could not parse tenant ID from issuer' }, { status: 502 });
    }

    return Response.json({ tenantId: match[1] });
  } catch (error) {
    console.error('[Resolve Tenant] Error:', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Tenant resolution failed' },
      { status: 500 }
    );
  }
}
