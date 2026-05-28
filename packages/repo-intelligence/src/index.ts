export type ArchitectureSignal =
  | "dependency"
  | "api"
  | "auth"
  | "state"
  | "service";

export interface RepositoryInsight {
  label: string;
  signal: ArchitectureSignal;
  confidence: number;
}

export const repositoryInsights: RepositoryInsight[] = [
  { label: "Redux architecture detected", signal: "state", confidence: 0.94 },
  { label: "Socket layer identified", signal: "service", confidence: 0.91 },
  { label: "Potential auth conflict", signal: "auth", confidence: 0.82 }
];
