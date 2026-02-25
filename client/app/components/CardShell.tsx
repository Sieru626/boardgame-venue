"use client";

import React from "react";

export type CardSize = "normal" | "small" | "mini";

export type CardShellProps = {
  children?: React.ReactNode;
  faceDown?: boolean;
  selected?: boolean;
  rotation?: number;
  offsetY?: number;
  onClick?: () => void;
  size?: CardSize;
};

const SIZE_CLASS: Record<CardSize, string> = {
  mini: "w-8 h-11",
  small: "w-10 h-14",
  normal: "w-14 h-20",
};

/**
 * 共通カード枠: ネオン枠線・背景・ホバー・選択エフェクト
 * 中身（TrumpContent / TextContent）は children で渡す
 */
export function CardShell({
  children,
  faceDown = false,
  selected = false,
  rotation = 0,
  offsetY = 0,
  onClick,
  size = "normal",
}: CardShellProps) {
  const sizeClass = SIZE_CLASS[size];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${sizeClass} rounded relative transition-all duration-200 flex-shrink-0 ${
        faceDown ? "" : "hover:-translate-y-2"
      } ${selected ? "-translate-y-3" : ""}`}
      style={{
        transform: `rotate(${rotation}deg) translateY(${selected ? -12 + offsetY : offsetY}px)`,
        boxShadow: selected
          ? "0 0 15px rgba(0,255,136,0.6), 0 0 30px rgba(0,255,136,0.2)"
          : faceDown
            ? "0 2px 8px rgba(0,0,0,0.5)"
            : "0 2px 8px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.1)",
        border: selected
          ? "2px solid var(--neon-green)"
          : "1px solid rgba(255,255,255,0.15)",
      }}
    >
      {faceDown ? (
        <div
          className="w-full h-full rounded overflow-hidden"
          style={{
            background:
              "repeating-linear-gradient(45deg, #1a3a6a, #1a3a6a 3px, #1e4080 3px, #1e4080 6px)",
            border: "2px solid #2a5aaa",
          }}
        >
          <div className="absolute inset-1 rounded border border-[#2a5aaa]/50 flex items-center justify-center">
            <span
              className="text-[#4a8aee]/50"
              style={{
                fontSize:
                  size === "mini" ? "8px" : size === "small" ? "10px" : "14px",
              }}
            >
              {"\u2660"}
            </span>
          </div>
        </div>
      ) : (
        <div
          className="w-full h-full rounded flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
          }}
        >
          {children}
        </div>
      )}
    </button>
  );
}

// ─── TrumpContent（トランプ: マークと数字）────────────────
export type TrumpContentProps = {
  suit: string;
  rank: string;
  size?: CardSize;
};

const RANK_SIZE: Record<CardSize, string> = {
  mini: "text-[8px]",
  small: "text-[10px]",
  normal: "text-sm",
};
const SUIT_SIZE: Record<CardSize, string> = {
  mini: "text-[10px]",
  small: "text-sm",
  normal: "text-xl",
};

const SUIT_SYMBOL: Record<string, string> = {
  heart: "\u2665",
  diamond: "\u2666",
  spade: "\u2660",
  club: "\u2663",
};

export function TrumpContent({
  suit,
  rank,
  size = "normal",
}: TrumpContentProps) {
  const isJoker = suit === "joker";
  const suitColor =
    suit === "heart" || suit === "diamond" ? "#ff4466" : "#e0e0e0";

  if (isJoker) {
    return (
      <>
        <span
          className={`${RANK_SIZE[size]} font-bold text-purple-400 leading-none`}
        >
          JOKER
        </span>
        <span className="text-2xl leading-none">🤡</span>
      </>
    );
  }

  const suitSymbol = SUIT_SYMBOL[suit] ?? "\u2660";

  return (
    <>
      <span
        className={`${RANK_SIZE[size]} font-sans font-bold leading-none`}
        style={{ color: suitColor }}
      >
        {rank}
      </span>
      <span
        className={`${SUIT_SIZE[size]} leading-none`}
        style={{ color: suitColor }}
      >
        {suitSymbol}
      </span>
    </>
  );
}

// ─── TextContent（テキストのみ: お題・役職名など将来用）────────────────
export type TextContentProps = {
  title?: string;
  text: string;
  size?: CardSize;
};

const TEXT_SIZE: Record<CardSize, string> = {
  mini: "text-[8px]",
  small: "text-[10px]",
  normal: "text-xs",
};

const TITLE_SIZE: Record<CardSize, string> = {
  mini: "text-[6px]",
  small: "text-[8px]",
  normal: "text-[10px]",
};

export function TextContent({
  title,
  text,
  size = "normal",
}: TextContentProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 p-1 text-center">
      {title && (
        <span
          className={`${TITLE_SIZE[size]} font-bold neon-yellow uppercase tracking-wider truncate w-full`}
        >
          {title}
        </span>
      )}
      <span
        className={`${TEXT_SIZE[size]} text-[var(--muted-foreground)] leading-tight line-clamp-4`}
      >
        {text}
      </span>
    </div>
  );
}
