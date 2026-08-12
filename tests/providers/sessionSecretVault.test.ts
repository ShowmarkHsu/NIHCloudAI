import { describe, expect, it } from "vitest";
import {
  createSessionSecretVault,
  type SessionStoragePort,
} from "../../src/background/sessionSecretVault";

function createMemoryStorage() {
  const values: Record<string, unknown> = {};
  const accessLevels: string[] = [];

  const storage = {
    async get(keys: string | string[]) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested.filter((key) => key in values).map((key) => [key, values[key]]),
      );
    },
    async set(items: Record<string, unknown>) {
      Object.assign(values, items);
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    async setAccessLevel(options: { accessLevel: string }) {
      accessLevels.push(options.accessLevel);
    },
  } as unknown as SessionStoragePort;

  return { storage, values, accessLevels };
}

describe("session secret vault", () => {
  it("restricts storage to trusted extension contexts", async () => {
    const memory = createMemoryStorage();
    const vault = createSessionSecretVault(memory.storage);

    await vault.configure();

    expect(memory.accessLevels).toEqual(["TRUSTED_CONTEXTS"]);
  });

  it("stores, reports, loads, and clears a provider key", async () => {
    const memory = createMemoryStorage();
    const vault = createSessionSecretVault(memory.storage);

    await vault.save("openai", " test-only-placeholder ");
    expect(await vault.has("openai")).toBe(true);
    expect(await vault.load("openai")).toBe("test-only-placeholder");

    await vault.clear("openai");
    expect(await vault.has("openai")).toBe(false);
  });

  it("rejects empty keys and invalid provider ids", async () => {
    const memory = createMemoryStorage();
    const vault = createSessionSecretVault(memory.storage);

    await expect(vault.save("openai", "   ")).rejects.toThrow();
    await expect(vault.save("../openai", "placeholder")).rejects.toThrow();
  });
});
