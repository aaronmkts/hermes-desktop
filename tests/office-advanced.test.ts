import { describe, expect, it } from "vitest";

import enOffice from "../src/shared/i18n/locales/en/office";
import {
  OFFICE_EXPERIENCE_BOUNDARY,
  getOfficeExperienceCopy,
} from "../src/shared/office-boundary";

describe("Office advanced/external Claw3D boundary", () => {
  it("makes the main Office copy describe ORION Office as built in", () => {
    expect(enOffice.title).toBe("ORION Office");
    expect(enOffice.subtitle).toContain("built-in 3D workspace");
    expect(enOffice.subtitle).not.toMatch(/Claw3D|hermes-office/i);
    expect(enOffice.setupDesc1).toContain("built-in 3D workspace");
    expect(enOffice.setupDesc1).not.toMatch(/requires? Claw3D|download.*Claw3D|clone/i);
  });

  it("marks external Claw3D as optional advanced legacy metadata", () => {
    expect(OFFICE_EXPERIENCE_BOUNDARY.main.label).toBe("ORION Office");
    expect(OFFICE_EXPERIENCE_BOUNDARY.main.kind).toBe("built-in");
    expect(OFFICE_EXPERIENCE_BOUNDARY.main.requiresExternalClaw3d).toBe(false);

    expect(OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.label).toBe(
      "Advanced External Claw3D",
    );
    expect(OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.kind).toBe("advanced-legacy");
    expect(OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.optional).toBe(true);
    expect(OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.status).toMatch(/not implemented/i);
  });

  it("exposes user-facing copy that keeps install/start out of the main path", () => {
    const copy = getOfficeExperienceCopy();

    expect(copy.mainTitle).toBe("ORION Office");
    expect(copy.mainDescription).toContain("built-in 3D workspace");
    expect(copy.mainDescription).not.toMatch(/install Claw3D|clone.*hermes-office/i);
    expect(copy.externalTitle).toBe("Advanced External Claw3D");
    expect(copy.externalDescription).toMatch(/optional|advanced|legacy/i);
    expect(copy.externalStatus).toMatch(/not implemented/i);
  });
});
