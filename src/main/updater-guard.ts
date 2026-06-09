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
  "are notification-only to avoid overwriting ORION patches. Rebuild " +
  "orion-vps-control-plane to update this build.";

export function isOrionUpdaterGuardEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return ORION_PATCHED_BUILD && env.HERMES_ORION_UPDATER_GUARD !== "0";
}

export function getOrionUpdaterBlockedMessage(): string {
  return ORION_UPDATER_BLOCKED_MESSAGE;
}
