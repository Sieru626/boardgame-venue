'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import UnifiedTable from '../../components/UnifiedTable';
import DeckEditor from '../../components/DeckEditor';
import GameLibrary from '../../components/GameLibrary';
import Card from '../../components/Card';
import RuleBook from '../../components/RuleBook';

// Types
type Player = { id: string; name: string; hand: any[]; role: any; isHost: boolean; status: string };
interface GameState {
    phase: string;
    players: Player[];
    deck: any[];
    table: { id: string, card: any, ownerId: string, ownerName: string, x: number, y: number }[];
    rules: { summary: string, text: string };
    chat: { sender: string; message: string; timestamp: number }[];
    oldMaid?: any; // Phase 5 extension
}

export default function RoomPage() {
    const params = useParams();
    const router = useRouter();
    const roomId = params.id as string;
    const [socket, setSocket] = useState<Socket | null>(null);
    const [state, setState] = useState<GameState | null>(null);
    const [userId, setUserId] = useState<string>('');
    const [nickname, setNickname] = useState<string>('');
    const [msg, setMsg] = useState('');
    const [showLibrary, setShowLibrary] = useState(false);
    const [showPostGameEditor, setShowPostGameEditor] = useState(false);

    // Layout Refs
    const logEndRef = useRef<HTMLDivElement>(null);
    const lastActionTime = useRef(0);
    const [isChatSending, setIsChatSending] = useState(false);

    // Initial Connection
    useEffect(() => {
        const storedName = localStorage.getItem('nickname');
        if (!storedName) { router.push('/'); return; }
        setNickname(storedName);

        let uid = localStorage.getItem('userId');
        if (!uid) { uid = crypto.randomUUID(); localStorage.setItem('userId', uid); }
        setUserId(uid);

        // Connect to relative path in production, or specific URL in dev if set
        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
        const socketInstance = socketUrl
            ? io(socketUrl, { transports: ["websocket", "polling"], withCredentials: true })
            : io({ transports: ["websocket", "polling"], withCredentials: true });
        setSocket(socketInstance);

        socketInstance.on('connect', () => {
            console.log('Socket Connected');
            socketInstance.emit('join_room', { roomId, nickname: storedName, userId: uid }, (res: any) => {
                if (res.error || res.ok === false) {
                    alert(res.error || 'Join failed');
                    router.push('/');
                } else {
                    setState(res.data || res.state || res); // Fallbacks just in case
                }
            });
        });

        socketInstance.on('state_update', (newState: GameState) => {
            setState(newState);
        });

        return () => { socketInstance.disconnect(); };
    }, [roomId, router]);

    // Auto-scroll log
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state?.chat]); // Deps safe

    const sendChat = (e: React.FormEvent) => {
        e.preventDefault();
        if (!socket || !msg.trim() || isChatSending) return;

        setIsChatSending(true);
        // Using ACK to prevent multiple pending
        socket.emit('game_action', { roomId, type: 'chat', payload: { message: msg }, userId }, () => {
            setIsChatSending(false);
            setMsg('');
        });
        setTimeout(() => setIsChatSending(false), 2000);
    };

    const drawCard = () => {
        if (!socket) return;
        const now = Date.now();
        if (now - lastActionTime.current < 500) return;
        lastActionTime.current = now;

        const currentVersion = (state as any).version || 0;
        socket.emit('game_action', { roomId, type: 'draw_card', payload: { version: currentVersion }, userId }, (res: any) => {
            if (res?.ok === false) alert(res.error || 'Action failed');
        });
    };

    const playCard = (index: number) => {
        if (!socket) return;
        const now = Date.now();
        if (now - lastActionTime.current < 500) return;
        lastActionTime.current = now;

        // Use current state version for optimistic locking
        const currentVersion = (state as any).version || 0;

        socket.emit('game_action', { roomId, type: 'play_card', payload: { index, version: currentVersion }, userId }, (res: any) => {
            if (res?.ok === false) {
                // Specific handling for collision?
                alert(res.error || 'Action failed');
            }
        });
    }

    const rollDice = (sides: number) => {
        if (!socket) return;
        socket.emit('game_action', { roomId, type: 'roll_dice', payload: { sides }, userId }, (res: any) => {
            if (res?.ok === false) alert(res.error || 'Action failed');
        });
    };

    if (!state) return <div className="h-screen bg-black text-white flex items-center justify-center">Loading...</div>;

    const myPlayer = state.players.find(p => p.id === userId);
    const isHost = myPlayer?.isHost ?? false;

    return (
        <div className="h-screen w-screen bg-gray-950 text-gray-200 flex flex-col overflow-hidden font-sans">
            {/* Header */}
            <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-4">
                    <span className="font-bold text-blue-400">BoardGame Venue</span>
                    <span className="text-gray-500 text-xs">部屋番号: {roomId}</span>
                    <button
                        className="ml-2 px-2 py-0.5 bg-blue-900/50 hover:bg-blue-800 text-blue-300 rounded text-xs border border-blue-800 transition flex items-center gap-1"
                        onClick={() => {
                            const url = `${window.location.origin}/room/${roomId}`;
                            navigator.clipboard.writeText(url);
                            alert('招待リンクをコピーしました: ' + url);
                        }}
                    >
                        🔗 招待リンク
                    </button>
                    {state.phase === 'oldmaid' && <span className="px-2 py-0.5 bg-green-900 text-green-300 rounded text-xs border border-green-700">🃏 ババ抜きプレイ中</span>}
                </div>
                <div className="flex items-center gap-4 text-xs">
                    <div className="flex gap-2">
                        {state.players.map(p => (
                            <button
                                key={p.id}
                                disabled={!isHost}
                                onClick={() => {
                                    if (!isHost) return;
                                    const action = p.status === 'online' && (p as any).isSpectator ? 'プレイヤー' : '観戦者';
                                    if (confirm(`${p.name} を【${action}】に変更しますか？`)) {
                                        socket?.emit('host_action', { roomId, type: 'toggle_spectator', payload: { targetUserId: p.id }, userId });
                                    }
                                }}
                                className={`px-2 py-1 rounded border flex items-center gap-1 transition-all ${isHost ? 'cursor-pointer hover:scale-105 active:scale-95' : 'cursor-default'
                                    } ${(p as any).isSpectator
                                        ? 'bg-gray-800 text-gray-400 border-gray-600'
                                        : p.status === 'online'
                                            ? 'bg-green-900 text-green-300 border-green-700'
                                            : 'bg-gray-800 text-gray-500 border-gray-700'
                                    }`}
                                title={isHost ? 'クリックして権限変更 (観戦/プレイヤー)' : ''}
                            >
                                {(p as any).isSpectator && <span className="text-[10px] bg-black/50 px-1 rounded">👁</span>}
                                {p.name}
                            </button>
                        ))}
                    </div>
                    {myPlayer && <span className="text-blue-300 font-bold">{myPlayer.name}</span>}
                </div>
            </header>

            {/* Main Grid */}
            <main className="flex-1 grid grid-cols-[300px_1fr_350px] min-h-0 overflow-hidden">
                {/* Left: Log */}
                <section className="bg-gray-900/50 border-r border-gray-800 flex flex-col min-h-0">
                    <div className="p-2 border-b border-gray-800 text-xs font-bold uppercase tracking-widest text-gray-500">ログ / チャット</div>
                    <div className="flex-1 overflow-y-auto p-2 text-sm space-y-2 font-mono">
                        {(state.chat || []).map((c: any, i: number) => (
                            <div key={i} className={`p-2 rounded ${c.sender === 'System' ? 'bg-gray-800 text-gray-400' : 'bg-gray-800/50'}`}>
                                {c.sender !== 'System' && <span className="text-blue-400 font-bold mr-2">{c.sender}:</span>}
                                <span className={c.sender === 'System' ? 'text-xs' : ''}>{c.message}</span>
                            </div>
                        ))}
                        <div ref={logEndRef}></div>
                    </div>
                    <form onSubmit={sendChat} className="p-2 border-t border-gray-800 flex gap-2">
                        <input className="flex-1 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm outline-none focus:border-blue-500"
                            value={msg} onChange={e => setMsg(e.target.value)} placeholder="メッセージ送信..." />
                        <button type="submit" disabled={isChatSending} className={`px-3 py-1 rounded text-xs font-bold transition ${isChatSending ? 'bg-gray-700 text-gray-500' : 'bg-blue-700 hover:bg-blue-600 text-white'}`}>
                            送信
                        </button>
                    </form>
                </section>

                {/* Center: Board */}
                <UnifiedTable
                    socket={socket}
                    roomId={roomId}
                    userId={userId}
                    state={state}
                    drawCard={drawCard}
                    playCard={playCard}
                    rollDice={rollDice}
                    deckEditorOpen={showPostGameEditor}
                />

                {/* Right: Tabs */}
                <RightPane
                    state={state}
                    myPlayer={myPlayer}
                    socket={socket}
                    roomId={roomId}
                    isHost={isHost}
                    userId={userId}
                    onOpenLibrary={() => setShowLibrary(true)}
                    onOpenEditor={() => setShowPostGameEditor(true)}
                />
            </main>

            {/* Global Overlays */}
            {showPostGameEditor && (
                <PostGameDeckEditor
                    socket={socket}
                    roomId={roomId}
                    userId={userId}
                    state={state}
                    onClose={() => setShowPostGameEditor(false)}
                />
            )}

            {showLibrary && (
                <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
                    <GameLibrary
                        roomId={roomId}
                        gameId=""
                        isHost={isHost}
                        onClose={() => setShowLibrary(false)}
                        socket={socket}
                        currentDeck={state.deck || []}
                        currentMode={state.phase}
                        userId={userId}
                    />
                </div>
            )}
        </div>
    );
}

import PostGameDeckEditor from '../../components/PostGameDeckEditor';

// ... (existing helper function RightPane)

function RightPane({ state, myPlayer, socket, roomId, isHost, userId, onOpenLibrary, onOpenEditor }: any) {
    const [tab, setTab] = useState('my');
    const [isProcessing, setIsProcessing] = useState(false);

    const handleHostAction = (type: string, payload: any = {}, confirmMsg?: string) => {
        if (isProcessing) return;
        if (confirmMsg && !confirm(confirmMsg)) return;
        setIsProcessing(true);
        socket.emit('host_action', { roomId, type, payload, userId }, (response: any) => {
            setIsProcessing(false);
            if (response?.ok === false) alert('Error: ' + response.error);
        });
    };

    return (
        <section className="bg-gray-900 border-l border-gray-800 flex flex-col min-h-0 border-r border-black relative">

            <div className="flex border-b border-gray-800 shrink-0">
                <button onClick={() => setTab('my')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition ${tab === 'my' ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>自分</button>
                <button onClick={() => setTab('rules')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition ${tab === 'rules' ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>ルール</button>
                {/* GM Tab Hidden/Disabled for Recovery */}
                {isHost && <button onClick={() => setTab('host')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition ${tab === 'host' ? 'bg-gray-800 text-purple-400 border-b-2 border-purple-400' : 'text-gray-500 hover:text-gray-300'}`}>ホスト</button>}
            </div>
            {/* Main Content Area - removed p-4 from parent, handled in children or selectively */}
            <div className="flex-1 overflow-y-auto min-h-0 relative">
                {tab === 'my' && (
                    <div className="p-4 space-y-6">
                        <div><h3 className="text-xs font-bold text-gray-500 uppercase mb-2">ステータス</h3><div className="text-sm text-gray-400 mb-4">手札: <span className="text-white font-bold">{myPlayer?.hand.length || 0}</span></div></div>
                        <div>
                            <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">役職</h3>
                            <div className="bg-gray-800 p-4 rounded border border-gray-700 min-h-[120px] flex flex-col items-center justify-center gap-2">
                                {myPlayer?.role ? (
                                    <>
                                        <span className="font-black text-6xl text-white drop-shadow-lg">{myPlayer.role}</span>
                                        <span className="text-xl font-bold text-yellow-400 text-center border-t border-gray-600 pt-1 w-full">
                                            {(() => {
                                                const freeTalk = state.freeTalk || {};
                                                const FALLBACK_ROLE_DEFINITIONS: any = {
                                                    'A': { name: '将軍' }, 'B': { name: '参謀長' }, 'C': { name: '情報将校' }, 'D': { name: '検閲官' },
                                                    'E': { name: '兵站将校' }, 'F': { name: '宣伝将校' }, 'G': { name: '外交官' }, 'H': { name: '民間代表' }
                                                };
                                                const defs = freeTalk.currentScene?.meta?.roleDefinitions || freeTalk.currentScene?.roleDefinitions || FALLBACK_ROLE_DEFINITIONS;
                                                return (defs[myPlayer.role]?.name || 'Unknown');
                                            })()}
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-gray-600 italic">なし</span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                {tab === 'rules' && (
                    <RuleBook rules={state.rules} />
                )}
                {/* Host Tab Simplified */}
                {tab === 'host' && isHost && (
                    <div className="p-4 space-y-6">
                        <div className="p-4 bg-purple-900/10 border border-purple-900/50 rounded mb-6">
                            <h3 className="text-purple-400 font-bold mb-2 text-sm">ゲーム管理</h3>
                            {/* Phase 1.8: Adjust Button - Always visible for host or conditioned? Prompt said "Finished or Status=Finished". For now always allow access for debug/setup flex. */}
                            <button onClick={onOpenEditor} className="w-full bg-slate-700 hover:bg-slate-600 text-yellow-300 py-2 rounded text-sm font-bold border border-yellow-500/30 transition mb-4">
                                🛠 デッキ・ルール調整 (Editor)
                            </button>

                            <button onClick={onOpenLibrary} className="w-full bg-indigo-700 hover:bg-indigo-600 text-white py-3 rounded text-sm font-bold shadow-lg transition mb-4">📚 ゲームライブラリ</button>
                            <button onClick={() => handleHostAction('reset_game', {}, 'ゲームをリセットしますか？')} disabled={isProcessing} className="w-full bg-red-900/50 hover:bg-red-800 text-red-200 py-2 rounded text-sm font-bold border border-red-800 transition">⚠ ゲームリセット</button>
                            <button onClick={() => handleHostAction('shuffle_deck')} disabled={isProcessing} className="w-full mt-2 bg-blue-900/50 hover:bg-blue-800 text-blue-200 py-2 rounded text-sm font-bold border border-blue-800 transition">🔀 山札シャッフル</button>
                        </div>
                        {/* Legacy Deck Editor - Maybe hide if new one works better? Leaving for now. */}
                        <DeckEditor socket={socket} roomId={roomId} userId={userId} currentDraft={state.draftDeck || []} isProcessing={isProcessing} onProcessStart={() => setIsProcessing(true)} onProcessEnd={() => setIsProcessing(false)} />
                    </div>
                )}
            </div>
        </section>
    );
}
