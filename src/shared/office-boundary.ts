export const OFFICE_EXPERIENCE_BOUNDARY = {
  main: {
    label: "ORION Office",
    kind: "built-in",
    requiresExternalClaw3d: false,
  },
  externalClaw3d: {
    label: "Advanced External Claw3D",
    kind: "advanced-legacy",
    optional: true,
    status: "Placeholder only; external Claw3D install/start is not implemented in the main Office flow.",
  },
} as const;

export function getOfficeExperienceCopy(): {
  mainTitle: string;
  mainDescription: string;
  externalTitle: string;
  externalDescription: string;
  externalStatus: string;
} {
  return {
    mainTitle: OFFICE_EXPERIENCE_BOUNDARY.main.label,
    mainDescription:
      "ORION Office is Hermes' built-in 3D workspace for observing agents and operator state without installing external Claw3D/hermes-office.",
    externalTitle: OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.label,
    externalDescription:
      "External Claw3D/hermes-office is optional, advanced, legacy visualization integration and is separate from the main ORION Office experience.",
    externalStatus: OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.status,
  };
}
