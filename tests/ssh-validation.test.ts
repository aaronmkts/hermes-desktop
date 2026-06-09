import { beforeEach, describe, expect, it, vi } from "vitest";

const sshGetModelConfigMock = vi.hoisted(() => vi.fn());
const sshReadEnvMock = vi.hoisted(() => vi.fn());
const sshHasOAuthCredentialsMock = vi.hoisted(() => vi.fn());

vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({
    mode: "ssh",
    remoteUrl: "",
    apiKey: "",
    ssh: {
      host: "orion.example",
      port: 22,
      username: "orion",
      keyPath: "/tmp/key",
      remotePort: 8642,
      localPort: 28642,
    },
  }),
  getModelConfig: () => ({ provider: "auto", model: "", baseUrl: "" }),
  hasOAuthCredentials: () => false,
  readEnv: () => ({}),
}));

vi.mock("../src/main/ssh-remote", () => ({
  sshGetModelConfig: (...args: unknown[]) => sshGetModelConfigMock(...args),
  sshReadEnv: (...args: unknown[]) => sshReadEnvMock(...args),
  sshHasOAuthCredentials: (...args: unknown[]) =>
    sshHasOAuthCredentialsMock(...args),
}));

vi.mock("../src/main/installer", () => ({
  expectedEnvKeyForModel: (provider: string) =>
    provider === "openrouter" ? "OPENROUTER_API_KEY" : null,
}));

describe("validateChatReadinessForConnection in SSH mode", () => {
  beforeEach(() => {
    vi.resetModules();
    sshGetModelConfigMock.mockReset();
    sshReadEnvMock.mockReset();
    sshHasOAuthCredentialsMock.mockReset();
  });

  it("uses the remote model/env and does not report no model for a valid remote model block", async () => {
    sshGetModelConfigMock.mockResolvedValue({
      provider: "openrouter",
      model: "openai/gpt-4o",
      baseUrl: "https://openrouter.ai/api/v1",
    });
    sshReadEnvMock.mockResolvedValue({ OPENROUTER_API_KEY: "sk-remote" });
    sshHasOAuthCredentialsMock.mockResolvedValue(false);

    const { validateChatReadinessForConnection } =
      await import("../src/main/validation");
    await expect(validateChatReadinessForConnection("work")).resolves.toEqual({
      ok: true,
    });

    expect(sshGetModelConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: "orion.example" }),
      "work",
    );
    expect(sshReadEnvMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: "orion.example" }),
      "work",
    );
  });
});
