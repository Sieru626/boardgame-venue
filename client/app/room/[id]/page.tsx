'use client';

import { use, useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import UnifiedTable from '../../components/UnifiedTable';
import DeckEditor from '../../components/DeckEditor';
import GameLibrary from '../../components/GameLibrary';
import RuleBook from '../../components/RuleBook';
import PostGameDeckEditor from '../../components/PostGameDeckEditor';
import AIDealerPanel from '../../components/AIDealerPanel';

// Types
type Player = { id: string; name: string; hand: any[]; role: any; isHost: boolean; status: string };
interface GameState {
    phase: string;
    players: Player[];
    deck: any[];
    table: { id: string, card: any, ownerId: string, ownerName: string, x: number, y: number }[];
    rules: { summary: string, text: string };
    chat: { sender: string; message: string; timestamp: number }[];
    oldMaid?: any;
    selectedMode?: string;
    draftDeck?: any[];
}

type RoomPageProps = { params?: Promise<{ id: string }> };

const GAMES = [
    { id: 'mixjuice', name: 'ミックスジュース' },
    { id: 'oldmaid', name: 'ババ抜き' },
    { id: 'memory', name: '神経衰弱' },
    { id: 'tabletop', name: 'カスタム' },
];

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
    const [botActionBanner, setBotActionBanner] = useState<string | null>(null);
    const [reconnecting, setReconnecting] = useState(false);
    const [reconnectedToast, setReconnectedToast] = useState(false);
    const hadStateBeforeRef = useRef(false);

    const logEndRef = useRef<HTMLDivElement>(null);
    const lastActionTime = useRef(0);
    const lastBotMessageTime = useRef(0);
    const botBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectedToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dealerPanicTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isChatSending, setIsChatSending] = useState(false);
    const [dealerPanic, setDealerPanic] = useState(false);

    const triggerDealerPanic = () => {
        setDealerPanic(true);
        if (dealerPanicTimeoutRef.current) clearTimeout(dealerPanicTimeoutRef.current);
        dealerPanicTimeoutRef.current = setTimeout(() => {
            setDealerPanic(false);
            dealerPanicTimeoutRef.current = null;
        }, 3000);
    };

    useEffect(() => {
        const storedName = localStorage.getItem('nickname');
        if (!storedName) { router.push('/'); return; }
        setNickname(storedName);

        let uid = localStorage.getItem('userId');
        if (!uid) { uid = crypto.randomUUID(); localStorage.setItem('userId', uid); }
        setUserId(uid);

        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
        const socketInstance = socketUrl
            ? io(socketUrl, { transports: ["websocket", "polling"], withCredentials: true, reconnection: true, reconnectionAttempts: 30, reconnectionDelay: 1000, reconnectionDelayMax: 5000 })
            : io({ transports: ["websocket", "polling"], withCredentials: true, reconnection: true, reconnectionAttempts: 30, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
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
                    hadStateBeforeRef.current = true;
                    setReconnecting(false);
                    if (wasReconnect) {
                        setReconnectedToast(true);
                        if (reconnectedToastRef.current) clearTimeout(reconnectedToastRef.current);
                        reconnectedToastRef.current = setTimeout(() => { setReconnectedToast(false); reconnectedToastRef.current = null; }, 3000);
                    }
                }
            });
        };

        socketInstance.on('connect', () => { console.log('Socket Connected'); doJoinRoom(); });
        socketInstance.on('disconnect', () => setReconnecting(true));
        socketInstance.on('state_update', (newState: GameState) => setState(newState));

        return () => {
            if (reconnectedToastRef.current) clearTimeout(reconnectedToastRef.current);
            if (dealerPanicTimeoutRef.current) clearTimeout(dealerPanicTimeoutRef.current);
            socketInstance.disconnect();
        };
    }, [roomId, router]);

    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [state?.chat]);

    useEffect(() => {
        if (!state?.chat || state.chat.length === 0) return;
        const last = state.chat[state.chat.length - 1];
        if (!last || last.sender !== 'System') return;
        if (last.timestamp <= lastBotMessageTime.current) return;
        const msgText: string = last.message || '';
        const isCpuRelated = /CPU\d+/.test(msgText) || msgText.includes('ラウンド') || msgText.includes('勝者なし') || msgText.includes('位 (+') || msgText.includes('ゲーム終了');
        if (!isCpuRelated) return;
        lastBotMessageTime.current = last.timestamp;
        setBotActionBanner(msgText);
        if (botBannerTimeoutRef.current) clearTimeout(botBannerTimeoutRef.current);
        botBannerTimeoutRef.current = setTimeout(() => setBotActionBanner(null), 3000);
    }, [state?.chat]);

    const sendChat = (e: React.FormEvent) => {
        e.preventDefault();
        if (!socket || !msg.trim() || isChatSending) return;
        setIsChatSending(true);
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
            if (res?.ok === false) { alert(res.error || 'Action failed'); triggerDealerPanic(); }
        });
    };

    const playCard = (index: number) => {
        if (!socket) return;
        const now = Date.now();
        if (now - lastActionTime.current < 500) return;
        lastActionTime.current = now;
        const currentVersion = (state as any).version || 0;
        socket.emit('game_action', { roomId, type: 'play_card', payload: { index, version: currentVersion }, userId }, (res: any) => {
            if (res?.ok === false) { alert(res.error || 'Action failed'); triggerDealerPanic(); }
        });
    };

    const rollDice = (sides: number) => {
        if (!socket) return;
        socket.emit('game_action', { roomId, type: 'roll_dice', payload: { sides }, userId }, (res: any) => {
            if (res?.ok === false) { alert(res.error || 'Action failed'); triggerDealerPanic(); }
        });
    };

    if (!state) {
        return (
            <div className="h-screen bg-[#111] text-white flex flex-col items-center justify-center gap-4">
                <div>Loading...</div>
                {reconnecting && <div className="text-amber-400 text-sm animate-pulse">サーバーに再接続中…</div>}
            </div>
        );
    }

    const myPlayer = state.players.find(p => p.id === userId);
    const isHost = myPlayer?.isHost ?? false;
    const selectedMode = state.selectedMode || 'tabletop';

    return (
        <div className="flex flex-col h-screen bg-[#111] text-gray-200 overflow-hidden font-sans relative">
            {reconnecting && (
                <div className="absolute top-0 left-0 right-0 z-[100] bg-amber-900/95 text-amber-100 py-2 text-center text-sm font-bold shadow-lg">
                    接続が切れました。サーバー再起動後は自動で再接続し、入り直します…
                </div>
            )}
            {reconnectedToast && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[101] bg-green-700 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg animate-pulse">
                    再接続しました
                </div>
            )}

            {/* v0 Header */}
            <header className="flex items-center justify-between px-4 py-2 rpg-border shrink-0" style={{ borderLeft: 'none', borderRight: 'none', borderTop: 'none' }}>
                <div className="flex items-center gap-3">
                    <h1 className="text-lg neon-green tracking-widest font-sans">NEW GAME ORDER</h1>
                    <span className="text-xs text-[var(--muted-foreground)] font-sans hidden md:inline">{"// BOARD GAME VENUE //"}</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rpg-border-yellow px-3 py-1 rounded">
                        <span className="text-xs text-[var(--muted-foreground)] font-sans hidden sm:inline">ROOM:</span>
                        <span className="neon-yellow text-sm tracking-wider font-sans">{String(roomId)}</span>
                        <button
                            className="neon-btn-yellow rounded p-0.5"
                            aria-label="Copy room code"
                            onClick={() => {
                                const url = `${window.location.origin}/room/${roomId}`;
                                navigator.clipboard.writeText(url);
                                alert('招待リンクをコピーしました: ' + url);
                            }}
                        >
                            <span className="text-xs">📋</span>
                        </button>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[var(--neon-green)] block" />
                        <span className="text-xs neon-green font-sans">ONLINE</span>
                    </div>
                    {myPlayer && <span className="neon-cyan font-bold text-sm">{String(myPlayer.name)}</span>}
                </div>
            </header>

            {/* v0 Main: Left Dealer | Center Board | Right Info+Chat */}
            <div className="flex flex-1 min-h-0">
                {/* Left: AI Dealer */}
                <aside className="w-72 flex-shrink-0 p-3 border-r-2 border-[var(--neon-yellow)]/15 hidden md:flex flex-col">
                    <AIDealerPanel isPanic={dealerPanic} />
                </aside>

                {/* Center: GameSelect + Game Board */}
                <main className="flex-1 flex flex-col p-4 gap-4 min-w-0 min-h-0 overflow-hidden">
                    {/* GameSelect bar */}
                    <div className="rpg-border rounded-lg px-3 py-2.5 flex-shrink-0">
                        <div className="flex items-center gap-4 flex-wrap">
                            <span className="text-xs neon-green tracking-[0.2em] font-sans whitespace-nowrap">{">> GAME SELECT"}</span>
                            <div className="flex gap-2 flex-1 min-w-0 flex-wrap">
                                {GAMES.map((game) => {
                                    const isSelected = selectedMode === game.id;
                                    return (
                                        <button
                                            key={game.id}
                                            onClick={() => isHost && setShowLibrary(true)}
                                            className={`px-3 py-1.5 rounded text-xs font-sans tracking-wide transition-all whitespace-nowrap ${
                                                isSelected ? 'bg-[var(--neon-green)] text-[#111] font-bold' : 'bg-[var(--secondary)]/60 text-[var(--muted-foreground)] hover:text-[var(--neon-green)] hover:bg-[var(--neon-green)]/10 border border-transparent hover:border-[var(--neon-green)]/40'
                                            } ${isHost ? 'cursor-pointer' : 'cursor-default'}`}
                                            style={isSelected ? { boxShadow: '0 0 12px rgba(0,255,136,0.5), 0 0 30px rgba(0,255,136,0.2)' } : {}}
                                            title={isHost ? 'クリックでゲームライブラリを開く' : ''}
                                        >
                                            {game.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Board: UnifiedTable */}
                    <div className="flex-1 relative min-h-0 overflow-hidden">
                        {botActionBanner && (
                            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30">
                                <div className="bg-black/80 text-amber-200 border border-amber-400/60 rounded-full px-4 py-1 text-xs shadow-lg flex items-center gap-2">
                                    <span>🤖</span>
                                    <span>{String(botActionBanner)}</span>
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
                </main>

                {/* Right: v0 Info Panels + Chat */}
                <aside className="w-80 flex-shrink-0 p-3 border-l-2 border-[var(--neon-cyan)]/15 flex flex-col gap-3 min-h-0 hidden md:flex">
                    <div className="flex-[6] min-h-0">
                        <V0InfoPanels
                            state={state}
                            myPlayer={myPlayer}
                            socket={socket}
                            roomId={roomId}
                            isHost={isHost}
                            userId={userId}
                            onOpenLibrary={() => setShowLibrary(true)}
                            onOpenEditor={() => setShowPostGameEditor(true)}
                            onDealerPanic={triggerDealerPanic}
                        />
                    </div>
                    <div className="flex-[4] min-h-0">
                        <V0ChatLog
                            chat={state.chat || []}
                            msg={msg}
                            setMsg={setMsg}
                            sendChat={sendChat}
                            isChatSending={isChatSending}
                            logEndRef={logEndRef}
                        />
                    </div>
                </aside>
            </div>

            {/* v0 Status Bar */}
            <footer className="flex items-center justify-center gap-6 px-4 py-1.5 border-t-2 border-[var(--neon-green)]/20 bg-[var(--card)] shrink-0">
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--neon-green)] block" />
                    <span className="text-[10px] text-[var(--muted-foreground)] font-sans tracking-wider">PLAYERS: {state.players.length}</span>
                </div>
                <span className="text-[10px] text-[var(--border)] font-sans">|</span>
                <span className="text-[10px] text-[var(--muted-foreground)] font-sans tracking-wider">{state.phase === 'setup' ? 'LOBBY' : state.phase.toUpperCase()}</span>
                <span className="text-[10px] text-[var(--border)] font-sans">|</span>
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[var(--neon-green)] block" />
                    <span className="text-[10px] text-[var(--muted-foreground)] font-sans tracking-wider">DEALER: READY</span>
                </div>
            </footer>

            {showPostGameEditor && (
                <PostGameDeckEditor socket={socket} roomId={roomId} userId={userId} state={state} onClose={() => setShowPostGameEditor(false)} />
            )}

            {showLibrary && (
                <div className="absolute inset-0 bg-black/75 flex items-center justify-center z-50">
                    <GameLibrary roomId={roomId} gameId="" isHost={isHost} onClose={() => setShowLibrary(false)} socket={socket} currentDeck={state.deck || []} currentMode={state.phase} userId={userId} />
                </div>
            )}
        </div>
    );
}

type V0ChatLogProps = {
    chat: { sender: string; message: string; timestamp: number }[];
    msg: string;
    setMsg: (s: string) => void;
    sendChat: (e: React.FormEvent) => void;
    isChatSending: boolean;
    logEndRef: React.RefObject<HTMLDivElement | null>;
};

function V0ChatLog({ chat, msg, setMsg, sendChat, isChatSending, logEndRef }: V0ChatLogProps) {
    return (
        <div className="rpg-border-cyan rounded-lg p-3 flex flex-col h-full min-h-0">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-xs neon-cyan tracking-[0.2em] font-sans">LOG & CHAT</span>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 min-h-0 mb-2 pr-1">
                {chat.map((c: any, i: number) => (
                    <div key={i} className="text-xs font-sans leading-relaxed">
                        {c.sender === 'System' && <span className="text-[var(--muted-foreground)]">{">"} {c.message}</span>}
                        {c.sender !== 'System' && (
                            <span className="text-[var(--foreground)]">
                                <span className="neon-yellow">{c.sender}</span>: {c.message}
                            </span>
                        )}
                    </div>
                ))}
                <div ref={logEndRef} />
            </div>
            <form onSubmit={sendChat} className="flex gap-2">
                <input
                    type="text"
                    value={msg}
                    onChange={e => setMsg(e.target.value)}
                    placeholder="メッセージを入力..."
                    className="flex-1 bg-[var(--input)] border-2 border-[var(--neon-cyan)]/30 rounded px-2 py-1.5 text-xs font-sans text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--neon-cyan)] focus:outline-none transition-all"
                />
                <button type="submit" disabled={isChatSending} className="rpg-border-cyan rounded px-2 py-1.5 neon-cyan hover:bg-[var(--neon-cyan)]/10 transition-all disabled:opacity-50">
                    ➤
                </button>
            </form>
        </div>
    );
}

type V0InfoPanelsProps = {
    state: GameState;
    myPlayer: Player | undefined;
    socket: Socket | null;
    roomId: string;
    isHost: boolean;
    userId: string;
    onOpenLibrary: () => void;
    onOpenEditor: () => void;
    onDealerPanic: () => void;
};

function V0InfoPanels({ state, myPlayer, socket, roomId, isHost, userId, onOpenLibrary, onOpenEditor, onDealerPanic }: V0InfoPanelsProps) {
    const [activeTab, setActiveTab] = useState<'rule' | 'player' | 'host'>('host');
    const [isProcessing, setIsProcessing] = useState(false);
    const [addBotFeedback, setAddBotFeedback] = useState<string | null>(null);
    const [addBotSupported, setAddBotSupported] = useState<boolean | null>(null);
    const addBotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!socket?.connected) return;
        setAddBotSupported(null);
        const t = setTimeout(() => setAddBotSupported(prev => (prev === null ? false : prev)), 2000);
        socket.emit('add_bot_support_check', (res: any) => {
            clearTimeout(t);
            setAddBotSupported(!!res?.addBotSupported);
        });
    }, [socket?.connected]);

    useEffect(() => {
        if (!socket) return;
        const onResult = (res: { ok?: boolean; error?: string }) => {
            if (addBotTimeoutRef.current) { clearTimeout(addBotTimeoutRef.current); addBotTimeoutRef.current = null; }
            setAddBotFeedback(null);
            if (res?.ok) {
                setAddBotFeedback('追加しました');
                setTimeout(() => setAddBotFeedback(null), 2000);
            } else {
                alert(res?.error ?? '追加できません');
                onDealerPanic?.();
            }
        };
        socket.on('add_bot_result', onResult);
        return () => { socket.off('add_bot_result', onResult); };
    }, [socket, onDealerPanic]);

    const handleAddBot = (level: 'weak' | 'normal' | 'strong') => {
        if (!socket || !socket.connected) { alert('接続されていません'); return; }
        if (isProcessing) return;
        setAddBotFeedback('送信中…');
        addBotTimeoutRef.current = setTimeout(() => {
            addBotTimeoutRef.current = null;
            setAddBotFeedback(prev => (prev === '送信中…' ? 'サーバーが応答しません' : prev));
        }, 5000);
        socket.emit('add_bot', { roomId, level }, (res: any) => {
            if (addBotTimeoutRef.current) { clearTimeout(addBotTimeoutRef.current); addBotTimeoutRef.current = null; }
            setAddBotFeedback(null);
            if (res?.ok) {
                setAddBotFeedback('追加しました');
                setTimeout(() => setAddBotFeedback(null), 2000);
            } else if (res?.ok === false) alert(res?.error ?? '追加できません');
        });
    };

    const handleHostAction = (type: string, payload: any = {}, confirmMsg?: string) => {
        if (isProcessing) return;
        if (confirmMsg && !confirm(confirmMsg)) return;
        setIsProcessing(true);
        socket?.emit('host_action', { roomId, type, payload, userId }, (res: any) => {
            setIsProcessing(false);
            if (res?.ok === false) { alert('Error: ' + res.error); onDealerPanic?.(); }
        });
    };

    const borderClass = activeTab === 'rule' ? 'rpg-border' : activeTab === 'player' ? 'rpg-border-cyan' : 'rpg-border-yellow';

    return (
        <div className={`${borderClass} rounded-lg overflow-hidden flex flex-col min-h-0 h-full`}>
            <div className="flex border-b-2 border-[var(--border)] shrink-0">
                {(['rule', 'player', 'host'] as const).map((tab) => {
                    const labels = { rule: 'RULE', player: 'PLAYER', host: 'HOST' };
                    const colors = { rule: 'neon-green', player: 'neon-cyan', host: 'neon-yellow' };
                    const isActive = activeTab === tab;
                    return (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 py-2.5 px-3 text-xs font-sans transition-all ${isActive ? `${colors[tab]} bg-[var(--${tab === 'rule' ? 'neon-green' : tab === 'player' ? 'neon-cyan' : 'neon-yellow'})]/10` : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                        >
                            {labels[tab]}
                        </button>
                    );
                })}
            </div>
            <div className="flex-1 p-3 overflow-y-auto min-h-0">
                {activeTab === 'rule' && (
                    <RuleBook rules={state.rules ?? { text: '', summary: '', cards: [] }} />
                )}
                {activeTab === 'player' && (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm neon-cyan font-sans">{">> PLAYERS"}</span>
                            <span className="text-[10px] rpg-border-cyan rounded px-2 py-0.5 neon-cyan font-sans">{state.players.length}/6</span>
                        </div>
                        {myPlayer && (
                            <div className="rpg-border-cyan rounded-lg p-3">
                                <div className="text-sm neon-cyan font-sans">{myPlayer.name}</div>
                                <div className="text-[10px] text-[var(--muted-foreground)]">{isHost ? 'HOST' : 'PLAYER'}</div>
                                <div className="text-xs mt-2">手札: <span className="neon-green font-bold">{myPlayer.hand?.length ?? 0}</span></div>
                            </div>
                        )}
                        {state.players.filter(p => p.id !== userId).map((p) => (
                            <div key={p.id} className="flex justify-between px-3 py-2 rounded-lg bg-[var(--secondary)]/50">
                                <span className="text-xs">{p.name}</span>
                                <span className={`text-[10px] ${p.status === 'online' ? 'neon-green' : 'text-[var(--muted-foreground)]'}`}>{p.status}</span>
                            </div>
                        ))}
                    </div>
                )}
                {activeTab === 'host' && isHost && (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm neon-yellow font-sans">{">> HOST COMMANDS"}</span>
                            <span className="text-[10px] rpg-border-yellow rounded px-2 py-0.5 neon-yellow font-sans">ADMIN</span>
                        </div>

                        <button onClick={onOpenLibrary} className="w-full rpg-command rounded-lg px-3 py-2.5 border-2 border-[var(--neon-green)] text-left hover:bg-[var(--neon-green)]/10 transition-all">
                            <span className="text-sm neon-green">▶ ゲームをはじめる</span>
                            <div className="text-[9px] text-[var(--muted-foreground)]">START → ゲームライブラリ</div>
                        </button>

                        <button onClick={onOpenEditor} className="w-full rpg-command rounded-lg px-3 py-2.5 border-2 border-[var(--border)] text-left hover:border-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/10 transition-all">
                            <span className="text-xs">▶ ルールをいじる</span>
                            <div className="text-[9px] text-[var(--muted-foreground)]">EDIT RULE</div>
                        </button>

                        <button onClick={onDealerPanic} disabled={isProcessing} className="w-full rpg-command rounded-lg px-3 py-2.5 border-2 border-[var(--destructive)] text-left hover:bg-[var(--destructive)]/10 transition-all">
                            <span className="text-xs text-[var(--destructive)]">▶ プレイヤーを蹴る</span>
                            <div className="text-[9px] text-[var(--muted-foreground)]">KICK</div>
                        </button>

                        {state.phase === 'setup' && (
                            <>
                                <div className="flex gap-2 flex-wrap">
                                    {(['weak', 'normal', 'strong'] as const).map((l) => (
                                        <button key={l} onClick={() => handleAddBot(l)} disabled={isProcessing} className="flex-1 bg-amber-900/50 hover:bg-amber-800 text-amber-200 py-2 rounded text-xs font-bold border border-amber-700 disabled:opacity-50">
                                            🤖 CPU追加 ({l === 'weak' ? '弱' : l === 'normal' ? '普通' : '強'})
                                        </button>
                                    ))}
                                </div>
                                {addBotFeedback && <div className="text-xs text-amber-200">{addBotFeedback}</div>}
                                {addBotSupported === false && <div className="text-xs text-red-300">CPU追加非対応サーバーです</div>}
                                <div className="flex flex-wrap gap-2">
                                    {state.players.filter((p: any) => p.isBot).map((p: any) => (
                                        <div key={p.id} className="flex items-center gap-1 bg-gray-800 rounded-full px-3 py-1 text-xs">
                                            <span>{p.name}</span>
                                            <button onClick={() => handleHostAction('remove_bot', { targetUserId: p.id })} className="w-4 h-4 rounded-full bg-red-700 hover:bg-red-600 text-[10px]">×</button>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        <button onClick={() => handleHostAction('reset_game', {}, 'ゲームをリセットしますか？')} disabled={isProcessing} className="w-full mt-2 bg-red-900/50 hover:bg-red-800 text-red-200 py-2 rounded text-sm font-bold border border-red-800 disabled:opacity-50">
                            ⚠ ゲームリセット
                        </button>
                        <button onClick={() => handleHostAction('shuffle_deck')} disabled={isProcessing} className="w-full mt-2 bg-blue-900/50 hover:bg-blue-800 text-blue-200 py-2 rounded text-sm font-bold border border-blue-800 disabled:opacity-50">
                            🔀 山札シャッフル
                        </button>

                        <DeckEditor socket={socket} roomId={roomId} userId={userId} currentDraft={state.draftDeck || []} isProcessing={isProcessing} onProcessStart={() => setIsProcessing(true)} onProcessEnd={() => setIsProcessing(false)} />
                    </div>
                )}
                {activeTab === 'host' && !isHost && (
                    <div className="text-xs text-[var(--muted-foreground)]">ホスト専用メニューです</div>
                )}
            </div>
        </div>
    );
}
