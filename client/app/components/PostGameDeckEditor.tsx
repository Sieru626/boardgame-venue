import React, { useState, useEffect } from 'react';
import Card from './Card';

// Types
type Card = { id: string; name: string; text?: string; tags?: string[]; count?: number; isDisabled?: boolean; meta?: Record<string, any> };
type CardPile = {
    pileId: string;     // 'scene' | 'law' | 'event' | 'role' | 'draw' | etc
    title: string;
    cards: Card[];
};
type DraftTemplate = {
    templateId?: string;
    name: string;
    mode: string;
    piles: CardPile[];
    ruleProfile?: any;
    updatedAt: number;
};

interface PostGameDeckEditorProps {
    socket: any;
    roomId: string;
    userId: string;
    state: any; // Full Game state
    onClose: () => void;
}

export default function PostGameDeckEditor({ socket, roomId, userId, state, onClose }: PostGameDeckEditorProps) {
    const [draft, setDraft] = useState<DraftTemplate | null>(null);
    const [activePileId, setActivePileId] = useState<string>('');
    const [filterState, setFilterState] = useState<'all' | 'on' | 'off'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [rebuildStatus, setRebuildStatus] = useState<string>('');
    const [overrideMode, setOverrideMode] = useState<string>(''); // Local override

    // --- Core Logic: Initialize Draft ---
    useEffect(() => {
        initDraft();
    }, []);

    const initDraft = (mode: string = '') => {
        console.log("DeckEditor Init: Requesting data (Mode:", mode || 'Default', ")...");
        setRebuildStatus('Loading...');

        // Pass overrideMode if set
        const reqPayload: any = { roomId, userId };
        if (mode) reqPayload.overrideMode = mode;

        // [Source of Truth] Must wait for server.
        socket.emit('request_deck_data', reqPayload, (res: any) => {
            if (res?.ok && res.data?.template) {
                const loaded = res.data.template;
                const source = res.data.source;

                // Client-side visual normalization (ensure meta object exists for UI safety)
                if (loaded.piles) {
                    loaded.piles.forEach((p: any) => {
                        if (p.cards) {
                            p.cards.forEach((c: any) => {
                                if (!c.meta) c.meta = {};
                                // Ensure ID
                                if (!c.id) c.id = crypto.randomUUID();
                            });
                        }
                    });
                }

                setDraft(loaded);
                // Also update local Override state to match loaded mode
                if (mode) setOverrideMode(mode);
                setRebuildStatus(`Loaded: ${source.toUpperCase()}`);
            } else {
                console.error("Deck Load Failed:", res?.error);
                setRebuildStatus('Load Failed');
                alert('データの読み込みに失敗しました。再試行してください。\nError: ' + (res?.error || 'Unknown'));
                // Don't close, allow retry
            }
        });
    };

    const handleModeSwitch = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newMode = e.target.value;
        if (!newMode) return;
        if (confirm(`モードを「${newMode}」に変更しますか？現在の未保存の編集内容は破棄されます。`)) {
            setOverrideMode(newMode);
            initDraft(newMode);
        }
    };

    // Set active pile
    useEffect(() => {
        if (draft && draft.piles && draft.piles.length > 0 && !activePileId) {
            // Prefer 'scene' if free_talk?
            const scene = draft.piles.find(p => p.pileId === 'scene');
            if (scene) setActivePileId('scene');
            else setActivePileId(draft.piles[0].pileId);
        }
    }, [draft]);

    const handleUpdateDraft = (newDraft: DraftTemplate) => {
        setDraft(newDraft);
    };

    // Auto-save draft to server (Debounced)
    useEffect(() => {
        if (!draft) return;
        // Don't save empty/broken drafts
        if (!draft.piles || draft.piles.length === 0) return;

        const timer = setTimeout(() => {
            socket.emit('draft_template_set', { roomId, userId, draftTemplate: draft });
        }, 1000);
        return () => clearTimeout(timer);
    }, [draft]);

    if (!draft) return <div className="p-4 text-white">Loading Editor...</div>;

    const currentPile = (draft.piles || []).find(p => p.pileId === activePileId);

    // --- Actions ---

    const addPile = () => {
        const title = prompt("新しい束の名前 (例: イベントカード)");
        if (!title) return;
        const newPileId = `pile-${Date.now()}`;
        const newPiles = [...draft.piles, { pileId: newPileId, title, cards: [] }];
        handleUpdateDraft({ ...draft, piles: newPiles });
        setActivePileId(newPileId);
    };

    const addCard = (pileId: string) => {
        const pileIndex = draft.piles.findIndex(p => p.pileId === pileId);
        if (pileIndex === -1) return;

        const newPiles = [...draft.piles];
        const newCardId = crypto.randomUUID();
        newPiles[pileIndex].cards.unshift({
            id: newCardId,
            name: 'New Card',
            count: 1,
            text: '',
            isDisabled: false,
            meta: {}
        });
        handleUpdateDraft({ ...draft, piles: newPiles });
    };

    const updateCard = (pileId: string, cardId: string, field: keyof Card, value: any) => {
        const pileIndex = draft.piles.findIndex(p => p.pileId === pileId);
        if (pileIndex === -1) return;
        const newPiles = [...draft.piles];
        const cardIndex = newPiles[pileIndex].cards.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        newPiles[pileIndex].cards[cardIndex] = { ...newPiles[pileIndex].cards[cardIndex], [field]: value };
        handleUpdateDraft({ ...draft, piles: newPiles });
    };

    const updateRoleDef = (pileId: string, cardId: string, key: string, name: string) => {
        const pileIndex = draft.piles.findIndex(p => p.pileId === pileId);
        if (pileIndex === -1) return;
        const newPiles = [...draft.piles];
        const cardIndex = newPiles[pileIndex].cards.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;

        const card = newPiles[pileIndex].cards[cardIndex];
        const currentMeta = card.meta || {};
        const currentDefs = currentMeta.roleDefinitions || {};

        newPiles[pileIndex].cards[cardIndex] = {
            ...card,
            meta: {
                ...currentMeta,
                roleDefinitions: { ...currentDefs, [key]: name }
            }
        };
        handleUpdateDraft({ ...draft, piles: newPiles });
    };

    const deleteCard = (pileId: string, cardId: string) => {
        if (!confirm('削除しますか？')) return;
        const pileIndex = draft.piles.findIndex(p => p.pileId === pileId);
        if (pileIndex === -1) return;
        const newPiles = [...draft.piles];
        const cardIndex = newPiles[pileIndex].cards.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        newPiles[pileIndex].cards.splice(cardIndex, 1);
        handleUpdateDraft({ ...draft, piles: newPiles });
    };

    const toggleDisable = (pileId: string, cardId: string) => {
        const pileIndex = draft.piles.findIndex(p => p.pileId === pileId);
        if (pileIndex === -1) return;
        const newPiles = [...draft.piles];
        const cardIndex = newPiles[pileIndex].cards.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;
        const current = newPiles[pileIndex].cards[cardIndex].isDisabled;
        newPiles[pileIndex].cards[cardIndex].isDisabled = !current;
        handleUpdateDraft({ ...draft, piles: newPiles });
        handleUpdateDraft({ ...draft, piles: newPiles });
    };

    // --- Special Cards Logic (MixJuice) ---
    const addSpecialCard = (type: 'ice' | 'cider') => {
        // Find special pile
        let pileIndex = draft.piles.findIndex(p => p.pileId === 'special');
        if (pileIndex === -1) {
            // Should verify logic in initDraft, but safety create
            const newPile = { pileId: 'special', title: 'スペシャル', cards: [] };
            draft.piles.unshift(newPile);
            pileIndex = 0;
        }

        const newPiles = [...draft.piles];
        const code = type === 'ice' ? 'A' : 'B';
        const name = type === 'ice' ? 'アイス' : 'サイダー';

        // ID Strategy: mix_sp_${type}_${timestamp}_${random} to ensure uniqueness
        const newCardId = `mix_sp_${type}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        newPiles[pileIndex].cards.push({
            id: newCardId,
            name: name,
            count: 1,
            text: type === 'ice' ? 'ミックスジュース！(合計7以上なら勝利)' : '乾杯！(次の人はカードを2枚引く)',
            isDisabled: false,
            meta: {
                mixjuice: {
                    type: 'special',
                    code: code
                }
            }
        });

        handleUpdateDraft({ ...draft, piles: newPiles });
        setActivePileId('special'); // Switch view to special
    };

    const handleApply = async (rematch: boolean) => {
        const version = state.version || 0;
        if (rematch && !confirm('リマッチしますか？')) return;

        // Validity Check
        if (!draft || !draft.piles || draft.piles.length === 0) {
            alert('データが空です。適用できません。');
            return;
        }
        const totalCards = draft.piles.reduce((acc, p) => acc + (p.cards ? p.cards.length : 0), 0);
        if (totalCards === 0) {
            alert('カードが0枚です。適用できません。');
            return;
        }

        // [MixJuice Spec] Merge Logic
        // Clone draft to avoid mutating UI state
        const submissionDraft = JSON.parse(JSON.stringify(draft));
        const isMixJuice = state.phase === 'mixjuice' || submissionDraft.mode === 'mixjuice' || state.selectedMode === 'mixjuice';

        if (isMixJuice) {
            // 1. Ensure Draw Pile
            let drawPile = submissionDraft.piles.find((p: any) => p.pileId === 'draw');
            if (!drawPile) {
                drawPile = { pileId: 'draw', title: '山札', cards: [] };
                submissionDraft.piles.push(drawPile);
            }

            // 2. Clean Draw Pile: Remove existing Special Cards (prevent duplication)
            // Filter out cards that have meta.mixjuice.type === 'special'
            drawPile.cards = drawPile.cards.filter((c: any) => !(c.meta?.mixjuice?.type === 'special'));

            // 3. Merge: Copy all cards from Special Pile to Draw Pile
            const specialPile = submissionDraft.piles.find((p: any) => p.pileId === 'special');
            if (specialPile && specialPile.cards.length > 0) {
                // Copy cards
                const specials = JSON.parse(JSON.stringify(specialPile.cards));
                drawPile.cards.push(...specials);
            }

            // Note: We send BOTH piles (draw has merged, special has originals). 
            // Server start_game uses 'draw', logic uses 'special' for next edit.
        }

        socket.emit('template_apply_to_active', { roomId, userId, version, draftTemplate: submissionDraft }, (res: any) => {
            if (res?.ok) {
                if (rematch) {
                    socket.emit('rematch_with_active_template', { roomId, userId, version });
                    onClose();
                } else {
                    alert('適用しました');
                }
            } else alert(res?.error || 'Error');
        });
    };

    const filteredCards = (currentPile ? currentPile.cards : []).filter(c => {
        // [MixJuice Security] Hide Special Cards if we are viewing the DRAW pile
        // Because they are duplicate/merged and shouldn't be edited there.
        // Editing should happen in 'special' pile only.
        if (currentPile?.pileId === 'draw' && c.meta?.mixjuice?.type === 'special') return false;

        if (filterState === 'on' && c.isDisabled) return false;
        if (filterState === 'off' && !c.isDisabled) return false;
        if (searchQuery) {
            const low = searchQuery.toLowerCase();
            return c.name.toLowerCase().includes(low) || (c.text || '').toLowerCase().includes(low);
        }
        return true;
    });

    const isMixJuiceMode = draft.mode === 'mixjuice' || state.phase === 'mixjuice' || state.selectedMode === 'mixjuice';

    const isScenePile = currentPile && (currentPile.pileId === 'scene' || currentPile.title.includes('シーン'));

    // --- UI Render ---

    // Import Card component dynamically effectively or just use it if available in scope. 
    // Since I cannot change imports easily with replace_content in one go without context, 
    // I will assume Card is available or I need to import it.
    // Wait, I should add the import.

    // I will use replace_content to replace the whole file structure or a large chunk.
    // Actually, I'll rewrite the return and add the import in a separate step if needed.
    // BUT `Card` is not imported. I need to add `import Card from './Card';`

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-gray-900 w-full max-w-6xl h-[90vh] rounded-xl shadow-2xl border border-gray-700 flex flex-col overflow-hidden font-sans">

                {/* Header */}
                <div className="bg-gradient-to-r from-blue-900 to-gray-900 p-4 shrink-0 flex items-center justify-between border-b border-gray-700">
                    <div className="flex items-center gap-4">
                        <span className="text-xl font-black text-white flex items-center gap-2">🛠 デッキ編集</span>
                        <div className="h-6 w-px bg-gray-600 mx-2"></div>
                        <input
                            className="bg-gray-800/50 text-white rounded px-3 py-1 text-sm font-bold border border-transparent focus:border-blue-500 outline-none w-64 hover:bg-gray-800 transition"
                            value={draft.name}
                            onChange={(e) => handleUpdateDraft({ ...draft, name: e.target.value })}
                            placeholder="テンプレート名"
                        />
                        <span className="text-xs text-gray-500 ml-2">{rebuildStatus != null ? String(rebuildStatus) : ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* MixJuice Special UI (Top Right or Toolbar?) - Let's put it in body using specs, but keep header clean */}
                        <button
                            onClick={() => { if (confirm('初期化しますか？')) initDraft(); }}
                            className="text-xs bg-red-900/30 text-red-200 px-3 py-1.5 rounded hover:bg-red-900/50 border border-red-800/50 transition"
                        >
                            ⚡ リセット
                        </button>
                        <button onClick={onClose} className="text-gray-400 hover:text-white px-3 py-1 rounded hover:bg-white/10 text-xl transition">✕</button>
                    </div>
                </div>

                {/* Toolbar & Tabs */}
                <div className="bg-gray-800 border-b border-gray-700 p-2 shrink-0 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <div className="flex gap-1 overflow-x-auto scrollbar-hide py-1">
                            {(draft.piles || []).map(p => (
                                <button
                                    key={p.pileId}
                                    onClick={() => setActivePileId(p.pileId)}
                                    className={`whitespace-nowrap px-4 py-2 rounded-lg text-sm font-bold transition-all transform duration-200 ${activePileId === p.pileId
                                        ? 'bg-blue-600 text-white shadow-lg scale-105'
                                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
                                        }`}
                                >
                                    {String(p?.title ?? '')}
                                </button>
                            ))}
                            <button onClick={addPile} className="px-3 py-1 text-gray-500 hover:text-white font-bold text-lg bg-gray-800 rounded border border-gray-700 hover:border-gray-500 transition" title="山札追加">+</button>
                        </div>

                        <div className="flex gap-2">
                            <div className="flex bg-gray-900 rounded p-1 mx-2">
                                <button onClick={() => setFilterState('all')} className={`px-3 py-1 text-xs font-bold rounded transition ${filterState === 'all' ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>All</button>
                                <button onClick={() => setFilterState('on')} className={`px-3 py-1 text-xs font-bold rounded transition ${filterState === 'on' ? 'bg-green-900 text-green-200' : 'text-gray-500'}`}>ON</button>
                                <button onClick={() => setFilterState('off')} className={`px-3 py-1 text-xs font-bold rounded transition ${filterState === 'off' ? 'bg-gray-700 text-gray-400' : 'text-gray-500'}`}>OFF</button>
                            </div>
                            <input
                                className="bg-gray-900 border border-gray-600 rounded px-3 py-1 text-sm text-white focus:border-blue-500 outline-none w-48"
                                placeholder="🔍 カード検索..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* --- MixJuice Special Section --- */}
                {isMixJuiceMode && (
                    <div className="bg-gradient-to-r from-indigo-900/50 to-purple-900/50 p-3 border-b border-indigo-700/50 shrink-0 flex items-center gap-4 animate-in slide-in-from-top-2">
                        <div className="flex items-center gap-2 text-indigo-200 font-bold shrink-0">
                            <span className="text-2xl">🧊</span>
                            <span>スペシャルカード</span>
                        </div>
                        <div className="h-6 w-px bg-indigo-700/50 mx-2"></div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => addSpecialCard('ice')}
                                className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-1.5 rounded-lg shadow-lg font-bold border border-cyan-400 transition active:scale-95 flex items-center gap-2"
                            >
                                ＋ アイス (A)
                            </button>
                            <button
                                onClick={() => addSpecialCard('cider')}
                                className="bg-yellow-600 hover:bg-yellow-500 text-white px-4 py-1.5 rounded-lg shadow-lg font-bold border border-yellow-400 transition active:scale-95 flex items-center gap-2"
                            >
                                ＋ サイダー (B)
                            </button>
                        </div>
                        <div className="ml-auto text-xs text-indigo-300 opacity-70">
                            ※ここに追加したカードはゲーム開始時に山札へ混ざります
                        </div>
                    </div>
                )}

                {/* Main Content: Grid */}
                <div className="flex-1 overflow-y-auto p-6 bg-[#1a1a1a]">
                    {currentPile && (
                        <div className="max-w-7xl mx-auto">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold text-gray-200 flex items-center gap-2">
                                    {String(currentPile?.title ?? '')}
                                    <span className="text-sm font-normal text-gray-500 bg-black/20 px-2 py-0.5 rounded-full">{filteredCards.length} 枚</span>
                                </h2>
                                <button onClick={() => addCard(currentPile.pileId)} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-bold shadow-lg transition active:scale-95 flex items-center gap-2">
                                    <span>＋</span> カード追加
                                </button>
                            </div>

                            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-6 pb-20">
                                {filteredCards.map((c) => (
                                    <div key={c.id} className={`group relative bg-gray-800 rounded-xl p-3 border-2 transition-all duration-200 flex flex-col gap-3 hover:shadow-2xl hover:-translate-y-1 ${c.isDisabled ? 'border-gray-700 opacity-60 grayscale' : 'border-gray-700 hover:border-blue-500/50'
                                        }`}>

                                        {/* Visual Card Preview */}
                                        <div className="relative aspect-[2/3] w-full bg-gray-900/50 rounded-lg flex items-center justify-center overflow-hidden border border-gray-700/50 shadow-inner">
                                            {/* Special Badge */}
                                            {c.meta?.mixjuice?.type === 'special' && (
                                                <div className="absolute top-0 left-0 bg-yellow-500 text-black text-[10px] font-black px-1.5 py-0.5 rounded-br z-20 shadow-sm border-b border-r border-yellow-600">
                                                    SP
                                                </div>
                                            )}
                                            <div className="transform scale-[0.85] origin-center pointer-events-none select-none">
                                                {/* Use the shared Card component for accurate preview */}
                                                <Card card={c} isPreview={true} />
                                            </div>

                                            {/* Overlay Controls */}
                                            <div className="absolute top-2 right-2 flex gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => toggleDisable(currentPile.pileId, c.id)}
                                                    className={`p-1.5 rounded-md shadow-sm backdrop-blur-md border ${c.isDisabled ? 'bg-gray-600 text-white border-gray-500' : 'bg-white text-green-600 border-white'}`}
                                                    title={c.isDisabled ? "有効化" : "無効化"}
                                                >
                                                    {c.isDisabled ? '🚫' : '👁'}
                                                </button>
                                                <button
                                                    onClick={() => deleteCard(currentPile.pileId, c.id)}
                                                    className="bg-red-500/80 hover:bg-red-600 text-white p-1.5 rounded-md shadow-sm backdrop-blur-md border border-red-400"
                                                    title="削除"
                                                >
                                                    🗑
                                                </button>
                                            </div>
                                        </div>

                                        {/* Edit Form */}
                                        <div className="flex flex-col gap-2">
                                            <div className="flex gap-2">
                                                <input
                                                    className={`flex-1 bg-black/40 border border-gray-700 rounded px-2 py-1.5 text-sm font-bold text-center outline-none focus:border-blue-500 transition ${c.isDisabled ? 'text-gray-500 line-through' : 'text-white'}`}
                                                    value={String(c?.name ?? '')}
                                                    onChange={(e) => updateCard(currentPile.pileId, c.id, 'name', e.target.value)}
                                                    placeholder="カード名"
                                                />
                                                <div className="relative w-16">
                                                    <span className="absolute left-1.5 top-1.5 text-[10px] text-gray-500 pointer-events-none">x</span>
                                                    <input
                                                        type="number"
                                                        className="w-full bg-black/40 border border-gray-700 rounded pl-4 pr-1 py-1.5 text-sm text-center text-blue-200 font-mono outline-none focus:border-blue-500"
                                                        value={c.count || 1}
                                                        onChange={(e) => updateCard(currentPile.pileId, c.id, 'count', parseInt(e.target.value))}
                                                        min={1}
                                                    />
                                                </div>
                                            </div>

                                            <textarea
                                                className="w-full bg-black/20 border border-gray-700/50 rounded px-2 py-1 text-xs text-gray-400 resize-none h-16 outline-none focus:border-blue-500/50 transition focus:bg-black/40 focus:text-gray-200"
                                                value={c.text || ''}
                                                onChange={(e) => updateCard(currentPile.pileId, c.id, 'text', e.target.value)}
                                                placeholder="効果テキスト..."
                                            />

                                            {/* Role Map Expandable */}
                                            {isScenePile && (
                                                <details className="group/details">
                                                    <summary className="text-[10px] text-gray-500 font-bold uppercase cursor-pointer hover:text-blue-400 select-none flex items-center gap-1">
                                                        <span>▶ 役職設定 (Role Defs)</span>
                                                    </summary>
                                                    <div className="mt-2 grid grid-cols-1 gap-1 bg-black/30 p-2 rounded border border-gray-700/50 animate-in fade-in slide-in-from-top-1">
                                                        {['A', 'B', 'C', 'D', 'E', 'F'].map(key => (
                                                            <div key={key} className="flex items-center gap-1">
                                                                <span className="text-[10px] font-bold text-gray-500 w-3">{key}</span>
                                                                <input
                                                                    className="flex-1 bg-gray-900/80 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 focus:border-blue-500 outline-none"
                                                                    placeholder={`役職名 (${key})...`}
                                                                    value={(c.meta?.roleDefinitions || {})[key] || ''}
                                                                    onChange={(e) => updateRoleDef(currentPile.pileId, c.id, key, e.target.value)}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </details>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-700 bg-gray-800 flex justify-end gap-3 shrink-0 shadow-[0_-5px_20px_rgba(0,0,0,0.3)] z-10">
                    <div className="flex-1 flex items-center text-xs text-gray-500">
                        変更は自動保存されます。ゲームに反映するには「適用」を押してください。
                    </div>
                    <button onClick={onClose} className="px-6 py-2 bg-transparent hover:bg-gray-700 text-gray-300 font-bold rounded-lg border border-gray-600 transition">
                        閉じる
                    </button>
                    <button onClick={() => handleApply(false)} className="px-6 py-2 bg-gray-700 hover:bg-blue-900 text-blue-100 font-bold rounded-lg border border-gray-600 transition">
                        適用する
                    </button>
                    <button
                        onClick={() => handleApply(true)}
                        className="px-8 py-3 bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 text-white font-bold rounded-lg shadow-lg shadow-blue-900/50 transform transition active:scale-95 flex items-center gap-2"
                    >
                        <span className="text-xl">🚀</span> 適用してリマッチ
                    </button>
                </div>
            </div>
        </div>
    );
}
