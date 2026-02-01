'use client';

import React from 'react';

type Player = {
    id: string;
    name: string;
    isHost?: boolean;
    isSpectator?: boolean; // We might need to map this from the parent if the raw object differs
    status: string;
};

type Props = {
    title?: string;
    players: any[]; // Using any to be flexible with different player shapes, but mapped to Player
    userId: string;
    isHost: boolean;
    minPlayers?: number;
    onToggleSpectator: (targetId: string) => void;
    onSelfToggle: (isSpectator: boolean) => void;
    currentMode?: string;
    onStartGame: () => void;
};

export default function GameSetupOverlay({
    title = 'ゲーム準備 (Preparation)',
    players,
    userId,
    isHost,
    minPlayers = 2,
    onToggleSpectator,
    onSelfToggle,
    currentMode = 'tabletop', // Default to tabletop
    onStartGame
}: Props) {
    const activePlayers = players.filter(p => !p.isSpectator);
    const playerCount = activePlayers.length;
    const canStart = playerCount >= minPlayers;


    // Map internal mode id to display name
    const getModeName = (m: string) => {
        if (m === 'oldmaid') return 'ババ抜き (Old Maid)';
        return '通常 (Tabletop)';
    };

    const modeName = getModeName(currentMode);

    return (
        <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center animate-in fade-in p-8">
            <h1 className="text-4xl font-bold text-green-400 mb-2 border-b-2 border-green-600 pb-2">{title}</h1>
            <div className="text-xl text-gray-300 mb-8 font-bold">現在のモード: <span className="text-yellow-400">{modeName}</span></div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8 w-full max-w-4xl">
                {players.map(p => {
                    const isMe = p.id === userId;
                    const isSpectator = p.isSpectator;
                    // Host can toggle anyone. Guest can toggle themselves.
                    const canToggle = isHost || isMe;

                    return (
                        <div key={p.id} className={`
                            flex items-center justify-between p-4 rounded-lg border-2 transition-all
                            ${isSpectator ? 'border-gray-700 bg-gray-800 text-gray-400' : 'border-blue-500 bg-blue-900/30 text-white'}
                        `}>
                            <div className="flex items-center gap-2">
                                <span className="text-2xl">{isSpectator ? '👁' : '👤'}</span>
                                <div>
                                    <div className="font-bold text-lg">{p.name} {isMe && '(あなた)'}</div>
                                    <div className="text-xs opacity-70">{isSpectator ? '観戦モード' : 'プレイヤー'}</div>
                                </div>
                            </div>

                            {canToggle && (
                                <button
                                    onClick={() => {
                                        if (isHost) {
                                            // Host action (even for self, host action is fine, or switch logic)
                                            // Host action `toggle_spectator` handles logic on server side simply flipping.
                                            onToggleSpectator(p.id);
                                        } else {
                                            // Guest self declaration
                                            onSelfToggle(!isSpectator);
                                        }
                                    }}
                                    className={`
                                        px-3 py-1 rounded text-xs font-bold border transition
                                        ${isSpectator
                                            ? 'bg-blue-600 border-blue-400 text-white hover:bg-blue-500'
                                            : 'bg-gray-700 border-gray-500 text-gray-300 hover:bg-gray-600'}
                                    `}
                                >
                                    {isSpectator ? '参戦させる' : '観戦にする'}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="flex flex-col gap-6 items-center w-full max-w-md">
                <div className="flex gap-4 items-center justify-center">
                    <div className="text-gray-400 text-sm">
                        プレイヤー: <span className="text-white font-bold text-xl">{playerCount}</span> 人
                    </div>
                    {isHost && (
                        <button
                            onClick={() => {
                                if (!canStart) {
                                    alert(`プレイヤーが${minPlayers}人以上必要です`);
                                    return;
                                }
                                if (confirm(`「${modeName}」を開始しますか？`)) {
                                    onStartGame();
                                }
                            }}
                            className={`
                                py-4 px-12 rounded-full shadow-lg transition transform text-xl font-bold
                                ${canStart
                                    ? 'bg-green-600 hover:bg-green-500 text-white hover:scale-105'
                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'}
                            `}
                        >
                            ゲーム開始
                        </button>
                    )}
                </div>
                {!isHost && (
                    <div className="text-gray-400 text-sm text-center">
                        ホストがゲーム設定中です...
                    </div>
                )}
            </div>
        </div>
    );
}
