import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSecretVault } from "../../src/background/sessionSecretVault";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        id: extensionId,
        getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
      },
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome");
});

function createVault(): ProviderSecretVault {
  return {
    configure: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    load: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    clear: vi.fn(async () => undefined),
  };
}

describe("secret message handler", () => {
  it("accepts a secret only from a trusted extension page", async () => {
    const { createSecretMessageHandler } = await import(
      "../../src/background/secretMessageHandler"
    );
    const vault = createVault();
    const handler = createSecretMessageHandler(vault);

    await expect(
      handler(
        {
          type: "SET_PROVIDER_SECRET",
          providerId: "openrouter",
          apiKey: "test-only-placeholder",
        },
        {
          id: extensionId,
          url: `chrome-extension://${extensionId}/index.html`,
        },
      ),
    ).resolves.toEqual({ ok: true });

    expect(vault.save).toHaveBeenCalledWith(
      "openrouter",
      "test-only-placeholder",
    );
  });

  it("rejects a secret operation from a content script", async () => {
    const { createSecretMessageHandler } = await import(
      "../../src/background/secretMessageHandler"
    );
    const vault = createVault();
    const handler = createSecretMessageHandler(vault);

    await expect(
      handler(
        {
          type: "SET_PROVIDER_SECRET",
          providerId: "openrouter",
          apiKey: "test-only-placeholder",
        },
        {
          id: extensionId,
          url: "https://medcloud2.nhi.gov.tw/imu/example",
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: "Secret operation is not allowed from this context.",
    });

    expect(vault.save).not.toHaveBeenCalled();
  });

  it("ignores unrelated messages", async () => {
    const { createSecretMessageHandler } = await import(
      "../../src/background/secretMessageHandler"
    );
    const handler = createSecretMessageHandler(createVault());

    await expect(
      handler(
        { type: "PATIENT_DATA_CHANGED" },
        {
          id: extensionId,
          url: `chrome-extension://${extensionId}/index.html`,
        },
      ),
    ).resolves.toBeUndefined();
  });
});
