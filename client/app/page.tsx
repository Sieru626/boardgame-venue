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

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
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
    <main className="min-h-screen bg-black text-white font-dotgothic flex flex-col items-center justify-center p-4 overflow-hidden">
      {/* CRT風スキャンライン効果 */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-[0.03]" aria-hidden="true">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.35) 2px, rgba(0,0,0,0.35) 4px)',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-3xl flex flex-col items-center">
        {/* ロゴ */}
        <header className="text-center mb-2">
          <h1 className="text-3xl md:text-4xl font-bold text-[#FFD700] drop-shadow-[0_0_16px_rgba(255,215,0,0.7)] tracking-[0.2em]">
            NEW GAME ORDER
          </h1>
          <p className="text-xs md:text-sm text-white/80 mt-1 tracking-[0.3em]">
            // BOARD GAME VENUE //
          </p>
        </header>

        {/* サーバー状態・エラー（コンパクト表示） */}
        {connectionError ? (
          <div className="mb-2 w-full max-w-md bg-red-950/80 border border-red-500 rounded px-3 py-2 text-[11px] leading-snug">
            <div className="font-bold text-red-300 mb-1">⚠ サーバーに接続できません</div>
            <p className="text-gray-200">
              サーバーが起動しているか確認し、ダメな場合は STOP-ALL.cmd → start-all.bat を試してください。
            </p>
            <button
              onClick={reloadPage}
              className="mt-2 w-full bg-red-700 hover:bg-red-600 text-white font-bold py-1.5 rounded text-xs"
            >
              再読み込み (Retry)
            </button>
          </div>
        ) : (
          <div className="mb-1 text-[11px] text-white/60 tracking-[0.2em]">
            サーバー状態：
            {loading ? <span className="text-amber-400">接続中...</span> : <span className="text-emerald-400">● ONLINE</span>}
          </div>
        )}

        {/* 招待コードバナー */}
        {inviteCode && (
          <div className="mb-2 px-3 py-2 bg-amber-950/70 border border-amber-500 rounded text-center text-xs tracking-[0.2em]">
            <div className="text-amber-300 font-bold">INVITED ROOM</div>
            <div className="mt-1 text-lg font-mono text-[#FFD700]">{typeof inviteCode === 'string' ? inviteCode : ''}</div>
          </div>
        )}

        {/* ディーラー + 吹き出し + パネル一体構造（demo と同一デザイン） */}
        <div className="relative w-full mt-2">
          {/* ディーラーと吹き出し */}
          <div className="relative w-full flex flex-col items-center mb-[-32px] z-10">
            <img
              src="/dealer.png"
              alt="Dealer"
              className="w-64 h-64 object-contain relative z-10"
              style={{ imageRendering: 'pixelated' }}
            />
            <div className="relative mt-[-60px] z-20 bg-[#1a1a1a] border-4 border-gray-200 p-4 min-w-[280px] md:min-w-[340px] text-center rounded-sm shadow-[0_0_0_4px_#000,inset_0_0_0_2px_#000]">
              <p className="text-base md:text-lg leading-relaxed text-white">
                ようこそ。新しいゲームの秩序へ。<br />
                準備はいい？
              </p>
              <div className="absolute bottom-2 right-2 w-0 h-0 border-l-[6px] border-l-transparent border-t-[8px] border-t-white border-r-[6px] border-r-transparent animate-bounce" aria-hidden="true" />
            </div>
          </div>

          {/* テーブル兼コントロールパネル */}
          <div className="relative w-full border-4 border-yellow-700/90 rounded-2xl bg-gray-900/95 pt-10 pb-4 px-3 md:px-6 shadow-[0_0_32px_rgba(0,0,0,0.9)]">
            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 左：ホスト */}
              <div className="border-4 border-emerald-500 border-double rounded-xl bg-black/80 px-3 py-3 flex flex-col gap-2 shadow-[0_0_18px_rgba(16,185,129,0.45)]">
                <div className="flex items-center gap-2 text-emerald-300 text-xs md:text-sm font-bold tracking-[0.25em]">
                  <span className="text-xl md:text-2xl">👑</span>
                  <span>ホスト</span>
                </div>
                <p className="text-[11px] md:text-xs text-emerald-100/80 tracking-wide">
                  ホスト
                </p>
                <div className="mt-1 flex flex-col gap-1.5">
                  <span className="text-[11px] text-emerald-200/90 tracking-[0.18em]">ニックネーム</span>
                  <div className="relative h-8 md:h-9 bg-black border-2 border-emerald-500/70 rounded-sm flex items-center px-2 text-xs md:text-sm">
                    <input
                      type="text"
                      value={typeof nickname === 'string' ? nickname : ''}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder="NAME"
                      className="w-full bg-transparent text-white placeholder-gray-500 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handleCreateRoom}
                    disabled={!canCreateRoom}
                    className="mt-2 h-9 md:h-10 rounded-sm bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-bold text-xs md:text-sm tracking-[0.25em] shadow-[0_0_14px_rgba(16,185,129,0.6)]"
                  >
                    {creating
                      ? 'CREATING...'
                      : !isConnected
                        ? 'CONNECTING...'
                        : '部屋を作る'}
                  </button>
                </div>
              </div>

              {/* 右：ゲスト */}
              <div className="border-4 border-yellow-500 border-double rounded-xl bg-black/80 px-3 py-3 flex flex-col gap-2 shadow-[0_0_18px_rgba(245,158,11,0.5)]">
                <div className="flex items-center gap-2 text-yellow-300 text-xs md:text-sm font-bold tracking-[0.25em]">
                  <span className="text-xl md:text-2xl">🔑</span>
                  <span>ゲスト</span>
                </div>
                <p className="text-[11px] md:text-xs text-yellow-100/80 tracking-wide">
                  ゲスト
                </p>
                <div className="mt-1 flex flex-col gap-1.5">
                  <span className="text-[11px] text-yellow-200/90 tracking-[0.18em]">部屋コード</span>
                  <div className="relative h-8 md:h-9 bg-black border-2 border-yellow-500/70 rounded-sm flex items-center px-2 text-xs md:text-sm">
                    <input
                      type="text"
                      value={typeof roomCode === 'string' ? roomCode : ''}
                      onChange={(e) => setRoomCode(e.target.value)}
                      placeholder={typeof inviteCode === 'string' && inviteCode ? inviteCode : 'ROOM CODE'}
                      readOnly={!!inviteCode}
                      className="w-full bg-transparent text-white placeholder-gray-500 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handleJoinRoom}
                    className="mt-2 h-9 md:h-10 rounded-sm bg-[#FFD700] hover:bg-amber-300 text-black font-bold text-xs md:text-sm tracking-[0.25em] shadow-[0_0_14px_rgba(255,215,0,0.6)]"
                  >
                    参加する
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* フッターHUD */}
        <footer className="mt-3 text-[11px] text-white/60 tracking-[0.25em]">
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
        <div className="min-h-screen bg-black text-[#FFD700] font-dotgothic flex items-center justify-center">
          読み込み中...
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}

