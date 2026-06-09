import { execFileSync } from "child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/main/locale", () => ({
  getAppLocale: () => "en",
}));

import {
  buildRemoteHermesCmd,
  sshSetConfigValue,
  buildGatewayStartCommand,
  buildGatewayStopCommand,
  buildGatewayStatusCommand,
  sshGetToolsets,
  sshSetToolsetEnabled,
  sshListInstalledSkills,
  sshGetSkillContent,
  sshInstallSkill,
  sshGetPlatformEnabled,
  sshInstallRegistryItem,
  sshListInstalledRegistry,
} from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";

/** The `then` clause of the leading `if` — the systemd-managed branch. */
function systemdBranch(command: string): string {
  return command.slice(command.indexOf("then"), command.indexOf("else"));
}

const sshConfig: SshConfig = {
  host: "example.test",
  port: 22,
  username: "hermes",
  keyPath: "",
  remotePort: 8642,
  localPort: 18642,
};

function runWithHermesShim(command: string): Buffer {
  const home = mkdtempSync(join(tmpdir(), "hermes-ssh-cmd-home-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const hermes = join(bin, "hermes");
  writeFileSync(
    hermes,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "doctor" ]; then',
      '  printf "doctor stderr preserved\\n" >&2',
      "  exit 0",
      "fi",
      'printf "%s\\0" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(hermes, 0o755);
  return execFileSync("bash", ["-lc", command], {
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH || ""}`,
    },
  });
}

function parseNulArgs(output: Buffer): string[] {
  const parts = output.toString("utf8").split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

describe("ssh remote config writes", () => {
  it.each([
    ["quote", 'bad"value'],
    ["backslash", "bad\\value"],
    ["newline", "bad\nvalue"],
    ["carriage return", "bad\rvalue"],
  ])(
    "rejects YAML-breaking %s values before remote writes",
    async (_name, value) => {
      await expect(
        sshSetConfigValue(sshConfig, "base_url", value),
      ).rejects.toThrow("Config value contains illegal characters");
    },
  );
});

describe("ssh Hermes command quoting", () => {
  it("shell-quotes the whole bash script without dropping per-argument quoting", () => {
    const command = buildRemoteHermesCmd([
      "kanban",
      "create",
      "My task title",
      "--triage",
      "--json",
    ]);

    expect(command).not.toContain(
      "bash -c '[ -x $HOME/hermes-agent/.venv/bin/hermes ] && exec $HOME/hermes-agent/.venv/bin/hermes 'kanban' 'create'",
    );
    expect(command).toContain(
      `bash -c '[ -x $HOME/hermes-agent/.venv/bin/hermes ] && exec $HOME/hermes-agent/.venv/bin/hermes '"'"'kanban'"'"'`,
    );
  });

  it.each([
    [
      "multi-word title",
      ["kanban", "create", "My task title", "--triage", "--json"],
    ],
    [
      "multiline markdown body",
      [
        "kanban",
        "create",
        "My task title",
        "--body",
        "first line\n- bullet one\n- bullet two",
        "--triage",
        "--json",
      ],
    ],
    [
      "single quote in user input",
      ["kanban", "create", "User's task", "--json"],
    ],
  ])("preserves %s", (_name, expectedArgs) => {
    const command = buildRemoteHermesCmd(expectedArgs);
    expect(parseNulArgs(runWithHermesShim(command))).toEqual(expectedArgs);
  });

  it("preserves existing extraShell redirects", () => {
    const output = runWithHermesShim(
      buildRemoteHermesCmd(["doctor"], " 2>&1"),
    ).toString("utf8");
    expect(output).toBe("doctor stderr preserved\n");
  });
});

describe("ssh gateway commands (issue #285)", () => {
  it("detects a systemd hermes.service unit before acting", () => {
    for (const cmd of [
      buildGatewayStartCommand(),
      buildGatewayStopCommand(),
      buildGatewayStatusCommand(),
    ]) {
      expect(cmd).toContain("systemctl list-unit-files hermes.service");
      expect(cmd.indexOf("if ")).toBeLessThan(cmd.indexOf("else"));
    }
  });

  it("start prefers systemd, falling back to nohup only without a unit", () => {
    const cmd = buildGatewayStartCommand();
    expect(cmd).toContain("systemctl start hermes.service");
    expect(cmd).toContain("sudo -n systemctl start hermes.service");
    // The nohup fallback must live in the else branch — never alongside
    // systemd, where it would strand the unit in a restart crash-loop.
    expect(cmd).toContain("nohup hermes gateway start");
    expect(systemdBranch(cmd)).not.toContain("nohup");
  });

  it("stop routes through systemd, else hermes gateway stop", () => {
    const cmd = buildGatewayStopCommand();
    expect(cmd).toContain("systemctl stop hermes.service");
    expect(cmd).toContain("hermes gateway stop");
    expect(systemdBranch(cmd)).not.toContain("hermes gateway stop");
    expect(systemdBranch(cmd)).not.toContain("kill");
  });

  it("status reports the systemd unit state when managed", () => {
    const cmd = buildGatewayStatusCommand();
    expect(cmd).toContain("systemctl is-active hermes.service");
    expect(cmd).toContain("gateway.pid");
    expect(systemdBranch(cmd)).not.toContain("gateway.pid");
  });
});

describe("buildRemoteHermesCmd venv probe (issue #284)", () => {
  const cmd = buildRemoteHermesCmd(["--version"]);

  it("probes both .venv and venv for every install base", () => {
    for (const base of [
      "$HOME/hermes-agent",
      "$HOME/.hermes/hermes-agent",
      "/opt/hermes/hermes-agent",
    ]) {
      expect(cmd).toContain(`${base}/.venv/bin/hermes`);
      expect(cmd).toContain(`${base}/venv/bin/hermes`);
    }
  });

  it("probes ~/.local/bin where pip --user installs a wrapper", () => {
    expect(cmd).toContain("$HOME/.local/bin/hermes");
  });

  it("does not probe the /usr/local/bin sudo-wrapper it deliberately bypasses", () => {
    expect(cmd).not.toContain("/usr/local/bin/hermes");
  });

  it("still falls back to bare hermes on PATH", () => {
    expect(cmd).toContain("command -v hermes");
  });
});

describe("ssh tools and skills visibility", () => {
  function withFakeSshRemote(run: (remoteHome: string) => Promise<void>) {
    return async () => {
      const remoteHome = mkdtempSync(join(tmpdir(), "hermes-ssh-remote-home-"));
      const bin = join(remoteHome, "fake-bin");
      mkdirSync(bin, { recursive: true });
      const ssh = join(bin, "ssh");
      writeFileSync(
        ssh,
        [
          "#!/usr/bin/env bash",
          'cmd="${@: -1}"',
          'exec bash -lc "$cmd"',
          "",
        ].join("\n"),
      );
      chmodSync(ssh, 0o755);

      const oldPath = process.env.PATH;
      const oldHome = process.env.HOME;
      process.env.PATH = `${bin}:${oldPath || ""}`;
      process.env.HOME = remoteHome;
      try {
        await run(remoteHome);
      } finally {
        process.env.PATH = oldPath;
        process.env.HOME = oldHome;
        rmSync(remoteHome, { recursive: true, force: true });
      }
    };
  }

  it(
    "reads toolset state from remote config, including the full desktop toolset list",
    withFakeSshRemote(async (remoteHome) => {
      mkdirSync(join(remoteHome, ".hermes"), { recursive: true });
      writeFileSync(
        join(remoteHome, ".hermes", "config.yaml"),
        [
          "model:",
          "  default: gpt-4o",
          "platform_toolsets:",
          "  cli:",
          "      - web",
          "      - x_search",
          "",
        ].join("\n"),
      );

      const toolsets = await sshGetToolsets(sshConfig);
      expect(toolsets.find((t) => t.key === "web")?.enabled).toBe(true);
      expect(toolsets.find((t) => t.key === "x_search")?.enabled).toBe(true);
      expect(toolsets.find((t) => t.key === "browser")?.enabled).toBe(false);
      expect(toolsets.find((t) => t.key === "todo")?.enabled).toBe(false);
    }),
  );

  it(
    "writes profile toolset changes to the remote profile config",
    withFakeSshRemote(async (remoteHome) => {
      const profileDir = join(remoteHome, ".hermes", "profiles", "work");
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(
        join(profileDir, "config.yaml"),
        "model:\n  default: gpt-4o\n",
      );

      await expect(
        sshSetToolsetEnabled(sshConfig, "browser", true, "work"),
      ).resolves.toBe(true);

      const updated = readFileSync(join(profileDir, "config.yaml"), "utf-8");
      expect(updated).toContain("platform_toolsets:");
      expect(updated).toContain("  cli:");
      expect(updated).toContain("      - browser");
    }),
  );

  it(
    "lists and reads skills from the remote profile skills directory",
    withFakeSshRemote(async (remoteHome) => {
      const skillDir = join(
        remoteHome,
        ".hermes",
        "profiles",
        "work",
        "skills",
        "research",
        "remote-skill",
      );
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\nname: Remote Skill\ndescription: From VPS\n---\n# Remote Skill\n",
      );

      const skills = await sshListInstalledSkills(sshConfig, "work");
      expect(skills).toHaveLength(1);
      expect(skills[0]).toMatchObject({
        name: "remote-skill",
        category: "research",
        description: "From VPS",
      });
      expect(skills[0].path).toMatch(/^REMOTE:/);

      await expect(
        sshGetSkillContent(sshConfig, skills[0].path),
      ).resolves.toContain("# Remote Skill");
    }),
  );

  it(
    "shows remote platform toggle intent from config even before gateway runtime state catches up",
    withFakeSshRemote(async (remoteHome) => {
      mkdirSync(join(remoteHome, ".hermes"), { recursive: true });
      writeFileSync(
        join(remoteHome, ".hermes", "config.yaml"),
        [
          "model:",
          "  default: gpt-4o",
          "platforms:",
          "  telegram:",
          "    enabled: true",
          "  whatsapp:",
          "    enabled: false",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(remoteHome, ".hermes", "gateway_state.json"),
        JSON.stringify({ platforms: { telegram: { state: "stopped" } } }),
      );

      const enabled = await sshGetPlatformEnabled(sshConfig);

      expect(enabled.telegram).toBe(true);
      expect(enabled.whatsapp).toBe(false);
    }),
  );

  it(
    "installs Discover MCP registry entries into the remote Hermes config",
    withFakeSshRemote(async (remoteHome) => {
      mkdirSync(join(remoteHome, ".hermes"), { recursive: true });
      writeFileSync(
        join(remoteHome, ".hermes", "config.yaml"),
        "model:\n  default: gpt-4o\n",
      );
      const oldFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("/manifest.json")) {
          return new Response(
            JSON.stringify({ url: "https://example.test/mcp" }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch ${u}`);
      }) as typeof fetch;
      try {
        const result = await sshInstallRegistryItem(sshConfig, "mcps", {
          id: "example-mcp",
          name: "Example MCP",
          path: "mcps/example-mcp",
          description: "",
        });
        expect(result).toEqual({ success: true });
        const config = readFileSync(
          join(remoteHome, ".hermes", "config.yaml"),
          "utf-8",
        );
        expect(config).toContain("mcp_servers:");
        expect(config).toContain("  example-mcp:");
        expect(config).toContain('    url: "https://example.test/mcp"');
      } finally {
        globalThis.fetch = oldFetch;
      }
    }),
  );

  it(
    "lists Discover installed state from remote skills, MCPs, workflows, and profiles",
    withFakeSshRemote(async (remoteHome) => {
      mkdirSync(
        join(remoteHome, ".hermes", "skills", "creative", "remote-skill"),
        { recursive: true },
      );
      writeFileSync(
        join(
          remoteHome,
          ".hermes",
          "skills",
          "creative",
          "remote-skill",
          "SKILL.md",
        ),
        "---\nname: remote-skill\ndescription: remote\n---\n# Remote\n",
      );
      mkdirSync(join(remoteHome, ".hermes", "workflows", "remote-flow"), {
        recursive: true,
      });
      mkdirSync(join(remoteHome, ".hermes", "profiles", "remote-agent"), {
        recursive: true,
      });
      writeFileSync(
        join(remoteHome, ".hermes", "config.yaml"),
        "mcp_servers:\n  remote-mcp:\n    url: https://example.test/mcp\n",
      );

      const installed = await sshListInstalledRegistry(sshConfig);

      expect(installed.skills).toContain("remote-skill");
      expect(installed.mcps).toContain("remote-mcp");
      expect(installed.workflows).toContain("remote-flow");
      expect(installed.agents).toContain("remote-agent");
    }),
  );

  it(
    "passes named profiles to remote skill install commands",
    withFakeSshRemote(async (remoteHome) => {
      const localBin = join(remoteHome, ".local", "bin");
      mkdirSync(localBin, { recursive: true });
      const hermes = join(localBin, "hermes");
      writeFileSync(
        hermes,
        [
          "#!/usr/bin/env bash",
          'printf "%s\\n" "$@" > "$HOME/hermes-args.txt"',
          "",
        ].join("\n"),
      );
      chmodSync(hermes, 0o755);

      await expect(
        sshInstallSkill(sshConfig, "remote-skill", "work"),
      ).resolves.toEqual({
        success: true,
      });

      expect(readFileSync(join(remoteHome, "hermes-args.txt"), "utf-8")).toBe(
        "-p\nwork\nskills\ninstall\nremote-skill\n--yes\n",
      );
    }),
  );
});
