/**
 * SSH-proxied implementations of all hermes operations.
 * Used when connection mode is "ssh" — every feature that normally reads/writes
 * local files is instead executed on the remote host via SSH.
 */

import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import type { SshConfig } from "./ssh-tunnel";
import type { KanbanTask } from "./kanban";
import { buildSshControlOptions } from "./ssh-options";
import {
  classifySkillCliOutput,
  type InstalledSkill,
  type SkillSearchResult,
} from "./skills";
import type { MemoryInfo } from "./memory";
import type { SessionSummary, SearchResult } from "./sessions";
import type { CachedSession } from "./session-cache";
import { TOOLSET_DEFS, type ToolsetInfo } from "./tools";
import { DEFAULT_MESSAGING_PLATFORM_TOOLSETS } from "../shared/messaging-platforms";
import type { MessagingPlatformRuntimeState } from "../shared/messaging-platforms";
import type { SavedModel } from "./models";
import type {
  RegistryKind,
  RegistryItem,
  InstalledRegistry,
} from "../shared/registry";
import { expectedEnvKeyForModel, type MemoryProviderInfo } from "./installer";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";
import { canonicalProviderBaseUrl } from "./provider-registry";
import {
  buildCredentialPoolEntry,
  upsertBlockChild,
  type CredentialEntry,
  type ProviderCredentialStatus,
} from "./config";
import {
  isValidNamedProfileName,
  isValidProfileName,
  normalizeProfileName,
  PROFILE_NAME_ERROR,
} from "./utils";

// ── SSH exec core ────────────────────────────────────────────────────────────

function buildExecArgs(config: SshConfig): string[] {
  const keyPath = config.keyPath?.trim() || join(homedir(), ".ssh", "id_rsa");
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
    ...buildSshControlOptions(),
    "-i",
    keyPath,
    "-p",
    String(config.port || 22),
    `${config.username}@${config.host}`,
  ];
}

export function sshExec(
  config: SshConfig,
  command: string,
  stdin?: string,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...buildExecArgs(config), command], {
      stdio: ["pipe", "pipe", "pipe"],
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("SSH command timed out"));
    }, timeoutMs);
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(sanitizeSshError(stderr) || "SSH command failed"));
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

function sshPython(
  config: SshConfig,
  script: string,
  stdin?: string,
  timeoutMs = 30000,
): Promise<string> {
  if (stdin === undefined) {
    return sshExec(config, "python3 -", script, timeoutMs);
  }
  return sshExec(config, `python3 -c ${shellQuote(script)}`, stdin, timeoutMs);
}

function sanitizeSshError(stderr: string): string {
  const cleaned = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^Warning: Permanently added /.test(line))
    .filter((line) => !/identity file .* not accessible/i.test(line))
    .join("\n")
    .trim();
  if (
    /Permission denied \(publickey\)|no such identity|could not open a connection|publickey/i.test(
      cleaned,
    )
  ) {
    return "SSH authentication failed. Configure an SSH key for this host and try again.";
  }
  if (
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(
      cleaned,
    )
  ) {
    return "SSH host key verification failed. Check the host key before reconnecting.";
  }
  return cleaned;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function normalizeRemotePath(remotePath: string): string {
  return remotePath.replace(/^~\//, "$HOME/");
}

/**
 * Normalize renderer-supplied SSH profile names before they are interpolated
 * into remote filesystem paths or passed to remote Hermes CLI commands.
 * undefined, empty string, and "default" all mean the default profile; named
 * profiles must match the same safe rules as local profiles.
 */
export function normalizeSshProfileName(profile?: unknown): string | undefined {
  return normalizeProfileName(profile);
}

export function remoteHermesHome(profile?: unknown): string {
  const normalized = normalizeSshProfileName(profile);
  return normalized ? `$HOME/.hermes/profiles/${normalized}` : "$HOME/.hermes";
}

export function remoteHermesHomeTilde(profile?: unknown): string {
  const normalized = normalizeSshProfileName(profile);
  return normalized ? `~/.hermes/profiles/${normalized}` : "~/.hermes";
}

function pushProfileArg(args: string[], profile?: unknown, flag = "-p"): void {
  const normalized = normalizeSshProfileName(profile);
  if (normalized) args.push(flag, normalized);
}

function pythonJsonInput(payload: unknown): string {
  if (payload && typeof payload === "object" && "profile" in payload) {
    return JSON.stringify({
      ...(payload as Record<string, unknown>),
      profile: normalizeSshProfileName(
        (payload as Record<string, unknown>).profile,
      ),
    });
  }
  return JSON.stringify(payload);
}

export async function sshReadFile(
  config: SshConfig,
  remotePath: string,
): Promise<string> {
  try {
    return await sshExec(
      config,
      `bash -c 'case "$1" in "~/"*) p="$HOME/\${1#~/}" ;; "\\$HOME/"*) p="$HOME/\${1#\\$HOME/}" ;; *) p="$1" ;; esac; cat -- "$p" 2>/dev/null || true' -- ${shellQuote(normalizeRemotePath(remotePath))}`,
    );
  } catch {
    return "";
  }
}

export async function sshWriteFile(
  config: SshConfig,
  remotePath: string,
  content: string,
): Promise<void> {
  const p = normalizeRemotePath(remotePath);
  const dir = p.includes("/") ? p.substring(0, p.lastIndexOf("/")) : ".";
  await sshExec(
    config,
    `bash -c 'expand(){ case "$1" in "~/"*) printf "%s" "$HOME/\${1#~/}" ;; "\\$HOME/"*) printf "%s" "$HOME/\${1#\\$HOME/}" ;; *) printf "%s" "$1" ;; esac; }; dir=$(expand "$1"); file=$(expand "$2"); mkdir -p -- "$dir" && cat > "$file"' -- ${shellQuote(dir)} ${shellQuote(p)}`,
    content,
  );
}

// ── Skills ───────────────────────────────────────────────────────────────────

const REMOTE_PREFIX = "REMOTE:";

export async function sshListInstalledSkills(
  config: SshConfig,
  profile?: string,
): Promise<InstalledSkill[]> {
  const normalizedProfile = normalizeSshProfileName(profile);
  const script = `
import os, json, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
skills_dir = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills" if profile and profile != "default" else "~/.hermes/skills")
skills = []

def read_meta(skill_path):
    description = ""
    skill_file = os.path.join(skill_path, "SKILL.md")
    if os.path.exists(skill_file):
        try:
            content = open(skill_file).read(4000)
            if content.startswith("---"):
                end = content.find("---", 3)
                if end != -1:
                    for line in content[3:end].splitlines():
                        if line.strip().startswith("description:"):
                            description = line.split(":",1)[1].strip().strip("'").strip('"')
            else:
                for line in content.splitlines():
                    if line.strip() and not line.startswith("#"):
                        description = line.strip()[:120]
                        break
        except:
            pass
    return description

if os.path.isdir(skills_dir):
    for entry in sorted(os.listdir(skills_dir)):
        entry_path = os.path.join(skills_dir, entry)
        if not os.path.isdir(entry_path):
            continue
        direct_skill_file = os.path.join(entry_path, "SKILL.md")
        if os.path.exists(direct_skill_file):
            skills.append({"name": entry, "category": "", "description": read_meta(entry_path), "path": entry_path})
            continue
        for name in sorted(os.listdir(entry_path)):
            skill_path = os.path.join(entry_path, name)
            if os.path.isdir(skill_path) and os.path.exists(os.path.join(skill_path, "SKILL.md")):
                skills.append({"name": name, "category": entry, "description": read_meta(skill_path), "path": skill_path})
print(json.dumps(skills))
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile: normalizedProfile }),
    );
    const parsed = JSON.parse(out.trim() || "[]") as Array<{
      name: string;
      category: string;
      description: string;
      path: string;
    }>;
    return parsed.map((s) => ({ ...s, path: REMOTE_PREFIX + s.path }));
  } catch {
    return [];
  }
}

export async function sshGetSkillContent(
  config: SshConfig,
  skillPath: string,
): Promise<string> {
  const remote = skillPath.startsWith(REMOTE_PREFIX)
    ? skillPath.slice(REMOTE_PREFIX.length)
    : skillPath;
  return await sshReadFile(config, `${remote}/SKILL.md`);
}

export async function sshInstallSkill(
  config: SshConfig,
  identifier: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedProfile = normalizeSshProfileName(profile);
  try {
    const args: string[] = [];
    pushProfileArg(args, normalizedProfile);
    args.push("skills", "install", identifier, "--yes");
    const stdout = await sshExec(
      config,
      buildRemoteHermesCmd(args, " 2>&1"),
      undefined,
      120000,
    );
    return classifySkillCliOutput(stdout ?? "");
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sshUninstallSkill(
  config: SshConfig,
  name: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedProfile = normalizeSshProfileName(profile);
  let cliResult: { success: boolean; error?: string } | undefined;

  try {
    const args: string[] = [];
    pushProfileArg(args, normalizedProfile);
    args.push("skills", "uninstall", name, "--yes");
    const stdout = await sshExec(config, buildRemoteHermesCmd(args, " 2>&1"));
    cliResult = classifySkillCliOutput(stdout ?? "");
    if (cliResult.success) return cliResult;
  } catch (err) {
    cliResult = { success: false, error: (err as Error).message };
  }

  // CLI didn't find it or exited non-zero — try direct filesystem removal on
  // the remote. Send the script via stdin (`python3 -`) instead of embedding a
  // multiline Python program inside a shell-quoted `python3 -c '...'` string;
  // skill/profile names and Python string literals may contain single quotes.
  const payload = Buffer.from(
    JSON.stringify({ name, profile: normalizedProfile || "" }),
    "utf8",
  ).toString("base64");
  try {
    const cleanupOut = await sshPython(
      config,
      `
import base64, json, os, shutil
payload = json.loads(base64.b64decode(${JSON.stringify(payload)}).decode("utf-8"))
name = payload.get("name", "")
profile = payload.get("profile", "")
home = os.path.expanduser("~")
skills_dir = os.path.join(home, ".hermes", "profiles", profile, "skills") if profile and profile != "default" else os.path.join(home, ".hermes", "skills")
removed = False

def skill_name_for(entry_path, fallback):
    skill_file = os.path.join(entry_path, "SKILL.md")
    if not os.path.isfile(skill_file):
        return None
    skill_name = fallback
    try:
        with open(skill_file, "r", encoding="utf-8") as f:
            lines = f.read(4000).splitlines()
        in_fm = False
        for line in lines:
            if line.strip() == "---":
                if not in_fm:
                    in_fm = True
                    continue
                break
            if in_fm and line.strip().startswith("name:"):
                skill_name = line.split(":", 1)[1].strip().strip('"').strip("'")
                break
    except Exception:
        pass
    return skill_name


def maybe_remove(entry_path, fallback):
    skill_name = skill_name_for(entry_path, fallback)
    if skill_name is None:
        return False
    if skill_name == name or fallback == name:
        shutil.rmtree(entry_path)
        return True
    return False

if os.path.isdir(skills_dir):
    for entry in os.listdir(skills_dir):
        entry_path = os.path.join(skills_dir, entry)
        if not os.path.isdir(entry_path):
            continue
        # Direct profile/default skill layout: skills/<skill>/SKILL.md
        if maybe_remove(entry_path, entry):
            removed = True
            break
        # Categorised layout: skills/<category>/<skill>/SKILL.md
        for child in os.listdir(entry_path):
            child_path = os.path.join(entry_path, child)
            if os.path.isdir(child_path) and maybe_remove(child_path, child):
                removed = True
                break
        if removed:
            break
print(json.dumps({"removed": removed}))
`,
      undefined,
      30000,
    );
    const parsed = JSON.parse(cleanupOut.trim() || "{}");
    if (parsed?.removed === true) return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }

  return cliResult ?? { success: false, error: "Uninstall failed." };
}

export async function sshSearchSkills(
  config: SshConfig,
  query: string,
): Promise<SkillSearchResult[]> {
  try {
    const out = await sshExec(
      config,
      `${buildRemoteHermesCmd(["skills", "browse", "--query", query, "--json"], " 2>/dev/null")} || echo "[]"`,
    );
    const parsed = JSON.parse(out.trim() || "[]");
    if (Array.isArray(parsed)) {
      return parsed.map((r: Record<string, string>) => ({
        name: r.name || "",
        description: r.description || "",
        category: r.category || "",
        source: r.source || "",
        installed: false,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

export async function sshListBundledSkills(
  config: SshConfig,
): Promise<SkillSearchResult[]> {
  return await sshSearchSkills(config, "");
}

// ── Memory ───────────────────────────────────────────────────────────────────

const ENTRY_DELIMITER = "\n§\n";
const MEMORY_CHAR_LIMIT = 2200;
const USER_CHAR_LIMIT = 1375;

function parseMemoryEntries(
  content: string,
): Array<{ index: number; content: string }> {
  if (!content.trim()) return [];
  return content
    .split(ENTRY_DELIMITER)
    .map((entry, index) => ({ index, content: entry.trim() }))
    .filter((e) => e.content.length > 0);
}

function serializeEntries(
  entries: Array<{ index: number; content: string }>,
): string {
  return entries.map((e) => e.content).join(ENTRY_DELIMITER);
}

function remoteMemoryPath(profile?: string): string {
  return `${remoteHermesHomeTilde(profile)}/memories/MEMORY.md`;
}

function remoteUserPath(profile?: string): string {
  return `${remoteHermesHomeTilde(profile)}/memories/USER.md`;
}

async function sshGetSessionStats(
  config: SshConfig,
  profile?: string,
): Promise<{ totalSessions: number; totalMessages: number }> {
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print(json.dumps({"totalSessions": 0, "totalMessages": 0}))
    sys.exit(0)
conn = sqlite3.connect(db)
try:
    s = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    m = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    print(json.dumps({"totalSessions": s, "totalMessages": m}))
except:
    print(json.dumps({"totalSessions": 0, "totalMessages": 0}))
finally:
    conn.close()
`;
  try {
    const out = await sshPython(config, script, pythonJsonInput({ profile }));
    return JSON.parse(out.trim());
  } catch {
    return { totalSessions: 0, totalMessages: 0 };
  }
}

export async function sshReadMemory(
  config: SshConfig,
  profile?: string,
): Promise<MemoryInfo> {
  const memContent = await sshReadFile(config, remoteMemoryPath(profile));
  const userContent = await sshReadFile(config, remoteUserPath(profile));
  const stats = await sshGetSessionStats(config, profile);

  return {
    memory: {
      content: memContent,
      exists: memContent.length > 0,
      lastModified: null,
      entries: parseMemoryEntries(memContent),
      charCount: memContent.length,
      charLimit: MEMORY_CHAR_LIMIT,
    },
    user: {
      content: userContent,
      exists: userContent.length > 0,
      lastModified: null,
      charCount: userContent.length,
      charLimit: USER_CHAR_LIMIT,
    },
    stats,
  };
}

export async function sshAddMemoryEntry(
  config: SshConfig,
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const current = await sshReadFile(config, remoteMemoryPath(profile));
  const entries = parseMemoryEntries(current);
  const newContent = serializeEntries([
    ...entries,
    { index: entries.length, content: content.trim() },
  ]);
  if (newContent.length > MEMORY_CHAR_LIMIT) {
    return {
      success: false,
      error: `Would exceed memory limit (${newContent.length}/${MEMORY_CHAR_LIMIT} chars)`,
    };
  }
  await sshWriteFile(config, remoteMemoryPath(profile), newContent);
  return { success: true };
}

export async function sshUpdateMemoryEntry(
  config: SshConfig,
  index: number,
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const current = await sshReadFile(config, remoteMemoryPath(profile));
  const entries = parseMemoryEntries(current);
  if (index < 0 || index >= entries.length)
    return { success: false, error: "Entry not found" };
  entries[index] = { ...entries[index], content: content.trim() };
  const newContent = serializeEntries(entries);
  if (newContent.length > MEMORY_CHAR_LIMIT) {
    return {
      success: false,
      error: `Would exceed memory limit (${newContent.length}/${MEMORY_CHAR_LIMIT} chars)`,
    };
  }
  await sshWriteFile(config, remoteMemoryPath(profile), newContent);
  return { success: true };
}

export async function sshRemoveMemoryEntry(
  config: SshConfig,
  index: number,
  profile?: string,
): Promise<boolean> {
  const current = await sshReadFile(config, remoteMemoryPath(profile));
  const entries = parseMemoryEntries(current);
  if (index < 0 || index >= entries.length) return false;
  entries.splice(index, 1);
  await sshWriteFile(
    config,
    remoteMemoryPath(profile),
    serializeEntries(entries),
  );
  return true;
}

export async function sshWriteUserProfile(
  config: SshConfig,
  content: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (content.length > USER_CHAR_LIMIT) {
    return {
      success: false,
      error: `Exceeds limit (${content.length}/${USER_CHAR_LIMIT} chars)`,
    };
  }
  await sshWriteFile(config, remoteUserPath(profile), content);
  return { success: true };
}

// ── Soul ─────────────────────────────────────────────────────────────────────

const DEFAULT_SOUL = `You are Hermes, a helpful AI assistant. You are friendly, knowledgeable, and always eager to help.

You communicate clearly and concisely. When asked to perform tasks, you think step-by-step and explain your reasoning. You are honest about your limitations and ask for clarification when needed.

You strive to be helpful while being safe and responsible. You respect the user's privacy and handle sensitive information carefully.
`;

function remoteSoulPath(profile?: string): string {
  return `${remoteHermesHomeTilde(profile)}/SOUL.md`;
}

export async function sshReadSoul(
  config: SshConfig,
  profile?: string,
): Promise<string> {
  return await sshReadFile(config, remoteSoulPath(profile));
}

export async function sshWriteSoul(
  config: SshConfig,
  content: string,
  profile?: string,
): Promise<boolean> {
  normalizeSshProfileName(profile);
  try {
    await sshWriteFile(config, remoteSoulPath(profile), content);
    return true;
  } catch {
    return false;
  }
}

export async function sshResetSoul(
  config: SshConfig,
  profile?: string,
): Promise<string> {
  await sshWriteSoul(config, DEFAULT_SOUL, profile);
  return DEFAULT_SOUL;
}

// ── Tools ────────────────────────────────────────────────────────────────────

function parsePlatformToolsets(content: string): Record<string, Set<string>> {
  const toolsets: Record<string, Set<string>> = {};
  let inPlatformToolsets = false;
  let currentPlatform: string | null = null;
  for (const line of content.split("\n")) {
    const trimmed = line.trimEnd();
    if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
      inPlatformToolsets = true;
      currentPlatform = null;
      continue;
    }
    if (inPlatformToolsets && /^\S/.test(trimmed) && trimmed !== "") {
      inPlatformToolsets = false;
      currentPlatform = null;
      continue;
    }
    if (!inPlatformToolsets) continue;

    const platformMatch = trimmed.match(
      /^\s+([A-Za-z0-9_-]+)\s*:\s*(\[\])?\s*(?:#.*)?$/,
    );
    if (platformMatch) {
      const platformName = platformMatch[1];
      currentPlatform = platformMatch[2] ? null : platformName;
      toolsets[platformName] ??= new Set<string>();
      continue;
    }

    if (currentPlatform) {
      const m = trimmed.match(/^\s+-\s+["']?([A-Za-z0-9_-]+)["']?/);
      if (m) toolsets[currentPlatform].add(m[1]);
    }
  }
  return toolsets;
}

function parseEnabledToolsets(content: string, platform = "cli"): Set<string> {
  return parsePlatformToolsets(content)[platform] ?? new Set<string>();
}

function isSafeToolsetConfigKey(key: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(key);
}

function localizeToolDefs(
  enabled: boolean | ((key: string) => boolean),
): ToolsetInfo[] {
  const locale = getAppLocale();
  return TOOLSET_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey, locale),
    description: t(d.descriptionKey, locale),
    enabled: typeof enabled === "function" ? enabled(d.key) : enabled,
  }));
}

function remoteConfigPath(profile?: string): string {
  return `${remoteHermesHome(profile)}/config.yaml`;
}

export async function sshGetToolsets(
  config: SshConfig,
  profile?: string,
): Promise<ToolsetInfo[]> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return localizeToolDefs(true);
  const enabled = parseEnabledToolsets(content);
  if (enabled.size === 0 && !content.includes("platform_toolsets"))
    return localizeToolDefs(true);
  return localizeToolDefs((key) => enabled.has(key));
}

export async function sshGetPlatformToolsets(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, string[]>> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return {};
  return Object.fromEntries(
    Object.entries(parsePlatformToolsets(content)).map(([platform, values]) => [
      platform,
      Array.from(values).sort(),
    ]),
  );
}

export async function sshSetToolsetEnabled(
  config: SshConfig,
  key: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  return sshSetPlatformToolsetEnabled(config, "cli", key, enabled, profile);
}

export async function sshSetMessagingPlatformToolsetEnabled(
  config: SshConfig,
  platform: string,
  key: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  return sshSetPlatformToolsetEnabled(
    config,
    platform,
    key,
    enabled,
    profile,
    DEFAULT_MESSAGING_PLATFORM_TOOLSETS,
  );
}

async function sshSetPlatformToolsetEnabled(
  config: SshConfig,
  platform: string,
  key: string,
  enabled: boolean,
  profile?: string,
  defaultEnabled: string[] = [],
): Promise<boolean> {
  try {
    if (!isSafeToolsetConfigKey(platform) || !isSafeToolsetConfigKey(key)) {
      return false;
    }
    const configPath = remoteConfigPath(profile);
    const content = await sshReadFile(config, configPath);
    if (!content) return false;

    const parsed = parsePlatformToolsets(content);
    const hasPlatformConfig = Object.prototype.hasOwnProperty.call(
      parsed,
      platform,
    );
    const current = hasPlatformConfig
      ? new Set(parsed[platform])
      : new Set(defaultEnabled);
    if (enabled) current.add(key);
    else current.delete(key);

    const toolsetLines = Array.from(current)
      .sort()
      .map((t) => `      - ${t}`)
      .join("\n");
    const newSection = `  ${platform}:\n${toolsetLines}`;
    const platformHeader = new RegExp(`^\\s+${platform}\\s*:`);

    let newContent: string;
    if (content.includes("platform_toolsets")) {
      const lines = content.split("\n");
      const result: string[] = [];
      let inPT = false,
        inTargetPlatform = false,
        inserted = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimEnd();
        if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
          inPT = true;
          result.push(line);
          continue;
        }
        if (inPT && platformHeader.test(trimmed)) {
          inTargetPlatform = true;
          result.push(newSection);
          inserted = true;
          continue;
        }
        if (inTargetPlatform) {
          if (/^\s+-\s/.test(trimmed)) continue;
          inTargetPlatform = false;
          result.push(line);
          continue;
        }
        if (inPT && /^\S/.test(trimmed) && trimmed !== "") {
          inPT = false;
          if (!inserted) {
            result.push(newSection);
            inserted = true;
          }
        }
        result.push(line);
      }
      if (inPT && !inserted) {
        result.push(newSection);
      }
      newContent = result.join("\n");
    } else {
      newContent =
        content.trimEnd() + "\n\nplatform_toolsets:\n" + newSection + "\n";
    }

    await sshWriteFile(config, configPath, newContent);
    return true;
  } catch {
    return false;
  }
}

function remoteGatewayStatePath(profile?: string): string {
  return `${remoteHermesHomeTilde(profile)}/gateway_state.json`;
}

const REMOTE_PLATFORM_STATE_KEY: Record<string, string> = {
  home_assistant: "homeassistant",
  webhooks: "webhook",
};

interface RemoteGatewayStateFile {
  gateway_state?: string | null;
  pid?: number | null;
  platforms?: Record<string, MessagingPlatformRuntimeState>;
}

export async function sshReadGatewayPlatformStates(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, MessagingPlatformRuntimeState>> {
  const raw = await sshReadFile(config, remoteGatewayStatePath(profile));
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as RemoteGatewayStateFile;
    if (parsed.gateway_state && parsed.gateway_state !== "running") return {};
    const platforms = parsed.platforms ?? {};
    const result: Record<string, MessagingPlatformRuntimeState> = {};
    for (const [platform, state] of Object.entries(platforms)) {
      result[platform] = state;
    }
    for (const [desktopKey, stateKey] of Object.entries(
      REMOTE_PLATFORM_STATE_KEY,
    )) {
      if (platforms[stateKey] && !result[desktopKey]) {
        result[desktopKey] = platforms[stateKey];
      }
    }
    return result;
  } catch {
    return {};
  }
}

// ── Env / Config (Providers) ─────────────────────────────────────────────────

function remoteEnvPath(profile?: string): string {
  return `${remoteHermesHomeTilde(profile)}/.env`;
}

export const SSH_ENV_MASK = "••••••••";

export function maskRemoteEnvForRenderer(
  env: Record<string, string>,
): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    masked[key] = value ? SSH_ENV_MASK : "";
  }
  return masked;
}

function validateRemoteEnvEntry(key: string, value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(
      "Invalid environment variable name. Use letters, numbers, and underscores, and do not start with a number.",
    );
  }
  if (/[\r\n\0]/.test(value)) {
    throw new Error(
      "Environment variable values must be single-line and cannot contain NUL characters.",
    );
  }
}

export async function sshReadEnvForRenderer(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, string>> {
  return maskRemoteEnvForRenderer(await sshReadEnv(config, profile));
}

export async function sshReadEnv(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, string>> {
  const content = await sshReadFile(config, remoteEnvPath(profile));
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const k = trimmed.substring(0, eqIdx).trim();
    let v = trimmed.substring(eqIdx + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (v) result[k] = v;
  }
  // Home Assistant has accumulated three naming conventions across hermes
  // versions: HASS_* (what gateway/config.py currently reads), HOMEASSISTANT_*
  // (legacy), and HA_* (older desktop builds). Mirror all three so the UI
  // can display the value regardless of which one the remote server uses.
  const HA_ALIAS_GROUPS: string[][] = [
    ["HASS_URL", "HOMEASSISTANT_URL", "HA_URL"],
    ["HASS_TOKEN", "HOMEASSISTANT_TOKEN", "HA_TOKEN"],
  ];
  for (const group of HA_ALIAS_GROUPS) {
    const present = group.find((k) => result[k]);
    if (!present) continue;
    const value = result[present];
    for (const k of group) {
      if (!result[k]) result[k] = value;
    }
  }
  return result;
}

export async function sshSetEnvValue(
  config: SshConfig,
  key: string,
  value: string,
  profile?: string,
): Promise<void> {
  validateRemoteEnvEntry(key, value);

  // The SSH renderer API returns masked placeholders instead of raw secrets.
  // If an unchanged masked field is blurred/saved, treat it as no-op so the
  // placeholder never overwrites the remote secret. Actual writes still pass
  // their payload via stdin in sshWriteFile, never on the ssh command line.
  if (value === SSH_ENV_MASK) return;

  const envPath = remoteEnvPath(profile);
  const content = await sshReadFile(config, envPath);

  if (!content.trim()) {
    await sshWriteFile(config, envPath, `${key}=${value}\n`);
    return;
  }

  const lines = content.split("\n");
  let found = false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().match(new RegExp(`^#?\\s*${escaped}\\s*=`))) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) lines.push(`${key}=${value}`);
  await sshWriteFile(config, envPath, lines.join("\n"));
}

// ─── Dotted-path YAML helpers (mirror of the local-mode fix) ───────────────
//
// The previous implementation used `^\s*<key>:` against the whole remote
// config.yaml. Two problems, both observed in the wild (#240): dotted-path
// keys like `model.provider` looked for a literal `model.provider:` line
// that doesn't exist in real YAML, and flat keys leaked across blocks
// (the first `default:` at any indent — typically `personalities.default`
// — would shadow `model.default`). The new helpers walk path segments at
// strictly-greater indent than each parent and pin single-segment keys
// to column 0.
//
// Duplicates the navigator in config.ts intentionally to keep this PR
// self-contained and independent. Once both land, a small consolidation
// PR can lift these into a shared module.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripYamlQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

interface YamlPathHit {
  value: string;
  valueStart: number;
  valueEnd: number;
}

interface SegmentMatch {
  indent: number;
  rawValue: string;
  valueStart: number;
  valueEnd: number;
  afterLine: number;
}

function findSegmentInBlock(
  content: string,
  startAt: number,
  parentIndent: number,
  segment: string,
): SegmentMatch | null {
  const escapedSegment = escapeRegex(segment);
  let directChildIndent: number | null = null;
  let cursor = startAt;

  while (cursor < content.length) {
    const lineEnd = content.indexOf("\n", cursor);
    const lineEndExclusive = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(cursor, lineEndExclusive);
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      cursor =
        lineEndExclusive === content.length
          ? content.length
          : lineEndExclusive + 1;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    // Block boundary: a non-blank line at or shallower than the parent
    // closes the parent's block.
    if (indent <= parentIndent) return null;

    if (directChildIndent === null) directChildIndent = indent;

    if (indent === directChildIndent) {
      // `[ \t]*` so this also matches top-level keys at column 0 (the
      // first segment of a dotted path); the `indent === directChild`
      // gate above already enforces depth.
      const m = line.match(
        new RegExp(
          `^([ \\t]*)(${escapedSegment}):([ \\t]*)([^\\n#]*?)([ \\t]*)(#.*)?$`,
        ),
      );
      if (m) {
        const indentStr = m[1];
        const gapBeforeValue = m[3];
        const rawValue = m[4];
        const keyEnd = cursor + indentStr.length + segment.length + 1;
        const valueStart = keyEnd + gapBeforeValue.length;
        const valueEnd = valueStart + rawValue.length;
        return {
          indent: indentStr.length,
          rawValue,
          valueStart,
          valueEnd,
          afterLine:
            lineEndExclusive === content.length
              ? content.length
              : lineEndExclusive + 1,
        };
      }
    }

    cursor =
      lineEndExclusive === content.length
        ? content.length
        : lineEndExclusive + 1;
  }

  return null;
}

/** Exported for unit testing. Walks a dotted YAML path through `content`. */
export function findYamlPath(
  content: string,
  dottedPath: string,
): YamlPathHit | null {
  const segments = dottedPath.split(".").filter(Boolean);
  if (segments.length === 0) return null;

  let cursor = 0;
  let parentIndent = -1;

  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const found = findSegmentInBlock(
      content,
      cursor,
      parentIndent,
      segments[i],
    );
    if (!found) return null;

    if (isLast) {
      return {
        value: stripYamlQuotes(found.rawValue),
        valueStart: found.valueStart,
        valueEnd: found.valueEnd,
      };
    }
    cursor = found.afterLine;
    parentIndent = found.indent;
  }

  return null;
}

/** Exported for unit testing. Matches `<key>:` at column 0 only. */
export function findTopLevelKey(
  content: string,
  key: string,
): YamlPathHit | null {
  const re = new RegExp(
    `^(${escapeRegex(key)}):([ \\t]*)([^\\n#]*?)([ \\t]*)(#.*)?$`,
    "m",
  );
  const m = content.match(re);
  if (!m || m.index === undefined) return null;
  const gap = m[2];
  const rawValue = m[3];
  const lineStart = m.index;
  const valueStart = lineStart + key.length + 1 + gap.length;
  const valueEnd = valueStart + rawValue.length;
  return {
    value: stripYamlQuotes(rawValue),
    valueStart,
    valueEnd,
  };
}

function locateInYaml(content: string, key: string): YamlPathHit | null {
  const segments = key.split(".").filter(Boolean);
  if (segments.length === 0) return null;
  return segments.length === 1
    ? findTopLevelKey(content, segments[0])
    : findYamlPath(content, key);
}

export async function sshGetConfigValue(
  config: SshConfig,
  key: string,
  profile?: string,
): Promise<string | null> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return null;
  const hit = locateInYaml(content, key);
  return hit ? hit.value : null;
}

export async function sshSetConfigValue(
  config: SshConfig,
  key: string,
  value: string,
  profile?: string,
): Promise<void> {
  if (/["\\\n\r]/.test(value)) {
    throw new Error(
      'Config value contains illegal characters: ", \\, or newline',
    );
  }
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;

  const hit = locateInYaml(content, key);
  let updated: string;
  if (hit) {
    updated =
      content.slice(0, hit.valueStart) +
      `"${value}"` +
      content.slice(hit.valueEnd);
  } else if (!key.includes(".")) {
    // Flat key missing → append at top level.
    const sep = content.endsWith("\n") || content === "" ? "" : "\n";
    updated = `${content}${sep}${key}: "${value}"\n`;
  } else {
    // Missing nested path — don't guess where to materialize a parent
    // block; that risks corrupting the file. Leave the content alone.
    return;
  }

  await sshWriteFile(config, configPath, updated);
}

export function sshGetHermesHome(_config: SshConfig, profile?: string): string {
  return remoteHermesHomeTilde(profile);
}

type SshCredentialEntry = CredentialEntry;

function sshAuthPath(profile?: string): string {
  return `${remoteHermesHome(profile)}/auth.json`;
}

function authStoreHasProviderCredentials(
  store: unknown,
  provider: string,
): boolean {
  if (!store || typeof store !== "object") return false;
  const cleanProvider = provider.trim();
  if (!cleanProvider) return false;
  const root = store as {
    providers?: Record<string, SshCredentialEntry>;
    credential_pool?: Record<string, SshCredentialEntry[]>;
  };

  const providerEntry = root.providers?.[cleanProvider];
  if (
    providerEntry &&
    (String(providerEntry.access_token || "").trim() ||
      String(providerEntry.refresh_token || "").trim() ||
      String(providerEntry.api_key || "").trim())
  ) {
    return true;
  }

  const entries = root.credential_pool?.[cleanProvider];
  return Array.isArray(entries)
    ? entries.some(
        (entry) =>
          !!(
            entry &&
            (String(entry.api_key || "").trim() ||
              String(entry.access_token || "").trim() ||
              String(entry.refresh_token || "").trim())
          ),
      )
    : false;
}

function remoteHonchoPath(profile?: string): string {
  return `${remoteHermesHome(profile)}/honcho.json`;
}

async function sshReadAuthStore(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, unknown>> {
  const raw = await sshReadFile(config, sshAuthPath(profile));
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function sshWriteAuthStore(
  config: SshConfig,
  store: Record<string, unknown>,
  profile?: string,
): Promise<void> {
  await sshWriteFile(
    config,
    sshAuthPath(profile),
    JSON.stringify(store, null, 2),
  );
}

export async function sshGetCredentialPool(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, CredentialEntry[]>> {
  const store = await sshReadAuthStore(config, profile);
  const pool = store.credential_pool;
  return pool && typeof pool === "object"
    ? (pool as Record<string, CredentialEntry[]>)
    : {};
}

export async function sshSetCredentialPool(
  config: SshConfig,
  provider: string,
  entries: CredentialEntry[],
  profile?: string,
): Promise<void> {
  const store = await sshReadAuthStore(config, profile);
  if (!store.credential_pool || typeof store.credential_pool !== "object") {
    store.credential_pool = {};
  }
  (store.credential_pool as Record<string, CredentialEntry[]>)[provider] =
    entries;
  await sshWriteAuthStore(config, store, profile);
}

export async function sshAddCredentialPoolEntry(
  config: SshConfig,
  provider: string,
  apiKey: string,
  label: string,
  profile?: string,
): Promise<CredentialEntry[]> {
  const existing =
    (await sshGetCredentialPool(config, profile))[provider] || [];
  const entry = buildCredentialPoolEntry(provider, apiKey, label, existing);
  const next = [...existing, entry];
  await sshSetCredentialPool(config, provider, next, profile);
  return next;
}

async function sshHasHonchoJsonCredential(
  config: SshConfig,
  profile?: string,
): Promise<boolean> {
  const raw = await sshReadFile(config, remoteHonchoPath(profile));
  if (!raw.trim()) return false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return !!(
      String(parsed.apiKey || "").trim() ||
      String(parsed.api_key || "").trim() ||
      String(parsed.key || "").trim()
    );
  } catch {
    return false;
  }
}

export async function sshGetProviderCredentialStatus(
  config: SshConfig,
  provider: string,
  profile?: string,
): Promise<ProviderCredentialStatus> {
  const cleanProvider = provider.trim();
  if (cleanProvider === "honcho") {
    const env = await sshReadEnv(config, profile);
    if (String(env.HONCHO_API_KEY || "").trim()) {
      return {
        provider,
        configured: true,
        source: "env",
        locationLabel: ".env on VPS",
      };
    }
    if (await sshHasHonchoJsonCredential(config, profile)) {
      return {
        provider,
        configured: true,
        source: "honcho.json",
        locationLabel: "honcho.json on VPS",
      };
    }
    return {
      provider,
      configured: false,
      source: "missing",
      locationLabel: "Missing on VPS",
    };
  }
  return (await sshHasOAuthCredentials(config, cleanProvider, profile))
    ? {
        provider,
        configured: true,
        source: "auth.json",
        locationLabel: "auth.json on VPS",
      }
    : {
        provider,
        configured: false,
        source: "missing",
        locationLabel: "Missing on VPS",
      };
}

export async function sshHasOAuthCredentials(
  config: SshConfig,
  provider: string,
  profile?: string,
): Promise<boolean> {
  const paths = [sshAuthPath(profile)];
  if (profile && profile !== "default") paths.push(sshAuthPath());

  for (const path of paths) {
    const raw = await sshReadFile(config, path);
    if (!raw.trim()) continue;
    try {
      if (authStoreHasProviderCredentials(JSON.parse(raw), provider))
        return true;
    } catch {
      // Ignore malformed auth stores; readiness remains fail-open only if the
      // caller catches a broader SSH/read failure.
    }
  }
  return false;
}

export async function sshGetModelConfig(
  config: SshConfig,
  profile?: string,
): Promise<{ provider: string; model: string; baseUrl: string }> {
  // Use dotted paths so the lookup is scoped to the `model:` block. The
  // previous flat keys `provider` / `default` / `base_url` would each
  // match the first occurrence at any indent — typically picking up
  // `personalities.default` or `auxiliary.vision.provider` and reporting
  // them as the model fields (#240).
  return {
    provider:
      (await sshGetConfigValue(config, "model.provider", profile)) || "auto",
    model: (await sshGetConfigValue(config, "model.default", profile)) || "",
    baseUrl: (await sshGetConfigValue(config, "model.base_url", profile)) || "",
  };
}

async function sshPickAutoApiKeyForCustomProvider(
  config: SshConfig,
  provider: string,
  baseUrl: string,
  profile?: string,
): Promise<string | null> {
  if (provider !== "custom" || !baseUrl) return null;
  const envKey = expectedEnvKeyForModel(provider, baseUrl);
  if (!envKey) return null;
  const env = await sshReadEnv(config, profile);
  const raw = env[envKey];
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  return trimmed || null;
}

function rewriteModelApiKey(content: string, apiKey: string | null): string {
  const headerMatch = content.match(/^model:[^\S\r\n]*\r?\n/m);
  if (!headerMatch) return content;
  const start = headerMatch.index! + headerMatch[0].length;
  const after = content.slice(start);
  const nextTopMatch = after.match(/^\S/m);
  const end = nextTopMatch ? start + nextTopMatch.index! : content.length;
  const block = content.slice(start, end);
  const apiKeyInBlock = /^[ \t]+api_key:\s*.*\r?\n?/m;
  let newBlock = block;

  if (apiKey) {
    if (apiKeyInBlock.test(block)) {
      newBlock = block.replace(/^([ \t]+api_key:\s*).*$/m, `$1"${apiKey}"`);
    } else {
      const eolMatch = block.match(/\r?\n/);
      const eol = eolMatch ? eolMatch[0] : "\n";
      const indentMatch = block.match(/^([ \t]+)\S/m);
      const indent = indentMatch ? indentMatch[1] : "  ";
      const apiKeyLine = `${indent}api_key: "${apiKey}"${eol}`;
      const afterBaseUrl = block.replace(
        /^([ \t]+base_url:\s*"[^"]*"\s*\r?\n)/m,
        `$1${apiKeyLine}`,
      );
      newBlock =
        afterBaseUrl !== block
          ? afterBaseUrl
          : block.replace(
              /^([ \t]+provider:\s*"[^"]*"\s*\r?\n)/m,
              `$1${apiKeyLine}`,
            );
      if (newBlock === block) newBlock = `${apiKeyLine}${block}`;
    }
  } else if (apiKeyInBlock.test(block)) {
    newBlock = block.replace(apiKeyInBlock, "");
  }

  if (newBlock === block) return content;
  return content.slice(0, start) + newBlock + content.slice(end);
}

export async function sshSetModelConfig(
  config: SshConfig,
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): Promise<void> {
  const configPath = remoteConfigPath(profile);
  const original = await sshReadFile(config, configPath);

  // Rewrite the remote config.yaml as a document, not as independent dotted
  // set operations. `sshSetConfigValue("model.default")` intentionally does
  // not materialize missing nested blocks, which meant SSH Tunnel mode could
  // silently fail to save a model when the remote config was new or lacked a
  // model: block. The local helper already knows how to scope updates to the
  // top-level model block while preserving unrelated sections, so use it here
  // against the remote payload and then write the whole file back over SSH.
  let updated = upsertBlockChild(original, "model", "provider", provider);
  updated = upsertBlockChild(updated, "model", "default", model);

  const effectiveBaseUrl = baseUrl || canonicalProviderBaseUrl(provider) || "";
  if (effectiveBaseUrl) {
    updated = upsertBlockChild(updated, "model", "base_url", effectiveBaseUrl);
  }

  const autoApiKey = await sshPickAutoApiKeyForCustomProvider(
    config,
    provider,
    baseUrl,
    profile,
  );
  updated = rewriteModelApiKey(updated, autoApiKey);

  updated = updated.replace(/^(\s*streaming:\s*)(\S+)/m, "$1true");
  const lines = updated.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (
      /^\s*enabled:\s*(true|false)/.test(lines[i]) &&
      i > 0 &&
      /smart_model_routing/.test(lines[i - 1])
    ) {
      lines[i] = lines[i].replace(/(enabled:\s*)(true|false)/, "$1false");
    }
  }
  updated = lines.join("\n");

  if (updated !== original) await sshWriteFile(config, configPath, updated);
}
// ── Sessions ─────────────────────────────────────────────────────────────────

export async function sshListSessions(
  config: SshConfig,
  limit = 30,
  offset = 0,
  profile?: string,
): Promise<SessionSummary[]> {
  const normalizedProfile = normalizeSshProfileName(profile);
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
limit = max(1, min(200, int(payload.get("limit") or 30)))
offset = max(0, int(payload.get("offset") or 0))
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT id, source, started_at, ended_at, message_count, model, title "
    "FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?",
    (limit, offset)
).fetchall()
result = []
for r in rows:
    result.append({
        "id": r["id"], "source": r["source"] or "cli",
        "startedAt": r["started_at"], "endedAt": r["ended_at"],
        "messageCount": r["message_count"] or 0, "model": r["model"] or "",
        "title": r["title"], "preview": ""
    })
print(json.dumps(result))
conn.close()
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile: normalizedProfile, limit, offset }),
    );
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

export async function sshGetSessionMessages(
  config: SshConfig,
  sessionId: string,
  profile?: string,
): Promise<import("./sessions").HistoryItem[]> {
  const normalizedProfile = normalizeSshProfileName(profile);
  // Mirror the local getSessionMessages logic over SSH: widen the SELECT to
  // include tool_calls / tool_name / tool_call_id / reasoning columns, then
  // expand each row into one or more HistoryItem entries. Kept inline in
  // Python for transport simplicity. See src/main/sessions.ts for the
  // canonical implementation and column documentation.
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
session_id = payload.get("sessionId") or ""
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row

CONTENT_JSON_PREFIX = "\\x00json:"

def decode(raw):
    """Mirror src/main/sessions.ts::decodeContent — strip multimodal
    sentinel, concat text parts, ignore images here (SSH path drops
    attachments)."""
    if not raw or not raw.startswith(CONTENT_JSON_PREFIX):
        return raw or ""
    try:
        parts = json.loads(raw[len(CONTENT_JSON_PREFIX):])
    except Exception:
        return raw
    if isinstance(parts, str):
        return parts
    if not isinstance(parts, list):
        return raw
    texts = []
    for p in parts:
        if isinstance(p, str):
            if p: texts.append(p)
            continue
        if not isinstance(p, dict): continue
        t = str(p.get("type") or "").lower()
        if t in ("text", "input_text", "output_text"):
            v = p.get("text")
            if isinstance(v, str) and v: texts.append(v)
    return "\\n\\n".join(texts)

def pick_reasoning(row):
    for col in ("reasoning", "reasoning_content"):
        v = (row[col] or "").strip() if row[col] else ""
        if v: return v
    details = (row["reasoning_details"] or "").strip()
    if not details: return ""
    try:
        parsed = json.loads(details)
    except Exception:
        return ""
    if isinstance(parsed, str): return parsed
    if isinstance(parsed, list):
        texts = []
        for entry in parsed:
            if not isinstance(entry, dict): continue
            for k in ("text", "thinking"):
                v = entry.get(k)
                if isinstance(v, str) and v: texts.append(v); break
        if texts: return "\\n\\n".join(texts)
    return ""

def parse_tool_calls(raw):
    if not raw or not raw.strip(): return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list): return []
    out = []
    for entry in parsed:
        if not isinstance(entry, dict): continue
        fn = entry.get("function") or {}
        name = fn.get("name")
        if not isinstance(name, str) or not name: continue
        call_id = entry.get("call_id") or entry.get("id") or ""
        raw_args = fn.get("arguments")
        args = raw_args if isinstance(raw_args, str) else ""
        try:
            args = json.dumps(json.loads(args), indent=2)
        except Exception:
            pass
        out.append({"callId": call_id, "name": name, "args": args})
    return out

rows = conn.execute(
    "SELECT id, role, content, timestamp, tool_call_id, tool_calls, tool_name, "
    "reasoning, reasoning_content, reasoning_details "
    "FROM messages WHERE session_id = ? AND role IN ('user','assistant','tool') "
    "ORDER BY timestamp, id",
    (session_id,)
).fetchall()

items = []
for r in rows:
    text = decode(r["content"] or "")
    if r["role"] == "user":
        if not text: continue
        items.append({"kind":"user","id":r["id"],"content":text,"timestamp":r["timestamp"]})
        continue
    if r["role"] == "assistant":
        reasoning_text = pick_reasoning(r)
        if reasoning_text:
            items.append({"kind":"reasoning","id":r["id"],"assistantId":r["id"],"text":reasoning_text,"timestamp":r["timestamp"]})
        if text:
            items.append({"kind":"assistant","id":r["id"],"content":text,"timestamp":r["timestamp"]})
        for tc in parse_tool_calls(r["tool_calls"]):
            items.append({"kind":"tool_call","id":r["id"],"assistantId":r["id"],"callId":tc["callId"],"name":tc["name"],"args":tc["args"],"timestamp":r["timestamp"]})
        continue
    if r["role"] == "tool":
        items.append({"kind":"tool_result","id":r["id"],"callId":r["tool_call_id"] or "","name":r["tool_name"] or "tool","content":text,"timestamp":r["timestamp"]})
        continue

print(json.dumps(items))
conn.close()
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile: normalizedProfile, sessionId }),
    );
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

export interface SshDeleteSessionsResult {
  requested: number;
  deleted: number;
}

export async function sshDeleteSessions(
  config: SshConfig,
  sessionIds: string[],
  profile?: string,
): Promise<SshDeleteSessionsResult> {
  const normalizedProfile = normalizeSshProfileName(profile);
  const ids = Array.from(
    new Set(
      (Array.isArray(sessionIds) ? sessionIds : [])
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );
  if (ids.length === 0) return { requested: 0, deleted: 0 };

  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
ids = payload.get("sessionIds") or []
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print(json.dumps({"requested": len(ids), "deleted": 0}))
    sys.exit(0)
conn = sqlite3.connect(db)
try:
    deleted = 0
    with conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        for session_id in ids:
            if "prompt_image_attachments" in tables:
                conn.execute("DELETE FROM prompt_image_attachments WHERE session_id = ?", (session_id,))
            conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            cur = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            deleted += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    print(json.dumps({"requested": len(ids), "deleted": deleted}))
finally:
    conn.close()
`;
  const out = await sshPython(
    config,
    script,
    pythonJsonInput({ profile: normalizedProfile, sessionIds: ids }),
  );
  return JSON.parse(out.trim() || `{"requested":${ids.length},"deleted":0}`);
}

export async function sshDeleteSession(
  config: SshConfig,
  sessionId: string,
  profile?: string,
): Promise<void> {
  await sshDeleteSessions(config, [sessionId], profile);
}

export async function sshSearchSessions(
  config: SshConfig,
  query: string,
  limit = 20,
  profile?: string,
): Promise<SearchResult[]> {
  const normalizedProfile = normalizeSshProfileName(profile);
  const script = `
import sqlite3, json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
query = payload.get("query") or ""
limit = max(1, min(200, int(payload.get("limit") or 20)))
db = os.path.expanduser(f"~/.hermes/profiles/{profile}/state.db" if profile and profile != "default" else "~/.hermes/state.db")
if not os.path.exists(db):
    print("[]"); sys.exit(0)
conn = sqlite3.connect(db)
conn.row_factory = sqlite3.Row
try:
    rows = conn.execute(
        "SELECT DISTINCT s.id, s.title, s.started_at, s.source, s.message_count, s.model, m.content as snippet "
        "FROM sessions s JOIN messages m ON m.session_id = s.id "
        "WHERE m.content LIKE ? ORDER BY s.started_at DESC LIMIT ?",
        (f"%{query}%", limit)
    ).fetchall()
    print(json.dumps([{"sessionId": r["id"], "title": r["title"], "startedAt": r["started_at"], "source": r["source"] or "cli", "messageCount": r["message_count"] or 0, "model": r["model"] or "", "snippet": (r["snippet"] or "")[:200]} for r in rows]))
except Exception as e:
    print("[]")
conn.close()
`;
  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile: normalizedProfile, query, limit }),
    );
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

// ── Profiles ─────────────────────────────────────────────────────────────────

export interface SshProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

export async function sshListProfiles(
  config: SshConfig,
): Promise<SshProfileInfo[]> {
  const script = `
import os, json, re
hermes_home = os.path.expanduser("~/.hermes")
profiles_dir = os.path.join(hermes_home, "profiles")
active_file = os.path.join(hermes_home, "active_profile")
name_re = re.compile(r"^[a-z0-9_][a-z0-9_-]{0,63}$")

try:
    active = open(active_file, encoding="utf-8").read().strip() or "default"
except Exception:
    active = "default"
if active != "default" and not name_re.match(active):
    active = "default"


def read_config(path):
    model, provider = "", "auto"
    config_file = os.path.join(path, "config.yaml")
    if os.path.exists(config_file):
        try:
            content = open(config_file, encoding="utf-8").read()
        except Exception:
            content = ""
        m = re.search(r'^\\s*default:\\s*["\\']?([^"\\'\\n#]+)["\\']?', content, re.M)
        if m: model = m.group(1).strip()
        p = re.search(r'^\\s*provider:\\s*["\\']?([^"\\'\\n#]+)["\\']?', content, re.M)
        if p: provider = p.group(1).strip()
    return model, provider


def count_skills(path):
    skills_dir = os.path.join(path, "skills")
    count = 0
    if os.path.isdir(skills_dir):
        for cat in os.listdir(skills_dir):
            cat_path = os.path.join(skills_dir, cat)
            if os.path.isdir(cat_path):
                for name in os.listdir(cat_path):
                    if os.path.exists(os.path.join(cat_path, name, "SKILL.md")):
                        count += 1
    return count


def gw_running(path):
    pid_file = os.path.join(path, "gateway.pid")
    if not os.path.exists(pid_file): return False
    try:
        raw = open(pid_file, encoding="utf-8").read().strip()
        if raw.startswith("{"):
            pid = int(json.loads(raw).get("pid", 0))
        else:
            pid = int(raw)
        os.kill(pid, 0)
        return True
    except Exception:
        return False


def profile_info(name, path, is_default):
    model, provider = read_config(path)
    return {
        "name": name,
        "path": path,
        "isDefault": is_default,
        "isActive": active == name,
        "model": model,
        "provider": provider,
        "hasEnv": os.path.exists(os.path.join(path, ".env")),
        "hasSoul": os.path.exists(os.path.join(path, "SOUL.md")),
        "skillCount": count_skills(path),
        "gatewayRunning": gw_running(path),
    }

profiles = [profile_info("default", hermes_home, True)]
if os.path.isdir(profiles_dir):
    for name in sorted(os.listdir(profiles_dir)):
        if name.startswith(".") or not name_re.match(name):
            continue
        path = os.path.join(profiles_dir, name)
        if os.path.isdir(path):
            profiles.append(profile_info(name, path, False))

print(json.dumps(profiles))
`;
  try {
    const out = await sshPython(config, script);
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [
      {
        name: "default",
        path: "$HOME/.hermes",
        isDefault: true,
        isActive: true,
        model: "",
        provider: "auto",
        hasEnv: false,
        hasSoul: false,
        skillCount: 0,
        gatewayRunning: false,
      },
    ];
  }
}

export async function sshCreateProfile(
  config: SshConfig,
  name: string,
  clone: boolean,
): Promise<{ success: boolean; error?: string }> {
  if (name === "default") {
    return { success: false, error: "Cannot create the default profile" };
  }
  if (!isValidNamedProfileName(name)) {
    return { success: false, error: PROFILE_NAME_ERROR };
  }

  const script = `
import json, os, shutil, sys
payload = json.loads(sys.stdin.read() or "{}")
name = payload["name"]
clone = bool(payload.get("clone"))
hermes_home = os.path.expanduser("~/.hermes")
profiles_dir = os.path.join(hermes_home, "profiles")
target = os.path.join(profiles_dir, name)
if os.path.exists(target):
    raise SystemExit(f"Profile '{name}' already exists at {target}")
os.makedirs(profiles_dir, exist_ok=True)
if clone:
    def ignore(src, names):
        ignored = {"profiles", "active_profile", "gateway.pid", "gateway_state.json"}
        if os.path.abspath(src) == os.path.abspath(hermes_home):
            return ignored.intersection(names)
        return set()
    shutil.copytree(hermes_home, target, ignore=ignore)
else:
    os.makedirs(target, exist_ok=False)
print(json.dumps({"success": True, "path": target}))
`;

  try {
    await sshPython(config, script, pythonJsonInput({ name, clone }));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Command failed",
    };
  }
}

export async function sshDeleteProfile(
  config: SshConfig,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  if (name === "default") {
    return { success: false, error: "Cannot delete the default profile" };
  }
  if (!isValidNamedProfileName(name)) {
    return { success: false, error: PROFILE_NAME_ERROR };
  }

  const script = `
import json, os, shutil, sys
payload = json.loads(sys.stdin.read() or "{}")
name = payload["name"]
target = os.path.join(os.path.expanduser("~/.hermes"), "profiles", name)
if os.path.isdir(target):
    shutil.rmtree(target)
print(json.dumps({"success": True}))
`;

  try {
    await sshPython(config, script, pythonJsonInput({ name }));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Command failed",
    };
  }
}

export async function sshSetActiveProfile(
  config: SshConfig,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isValidProfileName(name)) {
    return { success: false, error: PROFILE_NAME_ERROR };
  }

  const script = `
import json, os, sys
payload = json.loads(sys.stdin.read() or "{}")
name = payload["name"]
hermes_home = os.path.expanduser("~/.hermes")
if name != "default":
    target = os.path.join(hermes_home, "profiles", name)
    if not os.path.isdir(target):
        raise SystemExit(f"Profile '{name}' does not exist at {target}")
os.makedirs(hermes_home, exist_ok=True)
with open(os.path.join(hermes_home, "active_profile"), "w", encoding="utf-8") as fh:
    fh.write(name + "\\n")
print(json.dumps({"success": True}))
`;

  try {
    await sshPython(config, script, pythonJsonInput({ name }));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Command failed",
    };
  }
}

// ── Gateway ───────────────────────────────────────────────────────────────────
//
// In SSH mode the remote gateway may be owned by a systemd `hermes.service`
// unit — the standard VPS installer sets this up. Starting our own detached
// `nohup` gateway then strands that unit in a restart crash-loop (issue
// #285). Each operation below therefore asks the remote, in a single shell
// `if`, whether such a unit is installed and routes the request through
// systemd when it is — one SSH round-trip, atomic decision. The command
// strings are built by the exported helpers below so they can be unit
// tested without a live host.

/**
 * Shell test that succeeds when a systemd `hermes.service` unit file is
 * installed on the remote. Safe on hosts without systemd: a missing
 * `systemctl` yields empty output, so the test simply fails and callers
 * fall back to the plain (`nohup` / pidfile) path.
 */
const SYSTEMD_HERMES_UNIT_TEST =
  "systemctl list-unit-files hermes.service 2>/dev/null | " +
  "grep -q '^hermes\\.service'";

/**
 * Command to start the remote gateway (issue #285). When a systemd
 * `hermes.service` exists it owns the lifecycle, so the request is handed
 * to systemd — `hermes.service` is a system unit, so `sudo` is tried first,
 * then a direct call for when the SSH user is root. If neither works the
 * command does nothing on purpose: an unmanaged `nohup` orphan that
 * crash-loops the systemd unit is worse than a gateway that simply did not
 * start (the status check will then report it as down). The detached
 * `nohup` start is used only when there is no unit to collide with.
 */
export function buildGatewayStartCommand(): string {
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `sudo -n systemctl start hermes.service 2>/dev/null || ` +
    `systemctl start hermes.service 2>/dev/null || true; ` +
    `else ` +
    `(nohup hermes gateway start > $HOME/.hermes/gateway.log 2>&1 &); ` +
    `fi`
  );
}

/**
 * Command to stop the remote gateway (issue #285). Routed through systemd
 * when a `hermes.service` unit exists, so the unit is left cleanly inactive
 * rather than the desktop killing a process systemd would just restart;
 * otherwise it falls back to `hermes gateway stop` and, last resort, the
 * recorded pid.
 */
export function buildGatewayStopCommand(): string {
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `sudo -n systemctl stop hermes.service 2>/dev/null || ` +
    `systemctl stop hermes.service 2>/dev/null || true; ` +
    `else ` +
    `hermes gateway stop 2>/dev/null || ` +
    `(if [ -f $HOME/.hermes/gateway.pid ]; then ` +
    `pid=$(python3 -c "import json; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d['pid'] if isinstance(d,dict) else d)" 2>/dev/null); ` +
    `[ -n "$pid" ] && kill $pid 2>/dev/null; fi); true; ` +
    `fi`
  );
}

/**
 * Command to report remote gateway state (issue #285). For a systemd-managed
 * gateway this is the unit's `is-active` state (`active` when up); otherwise
 * it is a liveness check on the recorded pid. Prints `active` or `running`
 * when up, anything else when not.
 */
export function buildGatewayStatusCommand(): string {
  return (
    `if ${SYSTEMD_HERMES_UNIT_TEST}; then ` +
    `systemctl is-active hermes.service 2>/dev/null || true; ` +
    `else ` +
    `if [ -f $HOME/.hermes/gateway.pid ]; then ` +
    `pid=$(python3 -c "import json,sys; d=json.load(open('$HOME/.hermes/gateway.pid')); print(d.get('pid',d) if isinstance(d,dict) else d)" 2>/dev/null || cat $HOME/.hermes/gateway.pid); ` +
    `kill -0 $pid 2>/dev/null && echo "running" || echo "stopped"; ` +
    `else echo "stopped"; fi; ` +
    `fi`
  );
}

export async function sshGatewayStatus(config: SshConfig): Promise<boolean> {
  try {
    const out = await sshExec(config, buildGatewayStatusCommand());
    const state = out.trim();
    return state === "running" || state === "active";
  } catch {
    return false;
  }
}

export async function sshStartGateway(config: SshConfig): Promise<void> {
  try {
    await sshExec(config, buildGatewayStartCommand());
  } catch {
    // best effort
  }
}

export async function sshStopGateway(config: SshConfig): Promise<void> {
  try {
    await sshExec(config, buildGatewayStopCommand());
  } catch {
    // best effort
  }
}

// ── Remote API key (for chat auth through SSH tunnel) ─────────────────────────

export async function sshReadRemoteApiKey(config: SshConfig): Promise<string> {
  try {
    const env = await sshReadEnv(config);
    return env["API_SERVER_KEY"] || "";
  } catch {
    return "";
  }
}

// ── Versions ──────────────────────────────────────────────────────────────────

export async function sshGetHermesVersion(
  config: SshConfig,
): Promise<string | null> {
  try {
    // Use the venv-probe path so the version string is the real multi-line
    // output (Engine / Released / Python / OpenAI SDK) the Settings UI
    // parses, not an empty string when the /usr/local/bin/hermes wrapper
    // refuses to run as the hermes user. See buildRemoteHermesCmd notes.
    const out = await sshExec(
      config,
      buildRemoteHermesCmd(["--version"], " 2>/dev/null"),
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

// Run a Hermes Cron CLI subcommand over SSH and return a structured result.
export interface SshCronResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  stdout?: string;
}

export async function sshRunCron<T = unknown>(
  config: SshConfig,
  args: string[],
  opts: { profile?: string; parseJson?: boolean; timeoutMs?: number } = {},
): Promise<SshCronResult<T>> {
  const cliArgs: string[] = [];
  pushProfileArg(cliArgs, opts.profile);
  cliArgs.push("cron", ...args);
  const cmd = buildRemoteHermesCmd(cliArgs);
  try {
    const stdout = await sshExec(
      config,
      cmd,
      undefined,
      opts.timeoutMs ?? 20000,
    );
    if (opts.parseJson) {
      try {
        return { success: true, data: JSON.parse(stdout) as T, stdout };
      } catch (err) {
        return {
          success: false,
          error: `Failed to parse JSON from remote 'hermes cron': ${(err as Error).message}`,
          stdout,
        };
      }
    }
    return { success: true, stdout };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Remote cron command failed",
    };
  }
}

export async function sshReadCronJobsFile(
  config: SshConfig,
  profile?: string,
): Promise<unknown> {
  const script = `
import json, os, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
path = os.path.expanduser(f"~/.hermes/profiles/{profile}/cron/jobs.json" if profile and profile != "default" else "~/.hermes/cron/jobs.json")
try:
    with open(path, "r", encoding="utf-8") as f:
        print(json.dumps(json.load(f)))
except FileNotFoundError:
    print(json.dumps({"jobs": []}))
`;
  const out = await sshPython(config, script, pythonJsonInput({ profile }));
  return JSON.parse(out.trim() || '{"jobs": []}');
}

// Run a Hermes Kanban CLI subcommand over SSH and return a structured result.
export interface SshKanbanResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  stdout?: string;
}

export async function sshRunKanban<T = unknown>(
  config: SshConfig,
  args: string[],
  opts: { profile?: string; parseJson?: boolean; timeoutMs?: number } = {},
): Promise<SshKanbanResult<T>> {
  const cliArgs: string[] = [];
  pushProfileArg(cliArgs, opts.profile);
  cliArgs.push("kanban", ...args);
  const cmd = buildRemoteHermesCmd(cliArgs);
  try {
    const stdout = await sshExec(
      config,
      cmd,
      undefined,
      opts.timeoutMs ?? 20000,
    );
    if (opts.parseJson) {
      try {
        return { success: true, data: JSON.parse(stdout) as T, stdout };
      } catch (err) {
        return {
          success: false,
          error: `Failed to parse JSON from remote 'hermes kanban': ${(err as Error).message}`,
          stdout,
        };
      }
    }
    return { success: true, stdout };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || "Remote kanban command failed",
    };
  }
}

// ── Claw3D HQ board (read-only) ───────────────────────────────────────────────
//
// Claw3D ("hermes-office") maintains its own headquarters task board independent
// of `hermes kanban`. It stores tasks at
// `<state-dir>/claw3d/task-manager/tasks.json`, where <state-dir> resolves to
// `~/.openclaw` (new) or `~/.clawdbot` / `~/.moltbot` (legacy) — see
// hermes-office/src/lib/clawdbot/paths.ts. We surface it as a virtual,
// read-only second board in the desktop's Kanban tab so the Claw3D HQ cards
// are visible alongside the agent dispatcher's own board.

interface Claw3dSharedTaskRecord {
  id: string;
  title: string;
  description?: string;
  status?: string;
  source?: string;
  assignedAgentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  channel?: string | null;
  notes?: unknown;
  isArchived?: boolean;
}

// Claw3D's TaskBoardStatus → desktop kanban column. Claw3D has no "triage" or
// "ready" semantics, so `review` (awaiting attention) lands in "ready" and
// `in_progress` maps to "running". Everything else is straight-through.
const CLAW3D_STATUS_MAP: Record<string, KanbanTask["status"]> = {
  todo: "todo",
  in_progress: "running",
  blocked: "blocked",
  review: "ready",
  done: "done",
};

function parseIsoToEpochSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function mapClaw3dTaskToKanbanTask(raw: Claw3dSharedTaskRecord): KanbanTask {
  const status = (raw.status && CLAW3D_STATUS_MAP[raw.status]) || "todo";
  const createdAt = parseIsoToEpochSeconds(raw.createdAt);
  return {
    id: raw.id,
    title: raw.title,
    body: raw.description?.trim() || null,
    assignee: raw.assignedAgentId?.trim() || null,
    status,
    priority: 0,
    tenant: null,
    workspace_kind: "scratch",
    workspace_path: null,
    created_by: raw.source || null,
    created_at: createdAt,
    started_at: null,
    completed_at:
      status === "done" ? parseIsoToEpochSeconds(raw.updatedAt) : null,
    result: null,
    skills: [],
    max_retries: null,
  };
}

// Candidate state dirs mirror hermes-office's resolveStateDir() precedence:
// new `.openclaw` first, then legacy `.clawdbot` / `.moltbot`.
const CLAW3D_TASKS_PATHS = [
  "~/.openclaw/claw3d/task-manager/tasks.json",
  "~/.clawdbot/claw3d/task-manager/tasks.json",
  "~/.moltbot/claw3d/task-manager/tasks.json",
];

export interface SshClaw3dHqResult {
  success: boolean;
  tasks?: KanbanTask[];
  error?: string;
  source?: string; // resolved remote path
}

export async function sshListClaw3dHqTasks(
  config: SshConfig,
): Promise<SshClaw3dHqResult> {
  for (const remotePath of CLAW3D_TASKS_PATHS) {
    let raw = "";
    try {
      raw = await sshReadFile(config, remotePath);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw) as { tasks?: unknown };
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      const mapped = tasks
        .filter(
          (t): t is Claw3dSharedTaskRecord =>
            Boolean(t) &&
            typeof t === "object" &&
            typeof (t as Claw3dSharedTaskRecord).id === "string" &&
            typeof (t as Claw3dSharedTaskRecord).title === "string",
        )
        .filter((t) => !t.isArchived)
        .map(mapClaw3dTaskToKanbanTask);
      return { success: true, tasks: mapped, source: remotePath };
    } catch (err) {
      return {
        success: false,
        error: `Failed to parse Claw3D tasks.json: ${(err as Error).message}`,
      };
    }
  }
  // No file found at any candidate path — that's fine, just means the user
  // hasn't run Claw3D's HQ board yet. Return empty rather than erroring so
  // the renderer can still show an empty HQ board placeholder.
  return { success: true, tasks: [] };
}

// ── Logs ──────────────────────────────────────────────────────────────────────

export async function sshReadLogs(
  config: SshConfig,
  logFile?: string,
  lines = 300,
): Promise<{ content: string; path: string }> {
  const allowed = ["agent.log", "errors.log", "gateway.log"];
  const file = logFile && allowed.includes(logFile) ? logFile : "agent.log";
  const remotePath = `$HOME/.hermes/logs/${file}`;
  try {
    const safeLines = Math.max(
      1,
      Math.min(5000, Number.parseInt(String(lines), 10) || 300),
    );
    const content = await sshExec(
      config,
      `bash -c 'case "$2" in "~/"*) p="$HOME/\${2#~/}" ;; "\\$HOME/"*) p="$HOME/\${2#\\$HOME/}" ;; *) p="$2" ;; esac; tail -n "$1" -- "$p" 2>/dev/null || echo ""' -- ${shellQuote(String(safeLines))} ${shellQuote(remotePath)}`,
    );
    return { content: content.trim(), path: `~/.hermes/logs/${file}` };
  } catch {
    return { content: "", path: `~/.hermes/logs/${file}` };
  }
}

// ── Platform toggles (Gateway page) ──────────────────────────────────────────

const SSH_SUPPORTED_PLATFORMS = [
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "signal",
  "matrix",
  "mattermost",
  "email",
  "sms",
  "bluebubbles",
  "dingtalk",
  "feishu",
  "wecom",
  "wecom_callback",
  "weixin",
  "qqbot",
  "yuanbao",
  "api_server",
  "webhook",
  "webhooks",
  "homeassistant",
  "home_assistant",
];

// Map from app platform keys to gateway_state.json keys (where they differ)
const PLATFORM_STATE_KEY: Record<string, string> = {
  home_assistant: "homeassistant",
  webhooks: "webhook",
};

function readRemotePlatformOverride(
  content: string,
  platform: string,
): boolean | null {
  const lines = content.split(/\r?\n/);
  let inPlatforms = false;
  let inTarget = false;
  for (const line of lines) {
    if (!inPlatforms) {
      if (/^platforms:\s*$/.test(line)) inPlatforms = true;
      continue;
    }
    if (/^[^\s].+:\s*$/.test(line)) break;
    const platformMatch = line.match(/^[ \t]{2}([A-Za-z0-9_-]+):\s*$/);
    if (platformMatch) {
      inTarget = platformMatch[1] === platform;
      continue;
    }
    if (inTarget) {
      const enabled = line.match(/^[ \t]{4}enabled:\s*(true|false)\b/);
      if (enabled) return enabled[1] === "true";
    }
  }
  return null;
}

export async function sshGetPlatformEnabled(
  config: SshConfig,
  profile?: string,
): Promise<Record<string, boolean>> {
  const result = Object.fromEntries(
    SSH_SUPPORTED_PLATFORMS.map((p) => [p, false]),
  ) as Record<string, boolean>;

  try {
    const raw = await sshReadFile(config, "$HOME/.hermes/gateway_state.json");
    if (raw.trim()) {
      const state = JSON.parse(raw);
      const platforms = state.platforms || {};
      for (const platform of SSH_SUPPORTED_PLATFORMS) {
        const stateKey = PLATFORM_STATE_KEY[platform] || platform;
        const p = platforms[stateKey];
        if (p)
          result[platform] = p.state === "connected" || p.state === "running";
      }
    }
  } catch {
    // Runtime gateway state is advisory; config intent below is the UI source
    // of truth for toggles in SSH tunnel mode.
  }

  try {
    const content = await sshReadFile(config, remoteConfigPath(profile));
    for (const platform of SSH_SUPPORTED_PLATFORMS) {
      const override = readRemotePlatformOverride(content, platform);
      if (override !== null) result[platform] = override;
    }
  } catch {
    // Keep runtime/default result.
  }

  return result;
}

export async function sshSetPlatformEnabled(
  config: SshConfig,
  platform: string,
  enabled: boolean,
  profile?: string,
): Promise<void> {
  if (!SSH_SUPPORTED_PLATFORMS.includes(platform)) return;
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;

  let updated = content;
  const existingRe = new RegExp(
    `^([ \\t]+${platform}:\\s*\\n[ \\t]+enabled:\\s*)(?:true|false)`,
    "m",
  );

  if (existingRe.test(updated)) {
    updated = updated.replace(existingRe, `$1${enabled}`);
  } else {
    const platformsIdx = updated.indexOf("\nplatforms:");
    if (platformsIdx === -1) {
      updated += `\nplatforms:\n  ${platform}:\n    enabled: ${enabled}\n`;
    } else {
      const after = updated.substring(platformsIdx + 1);
      const lines = after.split("\n");
      let insertOffset = platformsIdx + 1 + lines[0].length + 1;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "" || /^\s/.test(lines[i]))
          insertOffset += lines[i].length + 1;
        else break;
      }
      const entry = `  ${platform}:\n    enabled: ${enabled}\n`;
      updated =
        updated.substring(0, insertOffset) +
        entry +
        updated.substring(insertOffset);
    }
  }

  await sshWriteFile(config, configPath, updated);
}

// ── Cached sessions (Sessions screen uses listCachedSessions) ─────────────────

export async function sshListCachedSessions(
  config: SshConfig,
  limit = 50,
  offset = 0,
): Promise<CachedSession[]> {
  void offset;
  const sessions = await sshListSessions(config, limit, 0);
  return sessions.map((s) => ({
    id: s.id,
    title: s.title || s.id,
    startedAt: s.startedAt,
    source: s.source,
    messageCount: s.messageCount,
    model: s.model,
  }));
}

// ── Doctor / diagnostics ──────────────────────────────────────────────────────

// Build a remote shell command that invokes the Hermes CLI, bypassing the
// common `/usr/local/bin/hermes` sudo-wrapper that production installs ship.
// That wrapper does `sudo -u hermes <venv>/bin/hermes "$@"`, and the sudoers
// policy refuses to let the hermes service user run it as itself ("Sorry,
// user hermes is not allowed to execute … as hermes"). The wrapper writes the
// refusal to stderr and exits non-zero, breaking `hermes doctor`,
// `hermes update`, `hermes dump`, and `hermes --version` when called over
// SSH as the hermes user.
//
// Probe the well-known venv install paths first; fall back to bare `hermes`
// on PATH only if none of those exist, preserving the old behavior for
// non-installer deployments.
//
// Each install base is probed with both `.venv` and `venv` — the venv
// directory name is not fixed, and an install that uses the un-dotted
// `venv` was otherwise invisible even when fully working (issue #284).
// `~/.local/bin/hermes` is also probed, where `pip install --user` flows
// place a wrapper. `command -v hermes` alone is not enough: the desktop's
// non-interactive SSH does not source `~/.profile`/`~/.bashrc`, so any
// PATH additions made there are not visible.
//
// Exported for unit testing the probe list without a live remote host.
export function buildRemoteHermesCmd(args: string[], extraShell = ""): string {
  const candidates = [
    "$HOME/hermes-agent/.venv/bin/hermes",
    "$HOME/hermes-agent/venv/bin/hermes",
    "$HOME/.hermes/hermes-agent/.venv/bin/hermes",
    "$HOME/.hermes/hermes-agent/venv/bin/hermes",
    "/opt/hermes/hermes-agent/.venv/bin/hermes",
    "/opt/hermes/hermes-agent/venv/bin/hermes",
    "$HOME/.local/bin/hermes",
  ];
  const quotedArgs = args.map((a) => shellQuote(a)).join(" ");
  const probe = candidates
    .map((p) => `[ -x ${p} ] && exec ${p} ${quotedArgs}${extraShell}`)
    .join("; ");
  const script = `${probe}; command -v hermes >/dev/null && exec hermes ${quotedArgs}${extraShell}; echo "ERR: hermes CLI not found on remote PATH or in any known venv location" >&2; exit 1`;
  return `bash -c ${shellQuote(script)}`;
}

export async function sshRunDoctor(config: SshConfig): Promise<string> {
  try {
    // `hermes doctor` writes diagnostics to stdout; redirect stderr too so
    // any wrapper-refusal output is visible to the user rather than silently
    // dropped.
    const out = await sshExec(
      config,
      buildRemoteHermesCmd(["doctor"], " 2>&1"),
    );
    return out.trim() || "No output from doctor.";
  } catch (err) {
    return `SSH doctor failed: ${(err as Error).message}`;
  }
}

export async function sshRunUpdate(config: SshConfig): Promise<void> {
  await sshExec(
    config,
    buildRemoteHermesCmd(["update"], " 2>&1"),
    undefined,
    120000,
  );
}

export async function sshRunDump(config: SshConfig): Promise<string> {
  try {
    const out = await sshExec(
      config,
      buildRemoteHermesCmd(["dump"], " 2>&1"),
      undefined,
      60000,
    );
    return out.trim() || "No output from dump.";
  } catch (err) {
    return `SSH dump failed: ${(err as Error).message}`;
  }
}

export async function sshDiscoverMemoryProviders(
  config: SshConfig,
  profile?: string,
): Promise<MemoryProviderInfo[]> {
  const activeProvider =
    (await sshGetConfigValue(config, "memory.provider", profile)) || "";
  const script = `
import json, os
known = {
    "honcho": {"description": "memory.providers.honcho", "envVars": ["HONCHO_API_KEY"]},
    "hindsight": {"description": "memory.providers.hindsight", "envVars": ["HINDSIGHT_API_KEY", "HINDSIGHT_API_URL", "HINDSIGHT_BANK_ID"]},
    "mem0": {"description": "memory.providers.mem0", "envVars": ["MEM0_API_KEY"]},
    "retaindb": {"description": "memory.providers.retaindb", "envVars": ["RETAINDB_API_KEY"]},
    "supermemory": {"description": "memory.providers.supermemory", "envVars": ["SUPERMEMORY_API_KEY"]},
    "holographic": {"description": "memory.providers.holographic", "envVars": []},
    "openviking": {"description": "memory.providers.openviking", "envVars": ["OPENVIKING_ENDPOINT", "OPENVIKING_API_KEY"]},
    "byterover": {"description": "memory.providers.byterover", "envVars": ["BRV_API_KEY"]},
}
roots = [
    os.path.expanduser("~/.hermes/plugins/memory"),
    os.path.expanduser("~/hermes/plugins/memory"),
    os.path.expanduser("~/hermes-agent/plugins/memory"),
]
names = set(known)
for root in roots:
    if os.path.isdir(root):
        for name in os.listdir(root):
            if not name.startswith("_") and os.path.isdir(os.path.join(root, name)):
                names.add(name)
result = []
for name in sorted(names):
    meta = known.get(name, {"description": f"memory.providers.{name}", "envVars": []})
    result.append({
        "name": name,
        "description": meta["description"],
        "envVars": meta["envVars"],
        "installed": True,
        "active": name == ${JSON.stringify(activeProvider)},
    })
print(json.dumps(result))
`;
  try {
    const out = await sshPython(config, script);
    return JSON.parse(out.trim() || "[]");
  } catch {
    return [];
  }
}

// ── Discover registry over SSH ────────────────────────────────────────────────

const REGISTRY_REPO = "fathah/hermes-registry";
const REGISTRY_BRANCH = "main";
const REGISTRY_RAW_BASE = `https://raw.githubusercontent.com/${REGISTRY_REPO}/refs/heads/${REGISTRY_BRANCH}`;
const TREE_URL = `https://api.github.com/repos/${REGISTRY_REPO}/git/trees/${REGISTRY_BRANCH}?recursive=1`;

type SshRegistryInstallResult = { success: boolean; error?: string };
type RegistryManifest = {
  transport?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

let registryTreeCache: { at: number; blobs: string[] } | null = null;
const REGISTRY_TREE_TTL_MS = 5 * 60 * 1000;

function registrySafePathPart(value: string, label: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

async function fetchRegistryManifest(
  path: string,
): Promise<RegistryManifest | null> {
  const res = await fetch(`${REGISTRY_RAW_BASE}/${path}/manifest.json`);
  if (!res.ok) return null;
  return (await res.json()) as RegistryManifest;
}

async function listRegistryFolderFiles(folder: string): Promise<string[]> {
  if (
    !registryTreeCache ||
    Date.now() - registryTreeCache.at > REGISTRY_TREE_TTL_MS
  ) {
    const res = await fetch(TREE_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`Tree fetch failed (${res.status})`);
    const json = (await res.json()) as {
      tree?: Array<{ path: string; type: string }>;
    };
    registryTreeCache = {
      at: Date.now(),
      blobs: (json.tree ?? [])
        .filter((b) => b.type === "blob")
        .map((b) => b.path),
    };
  }
  const prefix = `${folder}/`;
  return registryTreeCache.blobs.filter((path) => path.startsWith(prefix));
}

function yamlScalar(value: string): string {
  return /[:#{}[\],&*?|<>=!%@`"']/.test(value) || value.trim() !== value
    ? JSON.stringify(value)
    : value;
}

function renderRegistryMcpYaml(id: string, m: RegistryManifest): string {
  const lines: string[] = [`  ${id}:`];
  const remote = !!m.url || m.transport === "http" || m.transport === "sse";
  if (remote) {
    if (m.url) lines.push(`    url: ${yamlScalar(m.url)}`);
    if (m.transport === "sse") lines.push("    transport: sse");
    if (m.headers && Object.keys(m.headers).length) {
      lines.push("    headers:");
      for (const [k, v] of Object.entries(m.headers)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  } else {
    if (m.command) lines.push(`    command: ${yamlScalar(m.command)}`);
    if (m.args?.length) {
      lines.push("    args:");
      for (const arg of m.args)
        lines.push(`      - ${yamlScalar(String(arg))}`);
    }
    if (m.env && Object.keys(m.env).length) {
      lines.push("    env:");
      for (const [k, v] of Object.entries(m.env)) {
        lines.push(`      ${k}: ${yamlScalar(String(v))}`);
      }
    }
  }
  lines.push("    enabled: true");
  return `${lines.join("\n")}\n`;
}

function listMcpNamesFromConfig(content: string): string[] {
  const block = content.match(/^mcp_servers:\s*\n([\s\S]*?)(?=^[^\s].*:|$)/m);
  if (!block) return [];
  const names: string[] = [];
  for (const match of block[1].matchAll(/^[ ]{2}([A-Za-z0-9_.-]+):\s*$/gm)) {
    names.push(match[1]);
  }
  return names.sort();
}

async function sshInstallRegistryFolder(
  config: SshConfig,
  repoFolder: string,
  remoteDest: string,
): Promise<SshRegistryInstallResult> {
  const files = await listRegistryFolderFiles(repoFolder);
  if (files.length === 0)
    return { success: false, error: "No files found for this entry" };
  for (const file of files) {
    const rel = file.slice(repoFolder.length + 1);
    const res = await fetch(`${REGISTRY_RAW_BASE}/${file}`);
    if (!res.ok) return { success: false, error: `Fetch failed: ${rel}` };
    await sshWriteFile(config, `${remoteDest}/${rel}`, await res.text());
  }
  return { success: true };
}

async function sshInstallRegistryMcp(
  config: SshConfig,
  item: RegistryItem,
  profile?: string,
): Promise<SshRegistryInstallResult> {
  if (!item.path) return { success: false, error: "MCP entry has no path" };
  const manifest = await fetchRegistryManifest(item.path);
  if (!manifest || (!manifest.url && !manifest.command)) {
    return { success: false, error: "MCP manifest has no connection config" };
  }
  const configPath = remoteConfigPath(profile);
  let content = await sshReadFile(config, configPath);
  if (listMcpNamesFromConfig(content).includes(item.id)) {
    return { success: false, error: "Already configured" };
  }
  const block = renderRegistryMcpYaml(
    registrySafePathPart(item.id, "MCP id"),
    manifest,
  );
  if (/^mcp_servers:\s*\n/m.test(content)) {
    content = content.replace(/^mcp_servers:\s*\n/m, (m) => m + block);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += `mcp_servers:\n${block}`;
  }
  await sshWriteFile(config, configPath, content);
  return { success: true };
}

async function sshInstallRegistrySkillFolder(
  config: SshConfig,
  item: RegistryItem,
  profile?: string,
): Promise<SshRegistryInstallResult> {
  if (!item.path) return { success: false, error: "Skill entry has no path" };
  const category = registrySafePathPart(
    item.category || "uncategorized",
    "skill category",
  );
  const id = registrySafePathPart(item.id, "skill id");
  return sshInstallRegistryFolder(
    config,
    item.path,
    `${remoteHermesHomeTilde(profile)}/skills/${category}/${id}`,
  );
}

async function sshInstallRegistryWorkflow(
  config: SshConfig,
  item: RegistryItem,
  profile?: string,
): Promise<SshRegistryInstallResult> {
  if (!item.path)
    return { success: false, error: "Workflow entry has no path" };
  const id = registrySafePathPart(item.id, "workflow id");
  return sshInstallRegistryFolder(
    config,
    item.path,
    `${remoteHermesHomeTilde(profile)}/workflows/${id}`,
  );
}

export async function sshInstallRegistryItem(
  config: SshConfig,
  kind: RegistryKind,
  item: RegistryItem,
  profile?: string,
): Promise<SshRegistryInstallResult> {
  try {
    switch (kind) {
      case "skills":
        return item.path
          ? await sshInstallRegistrySkillFolder(config, item, profile)
          : sshInstallSkill(config, item.source || item.id, profile);
      case "mcps":
        return await sshInstallRegistryMcp(config, item, profile);
      case "agents":
        await sshCreateProfile(config, item.id, true);
        return { success: true };
      case "workflows":
        return await sshInstallRegistryWorkflow(config, item, profile);
      default:
        return { success: false, error: "Unknown item kind" };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Install failed",
    };
  }
}

async function sshListWorkflowNames(
  config: SshConfig,
  profile?: string,
): Promise<string[]> {
  const script = `
import json, os
base = os.path.expanduser("${remoteHermesHomeTilde(profile)}/workflows")
if not os.path.isdir(base):
    print("[]")
else:
    names = []
    for name in os.listdir(base):
        names.append(__import__("re").sub(r"[.](js|mjs|ts|json)$", "", name))
    print(json.dumps(sorted(set(names))))
`;
  const out = await sshPython(config, script);
  return JSON.parse(out.trim() || "[]") as string[];
}

export async function sshListInstalledRegistry(
  config: SshConfig,
  profile?: string,
): Promise<InstalledRegistry & { agents: string[] }> {
  const skills = await sshListInstalledSkills(config, profile).catch(() => []);
  const configContent = await sshReadFile(
    config,
    remoteConfigPath(profile),
  ).catch(() => "");
  const workflows = await sshListWorkflowNames(config, profile).catch(() => []);
  const profiles = profile ? [] : await sshListProfiles(config).catch(() => []);
  return {
    skills: skills.map((s) => s.name),
    mcps: listMcpNamesFromConfig(configContent),
    workflows,
    agents: profiles.map((p) => p.name).filter((name) => name !== "default"),
  };
}

// ── Models library ─────────────────────────────────────────────────────────────

export async function sshListModels(config: SshConfig): Promise<SavedModel[]> {
  try {
    const raw = await sshReadFile(config, "$HOME/.hermes/models.json");
    if (raw.trim()) return JSON.parse(raw);
  } catch {
    // no models.json on remote yet
  }
  return [];
}

export async function sshSaveModels(
  config: SshConfig,
  models: SavedModel[],
): Promise<void> {
  await sshWriteFile(
    config,
    "$HOME/.hermes/models.json",
    JSON.stringify(models, null, 2),
  );
}

// Mirror the local CRUD helpers in models.ts against the remote
// ~/.hermes/models.json. Each operation does a full read/mutate/write so the
// SSH cost is the same as a manual edit — there is no remote API to call
// instead, and the file is small (a few KB at most).

function randomId(): string {
  // RFC4122-ish v4 UUID without pulling in crypto.randomUUID, which is fine
  // here because IDs only need to be unique within models.json.
  const hex = (n: number): string =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

export async function sshAddModel(
  config: SshConfig,
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
): Promise<SavedModel> {
  const models = await sshListModels(config);
  const existing = models.find(
    (m) => m.model === model && m.provider === provider,
  );
  if (existing) return existing;
  const entry: SavedModel = {
    id: randomId(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    createdAt: Date.now(),
  };
  await sshSaveModels(config, [...models, entry]);
  return entry;
}

export async function sshRemoveModel(
  config: SshConfig,
  id: string,
): Promise<boolean> {
  const models = await sshListModels(config);
  const filtered = models.filter((m) => m.id !== id);
  if (filtered.length === models.length) return false;
  await sshSaveModels(config, filtered);
  return true;
}

export async function sshUpdateModel(
  config: SshConfig,
  id: string,
  fields: Partial<Pick<SavedModel, "name" | "provider" | "model" | "baseUrl">>,
): Promise<boolean> {
  const models = await sshListModels(config);
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  models[idx] = { ...models[idx], ...fields };
  await sshSaveModels(config, models);
  return true;
}
