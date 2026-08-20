import { homedir } from "node:os";
import { join } from "node:path";

export function homeDir(): string {
  return process.env.OMT_HOME || join(homedir(), ".omt");
}
