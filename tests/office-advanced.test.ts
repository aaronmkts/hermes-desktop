import { describe, expect, it } from "vitest";

import enOffice from "../src/shared/i18n/locales/en/office";
import {
  OFFICE_EXPERIENCE_BOUNDARY,
  getOfficeExperienceCopy,
} from "../src/shared/office-boundary";

describe("Office primary Claw3D boundary", () => {
  it("makes the main Office copy describe Claw3D install/start/runtime", () => {
    expect(enOffice.title).toBe("ORION Office");
    expect(enOffice.subtitle).toMatch(/Claw3D Studio/i);
    expect(enOffice.setupDesc1).toMatch(/installs and launches Claw3D Studio/i);
    expect(enOffice.setupDesc2).toMatch(/SSH gateway token flow/i);
    expect(enOffice.setupDesc2).toMatch(/cloning and installing/i);
    expect(enOffice.setupDesc2).not.toMatch(/optional advanced legacy|does not install/i);
  });

  it("marks Claw3D as the primary Office experience metadata", () => {
    expect(OFFICE_EXPERIENCE_BOUNDARY.main.label).toBe("ORION Office");
    expect(OFFICE_EXPERIENCE_BOUNDARY.main.kind).toBe("claw3d-primary");
    expect(OFFICE_EXPERIENCE_BOUNDARY.main.requiresExternalClaw3d).toBe(true);

    expect(OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.label).toBe(
      "Native Office fallback",
    );
    expect(OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.kind).toBe("internal-fallback");
    expect(OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.optional).toBe(true);
    expect(OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.status).toMatch(/fallback/i);
  });

  it("exposes user-facing copy for installing, starting, and embedding Claw3D", () => {
    const copy = getOfficeExperienceCopy();

    expect(copy.mainTitle).toBe("ORION Office");
    expect(copy.mainDescription).toMatch(/installs, starts, and embeds Claw3D Studio/i);
    expect(copy.mainDescription).toMatch(/SSH gateway token flow/i);
    expect(copy.externalTitle).toBe("Native Office fallback");
    expect(copy.externalDescription).toMatch(/internal fallback/i);
    expect(copy.externalStatus).not.toMatch(/not implemented|advanced legacy/i);
  });
});
