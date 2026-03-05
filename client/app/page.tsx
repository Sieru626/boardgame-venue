'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { Suspense } from 'react';

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteCode = searchParams.get('room');

  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('nickname');
    if (stored) setNickname(stored);
    if (inviteCode) setRoomCode(inviteCode);

    const timeoutId = setTimeout(() => {
      if (loading) setConnectionError(true);
    }, 10000);

    const socketUrl = (typeof window !== 'undefined' ? window.location.origin : '') || process.env.NEXT_PUBLIC_SOCKET_URL || '';
    const socketInstance = socketUrl
      ? io(socketUrl, { transports: ['websocket', 'polling'], withCredentials: true })
      : io({ transports: ['websocket', 'polling'], withCredentials: true });
    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      setLoading(false);
      setConnectionError(false);
      setIsConnected(true);
      clearTimeout(timeoutId);
    });

    socketInstance.on('disconnect', () => {
      setIsConnected(false);
    });

    return () => {
      socketInstance.disconnect();
      clearTimeout(timeoutId);
    };
  }, [inviteCode, loading]);

  const handleCreateRoom = () => {
    if (!nickname) {
      alert('ニックネームを入力してください');
      return;
    }
    if (!socket?.connected) {
      alert('サーバーに接続されていません。表示が「オンライン」になってからもう一度お試しください。');
      return;
    }

    localStorage.setItem('nickname', nickname);

    let userId = localStorage.getItem('userId');
    if (!userId) {
      userId = crypto.randomUUID();
      localStorage.setItem('userId', userId);
    }

    setCreating(true);
    const ackTimeout = setTimeout(() => {
      setCreating(false);
      alert('ルーム作成がタイムアウトしました。サーバーが起動しているか確認し、再読み込みしてやり直してください。');
    }, 15000);

    socket.emit('create_room', { nickname, userId }, (res: any) => {
      clearTimeout(ackTimeout);
      setCreating(false);
      if (res?.ok && res?.data?.roomId) {
        router.push(`/room/${res.data.roomId}`);
      } else {
        alert('作成に失敗しました:\n' + (res?.error || '不明なエラー'));
      }
    });
  };

  const handleJoinRoom = () => {
    const code = inviteCode || roomCode.trim();
    if (code && nickname) {
      localStorage.setItem('nickname', nickname);
      router.push(`/room/${code}`);
    } else if (!nickname) {
      alert('ニックネームを入力してください');
    } else if (!code) {
      alert('部屋コードを入力してください');
    }
  };

  const reloadPage = () => window.location.reload();

  const canCreateRoom = isConnected && socket && !creating;

  return (
    <main className="min-h-screen cyber-bg cyber-grid scanlines text-[var(--foreground)] font-dotgothic flex flex-col items-center justify-center p-4 overflow-hidden">
      <div className="relative z-10 w-full max-w-3xl flex flex-col items-center">
        {/* ロゴ (V0: neon-lime) */}
        <header className="text-center mb-2">
          <h1 className="text-3xl md:text-4xl font-bold neon-lime tracking-[0.2em]">
            NEW GAME ORDER
          </h1>
          <p className="text-xs md:text-sm text-[var(--muted-foreground)] mt-1 tracking-[0.3em]">
            // BOARD GAME VENUE //
          </p>
        </header>

        {/* サーバー状態・エラー */}
        {connectionError ? (
          <div className="mb-2 w-full max-w-md neon-panel-red rounded-lg px-3 py-2 text-[11px] leading-snug">
            <div className="font-bold neon-red mb-1">⚠ サーバーに接続できません</div>
            <p className="text-[var(--foreground)]">
              サーバーが起動しているか確認し、ダメな場合は STOP-ALL.cmd → start-all.bat を試してください。
            </p>
            <button
              type="button"
              onClick={reloadPage}
              className="mt-2 w-full neon-btn-red rounded-lg py-1.5 text-xs font-sans"
            >
              再読み込み (Retry)
            </button>
          </div>
        ) : (
          <div className="mb-1 text-[11px] text-[var(--muted-foreground)] tracking-[0.2em]">
            サーバー状態：
            {loading ? <span className="neon-amber">接続中...</span> : <span className="neon-lime">● ONLINE</span>}
          </div>
        )}

        {/* 招待コードバナー */}
        {inviteCode && (
          <div className="mb-2 px-3 py-2 neon-panel-amber rounded-lg text-center text-xs tracking-[0.2em]">
            <div className="neon-amber font-bold">INVITED ROOM</div>
            <div className="mt-1 text-lg font-mono neon-amber">{typeof inviteCode === 'string' ? inviteCode : ''}</div>
          </div>
        )}

        {/* ディーラー + 吹き出し + パネル */}
        <div className="relative w-full mt-2">
          <div className="relative w-full flex flex-col items-center mb-[-32px] z-10">
            <img
              src="/dealer.png"
              alt="Dealer"
              className="w-64 h-64 object-contain relative z-10"
              style={{ imageRendering: 'pixelated' }}
            />
            <div className="relative mt-[-60px] z-20 neon-panel rounded-lg p-4 min-w-[280px] md:min-w-[340px] text-center">
              <p className="text-base md:text-lg leading-relaxed text-[var(--foreground)]">
                ようこそ。新しいゲームの秩序へ。<br />
                準備はいい？
              </p>
            </div>
          </div>

          {/* テーブル兼コントロールパネル (V0: neon-panel) */}
          <div className="relative w-full neon-panel-amber rounded-2xl pt-10 pb-4 px-3 md:px-6">
            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 左：ホスト */}
              <div className="neon-panel rounded-xl px-3 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 neon-lime text-xs md:text-sm font-bold tracking-[0.25em]">
                  <span className="text-xl md:text-2xl">👑</span>
                  <span>ホスト</span>
                </div>
                <p className="text-[11px] md:text-xs text-[var(--muted-foreground)] tracking-wide">ホスト</p>
                <div className="mt-1 flex flex-col gap-1.5">
                  <span className="text-[11px] text-[var(--muted-foreground)] tracking-[0.18em]">ニックネーム</span>
                  <div className="relative h-8 md:h-9 bg-[var(--input)] border border-[var(--neon-lime)]/30 rounded-lg flex items-center px-2 text-xs md:text-sm">
                    <input
                      type="text"
                      value={typeof nickname === 'string' ? nickname : ''}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder="NAME"
                      className="w-full bg-transparent text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateRoom}
                    disabled={!canCreateRoom}
                    className="mt-2 h-9 md:h-10 rounded-lg font-bold text-xs md:text-sm tracking-[0.25em] neon-btn disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creating ? 'CREATING...' : !isConnected ? 'CONNECTING...' : '部屋を作る'}
                  </button>
                </div>
              </div>

              {/* 右：ゲスト */}
              <div className="neon-panel-amber rounded-xl px-3 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 neon-amber text-xs md:text-sm font-bold tracking-[0.25em]">
                  <span className="text-xl md:text-2xl">🔑</span>
                  <span>ゲスト</span>
                </div>
                <p className="text-[11px] md:text-xs text-[var(--muted-foreground)] tracking-wide">ゲスト</p>
                <div className="mt-1 flex flex-col gap-1.5">
                  <span className="text-[11px] text-[var(--muted-foreground)] tracking-[0.18em]">部屋コード</span>
                  <div className="relative h-8 md:h-9 bg-[var(--input)] border border-[var(--neon-amber)]/30 rounded-lg flex items-center px-2 text-xs md:text-sm">
                    <input
                      type="text"
                      value={typeof roomCode === 'string' ? roomCode : ''}
                      onChange={(e) => setRoomCode(e.target.value)}
                      placeholder={typeof inviteCode === 'string' && inviteCode ? inviteCode : 'ROOM CODE'}
                      readOnly={!!inviteCode}
                      className="w-full bg-transparent text-[var(--foreground)] placeholder-[var(--muted-foreground)] focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleJoinRoom}
                    className="mt-2 h-9 md:h-10 rounded-lg font-bold text-xs md:text-sm tracking-[0.25em] neon-btn-amber"
                  >
                    参加する
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-3 text-[11px] text-[var(--muted-foreground)] tracking-[0.25em]">
          ● PLAYERS: -- LOBBY ● DEALER: READY
        </footer>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen cyber-bg text-[var(--foreground)] font-dotgothic flex items-center justify-center neon-lime">
          読み込み中...
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}

