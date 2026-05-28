export interface GitHubRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  updatedAt: string | null;
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
}

export interface GitHubRecentActivity {
  id: string;
  type: string;
  repo: string;
  actor: string;
  createdAt: string;
}

export interface GitHubIntelligence {
  source: "github";
  connectionRequired: boolean;
  scopesMissing?: boolean;
  owner: string;
  generatedAt: string;
  repositories: GitHubRepositorySummary[];
  metrics: {
    totalRepositories: number;
    currentRepositories: number;
    privateRepositories: number;
    publicRepositories: number;
    totalCommits: number;
    pullRequests: number;
    pushes: number;
    merges: number;
    branchCount: number;
    contributorCount: number;
    deployments: number;
    githubActionsPassing: number;
    githubActionsFailing: number;
  };
  analytics: {
    repositoryHealth: number;
    architectureStability: number;
    implementationVelocity: number;
    dependencyActivity: number;
    aiRiskIndicators: number;
  };
  recentActivity: GitHubRecentActivity[];
}
