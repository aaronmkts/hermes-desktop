import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createDefaultOfficeLayout } from "../src/shared/office-layout";

let testHome: string;
async function loadStore(): Promise<typeof import("../src/main/office-layout-store")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return await import("../src/main/office-layout-store");
}
function desktopJson(): string { return join(testHome, "desktop.json"); }

describe("office layout store", () => {
  beforeEach(() => { testHome = mkdtempSync(join(tmpdir(), "hermes-office-layout-")); });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(testHome, { recursive: true, force: true }); });

  it("returns defaults when desktop config is absent", async () => {
    const { getOfficeLayout } = await loadStore();
    expect(getOfficeLayout()).toEqual(createDefaultOfficeLayout());
  });

  it("saves normalized layout under desktop.json.officeLayout with updatedAt", async () => {
    writeFileSync(desktopJson(), JSON.stringify({ connectionMode: "remote", remoteUrl: "https://example" }));
    const { saveOfficeLayout } = await loadStore();
    const saved = saveOfficeLayout({ ...createDefaultOfficeLayout(), restFurniture: [{ id: "custom", type: "couch", x: -1, y: 2, facingDeg: 370 }] });
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(saved.restFurniture[0]).toMatchObject({ id: "custom", x: 0, y: 2, facingDeg: 10 });
    const data = JSON.parse(readFileSync(desktopJson(), "utf-8"));
    expect(data.connectionMode).toBe("remote");
    expect(data.remoteUrl).toBe("https://example");
    expect(data.officeLayout).toEqual(saved);
  });

  it("reads saved layouts back and repairs malformed stored layouts", async () => {
    const { getOfficeLayout, saveOfficeLayout } = await loadStore();
    const saved = saveOfficeLayout({ ...createDefaultOfficeLayout(), divider: { x: 900, doorYMin: 700, doorYMax: 800 } });
    expect(getOfficeLayout()).toEqual(saved);
    writeFileSync(desktopJson(), JSON.stringify({ officeLayout: { schemaVersion: 999 } }));
    expect(getOfficeLayout()).toEqual(createDefaultOfficeLayout());
  });

  it("resets layout while preserving unrelated desktop config keys", async () => {
    const { resetOfficeLayout, saveOfficeLayout } = await loadStore();
    saveOfficeLayout({ ...createDefaultOfficeLayout(), divider: { x: 900, doorYMin: 700, doorYMax: 800 } });
    const before = JSON.parse(readFileSync(desktopJson(), "utf-8"));
    before.connectionMode = "ssh";
    before.remoteUrl = "https://example";
    writeFileSync(desktopJson(), JSON.stringify(before));
    const reset = resetOfficeLayout();
    expect(reset).toEqual(createDefaultOfficeLayout());
    const data = JSON.parse(readFileSync(desktopJson(), "utf-8"));
    expect(data.connectionMode).toBe("ssh");
    expect(data.remoteUrl).toBe("https://example");
    expect(data.officeLayout).toEqual(createDefaultOfficeLayout());
    expect(existsSync(desktopJson())).toBe(true);
  });
});
