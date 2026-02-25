'use client';

import { use, useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import UnifiedTable from '../../components/UnifiedTable';
import DeckEditor from '../../components/DeckEditor';
import GameLibrary from '../../components/GameLibrary';
import Card from '../../components/Card';
import RuleBook from '../../components/RuleBook';
import PostGameDeckEditor from '../../components/PostGameDeckEditor';

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

type RoomPageProps = { params?: Promise<{ id: string }> };

export default function RoomPage(props: RoomPageProps) {
    const router = useRouter();
    const paramsFromHook = useParams();
    const paramsPromise = props.params ?? Promise.resolve({ id: paramsFromHook?.id ?? '' });
    const resolved = use(paramsPromise) as { id?: string };
    const roomId = typeof resolved?.id === 'string' ? resolved.id : String(resolved?.id ?? '');
    const [socket, setSocket] = useState<Socket | null>(null);
    const [state, setState] = useState<GameState | null>(null);
    const [userId, setUserId] = useState<string>('');
    const [nickname, setNickname] = useState<string>('');
    const [msg, setMsg] = useState('');
    const [showLibrary, setShowLibrary] = useState(false);
    const [showPostGameEditor, setShowPostGameEditor] = useState(false);
    const [activeTab, setActiveTab] = useState<'board' | 'log' | 'status'>('board');
    const [botActionBanner, setBotActionBanner] = useState<string | null>(null);
    const [reconnecting, setReconnecting] = useState(false);
    const [reconnectedToast, setReconnectedToast] = useState(false);
    const hadStateBeforeRef = useRef(false);

    // Layout Refs
    const logEndRef = useRef<HTMLDivElement>(null);
    const lastActionTime = useRef(0);
    const lastBotMessageTime = useRef(0);
    const botBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectedToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isChatSending, setIsChatSending] = useState(false);

    // Initial Connection & サーバー再起動後の再接続
    useEffect(() => {
        const storedName = localStorage.getItem('nickname');
        if (!storedName) { router.push('/'); return; }
        setNickname(storedName);

        let uid = localStorage.getItem('userId');
        if (!uid) { uid = crypto.randomUUID(); localStorage.setItem('userId', uid); }
        setUserId(uid);

        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
        const socketInstance = socketUrl
            ? io(socketUrl, {
                transports: ["websocket", "polling"],
                withCredentials: true,
                reconnection: true,
                reconnectionAttempts: 30,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
            })
            : io({
                transports: ["websocket", "polling"],
                withCredentials: true,
                reconnection: true,
                reconnectionAttempts: 30,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
            });
        setSocket(socketInstance);

        const doJoinRoom = () => {
            socketInstance.emit('join_room', { roomId, nickname: storedName, userId: uid }, (res: any) => {
                if (res.error || res.ok === false) {
                    alert(res.error || 'Join failed');
                    router.push('/');
                } else {
                    const newState = res.data || res.state || res;
                    setState(newState);
                    const wasReconnect = hadStateBeforeRef.current;
                    hadStateBeforeRef.current = true; // 一度でも入室できたら true
                    setReconnecting(false);
                    if (wasReconnect) {
                        setReconnectedToast(true);
                        if (reconnectedToastRef.current) clearTimeout(reconnectedToastRef.current);
                        reconnectedToastRef.current = setTimeout(() => {
                            setReconnectedToast(false);
                            reconnectedToastRef.current = null;
                        }, 3000);
                    }
                }
            });
        };

        socketInstance.on('connect', () => {
            console.log('Socket Connected');
            doJoinRoom();
        });

        socketInstance.on('disconnect', (_reason: string) => {
            console.log('Socket Disconnected');
            setReconnecting(true);
        });

        socketInstance.on('state_update', (newState: GameState) => {
            setState(newState);
        });

        return () => {
            if (reconnectedToastRef.current) clearTimeout(reconnectedToastRef.current);
            socketInstance.disconnect();
        };
    }, [roomId, router]);

    // Auto-scroll log
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state?.chat]); // Deps safe

    // Bot 行動のハイライト表示
    useEffect(() => {
        if (!state?.chat || state.chat.length === 0) return;
        const last = state.chat[state.chat.length - 1];
        if (!last || last.sender !== 'System') return;
        if (last.timestamp <= lastBotMessageTime.current) return;
        // CPU 行動やラウンド結果など、プレイ進行に関係する System メッセージだけ拾う
        const msg: string = last.message || '';
        const isCpuRelated =
            /CPU\d+/.test(msg) ||
            msg.includes('ラウンド') ||
            msg.includes('勝者なし') ||
            msg.includes('位 (+') ||
            msg.includes('ゲーム終了');
        if (!isCpuRelated) return;

        lastBotMessageTime.current = last.timestamp;
        setBotActionBanner(msg);
        if (botBannerTimeoutRef.current) clearTimeout(botBannerTimeoutRef.current);
        botBannerTimeoutRef.current = setTimeout(() => {
            setBotActionBanner(null);
        }, 3000);
    }, [state?.chat]);

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

    if (!state) {
        return (
            <div className="h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
                <div>Loading...</div>
                {reconnecting && <div className="text-amber-400 text-sm animate-pulse">サーバーに再接続中…</div>}
            </div>
        );
    }

    const myPlayer = state.players.find(p => p.id === userId);
    const isHost = myPlayer?.isHost ?? false;

    return (
        <div className="h-screen w-screen bg-gray-950 text-gray-200 flex flex-col overflow-hidden font-sans relative">
            {/* 再接続中バナー */}
            {reconnecting && (
                <div className="absolute top-0 left-0 right-0 z-[100] bg-amber-900/95 text-amber-100 py-2 text-center text-sm font-bold shadow-lg">
                    接続が切れました。サーバー再起動後は自動で再接続し、入り直します…
                </div>
            )}
            {/* 再接続完了トースト */}
            {reconnectedToast && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[101] bg-green-700 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg animate-in fade-in duration-200">
                    再接続しました
                </div>
            )}
            {/* Header - Desktop Only */}
            <header className="hidden md:flex h-12 bg-gray-900 border-b border-gray-800 items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-4">
                    <span className="font-bold text-blue-400">BoardGame Venue</span>
                    <span className="text-gray-500 text-xs">部屋番号: {String(roomId ?? '')}</span>
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
                                {String((p as any).name ?? '')}
                            </button>
                        ))}
                    </div>
                    {myPlayer && <span className="text-blue-300 font-bold">{String(myPlayer.name ?? '')}</span>}
                </div>
            </header>

            {/* Header - Mobile Only (Simplified) */}
            <header className="md:hidden h-10 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-3 shrink-0">
                <span className="font-bold text-blue-400 text-sm">BG Venue</span>
                <span className="text-gray-500 text-[10px]">{String(roomId ?? '')}</span>
            </header>

            {/* Main Area */}
            <main className="flex-1 flex flex-col md:grid md:grid-cols-[300px_1fr_350px] min-h-0 overflow-hidden relative pb-[56px] md:pb-0">
                {/* 1. Log / Chat */}
                <section className={`${activeTab === 'log' ? 'flex' : 'hidden'} md:flex bg-gray-900/50 border-r border-gray-800 flex-col min-h-0 relative z-10 w-full md:w-auto h-full`}>
                    <div className="p-2 border-b border-gray-800 text-xs font-bold uppercase tracking-widest text-gray-500">ログ / チャット</div>
                    <div className="flex-1 overflow-y-auto p-2 text-sm space-y-2 font-mono">
                        {(state.chat || []).map((c: any, i: number) => (
                            <div key={i} className={`p-2 rounded ${c.sender === 'System' ? 'bg-gray-800 text-gray-400' : 'bg-gray-800/50'}`}>
                                {c.sender !== 'System' && <span className="text-blue-400 font-bold mr-2">{String(c.sender ?? '')}:</span>}
                                <span className={c.sender === 'System' ? 'text-xs' : ''}>{String(c.message ?? '')}</span>
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

                {/* 2. Board */}
                <div className={`${activeTab === 'board' ? 'flex' : 'hidden'} md:flex relative flex-1 flex-col min-h-0 overflow-hidden w-full h-full`}>
                    {botActionBanner && (
                        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30">
                            <div className="bg-black/80 text-amber-200 border border-amber-400/60 rounded-full px-4 py-1 text-xs shadow-lg flex items-center gap-2">
                                <span className="text-sm">🤖</span>
                                <span>{String(botActionBanner ?? '')}</span>
                            </div>
                        </div>
                    )}
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
                </div>

                {/* 3. Status / Tabs */}
                <RightPane
                    className={`${activeTab === 'status' ? 'flex' : 'hidden'} md:flex w-full md:w-auto h-full`}
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

            {/* Mobile Bottom Navigation (Fixed) */}
            <nav className="md:hidden fixed bottom-0 w-full h-[56px] bg-gray-900 border-t border-gray-800 flex shrink-0 z-50 shadow-[0_-1px_10px_rgba(0,0,0,0.5)]">
                <button
                    onClick={() => setActiveTab('log')}
                    className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${activeTab === 'log' ? 'text-blue-400 bg-gray-800' : 'text-gray-500 hover:bg-gray-800/50'}`}
                >
                    <span className="text-xl">💬</span>
                    <span className="text-[10px] font-bold">ログ</span>
                </button>
                <button
                    onClick={() => setActiveTab('board')}
                    className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${activeTab === 'board' ? 'text-blue-400 bg-gray-800' : 'text-gray-500 hover:bg-gray-800/50'}`}
                >
                    <span className="text-xl">🎲</span>
                    <span className="text-[10px] font-bold">盤面</span>
                </button>
                <button
                    onClick={() => setActiveTab('status')}
                    className={`flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${activeTab === 'status' ? 'text-blue-400 bg-gray-800' : 'text-gray-500 hover:bg-gray-800/50'}`}
                >
                    <span className="text-xl">ℹ️</span>
                    <span className="text-[10px] font-bold">自分</span>
                </button>
            </nav>

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

function RightPane({ state, myPlayer, socket, roomId, isHost, userId, onOpenLibrary, onOpenEditor, className }: any) {
    const [tab, setTab] = useState('my');
    const [isProcessing, setIsProcessing] = useState(false);
    const [addBotFeedback, setAddBotFeedback] = useState<string | null>(null);
    const [addBotSupported, setAddBotSupported] = useState<boolean | null>(null);
    const addBotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!socket?.connected) return;
        setAddBotSupported(null);
        const t = setTimeout(() => setAddBotSupported((prev) => (prev === null ? false : prev)), 2000);
        socket.emit('add_bot_support_check', (res: any) => {
            clearTimeout(t);
            setAddBotSupported(!!res?.addBotSupported);
        });
    }, [socket?.connected]);

    useEffect(() => {
        if (!socket) return;
        const onResult = (res: { ok?: boolean; error?: string }) => {
            if (addBotTimeoutRef.current) {
                clearTimeout(addBotTimeoutRef.current);
                addBotTimeoutRef.current = null;
            }
            setAddBotFeedback(null);
            if (res?.ok) {
                setAddBotFeedback('追加しました');
                setTimeout(() => setAddBotFeedback(null), 2000);
            } else {
                alert(res?.error ?? '追加できません');
            }
        };
        socket.on('add_bot_result', onResult);
        return () => { socket.off('add_bot_result', onResult); };
    }, [socket]);

    const handleAddBot = (level: 'weak' | 'normal' | 'strong') => {
        if (!socket) {
            alert('接続されていません');
            return;
        }
        if (!socket.connected) {
            alert('接続されていません。しばらく待ってから再度お試しください。');
            return;
        }
        if (isProcessing) return;
        setAddBotFeedback('送信中…');
        addBotTimeoutRef.current = setTimeout(() => {
            addBotTimeoutRef.current = null;
            setAddBotFeedback((prev) => (prev === '送信中…' ? 'サーバーが応答しません。再起動またはデプロイを確認してください。' : prev));
        }, 5000);
        socket.emit('add_bot', { roomId, level }, (res: any) => {
            if (addBotTimeoutRef.current) {
                clearTimeout(addBotTimeoutRef.current);
                addBotTimeoutRef.current = null;
            }
            setAddBotFeedback(null);
            if (res?.ok) {
                setAddBotFeedback('追加しました');
                setTimeout(() => setAddBotFeedback(null), 2000);
                return;
            }
            if (res?.ok === false) alert(res?.error ?? '追加できません');
        });
    };

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
        <section className={`bg-gray-900 border-l border-gray-800 flex flex-col min-h-0 border-r border-black relative ${className || ''}`}>

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
                                {myPlayer?.role != null && myPlayer.role !== '' ? (
                                    <>
                                        <span className="font-black text-6xl text-white drop-shadow-lg">
                                            {typeof myPlayer.role === 'string' ? myPlayer.role : String((myPlayer.role as any)?.roleLetter ?? (myPlayer.role as any)?.name ?? '')}
                                        </span>
                                        <span className="text-xl font-bold text-yellow-400 text-center border-t border-gray-600 pt-1 w-full">
                                            {(() => {
                                                const freeTalk = state.freeTalk || {};
                                                const FALLBACK_ROLE_DEFINITIONS: any = {
                                                    'A': { name: '将軍' }, 'B': { name: '参謀長' }, 'C': { name: '情報将校' }, 'D': { name: '検閲官' },
                                                    'E': { name: '兵站将校' }, 'F': { name: '宣伝将校' }, 'G': { name: '外交官' }, 'H': { name: '民間代表' }
                                                };
                                                const defs = freeTalk.currentScene?.meta?.roleDefinitions || freeTalk.currentScene?.roleDefinitions || FALLBACK_ROLE_DEFINITIONS;
                                                const roleKey = typeof myPlayer.role === 'string' ? myPlayer.role : (myPlayer.role as any)?.roleLetter ?? (myPlayer.role as any)?.name ?? '';
                                                const nameVal = defs[roleKey]?.name;
                                                return typeof nameVal === 'string' ? nameVal : (nameVal != null ? String(nameVal) : 'Unknown');
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
                    <RuleBook rules={state.rules ?? { text: '', summary: '', cards: [] }} />
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
                            {state.phase === 'setup' && (
                                <div className="mb-4">
                                    <div className="flex gap-2 flex-wrap">
                                        <button
                                            type="button"
                                            onClick={() => handleAddBot('weak')}
                                            disabled={isProcessing}
                                            className="flex-1 bg-amber-900/50 hover:bg-amber-800 text-amber-200 py-2 rounded text-sm font-bold border border-amber-700 transition disabled:opacity-50"
                                        >
                                            🤖 CPU追加 (弱い)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleAddBot('normal')}
                                            disabled={isProcessing}
                                            className="flex-1 bg-amber-900/50 hover:bg-amber-800 text-amber-200 py-2 rounded text-sm font-bold border border-amber-700 transition disabled:opacity-50"
                                        >
                                            🤖 CPU追加 (普通)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleAddBot('strong')}
                                            disabled={isProcessing}
                                            className="flex-1 bg-amber-900/60 hover:bg-amber-700 text-amber-100 py-2 rounded text-sm font-bold border border-amber-400 transition disabled:opacity-50"
                                        >
                                            🤖 CPU追加 (強い)
                                        </button>
                                    </div>
                                    {addBotFeedback && (
                                        <div className="mt-2 text-xs text-amber-200/90">{String(addBotFeedback ?? '')}</div>
                                    )}
                                    {addBotSupported === false && (
                                        <div className="mt-2 text-xs text-red-300 bg-red-900/30 p-2 rounded">
                                            CPU追加に対応したサーバーに接続されていません。server を再起動するか、最新コードで起動してください。
                                        </div>
                                    )}
                                </div>
                            )}
                            <button onClick={() => handleHostAction('reset_game', {}, 'ゲームをリセットしますか？')} disabled={isProcessing} className="w-full bg-red-900/50 hover:bg-red-800 text-red-200 py-2 rounded text-sm font-bold border border-red-800 transition">⚠ ゲームリセット</button>
                            <button onClick={() => handleHostAction('shuffle_deck')} disabled={isProcessing} className="w-full mt-2 bg-blue-900/50 hover:bg-blue-800 text-blue-200 py-2 rounded text-sm font-bold border border-blue-800 transition">🔀 山札シャッフル</button>
                        </div>
                        {state.phase === 'setup' && (
                            <div className="p-4 bg-gray-900/60 border border-gray-800 rounded space-y-3">
                                <h3 className="text-xs font-bold text-gray-400 uppercase">参加CPU</h3>
                                <div className="flex flex-wrap gap-2">
                                    {state.players.filter((p: any) => p.isBot).map((p: any) => (
                                        <div key={p.id} className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-full px-3 py-1 text-xs text-gray-100">
                                            <span>{String((p as any).name ?? '')}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleHostAction('remove_bot', { targetUserId: p.id })}
                                                className="ml-1 w-4 h-4 flex items-center justify-center rounded-full bg-red-700 text-[10px] leading-none hover:bg-red-600"
                                                title="このCPUを抜く"
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                    {state.players.filter((p: any) => p.isBot).length === 0 && (
                                        <span className="text-xs text-gray-500">CPUは参加していません。</span>
                                    )}
                                </div>
                            </div>
                        )}
                        {/* Legacy Deck Editor - Maybe hide if new one works better? Leaving for now. */}
                        <DeckEditor socket={socket} roomId={roomId} userId={userId} currentDraft={state.draftDeck || []} isProcessing={isProcessing} onProcessStart={() => setIsProcessing(true)} onProcessEnd={() => setIsProcessing(false)} />
                    </div>
                )}
            </div>
        </section>
    );
}
