'use client';

import { useState, useMemo } from 'react';

type RuleCard = {
    id: string;
    title: string;
    text: string;
    type: string; // summary, preparation, turn, win, etc.
};

type Props = {
    rules: {
        text: string;
        summary: string;
        cards?: RuleCard[];
    };
};

export default function RuleBook({ rules }: Props) {
    const [search, setSearch] = useState('');
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const cards = useMemo(() => {
        return rules.cards || [];
    }, [rules]);

    const filteredCards = useMemo(() => {
        if (!search) return cards;
        return cards.filter(c =>
            c.title.includes(search) || c.text.includes(search)
        );
    }, [cards, search]);

    const togglePin = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setPinnedIds(prev =>
            prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id].slice(0, 3) // Max 3
        );
    };

    // Helper to render a card
    const renderCard = (card: RuleCard, isPinned = false) => {
        const isExpanded = expandedId === card.id;
        return (
            <div
                key={card.id}
                className={`
                    border rounded p-3 cursor-pointer transition-all
                    ${isPinned ? 'bg-yellow-900/20 border-yellow-500/50' : 'bg-gray-800 border-gray-700 hover:bg-gray-750'}
                `}
                onClick={() => setExpandedId(isExpanded ? null : card.id)}
            >
                <div className="flex justify-between items-start">
                    <div className="font-bold text-sm text-blue-200">{String(card?.title ?? '')}</div>
                    <button
                        onClick={(e) => togglePin(card.id, e)}
                        className={`text-xs px-1 rounded ${isPinned ? 'text-yellow-400' : 'text-gray-600 hover:text-gray-400'}`}
                    >
                        {isPinned ? '★' : '☆'}
                    </button>
                </div>
                {/* Always show first line or summary if collapsed? For now show full if short, truncated if long? */}
                {/* Let's show full text but it might be long. */}
                <div className={`mt-2 text-xs text-gray-300 leading-relaxed whitespace-pre-wrap ${isExpanded ? '' : 'line-clamp-3'}`}>
                    {String(card?.text ?? '')}
                </div>
                {!isExpanded && String(card?.text ?? '').length > 50 && (
                    <div className="text-[10px] text-gray-500 mt-1 text-center">▼ 詳細を見る</div>
                )}
            </div>
        );
    };

    const pinnedCards = cards.filter(c => pinnedIds.includes(c.id));
    const unpinnedFiltered = filteredCards.filter(c => !pinnedIds.includes(c.id));

    return (
        <div className="flex flex-col h-full bg-gray-900">
            {/* Search */}
            <div className="p-3 border-b border-gray-800">
                <input
                    type="text"
                    placeholder="🔍 ルールを検索..."
                    className="w-full bg-black/30 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4">

                {/* Pinned Section */}
                {pinnedCards.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-xs font-bold text-yellow-500 uppercase flex items-center gap-1">
                            <span>★ ピン留め</span>
                        </div>
                        <div className="space-y-2">
                            {pinnedCards.map(c => renderCard(c, true))}
                        </div>
                    </div>
                )}

                {/* Main List */}
                <div className="space-y-2">
                    <div className="text-xs font-bold text-gray-500 uppercase">ルール一覧</div>
                    <div className="space-y-2">
                        {unpinnedFiltered.length > 0 ? (
                            unpinnedFiltered.map(c => renderCard(c))
                        ) : (
                            <p className="text-gray-500 text-sm italic py-4 text-center">該当なし</p>
                        )}
                    </div>
                </div>

                {/* Fallback to old text rules if no cards */}
                {cards.length === 0 && rules?.text && (
                    <div className="bg-gray-800 p-4 rounded border border-gray-700 mt-4">
                        <div className="text-xs text-gray-400 mb-2">テキストルール</div>
                        <div className="text-sm text-gray-300 whitespace-pre-wrap">{String(rules.text ?? '')}</div>
                    </div>
                )}
                {cards.length === 0 && !rules.text && (
                    <p className="text-gray-500 text-center mt-10">ルール未設定</p>
                )}
            </div>
        </div>
    );
}
