import { beforeEach, describe, expect, it, vi } from "vitest";

const sshExecMock = vi.fn();

vi.mock("../src/main/config", () => ({
  getApiServerKey: () => "",
  getConnectionConfig: () => ({
    mode: "ssh",
    remoteUrl: "",
    apiKey: "",
    ssh: {
      host: "153.92.211.161",
      port: 22,
      username: "root",
      keyPath: "/home/aaron/.ssh/id_ed25519",
      remotePort: 8642,
      localPort: 28642,
    },
  }),
}));

vi.mock("../src/main/hermes", () => ({
  getApiUrl: () => "http://127.0.0.1:28642",
  getRemoteAuthHeader: () => ({}),
  isRemoteMode: () => true,
}));

vi.mock("../src/main/ssh-remote", () => ({
  normalizeSshProfileName: (profile?: unknown) => {
    if (profile === undefined || profile === "" || profile === "default") return undefined;
    if (typeof profile !== "string" || !/^[a-z0-9_][a-z0-9_-]{0,63}$/.test(profile)) {
      throw new Error("Profile names may contain lowercase letters, numbers, underscores, and hyphens, and cannot start with a hyphen.");
    }
    return profile;
  },
  sshExec: (...args: unknown[]) => sshExecMock(...args),
}));

vi.mock("../src/main/utils", () => ({
  normalizeProfileName: (profile?: unknown) => {
    if (profile === undefined || profile === "" || profile === "default") return undefined;
    if (typeof profile !== "string" || !/^[a-z0-9_][a-z0-9_-]{0,63}$/.test(profile)) {
      throw new Error("Profile names may contain lowercase letters, numbers, underscores, and hyphens, and cannot start with a hyphen.");
    }
    return profile;
  },
  profilePaths: () => ({ configFile: "config.yaml", home: "/tmp/hermes-test" }),
  safeWriteFile: vi.fn(),
}));

vi.mock("../src/main/installer", () => ({
  getEnhancedPath: () => process.env.PATH || "",
  HERMES_PYTHON: "python3",
  hermesCliArgs: (args: string[]) => args,
}));

describe("MCP management in SSH tunnel mode", () => {
  beforeEach(() => {
    sshExecMock.mockReset();
  });

  it("lists MCP servers by reading the remote Hermes config over SSH", async () => {
    sshExecMock.mockResolvedValue(`mcp_servers:
  todoist:
    command: "npx"
    args:
      - "-y"
      - "@doist/todoist-mcp"
`);

    const { listMcpServers } = await import("../src/main/mcp-servers");
    const servers = await listMcpServers();

    expect(sshExecMock).toHaveBeenCalledTimes(1);
    expect(sshExecMock.mock.calls[0][1]).toContain("python3 -c");
    expect(servers[0]).toMatchObject({
      name: "todoist",
      type: "stdio",
      command: "npx",
      args: ["-y", "@doist/todoist-mcp"],
    });
  });

  it("adds MCP servers by writing the remote Hermes config over SSH", async () => {
    sshExecMock
      .mockResolvedValueOnce("model:\n  provider: openai-codex\n")
      .mockResolvedValueOnce("");

    const { addMcpServer } = await import("../src/main/mcp-servers");
    const result = await addMcpServer({
      name: "linear",
      type: "http",
      url: "https://mcp.linear.app/mcp",
    });

    expect(result).toEqual({ success: true });
    expect(sshExecMock).toHaveBeenCalledTimes(2);
    const writePayload = JSON.parse(String(sshExecMock.mock.calls[1][2]));
    expect(writePayload.content).toContain("mcp_servers:");
    expect(writePayload.content).toContain("linear:");
    expect(writePayload.content).toContain("https://mcp.linear.app/mcp");
  });

  it("rejects invalid SSH MCP profile names before remote config or CLI commands", async () => {
    const { listMcpServers, testMcpServer } = await import("../src/main/mcp-servers");

    await expect(listMcpServers("../../../etc")).rejects.toThrow(
      /Profile names may contain/,
    );
    await expect(testMcpServer("todoist", "work;touch /tmp/pwn")).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("Profile names may contain"),
    });
    expect(sshExecMock).not.toHaveBeenCalled();
  });

  it("tests MCP servers through remote Hermes CLI instead of HTTP management endpoints", async () => {
    sshExecMock.mockResolvedValue("list_tasks  List tasks\n");

    const { testMcpServer } = await import("../src/main/mcp-servers");
    const result = await testMcpServer("todoist");

    expect(result.success).toBe(true);
    expect(result.tools).toEqual([{ name: "list_tasks", description: "List tasks" }]);
    expect(sshExecMock.mock.calls[0][1]).toBe("'hermes' 'mcp' 'test' 'todoist'");
  });
});
