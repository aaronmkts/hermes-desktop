import { describe, it, expect, vi, beforeEach } from "vitest";

const { execFileSpy, sshRunCronSpy, connModeRef } = vi.hoisted(() => ({
  connModeRef: { mode: "local" as "local" | "remote" | "ssh" },
  sshRunCronSpy: vi.fn(async () => ({ success: true, stdout: "ok" })),
  execFileSpy: vi.fn(
    (
      _file: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => callback(null, "ok", ""),
  ),
}));

vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({
    mode: connModeRef.mode,
    remoteUrl: "http://example.com",
    apiKey: "",
    ssh:
      connModeRef.mode === "ssh"
        ? {
            host: "vps.example",
            port: 22,
            username: "orion",
            keyPath: "/tmp/key",
            remotePort: 8642,
            localPort: 18642,
          }
        : undefined,
  }),
}));

vi.mock("../src/main/ssh-remote", () => ({
  sshRunCron: sshRunCronSpy,
  sshReadCronJobsFile: vi.fn(async () => ({ jobs: [] })),
}));

vi.mock("child_process", () => ({
  execFile: execFileSpy,
  default: { execFile: execFileSpy },
}));

vi.mock("../src/main/utils", () => ({
  profileHome: () => "C:/hermes",
}));

vi.mock("../src/main/hermes", () => ({
  isRemoteMode: () =>
    connModeRef.mode === "remote" || connModeRef.mode === "ssh",
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
  normaliseRemoteUrl: (url: string) => url.replace(/\/+$/, ""),
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "C:/hermes",
  HERMES_PYTHON: "C:/hermes/hermes-agent/venv/Scripts/pythonw.exe",
  hermesCliArgs: (args: string[] = []) => ["-m", "hermes_cli.main", ...args],
}));

describe("createCronJob", () => {
  beforeEach(() => {
    connModeRef.mode = "local";
    execFileSpy.mockClear();
    sshRunCronSpy.mockReset();
    sshRunCronSpy.mockResolvedValue({ success: true, stdout: "ok" });
  });

  it("passes the prompt as the cron create positional argument before flags", async () => {
    const { createCronJob } = await import("../src/main/cronjobs");

    await createCronJob(
      "7 17 * * *",
      "Create a daily brief with local news, weather, and quotes.",
      "Daily brief",
      "telegram",
    );

    expect(execFileSpy).toHaveBeenCalledTimes(1);
    expect(execFileSpy.mock.calls[0][1]).toEqual([
      "-m",
      "hermes_cli.main",
      "cron",
      "create",
      "7 17 * * *",
      "Create a daily brief with local news, weather, and quotes.",
      "--name",
      "Daily brief",
      "--deliver",
      "telegram",
    ]);
    expect(execFileSpy.mock.calls[0][1]).not.toContain("--");
  });
});

describe("SSH tunnel cron control plane", () => {
  beforeEach(() => {
    connModeRef.mode = "ssh";
    execFileSpy.mockClear();
    sshRunCronSpy.mockReset();
    sshRunCronSpy.mockResolvedValue({ success: true, stdout: "ok" });
  });

  it("lists jobs with the remote Hermes cron CLI instead of /api/jobs", async () => {
    sshRunCronSpy.mockResolvedValueOnce({
      success: true,
      data: {
        jobs: [
          {
            id: "job-1",
            name: "Remote daily",
            schedule: "0 9 * * *",
            prompt: "Brief me",
          },
        ],
      },
      stdout: "{}",
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { listCronJobs } = await import("../src/main/cronjobs");
    const jobs = await listCronJobs(true, "work");

    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("job-1");
    expect(sshRunCronSpy).toHaveBeenCalledWith(
      expect.objectContaining({ host: "vps.example" }),
      ["list", "--json"],
      expect.objectContaining({ profile: "work", parseJson: true }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("creates, pauses, resumes, removes, and triggers through remote Hermes cron", async () => {
    const {
      createCronJob,
      pauseCronJob,
      resumeCronJob,
      removeCronJob,
      triggerCronJob,
    } = await import("../src/main/cronjobs");

    await createCronJob("7 17 * * *", "Prompt", "Daily", "telegram", "work");
    await pauseCronJob("job-1", "work");
    await resumeCronJob("job-1", "work");
    await removeCronJob("job-1", "work");
    await triggerCronJob("job-1", "work");

    expect(sshRunCronSpy.mock.calls.map((call) => call[1])).toEqual([
      [
        "create",
        "7 17 * * *",
        "Prompt",
        "--name",
        "Daily",
        "--deliver",
        "telegram",
      ],
      ["pause", "job-1"],
      ["resume", "job-1"],
      ["remove", "job-1"],
      ["run", "job-1"],
    ]);
    expect(
      sshRunCronSpy.mock.calls.every((call) => call[2]?.profile === "work"),
    ).toBe(true);
    expect(execFileSpy).not.toHaveBeenCalled();
  });
});
