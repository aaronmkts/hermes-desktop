import { readDesktopConfig, writeDesktopConfig } from "./config";
import { createDefaultOfficeLayout, normalizeOfficeLayout, type OfficeLayout } from "../shared/office-layout";

export function getOfficeLayout(): OfficeLayout {
  const data = readDesktopConfig();
  return normalizeOfficeLayout(data.officeLayout);
}

export function saveOfficeLayout(layout: unknown): OfficeLayout {
  const data = readDesktopConfig();
  const normalized = normalizeOfficeLayout(layout);
  normalized.updatedAt = new Date().toISOString();
  data.officeLayout = normalized;
  writeDesktopConfig(data);
  return normalized;
}

export function resetOfficeLayout(): OfficeLayout {
  const data = readDesktopConfig();
  const layout = createDefaultOfficeLayout();
  data.officeLayout = layout;
  writeDesktopConfig(data);
  return layout;
}
