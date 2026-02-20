'use client';

import { useState, useEffect } from 'react';

/** Prisma DateTime や ISO 文字列・数値を受け取り、JSX 用の文字列に変換する。オブジェクトを直接レンダリングしないよう必ず文字列を返す。 */
function formatDateTime(value: unknown): string {
    if (value == null) return '';
    if (value instanceof Date) return value.toLocaleString();
    if (typeof value === 'number' || typeof value === 'string') return new Date(value).toLocaleString();
    // React 要素やその他のオブジェクトは JSX に渡さない（"Objects are not valid as a React child" 防止）
    if (typeof value === 'object') return '';
    return String(value);
}

type GameTemplate = {
    id: string;
    title: string;
    mode: string;
    revision: number;
    updatedAt: string | number | Date; // API/Prisma で string または Date が渡る場合あり
    rulesText?: string;
    deckJson?: string;
};

type Props = {
    roomId: string;
    gameId: string;
    isHost: boolean;
    onClose: () => void;
    socket: any;
    currentDeck?: any[];
    currentMode?: string;
    userId: string;
};

export default function GameLibrary({ roomId, gameId, isHost, onClose, socket, currentDeck, currentMode, userId }: Props) {
    const [games, setGames] = useState<GameTemplate[]>([]);
    const [loading, setLoading] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedGame, setSelectedGame] = useState<GameTemplate | null>(null);
    const [mode, setMode] = useState<'list' | 'save'>('list');

    // Save Form State
    const [saveTitle, setSaveTitle] = useState('');
    const [saveRules, setSaveRules] = useState(''); // Legacy
    const [saveDeckJson, setSaveDeckJson] = useState('');
    const [saveType, setSaveType] = useState('turn_based');
    const [saveConfig, setSaveConfig] = useState<any>({});

    // Simple Client-side Preview Generator (Mirrors Server logic loosely)
    const previewCards = (() => {
        const cards = [];
        // Summary
        const typeLabel = {
            'turn_based': 'プレイヤーは手番順に山札からカードを引き、手札からカードをプレイします。',
            'free_talk': '自由に会話を行い、好きなタイミングでカードを使用できます。明確な手番はありません。',
            'round_score': 'ラウンドごとに得点を競います。',
            'mixjuice': 'カードの合計値を競うサバイバルゲーム。「0」のカードを持つとドボンとなります。',
        }[saveType] || 'カスタム';
        cards.push({ title: '概要', text: typeLabel });

        // Prep
        let prep = `山札枚数: ${saveConfig.deckCount || '標準'}`;
        if (saveType === 'turn_based') prep += `\n手札上限: ${saveConfig.handLimit || 'なし'}`;
        if (saveType === 'mixjuice') prep += `\nラウンド数: ${saveConfig.roundMax || 5}R`;
        cards.push({ title: '準備', text: prep });

        // Win
        cards.push({ title: '勝利条件', text: saveConfig.winCondition || '特定の条件を満たすこと。' });
        return cards;
    })();

    const updateConfig = (key: string, val: string) => {
        setSaveConfig((prev: any) => ({ ...prev, [key]: val }));
    };

    useEffect(() => {
        fetchGames();
    }, []);

    const startSaveMode = () => {
        const defaultDeck = currentDeck ? JSON.stringify(currentDeck, null, 2) : '';
        setSaveDeckJson(defaultDeck);
        setMode('save');
    };

    const fetchGames = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/games');
            const data = await res.json();
            setGames(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleApply = (templateId: string) => {
        if (!confirm('このゲーム設定を適用しますか？現在の盤面はリセットされます。')) return;
        socket.emit('apply_game_template', { roomId, gameId, templateId }, (res: any) => {
            if (res.ok) {
                alert('適用しました！');
                onClose();
            } else {
                alert('エラー: ' + res.error);
            }
        });
    };

    const handleSave = async () => {
        if (!saveTitle) return alert('タイトルは必須です');
        try {
            const res = await fetch('/api/games', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: saveTitle,
                    mode: currentMode || 'table',
                    type: saveType, // New
                    ruleConfig: JSON.stringify(saveConfig), // New
                    rulesText: saveRules,
                    deckJson: saveDeckJson
                })
            });
            const data = await res.json();
            if (data.ok) {
                alert('保存しました！');
                setMode('list');
                fetchGames();
            }
        } catch (e) {
            alert('保存に失敗しました');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 text-white w-full max-w-2xl p-6 rounded-lg shadow-xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">📚 ゲームライブラリ</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                </div>

                {mode === 'list' && (
                    <>
                        <div className="mb-4 flex gap-2">
                            <button onClick={startSaveMode} className="bg-green-600 px-3 py-1 rounded text-sm hover:bg-green-500">
                                + 現在の状態を保存
                            </button>
                            <button onClick={fetchGames} className="bg-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-600">
                                更新
                            </button>
                        </div>

                        {loading ? <p>読み込み中...</p> : (
                            <div className="space-y-2">
                                {games.map(t => (
                                    <div key={t.id} className="bg-gray-700 p-3 rounded">
                                        <div>
                                            <div className="font-bold text-lg">{String(t?.title ?? '')}</div>
                                            <div className="text-xs text-gray-400">
                                                モード: {String(t?.mode ?? '')} | Rev: {String(t?.revision ?? '')} | {formatDateTime(t?.updatedAt)}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 mt-4 justify-end">
                                            {isHost && (
                                                <>
                                                    {/* Duplicate & Edit (Future) - Simplified here */}
                                                    <button
                                                        disabled={true} // Stub for now
                                                        className="bg-gray-700 text-gray-500 px-3 py-1 rounded text-xs opacity-50 cursor-not-allowed"
                                                    >
                                                        複製して編集 (未実装)
                                                    </button>

                                                    {/* Delete Button */}
                                                    <button
                                                        onClick={async () => {
                                                            if (!confirm(`「${t.title}」を削除しますか？この操作は取り消せません。`)) return;
                                                            try {
                                                                const res = await fetch(`/api/games/${t.id}`, { method: 'DELETE' });
                                                                if (res.ok) {
                                                                    alert('削除しました');
                                                                    fetchGames();
                                                                } else {
                                                                    const d = await res.json();
                                                                    alert('削除失敗: ' + d.error);
                                                                }
                                                            } catch (e: any) {
                                                                alert('削除エラー: ' + e.message);
                                                            }
                                                        }}
                                                        className="bg-red-900/50 hover:bg-red-700 text-red-200 px-3 py-1 rounded text-xs"
                                                    >
                                                        🗑 削除
                                                    </button>

                                                    {/* Apply / Start */}
                                                    <button
                                                        onClick={() => {
                                                            if (!confirm(`「${t.title}」を適用しますか？`)) return;

                                                            setIsLoading(true);
                                                            socket.emit('apply_game_template', { roomId, templateId: t.id }, (res: any) => {
                                                                setIsLoading(false);
                                                                if (res.ok) {
                                                                    onClose();
                                                                    alert(`「${t.title}」を適用しました。準備画面から開始してください。`);
                                                                } else {
                                                                    alert('Error: ' + res.error);
                                                                }
                                                            });
                                                        }}
                                                        className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded shadow-lg transition"
                                                        disabled={isLoading}
                                                    >
                                                        適用する
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {games.length === 0 && <p className="text-gray-400">保存されたゲームはありません。</p>}
                            </div>
                        )}
                    </>
                )}

                {mode === 'save' && (
                    <div className="grid grid-cols-2 gap-4 h-[600px]">
                        {/* Left: Editor */}
                        <div className="space-y-4 overflow-y-auto pr-2">
                            <h3 className="font-bold border-b border-gray-600 pb-2">ルール設定</h3>

                            <div>
                                <label className="block text-sm text-gray-400">ゲームタイトル</label>
                                <input
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2"
                                    value={saveTitle} onChange={e => setSaveTitle(e.target.value)}
                                    placeholder="例: 会議室のポーカー"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-gray-400">ゲームの形式</label>
                                <select
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2"
                                    value={saveType} onChange={e => setSaveType(e.target.value)}
                                >
                                    <option value="turn_based">ターン制 (Turn Based)</option>
                                    <option value="free_talk">会話型 (Free Talk)</option>
                                    <option value="round_score">得点/ラウンド制 (Score)</option>
                                    <option value="mixjuice">ミックスジュース (Mix Juice)</option>
                                </select>
                            </div>

                            {/* Dynamic Config Form */}
                            <div className="bg-gray-700/50 p-3 rounded space-y-3">
                                <div className="text-xs font-bold text-gray-400 uppercase">詳細設定 (Config)</div>
                                {saveType === 'turn_based' && (
                                    <>
                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <label className="text-xs text-gray-400">初期手札</label>
                                                <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-1"
                                                    value={saveConfig.dealCount || 5} onChange={e => updateConfig('dealCount', e.target.value)} />
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-xs text-gray-400">手札上限</label>
                                                <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-1"
                                                    value={saveConfig.handLimit || ''} onChange={e => updateConfig('handLimit', e.target.value)} placeholder="なし" />
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <label className="text-xs text-gray-400">ドロー枚数/T</label>
                                                <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-1"
                                                    value={saveConfig.drawCount || 1} onChange={e => updateConfig('drawCount', e.target.value)} />
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-xs text-gray-400">プレイ枚数/T</label>
                                                <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-1"
                                                    value={saveConfig.playCount || 1} onChange={e => updateConfig('playCount', e.target.value)} />
                                            </div>
                                        </div>
                                    </>
                                )}
                                {saveType === 'free_talk' && (
                                    <>
                                        <div>
                                            <label className="text-xs text-gray-400">制限時間 (秒)</label>
                                            <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-1"
                                                value={saveConfig.timeLimit || ''} onChange={e => updateConfig('timeLimit', e.target.value)} placeholder="無制限" />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">投票/解決方法</label>
                                            <input className="w-full bg-gray-900 border border-gray-600 rounded p-1"
                                                value={saveConfig.resolveMethod || ''} onChange={e => updateConfig('resolveMethod', e.target.value)} placeholder="例: 過半数で追放" />
                                        </div>
                                    </>
                                )}
                                {saveType === 'mixjuice' && (
                                    <>
                                        <div>
                                            <label className="text-xs text-gray-400">ラウンド数</label>
                                            <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-1"
                                                value={saveConfig.roundMax || 5} onChange={e => updateConfig('roundMax', e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400">勝利ライン (合計値)</label>
                                            <input type="number" className="w-full bg-gray-900 border border-gray-600 rounded p-1"
                                                value={saveConfig.winThreshold || 7} onChange={e => updateConfig('winThreshold', e.target.value)} />
                                        </div>
                                    </>
                                )}
                                <div>
                                    <label className="text-xs text-gray-400">勝利条件 (自由記述)</label>
                                    <textarea className="w-full bg-gray-900 border border-gray-600 rounded p-1 h-16 text-xs"
                                        value={saveConfig.winCondition || ''} onChange={e => updateConfig('winCondition', e.target.value)} placeholder="勝利条件を入力..." />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm text-gray-400">デッキ (JSON)</label>
                                <textarea
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 h-24 font-mono text-xs"
                                    value={saveDeckJson} onChange={e => setSaveDeckJson(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Right: Preview */}
                        <div className="bg-gray-900 p-4 rounded border border-gray-700 overflow-y-auto">
                            <h3 className="font-bold text-gray-400 mb-2 text-xs uppercase">プレビュー: 生成されるルール</h3>
                            <div className="space-y-2">
                                {/* Mock Preview based on client-side logic mimicking server */}
                                {previewCards.map((card: any, i: number) => (
                                    <div key={i} className="bg-blue-900/30 border border-blue-500/30 p-2 rounded">
                                        <div className="font-bold text-blue-300 text-sm">{String(card?.title ?? '')}</div>
                                        <div className="text-xs text-gray-300 whitespace-pre-wrap">{String(card?.text ?? '')}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="col-span-2 flex justify-end gap-2 mt-4 border-t border-gray-700 pt-4">
                            <button onClick={() => setMode('list')} className="text-gray-400 hover:text-white">キャンセル</button>
                            <button onClick={handleSave} className="bg-blue-600 px-6 py-2 rounded hover:bg-blue-500 font-bold">保存 (Save Game)</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
