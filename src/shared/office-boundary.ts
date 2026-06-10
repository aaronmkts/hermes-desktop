export const OFFICE_EXPERIENCE_BOUNDARY = {
  main: {
    label: "ORION Office",
    kind: "claw3d-primary",
    requiresExternalClaw3d: true,
  },
  externalClaw3d: {
    label: "Native Office fallback",
    kind: "internal-fallback",
    optional: true,
    status: "Available only as an internal fallback when Claw3D APIs are unavailable; the main Office flow installs, starts, and embeds Claw3D Studio.",
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
      "ORION Office installs, starts, and embeds Claw3D Studio for observing agents and operator state through the existing SSH gateway token flow.",
    externalTitle: OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.label,
    externalDescription:
      "The native React office remains an internal fallback for renderer tests or environments where Claw3D IPC is unavailable.",
    externalStatus: OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.status,
  };
}
