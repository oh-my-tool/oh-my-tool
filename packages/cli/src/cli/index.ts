import { parseArgs } from "./parseArgs";
import { runSearch } from "./commands/search";
import { runDescribe } from "./commands/describe";
import { runTool } from "./commands/run";
import { runExtensionList, runExtensionInstall } from "./commands/extension";
import { runSecretList, runSecretSet } from "./commands/secret";
import {
  defaultIntegrationManager,
  runIntegrate,
  type IntegrateAction,
} from "./commands/integrate";
import type { AgentDetection, AgentId, IntegrationResult, IntegrationStatus } from "../integration";
import { AGENT_IDS } from "../integration";
import { multiselect, isCancel } from "@clack/prompts";
import { VERSION } from "../version";

const HELP = `Oh My Tool - local and enterprise tools for agents

Usage:
  ohmytool search "<task>"                 search tools by intent
  ohmytool describe <tool>                 inspect a tool and its input schema
  ohmytool run <tool> [key=value ...]      execute a tool
  ohmytool run <tool> --stdin              execute with JSON from stdin
  ohmytool extension list                  list installed extensions
  ohmytool extension install <path>        install an extension from a local dir
  ohmytool secret set <name>               set a secret (interactive hidden prompt or stdin pipe)
  ohmytool secret list                     list secret names (Windows only, values never shown)
  ohmytool setup                           detect agents and install the OMT skill
  ohmytool integrate [status|repair|uninstall]
                                      manage agent skill integrations
  ohmytool --version                   print version

Examples:
  ohmytool search "查询 mysql 设备数据"
  ohmytool describe mysql.query
  ohmytool run mysql.query connection=iot-test sql="SELECT id FROM device"
  echo '{"connection":"iot-test","sql":"SELECT 1"}' | ohmytool run mysql.query --stdin
`;

const AGENT_IDS_SET = new Set<AgentId>(AGENT_IDS);

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

/** 交互式隐藏输入（不回显、不进历史、不落盘），仅 TTY 下调用。 */
function readSecretHidden(prompt: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  process.stdout.write(prompt);
  const stdin = process.stdin;
  const prevRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  const finish = () => {
    stdin.removeListener("data", onData);
    stdin.setRawMode(prevRaw);
    stdin.pause();
  };
  const onData = (chunk: string) => {
    for (const ch of chunk) {
      if (ch === "\r" || ch === "\n") {
        finish();
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (ch === "\x03") {
        finish();
        process.stdout.write("\n");
        reject(new Error("aborted"));
        return;
      }
      if (ch === "\x7f" || ch === "\b") {
        value = value.slice(0, -1);
        continue;
      }
      value += ch;
    }
  };
  stdin.on("data", onData);
  return promise;
}

function print(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

function parseAgentIds(raw?: string): AgentId[] | undefined {
  if (!raw) return undefined;
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  for (const value of values) {
    if (!AGENT_IDS_SET.has(value as AgentId)) throw new Error(`Unknown agent: ${value}`);
  }
  return [...new Set(values as AgentId[])];
}

function printDetected(agents: AgentDetection[]): void {
  console.log("Detected agents:\n");
  for (const agent of agents) console.log(`✓ ${agent.variant ?? agent.displayName}`);
}

const STATUS_ICON: Record<IntegrationStatus, string> = {
  current: "✓",
  installed: "✓",
  repaired: "✓",
  uninstalled: "✓",
  "update-available": "↻",
  "not-installed": "○",
  broken: "⚠",
  conflict: "✗",
};

const STATUS_SEVERITY: Record<IntegrationStatus, number> = {
  conflict: 0,
  broken: 1,
  "update-available": 2,
  "not-installed": 3,
  current: 4,
  installed: 4,
  repaired: 4,
  uninstalled: 4,
};

function printIntegrationResults(results: IntegrationResult[]): void {
  console.log("");
  for (const item of results) {
    const suffix = item.detail ? ` — ${item.detail}` : "";
    console.log(`${STATUS_ICON[item.status]} ${item.displayName.padEnd(14)} ${item.status}${suffix}`);
  }
}

function printStatus(results: IntegrationResult[]): void {
  console.log("");
  const ordered = [...results].sort((a, b) => STATUS_SEVERITY[a.status] - STATUS_SEVERITY[b.status]);
  for (const item of ordered) {
    console.log(
      `${STATUS_ICON[item.status]} ${item.displayName.padEnd(14)} ${item.status.padEnd(19)} ${item.detail ?? item.target}`,
    );
  }
  const counts: Record<string, number> = {};
  for (const item of results) counts[item.status] = (counts[item.status] ?? 0) + 1;
  const summary = Object.entries(counts).map(([status, n]) => `${n} ${status}`).join("  ·  ");
  console.log(`\nSummary: ${summary}`);
  if (results.some((item) => item.status === "broken")) {
    console.log("Tip:   run `omt integrate repair` to recreate broken links");
  }
  if (results.some((item) => item.status === "conflict")) {
    console.log("Tip:   conflict means OMT refuses to touch an unmanaged path; run `omt integrate --force` only if you accept replacing it");
  }
}

async function promptForAgents(agents: AgentDetection[]): Promise<AgentId[]> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive confirmation requires a TTY; pass --yes for unattended setup");
  }
  const selected = await multiselect({
    message: "选择要集成的 Agent（空格切换，回车确认）",
    options: agents.map((agent) => ({
      value: agent.id,
      label: agent.variant ?? agent.displayName,
      hint: agent.target,
    })),
    initialValues: agents.map((agent) => agent.id),
    required: false,
  });
  if (isCancel(selected) || !selected?.length) return [];
  return selected as AgentId[];
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const cmd = parsed.positional[0];
  try {
    switch (cmd) {
      case "search": {
        const q = parsed.positional.slice(1).join(" ");
        print(await runSearch(q));
        return 0;
      }
      case "describe": {
        print(await runDescribe(parsed.positional[1]));
        return 0;
      }
      case "run": {
        const tool = parsed.positional[1];
        const res = await runTool(tool, parsed.keyValues, parsed.flags.includes("stdin"));
        print(res);
        return res.ok ? 0 : 1;
      }
      case "secret": {
        const sub = parsed.positional[1];
        if (sub === "set") {
          const name = parsed.positional[2];
          if (!name) {
            console.error("usage: ohmytool secret set <name>  (交互输入或 stdin 管道)");
            return 1;
          }
          // TTY 下交互隐藏输入（不回显/不进历史），非 TTY 保持管道 stdin
          const value = process.stdin.isTTY ? await readSecretHidden("password: ") : await readStdin();
          print(await runSecretSet(name, value));
          return 0;
        }
        if (sub === "list") {
          print(await runSecretList());
          return 0;
        }
        console.error("usage: ohmytool secret set <name> | secret list");
        return 1;
      }
      case "extension": {
        const sub = parsed.positional[1];
        if (sub === "list") {
          print(await runExtensionList());
          return 0;
        }
        if (sub === "install") {
          print(await runExtensionInstall(parsed.positional[2]));
          return 0;
        }
        console.error("usage: ohmytool extension list|install <path>");
        return 1;
      }
      case "setup":
      case "integrate": {
        const action = (cmd === "setup" ? "install" : parsed.positional[1] ?? "install") as IntegrateAction;
        if (!["install", "status", "repair", "uninstall"].includes(action)) {
          throw new Error(`Unknown integrate action: ${action}`);
        }
        const manager = defaultIntegrationManager();
        const detected = await manager.detect();
        if (!detected.length) throw new Error("No supported agents detected");
        printDetected(detected);
        let agents = parseAgentIds(parsed.options.agents);
        const mutating = action !== "status" && !parsed.flags.includes("dry-run");
        if (mutating && !parsed.flags.includes("yes") && !agents) {
          agents = await promptForAgents(detected);
          if (!agents.length) {
            console.log("\nCancelled.");
            return 0;
          }
        } else if (mutating && !parsed.flags.includes("yes")) {
          if (!process.stdin.isTTY || !process.stdout.isTTY) {
            throw new Error("Confirmation required; pass --yes for unattended setup");
          }
          const selectedDetections = detected.filter((agent) => agents!.includes(agent.id));
          agents = await promptForAgents(selectedDetections);
          if (!agents.length) {
            console.log("\nCancelled.");
            return 0;
          }
        }
        const integration = await runIntegrate(
          {
            action,
            agents,
            force: parsed.flags.includes("force"),
            dryRun: parsed.flags.includes("dry-run"),
          },
          manager,
        );
        if (integration.dryRun) {
          console.log(`\nDry run: would ${action} ${integration.selected.join(", ")}`);
        } else if (action === "status") {
          printStatus(integration.results);
        } else {
          printIntegrationResults(integration.results);
        }
        return 0;
      }
      case "-v": {
        print({ name: "ohmytool", version: VERSION });
        return 0;
      }
      default:
        if (parsed.flags.includes("version")) {
          print({ name: "ohmytool", version: VERSION });
          return 0;
        }
        console.log(HELP);
        return cmd ? 1 : 0;
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}


