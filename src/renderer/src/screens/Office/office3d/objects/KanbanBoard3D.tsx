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
    <group name="office-kanban-board">
      <mesh position={[0, BOARD_Y, BOARD_Z]}>
        <boxGeometry args={[BOARD_WIDTH, BOARD_HEIGHT, 0.12]} />
        <meshStandardMaterial color="#1f2937" roughness={0.8} />
      </mesh>
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
          <group key={column.id} name={`kanban-column-${column.id}`}>
            <mesh position={[anchor.x, BOARD_Y - 0.1, BOARD_Z - 0.08]}>
              <boxGeometry
                args={[getBoardColumnWidth(), BOARD_HEIGHT - 0.55, 0.06]}
              />
              <meshStandardMaterial color="#e5e7eb" roughness={0.72} />
            </mesh>
            <BoardText
              position={[anchor.x, anchor.y, anchor.z - 0.04]}
              fontSize={0.14}
            >
              {column.label}
            </BoardText>
            {column.cards.map((card, cardIndex) => {
              const t = getBoardCardTransform(columnIndex, cardIndex);
              return (
                <group key={card.id} name={`kanban-card-${card.id}`}>
                  <mesh position={[t.x, t.y, t.z]}>
                    <boxGeometry args={[CARD_WIDTH, CARD_HEIGHT, 0.08]} />
                    <meshStandardMaterial
                      color={ACCENT_COLORS[card.accent]}
                      roughness={0.65}
                      emissive={
                        card.accent === "running" || card.accent === "blocked"
                          ? ACCENT_COLORS[card.accent]
                          : "#000000"
                      }
                      emissiveIntensity={card.accent === "normal" ? 0 : 0.08}
                    />
                  </mesh>
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
                </group>
              );
            })}
          </group>
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
    </group>
  );
}
