import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../../src/ui/App";
import {
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_PROVIDER_ID,
  type ProviderSecretMessaging,
  type SecretMessage,
} from "../../src/ui/providerMessaging";
import type { ProviderConnectionMessaging } from "../../src/ui/providerConnectionMessaging";

function createFakeMessaging(initialConfigured = false) {
  let configured = initialConfigured;
  const calls: SecretMessage[] = [];
  const messaging: ProviderSecretMessaging = {
    async send(message) {
      calls.push(message);
      if (message.type === "HAS_PROVIDER_SECRET") {
        return { ok: true, configured };
      }
      if (message.type === "SET_PROVIDER_SECRET") {
        configured = true;
        return { ok: true };
      }
      configured = false;
      return { ok: true };
    },
  };
  return { calls, messaging };
}

describe("provider settings", () => {
  it("queries, stores, and clears the BYOK session key without retaining it in the input", async () => {
    const fake = createFakeMessaging();
    const { container } = render(<App messaging={fake.messaging} />);

    fireEvent.click(screen.getByRole("radio", { name: /OpenRouter BYOK/ }));

    await waitFor(() => {
      expect(fake.calls).toContainEqual({
        type: "HAS_PROVIDER_SECRET",
        providerId: OPENROUTER_PROVIDER_ID,
      });
    });
    expect(screen.getByText("尚未設定 session key")).toBeTruthy();

    const input = screen.getByLabelText("API Key") as HTMLInputElement;
    const testKey = "test-only-placeholder";
    fireEvent.change(input, { target: { value: testKey } });
    fireEvent.click(screen.getByRole("button", { name: "儲存 session key" }));

    await waitFor(() => {
      expect(fake.calls).toContainEqual({
        type: "SET_PROVIDER_SECRET",
        providerId: OPENROUTER_PROVIDER_ID,
        apiKey: testKey,
      });
    });
    await waitFor(() => expect(input.value).toBe(""));
    expect(screen.getByText("API Key 已儲存於本次工作階段。")).toBeTruthy();
    expect(container.textContent).not.toContain(testKey);

    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    await waitFor(() => {
      expect(fake.calls).toContainEqual({
        type: "CLEAR_PROVIDER_SECRET",
        providerId: OPENROUTER_PROVIDER_ID,
      });
    });
    expect(screen.getByText("API Key 已從本次工作階段清除。")).toBeTruthy();
  });

  it("shows that Ollama does not need a key and clears a partially entered BYOK value when switching", async () => {
    const fake = createFakeMessaging();
    render(<App messaging={fake.messaging} />);

    fireEvent.click(screen.getByRole("radio", { name: /OpenRouter BYOK/ }));
    await waitFor(() => expect(screen.getByLabelText("API Key")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "test-only-placeholder" },
    });

    fireEvent.click(screen.getByRole("radio", { name: /Ollama/ }));

    expect(screen.queryByLabelText("API Key")).toBeNull();
    expect(screen.getByText(/不需要 API Key/)).toBeTruthy();
    expect(fake.calls.some((message) => message.type === "SET_PROVIDER_SECRET")).toBe(false);
  });

  it("runs a fixed no-patient connection test for the selected local model", async () => {
    const fake = createFakeMessaging();
    const calls: unknown[] = [];
    const connectionMessaging: ProviderConnectionMessaging = {
      requestRemotePermission: async () => true,
      async test(message) {
        calls.push(message);
        return {
          ok: true,
          result: { providerId: "ollama", model: "synthetic-model" },
        };
      },
    };
    render(
      <App messaging={fake.messaging} connectionMessaging={connectionMessaging} />,
    );

    fireEvent.change(screen.getByLabelText("模型名稱"), {
      target: { value: "synthetic-model" },
    });
    const connectionButton = screen.getByRole("button", {
      name: "測試 Provider 連線",
    }) as HTMLButtonElement;
    await waitFor(() => expect(connectionButton.disabled).toBe(false));
    fireEvent.click(connectionButton);

    await waitFor(() => expect(screen.getByText(/連線與結構化輸出測試成功/)).toBeTruthy());
    expect(calls).toEqual([
      {
        type: "TEST_PROVIDER_CONNECTION",
        providerId: "ollama",
        model: "synthetic-model",
      },
    ]);
    expect(screen.getByText(/不包含病人快照或病歷內容/)).toBeTruthy();
  });

  it("does not call a remote provider when optional permission is denied", async () => {
    const fake = createFakeMessaging(true);
    const test = vi.fn<ProviderConnectionMessaging["test"]>();
    const connectionMessaging: ProviderConnectionMessaging = {
      requestRemotePermission: async () => false,
      test,
    };
    render(
      <App messaging={fake.messaging} connectionMessaging={connectionMessaging} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /OpenRouter BYOK/ }));
    expect((screen.getByLabelText("模型名稱") as HTMLInputElement).value).toBe(
      OPENROUTER_DEFAULT_MODEL,
    );
    expect((screen.getByLabelText("模型名稱") as HTMLInputElement).readOnly).toBe(true);
    const connectionButton = screen.getByRole("button", {
      name: "測試 Provider 連線",
    }) as HTMLButtonElement;
    await waitFor(() => expect(connectionButton.disabled).toBe(false));
    fireEvent.click(connectionButton);

    await waitFor(() => expect(screen.getByText(/未取得遠端 Provider 網域權限/)).toBeTruthy());
    expect(test).not.toHaveBeenCalled();
  });
});
