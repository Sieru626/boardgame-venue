'use client';

import { useState, useRef, useEffect } from 'react';
import { Socket } from 'socket.io-client';

type AIChatTabProps = {
    socket: Socket | null;
    roomId: string;
    gmChat: any[];
};

export default function AIChatTab({ socket, roomId, gmChat }: AIChatTabProps) {
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [localChat, setLocalChat] = useState<{ sender: string, text: string }[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Initial load: Copy prop chat to local if needed, or just start fresh/empty?
    // For now, we'll display local session. If you want persistent history, we'd need to emit 'chat' to server after receiving AI response.

    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [localChat]);

    const sendQuery = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim()) return;

        const currentInput = input;
        setInput('');
        setIsThinking(true);

        // Optimistic UI
        setLocalChat(prev => [...prev, { sender: 'me', text: currentInput }]);

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: currentInput,
                    // Simple context: just last few messages
                    context: localChat.slice(-3)
                })
            });
            const data = await res.json();

            if (res.ok) {
                setLocalChat(prev => [...prev, { sender: 'ai', text: data.reply }]);
            } else {
                setLocalChat(prev => [...prev, { sender: 'ai', text: `(Error: ${data.error})` }]);
            }

        } catch (err: any) {
            setLocalChat(prev => [...prev, { sender: 'ai', text: `(Connection Error: ${err.message})` }]);
        } finally {
            setIsThinking(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 bg-purple-900/20 border-b border-purple-900/50 text-xs text-purple-300">
                Rule Master AI (Beta via HTTP)<br />
                ルールやゲームの進行について質問できます。<br />
                <span className="opacity-50 text-[10px]">※会話は現在この画面のみに表示されます</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {localChat.length === 0 && (
                    <div className="text-gray-500 text-xs text-center italic">AIに質問してみましょう</div>
                )}

                {localChat.map((c, i) => (
                    <div key={i} className={`flex flex-col ${c.sender === 'ai' ? 'items-start' : 'items-end'}`}>
                        <div className={`text-[10px] mb-1 ${c.sender === 'ai' ? 'text-purple-400' : 'text-gray-500'}`}>
                            {c.sender === 'ai' ? 'GM (AI)' : 'あなた'}
                        </div>
                        <div className={`max-w-[85%] rounded p-2 text-sm whitespace-pre-wrap ${c.sender === 'ai'
                                ? 'bg-purple-900/40 border border-purple-800 text-purple-100'
                                : 'bg-gray-800 text-gray-400'
                            }`}>
                            {c.text}
                        </div>
                    </div>
                ))}

                {isThinking && (
                    <div className="flex flex-col items-start animate-pulse">
                        <div className="text-[10px] mb-1 text-purple-400">GM (AI)</div>
                        <div className="bg-purple-900/20 rounded p-2 text-xs text-purple-300">
                            Thinking...
                        </div>
                    </div>
                )}

                <div ref={scrollRef}></div>
            </div>

            <form onSubmit={sendQuery} className="p-2 border-t border-gray-800">
                <input
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm focus:border-purple-500 outline-none"
                    placeholder="AIに質問する..."
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    disabled={isThinking}
                />
            </form>
        </div>
    );
}
