import React from 'react';

type CardProps = {
    card: string | { name: string; text?: string;[key: string]: any };
    isFaceDown?: boolean;
    onClick?: () => void;
    className?: string; // Allow custom styling positioning
    style?: React.CSSProperties;
    isPreview?: boolean;
};

// Helper to detect trump cards
const getTrumpVisuals = (name: string) => {
    // Patterns: "DATA-SUIT-RANK" or just "SUIT RANK" or "SUIT-RANK"
    // Suits: S, H, D, C (Spade, Heart, Diamond, Club)
    // Ranks: A, 2-10, J, Q, K
    // Examples: "S-A", "H-10", "D-K", "C-2"
    // Also support symbols directly? "♠A"

    // Normalize
    const n = name.toUpperCase().trim();

    // Simple parser for S-A format
    const match = n.match(/^([SHDC])[- ]?([A2-9]|10|[JQK]|)$/);
    if (match) {
        const suitChar = match[1];
        const rank = match[2];
        const suitMap: any = { 'S': '♠', 'H': '♥', 'D': '♦', 'C': '♣' };
        const colorMap: any = { 'S': 'black', 'H': 'red', 'D': 'red', 'C': 'black' };
        return { suit: suitMap[suitChar], rank, color: colorMap[suitChar] };
    }

    // Symbol parser
    const symbolMatch = n.match(/^([♠♥♦♣])\s*([A2-9]|10|[JQK])$/);
    if (symbolMatch) {
        const suit = symbolMatch[1];
        const rank = symbolMatch[2];
        const color = (suit === '♥' || suit === '♦') ? 'red' : 'black';
        return { suit, rank, color };
    }

    return null;
};

export default function Card({ card, isFaceDown, onClick, className = '', style }: CardProps) {
    const cardName = typeof card === 'string' ? card : card.name;
    const effectiveFaceDown = isFaceDown || cardName === 'Back';
    const isRoleCard = typeof card === 'object' && card.type === 'role';
    const trump = !effectiveFaceDown && !isRoleCard ? getTrumpVisuals(cardName) : null;
    const isJoker = !effectiveFaceDown && !isRoleCard && cardName === 'Joker';

    if (isRoleCard) {
        return (
            <div
                onClick={onClick}
                className={`
                    relative w-24 h-32 rounded-xl shadow-lg border-4 border-yellow-600 select-none
                    transition-transform hover:scale-105 cursor-pointer flex flex-col items-center justify-between
                    overflow-hidden bg-gray-800 text-yellow-500 p-2
                    ${className}
                `}
                style={style}
            >
                <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">YOUR ROLE</div>
                <div className="text-5xl font-black text-white drop-shadow-md">{(card as any).roleLetter || (card as any).meta?.roleLetter}</div>
                <div className="text-sm font-bold bg-white/10 px-2 py-0.5 rounded w-full text-center whitespace-nowrap overflow-hidden text-ellipsis">
                    {(card as any).roleName || (card as any).meta?.roleName}
                </div>
            </div>
        );
    }

    return (
        <div
            onClick={onClick}
            className={`
                relative w-20 h-28 rounded-lg shadow-md border border-gray-300 select-none
                transition-transform hover:scale-105 cursor-pointer flex flex-col items-center justify-center
                overflow-hidden bg-white
                ${className}
            `}
            style={style}
        >
            {effectiveFaceDown ? (
                // Back Design
                <div className="w-full h-full bg-blue-900 flex items-center justify-center">
                    <div className="w-16 h-24 border-2 border-blue-400/30 rounded flex items-center justify-center">
                        <span className="text-2xl opacity-20">🎲</span>
                    </div>
                </div>
            ) : isJoker ? (
                // Joker Design
                <div className="w-full h-full flex flex-col justify-between p-1 text-purple-600 bg-purple-50">
                    <div className="text-left text-xs font-bold leading-none">JOKER</div>
                    <div className="text-center text-4xl">🤡</div>
                    <div className="text-right text-xs font-bold leading-none transform rotate-180">JOKER</div>
                </div>
            ) : trump ? (
                // Trump Design
                <div className={`w-full h-full flex flex-col justify-between p-0.5 pb-1 text-${trump.color === 'red' ? 'red-600' : 'black'}`}>
                    <div className="text-left text-[10px] font-bold leading-none pl-0.5 pt-0.5">{trump.rank}<br />{trump.suit}</div>

                    {/* Pips Area */}
                    <div className="flex-1 flex items-center justify-center relative overflow-hidden">
                        {(() => {
                            const r = trump.rank;
                            const s = trump.suit;
                            const isFace = ['J', 'Q', 'K'].includes(r);
                            const isAce = r === 'A';
                            const num = parseInt(r);

                            if (isAce) return <div className="text-4xl">{s}</div>;
                            if (isFace) {
                                const faceIcon = r === 'J' ? '🤴' : r === 'Q' ? '👸' : '♚';
                                return <div className="text-4xl">{faceIcon}</div>;
                            }

                            // Simplified robust layout map (Row %, Col %)
                            const layouts: any = {
                                2: [{ t: 20, l: 50 }, { t: 80, l: 50, inv: true }],
                                3: [{ t: 20, l: 50 }, { t: 50, l: 50 }, { t: 80, l: 50, inv: true }],
                                4: [{ t: 20, l: 25 }, { t: 20, l: 75 }, { t: 80, l: 25, inv: true }, { t: 80, l: 75, inv: true }],
                                5: [{ t: 20, l: 25 }, { t: 20, l: 75 }, { t: 50, l: 50 }, { t: 80, l: 25, inv: true }, { t: 80, l: 75, inv: true }],
                                6: [{ t: 20, l: 25 }, { t: 20, l: 75 }, { t: 50, l: 25 }, { t: 50, l: 75 }, { t: 80, l: 25, inv: true }, { t: 80, l: 75, inv: true }],
                                7: [{ t: 20, l: 25 }, { t: 20, l: 75 }, { t: 40, l: 50 }, { t: 50, l: 25 }, { t: 50, l: 75 }, { t: 80, l: 25, inv: true }, { t: 80, l: 75, inv: true }],
                                8: [{ t: 20, l: 25 }, { t: 20, l: 75 }, { t: 40, l: 50 }, { t: 60, l: 50, inv: true }, { t: 50, l: 25 }, { t: 50, l: 75 }, { t: 80, l: 25, inv: true }, { t: 80, l: 75, inv: true }],
                                9: [{ t: 20, l: 25 }, { t: 20, l: 75 }, { t: 40, l: 25 }, { t: 40, l: 75 }, { t: 50, l: 50 }, { t: 60, l: 25, inv: true }, { t: 60, l: 75, inv: true }, { t: 80, l: 25, inv: true }, { t: 80, l: 75, inv: true }],
                                10: [{ t: 20, l: 25 }, { t: 20, l: 75 }, { t: 40, l: 25 }, { t: 40, l: 75 }, { t: 30, l: 50 }, { t: 70, l: 50, inv: true }, { t: 60, l: 25, inv: true }, { t: 60, l: 75, inv: true }, { t: 80, l: 25, inv: true }, { t: 80, l: 75, inv: true }],
                            };

                            if (!isNaN(num)) {
                                const layout = layouts[num];
                                if (layout) {
                                    return (
                                        <div className="relative w-full h-full">
                                            {layout.map((p: any, i: number) => (
                                                <div
                                                    key={i}
                                                    className="absolute transform -translate-x-1/2 -translate-y-1/2 text-xs"
                                                    style={{
                                                        top: `${p.t}%`,
                                                        left: `${p.l}%`,
                                                        transform: `translate(-50%, -50%) ${p.inv ? 'rotate(180deg)' : ''}`
                                                    }}
                                                >
                                                    {s}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                }
                            }
                            return <div className="text-2xl">{s}</div>;
                        })()}
                    </div>

                    <div className="text-right text-[10px] font-bold leading-none transform rotate-180 pr-0.5 pb-0.5">{trump.rank}<br />{trump.suit}</div>
                </div>
            ) : (
                // Generic Text Design
                <div className="p-1 text-center break-words text-xs font-bold text-gray-800 leading-tight">
                    {cardName}
                </div>
            )}
        </div>
    );
}
