import React from 'react';
import Card from './Card';

type MemoryState = {
    status: 'playing' | 'finished';
    board: {
        id: string;
        rank: string;
        suit: string;
        faceUp: boolean;
        matched: boolean;
    }[];
    turnSeat: string[];
    turnIndex: number;
    scores: Record<string, number>;
    lockUntil: number;
};

type Props = {
    state: MemoryState;
    players: any[];
    myId: string;
    isSpectator: boolean;
    onFlip: (cardId: string) => void;
};

export default function MemoryGameView({ state, players, myId, isSpectator, onFlip }: Props) {
    const { board, turnSeat, turnIndex, scores, status, lockUntil } = state;

    const currentTurnPlayerId = turnSeat[turnIndex];
    const isMyTurn = currentTurnPlayerId === myId;
    const currentTurnPlayer = players.find(p => p.id === currentTurnPlayerId);

    // Sort players by turn order for scoreboard
    const sortedPlayers = turnSeat.map(id => players.find(p => p.id === id)).filter(Boolean);

    return (
        <div className="flex flex-col items-center justify-center p-4 w-full h-full bg-green-900/50">
            {/* Header / HUD */}
            <div className="flex justify-between w-full max-w-4xl bg-black/40 p-4 rounded-lg mb-8 items-center">
                <div>
                    <h2 className="text-2xl font-bold text-yellow-400">神経衰弱 (Memory)</h2>
                    <div className="text-gray-300">
                        {status === 'finished' ? (
                            <span className="text-red-400 font-bold animate-pulse">GAME OVER</span>
                        ) : (
                            isMyTurn ? <span className="text-green-400 font-bold text-xl">あなたの番です！</span>
                                : <span className="text-white">{currentTurnPlayer?.name} の番です</span>
                        )}
                    </div>
                </div>

                {/* Scoreboard */}
                <div className="flex gap-4">
                    {sortedPlayers.map(p => {
                        const score = scores[p!.id] || 0;
                        const isCurrent = p!.id === currentTurnPlayerId;
                        return (
                            <div key={p!.id} className={`flex flex-col items-center p-2 rounded ${isCurrent ? 'bg-yellow-600/50 border border-yellow-400' : 'bg-gray-800'}`}>
                                <span className="font-bold text-sm">{p!.name}</span>
                                <span className="text-2xl font-mono">{score}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-4 gap-4 p-4 bg-green-800 rounded-xl shadow-2xl border-4 border-green-900">
                {board.map(card => {
                    // Logic to show/hide
                    // In Memory, board array has faceUp property. 
                    // If faceUp, show Card. If not, show Back.
                    // Matched cards are shown but maybe dimmed.

                    const handleClick = () => {
                        if (isSpectator) return;
                        if (!isMyTurn) return;
                        if (card.faceUp || card.matched) return;
                        if (Date.now() < lockUntil) return; // Client-side optimistic check
                        onFlip(card.id);
                    };

                    return (
                        <div
                            key={card.id}
                            onClick={handleClick}
                            className={`
                                relative w-24 h-36 transition-all transform duration-300
                                ${card.matched ? 'opacity-50' : 'opacity-100 hover:scale-105 cursor-pointer'}
                                ${(!card.faceUp && !isSpectator && isMyTurn) ? 'hover:ring-2 hover:ring-yellow-400' : ''}
                            `}
                        >
                            {card.faceUp || card.matched ? (
                                <Card
                                    card={{ ...card, id: card.id, name: `${card.suit}-${card.rank}` }} // Match Card type roughly
                                    onClick={() => { }}
                                    className={card.matched ? "opacity-50" : ""}
                                />
                            ) : (
                                // Card Back
                                <div className="w-full h-full bg-blue-700 rounded-lg border-2 border-white shadow-md flex items-center justify-center bg-[url('/card_back_pattern.png')]">
                                    <span className="text-white/20 text-4xl">♠</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {isSpectator && (
                <div className="mt-4 bg-gray-800 text-gray-400 px-4 py-2 rounded-full border border-gray-600">
                    👁 観戦中：操作できません
                </div>
            )}
        </div>
    );
}
