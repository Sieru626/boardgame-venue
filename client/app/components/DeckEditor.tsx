'use client';

import { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';

type DeckEditorProps = {
    socket: Socket | null;
    roomId: string;
    userId: string;
    currentDraft: any[];
    isProcessing?: boolean;
    onProcessStart?: () => void;
    onProcessEnd?: () => void;
};

type CardLine = {
    id: string;
    name: string;
    count: number;
    // Potentially add more fields like 'text', 'type' later
};

export default function DeckEditor({ socket, roomId, userId, currentDraft, ...controlProps }: DeckEditorProps) {
    const [lines, setLines] = useState<CardLine[]>([]);
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    const generateDeck = async () => {
        const processing = controlProps.isProcessing || isGenerating;
        if (!prompt.trim() || processing) return;
        if (!confirm(`テーマ「${prompt}」でデッキを生成しますか？（現在の編集内容は上書きされます）`)) return;

        setIsGenerating(true);
        controlProps.onProcessStart?.();

        try {
            const res = await fetch('/api/ai/deck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ theme: prompt })
            });
            const data = await res.json();

            if (res.ok && data.cards) {
                // Convert generated cards to Editor Lines
                const newLines: CardLine[] = [];
                const map = new Map<string, number>();
                data.cards.forEach((c: any) => {
                    const name = c.name || "Unknown Card";
                    map.set(name, (map.get(name) || 0) + 1);
                });

                map.forEach((count, name) => {
                    newLines.push({ id: crypto.randomUUID(), name, count });
                });
                setLines(newLines);
                setPrompt('');
            } else {
                alert('生成エラー: ' + (data.error || '不明なエラー'));
            }
        } catch (e: any) {
            alert('接続エラー: ' + e.message);
        } finally {
            setIsGenerating(false);
            controlProps.onProcessEnd?.();
        }
    };

    // Load initial draft into lines
    useEffect(() => {
        if (!currentDraft || currentDraft.length === 0) {
            setLines([]);
            return;
        }

        // Group by name to form "lines"
        const grouped = new Map<string, number>();
        currentDraft.forEach(c => {
            const name = c.name || c; // Handle string or object
            grouped.set(name, (grouped.get(name) || 0) + 1);
        });

        const newLines: CardLine[] = [];
        grouped.forEach((count, name) => {
            newLines.push({ id: crypto.randomUUID(), name, count });
        });
        setLines(newLines);
    }, [currentDraft]);

    const addLine = () => {
        setLines([...lines, { id: crypto.randomUUID(), name: 'New Card', count: 1 }]);
    };

    const addTrumpDeck = () => {
        const suits = ['S', 'H', 'D', 'C'];
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const newLines: CardLine[] = [];
        suits.forEach(s => {
            ranks.forEach(r => {
                newLines.push({ id: crypto.randomUUID(), name: `${s}-${r}`, count: 1 });
            });
        });
        setLines([...lines, ...newLines]);
    };

    const updateLine = (id: string, field: keyof CardLine, value: any) => {
        setLines(lines.map(l => l.id === id ? { ...l, [field]: value } : l));
    };

    const removeLine = (id: string) => {
        setLines(lines.filter(l => l.id !== id));
    };

    const saveDraft = () => {
        if (!socket) return;
        // Flatten
        const deck: any[] = [];
        lines.forEach(l => {
            for (let i = 0; i < l.count; i++) {
                deck.push({ name: l.name, id: crypto.randomUUID() });
            }
        });

        socket.emit('host_action', {
            roomId,
            userId,
            type: 'update_deck',
            payload: { deck }
        }, (response: any) => {
            if (response?.ok === false) alert('Error: ' + response.error);
        });
    };

    const applyToDrawPile = () => {
        if (!socket) return;
        if (confirm('現在の山札をこの構成で上書きしますか？（手札と場は維持されます）')) {
            // Flatten lines to deck
            const deck: any[] = [];
            lines.forEach(l => {
                for (let i = 0; i < l.count; i++) {
                    deck.push({ name: l.name, id: crypto.randomUUID() });
                }
            });

            socket.emit('host_action', {
                roomId,
                userId,
                type: 'apply_deck_drawpile',
                payload: { deck }
            }, (response: any) => {
                if (response?.ok === false) alert('Error: ' + response.error);
            });
        }
    };

    const resetGame = () => {
        if (!socket) return;
        if (confirm('ゲームを完全にリセットしますか？（全員の手札と場が消去され、このデッキで再開します）')) {
            socket.emit('host_action', { roomId, userId, type: 'reset_game', payload: {} }, (response: any) => {
                if (response?.ok === false) alert('Error: ' + response.error);
            });
        }
    };

    return (
        <div className="space-y-4">
            <div className="bg-gray-800 p-4 rounded border border-gray-700">
                <h3 className="text-gray-400 font-bold mb-4 text-sm uppercase">デッキ編集</h3>

                <div className="space-y-2 mb-4 max-h-[300px] overflow-y-auto">
                    {lines.map((line) => (
                        <div key={line.id} className="flex gap-2 items-center">
                            <input
                                type="text"
                                value={line.name}
                                onChange={(e) => updateLine(line.id, 'name', e.target.value)}
                                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm flex-1"
                                placeholder="カード名"
                            />
                            <input
                                type="number"
                                value={line.count}
                                onChange={(e) => updateLine(line.id, 'count', parseInt(e.target.value))}
                                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm w-16 text-center"
                                min={1}
                            />
                            <button onClick={() => removeLine(line.id)} className="text-red-500 hover:text-red-400 px-2">×</button>
                        </div>
                    ))}
                    {lines.length === 0 && <div className="text-gray-500 text-sm italic text-center py-4">カードがありません</div>}
                </div>



                // ... addLine ...

                // ... ui ...
                <div className="bg-purple-900/10 border border-purple-900/30 p-3 rounded mb-4">
                    <label className="text-xs font-bold text-purple-400 block mb-2">AIデッキ生成</label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            className="flex-1 bg-gray-900 border border-purple-900/50 rounded px-2 py-1 text-sm text-white focus:border-purple-500 outline-none disabled:opacity-50"
                            placeholder={isGenerating ? "生成中..." : "テーマを入力 (例: ファンタジーRPGの武器)..."}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            disabled={isGenerating}
                        />
                        <button
                            onClick={generateDeck}
                            disabled={isGenerating}
                            className={`px-3 py-1 rounded text-xs font-bold transition ${isGenerating ? 'bg-gray-600 text-gray-400' : 'bg-purple-700 hover:bg-purple-600 text-purple-100'}`}
                        >
                            {isGenerating ? '...' : '生成'}
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 mb-4">
                    <button onClick={addLine} className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300 transition">+ カード追加</button>
                    <button onClick={addTrumpDeck} className="flex-1 py-2 bg-gray-700 hover:bg-purple-900 rounded text-sm text-purple-300 transition">+ トランプ一式</button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={saveDraft}
                        className="col-span-2 bg-blue-900/50 hover:bg-blue-800 text-blue-200 py-2 rounded text-sm font-bold border border-blue-800 transition"
                    >
                        💾 ドラフト保存
                    </button>
                    <button
                        onClick={applyToDrawPile}
                        className="bg-green-900/50 hover:bg-green-800 text-green-200 py-2 rounded text-sm font-bold border border-green-800 transition"
                    >
                        📥 山札へ反映
                    </button>
                    <button
                        onClick={resetGame}
                        className="bg-red-900/50 hover:bg-red-800 text-red-200 py-2 rounded text-sm font-bold border border-red-800 transition"
                    >
                        ♻ リセット
                    </button>
                </div>
            </div>

            <p className="text-xs text-gray-500 text-center">
                ※「ドラフト保存」だけではゲームに反映されません。<br />
                「山札へ反映」か「リセット」を押してください。
            </p>
        </div>
    );
}
