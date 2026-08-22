import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export interface CreatePathsOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  userHome?: string;
}

export interface OhMyToolPaths {
  readonly userHome: string;
  readonly home: string;
  readonly legacyHome: string;
  readonly config: string;
  readonly extensions: string;
  readonly integrations: string;
  readonly cache: string;
  readonly audit: string;
  readonly isCustomHome: boolean;
}

export function createPaths(options: CreatePathsOptions = {}): OhMyToolPaths {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const userHome = options.userHome ?? homedir();
  const path = platform === "win32" ? win32 : posix;
  const customHome = env.OH_MY_TOOL_HOME;
  const home = customHome || path.join(userHome, ".oh-my-tool");
  const legacyHome = path.join(userHome, ".omt");
  return {
    userHome,
    home,
    legacyHome,
    config: path.join(home, "config.toml"),
    extensions: path.join(home, "extensions"),
    integrations: path.join(home, "integrations"),
    cache: path.join(home, "cache"),
    audit: path.join(home, "logs", "audit.jsonl"),
    isCustomHome: Boolean(customHome),
  };
}
