'use client';

import { useCallback, useRef, useState } from 'react';

type Props = {
  isPanic: boolean;
};

type LocalEmotion = 'idle' | 'panic';

type Reaction = {
  id: 'A' | 'B' | 'C' | 'D';
  text: string;
  emotion: LocalEmotion;
};

const REACTIONS: Reaction[] = [
  {
    id: 'A',
    emotion: 'panic',
    text: 'わわっ！？ きゅ、急に触らないでくださいよぅ……！心の準備が…っ！',
  },
  {
    id: 'B',
    emotion: 'idle',
    text: 'えへへ、制服…似合ってますか？ い、今ちょっとだけドヤってもいいやつですよね？',
  },
  {
    id: 'C',
    emotion: 'panic',
    text: 'あぅっ、今、重要書類を落としそうになりました……！セーフ…た、多分セーフです！',
  },
  {
    id: 'D',
    emotion: 'idle',
    text: 'あ、何かお困りですか？ えーっと…ルール説明ですね！任せてくださいっ、多分！',
  },
];

function MagicAura() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <svg className="absolute w-52 h-52 aura-ring opacity-35" viewBox="0 0 200 200" fill="none">
        <circle cx="100" cy="100" r="95" stroke="#ffd700" strokeWidth="1.2" strokeDasharray="8 5" />
        <circle cx="100" cy="100" r="90" stroke="#ffd700" strokeWidth="0.5" strokeDasharray="3 10" opacity="0.5" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 100 100)`}>
            <rect x="97" y="6" width="6" height="6" fill="#ffd700" opacity="0.7" rx="1" />
          </g>
        ))}
      </svg>
      <svg className="absolute w-44 h-44 aura-ring-reverse opacity-25" viewBox="0 0 160 160" fill="none">
        <circle cx="80" cy="80" r="75" stroke="#00e5ff" strokeWidth="0.8" strokeDasharray="12 4" />
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 80 80)`}>
            <polygon points="78,7 80,2 82,7" fill="#00e5ff" opacity="0.6" />
          </g>
        ))}
      </svg>
      <div
        className="absolute w-40 h-40 rounded-full aura-pulse"
        style={{ background: 'radial-gradient(circle, rgba(255,215,0,0.12) 0%, transparent 70%)' }}
      />
    </div>
  );
}

export default function AIDealerPanel({ isPanic }: Props) {
  // クリックインタラクション用ローカル状態
  const [interactionEmotion, setInteractionEmotion] = useState<LocalEmotion | null>(null);
  const [interactionLine, setInteractionLine] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [interactionCount, setInteractionCount] = useState(0);
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const baseEmotion: LocalEmotion = isPanic ? 'panic' : 'idle';
  const effectiveEmotion: LocalEmotion = interactionEmotion ?? baseEmotion;

  const baseLine =
    baseEmotion === 'panic'
      ? 'え、ちょ、待ってくださいー！今ちょうど処理が詰まりそうなんです…！'
      : 'いらっしゃいませっ。新しいゲームの秩序へようこそです…！た、多分ちゃんとご案内できます…！';

  const line = interactionLine ?? baseLine;

  const dealerSrc = effectiveEmotion === 'panic' ? '/dealer-panic.png' : '/dealer-idle.png';

  const handleDealerClick = useCallback(() => {
    // クリック回数をカウント（将来のアニメーション用フック）
    setInteractionCount((prev) => prev + 1);

    // 既存のタイマーをクリア
    if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
    if (reactionTimeoutRef.current) clearTimeout(reactionTimeoutRef.current);

    // ランダムなリアクションを選択
    const index = Math.floor(Math.random() * REACTIONS.length);
    const reaction = REACTIONS[index];
    setInteractionEmotion(reaction.emotion);
    setInteractionLine(reaction.text);

    // 一時的にアニメーションクラスを付与
    setIsAnimating(true);
    animationTimeoutRef.current = setTimeout(() => {
      setIsAnimating(false);
      animationTimeoutRef.current = null;
    }, 600);

    // 数秒後にベース状態に戻す
    reactionTimeoutRef.current = setTimeout(() => {
      setInteractionEmotion(null);
      setInteractionLine(null);
      reactionTimeoutRef.current = null;
    }, 2600);
  }, []);

  return (
    <div className="rpg-border-yellow rounded-lg p-4 flex flex-col gap-3 h-full relative overflow-hidden">
      <div className="text-center relative z-10">
        <div className="text-xs neon-yellow tracking-[0.3em] font-sans flex items-center justify-center gap-2">
          <span className="inline-block w-5 h-px bg-[var(--neon-yellow)]/60" />
          AI DEALER
          <span className="inline-block w-5 h-px bg-[var(--neon-yellow)]/60" />
        </div>
      </div>

      <div className="relative flex items-center justify-center py-1">
        <div className="relative">
          <MagicAura />
          <div className="dealer-float relative z-10">
            <div
              className="double-border-yellow rounded-lg frame-glow overflow-hidden relative"
              style={{ background: 'linear-gradient(180deg, #1c1c30 0%, #14142a 50%, #111122 100%)' }}
            >
              <div
                className="absolute inset-0 opacity-[0.05] z-20 pointer-events-none"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
                  backgroundSize: '4px 4px',
                }}
              />
              <button
                type="button"
                onClick={handleDealerClick}
                className={`relative z-10 block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--neon-yellow)]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                  isAnimating ? 'animate-bounce' : ''
                }`}
                aria-label="ディーラーに話しかける"
              >
                <img
                  src={dealerSrc}
                  alt="AI Dealer"
                  className="w-full h-auto object-contain"
                  style={{ imageRendering: 'auto', maxHeight: '160px' }}
                />
              </button>
              <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-[var(--neon-yellow)]/40 z-20" />
              <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-[var(--neon-yellow)]/40 z-20" />
              <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-[var(--neon-yellow)]/40 z-20" />
              <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-[var(--neon-yellow)]/40 z-20" />
            </div>
            <div
              className={`absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 rpg-border-yellow rounded px-2.5 py-0.5 whitespace-nowrap z-30 ${
                effectiveEmotion === 'panic' ? 'bg-red-900/80' : 'bg-[#111]'
              }`}
            >
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  effectiveEmotion === 'panic'
                    ? 'bg-red-400 animate-pulse'
                    : 'bg-[var(--neon-green)] animate-pulse'
                }`}
              />
              <span
                className={`text-[9px] font-sans tracking-wider ${
                  effectiveEmotion === 'panic' ? 'text-red-300' : 'neon-yellow'
                }`}
              >
                {effectiveEmotion === 'panic' ? 'PANIC!? ' : 'ACTIVE'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`relative z-10 mt-1 rounded-lg dealer-speech ${
          effectiveEmotion === 'panic' ? 'dealer-speech-panic' : 'dealer-speech-idle'
        }`}
      >
        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-transparent border-l-2 border-t-2 border-[var(--neon-green)] rotate-45" />
        <p className="text-xs font-sans leading-relaxed text-[#e8fff5] drop-shadow-[0_0_6px_rgba(0,255,160,0.65)]">
          {line}
          <span className="inline-block w-1.5 h-3 bg-[var(--neon-green)] ml-0.5 opacity-80 animate-pulse align-middle" />
        </p>
      </div>

      <div className="flex gap-2 relative z-10">
        <button className="neon-btn-yellow rounded px-2 py-2 text-[11px] font-sans flex-1 flex items-center justify-center gap-1.5">
          <span className="text-sm">✨</span>
          ルール相談
        </button>
        <button className="neon-btn rounded px-2 py-2 text-[11px] font-sans flex-1 flex items-center justify-center gap-1.5">
          <span className="text-sm">🪄</span>
          場を作成
        </button>
      </div>

      <div className="flex-1" />

      <div className="pt-2 border-t border-[var(--border)] relative z-10">
        <div className="text-[10px] text-[var(--muted-foreground)] font-sans text-center tracking-wider">
          DEALER STATUS: {effectiveEmotion === 'panic' ? 'PANIC' : 'READY'} // MODEL: v2.1 // TAP:{' '}
          {interactionCount}
        </div>
      </div>
    </div>
  );
}

