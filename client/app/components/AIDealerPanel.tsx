'use client';

import React, { useState, KeyboardEvent, ChangeEvent } from 'react';

type AIDealerPanelProps = {
  isPanic?: boolean;
  isThinking?: boolean;
  speech?: string;
  onSendMessage?: (text: string) => void;
  onSetupVenue?: () => void;
};

export default function AIDealerPanel({ isPanic, isThinking, speech, onSendMessage, onSetupVenue }: AIDealerPanelProps) {
  const statusLabel = isPanic ? 'ERROR' : 'ACTIVE';

  const [text, setText] = useState('');

  const doSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (onSendMessage) {
      onSendMessage(trimmed);
    }
    setText('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSend();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  };

  const baseSpeech =
    'ようこそ。新しいゲームの秩序へ。準備はいい？';

  return (
    <section className="rpg-border-yellow rounded-lg p-3 flex flex-col gap-3 h-full">
      <header className="text-center">
        <div className="text-xs neon-yellow tracking-widest mb-2 font-sans">{'✦ AI DEALER ✦'}</div>
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/dealer-idle.png"
            alt="AI Dealer"
            className="w-32 h-32 rounded-lg object-cover object-top border-2 border-[var(--neon-yellow)] mx-auto"
          />
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-[var(--neon-green)] rounded-full animate-pulse" />
        </div>
      </header>

      <div className="rpg-border rounded-lg p-3 min-h-[60px] flex items-center">
        <p className="text-xs neon-green font-sans whitespace-pre-wrap">
          {isPanic
            ? 'えっ、ちょっと待って！それは想定外...！'
            : (speech && speech.trim().length > 0 ? speech : baseSpeech)}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="ディーラーに話しかける..."
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className="bg-[var(--input)] border border-[var(--neon-yellow)]/30 rounded px-2 py-1.5 text-xs font-sans text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--neon-yellow)] focus:outline-none"
        />
        <button
          type="button"
          onClick={doSend}
          className="neon-btn-yellow rounded px-3 py-2 text-xs font-sans flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          disabled={!text.trim()}
        >
          <span>✨</span>
          <span>{'ディーラーに送信する'}</span>
        </button>
      </div>

      {isThinking && (
        <div className="text-[10px] text-[var(--muted-foreground)] font-sans text-center animate-pulse">
          ディーラーちゃん思考中…
        </div>
      )}

      <footer className="mt-auto pt-2 border-t border-[var(--border)] text-center flex flex-col gap-1">
        <button
          type="button"
          onClick={onSetupVenue}
          disabled={!onSetupVenue}
          className="neon-btn-amber rounded px-3 py-2 text-[11px] font-sans tracking-[0.18em] disabled:opacity-40"
        >
          会場設営
        </button>
        <span className="text-[10px] text-[var(--muted-foreground)] font-sans tracking-wider">
          {onSetupVenue
            ? 'AIと相談してルールと場を整える'
            : `DEALER STATUS: ${statusLabel}`}
        </span>
      </footer>
    </section>
  );
}

