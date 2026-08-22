import { createPaths } from "../paths";

export function homeDir(): string {
  return createPaths().home;
}
