import type { SecretStore } from "@oh-my-tool/sdk";

export const SECRET_SERVICE = "oh-my-tool";

export function memoryStore(init: Record<string, string> = {}): SecretStore {
  const data = new Map(Object.entries(init));
  return {
    async get(name) {
      return data.get(name);
    },
    async set(name, value) {
      data.set(name, value);
    },
    async delete(name) {
      data.delete(name);
    },
  };
}

export const bunStore: SecretStore = {
  async get(name) {
    const v = await Bun.secrets.get({ service: SECRET_SERVICE, name });
    return v ?? undefined;
  },
  async set(name, value) {
    await Bun.secrets.set({ service: SECRET_SERVICE, name, value });
  },
  async delete(name) {
    await Bun.secrets.delete({ service: SECRET_SERVICE, name });
  },
};

export class SecretsManager {
  constructor(private store: SecretStore = bunStore) {}

  get(name: string): Promise<string | undefined> {
    return this.store.get(name);
  }
  set(name: string, value: string): Promise<void> {
    return this.store.set(name, value);
  }
  delete(name: string): Promise<void> {
    return this.store.delete(name);
  }
}
