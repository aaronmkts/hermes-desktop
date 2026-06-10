import {
  buildWorkstations,
  EXECUTIVE_DECOR,
  REST_FURNITURE,
  type FurniturePlacement,
  type Workstation,
} from "./layout";
import {
  buildDefaultOfficeLayout,
  getLayoutFurniture,
  layoutToWorkstations,
  type OfficeLayout,
  type OfficeLayoutItemId,
} from "./layoutModel";

export interface Office3DEditItem {
  itemId: OfficeLayoutItemId;
  selected: boolean;
}
export interface Office3DLayoutRenderState {
  layout: OfficeLayout;
  workstations: Workstation[];
  furniture: FurniturePlacement[];
  furnitureEditItems: Office3DEditItem[];
  deskEditItems: Office3DEditItem[];
}

export function getOffice3DLayoutRenderState({
  agentIds,
  ceoId,
  layout,
  editMode = false,
  selectedLayoutItemId = null,
}: {
  agentIds: string[];
  ceoId?: string | null;
  layout?: OfficeLayout;
  editMode?: boolean;
  selectedLayoutItemId?: OfficeLayoutItemId | null;
}): Office3DLayoutRenderState {
  const resolvedLayout = layout ?? buildDefaultOfficeLayout(agentIds, ceoId);
  const workstations = layout
    ? layoutToWorkstations(layout, agentIds, ceoId)
    : buildWorkstations(agentIds, ceoId);
  const furniture = layout
    ? getLayoutFurniture(resolvedLayout)
    : [...REST_FURNITURE, ...(ceoId ? EXECUTIVE_DECOR : [])];
  return {
    layout: resolvedLayout,
    workstations,
    furniture,
    furnitureEditItems: editMode
      ? furniture.map((p) => ({
          itemId: `furniture:${p.id}` as const,
          selected: selectedLayoutItemId === `furniture:${p.id}`,
        }))
      : [],
    deskEditItems: editMode
      ? resolvedLayout.workstations.map((d) => ({
          itemId: `desk:${d.id}` as const,
          selected: selectedLayoutItemId === `desk:${d.id}`,
        }))
      : [],
  };
}
