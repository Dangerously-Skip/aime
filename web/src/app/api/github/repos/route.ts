import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const token = request.headers.get("x-github-token");

  if (!token) {
    return NextResponse.json(
      { error: "Missing GitHub token" },
      { status: 401 }
    );
  }

  const url = new URL("https://api.github.com/user/repos");
  url.searchParams.set("sort", "updated");
  url.searchParams.set("per_page", "30");
  url.searchParams.set("type", "owner");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch repos" },
      { status: res.status }
    );
  }

  const repos = await res.json();

  const simplified = repos.map((repo: { full_name: string; name: string; private: boolean; html_url: string; clone_url: string; default_branch: string; description: string | null }) => ({
    fullName: repo.full_name,
    name: repo.name,
    private: repo.private,
    htmlUrl: repo.html_url,
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch,
    description: repo.description,
  }));

  return NextResponse.json(simplified);
}
