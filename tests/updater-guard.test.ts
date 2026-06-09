import { describe, expect, it } from "vitest";
import {
  getOrionUpdaterBlockedMessage,
  isOrionUpdaterGuardEnabled,
  ORION_PATCHED_BUILD,
} from "../src/main/updater-guard";

describe("ORION updater guard", () => {
  it("is enabled for ORION-patched builds by default", () => {
    expect(ORION_PATCHED_BUILD).toBe(true);
    expect(isOrionUpdaterGuardEnabled({})).toBe(true);
  });

  it("can be disabled to preserve upstream updater behaviour", () => {
    expect(
      isOrionUpdaterGuardEnabled({ HERMES_ORION_UPDATER_GUARD: "0" }),
    ).toBe(false);
  });

  it("returns clear rebuild instructions for blocked downloads", () => {
    const message = getOrionUpdaterBlockedMessage();

    expect(message).toContain("ORION-patched");
    expect(message).toContain("notification-only");
    expect(message).toContain("Rebuild orion-vps-control-plane");
  });
});
