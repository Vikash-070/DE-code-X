export interface SecurityFinding {
  title: string;
  severity: "low" | "medium" | "high";
  score: number;
}

export const securityFindings: SecurityFinding[] = [
  { title: "Attack surface analysis", severity: "low", score: 94 },
  { title: "Dependency vulnerabilities", severity: "medium", score: 81 },
  { title: "Architecture conflicts", severity: "medium", score: 76 },
  { title: "Implementation warnings", severity: "low", score: 88 }
];
