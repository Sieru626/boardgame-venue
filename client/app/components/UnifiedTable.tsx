import React, { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { AnimatePresence } from 'framer-motion';
import Card from './Card';
import GameSetupOverlay from './GameSetupOverlay';
import MemoryGameView from './MemoryGameView';
import MixJuiceGameView from './MixJuiceGameView';

type Player = { id: string; name: string; hand: any[]; isOut?: boolean; role?: any; isSpectator?: boolean };
type FreeTalkState = {
    status: 'playing' | 'finished';
    currentScene?: any;
    currentLaw?: any;
    medals: { [key: string]: number };
    config?: { winMedals: number; roundSeconds: number };
    timer?: { roundSeconds: number; endsAt: number | null; isRunning: boolean };
};

type Props = {
    roomId: string;
    userId: string;
    state: any;
    socket: any;
    drawCard: () => void;
    playCard: (idx: number) => void;
    rollDice: (sides: number) => void;
    deckEditorOpen?: boolean;
};

// Animation Helper (since we can't edit globals.css easily in this flow, we inject style)
const shakeStyle = `
@keyframes shake-short {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
}
.animate-shake-short { animation: shake-short 0.3s ease-in-out; }
`;




const FALLBACK_ROLE_DEFINITIONS: any = {
    'A': { name: '将軍', description: '最高司令。最終決定権を持つ。' },
    'B': { name: '参謀長', description: '作戦立案。論理的な提案を行う。' },
    'C': { name: '情報将校', description: '諜報・監視。他者の嘘を見抜く。' },
    'D': { name: '検閲官', description: '思想統制。不適切な発言を正す。' },
    'E': { name: '兵站将校', description: '物資・補給。現実的なリソース管理。' },
    'F': { name: '宣伝将校', description: 'プロパガンダ。士気を高める発言。' },
    'G': { name: '外交官', description: '対外交渉。外部との関係を考慮。' },
    'H': { name: '民間代表', description: '現場の声。市民の感情を代弁。' }
};

export default function UnifiedTable({ roomId, userId, state, socket, drawCard, playCard, rollDice, deckEditorOpen }: Props) {
    const isOldMaid = state.phase === 'oldmaid';
    const isMixJuice = state.phase === 'mixjuice';
    // Old Maid State Accessors
    const oldMaidData = state.oldMaid || {};
    const mixJuiceData = state.mixjuice || {};
    // const opponents = state.players.filter((p: Player) => p.id !== userId && !p.isSpectator); // Moved to Seating Logic
    const myPlayer = state.players.find((p: Player) => p.id === userId);

    // UI State
    const [showDiceMenu, setShowDiceMenu] = useState(false);
    const [selectedCardIdx, setSelectedCardIdx] = useState<number | null>(null);
    const [pulledCard, setPulledCard] = useState<any>(null); // Task A: Self-Preview
    const [activeEffects, setActiveEffects] = useState<{ [key: string]: string }>({}); // ID -> EffectClass
    const [_, setTick] = useState(0); // For Timer Force Update
    const [expandHeader, setExpandHeader] = useState(true); // Phase 3 UX: Accordion Header
    const [isHandCollapsed, setIsHandCollapsed] = useState(false); // 手札パネルの開閉（場が見えづらい問題対策）

    // --- Phase 3: Visual State ---
    const [revealPopup, setRevealPopup] = useState<{ title: string, text: string, type: 'scene' | 'law' } | null>(null);
    const [floatingTexts, setFloatingTexts] = useState<{ [key: string]: { text: string, id: number }[] }>({});
    const prevSceneId = React.useRef<string | null>(null);
    const prevLawId = React.useRef<string | null>(null);
    const prevMedals = React.useRef<{ [key: string]: number }>({});
    const prevChatLength = React.useRef<number>(0);

    const prevHandCounts = React.useRef<{ [key: string]: number }>({});

    // --- Derived State ---
    const isMyTurn = isOldMaid && oldMaidData.status === 'playing' && oldMaidData.order[oldMaidData.turnIndex] === userId;
    const isMyTurnMJ = isMixJuice && mixJuiceData.status === 'playing' && mixJuiceData.turnSeat && mixJuiceData.turnSeat[mixJuiceData.turnIndex] === userId;
    const targetId = oldMaidData.targetId;

    // Mix Juice Pending Action State
    const [mjActionPending, setMjActionPending] = useState<'none' | 'change'>('none');

    // --- FreeTalk Logic ---
    const isFreeTalk = state.phase === 'free_talk';
    const freeTalk: FreeTalkState = state.freeTalk || { medals: {} };
    const timer = freeTalk.timer;
    const config = freeTalk.config;

    // --- Phase 3: Visual Effects Logic ---
    React.useEffect(() => {
        if (!isFreeTalk) return;

        // 1. Reveal Popup (Scene)
        if (freeTalk.currentScene?.id !== prevSceneId.current) {
            if (freeTalk.currentScene) {
                setRevealPopup({ title: freeTalk.currentScene.name, text: freeTalk.currentScene.text, type: 'scene' });
                setTimeout(() => setRevealPopup(null), 2500);
            }
            prevSceneId.current = freeTalk.currentScene?.id;
        }
        // 2. Reveal Popup (Law)
        if (freeTalk.currentLaw?.id !== prevLawId.current) {
            if (freeTalk.currentLaw) {
                setRevealPopup({ title: freeTalk.currentLaw.name, text: freeTalk.currentLaw.text, type: 'law' });
                setTimeout(() => setRevealPopup(null), 2500);
            }
            prevLawId.current = freeTalk.currentLaw?.id;
        }

        // 3. Floating Medals
        Object.entries(freeTalk.medals).forEach(([pid, count]) => {
            const old = prevMedals.current[pid] ?? 0;
            if (count !== old) {
                const diff = count - old;
                const text = diff > 0 ? `+${diff}` : `${diff}`;
                addFloatingText(pid, text);
            }
        });
        prevMedals.current = freeTalk.medals;

    }, [freeTalk, isFreeTalk]);

    // Timer Tick Effect
    React.useEffect(() => {
        if (!timer?.isRunning) return;
        const interval = setInterval(() => setTick(t => t + 1), 200); // 5fps update
        return () => clearInterval(interval);
    }, [timer?.isRunning]);

    // Detect Denounce in Chat (Juiciness Lite)
    React.useEffect(() => {
        if (!state.chat) return;
        if (state.chat.length > prevChatLength.current) {
            const newMsgs = state.chat.slice(prevChatLength.current);
            newMsgs.forEach((m: any) => {
                if (m.message && m.message.includes('密告しました')) {
                    state.players.forEach((p: Player) => {
                        if (m.message.includes(p.name)) {
                            triggerShake(p.id);
                        }
                    });
                }
            });
            prevChatLength.current = state.chat.length;
        }
    }, [state.chat]);

    const addFloatingText = (playerId: string, text: string) => {
        const id = Date.now();
        setFloatingTexts(prev => ({
            ...prev,
            [playerId]: [...(prev[playerId] || []), { text, id }]
        }));
        setTimeout(() => {
            setFloatingTexts(prev => ({
                ...prev,
                [playerId]: (prev[playerId] || []).filter(f => f.id !== id)
            }));
        }, 1000);
    };

    const triggerShake = (playerId: string) => {
        setActiveEffects(prev => ({ ...prev, [playerId]: 'animate-shake-short' }));
        setTimeout(() => {
            setActiveEffects(prev => {
                const n = { ...prev };
                delete n[playerId];
                return n;
            });
        }, 500);
    };

    const handleFreeTalkAction = (type: string, payload: any = {}) => {
        if (!socket) return;
        const version = state.version || 0;
        socket.emit(type, { roomId, userId, ...payload, version }, (res: any) => {
            if (!res.ok) alert(res.error || 'Action failed');
        });
    };

    const handleDenounce = () => {
        const targetName = prompt('密告相手の名前を入力してください(部分一致可) or ID');
        if (!targetName) return;
        const target = state.players.find((p: Player) => p.name === targetName || p.name.includes(targetName));
        if (!target) return alert('プレイヤーが見つかりません');

        const reason = prompt(`${target.name}を密告する理由：`);
        if (!reason) return;

        handleFreeTalkAction('free_talk_denounce', { targetPlayerId: target.id, reason });
    };

    // Task B: Detect Hand Count Changes
    React.useEffect(() => {
        const counts = prevHandCounts.current;
        state.players.forEach((p: Player) => {
            const old = counts[p.id];
            const current = p.hand.length;
            if (old !== undefined && current < old) {
                setActiveEffects(prev => ({ ...prev, [p.id]: 'animate-ping' }));
                setTimeout(() => {
                    setActiveEffects(prev => {
                        const n = { ...prev };
                        delete n[p.id];
                        return n;
                    });
                }, 500);
            }
            counts[p.id] = current;
        });
    }, [state.players]);

    const handlePick = (targetUserId: string) => {
        if (!socket || !isMyTurn || selectedCardIdx === null) return;
        const version = state.version || 0;
        socket.emit('oldmaid_pick_from_left', { roomId, userId, pickIndex: selectedCardIdx, version }, (res: any) => {
            if (res.ok) {
                setSelectedCardIdx(null);
                if (res.data?.drawnCard) {
                    setPulledCard(res.data.drawnCard);
                    setTimeout(() => setPulledCard(null), 1500);
                }
            }
            else alert(res.error || 'Pick failed');
        });
    };

    // --- Seating Logic ---
    const myIndex = state.players.findIndex((p: Player) => p.id === userId);
    const opponents = [];
    if (myIndex !== -1) {
        for (let i = 1; i < state.players.length; i++) {
            opponents.push(state.players[(myIndex + i) % state.players.length]);
        }
    } else {
        opponents.push(...state.players);
    }

    const getPositionStyle = (index: number, total: number) => {
        if (total === 1) return { top: '10px', left: '50%', transform: 'translateX(-50%)' };
        if (total === 2) {
            return index === 0
                ? { top: '50%', left: '20px', transform: 'translateY(-50%)' }
                : { top: '50%', right: '20px', transform: 'translateY(-50%)' };
        }
        if (index === 0) return { top: '50%', left: '20px', transform: 'translateY(-50%)' };
        if (index === 1) return { top: '10px', left: '50%', transform: 'translateX(-50%)' };
        if (index === 2) return { top: '50%', right: '20px', transform: 'translateY(-50%)' };
        return { top: '10px', left: `${20 + index * 10}%` };
    };
    return (
    <section className="relative bg-[#2a2d36] overflow-x-auto overflow-y-hidden flex flex-col shadow-inner select-none h-full">
        <div className="absolute top-0 right-0 p-2 z-50 text-xs font-mono bg-red-600 text-white opacity-80 pointer-events-none">
            {state.debugVersion || "v6.0 (Old)"}
        </div>

            {/* Background Decor */}
            <div className="absolute top-2 left-2 text-gray-700 font-bold text-xl opacity-20 select-none pointer-events-none tracking-widest">boardgame-venue</div>

            {/* Phase 3: Reveal Popup Overlay */}
            {revealPopup && (
                <div className="absolute inset-0 z-[200] flex items-center justify-center pointer-events-none">
                    <div className="bg-black/90 border-4 border-double px-8 py-6 rounded-xl animate-in zoom-in-75 duration-300 shadow-[0_0_50px_rgba(0,0,0,0.8)] text-center">
                        <div className={`text-xs font-bold tracking-[0.5em] mb-2 ${revealPopup.type === 'scene' ? 'text-yellow-500' : 'text-red-500'}`}>
                            {revealPopup.type === 'scene' ? 'SCENE UPDATE' : 'NEW LAW'}
                        </div>
                        <div className="text-4xl font-black text-white mb-2 whitespace-nowrap">{revealPopup.title}</div>
                        <div className="text-sm text-gray-300 max-w-md mx-auto">{revealPopup.text}</div>
                    </div>
                </div>
            )}

            {/* Phase 3: Timer & Config Header */}
            {isFreeTalk && (
                <div className="absolute top-0 w-full flex flex-col md:flex-row justify-between items-start pt-2 px-4 md:px-20 z-10 pointer-events-none gap-2">

                    {/* Timer */}
                    <div className="bg-gray-900/90 border border-gray-600 rounded px-4 py-2 pointer-events-auto flex flex-col items-center shadow-lg">
                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">TIME LEFT</div>
                        <div className={`text-3xl font-mono font-bold ${timer?.isRunning ? 'text-white' : 'text-gray-500'}`}>
                            {(() => {
                                if (!timer?.endsAt) return `${Math.floor((timer?.roundSeconds || 300) / 60)}:00`;
                                const left = Math.max(0, Math.floor((timer.endsAt - Date.now()) / 1000));
                                const m = Math.floor(left / 60);
                                const s = left % 60;
                                return `${m}:${s.toString().padStart(2, '0')}`;
                            })()}
                        </div>

                        {myPlayer?.isHost && (
                            <div className="flex gap-1 mt-1">
                                {!timer?.isRunning && <button onClick={() => handleFreeTalkAction('free_talk_timer_start')} className="px-2 py-0.5 bg-green-700 text-[10px] text-white rounded hover:bg-green-600">Start</button>}
                                {timer?.isRunning && <button onClick={() => handleFreeTalkAction('free_talk_timer_extend')} className="px-2 py-0.5 bg-blue-700 text-[10px] text-white rounded hover:bg-blue-600">+30s</button>}
                            </div>
                        )}
                    </div>

                    {/* Win Config (Host Only) */}
                    {myPlayer?.isHost && (
                        <div className="bg-gray-900/90 border border-gray-600 rounded px-3 py-2 pointer-events-auto flex flex-col items-center">
                            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">WIN GOAL</div>
                            <div className="flex gap-1">
                                {[2, 3, 5].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => handleFreeTalkAction('free_talk_set_config', { winMedals: n })}
                                        className={`px-2 py-0.5 text-xs font-bold rounded ${config?.winMedals === n ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* FreeTalk Header Info (Cards) */}
            {/* FreeTalk Header Info (Cards) - Accordion for Mobile */}
            {isFreeTalk && (
                <div className="absolute top-0 w-full flex flex-col items-center pt-2 z-10 pointer-events-none gap-2">
                    {/* Header Toggle (Visible always, acts as handle) */}
                    <div className="flex justify-center gap-4 pointer-events-auto">
                        {/* Scene Card */}
                        <div className="w-64 transition-all duration-300">
                            <div
                                className="bg-gray-900/90 border border-gray-600 rounded p-2 text-center shadow-lg cursor-pointer active:scale-95 transition"
                                onClick={() => setExpandHeader(p => !p)}
                            >
                                <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1 flex justify-between px-2 items-center">
                                    <span>CURRENT SCENE</span>
                                    <span className="text-xs">{expandHeader ? '▲' : '▼'}</span>
                                </div>
                                {freeTalk.currentScene ? (
                                    <div className="animate-in fade-in">
                                        <div className="text-yellow-400 font-bold text-lg leading-tight truncate">{freeTalk.currentScene.name}</div>

                                        {expandHeader && (
                                            <div className="mt-2 text-left bg-black/20 p-2 rounded">
                                                <div className="text-xs text-gray-300 whitespace-pre-wrap mb-2">{freeTalk.currentScene.text}</div>
                                                {/* Role List Table */}
                                                <div className="border-t border-gray-600 pt-1">
                                                    <div className="text-[10px] text-gray-500 font-bold mb-1">ROLE LIST</div>
                                                    <table className="w-full text-[10px] text-left text-gray-400">
                                                        <tbody>
                                                            {(() => {
                                                                const customDefs = freeTalk.currentScene?.meta?.roleDefinitions || freeTalk.currentScene?.roleDefinitions || {};
                                                                // Unique Keys
                                                                const allKeys = Array.from(new Set([...Object.keys(FALLBACK_ROLE_DEFINITIONS), ...Object.keys(customDefs)])).sort();
                                                                return allKeys.map((key) => {
                                                                    const def: any = customDefs[key] || FALLBACK_ROLE_DEFINITIONS[key];
                                                                    if (!def) return null;
                                                                    return (
                                                                        <tr key={key} className={myPlayer?.role === key ? 'text-yellow-400 font-bold bg-white/10' : ''}>
                                                                            <td className="w-4 font-black p-0.5">{key}</td>
                                                                            <td className="w-14 p-0.5 whitespace-nowrap">{def.name}</td>
                                                                            <td className="opacity-75 p-0.5 leading-tight">{def.description}</td>
                                                                        </tr>
                                                                    );
                                                                });
                                                            })()}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-gray-600 italic text-sm py-1">待機中...</div>
                                )}

                                {myPlayer?.isHost && expandHeader && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleFreeTalkAction('free_talk_reveal_scene'); }}
                                        className="mt-2 w-full bg-blue-800 hover:bg-blue-700 text-blue-200 text-sm font-bold py-3 rounded touch-manipulation"
                                    >
                                        📢 シーン更新
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Law Card */}
                        <div className="w-64 transition-all duration-300">
                            <div
                                className="bg-gray-900/90 border border-red-900/50 rounded p-2 text-center shadow-lg cursor-pointer active:scale-95 transition"
                                onClick={() => setExpandHeader(p => !p)}
                            >
                                <div className="text-[10px] text-red-400 font-bold uppercase tracking-widest mb-1 flex justify-between px-2 items-center">
                                    <span>CURRENT LAW</span>
                                    <span className="text-xs">{expandHeader ? '▲' : '▼'}</span>
                                </div>
                                {freeTalk.currentLaw ? (
                                    <div className="animate-in fade-in">
                                        <div className="text-red-400 font-bold text-lg leading-tight truncate">{freeTalk.currentLaw.name}</div>
                                        {expandHeader && <div className="text-xs text-gray-300 mt-2 text-left bg-black/20 p-2 rounded whitespace-pre-wrap">{freeTalk.currentLaw.text}</div>}
                                    </div>
                                ) : (
                                    <div className="text-gray-600 italic text-sm py-1">待機中...</div>
                                )}

                                {myPlayer?.isHost && expandHeader && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleFreeTalkAction('free_talk_reveal_law'); }}
                                        className="mt-2 w-full bg-red-900 hover:bg-red-800 text-red-200 text-sm font-bold py-3 rounded touch-manipulation"
                                    >
                                        📜 条例更新
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* FreeTalk Actions (Bottom Right) */}
            {isFreeTalk && !myPlayer?.isSpectator && (
                <div className="absolute bottom-6 right-6 z-50 flex gap-2">
                    <button
                        onClick={handleDenounce}
                        className="bg-red-600 hover:bg-red-500 text-white font-bold py-4 px-6 rounded-full shadow-2xl border-4 border-red-800 active:scale-95 transition flex flex-col items-center"
                    >
                        <span className="text-2xl">⚠️</span>
                        <span className="text-xs">密告する</span>
                    </button>
                </div>
            )}

            {/* Mix Juice Actions (Moved to MixJuiceGameView) */}

            {state.phase === 'setup' && !deckEditorOpen && (
                <GameSetupOverlay
                    title="ゲーム準備 (Tabletop Setup)"
                    players={state.players}
                    userId={userId}
                    isHost={state.players.find((p: any) => p.id === userId)?.isHost ?? false}
                    onToggleSpectator={(targetId) => {
                        socket?.emit('host_action', { roomId, type: 'toggle_spectator', payload: { targetUserId: targetId }, userId });
                    }}
                    onSelfToggle={(isSpectator) => {
                        socket?.emit('self_set_spectator', { roomId, userId, isSpectator }, (res: any) => {
                            if (!res.ok) alert(res.error);
                        });
                    }}
                    currentMode={state.selectedMode || 'tabletop'}
                    onStartGame={() => {
                        socket?.emit('host_action', { roomId, type: 'start_game', userId });
                    }}
                />
            )}

            {/* Task A: Pulled Card Overlay */}
            {pulledCard && (
                <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/80 animate-in fade-in duration-200">
                    <div className="flex flex-col items-center animate-in zoom-in-50 duration-300">
                        <div className="text-white font-black text-4xl mb-4 drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] tracking-widest">ゲット!</div>
                        <div className="relative">
                            <div className="absolute inset-0 bg-white blur-xl opacity-30 animate-pulse" />
                            <Card card={pulledCard} className="w-48 h-64 shadow-[0_0_50px_rgba(255,255,255,0.3)] scale-100" />
                        </div>
                        <div className="mt-4 text-2xl font-bold text-yellow-400 drop-shadow-md">{pulledCard.name.includes('Joker') ? 'JOKER!' : 'カード入手!'}</div>
                    </div>
                </div>
            )}

            {/* Old Maid Status Overlays */}
            {isOldMaid && oldMaidData.status === 'finished' && (
                <div className="absolute inset-0 z-[100] bg-black/80 flex flex-col items-center justify-center animate-in fade-in duration-500 pointer-events-none">
                    {/* ... (Existing Old Maid Finish UI) ... */}
                    <h1 className="text-6xl font-bold text-yellow-400 mb-8 drop-shadow-lg">🎉 ゲーム終了 🎉</h1>
                    <div className="text-4xl text-white mb-4 animate-pulse">
                        勝者: <span className="font-bold text-green-400">{state.players.filter((p: any) => p.isOut).map((p: any) => p.name).join(', ') || '全員'}</span>
                    </div>
                </div>
            )}

            {/* Memory Game View */}
            {state.selectedMode === 'memory' && state.phase === 'playing' && (
                <div className="absolute inset-0 z-[10] bg-green-900 overflow-hidden">
                    <MemoryGameView
                        state={state.memory}
                        players={state.players}
                        myId={userId}
                        isSpectator={myPlayer?.isSpectator || false}
                        onFlip={(cardId) => {
                            socket?.emit('memory_flip', { roomId, userId, cardId }, (res: any) => {
                                if (!res.ok) console.warn(res.error);
                            });
                        }}
                    />
                </div>
            )}

            {isMyTurn && isOldMaid && oldMaidData.status !== 'finished' && (
                <div className="absolute bottom-40 left-1/2 -translate-x-1/2 z-[90] pointer-events-none">
                    <div className="bg-yellow-500/90 text-black px-8 py-4 rounded-xl shadow-2xl transform animate-bounce border-4 border-yellow-200">
                        <span className="text-3xl font-bold">あなたの番です！</span>
                        <div className="text-sm font-bold mt-1 text-center">カードを引いてください</div>
                    </div>
                </div>
            )}

            {/* Center Area (Objects & Opponents) */}
            <div className="flex-1 relative w-full h-full min-w-[800px] md:min-w-0">

                {/* Deck (Only if NOT Old Maid, or Old Maid specific deck?) */}
                {/* In Old Maid, deck is dealt out. So handle check */}
                {/* Deck (Only if NOT Old Maid AND NOT Mix Juice) */}
                {!isOldMaid && !isMixJuice && (
                    <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0 ${!myPlayer?.isSpectator ? 'cursor-pointer group' : 'opacity-80 pointer-events-none'}`} onClick={() => !myPlayer?.isSpectator && drawCard()}>
                        {state.deck.length > 0 ? (
                            <div className="relative">
                                {state.deck.length > 1 && <div className="absolute top-1 left-1 w-20 h-28 bg-blue-800 rounded-lg border border-blue-900 shadow-sm" />}
                                <div className={`relative w-20 h-28 bg-blue-900 rounded-lg border-2 border-blue-400 flex items-center justify-center shadow-xl ${!myPlayer?.isSpectator ? 'group-hover:-translate-y-1' : ''} transition`}>
                                    <div className="text-center"><div className="text-2xl">🎴</div><div className="text-xs font-bold text-blue-200 mt-1">{state.deck.length}</div></div>
                                </div>
                                {!myPlayer?.isSpectator && <div className="absolute -bottom-6 w-full text-center text-xs text-gray-400 font-bold opacity-0 group-hover:opacity-100 transition">引く</div>}
                            </div>
                        ) : (
                            <div className="w-20 h-28 border-2 border-dashed border-gray-600 rounded-lg flex items-center justify-center"><span className="text-gray-600 text-xs">空</span></div>
                        )}
                    </div>
                )}

                {/* Mix Juice Center Info (Moved to MixJuiceGameView) */}
                {/* isMixJuice block removed */}

                {/* Table Objects (Played cards) - Shared across modes, usually empty/discard in Old Maid */}
                {/* Visualization of Discard Pile for Old Maid */}
                {isOldMaid && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center justify-center z-0">
                        {/* Turn Indicator */}
                        {oldMaidData.status !== 'finished' && oldMaidData.order && (
                            <div className="absolute -top-16 bg-black/60 px-4 py-1 rounded-full backdrop-blur-sm border border-white/10 text-center whitespace-nowrap">
                                <span className="text-gray-300 text-sm">手番: </span>
                                <span className="text-yellow-400 font-bold text-lg">
                                    {state.players.find((p: any) => p.id === oldMaidData.order[oldMaidData.turnIndex])?.name || 'Unknown'}
                                </span>
                            </div>
                        )}

                        {/* The Pile itself */}
                        <div className="relative w-24 h-32 flex flex-col items-center justify-center p-2 rounded-lg border-2 border-dashed border-gray-600 bg-gray-900/40">
                            <div className="text-gray-500 font-bold text-center text-xs opacity-50">捨て札<br />(Discard)</div>
                            <div className="mt-1 text-gray-400 font-bold text-xl">{oldMaidData.discardPile?.length || 0}</div>
                        </div>

                        {/* Last Discarded Pair (if any) */}
                        {(() => {
                            const pile = oldMaidData.discardPile || [];
                            if (pile.length < 2) return null;
                            const lastTwo = pile.slice(-2);
                            return (
                                <div className="absolute left-full ml-6 flex -space-x-10">
                                    {lastTwo.map((c: any, i: number) => (
                                        <div key={i} className="relative transform rotate-6 hover:rotate-0 transition-transform duration-300">
                                            <Card card={c} className="shadow-lg w-16 h-24 border-gray-500" />
                                        </div>
                                    ))}
                                    <div className="absolute top-full text-[10px] text-gray-400 w-full text-center mt-2 font-bold tracking-wider">捨て札<br />(ペア)</div>
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* Free Play Objects */}
                {state.table.map((obj: any, i: number) => (
                    <div key={obj.id || i} className="absolute transition-all duration-300 hover:z-50" style={{ left: `calc(50% + ${obj.x}px)`, top: `calc(50% + ${obj.y}px)` }}>
                        <div className="absolute -top-4 w-full text-center text-[10px] text-gray-400 font-bold bg-black/50 rounded px-1 whitespace-nowrap overflow-hidden">{obj.ownerName}</div>
                        <Card card={obj.card} />
                    </div>
                ))}

                {/* Opponents */}
                {opponents.map((p: Player, idx: number) => {
                    const style = getPositionStyle(idx, opponents.length);
                    const isTarget = isMyTurn && p.id === targetId;
                    const canPick = isMyTurn && isTarget;
                    const isTurn = isOldMaid && oldMaidData.order && oldMaidData.order[oldMaidData.turnIndex] === p.id;
                    const isWinner = isOldMaid && oldMaidData.winners?.includes(p.id);

                    return (
                        <div key={p.id} className={`absolute flex flex-col items-center gap-1 transition-all duration-500 ${isWinner ? 'opacity-50 grayscale' : ''}`} style={style}>
                            {/* Avatar / Name */}
                            <div className={`
                                relative px-3 py-1.5 rounded-lg text-sm font-bold text-white shadow-xl border-2 transition-transform duration-300
                                ${isTurn ? 'bg-yellow-700 border-yellow-400 animate-pulse scale-110 z-20' : 'bg-gray-800 border-gray-600'}
                                ${isTarget && canPick ? 'ring-4 ring-blue-500 ring-offset-2 ring-offset-[#2a2d36]' : ''}
                            `}>
                                {p.name}
                                {isWinner && <span className="ml-1 text-green-400">👑</span>}
                                {p.isOut && <span className="ml-1 text-red-600 font-black">🚫</span>}
                                {canPick && <div className="absolute -right-12 top-0 bg-blue-600 text-white text-[10px] font-bold px-1 rounded animate-bounce">TARGET</div>}

                                {/* Opponent Role Badge */}
                                {isFreeTalk && p.role && (
                                    <div className="absolute -top-3 -right-3 bg-gray-900 text-yellow-500 text-xs w-6 h-6 flex items-center justify-center rounded-full border border-yellow-600 shadow-md font-black z-30 ring-2 ring-black/50">
                                        {p.role}
                                    </div>
                                )}
                            </div>

                            {/* Arrested / Purged Layout */}
                            {p.isOut && (
                                <div className="absolute top-8 left-1/2 -translate-x-1/2 rotate-12 border-4 border-red-700 text-red-700 font-black text-4xl opacity-80 tracking-widest z-40 whitespace-nowrap mask-image-grunge pointer-events-none">
                                    PURGED
                                </div>
                            )}

                            {/* Task B: Floating -1 Effect & Manual Shake */}
                            {activeEffects[p.id] === 'animate-ping' && (
                                <div className="absolute -top-10 left-1/2 -translate-x-1/2 text-red-500 font-black text-3xl animate-bounce pointer-events-none drop-shadow-md whitespace-nowrap z-50">
                                    -1
                                </div>
                            )}

                            {/* Phase 3: Shake Effect (Red Border) */}
                            {activeEffects[p.id] === 'animate-shake-short' && (
                                <div className="absolute inset-0 border-4 border-red-600 rounded-lg animate-pulse pointer-events-none z-30" />
                            )} {/* Shake animation needs to be applied to parent or we use transforms here? */}
                            {/* Ideally apply class to parent div. For MVP overlay is easier for visual cues. */}

                            {/* Phase 3: Floating Text */}
                            {floatingTexts[p.id]?.map(ft => (
                                <div key={ft.id} className="absolute -top-8 left-1/2 -translate-x-1/2 text-yellow-300 font-black text-2xl animate-out fade-out slide-out-to-top-10 duration-1000 pointer-events-none drop-shadow-md whitespace-nowrap z-50">
                                    {ft.text}
                                </div>
                            ))}

                            {/* FreeTalk Medals */}
                            {isFreeTalk && (
                                <div className="absolute -top-10 left-1/2 -translate-x-1/2 flex flex-col items-center z-50 pointer-events-none">
                                    {freeTalk.medals[p.id] > 0 && (
                                        <div className="bg-yellow-900/80 text-yellow-300 px-2 py-0.5 rounded-full text-xs font-bold border border-yellow-600 shadow-md mb-1 animate-bounce">
                                            🏅 {freeTalk.medals[p.id]}
                                        </div>
                                    )}
                                    {/* Host actions on opponent */}
                                    {myPlayer?.isHost && !p.isOut && (
                                        <div className="flex gap-1 mt-1 pointer-events-auto">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleFreeTalkAction('free_talk_award_medal', { playerId: p.id, delta: 1 }); }}
                                                className="bg-green-700 hover:bg-green-600 text-white text-[10px] px-2 py-0.5 rounded"
                                            >
                                                +1
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); if (confirm('追放しますか？')) handleFreeTalkAction('free_talk_purge', { targetPlayerId: p.id }); }}
                                                className="bg-red-800 hover:bg-red-700 text-white text-[10px] px-2 py-0.5 rounded"
                                                title="追放 (Purge)"
                                            >
                                                🚫
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}


                            {/* Hand (Backs) */}
                            {/* In Old Maid, display cards fanned out */}
                            {
                                isOldMaid ? (
                                    <div className="flex justify-center -space-x-5 mt-3 min-h-[80px]">
                                        {p.hand.length === 0 && isWinner ? (
                                            <div className="text-4xl animate-bounce">🎉</div>
                                        ) : (
                                            p.hand.map((c: any, cIdx: number) => {
                                                const isSelected = canPick && selectedCardIdx === cIdx;
                                                return (
                                                    <div
                                                        key={cIdx}
                                                        className={`
                                                        relative transition-all duration-200 origin-bottom
                                                        ${canPick ? 'cursor-pointer hover:-translate-y-4 hover:scale-110 hover:z-20' : ''}
                                                        ${isSelected ? '-translate-y-6 scale-110 z-30' : ''}
                                                    `}
                                                        onClick={() => { if (canPick) setSelectedCardIdx(cIdx); }}
                                                    >
                                                        <Card
                                                            card="Back" // Always render back for opponents
                                                            isFaceDown={true}
                                                            // Use Bigger Cards for Old Maid
                                                            className={`
                                                            w-14 h-20 md:w-16 md:h-24 shadow-xl border-2
                                                            ${isSelected ? 'border-yellow-400 ring-4 ring-yellow-400/50' : 'border-gray-500'}
                                                            ${!canPick ? 'opacity-90' : ''}
                                                        `}
                                                        />
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-xs text-gray-500 mt-1 bg-black/30 px-2 rounded">Cards: {p.hand.length}</div>
                                )
                            }

                            {/* Action Button for Old Maid */}
                            {
                                canPick && selectedCardIdx !== null && (
                                    <div className="absolute -bottom-10 z-40 bg-black/50 rounded-full p-1 backdrop-blur-sm">
                                        <button
                                            onClick={() => handlePick(p.id)}
                                            className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-sm px-6 py-2 rounded-full shadow-2xl animate-bounce transition transform hover:scale-110 whitespace-nowrap"
                                        >
                                            これにする！
                                        </button>
                                    </div>
                                )
                            }
                        </div>
                    );
                })}
            </div>

            {/* Mix Juice View (Overlay Style but integrated) */}
            {isMixJuice && (
                <MixJuiceGameView
                    roomId={roomId}
                    userId={userId}
                    state={state}
                    socket={socket}
                    drawCard={drawCard}
                    onEnterChangeMode={() => setMjActionPending('change')}
                />
            )}

            {/* My Hand (Bottom) - Hide in MixJuice (Handled by MixJuiceGameView) */}
            {
                !myPlayer?.isSpectator && !isMixJuice && (
                    <div className="absolute bottom-0 left-0 w-full h-48 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex flex-col justify-end pb-4 px-4 overflow-x-hidden pointer-events-none">
                        {/* Phase 3: Role Display (My Letter) */}
                        {/* Phase 3: Role Display (My Letter) - Adjusted Position */}
                        {/* Phase 3: Role Display (My Letter) - Adjusted Position */}
                        {isFreeTalk && myPlayer?.role && (
                            <div className="absolute bottom-52 left-4 pointer-events-auto z-50">
                                <div className="flex flex-col items-center">
                                    <div className="text-yellow-500 font-bold uppercase tracking-widest text-xs mb-1 shadow-black drop-shadow-md">YOUR ROLE</div>
                                    <div className="bg-gray-800 border-4 border-yellow-600 rounded-xl flex flex-col items-center justify-center shadow-2xl transform rotate-[-5deg] p-4 min-w-[120px] transition-transform hover:scale-110 hover:rotate-0">
                                        <div className="flex items-baseline gap-2 border-b border-gray-600 pb-2 mb-2 w-full justify-center">
                                            <span className="text-6xl font-black text-white drop-shadow-md">{myPlayer.role}</span>
                                        </div>
                                        <span className="text-xl font-bold text-yellow-400 text-center leading-tight">
                                            {(() => {
                                                const FALLBACK_ROLE_DEFINITIONS: any = {
                                                    'A': { name: '将軍' }, 'B': { name: '参謀長' }, 'C': { name: '情報将校' }, 'D': { name: '検閲官' },
                                                    'E': { name: '兵站将校' }, 'F': { name: '宣伝将校' }, 'G': { name: '外交官' }, 'H': { name: '民間代表' }
                                                };
                                                // Robust Lookup: Check custom first, then fallback
                                                const customDefs = freeTalk.currentScene?.meta?.roleDefinitions || freeTalk.currentScene?.roleDefinitions;
                                                const custom = customDefs?.[myPlayer.role];
                                                if (custom && custom.name) return custom.name;

                                                return FALLBACK_ROLE_DEFINITIONS[myPlayer.role]?.name || 'Unknown';
                                            })()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* My Turn Indicator */}
                        {isMyTurn && <div className="text-center text-yellow-400 font-bold animate-pulse mb-2 text-xl drop-shadow-md">YOUR TURN</div>}

                        <div className="flex justify-center items-end -space-x-4 hover:space-x-2 transition-all duration-300 pointer-events-auto pb-2">
                            {(() => {
                                const FALLBACK_ROLE_DEFINITIONS: any = {
                                    'A': { name: '将軍', description: '最高司令。最終決定権を持つ。' },
                                    'B': { name: '参謀長', description: '作戦立案。論理的な提案を行う。' },
                                    'C': { name: '情報将校', description: '諜報・監視。他者の嘘を見抜く。' },
                                    'D': { name: '検閲官', description: '思想統制。不適切な発言を正す。' },
                                    'E': { name: '兵站将校', description: '物資・補給。現実的なリソース管理。' },
                                    'F': { name: '宣伝将校', description: 'プロパガンダ。士気を高める発言。' },
                                    'G': { name: '外交官', description: '対外交渉。外部との関係を考慮。' },
                                    'H': { name: '民間代表', description: '現場の声。市民の感情を代弁。' }
                                };
                                // Prep Virtual Role Card
                                const roleCard = (isFreeTalk && myPlayer?.role) ? {
                                    type: 'role',
                                    roleLetter: myPlayer.role,
                                    roleName: (() => {
                                        const customDefs = freeTalk.currentScene?.meta?.roleDefinitions || freeTalk.currentScene?.roleDefinitions;
                                        const custom = customDefs?.[myPlayer.role];
                                        if (custom && custom.name) return custom.name;
                                        return FALLBACK_ROLE_DEFINITIONS[myPlayer.role]?.name || 'Unknown';
                                    })(),
                                    name: 'Role Card' // for key/safety
                                } : null;

                                const displayHand = roleCard ? [roleCard, ...(myPlayer?.hand || [])] : (myPlayer?.hand || []);

                                return displayHand.map((c: any, i: number) => {
                                    const realIndex = roleCard ? i - 1 : i;
                                    const isSelectableMJ = isMixJuice && mjActionPending === 'change' && c.type !== 'role';

                                    return (
                                        <div key={i} className={`relative group transition-transform hover:-translate-y-12 hover:scale-110 hover:z-20 focus-within:z-20 origin-bottom ${c.type === 'role' ? 'z-50' : ''} ${isSelectableMJ ? 'animate-pulse cursor-crosshair' : ''}`}>
                                            <Card
                                                card={c}
                                                onClick={() => {
                                                    if (c.type === 'role') return;

                                                    if (isMixJuice) {
                                                        if (mjActionPending === 'change') {
                                                            socket.emit('mixjuice_action', { roomId, userId, type: 'change', targetIndex: realIndex }, (res: any) => {
                                                                if (!res?.ok) alert(res?.error ?? 'エラー');
                                                                else setMjActionPending('none');
                                                            });
                                                        }
                                                        return;
                                                    }

                                                    if (!isOldMaid) playCard(realIndex);
                                                }}
                                                className={`shadow-2xl bg-white ${!isOldMaid && !isMixJuice && c.type !== 'role' ? 'cursor-pointer' : ''} ${isSelectableMJ ? 'ring-4 ring-yellow-500 border-yellow-500' : ''} ${isMixJuice && !isSelectableMJ ? 'cursor-default' : ''}`}
                                            />
                                        </div>
                                    );
                                });
                            })()}
                            {(!myPlayer?.hand || myPlayer.hand.length === 0) && !isFreeTalk && <div className="text-gray-400 text-sm font-bold mb-8 opacity-50">手札なし</div>}
                        </div>
                    </div>
                )
            }

            {/* Bottom: Player Hand */}
            <div className="flex-none bg-gray-900/95 border-t border-gray-800 relative z-20 pb-safe">
                {/* Hand Actions / Area */}
                <div className="min-h-[72px] flex flex-col justify-end">

                    {/* Hand Area */}
                    <div className="px-4 pt-2 pb-3 overflow-x-auto">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-white text-sm font-bold">手札 ({myPlayer?.hand.length})</h3>
                            <button
                                onClick={() => setIsHandCollapsed(prev => !prev)}
                                className="text-xs text-gray-300 border border-gray-600 rounded-full px-2 py-0.5 hover:bg-gray-800 transition"
                            >
                                {isHandCollapsed ? '表示' : '隠す'}
                            </button>
                        </div>
                        {!isHandCollapsed && (
                            <div className="flex space-x-2 pb-1 min-w-max">
                                <AnimatePresence mode='popLayout'>
                                    {(myPlayer?.hand || []).map((card: any, idx: number) => (
                                        <Card
                                            key={card.id || idx}
                                            card={card}
                                            onClick={() => {
                                                // MixJuice: チェンジモード時のみ手札クリックで捨てるカードを送信
                                                if (state.selectedMode === 'mixjuice' || state.phase === 'mixjuice') {
                                                    if (!isMyTurnMJ) {
                                                        alert('（サーバー基準で）あなたの番ではありません');
                                                        return;
                                                    }
                                                    if (mjActionPending !== 'change') {
                                                        return; // チェンジボタン押下後に手札を選ぶ
                                                    }
                                                    socket.emit('mixjuice_action', { roomId, userId, type: 'change', targetIndex: idx }, (res: any) => {
                                                        if (!res?.ok) alert(res?.error ?? 'エラー');
                                                        else setMjActionPending('none');
                                                    });
                                                    return;
                                                }
                                                if (!isMyTurn) return alert('あなたのターンではありません');
                                                if (state.selectedMode === 'oldmaid' || state.phase === 'oldmaid') {
                                                    // Own hand is completely non-interactive in Old Maid
                                                    return;
                                                }

                                                playCard(idx);
                                            }}
                                            className={`${(state.phase === 'mixjuice' && mjActionPending === 'change') ? 'ring-2 ring-amber-400 hover:ring-4 cursor-pointer' :
                                                    (state.selectedMode === 'mixjuice') ? 'cursor-pointer' :
                                                    (state.selectedMode === 'oldmaid' || state.phase === 'oldmaid') ? 'cursor-default opacity-100' :
                                                        (state.selectedMode === 'mixjuice' || state.phase === 'mixjuice') ? 'cursor-default opacity-100' :
                                                            isMyTurn ? 'ring-2 ring-blue-400 hover:ring-4 cursor-pointer' : 'opacity-80'
                                                }`}
                                        />
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {
                myPlayer?.isSpectator && (
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-black/80 px-6 py-2 rounded-full border border-gray-600 text-gray-400 font-bold pointer-events-none z-50">
                        👀 観戦モード (Spectator)
                    </div>
                )
            }

            {/* Dice Menu */}
            {
                !myPlayer?.isSpectator && (
                    <div className="absolute top-6 right-6 flex gap-4 z-10 pointer-events-auto">
                        <div className="relative">
                            {showDiceMenu && (
                                <div className="absolute top-full mt-2 right-0 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 flex flex-col gap-1 z-20 min-w-[60px]">
                                    {[100, 20, 12, 10, 8, 6].map(sides => (
                                        <button key={sides} onClick={() => { rollDice(sides); setShowDiceMenu(false); }} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs font-bold text-gray-300 transition text-center">d{sides}</button>
                                    ))}
                                </div>
                            )}
                            <button onClick={() => setShowDiceMenu(!showDiceMenu)} className="bg-gray-800/80 backdrop-blur p-3 rounded-full border border-gray-600 hover:bg-gray-700 transition group shadow-lg"><span className="text-2xl block group-active:scale-90 transition">🎲</span></button>
                        </div>
                    </div>
                )
            }
        </section>
    );
}
