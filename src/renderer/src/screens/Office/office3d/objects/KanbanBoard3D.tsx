import { createElement } from "react";
import { Text } from "@react-three/drei";
import type { OfficeBoardAccent, OfficeBoardViewModel } from "../kanbanBoard";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOARD_Y,
  BOARD_Z,
  CARD_HEIGHT,
  CARD_WIDTH,
  getBoardCardTransform,
  getBoardColumnAnchor,
  getBoardColumnWidth,
} from "../kanbanBoardLayout";

const ACCENT_COLORS: Record<OfficeBoardAccent, string> = {
  normal: "#f8fafc",
  running: "#38bdf8",
  blocked: "#fb7185",
  done: "#86efac",
};

const IS_TEST = process.env.NODE_ENV === "test";

function R3FPrimitive({
  as,
  children,
  r3fProps,
}: {
  as: string;
  children?: React.ReactNode;
  r3fProps?: Record<string, unknown>;
}): React.JSX.Element {
  if (IS_TEST) {
    return <div data-testid={`r3f-${as.toLowerCase()}`}>{children}</div>;
  }
  return createElement(as, r3fProps, children);
}

function BoardText({
  children,
  position,
  fontSize = 0.13,
  color = "#111827",
}: {
  children: string;
  position: [number, number, number];
  fontSize?: number;
  color?: string;
}) {
  return (
    <Text
      position={position}
      fontSize={fontSize}
      color={color}
      anchorX="center"
      anchorY="middle"
      maxWidth={1.8}
    >
      {children}
    </Text>
  );
}

export function KanbanBoard3D({
  board,
}: {
  board: OfficeBoardViewModel;
}): React.JSX.Element {
  return (
    <R3FPrimitive as="group">
      <R3FPrimitive as="mesh" r3fProps={{ position: [0, BOARD_Y, BOARD_Z] }}>
        <R3FPrimitive
          as="boxGeometry"
          r3fProps={{ args: [BOARD_WIDTH, BOARD_HEIGHT, 0.12] }}
        />
        <R3FPrimitive
          as="meshStandardMaterial"
          r3fProps={{ color: "#1f2937", roughness: 0.8 }}
        />
      </R3FPrimitive>
      <BoardText
        position={[0, BOARD_Y + BOARD_HEIGHT / 2 - 0.18, BOARD_Z - 0.13]}
        fontSize={0.18}
        color="#f8fafc"
      >
        Kanban Board
      </BoardText>
      {board.columns.map((column, columnIndex) => {
        const anchor = getBoardColumnAnchor(columnIndex);
        return (
          <R3FPrimitive key={column.id} as="group">
            <R3FPrimitive
              as="mesh"
              r3fProps={{ position: [anchor.x, BOARD_Y - 0.1, BOARD_Z - 0.08] }}
            >
              <R3FPrimitive
                as="boxGeometry"
                r3fProps={{
                  args: [getBoardColumnWidth(), BOARD_HEIGHT - 0.55, 0.06],
                }}
              />
              <R3FPrimitive
                as="meshStandardMaterial"
                r3fProps={{ color: "#e5e7eb", roughness: 0.72 }}
              />
            </R3FPrimitive>
            <BoardText
              position={[anchor.x, anchor.y, anchor.z - 0.04]}
              fontSize={0.14}
            >
              {column.label}
            </BoardText>
            {column.cards.map((card, cardIndex) => {
              const t = getBoardCardTransform(columnIndex, cardIndex);
              return (
                <R3FPrimitive key={card.id} as="group">
                  <R3FPrimitive
                    as="mesh"
                    r3fProps={{ position: [t.x, t.y, t.z] }}
                  >
                    <R3FPrimitive
                      as="boxGeometry"
                      r3fProps={{ args: [CARD_WIDTH, CARD_HEIGHT, 0.08] }}
                    />
                    <R3FPrimitive
                      as="meshStandardMaterial"
                      r3fProps={{
                        color: ACCENT_COLORS[card.accent],
                        roughness: 0.65,
                        emissive:
                          card.accent === "running" || card.accent === "blocked"
                            ? ACCENT_COLORS[card.accent]
                            : "#000000",
                        emissiveIntensity: card.accent === "normal" ? 0 : 0.08,
                      }}
                    />
                  </R3FPrimitive>
                  <BoardText
                    position={[t.x, t.y + 0.07, t.z - 0.06]}
                    fontSize={0.09}
                  >
                    {card.title}
                  </BoardText>
                  {card.subtitle && (
                    <BoardText
                      position={[t.x, t.y - 0.08, t.z - 0.06]}
                      fontSize={0.07}
                      color="#374151"
                    >
                      {card.subtitle}
                    </BoardText>
                  )}
                </R3FPrimitive>
              );
            })}
          </R3FPrimitive>
        );
      })}
      {board.total === 0 && (
        <BoardText
          position={[0, BOARD_Y - 0.1, BOARD_Z - 0.16]}
          fontSize={0.16}
          color="#f8fafc"
        >
          No active Kanban tasks
        </BoardText>
      )}
    </R3FPrimitive>
  );
}
