const SECRET_PREFIX = "provider-secret:";

export type SessionStoragePort = Pick<
  chrome.storage.StorageArea,
  "get" | "set" | "remove" | "setAccessLevel"
>;

export interface ProviderSecretVault {
  configure(): Promise<void>;
  save(providerId: string, apiKey: string): Promise<void>;
  load(providerId: string): Promise<string | undefined>;
  has(providerId: string): Promise<boolean>;
  clear(providerId: string): Promise<void>;
}

function secretKey(providerId: string): string {
  const normalized = providerId.trim();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/i.test(normalized)) {
    throw new Error("Invalid provider id.");
  }
  return `${SECRET_PREFIX}${normalized}`;
}

export function createSessionSecretVault(
  storage: SessionStoragePort = chrome.storage.session,
): ProviderSecretVault {
  return {
    async configure() {
      await storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    },

    async save(providerId, apiKey) {
      const value = apiKey.trim();
      if (!value) {
        throw new Error("API key cannot be empty.");
      }
      await storage.set({ [secretKey(providerId)]: value });
    },

    async load(providerId) {
      const key = secretKey(providerId);
      const values = await storage.get(key);
      const value = values[key];
      return typeof value === "string" && value !== "" ? value : undefined;
    },

    async has(providerId) {
      return (await this.load(providerId)) !== undefined;
    },

    async clear(providerId) {
      await storage.remove(secretKey(providerId));
    },
  };
}
