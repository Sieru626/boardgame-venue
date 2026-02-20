'use client';

import { Socket } from 'socket.io-client';
import { useState } from 'react';
import GameSetupOverlay from './GameSetupOverlay';

type OldMaidState = {
    status: 'idle' | 'setup' | 'playing' | 'finished';
    turnIndex: number;
    order: string[];
    discardPile: any[];
    winners: string[];
};

type Player = {
    id: string;
    name: string;
    hand: any[]; // masked
    isOut?: boolean;
    status: string;
    isHost?: boolean;
};

type Props = {
    socket: Socket | null;
    roomId: string;
    userId: string;
    state: {
        phase: string;
        players: Player[];
        oldMaid: OldMaidState;
    };
};

export default function OldMaidView({ socket, roomId, userId, state }: Props) {
    const { players, oldMaid } = state;
    const [selectedCardIdx, setSelectedCardIdx] = useState<number | null>(null);

    const isMyTurn = oldMaid.status === 'playing' &&
        oldMaid.order[oldMaid.turnIndex] === userId;

    // Use server-provided targetId if available
    const targetId = (oldMaid as any).targetId;

    const handlePick = () => {
        if (!socket || !isMyTurn || selectedCardIdx === null) return;
        socket.emit('oldmaid_pick_from_left', { roomId, userId, pickIndex: selectedCardIdx }, (res: any) => {
            if (res.ok) {
                setSelectedCardIdx(null); // Reset selection
            } else {
                alert(res.error || 'Pick failed');
            }
        });
    };

    return (
        <div className="flex flex-col h-full bg-green-900/20 p-4 relative">
            {/* Setup / Preparation Phase Overlay */}
            {oldMaid.status === 'setup' && (
                <GameSetupOverlay
                    title="ババ抜き - 参加者確認"
                    players={players}
                    userId={userId}
                    isHost={players.find(p => p.id === userId)?.isHost ?? false}
                    onToggleSpectator={(targetId) => {
                        socket?.emit('host_action', { roomId, type: 'toggle_spectator', payload: { targetUserId: targetId }, userId });
                    }}
                    onSelfToggle={(isSpectator) => {
                        socket?.emit('self_set_spectator', { roomId, userId, isSpectator }, (res: any) => {
                            if (!res.ok) alert(res.error);
                        });
                    }}
                    onStartGame={() => {
                        socket?.emit('oldmaid_start_game', { roomId, userId, confirm: true }, (res: any) => {
                            if (!res.ok) alert(res.error);
                        });
                    }}
                />
            )}

            {/* Central Status Overlay for Important Events */}
            {oldMaid.status === 'finished' && (
                <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center animate-in fade-in duration-500">
                    <h1 className="text-6xl font-bold text-yellow-400 mb-4 drop-shadow-lg">ゲーム終了</h1>
                    <div className="text-2xl text-white">
                        敗者: <span className="font-bold text-red-500">{players.find(p => !p.isOut)?.name || 'なし'}</span> 💀
                    </div>
                </div>
            )}

            {/* Turn Indicator Overlay (Flash) */}
            {isMyTurn && oldMaid.status !== 'finished' && (
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
                    <div className="bg-yellow-500/90 text-black px-8 py-4 rounded-xl shadow-2xl transform animate-bounce">
                        <span className="text-3xl font-bold">あなたの番です！</span>
                        <div className="text-sm font-bold mt-1 text-center">カードを引いてください</div>
                    </div>
                </div>
            )}

            {/* Header / Info */}
            <div className="text-center mb-6 shrink-0">
                <h2 className="text-2xl font-bold text-green-400 mb-2 drop-shadow-md">🃏 ババ抜き</h2>
                <div className="text-sm text-gray-300 bg-black/40 inline-block px-4 py-2 rounded-full backdrop-blur-sm">
                    {oldMaid.status !== 'finished' && (
                        <span>
                            手番: <span className="font-bold text-white text-lg">{players.find(p => p.id === oldMaid.order[oldMaid.turnIndex])?.name || 'Unknown'}</span>
                        </span>
                    )}
                    <span className="mx-4 text-gray-500">|</span>
                    <span>捨て札: {oldMaid.discardPile.length} 枚</span>
                </div>
            </div>

            {/* Main Board Area */}
            <div className="flex-1 overflow-y-auto px-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pb-20">
                    {players.map(p => {
                        const isTurn = oldMaid.order[oldMaid.turnIndex] === p.id;
                        const isMe = p.id === userId;
                        const isTarget = p.id === targetId;
                        const isWinner = oldMaid.winners?.includes(p.id);
                        const isLoser = oldMaid.status === 'finished' && !isWinner;

                        // Interaction: Can pick if My Turn AND This is Target
                        const canPick = isMyTurn && isTarget;

                        return (
                            <div key={p.id} className={`
                                relative p-4 rounded-xl border-2 min-h-[180px] flex flex-col items-center justify-between transition-all duration-300
                                ${isTurn ? 'border-yellow-400 bg-yellow-900/30 scale-[1.02] shadow-[0_0_15px_rgba(250,204,21,0.3)]' : 'border-gray-700 bg-gray-800/80'}
                                ${isWinner ? 'border-green-500/50 bg-green-900/20 grayscale opacity-70' : ''}
                                ${isLoser ? 'border-red-500 bg-red-900/40' : ''}
                                ${canPick ? 'ring-4 ring-blue-500 ring-offset-4 ring-offset-gray-900 shadow-xl' : ''}
                            `}>
                                {/* Player Label */}
                                <div className="font-bold text-center mb-4 w-full border-b border-white/10 pb-2">
                                    <div className="text-white text-xl flex items-center justify-center gap-2">
                                        {String(p?.name ?? '')} {isMe && <span className="text-xs bg-blue-600 px-1 rounded text-white">YOU</span>}
                                    </div>
                                    {isWinner && <div className="text-green-400 text-sm font-bold uppercase mt-1">勝ち抜け 👑</div>}
                                    {isLoser && <div className="text-red-400 text-sm font-bold uppercase mt-1">敗者 💀</div>}
                                    {isTurn && !isWinner && !isLoser && <div className="text-yellow-400 text-sm animate-pulse mt-1">考え中...</div>}
                                </div>

                                {/* Hand Display */}
                                <div className="flex flex-wrap justify-center gap-2 my-2 w-full px-2">
                                    {p.hand.length === 0 && isWinner && (
                                        <div className="text-6xl animate-bounce">🎉</div>
                                    )}
                                    {p.hand.map((card: any, idx: number) => {
                                        // Helper to render card face
                                        const getCardVisual = (name: string) => {
                                            if (name === 'Back') return { color: 'text-blue-300', text: '🂠', bg: 'bg-gradient-to-br from-blue-900 to-blue-800 border-blue-600', isBack: true };
                                            if (name === 'Joker') return { color: 'text-purple-600', text: '🤡', bg: 'bg-white border-purple-400' };

                                            const [suit, rank] = name.split('-');
                                            const suitIcon = { S: '♠', H: '♥', D: '♦', C: '♣' }[suit] || '?';
                                            const isRed = suit === 'H' || suit === 'D';

                                            return {
                                                color: isRed ? 'text-red-600' : 'text-black',
                                                suit: suitIcon,
                                                rank: rank,
                                                bg: 'bg-white border-gray-300'
                                            };
                                        };

                                        const isHidden = !isMe && state.phase === 'oldmaid' && oldMaid.status !== 'finished';
                                        // Specific: If picking from target, ALWAYS BACK but interactive
                                        const visual = isHidden ? getCardVisual('Back') : getCardVisual(card.name);
                                        const isSelected = canPick && selectedCardIdx === idx;

                                        return (
                                            <button
                                                key={card.id || idx}
                                                disabled={!canPick}
                                                onClick={() => canPick && setSelectedCardIdx(idx)}
                                                className={`
                                                    w-12 h-16 md:w-14 md:h-20 rounded-lg border-2 flex flex-col items-center justify-center 
                                                    cursor-pointer transition-all duration-200 select-none shadow-md
                                                    ${visual.bg} ${visual.color}
                                                    ${isSelected ? 'ring-4 ring-yellow-400 -translate-y-4 scale-110 z-20 shadow-xl' : 'hover:-translate-y-1 hover:shadow-lg'}
                                                    ${!canPick && !isMe ? 'opacity-90' : ''}
                                                `}
                                            >
                                                {visual.isBack ? (
                                                    <span className="text-3xl opacity-50">?</span>
                                                ) : (
                                                    <>
                                                        <span className="text-lg md:text-xl leading-none mb-1">{visual.suit || visual.text}</span>
                                                        <span className="text-lg md:text-2xl font-bold leading-none">{visual.rank}</span>
                                                    </>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="text-xs text-gray-500 mt-2 font-mono">{p.hand.length} 枚</div>

                                {/* Action Button */}
                                {canPick && selectedCardIdx !== null && (
                                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 rounded-xl backdrop-blur-[1px]">
                                        <button
                                            onClick={handlePick}
                                            className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-lg px-8 py-3 rounded-full shadow-2xl animate-bounce transform hover:scale-110 transition"
                                        >
                                            これにする！
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
