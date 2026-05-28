/**
 * GitHub repository intelligence client.
 *
 * PERFORMANCE CONTRACT:
 *   Exactly 3 parallel API calls on every invocation.
 *   No per-repository deep analysis — that belongs in background jobs.
 *   Next.js fetch cache (revalidate: 120s) prevents redundant cold fetches.
 *
 * WHAT WAS REMOVED:
 *   The previous version made 8 × 5 = 40 additional per-repo API calls
 *   (branches, contributors, PRs, Actions runs, deployments per repo).
 *   These blocked every workspace load for 5–10 seconds and produced
 *   analytics metrics (branchCount, contributorCount, etc.) that are
 *   not part of the core product. Those fields now return 0.
 *
 *   If per-repo intelligence is needed later it should be:
 *   - lazy-loaded after workspace is interactive
 *   - cached aggressively
 *   - never on the critical workspace load path
 */

import type {
  GitHubIntelligence,
  GitHubRecentActivity,
  GitHubRepositorySummary
} from "@/services/github/types";

// ─── Internal API types ───────────────────────────────────

interface GitHubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  updated_at: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
}

interface GitHubEventResponse {
  id: string;
  type: string;
  repo: { name: string };
  actor: { login: string };
  created_at: string;
  payload?: {
    action?: string;
    commits?: unknown[];
    pull_request?: { merged?: boolean };
  };
}

interface GitHubUserResponse {
  login: string;
}

// ─── Fetch helpers ────────────────────────────────────────

const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
});

async function githubFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(token),
    next: { revalidate: 120 }
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${path}`);
  }
  return response.json() as Promise<T>;
}

async function fetchGitHubUser(
  token: string
): Promise<{ data: GitHubUserResponse; scopesMissing: boolean }> {
  const response = await fetch("https://api.github.com/user", {
    headers: githubHeaders(token),
    next: { revalidate: 120 }
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: /user`);
  }
  const grantedScopes = new Set(
    (response.headers.get("X-OAuth-Scopes") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return {
    data:          (await response.json()) as GitHubUserResponse,
    scopesMissing: !grantedScopes.has("read:org")
  };
}

function toRepo(repo: GitHubRepoResponse): GitHubRepositorySummary {
  return {
    id:            repo.id,
    name:          repo.name,
    fullName:      repo.full_name,
    private:       repo.private,
    defaultBranch: repo.default_branch,
    pushedAt:      repo.pushed_at,
    updatedAt:     repo.updated_at,
    language:      repo.language,
    stars:         repo.stargazers_count,
    forks:         repo.forks_count,
    openIssues:    repo.open_issues_count
  };
}

// ─── Public API ───────────────────────────────────────────

export async function getGitHubIntelligence(token: string): Promise<GitHubIntelligence> {
  // Three parallel calls — this is the entire API surface now.
  const [userResult, repos, events] = await Promise.all([
    fetchGitHubUser(token),
    githubFetch<GitHubRepoResponse[]>(
      "/user/repos?per_page=100&sort=pushed&visibility=all&affiliation=owner,collaborator,organization_member",
      token
    ),
    githubFetch<GitHubEventResponse[]>("/events?per_page=30", token)
  ]);

  const { data: viewer, scopesMissing } = userResult;

  const pushEvents   = events.filter((e) => e.type === "PushEvent");
  const prEvents     = events.filter((e) => e.type === "PullRequestEvent");
  const totalCommits = pushEvents.reduce((n, e) => n + (e.payload?.commits?.length ?? 0), 0);
  const merges       = prEvents.filter((e) => e.payload?.pull_request?.merged).length;

  const privateRepositories = repos.filter((r) => r.private).length;

  const recentActivity: GitHubRecentActivity[] = events.slice(0, 8).map((e) => ({
    id:        e.id,
    type:      e.type,
    repo:      e.repo.name,
    actor:     e.actor.login,
    createdAt: e.created_at
  }));

  return {
    source:             "github",
    connectionRequired: false,
    scopesMissing,
    owner:              viewer.login,
    generatedAt:        new Date().toISOString(),
    repositories:       repos.map(toRepo),
    metrics: {
      totalRepositories:    repos.length,
      currentRepositories:  Math.min(repos.length, 8),
      privateRepositories,
      publicRepositories:   repos.length - privateRepositories,
      totalCommits,
      pullRequests:         0,   // requires per-repo calls — removed from critical path
      pushes:               pushEvents.length,
      merges,
      branchCount:          0,   // requires per-repo calls
      contributorCount:     0,   // requires per-repo calls
      deployments:          0,   // requires per-repo calls
      githubActionsPassing: 0,   // requires per-repo calls
      githubActionsFailing: 0    // requires per-repo calls
    },
    analytics: {
      repositoryHealth:        0,
      architectureStability:   0,
      implementationVelocity:  Math.min(100, Math.round((pushEvents.length + merges) * 1.4)),
      dependencyActivity:      0,
      aiRiskIndicators:        0
    },
    recentActivity
  };
}
