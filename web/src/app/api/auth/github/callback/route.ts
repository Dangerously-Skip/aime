import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return new NextResponse("Missing code parameter", { status: 400 });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return new NextResponse("GitHub OAuth not configured", { status: 500 });
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error) {
    return new NextResponse(`OAuth error: ${tokenData.error_description}`, {
      status: 400,
    });
  }

  const accessToken = tokenData.access_token;

  // Fetch user info
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userData = await userRes.json();

  // Return HTML that posts token back to opener
  const html = `<!DOCTYPE html>
<html>
<head><title>GitHub Auth</title></head>
<body>
<p>Authenticating...</p>
<script>
  if (window.opener) {
    window.opener.postMessage({
      type: 'github-auth-success',
      token: ${JSON.stringify(accessToken)},
      user: ${JSON.stringify(userData.login || '')},
    }, '*');
    window.close();
  } else {
    document.body.innerText = 'Authentication successful. You can close this window.';
  }
</script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
