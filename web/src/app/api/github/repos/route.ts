import { NextResponse } from "next/server";
import { readProvisionedGithubToken } from "@/lib/github-token";

export const runtime = 'nodejs';

export async function GET() {
  // Read the real PAT from ~/.claude/.quarry-mcp.json — the client-side store
  // holds a "provisioned" sentinel that isn't a valid GitHub token.
  const token = await readProvisionedGithubToken();

  if (!token) {
    return NextResponse.json(
      { error: "GitHub not connected. Connect GitHub in Customize → Connectors." },
      { status: 401 }
    );
  }

  const url = new URL("https://api.github.com/user/repos");
  url.searchParams.set("sort", "updated");
  url.searchParams.set("per_page", "100");
  // Include repos the user collaborates on or has org access to, not just owned
  url.searchParams.set("affiliation", "owner,collaborator,organization_member");

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
