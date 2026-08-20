import type { AgentDetection, AgentId, IntegrationResult } from "../../integration";
import { AGENT_IDS, createIntegrationManager } from "../../integration";
import { homeDir } from "../context";
import { VERSION } from "../../version";

export type IntegrateAction = "install" | "status" | "repair" | "uninstall";

export interface IntegrateInput {
  action: IntegrateAction;
  agents?: AgentId[];
  force?: boolean;
  dryRun?: boolean;
}

export interface IntegrateOutput {
  action: IntegrateAction;
  dryRun: boolean;
  detected: AgentDetection[];
  selected: AgentId[];
  results: IntegrationResult[];
}

type IntegrationManager = ReturnType<typeof createIntegrationManager>;

export function defaultIntegrationManager(): IntegrationManager {
  return createIntegrationManager({ omtHome: homeDir(), skillVersion: VERSION });
}

export async function runIntegrate(
  input: IntegrateInput,
  manager: IntegrationManager = defaultIntegrationManager(),
): Promise<IntegrateOutput> {
  const detected = await manager.detect();
  const known = new Set<AgentId>(AGENT_IDS);
  for (const id of input.agents ?? []) {
    if (!known.has(id)) throw new Error(`Unknown agent: ${id}`);
  }
  const selected = input.agents?.length ? input.agents : detected.map((agent) => agent.id);
  const detectedIds = new Set(detected.map((agent) => agent.id));
  for (const id of selected) {
    if (!detectedIds.has(id)) throw new Error(`Agent is not detected: ${id}`);
  }

  if (input.dryRun) {
    return { action: input.action, dryRun: true, detected, selected, results: [] };
  }

  let results: IntegrationResult[];
  switch (input.action) {
    case "install":
      results = await manager.install(selected, { force: input.force });
      break;
    case "status":
      results = (await manager.status()).filter((item) => selected.includes(item.agent));
      break;
    case "repair":
      results = await manager.repair(selected);
      break;
    case "uninstall":
      results = await manager.uninstall(selected);
      break;
  }
  return { action: input.action, dryRun: false, detected, selected, results };
}
