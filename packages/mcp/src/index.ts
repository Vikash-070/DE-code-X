export interface McpPayload {
  target: "codex" | "claude";
  status: "queued" | "review" | "synced";
  payloadSize: string;
}

export const mcpPayloads: McpPayload[] = [
  { target: "codex", status: "review", payloadSize: "42.8 KB" },
  { target: "claude", status: "queued", payloadSize: "38.1 KB" }
];
