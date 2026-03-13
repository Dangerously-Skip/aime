import { NextResponse } from "next/server";

export async function POST() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GitHub OAuth not configured" },
      { status: 500 }
    );
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "repo,read:user",
    state,
  });

  return NextResponse.json({
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
    state,
  });
}
