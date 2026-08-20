export type AgentId = "codex" | "omp" | "qoder" | "pi" | "cursor" | "claude";

export const AGENT_IDS: readonly AgentId[] = [
  "codex",
  "omp",
  "qoder",
  "pi",
  "cursor",
  "claude",
];
export type IntegrationStatus =
  | "not-installed"
  | "installed"
  | "current"
  | "update-available"
  | "broken"
  | "conflict"
  | "repaired"
  | "uninstalled";

export interface AgentDetection {
  id: AgentId;
  displayName: string;
  command: string;
  target: string;
  variant?: string;
}

export interface IntegrationResult {
  agent: AgentId;
  displayName: string;
  target: string;
  status: IntegrationStatus;
  detail?: string;
}

export interface ManagedAgentState {
  target: string;
  canonical: string;
  version: string;
  digest: string;
  mode: "junction" | "symlink";
  backup?: string;
}

export interface IntegrationState {
  schemaVersion: 1;
  skills: {
    "oh-my-tool"?: {
      version: string;
      digest: string;
      agents: Partial<Record<AgentId, ManagedAgentState>>;
    };
  };
}
