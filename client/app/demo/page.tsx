import React from 'react';

export default function DemoPage() {
  return (
    <div
      className="min-h-screen bg-[#0a0a0a] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden"
      style={{
        fontFamily: "'DotGothic16', monospace",
        backgroundImage: 'repeating-linear-gradient(rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)'
      }}
    >
      {/* 画面四隅のRPG風フレーム装飾 */}
      <div className="absolute top-4 left-4 w-16 h-16 border-t-4 border-l-4 border-yellow-600 rounded-tl-lg opacity-80 pointer-events-none"></div>
      <div className="absolute top-4 right-4 w-16 h-16 border-t-4 border-r-4 border-yellow-600 rounded-tr-lg opacity-80 pointer-events-none"></div>
      <div className="absolute bottom-4 left-4 w-16 h-16 border-b-4 border-l-4 border-yellow-600 rounded-bl-lg opacity-80 pointer-events-none"></div>
      <div className="absolute bottom-4 right-4 w-16 h-16 border-b-4 border-r-4 border-yellow-600 rounded-br-lg opacity-80 pointer-events-none"></div>

      {/* ヘッダーエリア */}
      <div className="text-center z-10 mb-8 mt-4">
        <h2 className="text-gray-400 tracking-[0.2em] mb-2 text-sm">HORO</h2>
        <h1 className="text-5xl md:text-6xl text-[#fde047] font-bold tracking-widest drop-shadow-[0_0_15px_rgba(253,224,71,0.6)] mb-2">
          New Game Order
        </h1>
        <p className="text-gray-400 tracking-widest text-sm">// BOARD GAME VENUE //</p>
      </div>

      {/* ディーラーエリア */}
      <div className="relative z-10 flex flex-col items-center mb-10">
        <img
          src="/dealer.png"
          alt="Dealer"
          className="w-64 h-64 object-contain relative z-10"
          style={{ imageRendering: 'pixelated' }}
        />
        {/* メッセージウィンドウ */}
        <div className="relative z-20 mt-[-60px] bg-[#1a1a1a] border-4 border-gray-200 p-4 min-w-[340px] text-center rounded-sm shadow-[0_0_0_4px_#000,inset_0_0_0_2px_#000]">
          <p className="text-lg leading-relaxed">
            ようこそ。新しいゲームの秩序へ。<br />
            準備はいい？
          </p>
          <div className="absolute bottom-2 right-2 w-0 h-0 border-l-[6px] border-l-transparent border-t-[8px] border-t-white border-r-[6px] border-r-transparent animate-bounce"></div>
        </div>
      </div>

      {/* 操作パネルエリア */}
      <div className="flex flex-col md:flex-row gap-6 z-10 w-full max-w-3xl px-4">
        {/* 左：ホストパネル (緑) */}
        <div className="flex-1 bg-[#111] border-4 border-[#10b981] p-1 relative shadow-[0_0_0_4px_#000]">
          <div className="border-2 border-[#059669] p-5 h-full flex flex-col">
            <div className="flex items-center gap-2 mb-6 border-b-2 border-[#10b981] pb-2">
              <span className="text-xl">👑</span>
              <h2 className="text-[#10b981] text-xl tracking-widest">新しいテーブル</h2>
            </div>

            <div className="flex items-center gap-4 mb-6">
              <span className="text-[#10b981] w-8 text-center">👤</span>
              <input
                type="text"
                placeholder="Nickname"
                className="flex-1 bg-black border-2 border-gray-600 p-3 text-white focus:outline-none focus:border-[#10b981] transition-colors"
              />
            </div>

            <div className="flex items-center gap-4 mt-auto">
              <span className="text-[#10b981] w-8 text-center text-2xl font-bold">⟳</span>
              <button className="flex-1 bg-[#10b981] hover:bg-[#059669] text-black font-bold py-3 px-4 border-b-4 border-[#047857] active:border-b-0 active:translate-y-[4px] transition-all">
                CREATE
              </button>
            </div>
          </div>
        </div>

        {/* 右：ゲストパネル (黄) */}
        <div className="flex-1 bg-[#111] border-4 border-[#f59e0b] p-1 relative shadow-[0_0_0_4px_#000]">
          <div className="border-2 border-[#d97706] p-5 h-full flex flex-col">
            <div className="flex items-center gap-2 mb-6 border-b-2 border-[#f59e0b] pb-2">
              <span className="text-xl">🔑</span>
              <h2 className="text-[#f59e0b] text-xl tracking-widest">既存テーブルに参加</h2>
            </div>

            <div className="flex items-center gap-4 mb-6">
              <span className="text-[#f59e0b] w-8 text-center">🎫</span>
              <input
                type="text"
                placeholder="Room Code"
                className="flex-1 bg-black border-2 border-gray-600 p-3 text-white focus:outline-none focus:border-[#f59e0b] transition-colors"
              />
            </div>

            <div className="flex items-center gap-4 mt-auto">
              <span className="text-transparent w-8"></span>
              <button className="flex-1 bg-[#f59e0b] hover:bg-[#d97706] text-black font-bold py-3 px-4 border-b-4 border-[#b45309] active:border-b-0 active:translate-y-[4px] transition-all">
                JOIN
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* フッター装飾 */}
      <div className="mt-10 flex gap-8 text-sm text-[#10b981] z-10 font-bold tracking-widest">
        <span>● PLAYERS: -- LOBBY</span>
        <span>● DEALER: READY</span>
      </div>
    </div>
  );
}

