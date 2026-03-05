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
    const [dealerSpeech, setDealerSpeech] = useState<string>('ようこそ。新しいゲームの秩序へ。準備はいい？');
    const [dealerThinking, setDealerThinking] = useState(false);
    const [dealerWorking, setDealerWorking] = useState(false);

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

        const socketUrl = (typeof window !== 'undefined' ? window.location.origin : '') || process.env.NEXT_PUBLIC_SOCKET_URL || '';
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

    // ディーラーパネルからの入力 → AIディーラー（HTTP）→ ログ&チャットに返答を流す
    const DEALER_THINKING_MIN_MS = 700;
    const sendDealerMessage = async (text: string) => {
        if (!socket || !text.trim()) return;

        const trimmed = text.trim();
        const thinkingStart = Date.now();
        setDealerThinking(true);

        // 1) まずは通常チャットとして全員に見えるように流す
        socket.emit('game_action', {
            roomId,
            type: 'chat',
            payload: { message: trimmed },
            userId
        }, () => {});

        try {
            const recent = (state?.chat || []).slice(-6).map(c => ({
                sender: c.sender,
                message: c.message
            }));

            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: trimmed,
                    context: recent,
                    roomId,
                    userId
                })
            });

            const data = await res.json();
            const speech: string = String(data.speech || data.reply || '');

            if (speech) {
                setDealerSpeech(speech);
                // 2) AIディーラーの返答もログ&チャットに載せる
                socket.emit('game_action', {
                    roomId,
                    type: 'chat',
                    payload: { message: `【AI Dealer】${speech}` },
                    userId
                }, () => {});
            }

            if (data.emotion === 'panic') {
                triggerDealerPanic();
            }

            // 3) フェーズ2: actionCommand が change_mode ならホストとしてゲームモード変更を実行
            const cmd = data.actionCommand;
            if (cmd && cmd.type === 'change_mode' && typeof cmd.gameMode === 'string' && cmd.gameMode) {
                const me = state?.players?.find((p: Player) => p.id === userId);
                if (me?.isHost) {
                    setDealerThinking(false);
                    setDealerWorking(true);
                    socket.emit('game_action', { roomId, type: 'chat', payload: { message: '【AI Dealer】えっと、会場を準備しています…！' }, userId }, () => {});
                    socket.emit('host_action', {
                        roomId,
                        type: 'change_mode',
                        payload: { gameMode: String(cmd.gameMode).toLowerCase() },
                        userId
                    }, (res: any) => {
                        setDealerWorking(false);
                        if (res?.ok === false) console.warn('[AI Dealer] change_mode failed:', res.error);
                    });
                }
            }
        } catch (err) {
            console.error('Dealer AI error', err);
            triggerDealerPanic();
            setDealerSpeech('ひぇぇ！マニュアルを濡らしてしまって…ちょっと待ってくださいね！');
            socket.emit('game_action', {
                roomId,
                type: 'chat',
                payload: { message: '（AI Dealerがマニュアルを拭いています…少し待ってからもう一度試してください）' },
                userId
            }, () => {});
        } finally {
            const elapsed = Date.now() - thinkingStart;
            const remain = Math.max(0, DEALER_THINKING_MIN_MS - elapsed);
            if (remain > 0) setTimeout(() => setDealerThinking(false), remain);
            else setDealerThinking(false);
        }
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
        <div className="flex flex-col h-screen cyber-bg cyber-grid scanlines text-[var(--foreground)] overflow-hidden font-sans relative">
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

            {/* V0 style Header */}
            <header className="flex items-center justify-between px-5 py-3 neon-panel shrink-0 rounded-none" style={{ borderLeft: 'none', borderRight: 'none', borderTop: 'none' }}>
                <div className="flex items-center gap-4">
                    <h1 className="text-lg neon-lime tracking-widest font-sans">NEW GAME ORDER</h1>
                    <span className="text-xs text-[var(--muted-foreground)] font-sans hidden md:inline opacity-60">{"// BOARD GAME VENUE //"}</span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 neon-panel-amber px-3 py-1.5 rounded-lg">
                        <span className="text-[10px] text-[var(--muted-foreground)] font-sans hidden sm:inline">ROOM:</span>
                        <span className="neon-amber text-sm tracking-wider font-sans">{String(roomId)}</span>
                        <button
                            className="text-[var(--neon-amber)] hover:text-[var(--neon-lime)] transition-all hover:scale-110 p-0.5 rounded"
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
                    <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-[var(--neon-lime)] text-[var(--neon-lime)] block" />
                        <span className="text-xs neon-lime font-sans">ONLINE</span>
                    </div>
                    {myPlayer && <span className="neon-cyan font-bold text-sm">{String(myPlayer.name)}</span>}
                </div>
            </header>

            {/* v0 Main: Left Dealer | Center Board | Right Info+Chat */}
            <div className="flex flex-1 min-h-0">
                {/* Left: AI Dealer */}
                <aside className="w-72 flex-shrink-0 p-3 border-r border-[var(--neon-lime)]/10 hidden md:flex flex-col">
                    <AIDealerPanel
                        isPanic={dealerPanic}
                        isThinking={dealerThinking}
                        isWorking={dealerWorking}
                        speech={dealerSpeech}
                        onSendMessage={sendDealerMessage}
                        onSetupVenue={isHost ? () => setShowLibrary(true) : undefined}
                    />
                </aside>

                {/* Center: GameSelect + Game Board */}
                <main className="flex-1 flex flex-col p-4 gap-4 min-w-0 min-h-0 overflow-hidden">
                    {/* GameSelect bar (V0 style) */}
                    <div className="neon-panel rounded-lg px-4 py-3 flex-shrink-0">
                        <div className="flex items-center gap-5 flex-wrap">
                            <span className="text-xs neon-lime tracking-[0.2em] font-sans whitespace-nowrap">{">> GAME SELECT"}</span>
                            <div className="flex gap-2 flex-1 min-w-0 flex-wrap">
                                {GAMES.map((game) => {
                                    const isSelected = selectedMode === game.id;
                                    return (
                                        <button
                                            key={game.id}
                                            onClick={() => isHost && setShowLibrary(true)}
                                            className={`tab-cyber px-4 py-2 rounded-lg text-xs font-sans tracking-wide transition-all whitespace-nowrap ${isSelected ? 'active' : ''} ${
                                                isSelected ? 'bg-[var(--neon-lime)]/10 border border-[var(--neon-lime)] text-[var(--neon-lime)]' : 'bg-[var(--secondary)]/60 border border-transparent text-[var(--muted-foreground)] hover:text-[var(--neon-lime)] hover:border-[var(--neon-lime)]/30'
                                            } ${isHost ? 'cursor-pointer' : 'cursor-default'}`}
                                            style={isSelected ? { boxShadow: '0 0 20px rgba(204,255,0,0.2), inset 0 0 15px rgba(204,255,0,0.05)' } : {}}
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

                {/* Right: V0 Info Panels + Chat */}
                <aside className="w-80 flex-shrink-0 p-3 border-l border-[var(--neon-cyan)]/10 flex flex-col gap-3 min-h-0 hidden md:flex">
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

            {/* V0 Status Bar */}
            <footer className="flex items-center justify-center gap-8 px-5 py-2 border-t border-[var(--neon-lime)]/15 bg-[var(--card)]/80 backdrop-blur-sm shrink-0">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--neon-lime)] block" />
                    <span className="text-[10px] text-[var(--muted-foreground)] font-sans tracking-wider">PLAYERS: {state.players.length}</span>
                </div>
                <span className="text-[10px] text-[var(--border)] font-sans">|</span>
                <span className="text-[10px] text-[var(--muted-foreground)] font-sans tracking-wider">{state.phase === 'setup' ? 'LOBBY' : state.phase.toUpperCase()}</span>
                <span className="text-[10px] text-[var(--border)] font-sans">|</span>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--neon-lime)] block" />
                    <span className="text-[10px] text-[var(--muted-foreground)] font-sans tracking-wider">DEALER: READY</span>
                </div>
                <span className="text-[10px] text-[var(--border)] font-sans">|</span>
                <span className="text-[10px] text-[var(--muted-foreground)] font-sans tracking-wider">ROOM: {roomId}</span>
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
        <div className="neon-panel-cyan rounded-lg p-3 flex flex-col h-full min-h-0">
            <div className="flex items-center gap-2 mb-2 flex-shrink-0">
                <span className="text-xs neon-cyan tracking-[0.2em] font-sans">LOG & CHAT</span>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 min-h-0 mb-2 pr-1">
                {chat.map((c: any, i: number) => {
                    const rawSender = c?.sender ?? '';
                    const rawMessage = c?.message ?? '';

                    // Systemメッセージはそのまま
                    if (rawSender === 'System') {
                        return (
                            <div key={i} className="text-xs font-sans leading-relaxed text-[var(--muted-foreground)]">
                                {">"} {String(rawMessage)}
                            </div>
                        );
                    }

                    // AIディーラー専用フォーマット: メッセージ先頭が【AI Dealer】なら「ディーラーちゃん」として表示
                    let displaySender = String(rawSender);
                    let displayMessage = String(rawMessage);

                    const isAI = typeof rawMessage === 'string' && rawMessage.startsWith('【AI Dealer】');
                    if (isAI) {
                        displaySender = 'AI';
                        displayMessage = rawMessage.replace(/^【AI Dealer】/, '').trim();
                    }

                    return (
                        <div key={i} className="text-xs font-sans leading-relaxed">
                            {isAI ? (
                                <div className="flex gap-2 items-start">
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--neon-cyan)]/20 text-[var(--neon-cyan)] font-sans flex-shrink-0">AI</span>
                                    <span className="neon-cyan">{displayMessage}</span>
                                </div>
                            ) : (
                                <span className="text-[var(--foreground)]"><span className="neon-amber">{displaySender}</span>: {displayMessage}</span>
                            )}
                        </div>
                    );
                })}
                <div ref={logEndRef} />
            </div>
            <form onSubmit={sendChat} className="flex gap-2 flex-shrink-0">
                <input
                    type="text"
                    value={msg}
                    onChange={e => setMsg(e.target.value)}
                    placeholder="メッセージを入力..."
                    className="flex-1 bg-[var(--input)] border border-[var(--neon-cyan)]/30 rounded-lg px-3 py-2 text-xs font-sans text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--neon-cyan)] focus:outline-none focus:shadow-[0_0_15px_rgba(34,211,238,0.15)] transition-all"
                />
                <button type="submit" disabled={isChatSending} className="neon-btn-cyan rounded-lg px-3 py-2 disabled:opacity-50" aria-label="Send message">
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

    const borderClass = activeTab === 'rule' ? 'neon-panel' : activeTab === 'player' ? 'neon-panel-cyan' : 'neon-panel-amber';

    return (
        <div className={`${borderClass} rounded-lg overflow-hidden flex flex-col min-h-0 h-full`}>
            <div className="flex border-b border-[var(--border)] shrink-0">
                {(['rule', 'player', 'host'] as const).map((tab) => {
                    const labels = { rule: 'RULE', player: 'PLAYER', host: 'HOST' };
                    const colors = { rule: 'neon-lime', player: 'neon-cyan', host: 'neon-amber' };
                    const isActive = activeTab === tab;
                    return (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`tab-cyber flex-1 py-2.5 px-3 text-xs font-sans transition-all relative ${isActive && tab === 'rule' ? 'active neon-lime bg-[var(--neon-lime)]/10' : ''} ${isActive && tab === 'player' ? 'active neon-cyan bg-[var(--neon-cyan)]/10' : ''} ${isActive && tab === 'host' ? 'active neon-amber bg-[var(--neon-amber)]/10' : ''} ${!isActive ? 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]' : ''}`}
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
                            <span className="text-[10px] neon-panel-cyan rounded px-2 py-0.5 neon-cyan font-sans">{state.players.length}/6</span>
                        </div>
                        {myPlayer && (
                            <div className="neon-panel-cyan rounded-lg p-3">
                                <div className="text-sm neon-cyan font-sans">{myPlayer.name}</div>
                                <div className="text-[10px] text-[var(--muted-foreground)]">{isHost ? 'HOST' : 'PLAYER'}</div>
                                <div className="text-xs mt-2">手札: <span className="neon-lime font-bold">{myPlayer.hand?.length ?? 0}</span></div>
                            </div>
                        )}
                        {state.players.filter(p => p.id !== userId).map((p) => (
                            <div key={p.id} className="flex justify-between px-3 py-2 rounded-lg bg-[var(--secondary)]/50">
                                <span className="text-xs">{p.name}</span>
                                <span className={`text-[10px] ${p.status === 'online' ? 'neon-lime' : 'text-[var(--muted-foreground)]'}`}>{p.status}</span>
                            </div>
                        ))}
                    </div>
                )}
                {activeTab === 'host' && isHost && (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <span className="text-sm neon-amber font-sans">{">> HOST COMMANDS"}</span>
                            <span className="text-[10px] neon-panel-amber rounded px-2 py-0.5 neon-amber font-sans">ADMIN</span>
                        </div>

                        <button
                            onClick={() => handleHostAction('start_game', {}, '現在の設定でゲームを開始しますか？')}
                            className="w-full rounded-lg px-3 py-2.5 text-left border border-[var(--neon-lime)] hover:bg-[var(--neon-lime)]/10 transition-all neon-btn"
                        >
                            <span className="text-sm neon-lime">▶ ゲームをはじめる</span>
                            <div className="text-[9px] text-[var(--muted-foreground)]">START → SELECTED GAME MODE</div>
                        </button>

                        <button onClick={onOpenEditor} className="w-full rounded-lg px-3 py-2.5 text-left border border-[var(--border)] hover:border-[var(--neon-cyan)] hover:bg-[var(--neon-cyan)]/10 transition-all neon-btn-cyan">
                            <span className="text-sm neon-cyan">🃏 デッキを編集</span>
                            <div className="text-[9px] text-[var(--muted-foreground)]">AFTER MATCH → DECK EDITOR</div>
                        </button>

                        <div className="flex flex-col gap-2 mt-1">
                            <span className="text-[10px] neon-cyan font-sans tracking-wider">{">> ADD CPU"}</span>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    className="flex-1 rounded px-2 py-1.5 text-[10px] font-sans border border-[var(--neon-cyan)]/50 hover:bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] transition-all disabled:opacity-50"
                                    disabled={!addBotSupported}
                                    onClick={() => handleAddBot('weak')}
                                >
                                    CPU 弱
                                </button>
                                <button
                                    type="button"
                                    className="flex-1 rounded px-2 py-1.5 text-[10px] font-sans border border-[var(--neon-cyan)]/50 hover:bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] transition-all disabled:opacity-50"
                                    disabled={!addBotSupported}
                                    onClick={() => handleAddBot('normal')}
                                >
                                    CPU 普通
                                </button>
                                <button
                                    type="button"
                                    className="flex-1 rounded px-2 py-1.5 text-[10px] font-sans border border-[var(--neon-cyan)]/50 hover:bg-[var(--neon-cyan)]/10 text-[var(--neon-cyan)] transition-all disabled:opacity-50"
                                    disabled={!addBotSupported}
                                    onClick={() => handleAddBot('strong')}
                                >
                                    CPU 強
                                </button>
                            </div>
                            {addBotFeedback && (
                                <div className="text-[10px] text-[var(--muted-foreground)]">{addBotFeedback}</div>
                            )}
                        </div>

                        <button
                            onClick={() => handleHostAction('reset_game', {}, '現在のゲームをリセットしますか？')}
                            className="w-full rounded-lg px-3 py-2.5 text-left border border-[var(--neon-red)] hover:bg-[var(--neon-red)]/10 transition-all neon-btn-red"
                        >
                            <span className="text-sm neon-red">■ ゲームをリセットする</span>
                            <div className="text-[9px] text-[var(--muted-foreground)]">RESET → BACK TO LOBBY</div>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

