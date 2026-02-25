"use client";

import React from "react";
import { CardShell, CardSize, TrumpContent, TextContent } from "./CardShell";

export type CardType = "trump" | "text";

export type TrumpData = {
  suit: string;
  rank: string;
};

export type TextData = {
  title?: string;
  text: string;
};

export type CardRenderProps = {
  cardType: CardType;
  data: TrumpData | TextData;
  size?: CardSize;
  faceDown?: boolean;
  selected?: boolean;
  rotation?: number;
  offsetY?: number;
  onClick?: () => void;
};

type ContentRenderer = (
  data: TrumpData | TextData,
  size: CardSize
) => React.ReactNode;

/**
 * cardType ごとのコンテンツレンダラー
 * CardShell で包んで返す
 */
const CARD_RENDERERS: Record<CardType, ContentRenderer> = {
  trump: (data, size) => {
    const { suit, rank } = data as TrumpData;
    return <TrumpContent suit={suit} rank={rank} size={size} />;
  },
  text: (data, size) => {
    const { title, text } = data as TextData;
    return <TextContent title={title} text={text} size={size} />;
  },
};

/**
 * レジストリ経由で CardShell + コンテンツ を描画
 */
export function renderCard({
  cardType,
  data,
  size = "normal",
  faceDown = false,
  selected = false,
  rotation = 0,
  offsetY = 0,
  onClick,
}: CardRenderProps): React.ReactElement {
  const Content = CARD_RENDERERS[cardType];
  if (!Content) {
    return (
      <CardShell
        faceDown={faceDown}
        selected={selected}
        rotation={rotation}
        offsetY={offsetY}
        onClick={onClick}
        size={size}
      >
        <span className="text-xs text-gray-500">?</span>
      </CardShell>
    );
  }

  return (
    <CardShell
      faceDown={faceDown}
      selected={selected}
      rotation={rotation}
      offsetY={offsetY}
      onClick={onClick}
      size={size}
    >
      {Content(data, size)}
    </CardShell>
  );
}

/**
 * 新規 cardType を追加するための登録関数（将来の拡張用）
 */
export function registerCardRenderer(
  cardType: string,
  renderer: ContentRenderer
): void {
  (CARD_RENDERERS as Record<string, ContentRenderer>)[cardType] = renderer;
}
