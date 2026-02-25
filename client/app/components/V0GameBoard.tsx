"use client";

import React, { useState } from "react";
import { renderCard } from "./cardRegistry";

// ─── Card Format Conversion (existing { id, name } → v0 { suit, rank }) ───
const SUIT_MAP: Record<string, string> = { S: "spade", H: "heart", D: "diamond", C: "club" };
export function cardToV0(card: any): { suit: string; rank: string } | null {
  if (!card) return null;
  const name = typeof card === "string" ? card : String((card as any)?.name ?? "");
  if (!name || name === "Back") return null;
  if (name === "Joker") return { suit: "joker", rank: "Joker" };
  const n = name.toUpperCase().trim();
  const match = n.match(/^([SHDC])[- ]?([A2-9]|10|[JQK])$/);
  if (match) {
    const suit = SUIT_MAP[match[1]] ?? "spade";
    return { suit, rank: match[2] };
  }
  return null;
}

/**
 * V0 Card（CardShell + TrumpContent 経由）
 * レジストリを使って描画し、既存の V0Card インターフェースを維持
 */
export function V0Card({
  suit,
  rank,
  faceDown = false,
  rotation = 0,
  offsetY = 0,
  selected = false,
  onClick,
  size = "normal",
}: {
  suit: string;
  rank: string;
  faceDown?: boolean;
  rotation?: number;
  offsetY?: number;
  selected?: boolean;
  onClick?: () => void;
  size?: "normal" | "small" | "mini";
}) {
  return renderCard({
    cardType: "trump",
    data: { suit, rank },
    size,
    faceDown,
    selected,
    rotation,
    offsetY,
    onClick,
  });
}

// ─── Chip (Optional - hidden when no chip data) ───
export function Chip({
  color,
  value,
  size = "normal",
}: {
  color: string;
  value: string;
  size?: "normal" | "small";
}) {
  const dim = size === "small" ? "w-6 h-6" : "w-8 h-8";
  const text = size === "small" ? "text-[7px]" : "text-[9px]";
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center border-2 font-sans font-bold ${text}`}
      style={{
        background: `radial-gradient(circle at 30% 30%, ${color}bb, ${color}88)`,
        borderColor: `${color}`,
        boxShadow: `0 0 8px ${color}66, inset 0 0 6px rgba(0,0,0,0.3)`,
        color: "#111",
      }}
    >
      {value}
    </div>
  );
}

// ─── Player Seat ───
export function PlayerSeat({
  name,
  cardCount,
  isActive,
  position,
  avatar,
  isCPU = false,
  children,
}: {
  name: string;
  cardCount: number;
  isActive: boolean;
  position: "top-left" | "top-center" | "top-right";
  avatar: string;
  isCPU?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all ${
          isActive
            ? "ring-2 ring-[var(--neon-green)] shadow-[0_0_12px_rgba(0,255,136,0.4)]"
            : "ring-1 ring-[var(--border)]"
        }`}
        style={{
          background: isActive
            ? "linear-gradient(135deg, rgba(0,255,136,0.15), rgba(0,255,136,0.05))"
            : "rgba(26,26,26,0.8)",
        }}
      >
        {avatar}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-1">
          <span
            className={`text-[10px] font-sans ${isActive ? "neon-green" : "text-[var(--muted-foreground)]"}`}
          >
            {name}
          </span>
          {isCPU && (
            <span className="text-[8px] px-1 py-px rounded bg-[var(--muted)] text-[var(--muted-foreground)] font-sans">
              CPU
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="flex -space-x-1">
            {Array.from({ length: Math.min(cardCount, 5) }).map((_, i) => (
              <div
                key={i}
                className="w-3 h-4 rounded-sm"
                style={{
                  background:
                    "repeating-linear-gradient(45deg, #1a3a6a, #1a3a6a 1px, #1e4080 1px, #1e4080 2px)",
                  border: "1px solid #2a5aaa88",
                }}
              />
            ))}
          </div>
          <span className="text-[9px] text-[var(--muted-foreground)] font-sans">
            x{cardCount}
          </span>
        </div>
      </div>
      {isActive && (
        <div className="text-[8px] neon-green font-sans tracking-wider animate-pulse">
          {"THINKING..."}
        </div>
      )}
      {children}
    </div>
  );
}

export type V0Opponent = {
  id: string;
  name: string;
  hand: any[];
  isActive: boolean;
  isCPU?: boolean;
  isWinner?: boolean;
  isOut?: boolean;
  isTarget?: boolean;
  canPick?: boolean;
  extraContent?: React.ReactNode;
};

export type V0GameBoardProps = {
  opponents: V0Opponent[];
  myHand: any[];
  centerContent: React.ReactNode;
  turnText?: string;
  showActionButtons?: boolean;
  onPlayCard?: (idx: number) => void;
  onPass?: () => void;
  selectedCardIndices?: number[];
  onToggleCard?: (idx: number) => void;
  isSetup?: boolean;
  myPlayerName?: string;
  isMyTurn?: boolean;
  isSpectator?: boolean;
};

const AVATARS = ["\u{1F916}", "\u{1F47E}", "\u{1F9D9}", "\u{1F468}", "\u{1F469}"];

export default function V0GameBoard({
  opponents,
  myHand,
  centerContent,
  turnText = "",
  showActionButtons = true,
  onPlayCard,
  onPass,
  selectedCardIndices = [],
  onToggleCard,
  isSetup = false,
  myPlayerName = "",
  isMyTurn = false,
  isSpectator = false,
}: V0GameBoardProps) {
  const [internalSelected, setInternalSelected] = useState<number[]>([]);
  const selected = selectedCardIndices.length > 0 ? selectedCardIndices : internalSelected;
  const setSelected = onToggleCard
    ? (idx: number) => onToggleCard(idx)
    : (idx: number) =>
        setInternalSelected((prev) =>
          prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
        );

  const handSpread = myHand.length;
  const fanAngle = 3;
  const midIndex = (handSpread - 1) / 2;

  return (
    <div className="felt-table rounded-xl relative overflow-hidden flex-1 flex flex-col min-h-[200px] w-full h-full">
      <div className="absolute top-3 left-3 w-6 h-6 border-t-2 border-l-2 border-[#3a9a5a] opacity-60" />
      <div className="absolute top-3 right-3 w-6 h-6 border-t-2 border-r-2 border-[#3a9a5a] opacity-60" />
      <div className="absolute bottom-3 left-3 w-6 h-6 border-b-2 border-l-2 border-[#3a9a5a] opacity-60" />
      <div className="absolute bottom-3 right-3 w-6 h-6 border-b-2 border-r-2 border-[#3a9a5a] opacity-60" />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-64 h-64 border border-[#4aba6a] rotate-45 opacity-[0.06]" />
        <div className="absolute w-44 h-44 border border-[#4aba6a] rotate-45 opacity-[0.04]" />
      </div>

      {isSetup && (
        <div className="absolute inset-0 flex items-center justify-center text-[#3a9a5a]/60 font-sans pointer-events-none z-20">
          <div className="text-center">
            <div className="text-3xl mb-3 tracking-[0.5em]">{"* * * *"}</div>
            <div className="text-base tracking-wider neon-green opacity-60">
              WAITING FOR GAME...
            </div>
            <div className="text-xs mt-2 text-[#3a9a5a]/40">
              {"AIディーラーにルールを伝えて場を作ろう"}
            </div>
          </div>
        </div>
      )}

      {/* TOP: Opponents */}
      <div className="flex items-start justify-around px-8 pt-4 pb-2 relative z-10 flex-shrink-0">
        {opponents.slice(0, 5).map((p, i) => (
          <div key={p.id} className={p.isWinner ? "opacity-50 grayscale" : ""}>
            <PlayerSeat
              name={p.name}
              cardCount={p.hand?.length ?? 0}
              isActive={p.isActive}
              position={
                (["top-left", "top-center", "top-right", "top-left", "top-right"] as const)[
                  i
                ] ?? "top-center"
              }
              avatar={AVATARS[i % AVATARS.length]}
              isCPU={p.isCPU}
            >
              {p.extraContent}
            </PlayerSeat>
          </div>
        ))}
      </div>

      {/* CENTER: Stage */}
      <div className="flex-1 flex items-center justify-center relative z-10 px-6 min-h-[120px]">
        <div className="relative w-full h-full flex items-center justify-center">
          {turnText && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rpg-border rounded px-3 py-1 z-10">
              <span className="text-[10px] neon-green font-sans tracking-wider">
                {turnText}
              </span>
            </div>
          )}
          {centerContent}
        </div>
      </div>

      {/* BOTTOM: My Hand - Hide for spectators */}
      {!isSpectator && (
      <div className="relative z-10 pb-4 pt-2 flex-shrink-0">
        <div className="flex items-center justify-between px-6 mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded flex items-center justify-center text-sm"
              style={{
                background:
                  "linear-gradient(135deg, rgba(0,255,136,0.15), rgba(0,255,136,0.05))",
                border: "1px solid var(--neon-green)",
                boxShadow: "0 0 8px rgba(0,255,136,0.3)",
              }}
            >
              {"\u{1F451}"}
            </div>
            <div>
              <span className="text-xs neon-green font-sans">
                {myPlayerName || "YOU"}
              </span>
              {isMyTurn && (
                <span className="text-[9px] text-[var(--muted-foreground)] font-sans ml-2">
                  {"YOUR TURN"}
                </span>
              )}
            </div>
          </div>
          {showActionButtons && onPlayCard && onPass && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const idx = selected[0];
                  if (idx != null) onPlayCard(idx);
                }}
                disabled={selected.length === 0}
                className="neon-btn rounded px-3 py-1.5 text-[11px] font-sans disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {"出す"}
              </button>
              <button
                type="button"
                onClick={onPass}
                className="neon-btn-yellow rounded px-3 py-1.5 text-[11px] font-sans"
              >
                {"パス"}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-end justify-center">
          <div className="relative flex items-end" style={{ height: "90px" }}>
            {myHand.map((card, i) => {
              const v0 = cardToV0(card);
              const angle = (i - midIndex) * fanAngle;
              const yOffset = Math.abs(i - midIndex) * 3;
              const isSelected = selected.includes(i);
              if (!v0) return null;
              return (
                <div
                  key={i}
                  className="transition-all duration-200"
                  style={{
                    marginLeft: i === 0 ? 0 : "-8px",
                    zIndex: isSelected ? 50 : i,
                  }}
                >
                  <V0Card
                    suit={v0.suit}
                    rank={v0.rank}
                    rotation={angle}
                    offsetY={yOffset}
                    selected={isSelected}
                    onClick={() => onToggleCard ? onToggleCard(i) : setSelected(i)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
