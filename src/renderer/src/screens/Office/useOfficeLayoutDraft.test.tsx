import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { buildDefaultOfficeLayout } from "./office3d/layoutModel";
import {
  OFFICE_LAYOUT_STORAGE_KEY,
  useOfficeLayoutDraft,
} from "./useOfficeLayoutDraft";

const key = `${OFFICE_LAYOUT_STORAGE_KEY}:test`;

describe("useOfficeLayoutDraft", () => {
  beforeEach(() => localStorage.clear());

  it("initializes from storage or default and recovers invalid storage", () => {
    const stored = buildDefaultOfficeLayout(["a"], null);
    stored.restFurniture[0].x = 99;
    localStorage.setItem(key, JSON.stringify(stored));
    const { result, rerender } = renderHook(
      ({ agents }) =>
        useOfficeLayoutDraft({
          storageKey: key,
          agentIds: agents,
          ceoId: null,
        }),
      { initialProps: { agents: ["a"] } },
    );
    expect(result.current.layout.restFurniture[0].x).toBe(99);
    localStorage.setItem(key, "bad");
    rerender({ agents: ["a", "b"] });
    expect(result.current.layout.workstations.some((d) => d.agentId === "b")).toBe(
      true,
    );
  });

  it("marks dirty after edits and clears on save", () => {
    const { result } = renderHook(() =>
      useOfficeLayoutDraft({ storageKey: key, agentIds: ["a"], ceoId: null }),
    );
    act(() => result.current.selectItem("furniture:beanbag-0"));
    act(() => result.current.moveSelected(10, 0));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.rotateSelected(15));
    act(() => result.current.assignDesk("desk-0", null));
    act(() => result.current.save());
    expect(result.current.dirty).toBe(false);
    expect(JSON.parse(localStorage.getItem(key) ?? "{}").restFurniture[0].x).toBe(
      1310,
    );
  });

  it("resets draft without storage and resets to default with storage", () => {
    const { result } = renderHook(() =>
      useOfficeLayoutDraft({ storageKey: key, agentIds: ["a"], ceoId: null }),
    );
    act(() => result.current.save());
    act(() => result.current.selectItem("furniture:beanbag-0"));
    act(() => result.current.moveSelected(10, 0));
    act(() => result.current.resetDraft());
    expect(result.current.layout.restFurniture[0].x).toBe(1300);
    act(() => result.current.moveSelected(10, 0));
    act(() => result.current.resetToDefault());
    expect(result.current.dirty).toBe(false);
    expect(JSON.parse(localStorage.getItem(key) ?? "{}").restFurniture[0].x).toBe(
      1300,
    );
  });

  it("reconciles changed agents while preserving furniture", () => {
    const { result, rerender } = renderHook(
      ({ agents }) =>
        useOfficeLayoutDraft({
          storageKey: key,
          agentIds: agents,
          ceoId: null,
        }),
      { initialProps: { agents: ["a"] } },
    );
    act(() => result.current.selectItem("furniture:beanbag-0"));
    act(() => result.current.moveSelected(5, 0));
    act(() => result.current.save());
    rerender({ agents: ["b"] });
    expect(result.current.layout.restFurniture[0].x).toBe(1305);
    expect(result.current.layout.workstations.some((d) => d.agentId === "b")).toBe(
      true,
    );
    expect(result.current.layout.workstations.some((d) => d.agentId === "a")).toBe(
      false,
    );
  });
});
