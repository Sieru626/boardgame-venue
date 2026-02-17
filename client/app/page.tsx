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
  const [socket, setSocket] = useState<Socket | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('nickname');
    if (stored) setNickname(stored);

    const timeoutId = setTimeout(() => {
      if (loading) setConnectionError(true);
    }, 10000);

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
    const socketInstance = socketUrl
      ? io(socketUrl, { transports: ["websocket", "polling"], withCredentials: true })
      : io({ transports: ["websocket", "polling"], withCredentials: true });
    setSocket(socketInstance);

    socketInstance.on('connect', () => {
      console.log('Connected to backend');
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
  }, []);

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
        alert("作成に失敗しました:\n" + (res?.error || '不明なエラー'));
      }
    });
  };

  const handleJoinRoom = () => {
    const code = inviteCode || prompt("ルームコードを入力してください");
    if (code && nickname) {
      localStorage.setItem('nickname', nickname);
      router.push(`/room/${code}`);
    } else if (!nickname) {
      alert('ニックネームを入力してください');
    }
  };

  const reloadPage = () => window.location.reload();

  const canCreateRoom = isConnected && socket && !creating;

  return (
    <main className="h-screen overflow-y-auto bg-gray-900 text-white p-4 md:p-8">
      <div className="max-w-md mx-auto space-y-8 pb-20">
        <h1 className="text-4xl font-bold text-center text-blue-400">ボドゲテスト会場 <span className="text-sm text-amber-400">v8.2 (CPU1/2/3・神経衰弱Bot・先攻ランダム)</span></h1>
        <p className="text-center text-gray-500 text-xs">※ http://localhost:3010 で起動してください</p>

        <div className="text-center text-sm">
          {connectionError ? (
            <div className="bg-red-900/50 border border-red-500 rounded p-4 text-left">
              <div className="font-bold text-red-300 mb-2">⚠ サーバーに接続できません</div>
              <ul className="list-disc list-inside text-xs text-gray-300 mb-4 space-y-1">
                <li>サーバーが起動していない可能性があります</li>
                <li>Nodeの黒い画面(Server)が開いているか確認してください</li>
                <li>もしダメなら <code>STOP-ALL.cmd</code> → <code>start-all.bat</code> を試してください</li>
              </ul>
              <button onClick={reloadPage} className="w-full bg-red-700 hover:bg-red-600 text-white font-bold py-2 rounded">
                再読み込み (Retry)
              </button>
            </div>
          ) : (
            <>サーバー状態: {loading ? <span className="text-yellow-500">接続中...</span> : <span className="text-green-500">オンライン</span>}</>
          )}
        </div>

        {inviteCode && (
          <div className="bg-blue-900/50 border border-blue-500 p-4 rounded-lg text-center animate-pulse">
            <div className="text-sm text-blue-300 font-bold uppercase">招待されています</div>
            <div className="text-2xl font-mono font-bold text-white mt-1">{inviteCode}</div>
          </div>
        )}

        <div className="bg-gray-800 p-6 rounded-lg space-y-4">
          <label className="block text-sm font-medium">ニックネーム</label>
          <input
            type="text"
            className="w-full bg-gray-700 h-12 px-3 rounded text-white text-lg"
            placeholder="ニックネームを入力..."
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <div className="grid gap-6">
          {!inviteCode && (
            <div className="bg-gray-800 p-6 rounded-lg border-2 border-transparent hover:border-blue-500 transition">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-blue-400">
                <span className="text-2xl">👑</span> ホストとして始める
              </h2>
              <p className="text-gray-400 text-sm mb-4">新しいルームを作成し、ゲームの設定を行います。</p>
              <button
                onClick={handleCreateRoom}
                disabled={!canCreateRoom}
                className="w-full h-14 rounded font-bold text-lg transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 enabled:hover:bg-blue-700"
              >
                {creating ? '作成中...' : !isConnected ? '接続中です。しばらくお待ちください' : 'ルームを新規作成'}
              </button>
            </div>
          )}

          <div className={`bg-gray-800 p-6 rounded-lg border-2 border-transparent hover:border-green-500 transition ${inviteCode ? 'border-green-500 ring-2 ring-green-500/50' : ''}`}>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-green-400">
              <span className="text-2xl">👋</span> {inviteCode ? '招待に参加する' : 'ゲストとして参加'}
            </h2>
            <p className="text-gray-400 text-sm mb-2">{inviteCode ? 'ニックネームを入力して参加してください。' : 'ルームコードを入力して参加します。'}</p>
            {!inviteCode && <p className="text-gray-500 text-xs mb-4">※ ルームコードはホストから共有されます</p>}

            <button
              onClick={handleJoinRoom}
              className="w-full bg-green-600 hover:bg-green-700 h-14 rounded font-bold text-lg transition flex items-center justify-center"
            >
              {inviteCode ? '▶ 参加する' : 'ルームコードを入力'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeContent />
    </Suspense>
  );
}
