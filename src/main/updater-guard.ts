/**
 * ORION updater guard.
 *
 * ORION-patched desktop builds must not replace themselves with upstream
 * Hermes Desktop artifacts because those releases do not contain the ORION VPS
 * control-plane patches. Keep the switch in main-process code so renderer code
 * only sees normal updater notifications/errors.
 */
export const ORION_PATCHED_BUILD = true;

export const ORION_UPDATER_BLOCKED_MESSAGE =
  "This is an ORION-patched Hermes Desktop build. Upstream release downloads " +
  "are notification-only to avoid overwriting ORION patches. Ask ORION to sync upstream, " +
  "reapply fork patches, rebuild the .deb, and relaunch the desktop app.";

export function isOrionUpdaterGuardEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return ORION_PATCHED_BUILD && env.HERMES_ORION_UPDATER_GUARD !== "0";
}

export function getOrionUpdaterBlockedMessage(): string {
  return ORION_UPDATER_BLOCKED_MESSAGE;
}


export interface OrionBuildStatus {
  isOrionPatchedBuild: boolean;
  manualUpdates: boolean;
  label: string;
  detail: string;
  upstreamVersion?: string | null;
}

export function getOrionBuildStatus(
  upstreamVersion?: string | null,
): OrionBuildStatus {
  return {
    isOrionPatchedBuild: ORION_PATCHED_BUILD,
    manualUpdates: isOrionUpdaterGuardEnabled(),
    label: "ORION build",
    detail: isOrionUpdaterGuardEnabled()
      ? upstreamVersion
        ? `Ask ORION to sync upstream ${upstreamVersion}, rebuild the .deb, and relaunch.`
        : "Ask ORION to sync upstream, rebuild the .deb, and relaunch."
      : "Upstream desktop auto-updates are enabled for this process.",
    upstreamVersion: upstreamVersion ?? null,
  };
}
