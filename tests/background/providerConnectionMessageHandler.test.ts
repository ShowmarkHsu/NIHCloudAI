import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryProvider } from "../../src/providers";
import { TEST_PROVIDER_CONNECTION } from "../../src/shared/providerConnectionMessages";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const trustedSender = {
  id: extensionId,
  url: `chrome-extension://${extensionId}/index.html`,
};

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
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "chrome");
});

function provider(output: unknown): SummaryProvider {
  return {
    id: "fake",
    async generateSummary() {
      return { providerId: "fake", model: "synthetic-model", output };
    },
  };
}

describe("provider connection message handler", () => {
  it("runs the fixed structured-output check from a trusted extension page", async () => {
    const { createProviderConnectionMessageHandler } = await import(
      "../../src/background/providerConnectionMessageHandler"
    );
    const factory = vi.fn(() => provider({ status: "ok" }));
    const handler = createProviderConnectionMessageHandler({ providerFactory: factory });
    const message = {
      type: TEST_PROVIDER_CONNECTION,
      providerId: "ollama",
      model: " synthetic-model ",
    } as const;

    await expect(handler(message, trustedSender)).resolves.toEqual({
      ok: true,
      result: { providerId: "fake", model: "synthetic-model" },
    });
    expect(factory).toHaveBeenCalledWith({
      providerId: "ollama",
      model: "synthetic-model",
    });
  });

  it("rejects content-script access before creating a provider", async () => {
    const { createProviderConnectionMessageHandler } = await import(
      "../../src/background/providerConnectionMessageHandler"
    );
    const factory = vi.fn(() => provider({ status: "ok" }));
    const response = await createProviderConnectionMessageHandler({
      providerFactory: factory,
    })(
      { type: TEST_PROVIDER_CONNECTION, providerId: "ollama", model: "x" },
      { id: extensionId, url: "https://medcloud2.nhi.gov.tw/imu/example" },
    );

    expect(response).toMatchObject({ ok: false, errorCode: "INVALID_REQUEST" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("maps missing keys and invalid structured output to safe errors", async () => {
    const { createProviderConnectionMessageHandler } = await import(
      "../../src/background/providerConnectionMessageHandler"
    );
    const { ProviderError } = await import("../../src/providers");
    const missingKey: SummaryProvider = {
      id: "remote",
      async generateSummary() {
        throw new ProviderError("remote", "Provider API key is not configured.");
      },
    };
    const message = {
      type: TEST_PROVIDER_CONNECTION,
      providerId: "openrouter",
      model: "openai/gpt-oss-120b",
    } as const;

    await expect(
      createProviderConnectionMessageHandler({ providerFactory: () => missingKey })(
        message,
        trustedSender,
      ),
    ).resolves.toMatchObject({ ok: false, errorCode: "API_KEY_MISSING" });
    await expect(
      createProviderConnectionMessageHandler({
        providerFactory: () => provider({ status: "ok", echoed: "unexpected" }),
      })(message, trustedSender),
    ).resolves.toMatchObject({ ok: false, errorCode: "INVALID_OUTPUT" });
  });

  it("aborts and returns a safe timeout without exposing provider errors", async () => {
    vi.useFakeTimers();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pendingProvider: SummaryProvider = {
      id: "fake",
      generateSummary: ({ signal }) => {
        markStarted();
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("sensitive provider detail")));
        });
      },
    };
    const { createProviderConnectionMessageHandler } = await import(
      "../../src/background/providerConnectionMessageHandler"
    );
    const pending = createProviderConnectionMessageHandler({
      providerFactory: () => pendingProvider,
      timeoutMs: 25,
    })(
      { type: TEST_PROVIDER_CONNECTION, providerId: "ollama", model: "model" },
      trustedSender,
    );
    await started;
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toEqual({
      ok: false,
      errorCode: "TIMED_OUT",
      error: "Provider 連線測試逾時。",
    });
  });
});
