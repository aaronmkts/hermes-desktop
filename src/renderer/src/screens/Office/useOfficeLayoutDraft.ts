import { useCallback, useEffect, useMemo, useState } from "react";
import {
  assignDesk as assignDeskInLayout,
  buildDefaultOfficeLayout,
  moveLayoutItem,
  normalizeOfficeLayout,
  rotateLayoutItem,
  type OfficeLayout,
  type OfficeLayoutItemId,
} from "./office3d/layoutModel";

export const OFFICE_LAYOUT_STORAGE_KEY = "hermes:office:layout:v1";

export interface UseOfficeLayoutDraftResult {
  layout: OfficeLayout;
  savedLayout: OfficeLayout;
  selectedItemId: OfficeLayoutItemId | null;
  dirty: boolean;
  selectItem(id: OfficeLayoutItemId | null): void;
  moveSelected(dx: number, dy: number): void;
  rotateSelected(deltaDeg: number): void;
  assignDesk(deskId: string, agentId: string | null): void;
  save(): void;
  resetDraft(): void;
  resetToDefault(): void;
}

function readStored(storageKey: string): unknown {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeStored(storageKey: string, layout: OfficeLayout): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

export function useOfficeLayoutDraft({
  storageKey,
  agentIds,
  ceoId,
}: {
  storageKey: string;
  agentIds: string[];
  ceoId: string | null;
}): UseOfficeLayoutDraftResult {
  const agentKey = useMemo(() => agentIds.join("\u0000"), [agentIds]);
  const [savedLayout, setSavedLayout] = useState<OfficeLayout>(() =>
    normalizeOfficeLayout(readStored(storageKey), agentIds, ceoId),
  );
  const [layout, setLayout] = useState<OfficeLayout>(savedLayout);
  const [selectedItemId, setSelectedItemId] =
    useState<OfficeLayoutItemId | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const normalized = normalizeOfficeLayout(
      readStored(storageKey) ?? savedLayout,
      agentIds,
      ceoId,
    );
    setSavedLayout(normalized);
    setLayout(normalized);
    setDirty(false);
    setSelectedItemId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agentKey intentionally captures contents
  }, [storageKey, agentKey, ceoId]);

  const edit = useCallback((fn: (layout: OfficeLayout) => OfficeLayout) => {
    setLayout((current) => fn(current));
    setDirty(true);
  }, []);

  return {
    layout,
    savedLayout,
    selectedItemId,
    dirty,
    selectItem: setSelectedItemId,
    moveSelected(dx, dy) {
      if (selectedItemId)
        edit((current) => moveLayoutItem(current, selectedItemId, dx, dy));
    },
    rotateSelected(deltaDeg) {
      if (selectedItemId)
        edit((current) => rotateLayoutItem(current, selectedItemId, deltaDeg));
    },
    assignDesk(deskId, agentId) {
      edit((current) => assignDeskInLayout(current, deskId, agentId));
    },
    save() {
      setSavedLayout(layout);
      writeStored(storageKey, layout);
      setDirty(false);
    },
    resetDraft() {
      setLayout(savedLayout);
      setDirty(false);
    },
    resetToDefault() {
      const next = buildDefaultOfficeLayout(agentIds, ceoId);
      setSavedLayout(next);
      setLayout(next);
      writeStored(storageKey, next);
      setDirty(false);
      setSelectedItemId(null);
    },
  };
}
