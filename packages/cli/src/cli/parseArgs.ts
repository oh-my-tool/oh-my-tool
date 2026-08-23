export interface ParsedArgs {
  positional: string[];
  keyValues: Record<string, string>;
  flags: string[];
  options: Record<string, string>;
}

export interface ParsedMcpCommand {
  readonly action: "auth" | "logout";
  readonly serverId: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const keyValues: Record<string, string> = {};
  const flags: string[] = [];
  const options: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const option = arg.slice(2);
      const eq = option.indexOf("=");
      if (eq > 0) {
        options[option.slice(0, eq)] = option.slice(eq + 1);
      } else {
        flags.push(option);
      }
    } else {
      const eq = arg.indexOf("=");
      if (eq > 0) {
        keyValues[arg.slice(0, eq)] = arg.slice(eq + 1);
      } else {
        positional.push(arg);
      }
    }
  }
  return { positional, keyValues, flags, options };
}

export function parseMcpCommand(args: ParsedArgs): ParsedMcpCommand | undefined {
  if (args.positional[0] !== "mcp") return undefined;
  const action = args.positional[1];
  const serverId = args.positional[2];
  if ((action !== "auth" && action !== "logout") || serverId === undefined || serverId.length === 0) return undefined;
  return { action, serverId };
}

export function coerceInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && /^-?\d+$/.test(v)) {
      out[k] = Number(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
