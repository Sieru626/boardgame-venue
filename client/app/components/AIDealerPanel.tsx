'use client';

import React, { useState, useCallback, KeyboardEvent, ChangeEvent } from 'react';

const DEALER_IMG = {
  idle: '/dealer-idle.png',
  panic: '/dealer-panic.png',
} as const;

const DEALER_IMG_FALLBACK = '/dealer.png';

const DEALER_PLACEHOLDER = {
  idle: '/dealer-placeholder.svg',
  panic: '/dealer-panic-placeholder.svg',
} as const;

type AIDealerPanelProps = {
  isPanic?: boolean;
  isThinking?: boolean;
  isWorking?: boolean;
  speech?: string;
  onSendMessage?: (text: string) => void;
  onSetupVenue?: () => void;
};

export default function AIDealerPanel({ isPanic, isThinking, isWorking, speech, onSendMessage, onSetupVenue }: AIDealerPanelProps) {
  const statusLabel = isPanic ? 'ERROR' : 'ACTIVE';
  const [text, setText] = useState('');
  const [imageFallback, setImageFallback] = useState<{ idle: boolean; panic: boolean }>({ idle: false, panic: false });
  const [useFallbackPng, setUseFallbackPng] = useState(false);

  const dealerMode = isPanic ? 'panic' : 'idle';

  const imageSrc = (() => {
    if (imageFallback[dealerMode]) return DEALER_PLACEHOLDER[dealerMode];
    if (dealerMode === 'idle' && useFallbackPng) return DEALER_IMG_FALLBACK;
    return DEALER_IMG[dealerMode];
  })();

  const handleImageError = useCallback(() => {
    if (dealerMode === 'idle' && !useFallbackPng) {
      setUseFallbackPng(true);
      return;
    }
    if (dealerMode === 'panic' || useFallbackPng) {
      setImageFallback((prev) => ({ ...prev, [dealerMode]: true }));
    }
  }, [dealerMode, useFallbackPng]);

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
    <section className={`${isPanic ? 'neon-panel-red' : 'neon-panel'} rounded-lg p-4 flex flex-col gap-3 h-full`}>
      <header className="text-center relative z-10">
        <div className={`text-xs tracking-[0.3em] font-sans flex items-center justify-center gap-2 mb-2 ${isPanic ? 'neon-red' : 'neon-lime'}`}>
          <span className="inline-block w-6 h-px bg-gradient-to-r from-transparent to-current opacity-60" />
          {'✦ AI DEALER ✦'}
          <span className="inline-block w-6 h-px bg-gradient-to-r from-current to-transparent opacity-60" />
        </div>
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt="ディーラーちゃん"
            className={`w-32 h-32 rounded-lg object-contain object-center border-2 mx-auto block bg-[var(--card)] ${isPanic ? 'border-[var(--neon-red)]' : 'border-[var(--neon-lime)]'}`}
            onError={handleImageError}
          />
          <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full animate-pulse ${isPanic ? 'bg-[var(--neon-red)]' : 'bg-[var(--neon-lime)]'}`} />
        </div>
      </header>

      <div className={`${isPanic ? 'neon-panel-red' : 'neon-panel'} rounded-lg p-3 min-h-[60px] flex items-center relative z-10`}>
        <p className={`text-xs font-sans whitespace-pre-wrap ${isPanic ? 'text-[var(--neon-red)]' : 'text-[var(--foreground)]'}`}>
          {isPanic
            ? 'えっ、ちょっと待って！それは想定外...！'
            : isThinking
              ? 'ディーラーちゃん思考中…'
              : isWorking
                ? 'ディーラーちゃん作業中…（会場を準備しています）'
                : (speech && speech.trim().length > 0 ? speech : baseSpeech)}
        </p>
      </div>

      <div className="flex flex-col gap-2 relative z-10">
        <input
          type="text"
          placeholder="ディーラーに話しかける..."
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className="bg-[var(--input)] border border-[var(--neon-lime)]/30 rounded-lg px-3 py-2 text-xs font-sans text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--neon-lime)] focus:outline-none focus:shadow-[0_0_15px_rgba(204,255,0,0.15)] transition-all"
        />
        <button
          type="button"
          onClick={doSend}
          className="neon-btn rounded-lg px-3 py-2.5 text-xs font-sans flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          disabled={!text.trim()}
        >
          <span>✨</span>
          <span>{'ディーラーに送信する'}</span>
        </button>
      </div>

      {(isThinking || isWorking) && (
        <div className="text-[10px] neon-cyan font-sans text-center animate-pulse relative z-10">
          {isWorking ? 'ディーラーちゃん作業中…' : 'ディーラーちゃん思考中…'}
        </div>
      )}

      <footer className="mt-auto pt-3 border-t border-[var(--border)] text-center flex flex-col gap-1 relative z-10">
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

