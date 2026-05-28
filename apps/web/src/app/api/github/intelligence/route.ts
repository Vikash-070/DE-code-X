import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getGitHubIntelligence } from "@/services/github/client";

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(userId, "github");
    const githubToken = tokens.data[0]?.token;

    if (!githubToken) {
      return NextResponse.json({
        source: "github",
        connectionRequired: true,
        owner: "",
        generatedAt: new Date().toISOString(),
        repositories: [],
        metrics: {
          totalRepositories: 0,
          currentRepositories: 0,
          privateRepositories: 0,
          publicRepositories: 0,
          totalCommits: 0,
          pullRequests: 0,
          pushes: 0,
          merges: 0,
          branchCount: 0,
          contributorCount: 0,
          deployments: 0,
          githubActionsPassing: 0,
          githubActionsFailing: 0
        },
        analytics: {
          repositoryHealth: 0,
          architectureStability: 0,
          implementationVelocity: 0,
          dependencyActivity: 0,
          aiRiskIndicators: 0
        },
        recentActivity: []
      });
    }

    const intelligence = await getGitHubIntelligence(githubToken);
    return NextResponse.json(intelligence);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load GitHub intelligence"
      },
      { status: 500 }
    );
  }
}
