import React, { useState, useEffect, useRef } from 'react';
import Card from './Card';

type Player = { id: string; name: string; hand: any[]; isOut?: boolean; role?: any; isSpectator?: boolean };

type Props = {
    roomId: string;
    userId: string;
    state: any; // Full game state passed down, or at least { players, mixjuice, ... }
    socket: any;
    drawCard: () => void; // Fallback helper
};

type UIPhase = 'idle' | 'dealing' | 'playing' | 'result';

export default function MixJuiceGameView({ roomId, userId, state, socket }: Props) {
    const { mixjuice: mjData, players } = state;
    const myPlayer = players.find((p: Player) => p.id === userId);

    // Local State for Animations
    const [uiPhase, setUiPhase] = useState<UIPhase>('idle');
    const [dealStep, setDealStep] = useState(0);
    const [resultModalData, setResultModalData] = useState<any>(null);

    // Trackers
    const prevRound = useRef<number>(mjData.round);
    // Store previous hand for fallback result calculation if needed
    const prevHand = useRef<any[]>([]);

    // --- Phase Detection Logic ---
    useEffect(() => {
        // Store current hand before round potentially increments and hand resets
        if (myPlayer && myPlayer.hand && myPlayer.hand.length > 0 && mjData.round === prevRound.current) {
            prevHand.current = myPlayer.hand;
        }

        // Detect Round Change
        if (mjData.round > prevRound.current) {
            const lastResult = mjData.lastRoundResult;

            // Fallback Logic: If server didn't send result, calc locally
            let resultToShow = lastResult;

            if (!resultToShow && lastResult === undefined) {
                // Calculate local result for MVP fallback
                // Use prevHand to calculate result for the round that just ended
                const sum = prevHand.current.reduce((acc, card) => acc + card.value, 0);
                const hasZero = prevHand.current.some(card => card.value === 0);

                resultToShow = {
                    round: prevRound.current, // This result is for the round that just finished
                    rankings: [{
                        id: userId,
                        name: myPlayer?.name || 'You',
                        sum: sum,
                        hasZero: hasZero,
                        isWin: sum >= 7 && !hasZero,
                    }],
                    // Add other players with dummy data or just omit for simplicity
                };
                console.warn(`Fallback: lastRoundResult missing for round ${prevRound.current}. Calculated local result:`, resultToShow);
            }

            const isFreshResult = resultToShow && resultToShow.round === prevRound.current;

            if (isFreshResult) {
                setResultModalData(resultToShow);
                setUiPhase('result');
                // Manual interaction required for result confirmation
                // setTimeout(() => {
                //     startDealingAnimation();
                // }, 2000);
            } else {
                // If no fresh result (either missing or for a different round), just start dealing
                startDealingAnimation();
            }
            prevRound.current = mjData.round;
        }
        // Initial Game Load (Round 1)
        else if (mjData.round === 1 && mjData.turnCount === 0 && uiPhase === 'idle' && !resultModalData) {
            startDealingAnimation();
        }
    }, [mjData.round, mjData.lastRoundResult, mjData.turnCount, userId, myPlayer]);

    const startDealingAnimation = () => {
        setResultModalData(null);
        setUiPhase('dealing');
        setDealStep(0);
        setTimeout(() => setDealStep(1), 250);
        setTimeout(() => setDealStep(2), 500);
        setTimeout(() => {
            setUiPhase('playing');
        }, 1000);
    };

    const isMyTurn = mjData.turnSeat && mjData.turnSeat[mjData.turnIndex] === userId;
    const isBlocked = uiPhase !== 'playing';
    const [mjActionPending, setMjActionPending] = useState<'none' | 'change'>('none');

    // Result Calculation
    const myRankData = resultModalData?.rankings?.find((r: any) => r.id === userId);
    // Fallback display if no rank data but we have a result structure
    const mySum = myRankData?.sum ?? 0;
    const isWin = myRankData ? (mySum >= 7 && !myRankData.hasZero) : false;

    return (
        <div className="absolute inset-0 z-0">

            {/* 1. Center Info */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center z-0 pointer-events-none">
                <div className="bg-black/40 backdrop-blur-sm p-6 rounded-2xl border border-white/10 text-center animate-in fade-in zoom-in-95 duration-500">
                    <div className="text-yellow-400 font-black text-4xl mb-2 drop-shadow-md">ROUND {mjData.round} / {mjData.roundMax}</div>
                    <div className="text-gray-300 font-bold mb-4">Turn {mjData.turnCount}</div>

                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-left">
                        {players.filter((p: any) => !p.isSpectator).map((p: any) => (
                            <React.Fragment key={p.id}>
                                <div className={`font-bold ${p.id === userId ? 'text-blue-300' : 'text-gray-400'}`}>{p.name}</div>
                                <div className="text-right font-mono text-yellow-200">{mjData.scores[p.id] || 0} pt</div>
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            </div>

            {/* 2. My Actions Control (Only in Playing Phase) */}
            {isMyTurn && !isBlocked && (
                <div className="absolute bottom-40 left-1/2 -translate-x-1/2 z-[90] flex gap-4 animate-in slide-in-from-bottom-10 fade-in duration-300">
                    <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-xl flex gap-4">
                        <button
                            onClick={() => socket.emit('mixjuice_action', { roomId, userId, type: 'pass' })}
                            className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-3 px-8 rounded-lg shadow-lg border border-gray-500 active:scale-95 transition"
                        >
                            パス
                        </button>
                        <button
                            onClick={() => setMjActionPending(mjActionPending === 'change' ? 'none' : 'change')}
                            className={`font-bold py-3 px-8 rounded-lg shadow-lg border active:scale-95 transition ${mjActionPending === 'change' ? 'bg-yellow-500 text-black border-yellow-300 animate-pulse' : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-400'}`}
                        >
                            {mjActionPending === 'change' ? '選択...' : 'チェンジ'}
                        </button>
                        <button
                            onClick={() => {
                                if (confirm('手札を全て捨てて2枚引き直しますか？')) {
                                    socket.emit('mixjuice_action', { roomId, userId, type: 'shuffle_hand' });
                                }
                            }}
                            className="bg-pink-600 hover:bg-pink-500 text-white font-bold py-3 px-8 rounded-lg shadow-lg border border-pink-400 active:scale-95 transition"
                        >
                            冷蔵庫
                        </button>
                    </div>
                </div>
            )}

            {/* Change Guide */}
            {mjActionPending === 'change' && !isBlocked && (
                <div className="absolute top-32 left-1/2 -translate-x-1/2 bg-yellow-500 text-black font-bold px-4 py-2 rounded shadow-lg animate-bounce z-[100]">
                    捨てるカードを選んでください
                </div>
            )}

            {/* 3. Hand Rendering (Controlled by dealStep during dealing, else fully visible) */}
            {!myPlayer?.isSpectator && (
                <div className="absolute bottom-0 left-0 w-full h-48 flex justify-center items-end py-4 gap-4 pointer-events-none z-50">
                    {/* Render cards */}
                    {myPlayer.hand.map((card: any, idx: number) => {
                        // Visibility Check
                        const isVisible = uiPhase === 'dealing' ? idx < dealStep : true;
                        if (!isVisible) return <div key={idx} className="w-32 h-44 border-2 border-white/10 rounded opacity-20" />;

                        // Detect Change (Swap)
                        const prevCard = prevHand.current[idx];
                        const isChanged = prevCard && prevCard.id !== card.id && uiPhase === 'playing';

                        // Interaction logic
                        const canInteract = mjActionPending === 'change' && !isBlocked;

                        return (
                            <div
                                key={card.id || idx} // Use ID to force re-render/anim on change
                                className={`
                                    relative transition-all duration-300 pointer-events-auto
                                    ${uiPhase === 'dealing' ? 'animate-in slide-in-from-bottom-20 fade-in duration-300' : ''}
                                    ${isChanged ? 'animate-pulse ring-4 ring-green-400 rounded-lg' : ''}
                                    ${canInteract ? 'cursor-pointer hover:-translate-y-8 hover:scale-110 z-50' : ''}
                                `}
                                onClick={() => {
                                    if (canInteract) {
                                        socket.emit('mixjuice_action', { roomId, userId, type: 'change', targetIndex: idx });
                                        setMjActionPending('none');
                                    }
                                }}
                            >
                                <Card
                                    card={card}
                                    className={`
                                        w-32 h-44 shadow-2xl border-2 border-gray-700
                                        ${canInteract ? 'ring-4 ring-yellow-400' : ''}
                                        ${isChanged ? 'shadow-[0_0_30px_rgba(74,222,128,0.6)] border-green-400' : ''}
                                    `}
                                />
                                {isChanged && (
                                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 text-green-400 font-black text-xl animate-bounce whitespace-nowrap drop-shadow-md">
                                        NEW!
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 4. Overlays - FIXED & HIGH Z-INDEX */}

            {/* Dealing Overlay */}
            {uiPhase === 'dealing' && (
                <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300 pointer-events-none">
                    <div className="text-white text-2xl font-black tracking-[0.5em] animate-pulse drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] px-8 text-center max-w-sm">
                        DEALING...
                    </div>
                </div>
            )}

            {/* Result Modal (Simple Text Version as requested) */}
            {uiPhase === 'result' && resultModalData && (
                <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-gray-900 border-4 border-white/20 p-10 rounded-2xl max-w-lg w-full shadow-2xl text-center transform scale-110">
                        <div className="text-gray-400 font-bold mb-2 tracking-widest text-sm">ROUND RESULT</div>

                        {/* Win/Lose Big Text */}
                        <div className={`text-6xl font-black mb-6 ${isWin ? 'text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.6)]' : 'text-blue-500'}`}>
                            {isWin ? 'WIN!' : 'LOSE...'}
                        </div>

                        {/* Detail */}
                        <div className="text-white text-2xl font-bold mb-8">
                            合計スコア: <span className="font-mono text-4xl ml-2">{mySum}</span>
                        </div>

                        {/* Manual Proceed Button */}
                        <div className="mt-8">
                            <button
                                onClick={() => startDealingAnimation()}
                                className="bg-white hover:bg-gray-200 text-black font-black py-3 px-12 rounded-full shadow-[0_0_15px_rgba(255,255,255,0.4)] hover:shadow-[0_0_25px_rgba(255,255,255,0.6)] transform transition active:scale-95 text-xl"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                @keyframes shrink { from { width: 100%; } to { width: 0%; } }
            `}</style>
        </div>
    );
}

