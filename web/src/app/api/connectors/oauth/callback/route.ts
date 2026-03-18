export const runtime = 'nodejs';

/**
 * OAuth callback handler.
 * Receives the authorization code from the OAuth provider redirect,
 * renders a minimal page that sends the code back to the opener via postMessage.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Render a page that posts the result back to the opener window and closes itself
  const html = `<!DOCTYPE html>
<html>
<head><title>Connecting...</title></head>
<body>
<p>Completing connection...</p>
<script>
  if (window.opener) {
    window.opener.postMessage({
      type: 'oauth_callback',
      code: ${JSON.stringify(code)},
      state: ${JSON.stringify(state)},
      error: ${JSON.stringify(error || errorDescription || null)},
    }, window.location.origin);
  }
  setTimeout(() => window.close(), 1000);
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
