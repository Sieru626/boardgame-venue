require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const path = require('path');
const next = require('next');

// --- Recovery Mode: AI Re-enabled via HTTP ---
const { GoogleGenAI } = require('@google/genai');

const PORT = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev, dir: path.join(__dirname, '../client') });
const handle = nextApp.getRequestHandler();

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);

// CORS Configuration
const clientUrls = process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : [];
const allowedOrigins = dev ? ["http://localhost:3000"] : (clientUrls.length > 0 ? clientUrls : "*");

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
// app.use(express.static('public')); 

// Connection Logging
io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}, origin: ${socket.handshake.headers.origin}`);
    socket.on('disconnect', (reason) => {
        console.log(`[socket] disconnected: ${socket.id}, reason: ${reason}`);
    });
});


// expressApp.use(express.static('public')); // Disable old static Serve, let Next handle it or separate logic? 
// Actually, we might still want 'public' for failover if Next fails? But Next handles public folder too.
// Let's keep it minimal for now to avoid conflict.


app.use(express.static('public')); // Serve Emergency Client

// --- HTTP AI Endpoints (Stateless) ---
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/ai/chat', async (req, res) => {
    try {
        const { message, context } = req.body;
        if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'AI Service Unavailable' });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([
            `You are a Game Master for a card game. Be helpful and concise. Context: ${JSON.stringify(context || {})}`,
            message
        ]);
        const reply = result.response.text();
        res.json({ reply });
    } catch (e) {
        console.error('AI Chat Error:', e);
        res.status(500).json({ error: 'AI processing failed' });
    }
});

app.post('/api/ai/deck', async (req, res) => {
    try {
        const { theme } = req.body;
        if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'AI Service Unavailable' });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
        const prompt = `Generate a deck of 5-10 cards for a board game based on the theme: "${theme}". 
        Return ONLY a JSON object with a property "cards" which is an array of objects. 
        Each object must have:
        - name (string): Creative name
        - description (string): Short effect text
        - type (string): "Unit" or "Action"
        - power (number): 1-10 (optional, 0 if action)
        `;

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        // Parse JSON safely
        let data;
        try {
            data = JSON.parse(text);
        } catch (jsonErr) {
            // Fallback for sometimes markdown wrapped json
            const match = text.match(/```json\n([\s\S]*)\n```/);
            if (match) data = JSON.parse(match[1]);
            else throw jsonErr;
        }

        res.json({ cards: data.cards || [] });
    } catch (e) {
        console.error('AI Deck Error:', e);
        res.status(500).json({ error: 'AI generation failed' });
    }
});

// --- Rule Generation Logic ---
function generateRuleCards(type, configStr) {
    let config = {};
    try { config = JSON.parse(configStr || '{}'); } catch (e) { }

    const cards = [];

    // 1. Summary Card
    const summaryText = {
        'turn_based': 'プレイヤーは手番順に山札からカードを引き、手札からカードをプレイします。',
        'free_talk': '自由に会話を行い、好きなタイミングでカードを使用できます。明確な手番はありません。',
        'round_score': 'ラウンドごとに得点を競います。最終的に最も得点の高いプレイヤーが勝利します。',
        'oldmaid': 'ペアを捨てて手札を減らします。最後にジョーカー(ババ)を持っていた人の負けです。',
        'mixjuice': 'カードの合計値を競うサバイバルゲーム。「0」のカードを持つとドボンとなります。'
    }[type] || 'カスタムゲーム';

    cards.push({ id: 'rule-summary', title: '概要', text: summaryText, type: 'summary' });

    // 2. Preparation
    let prepText = `山札枚数: ${config.deckCount || '標準'}`;
    if (type === 'turn_based') prepText += `\n手札上限: ${config.handLimit || 'なし'}`;
    if (type === 'mixjuice') prepText += `\nラウンド数: ${config.roundMax || 5}R`;
    if (config.dealCount) prepText += `\n初期手札: 各${config.dealCount}枚`;
    cards.push({ id: 'rule-prep', title: '準備', text: prepText, type: 'preparation' });

    // 3. Turn / Action
    let turnText = '';
    if (type === 'turn_based') {
        const draw = config.drawCount || 1;
        const play = config.playCount || 1;
        turnText = `【手番の流れ】\n1. 山札から${draw}枚引く\n2. 手札から${play}枚プレイする`;
    } else if (type === 'free_talk') {
        turnText = `自由に発言・カード使用が可能。\n(制限時間: ${config.timeLimit ? config.timeLimit + '秒' : 'なし'})`;
    }
    if (turnText) cards.push({ id: 'rule-turn', title: '手番・アクション', text: turnText, type: 'turn' });

    // 4. Win Condition
    let winText = config.winCondition || '特定の条件を満たすこと。';
    if (type === 'round_score') winText = '規定ラウンド終了時に最高得点であること。';
    if (type === 'oldmaid') winText = '手札を全て無くすこと（最後までジョーカーを持たない）。';
    if (type === 'mixjuice') winText = `合計値が${config.winThreshold || 7}以上で高得点を狙う（0は禁止）。`;
    cards.push({ id: 'rule-win', title: '勝利条件', text: winText, type: 'win' });

    return JSON.stringify(cards);
}

// --- Game Library API ---
app.get('/api/games', async (req, res) => {
    try {
        let games = await prisma.gameTemplate.findMany({
            select: { id: true, title: true, mode: true, type: true, revision: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' }
        });

        // Seed Dystopia v1 (Force Upsert to reflect latest code changes)
        const seedTitle = 'ディストピア家族会議 (テスト版v1)';
        const existingV1 = games.find(g => g.title === seedTitle);

        const v1SceneCards = [
            { id: "scene_abs_001_hospital", name: "病院", text: "静かな白い廊下。誰かの“順番”が近い気がする。" },
            { id: "scene_abs_002_cityhall", name: "役所", text: "書類が山。決裁待ち。『例外』という言葉がやけに重い。" },
            { id: "scene_abs_003_school", name: "学校", text: "チャイムが鳴る。誰かが“正しさ”を暗記している。" },
            { id: "scene_abs_004_shelter", name: "避難所", text: "毛布とペットボトル。足りないのは物か、言葉か。" },
            { id: "scene_abs_005_court", name: "裁判所", text: "静かに判決を待つ。罪があるのは個人か、仕組みか。" },
            { id: "scene_abs_006_platform", name: "駅のホーム", text: "来るはずの電車が来ない。人だけが増えていく。" },
            { id: "scene_abs_007_apartment_hall", name: "集合住宅（廊下）", text: "隣人の生活音。ドア一枚の向こうが、やけに遠い。" },
            { id: "scene_abs_008_warehouse", name: "倉庫", text: "積まれた箱。中身はわからないが“管理”だけはされている。" }
        ].map(c => ({ ...c, count: 1 }));

        const v1LawCards = [
            { id: "law_soft_001_no_english", name: "英語禁止条例", text: "今日の会議では英語を使ってはいけない。使った人はその場で言い直す（言い直すまで会議は進めない）。" },
            { id: "law_soft_002_honorifics_only", name: "敬語のみ条例", text: "敬語以外は禁止。タメ口が出たら「誰に向けた言葉か」を説明する。" },
            { id: "law_soft_003_subject_i", name: "主語は“私”条例", text: "「みんな」「誰か」「世間」を主語にした発言は禁止。必ず「私は〜」で話す。" },
            { id: "law_soft_004_name_calling", name: "名前呼び条例", text: "人を指すとき「お前」「あいつ」禁止。必ず名前で呼ぶ（呼べないなら理由を言う）。" },
            { id: "law_soft_005_question_first", name: "質問で返す条例", text: "反論したくなったら、まず質問を1つしてから。質問なしの反論は禁止。" },
            { id: "law_soft_006_one_sentence", name: "一文条例", text: "発言は一回につき一文だけ。長く話したい場合は、区切って順番に。" },
            { id: "law_soft_007_no_absolute", name: "嘘つき禁止条例", text: "断定（〜だ/絶対/100%）は禁止。「たぶん」「〜かもしれない」だけで話す。" },
            { id: "law_soft_008_no_silence", name: "沈黙の代わり条例", text: "黙るのは禁止。迷ったら必ず「保留」と言い、保留の理由を一言添える。" }
        ].map(c => ({ ...c, count: 1 }));

        const v1DeckJson = JSON.stringify({
            piles: [
                { pileId: 'scene', title: 'シーン', cards: v1SceneCards },
                { pileId: 'law', title: '条例', cards: v1LawCards }
            ]
        });

        if (existingV1) {
            // Update existing
            await prisma.gameTemplate.update({
                where: { id: existingV1.id },
                data: {
                    deckJson: v1DeckJson,
                    rulesText: 'シーンに合わせて会話を行い、条例に従いながら進行する。\n条例違反があれば「密告」し、ホストが認めれば勲章を得る。\n勲章が目標数(変更可)に達すれば勝利。',
                    ruleConfig: JSON.stringify({ winCondition: '勲章3つ', timeLimit: 300 }),
                    updatedAt: new Date() // Bump timestamp to show it changed
                }
            });
            console.log(`Updated template: ${seedTitle}`);
        } else {
            // Create new
            await prisma.gameTemplate.create({
                data: {
                    title: seedTitle,
                    mode: 'free_talk',
                    type: 'free_talk',
                    rulesText: 'シーンに合わせて会話を行い、条例に従いながら進行する。\n条例違反があれば「密告」し、ホストが認めれば勲章を得る。\n勲章が目標数(変更可)に達すれば勝利。',
                    deckJson: v1DeckJson,
                    ruleConfig: JSON.stringify({ winCondition: '勲章3つ', timeLimit: 300 }),
                    ruleCardsJson: '[]'
                }
            });
            console.log(`Created template: ${seedTitle}`);
        }

        // Seed Mix Juice (Force Upsert)
        const mjTitle = 'ミックスジュース';
        const existingMJ = games.find(g => g.title === mjTitle);
        const mjDeckJson = JSON.stringify({ piles: [] }); // Empty deck triggers auto-generation
        const mjRuleConfig = JSON.stringify({ roundMax: 5, winThreshold: 7 });

        if (existingMJ) {
            await prisma.gameTemplate.update({
                where: { id: existingMJ.id },
                data: {
                    deckJson: mjDeckJson,
                    ruleConfig: mjRuleConfig,
                    rulesText: 'カードの合計値を競うサバイバルゲーム。「0」のカードを持つとドボンとなります。',
                    updatedAt: new Date()
                }
            });
            console.log(`Updated template: ${mjTitle}`);
        } else {
            await prisma.gameTemplate.create({
                data: {
                    title: mjTitle,
                    mode: 'mixjuice',
                    type: 'mixjuice',
                    rulesText: 'カードの合計値を競うサバイバルゲーム。「0」のカードを持つとドボンとなります。',
                    deckJson: mjDeckJson,
                    ruleConfig: mjRuleConfig,
                    ruleCardsJson: '[]'
                }
            });
            console.log(`Created template: ${mjTitle}`);
        }

        // Re-fetch
        games = await prisma.gameTemplate.findMany({
            select: { id: true, title: true, mode: true, type: true, revision: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' }
        });

        res.json(games);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/games/:id', async (req, res) => {
    try {
        const game = await prisma.gameTemplate.findUnique({ where: { id: req.params.id } });
        if (!game) return res.status(404).json({ error: 'Not found' });
        res.json(game);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/games', async (req, res) => {
    try {
        const { title, mode, rulesText, deckJson, type, ruleConfig } = req.body;

        // Auto-generate Rule Cards
        const ruleCardsJson = generateRuleCards(type || 'turn_based', ruleConfig);

        const game = await prisma.gameTemplate.create({
            data: {
                title,
                mode: mode || 'table',
                type: type || 'turn_based',
                rulesText,
                deckJson,
                ruleConfig: ruleConfig || '{}',
                ruleCardsJson
            }
        });
        res.json({ ok: true, id: game.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/games/:id/duplicate', async (req, res) => {
    try {
        const original = await prisma.gameTemplate.findUnique({ where: { id: req.params.id } });
        if (!original) return res.status(404).json({ error: 'Not found' });

        const copy = await prisma.gameTemplate.create({
            data: {
                title: `${original.title} (Copy)`,
                mode: original.mode,
                type: original.type,
                rulesText: original.rulesText,
                deckJson: original.deckJson,
                ruleConfig: original.ruleConfig,
                ruleCardsJson: original.ruleCardsJson,
                revision: 1
            }
        });
        res.json({ ok: true, id: copy.id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/games/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.gameTemplate.delete({ where: { id } });
        res.json({ ok: true, id });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Server and IO initialized at top level
// const server = http.createServer(app);
// const io = new Server(server, ...);

// --- Simple State (Recovery) ---
function createInitialState(userId, nickname) {
    return {
        version: 0,
        phase: 'setup',
        selectedMode: 'tabletop', // Default mode
        players: [{
            id: userId,
            name: nickname,
            hand: [],
            role: null, // role logic simplified
            isHost: true,
            status: 'online'
        }],
        deck: [],
        table: [],
        chat: [], // Unified chat
        oldMaid: null,
        memory: null, // Memory game state
        oldMaid: null,
        memory: null, // Memory game state
        rules: { text: "No rules set.", summary: "" },

        // --- Phase 1.8 Editor Fields ---
        selectedTemplateId: null, // Saved template ID
        activeTemplate: null, // Current active configuration
        draftTemplate: null, // Editing configuration
        activeTemplate: null, // Current active configuration
        draftTemplate: null, // Editing configuration
        modeState: { status: 'setup' }, // Unified status tracking? merging phase

        // --- Phase 2: Dystopia State ---
        // --- Phase 2: FreeTalk State (Spec) ---
        freeTalk: null
    };
}

async function getActiveGame(roomId) {
    return await prisma.game.findFirst({
        where: { roomId },
        orderBy: { createdAt: 'desc' }
    });
}

// --- Helper: Generate Default Template (Source of Truth Fallback) ---
function generateDefaultTemplate(mode) {
    if (mode === 'mixjuice') {
        const deck = [];
        const colors = ['赤', '黄', '緑', '橙', '紫', '白'];
        colors.forEach(c => {
            for (let v = 0; v <= 5; v++) deck.push({ id: crypto.randomUUID(), name: `${c}${v}`, meta: { type: 'fruit', value: v } });
        });
        return {
            mode: 'mixjuice',
            piles: [{ pileId: 'draw', title: '山札', cards: deck }]
        };
    } else if (mode === 'oldmaid') {
        const deck = [];
        const suits = ['S', 'H', 'D', 'C'];
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        suits.forEach(s => ranks.forEach(r => deck.push({ id: crypto.randomUUID(), name: `${s}-${r}` })));
        deck.push({ id: crypto.randomUUID(), name: 'Joker' });
        return {
            mode: 'oldmaid',
            piles: [{ pileId: 'draw', title: '山札', cards: deck }]
        };
    } else if (mode === 'free_talk') {
        // Return skeleton for FreeTalk. 
        // ideally we fetch Dystopia v1 from DB, but for sync helper we return minimal valid structure.
        return {
            mode: 'free_talk',
            piles: [
                { pileId: 'scene', title: 'シーン', cards: [] },
                { pileId: 'law', title: '条例', cards: [] }
            ]
        };
    } else if (mode === 'memory') {
        const deck = [];
        const suits = ['S', 'H'];
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8'];
        suits.forEach(s => ranks.forEach(r => deck.push({ id: crypto.randomUUID(), name: `${s}-${r}` })));
        return {
            mode: 'memory',
            piles: [{ pileId: 'board', title: 'カード一覧', cards: deck }]
        };
    }
    // Generic
    return { mode: mode || 'tabletop', piles: [{ pileId: 'draw', title: '山札', cards: [] }] };
}

// --- Helper: Initialize State from Active Template ---
function initializeStateFromActiveTemplate(state) {
    // 1. Reset Common Fields
    state.table = [];
    state.discardPile = [];
    state.oldMaid = null;
    state.freeTalk = null;
    state.memory = null;

    // Reset Players (keep shell, clear state)
    state.players.forEach(p => {
        p.hand = [];
        p.isOut = false;
        p.role = null;
        // Keep isSpectator, name, id
    });

    const activePlayers = state.players.filter(p => !p.isSpectator && p.status === 'online');

    // 2. Identify Mode & Piles
    const template = state.activeTemplate || {};
    const mode = template.mode || state.selectedMode || 'turn_based';
    state.selectedMode = mode; // Sync

    // Parse Piles
    let piles = template.piles || [];
    if (!piles.length && template.deckJson) {
        try {
            const parsed = JSON.parse(template.deckJson);
            piles = Array.isArray(parsed) ? parsed : (parsed.piles || []);
            // Backwards compatibility for raw array of cards in deckJson (very old)
            if (!piles.length && Array.isArray(parsed) && parsed.length > 0 && parsed[0].id) {
                piles = [{ pileId: 'draw', title: '山札', cards: parsed }];
            }
        } catch (e) {
            console.warn("Failed to parse deckJson in initializeState", e);
        }
    }

    // 3. Mode Specific Initialization
    if (mode === 'free_talk') {
        const hasFreeTalkPiles = piles.some(p => p.pileId === 'scene' || p.title.includes('シーン'));

        let sceneDeck = [];
        let lawDeck = [];

        // Load Decks from Piles
        if (hasFreeTalkPiles) {
            const sPile = piles.find(p => p.pileId === 'scene' || p.title.includes('シーン'));
            const lPile = piles.find(p => p.pileId === 'law' || p.title.includes('条例'));

            if (sPile) {
                sceneDeck = sPile.cards
                    .filter(c => !c.isDisabled)
                    .map(c => ({
                        ...c,
                        id: crypto.randomUUID(),
                        // Move roleDefinitions to meta if not present (Migration)
                        meta: {
                            ...c.meta,
                            roleDefinitions: c.meta?.roleDefinitions || c.roleDefinitions || {}
                        }
                    }));
            }
            if (lPile) {
                lawDeck = lPile.cards
                    .filter(c => !c.isDisabled)
                    .map(c => ({ ...c, id: crypto.randomUUID() }));
            }
        }

        // Shuffle
        [sceneDeck, lawDeck].forEach(d => {
            for (let i = d.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [d[i], d[j]] = [d[j], d[i]];
            }
        });

        // Initialize FreeTalk State
        state.freeTalk = {
            status: 'playing',
            sceneDeck,
            lawDeck,
            currentScene: null,
            currentLaw: null,
            medals: state.players.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {}),
            config: { winMedals: 3, roundSeconds: 300 },
            timer: { roundSeconds: 300, endsAt: null, isRunning: false }
        };

        // Assign Roles Logic (A, B, C...)
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').slice(0, activePlayers.length);
        // Shuffle letters
        for (let i = letters.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [letters[i], letters[j]] = [letters[j], letters[i]];
        }
        activePlayers.forEach((p, idx) => {
            p.role = letters[idx];
        });

        state.phase = 'free_talk';

    } else if (mode === 'oldmaid') {
        let deck = [];
        const drawPile = piles.find(p => p.pileId === 'draw' || p.title === '山札');

        if (drawPile) {
            deck = drawPile.cards
                .filter(c => !c.isDisabled)
                .map(c => ({ ...c, id: crypto.randomUUID() }));
        } else {
            // Default Deck
            const suits = ['S', 'H', 'D', 'C'];
            const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
            suits.forEach(s => ranks.forEach(r => deck.push({ id: crypto.randomUUID(), name: `${s}-${r}` })));
            deck.push({ id: crypto.randomUUID(), name: 'Joker' });
        }

        // Shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        // Deal
        if (activePlayers.length >= 2) {
            let pIdx = 0;
            while (deck.length > 0) {
                activePlayers[pIdx].hand.push(deck.pop());
                pIdx = (pIdx + 1) % activePlayers.length;
            }
        }

        // Initialize OldMaid State (Pairs removal handled separately or here? Keeping it simple here, pairs are removed in client/start logic usually, but here we can prepare basic state)
        // Note: Logic allows manual start or auto. Let's set phase to 'playing' directly as requested "Rematch = auto start".
        state.oldMaid = {
            status: 'playing',
            turnIndex: 0,
            order: activePlayers.map(p => p.id),
            discardPile: [],
            winners: []
        };
        state.phase = 'oldmaid';

    } else if (mode === 'memory') {
        // Memory logic (Procedural generation for now, ignoring template deck unless defined)
        // If template has specific pairs, we could use them. For now, generate standard 8 pairs.
        const suits = ['S', 'H'];
        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8'];
        const cards = [];
        let idCount = 0;
        suits.forEach(s => ranks.forEach(r => {
            cards.push({ id: `m-${idCount++}`, suit: s, rank: r, faceUp: false, matched: false });
        }));

        // Shuffle
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }

        state.memory = {
            status: 'playing',
            board: cards,
            turnSeat: activePlayers.map(p => p.id),
            turnIndex: 0,
            flips: [],
            scores: activePlayers.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {}),
            lockUntil: 0
        };
        state.phase = 'playing';

    } else {
        // Standard / Turn Based
        const drawPile = piles.find(p => p.pileId === 'draw' || p.title === '山札');
        if (drawPile) {
            state.deck = drawPile.cards
                .filter(c => !c.isDisabled)
                .map(c => ({ ...c, id: crypto.randomUUID() }));
            // Shuffle
            for (let i = state.deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
            }
        }
        state.phase = 'playing';
    }
}

async function saveGameState(gameId, state, eventType = 'update', eventPayload = {}) {
    // Limit chat size
    if (state.chat.length > 100) state.chat = state.chat.slice(-100);

    // Increment Version
    state.version = (state.version || 0) + 1;

    const stateStr = JSON.stringify(state);
    await prisma.game.update({
        where: { id: gameId },
        data: { stateJson: stateStr }
    });
    // Skip detailed event logging for performance in recovery if needed, but keeping it is fine.
    // For now, minimal logging.
}

// --- Socket Handlers ---
io.on('connection', (socket) => {
    // Helper for Ack
    const sendAck = (cb, ok, dataOrError) => {
        if (typeof cb === 'function') {
            if (ok) cb({ ok: true, data: dataOrError });
            else cb({ ok: false, error: dataOrError || 'Unknown error' });
        }
    };


    const broadcastState = async (roomCode, state) => {
        const sockets = await io.in(roomCode).fetchSockets();
        for (const socket of sockets) {
            const uid = socket.data.userId;
            // Create masked state
            const maskedState = {
                ...state,
                players: state.players.map(p => {
                    if (p.id === uid) return p; // Show my hand
                    return {
                        ...p,
                        hand: p.hand.map(() => ({ id: 'hidden', name: 'Back', type: 'unknown' })) // Mask others
                        // Or just send empty array? But client needs count. keeping dummy objects is safer for length.
                    };
                })
            };
            socket.emit('state_update', maskedState);
        }
    };

    // --- Old Maid Logic Helpers ---
    const getRank = (name) => {
        if (name === 'Joker') return 'Joker';
        // Format "Suit-Rank" e.g. "S-A", "H-10"
        const parts = name.split('-');
        return parts.length > 1 ? parts[1] : name;
    };

    const removePairs = (hand, discardPile) => {
        const rankMap = {};
        // Group by rank
        hand.forEach(card => {
            const rank = getRank(card.name);
            if (!rankMap[rank]) rankMap[rank] = [];
            rankMap[rank].push(card);
        });

        const newHand = [];
        const discarded = [];

        Object.keys(rankMap).forEach(rank => {
            const cards = rankMap[rank];
            if (rank === 'Joker') {
                newHand.push(...cards);
            } else {
                // If odd, keep 1
                if (cards.length % 2 === 1) {
                    newHand.push(cards[0]);
                    // Discard the rest (pairs)
                    for (let i = 1; i < cards.length; i++) discarded.push(cards[i]);
                } else {
                    // Even, discard all
                    discarded.push(...cards);
                }
            }
        });

        // Add to discard pile
        if (discardPile && discarded.length > 0) {
            // Add as pairs
            discardPile.push(...discarded);
        }

        return newHand;
    };

    // Connection Logging
    socket.onAny((event, ...args) => {
        console.log(`[socket] ${event} from ${socket.id}`, args);
    });

    // 1. Create Room
    socket.on('create_room', async ({ nickname, userId }, callback) => {
        console.log(`[create_room] Request from ${nickname} (${userId})`);
        try {
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();

            // Generate IDs explicitly
            const roomId = crypto.randomUUID();

            const room = await prisma.room.create({
                data: { id: roomId, code, hostUserId: userId }
            });
            console.log(`[create_room] DB Room created: ${code}`);

            const initialState = createInitialState(userId, nickname);
            const game = await prisma.game.create({
                data: { roomId: room.id, stateJson: JSON.stringify(initialState) }
            });
            console.log(`[create_room] DB Game initialized for: ${code}`);

            // Important: Set socket data
            socket.data.userId = userId;
            socket.join(room.code);

            console.log(`[create_room] Success: ${code}`);
            sendAck(callback, true, { roomId: room.code, gameId: game.id });
        } catch (e) {
            console.error(`[create_room] Failed:`, e);
            sendAck(callback, false, `Creation failed: ${e.message}`);
        }
    });

    // 2. Join Room
    socket.on('join_room', async ({ roomId, nickname, userId }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room) return sendAck(callback, false, 'Room not found');

            let game = await getActiveGame(room.id);
            if (!game) return sendAck(callback, false, 'Game not found');

            let state = JSON.parse(game.stateJson);

            // Migration / Reset
            if (!state.chat) state.chat = [];
            if (!state.oldMaid) state.oldMaid = { status: 'idle', discardPile: [] }; // Init OldMaid

            // Player logic
            let player = state.players.find(p => p.id === userId);
            if (player) {
                player.status = 'online';
                player.name = nickname;
            } else {
                const isSpectator = state.phase !== 'setup';
                state.players.push({
                    id: userId, name: nickname, hand: [], role: null, isHost: false, status: 'online', isSpectator
                });
                state.chat.push({
                    sender: 'System',
                    message: `${nickname} が参加しました${isSpectator ? ' (観戦)' : ''}`,
                    timestamp: Date.now()
                });
            }

            // Save & Emit
            await saveGameState(game.id, state, 'join', { userId });
            socket.data.userId = userId; // Store ID
            socket.join(room.code);

            sendAck(callback, true, state);
            await broadcastState(room.code, state);

        } catch (e) {
            console.error(e);
            sendAck(callback, false, e.message);
        }
    });

    // 3. Game Actions
    socket.on('game_action', async ({ roomId, type, payload, userId }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room) return;
            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);
            const player = state.players.find(p => p.id === userId);
            if (!player) return;

            // Security: Reject actions from spectators (except chat)
            if (player.isSpectator && type !== 'chat') {
                console.log(`[Security] Blocked action ${type} from spectator ${player.name} (${userId})`);
                return sendAck(callback, false, '観戦者は操作できません');
            }

            let updated = false;

            if (type === 'chat') {
                state.chat.push({
                    sender: player.name, message: payload.message, timestamp: Date.now()
                });
                updated = true;
            }
            else if (type === 'draw_card') {
                // Collision Check
                if (payload.version !== undefined && state.version !== undefined && payload.version !== state.version) {
                    return sendAck(callback, false, 'Simultaneous action detected (Version Mismatch). Please try again.');
                }

                if (state.deck.length > 0) {
                    const card = state.deck.shift();
                    player.hand.push(card);
                    state.chat.push({
                        sender: 'System', message: `${player.name} がカードを引きました`, timestamp: Date.now()
                    });
                    updated = true;
                }
            }
            else if (type === 'play_card') {
                // Collision Check (Optimistic Locking)
                if (payload.version !== undefined && state.version !== undefined && payload.version !== state.version) {
                    return sendAck(callback, false, 'Simultaneous action detected (Version Mismatch). Please try again.');
                }

                if (player.hand[payload.index]) {
                    const card = player.hand.splice(payload.index, 1)[0];
                    state.table.push({
                        id: Date.now().toString(),
                        card,
                        ownerId: player.id,
                        ownerName: player.name,
                        x: Math.random() * 200 - 100,
                        y: Math.random() * 200 - 100
                    });
                    state.chat.push({
                        sender: 'System', message: `${player.name} が ${card.name || 'カード'} を出しました`, timestamp: Date.now()
                    });
                    updated = true;
                }
            }
            else if (type === 'roll_dice') {
                const sides = payload.sides || 6;
                const roll = Math.floor(Math.random() * sides) + 1;
                state.chat.push({
                    sender: 'System', message: `${player.name} が d${sides} を振りました: [${roll}]`, timestamp: Date.now()
                });
                updated = true;
            }

            if (updated) {
                await saveGameState(game.id, state);
                await broadcastState(room.code, state);
            }
            sendAck(callback, true);

        } catch (e) {
            sendAck(callback, false, e.message);
        }
    });

    // 4. Host Actions
    socket.on('host_action', async ({ roomId, type, payload, userId }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);
            let updated = false;

            if (type === 'reset_game') {
                state.phase = 'setup';
                state.table = [];
                state.players.forEach(p => p.hand = []);
                state.oldMaid = { status: 'idle', discardPile: [] };
                state.chat.push({ sender: 'System', message: 'ゲームがリセットされました', timestamp: Date.now() });
                updated = true;
            }
            else if (type === 'shuffle_deck') {
                // ... same ...
                for (let i = state.deck.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
                }
                state.chat.push({ sender: 'System', message: '山札がシャッフルされました', timestamp: Date.now() });
                updated = true;
            }
            else if (type === 'apply_deck_drawpile') {
                if (payload.deck && Array.isArray(payload.deck)) {
                    state.deck = payload.deck;
                    // Auto shuffle
                    for (let i = state.deck.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [state.deck[i], state.deck[j]] = [state.deck[j], state.deck[i]];
                    }
                    state.chat.push({
                        sender: 'System',
                        message: `山札が更新されました (${state.deck.length} 枚)`,
                        timestamp: Date.now()
                    });
                    updated = true;
                }
            }
            else if (type === 'toggle_spectator') {
                if (state.phase !== 'setup') return sendAck(callback, false, '準備中(Setup Phase)のみ変更可能です');

                const targetId = payload.targetUserId;
                const targetPlayer = state.players.find(p => p.id === targetId);
                console.log(`[HostAction] Toggle Spectator: ${targetId} found=${!!targetPlayer} current=${targetPlayer?.isSpectator}`);
                if (targetPlayer) {
                    targetPlayer.isSpectator = !targetPlayer.isSpectator;
                    // If becoming spectator, maybe clear hand? Optional. For now just flag.
                    state.chat.push({
                        sender: 'System',
                        message: `${targetPlayer.name} は ${targetPlayer.isSpectator ? '観戦者' : 'プレイヤー'} になりました`,
                        timestamp: Date.now()
                    });
                    updated = true;
                }
            }
            else if (type === 'start_game') {
                const mode = state.selectedMode || 'tabletop';

                if (mode === 'oldmaid') {
                    // === Old Maid Start Logic (Deal & Auto-Start) ===
                    let deck = [];
                    // Use existing deck if present (from template), else gen default
                    if (state.deck && state.deck.length > 0) {
                        deck = [...state.deck];
                    } else {
                        const suits = ['S', 'H', 'D', 'C'];
                        const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
                        suits.forEach(s => ranks.forEach(r => deck.push({ id: crypto.randomUUID(), name: `${s}-${r}` })));
                        deck.push({ id: crypto.randomUUID(), name: 'Joker' });
                    }

                    // Shuffle
                    for (let i = deck.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [deck[i], deck[j]] = [deck[j], deck[i]];
                    }

                    // Deal (Skip Spectators)
                    const activePlayers = state.players.filter(p => !p.isSpectator && p.status === 'online');
                    if (activePlayers.length < 2) return sendAck(callback, false, 'プレイヤー(観戦以外)が2人以上必要です');

                    // Reset Hands
                    state.players.forEach(p => p.hand = []);

                    let pIdx = 0;
                    while (deck.length > 0) {
                        activePlayers[pIdx].hand.push(deck.pop());
                        pIdx = (pIdx + 1) % activePlayers.length;
                    }

                    // Remove Pairs & Init State
                    state.oldMaid = {
                        status: 'playing',
                        turnIndex: 0,
                        order: activePlayers.map(p => p.id),
                        discardPile: [],
                        winners: []
                    };

                    activePlayers.forEach(p => {
                        p.hand = removePairs(p.hand, state.oldMaid.discardPile);
                        if (p.hand.length === 0) {
                            p.isOut = true;
                            state.oldMaid.winners.push(p.id);
                        }
                    });

                    // Turn Logic Adjust
                    while (state.players.find(p => p.id === state.oldMaid.order[state.oldMaid.turnIndex])?.isOut && state.oldMaid.winners.length < activePlayers.length - 1) {
                        state.oldMaid.turnIndex = (state.oldMaid.turnIndex + 1) % activePlayers.length;
                    }

                    // Initial Target
                    let checkIdx = 1;
                    while (checkIdx < activePlayers.length) {
                        const nextIdx = (state.oldMaid.turnIndex + checkIdx) % activePlayers.length;
                        const nextId = state.oldMaid.order[nextIdx];
                        const nextPlayer = state.players.find(p => p.id === nextId);
                        if (!nextPlayer.isOut) {
                            state.oldMaid.targetId = nextId;
                            break;
                        }
                        checkIdx++;
                    }

                    state.phase = 'oldmaid';
                    state.chat.push({ sender: 'System', message: 'ババ抜きが開始されました！', timestamp: Date.now() });
                } else if (mode === 'memory') {
                    // === Memory (Concentration) Start Logic ===
                    // 1. Players
                    const activePlayers = state.players.filter(p => !p.isSpectator && p.status === 'online');
                    if (activePlayers.length < 2) return sendAck(callback, false, 'プレイヤー(観戦以外)が2人以上必要です');

                    // 2. Generate 16 Cards (8 pairs of A-8)
                    const suits = ['S', 'H']; // Black/Red distinction roughly
                    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8'];
                    const cards = [];
                    let idCount = 0;
                    suits.forEach(s => ranks.forEach(r => {
                        cards.push({ id: `m-${idCount++}`, suit: s, rank: r, faceUp: false, matched: false });
                    }));

                    // 3. Shuffle
                    for (let i = cards.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [cards[i], cards[j]] = [cards[j], cards[i]];
                    }

                    // 4. Init State
                    state.memory = {
                        status: 'playing',
                        board: cards,
                        turnSeat: activePlayers.map(p => p.id),
                        turnIndex: 0,
                        flips: [],
                        scores: activePlayers.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {}),
                        lockUntil: 0
                    };

                    state.phase = 'playing'; // Re-use playing phase, client switches view based on mode
                    state.chat.push({ sender: 'System', message: '神経衰弱が開始されました！', timestamp: Date.now() });

                } else if (mode === 'mixjuice') {
                    // === Mix Juice Start Logic ===
                    // 1. Players
                    const activePlayers = state.players.filter(p => !p.isSpectator && p.status === 'online');
                    if (activePlayers.length < 2) return sendAck(callback, false, 'プレイヤー(観戦以外)が2人以上必要です');

                    // 2. Prepare Deck (Using active template if available, else generate 36 fruits)
                    let deck = [];
                    if (state.activeTemplate && state.activeTemplate.piles) {
                        const drawPile = state.activeTemplate.piles.find(p => p.pileId === 'draw' || p.title === '山札');
                        if (drawPile) {
                            deck = JSON.parse(JSON.stringify(drawPile.cards)).map(c => ({ ...c, id: crypto.randomUUID() }));
                        }
                    }
                    if (deck.length === 0) {
                        // Fallback Generation (Server-side safety)
                        const colors = ['赤', '黄', '緑', '橙', '紫', '白'];
                        colors.forEach(c => {
                            for (let v = 0; v <= 5; v++) deck.push({ id: crypto.randomUUID(), name: `${c}${v}`, meta: { type: 'fruit', value: v } });
                        });
                    }

                    // 3. Shuffle
                    for (let i = deck.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [deck[i], deck[j]] = [deck[j], deck[i]];
                    }

                    // 4. Init State
                    state.mixjuice = {
                        status: 'playing',
                        round: 1,
                        roundMax: 5,
                        turnSeat: activePlayers.map(p => p.id),
                        turnIndex: 0,
                        turnCount: 0,
                        scores: activePlayers.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {}),
                        deck: deck,
                        discard: []
                    };
                    state.players.forEach(p => p.hand = []);

                    // 5. Deal 2 cards
                    activePlayers.forEach(p => {
                        if (state.mixjuice.deck.length >= 2) {
                            p.hand.push(state.mixjuice.deck.pop());
                            p.hand.push(state.mixjuice.deck.pop());
                        }
                    });

                    state.phase = 'mixjuice';
                    state.chat.push({ sender: 'System', message: 'ミックスジュース (ラウンド 1/5) 開始！', timestamp: Date.now() });

                } else {
                    // === Generic / Tabletop / FreeTalk Check ===

                    // Check for FreeTalk Piles (via deckJson usually, but here checking activeTemplate.piles)
                    // If activeTemplate has { piles: ... }, use it.
                    const piles = state.activeTemplate?.piles || (state.activeTemplate?.deckJson ? JSON.parse(state.activeTemplate.deckJson).piles : null);
                    const hasFreeTalkPiles = piles?.some(p => p.pileId === 'scene' || p.title.includes('シーン'));

                    if (state.selectedMode === 'free_talk' || hasFreeTalkPiles) {
                        // === FreeTalk Init ===
                        let sceneDeck = [];
                        let lawDeck = [];
                        const winMedals = 3;

                        if (piles) {
                            const sPile = piles.find(p => p.pileId === 'scene' || p.title.includes('シーン'));
                            const lPile = piles.find(p => p.pileId === 'law' || p.title.includes('条例'));

                            if (sPile) sceneDeck = JSON.parse(JSON.stringify(sPile.cards)).map(c => ({ ...c, id: crypto.randomUUID() }));
                            if (lPile) lawDeck = JSON.parse(JSON.stringify(lPile.cards)).map(c => ({ ...c, id: crypto.randomUUID() }));
                        }

                        // Shuffle
                        [sceneDeck, lawDeck].forEach(d => {
                            for (let i = d.length - 1; i > 0; i--) {
                                const j = Math.floor(Math.random() * (i + 1));
                                [d[i], d[j]] = [d[j], d[i]];
                            }
                        });

                        // --- Common Role Definitions (A-H) ---
                        const COMMON_ROLE_DEFINITIONS = {
                            'A': { name: '将軍', description: '最高司令。最終決定権を持つ。' },
                            'B': { name: '参謀長', description: '作戦立案。論理的な提案を行う。' },
                            'C': { name: '情報将校', description: '諜報・監視。他者の嘘を見抜く。' },
                            'D': { name: '検閲官', description: '思想統制。不適切な発言を正す。' },
                            'E': { name: '兵站将校', description: '物資・補給。現実的なリソース管理。' },
                            'F': { name: '宣伝将校', description: 'プロパガンダ。士気を高める発言。' },
                            'G': { name: '外交官', description: '対外交渉。外部との関係を考慮。' },
                            'H': { name: '民間代表', description: '現場の声。市民の感情を代弁。' }
                        };

                        state.freeTalk = {
                            status: 'playing',
                            sceneDeck,
                            lawDeck,
                            currentScene: null,
                            currentLaw: null,
                            medals: state.players.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {}),
                            config: { winMedals: 3, roundSeconds: 300 },
                            timer: { roundSeconds: 300, endsAt: null, isRunning: false }
                        };

                        // Inject definitions into all scenes
                        state.freeTalk.sceneDeck.forEach(scene => {
                            scene.roleDefinitions = COMMON_ROLE_DEFINITIONS;
                        });

                        state.phase = 'free_talk';

                        // Role Distribution (A..N)
                        const activePlayers = state.players.filter(p => !p.isSpectator && p.status === 'online');
                        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').slice(0, activePlayers.length);
                        // Shuffle letters
                        for (let i = letters.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [letters[i], letters[j]] = [letters[j], letters[i]];
                        }
                        // Assign
                        activePlayers.forEach((p, idx) => {
                            p.role = letters[idx];
                        });

                    } else {
                        // Standard Tabletop
                        state.phase = 'playing';
                        state.chat.push({ sender: 'System', message: 'ゲームを開始しました', timestamp: Date.now() });
                    }
                }
                updated = true;
            }

            if (updated) {
                await saveGameState(game.id, state);
                await broadcastState(room.code, state);
            }
            sendAck(callback, true);

        } catch (e) {
            sendAck(callback, false, e.message);
        }
    });

    // 5. Player Actions (Self-managed)
    socket.on('self_set_spectator', async ({ roomId, userId, isSpectator }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room) return sendAck(callback, false, 'Room not found');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            if (state.phase !== 'setup') return sendAck(callback, false, '準備中のみ変更可能です');

            const player = state.players.find(p => p.id === userId);
            if (!player) return sendAck(callback, false, 'Player not found');

            if (player.isSpectator !== isSpectator) {
                player.isSpectator = isSpectator;
                state.chat.push({
                    sender: 'System',
                    message: `${player.name} が${isSpectator ? '観戦者' : '参加者'}に変更しました (自己申告)`,
                    timestamp: Date.now()
                });
                await saveGameState(game.id, state);
                await broadcastState(room.code, state);
            }
            sendAck(callback, true);

        } catch (e) {
            console.error(e);
            sendAck(callback, false, e.message);
        }
    });

    // 5.5 Mix Juice Actions
    socket.on('mixjuice_action', async ({ roomId, userId, type, targetIndex }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room) return sendAck(callback, false, 'Room not found');
            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            if (state.phase !== 'mixjuice') return sendAck(callback, false, 'Not playing Mix Juice');

            const mj = state.mixjuice;
            const activePlayers = state.players.filter(p => !p.isSpectator && p.status === 'online');
            const turnPlayerId = mj.turnSeat[mj.turnIndex];

            if (userId !== turnPlayerId) return sendAck(callback, false, '手番ではありません');

            const player = state.players.find(p => p.id === userId);

            // --- Action Logic ---
            if (type === 'pass') {
                state.chat.push({ sender: 'System', message: `${player.name}: パス`, timestamp: Date.now() });
            }
            else if (type === 'change') {
                if (typeof targetIndex !== 'number' || !player.hand[targetIndex]) return sendAck(callback, false, 'Invalid Card');
                if (mj.deck.length === 0) return sendAck(callback, false, '山札がありません');

                const discarded = player.hand.splice(targetIndex, 1)[0];
                mj.discard.push(discarded);
                player.hand.push(mj.deck.pop());
                state.chat.push({ sender: 'System', message: `${player.name}: チェンジ`, timestamp: Date.now() });
            }
            else if (type === 'shuffle_hand') { // Fridge
                if (mj.deck.length < 2) return sendAck(callback, false, '山札不足です');
                // Discard all (should be 2)
                while (player.hand.length > 0) mj.discard.push(player.hand.pop());
                // Draw 2
                player.hand.push(mj.deck.pop());
                player.hand.push(mj.deck.pop());
                state.chat.push({ sender: 'System', message: `${player.name}: 冷蔵庫シャッフル`, timestamp: Date.now() });
            }

            // --- Turn Advance ---
            mj.turnCount++;
            mj.turnIndex = (mj.turnIndex + 1) % mj.turnSeat.length;

            // --- Round End Check ---
            // Round ends when everyone has acted 3 times.
            // turnCount starts at 0.
            // activePlayers.length * 3 turns per round.
            // Example: 2 players -> 6 turns.
            const turnsPerRound = mj.turnSeat.length * 3;
            if (mj.turnCount >= turnsPerRound) {
                // Round End Scoring
                state.chat.push({ sender: 'System', message: `--- ラウンド ${mj.round} 終了 ---`, timestamp: Date.now() });

                // Calculate Scores
                // 1. Calc Sums
                const roundResults = [];
                activePlayers.forEach(p => {
                    const hasZero = p.hand.some(c => (c.meta?.value === 0 || c.text?.includes('Value: 0') || c.name.includes('0')));
                    let sum = 0;
                    if (!hasZero) {
                        p.hand.forEach(c => {
                            // Try meta value, fallback to parsing text/name
                            let val = c.meta?.value;
                            if (val === undefined) {
                                // Minimal parsing for fallback (e.g. "Red 5")
                                const m = c.name.match(/\d+/);
                                if (m) val = parseInt(m[0]);
                                else val = 0;
                            }
                            sum += val;
                        });
                    } else {
                        sum = 0; // 0 card rule
                    }
                    roundResults.push({ id: p.id, name: p.name, sum, hasZero });
                });

                // 2. Rank & Award
                // Filter those with sum >= 7 (Candidates)
                const candidates = roundResults.filter(r => !r.hasZero && r.sum >= 7).sort((a, b) => b.sum - a.sum);

                if (candidates.length > 0) {
                    // Distribute Points
                    // Logic: 1st (+2), 2nd (+1). Ties share rank.
                    let currentRank = 1;
                    let lastSum = -1;

                    // Actually simpler grouping:
                    const groups = {}; // sum -> [ids]
                    candidates.forEach(c => {
                        if (!groups[c.sum]) groups[c.sum] = [];
                        groups[c.sum].push(c);
                    });
                    const sortedSums = Object.keys(groups).map(Number).sort((a, b) => b - a);

                    // 1st Place Group
                    if (sortedSums[0]) {
                        groups[sortedSums[0]].forEach(c => mj.scores[c.id] = (mj.scores[c.id] || 0) + 2);
                        state.chat.push({ sender: 'System', message: `1位 (+2pt): ${groups[sortedSums[0]].map(c => `${c.name}(${c.sum})`).join(', ')}`, timestamp: Date.now() });
                    }
                    // 2nd Place Group
                    if (sortedSums[1]) {
                        groups[sortedSums[1]].forEach(c => mj.scores[c.id] = (mj.scores[c.id] || 0) + 1);
                        state.chat.push({ sender: 'System', message: `2位 (+1pt): ${groups[sortedSums[1]].map(c => `${c.name}(${c.sum})`).join(', ')}`, timestamp: Date.now() });
                    }

                    // Save Result for Frontend Modal
                    // Convert roundResults to a map or array easier for client
                    mj.lastRoundResult = {
                        round: mj.round,
                        rankings: candidates.map((c, i) => ({
                            ...c,
                            rank: (i === 0 || candidates[i - 1].sum > c.sum) ? i + 1 : i, // Simple rank (1, 2, 3...)
                            scoreDelta: (groups[c.sum] === groups[sortedSums[0]]) ? 2 : (groups[c.sum] === groups[sortedSums[1]] ? 1 : 0)
                        }))
                    };

                } else {
                    state.chat.push({ sender: 'System', message: `勝者なし (全員7未満 or 0ドボン)`, timestamp: Date.now() });
                    mj.lastRoundResult = { round: mj.round, rankings: [] };
                }

                // 3. Next Round Setup
                mj.round++;
                if (mj.round > mj.roundMax) {
                    // Game Over
                    state.phase = 'finished';
                    // Calculation Final Winner (optional log)
                    state.chat.push({ sender: 'System', message: `ゲーム終了！全5ラウンド完了。`, timestamp: Date.now() });
                } else {
                    // Reset Turn
                    mj.turnCount = 0;
                    mj.turnIndex = 0; // Reset to first player or rotate start player? User simplistic: "turn 0".
                    // Rotate dealer/start player
                    const firstSeat = mj.turnSeat.shift();
                    mj.turnSeat.push(firstSeat);

                    // Deal new hands (Discard old hands first)
                    activePlayers.forEach(p => {
                        while (p.hand.length > 0) mj.discard.push(p.hand.pop());
                    });

                    // Shuffle Discard into Deck if needed 
                    // Simple logic: if deck < players*2 (rounded), reshuffle.
                    if (mj.deck.length < activePlayers.length * 2) {
                        mj.deck = [...mj.deck, ...mj.discard];
                        mj.discard = [];
                        // Shuffle
                        for (let i = mj.deck.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [mj.deck[i], mj.deck[j]] = [mj.deck[j], mj.deck[i]];
                        }
                    }

                    // Deal
                    activePlayers.forEach(p => {
                        p.hand.push(mj.deck.pop());
                        p.hand.push(mj.deck.pop());
                    });

                    state.chat.push({ sender: 'System', message: `ラウンド ${mj.round} 開始`, timestamp: Date.now() });
                }
            }

            // Save & Broadcast
            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);

        } catch (e) {
            console.error(e);
            sendAck(callback, false, e.message);
        }
    });

    // 6. Old Maid Actions
    socket.on('oldmaid_start_game', async ({ roomId, userId, useCurrentDeck, confirm }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // Ensure OldMaid State exists
            if (!state.oldMaid) state.oldMaid = { status: 'idle', discardPile: [], winners: [] };

            // === Setup Phase ===
            if (!confirm) {
                state.phase = 'oldmaid';
                state.oldMaid.status = 'setup';
                state.oldMaid.discardPile = [];
                state.oldMaid.winners = [];
                state.table = []; // Clear table
                state.players.forEach(p => { p.hand = []; p.isOut = false; }); // Reset Players

                state.chat.push({ sender: 'System', message: 'ババ抜きの準備画面へ移動しました', timestamp: Date.now() });

                await saveGameState(game.id, state);
                await broadcastState(room.code, state);
                return sendAck(callback, true);
            }

            // === Start Phase (Deal) ===
            let deck = [];
            if (useCurrentDeck && state.deck && state.deck.length > 0) {
                deck = [...state.deck];
            } else {
                const suits = ['S', 'H', 'D', 'C'];
                const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
                suits.forEach(s => ranks.forEach(r => deck.push({ id: crypto.randomUUID(), name: `${s}-${r}` })));
                deck.push({ id: crypto.randomUUID(), name: 'Joker' });
            }

            // Shuffle
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [deck[i], deck[j]] = [deck[j], deck[i]];
            }

            // Deal (Skip Spectators)
            const activePlayers = state.players.filter(p => !p.isSpectator && p.status === 'online'); // Strict check
            if (activePlayers.length < 2) return sendAck(callback, false, 'プレイヤー(観戦以外)が2人以上必要です');

            // Reset Hands for everyone first
            state.players.forEach(p => p.hand = []);

            let pIdx = 0;
            while (deck.length > 0) {
                activePlayers[pIdx].hand.push(deck.pop());
                pIdx = (pIdx + 1) % activePlayers.length;
            }

            // Remove Pairs & Init State
            state.oldMaid = {
                status: 'playing',
                turnIndex: 0,
                order: activePlayers.map(p => p.id), // Only active players in order
                discardPile: [],
                winners: []
            };

            activePlayers.forEach(p => {
                p.hand = removePairs(p.hand, state.oldMaid.discardPile);
                if (p.hand.length === 0) {
                    p.isOut = true;
                    state.oldMaid.winners.push(p.id);
                }
            });

            // Turn Logic Adjust
            while (state.players.find(p => p.id === state.oldMaid.order[state.oldMaid.turnIndex])?.isOut && state.oldMaid.winners.length < activePlayers.length - 1) {
                state.oldMaid.turnIndex = (state.oldMaid.turnIndex + 1) % activePlayers.length;
            }

            // Initial Target
            let checkIdx = 1;
            while (checkIdx < activePlayers.length) {
                const nextIdx = (state.oldMaid.turnIndex + checkIdx) % activePlayers.length;
                const nextId = state.oldMaid.order[nextIdx];
                const nextPlayer = state.players.find(p => p.id === nextId);
                if (!nextPlayer.isOut) {
                    state.oldMaid.targetId = nextId;
                    break;
                }
                checkIdx++;
            }

            state.chat.push({ sender: 'System', message: 'ババ抜きが開始されました！', timestamp: Date.now() });

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);

        } catch (e) {
            console.error(e);
            sendAck(callback, false, e.message);
        }
    });

    // Helper: Find next active player (target)
    const getNextActivePlayer = (players, currentIndex) => {
        let i = 1;
        while (i < players.length) {
            const nextIdx = (currentIndex + i) % players.length;
            if (!players[nextIdx].isOut) return { index: nextIdx, id: players[nextIdx].id };
            i++;
        }
        return null;
    };

    // --- Phase 1.8 Post-Game Editor Events ---

    // 0. Request Deck Data (Source of Truth)
    socket.on('request_deck_data', async ({ roomId, userId, overrideMode }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room) return sendAck(callback, false, 'Room not found');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // Priority: Draft -> Active -> Default
            let template = null;
            let source = 'default';
            let parseSource = '';
            const targetMode = overrideMode || state.activeTemplate?.mode || state.selectedMode || 'turn_based';

            // 1. Check Draft (Must be valid AND match targetMode if overridden)
            if (state.draftTemplate && state.draftTemplate.piles && state.draftTemplate.piles.length > 0) {
                const totalCards = state.draftTemplate.piles.reduce((sum, p) => sum + (p.cards?.length || 0), 0);
                const modeMatch = !overrideMode || state.draftTemplate.mode === overrideMode;
                if (totalCards > 0 && modeMatch) { template = state.draftTemplate; source = 'draft'; }
            }

            // 2. Check Active
            if (!template && state.activeTemplate) {
                // Ensure piles exist (Parse deckJson if needed)
                if (!state.activeTemplate.piles && state.activeTemplate.deckJson) {
                    try {
                        const parsed = JSON.parse(state.activeTemplate.deckJson);
                        state.activeTemplate.piles = parsed.piles || (Array.isArray(parsed) ? [{ pileId: 'draw', title: '山札', cards: parsed }] : []);
                        parseSource = 'parsed(deckJson)';
                    } catch (e) {
                        console.error("[DeckEditor] ERROR parse failed", e);
                        // No strict fallback here, just fail to load active.
                    }
                }

                if (state.activeTemplate.piles && state.activeTemplate.piles.length > 0) {
                    const modeMatch = !overrideMode || state.activeTemplate.mode === overrideMode;
                    if (modeMatch) {
                        template = state.activeTemplate;
                        source = parseSource || 'active';
                    }
                }
            }

            // 2.5 Safety Check: Empty Return Prohibition
            let cardCount = 0;
            if (template && template.piles) {
                cardCount = template.piles.reduce((sum, p) => sum + (p.cards?.length || 0), 0);
            }

            if (cardCount === 0) {
                if (template) console.warn(`[Deck] Discarding empty template from ${source} (Count: 0)`);
                template = null; // Force fallback
            }

            // 3. Generate Default Fallback
            if (!template) {
                template = generateDefaultTemplate(targetMode);
                source = 'initial'; // Renamed from default to initial as requested
                // Recalculate count for log
                cardCount = template.piles.reduce((sum, p) => sum + (p.cards?.length || 0), 0);
            }

            // [MixJuice Special] Ensure "special" pile exists in Editor view if MixJuice
            if ((template.mode === 'mixjuice' || source === 'initial') && !template.piles.find(p => p.pileId === 'special')) {
                if (template.mode === 'mixjuice') {
                    template.piles.unshift({ pileId: 'special', title: 'スペシャル', cards: [] });
                }
            }

            console.log(`[Deck] RETURNING: ${source} (Count: ${cardCount})`);
            sendAck(callback, true, { template, source });

        } catch (e) {
            console.error("[Deck] Request Error:", e);
            sendAck(callback, false, e.message);
        }
    });

    // 1. Set Draft (Edit)
    socket.on('draft_template_set', async ({ roomId, userId, draftTemplate }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');

            // Safety Valve: Check if piles are empty or total cards 0
            if (!draftTemplate?.piles || draftTemplate.piles.length === 0) {
                console.warn("[Draft] Rejected: No piles provided");
                return sendAck(callback, false, '保存失敗: パイルが見つかりません');
            }
            // Check total cards
            const totalCards = draftTemplate.piles.reduce((sum, p) => sum + (p.cards?.length || 0), 0);
            if (totalCards === 0) {
                console.warn("[Draft] Rejected 0-card draft save");
                return sendAck(callback, false, '保存失敗: カードが0枚です');
            }

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // DATA NORMALIZATION
            // Ensure meta exists for all cards
            draftTemplate.piles.forEach(pile => {
                pile.cards.forEach(card => {
                    if (!card.meta) card.meta = {};
                    // Migrate roleDefinitions if present at top level
                    if (card.roleDefinitions && Object.keys(card.roleDefinitions).length > 0) {
                        card.meta.roleDefinitions = card.roleDefinitions;
                        delete card.roleDefinitions; // Cleanup
                    }
                });
            });

            state.draftTemplate = draftTemplate;
            if (draftTemplate.templateId) state.selectedTemplateId = draftTemplate.templateId;

            console.log(`[Deck] DraftSave: Piles=${draftTemplate.piles.length}, TotalCards=${totalCards}, Mode=${draftTemplate.mode}`);

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);
        } catch (e) {
            sendAck(callback, false, e.message);
        }
    });

    // 2. Apply Draft to Active
    socket.on('template_apply_to_active', async ({ roomId, userId, version }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, 'Host only');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // Version Guard
            if (version !== undefined && state.version !== undefined && version !== state.version) {
                return sendAck(callback, false, 'Version mismatch');
            }

            if (!state.draftTemplate) return sendAck(callback, false, 'No Draft found');

            // Promote Draft to Active
            state.activeTemplate = JSON.parse(JSON.stringify(state.draftTemplate)); // Deep copy

            // Regenerate State from Active
            initializeStateFromActiveTemplate(state);

            state.chat.push({ sender: 'System', message: 'デッキ設定を適用（ゲームリセット）しました', timestamp: Date.now() });
            console.log("[Deck] Apply: Draft -> Active promoted.");

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);

        } catch (e) {
            console.error(e);
            sendAck(callback, false, e.message);
        }
    });

    // 3. Rematch Active
    socket.on('rematch_with_active_template', async ({ roomId, userId, version }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, 'Host only');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            if (version !== undefined && state.version !== undefined && version !== state.version) {
                return sendAck(callback, false, 'Version mismatch');
            }

            // Unify Logic: Use helper
            initializeStateFromActiveTemplate(state);

            state.chat.push({ sender: 'System', message: 'リマッチ(再戦)を開始しました！', timestamp: Date.now() });
            console.log("[Deck] Rematch: State regenerated from Active Template.");

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);

        } catch (e) {
            sendAck(callback, false, e.message);
        }
    });

    socket.on('oldmaid_pick_from_left', async ({ roomId, userId, pickIndex, version }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // Version Guard
            if (version !== undefined && state.version !== undefined && version !== state.version) {
                return sendAck(callback, false, 'Action Collision (Version Mismatch).');
            }

            // Validation
            if (state.phase !== 'oldmaid' || state.oldMaid.status !== 'playing') return;

            const currentActorId = state.oldMaid.order[state.oldMaid.turnIndex];
            if (currentActorId !== userId) return sendAck(callback, false, 'あなたの番ではありません');

            // Confirm Target (The logic: Next Active Player)
            const targetInfo = getNextActivePlayer(state.players, state.oldMaid.turnIndex);
            if (!targetInfo) return sendAck(callback, false, '相手が見つかりません');

            // Allow client to rely on state.oldMaid.targetId if present, but strictly verify here.
            // If the user request implies `left neighbor = previous`, we must check the rule.
            // User Rule: "左隣 = order上の “次の生存者”（自分の次）" (Next survivor).
            // So getNextActivePlayer(turnIndex) IS the target.

            const currentPlayer = state.players.find(p => p.id === userId);
            const targetPlayer = state.players[targetInfo.index];

            // Validate Pick
            if (typeof pickIndex !== 'number' || pickIndex < 0 || pickIndex >= targetPlayer.hand.length) {
                return sendAck(callback, false, '無効なカード選択です');
            }

            // Draw specific card
            const drawnCard = targetPlayer.hand.splice(pickIndex, 1)[0];
            currentPlayer.hand.push(drawnCard);

            // Log
            state.chat.push({
                sender: 'System',
                message: `${currentPlayer.name} が ${targetPlayer.name} からカードを引きました (残り: ${targetPlayer.hand.length}枚)`,
                timestamp: Date.now()
            });

            // Remove Pairs for Current Player
            const oldLen = currentPlayer.hand.length;

            // Helper to identify the pair rank for logging
            // We need to know what was removed. removePairs doesn't return that detail easily without refactor.
            // Custom remove logic for logging:
            const rankMap = {};
            currentPlayer.hand.forEach(c => {
                const r = c.name === 'Joker' ? 'Joker' : c.name.split('-')[1];
                if (!rankMap[r]) rankMap[r] = 0;
                rankMap[r]++;
            });
            const discardRanks = [];
            // This logic allows predicting what removePairs will do, OR we can modify removePairs. 
            // Since removePairs is a pure helper, let's keep it simple and just compare hands or trust removePairs.
            // Let's modify the log AFTER removePairs by finding which rank disappeared.
            // Actually, simplest is just to log "a pair" for now, or minimal info.
            // User request: "A discarded a pair of 7". 
            // Let's inspect the `removePairs` implementation or just implement inline detection.
            // Inline detection logic:
            // The drawn card `drawnCard` likely caused the pair if one was made.
            // So check if currentPlayer had a matching rank.
            const drawnRank = drawnCard.name === 'Joker' ? 'Joker' : drawnCard.name.split('-')[1];
            const hasMatch = currentPlayer.hand.some(c => {
                const r = c.name === 'Joker' ? 'Joker' : c.name.split('-')[1];
                return c !== drawnCard && r === drawnRank && r !== 'Joker'; // Joker doesn't pair usually in basic Old Maid? Or does it? Usually Joker is alone.
                // Wait, standard Old Maid: Joker matches nothing.
            });

            // Now actually remove pairs
            currentPlayer.hand = removePairs(currentPlayer.hand, state.oldMaid.discardPile);

            if (currentPlayer.hand.length < oldLen) {
                // A pair was indeed removed. It was likely the drawn rank.
                state.chat.push({ sender: 'System', message: `${currentPlayer.name} が ${drawnRank} のペアを捨てました！`, timestamp: Date.now() });
            }

            // Check Outs
            const checkOut = (p) => {
                if (!p.isOut && p.hand.length === 0) {
                    p.isOut = true;
                    state.oldMaid.winners.push(p.id);
                    state.chat.push({ sender: 'System', message: `${p.name} あがり！`, timestamp: Date.now() });
                    return true;
                }
                return false;
            };

            checkOut(currentPlayer);
            checkOut(targetPlayer);

            // Check Game End
            const activeCount = state.players.filter(p => !p.isOut).length;
            if (activeCount <= 1) {
                state.oldMaid.status = 'finished';
                const loser = state.players.find(p => !p.isOut);
                state.chat.push({ sender: 'System', message: `ゲーム終了！敗者: ${loser ? loser.name : 'なし'}`, timestamp: Date.now() });
            } else {
                // Next Turn
                // Find next active player for the NEXT turn
                const nextTurnInfo = getNextActivePlayer(state.players, state.oldMaid.turnIndex);
                if (nextTurnInfo) {
                    state.oldMaid.turnIndex = nextTurnInfo.index;
                    // Pre-calculate NEW target for the NEW current player
                    const newTargetInfo = getNextActivePlayer(state.players, state.oldMaid.turnIndex);
                    state.oldMaid.targetId = newTargetInfo ? newTargetInfo.id : null;
                }
            }

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true, { drawnCard }); // Return drawn card for preview

        } catch (e) {
            console.error(e);
            sendAck(callback, false, e.message);
        }
    });

    // 5. AI MOCK (Recovery)
    socket.on('ai_chat_message', (payload, callback) => {
        // Mock response
        sendAck(callback, true, { reply: '（AIは現在停止中です）' });
    });

    socket.on('ai_generate_deck', (payload, callback) => {
        // Mock response
        sendAck(callback, true, { cards: [] });
    });

    // 6. Game Library Apply
    socket.on('apply_game_template', async ({ roomId, gameId, templateId }, callback) => {
        try {
            // Find Template
            const template = await prisma.gameTemplate.findUnique({ where: { id: templateId } });
            if (!template) return sendAck(callback, false, 'Template not found');

            // Get Current Game
            const currentRoom = await prisma.room.findUnique({ where: { code: roomId } });
            if (!currentRoom) return sendAck(callback, false, 'Room not found');

            const dbGame = await getActiveGame(currentRoom.id);
            if (!dbGame) return sendAck(callback, false, 'Active game not found');
            // But we need to update the SPECIFIC game instance currently loaded.
            // Let's rely on finding by Room ID for safety as we only have 1 active game effectively.

            let state = JSON.parse(dbGame.stateJson);

            // APPLY Changes
            state.activeTemplate = template; // IMPORTANT: Store active template so start_game can read piles
            state.selectedMode = template.mode; // Set the intended mode
            state.draftTemplate = null; // Clear stale draft
            state.selectedTemplateId = template.id;

            // Reset Rules
            let ruleCards = [];
            try { ruleCards = JSON.parse(template.ruleCardsJson || '[]'); } catch (e) { }
            state.rules = {
                text: template.rulesText || "",
                summary: "",
                cards: ruleCards
            };

            // Initialize State using Helper
            initializeStateFromActiveTemplate(state);
            state.phase = 'setup'; // Override to setup for Library application

            // Log
            state.chat.push({
                sender: 'System',
                message: `Applied game template: "${template.title}"`,
                timestamp: Date.now()
            });

            await saveGameState(dbGame.id, state, 'apply_template', { templateId });
            io.to(roomId).emit('state_update', state);
            sendAck(callback, true);

        } catch (e) {
            console.error(e);
            sendAck(callback, false, e.message);
        }
    });



    // 7. Memory Game Actions

    socket.on('memory_flip', async ({ roomId, userId, cardId }, callback) => {
        try {
            // Fetch Game
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room) return sendAck(callback, false, 'Room not found');
            const dbGame = await getActiveGame(room.id);
            if (!dbGame) return sendAck(callback, false, 'Game not found');

            let state = JSON.parse(dbGame.stateJson);
            const mem = state.memory;

            // Basic Checks
            if (state.selectedMode !== 'memory') return sendAck(callback, false, 'Not memory mode');
            if (mem.lockUntil > Date.now()) return sendAck(callback, false, '判定中待機...');

            // Turn Check
            const currentTurnPlayer = mem.turnSeat[mem.turnIndex];
            if (currentTurnPlayer !== userId) return sendAck(callback, false, 'あなたの番ではありません');

            // Find Card
            const card = mem.board.find(c => c.id === cardId);
            if (!card) return sendAck(callback, false, 'Card not found');
            if (card.faceUp || card.matched) return sendAck(callback, false, '既にめくられています');

            // Execute Flip
            card.faceUp = true;
            mem.flips.push(cardId);

            // Log
            const player = state.players.find(p => p.id === userId);
            state.chat.push({
                sender: 'System',
                message: `${player?.name || userId} がカードをめくりました`,
                timestamp: Date.now()
            });

            // Check Logic
            let mismatch = false;
            let matchFound = false;

            if (mem.flips.length === 2) {
                const c1 = mem.board.find(c => c.id === mem.flips[0]);
                const c2 = mem.board.find(c => c.id === mem.flips[1]);

                if (c1.rank === c2.rank) {
                    // Match!
                    c1.matched = true;
                    c2.matched = true;
                    mem.scores[userId] = (mem.scores[userId] || 0) + 1;
                    mem.flips = [];
                    matchFound = true;

                    state.chat.push({ sender: 'System', message: `ペア成立！ (Rank: ${c1.rank})`, timestamp: Date.now() });

                    // Win Check
                    if (mem.board.every(c => c.matched)) {
                        mem.status = 'finished';
                        state.chat.push({ sender: 'System', message: '全てのカードが揃いました！ゲーム終了！', timestamp: Date.now() });
                    }
                } else {
                    // Mismatch
                    mismatch = true;
                    mem.lockUntil = Date.now() + 1000;
                }
            }

            // Save & Emit Immediate State
            await saveGameState(dbGame.id, state, 'memory_flip', { userId, cardId });
            io.to(roomId).emit('state_update', state);
            sendAck(callback, true);

            // Handle Mismatch Async
            if (mismatch) {
                setTimeout(async () => {
                    // Reload state to avoid race conditions? 
                    // For MVP simplicity we assume simplified concurrency or we re-fetch.
                    // Re-fetching is safer.
                    const freshGame = await getActiveGame(room.id);
                    let freshState = JSON.parse(freshGame.stateJson);

                    // Reset flips
                    freshState.memory.board.forEach(c => {
                        if (c.id === mem.flips[0] || c.id === mem.flips[1]) {
                            c.faceUp = false;
                        }
                    });
                    freshState.memory.flips = [];
                    freshState.memory.turnIndex = (freshState.memory.turnIndex + 1) % freshState.memory.turnSeat.length;
                    freshState.memory.lockUntil = 0;

                    const nextPlayerId = freshState.memory.turnSeat[freshState.memory.turnIndex];
                    const nextPlayer = freshState.players.find(p => p.id === nextPlayerId);
                    freshState.chat.push({ sender: 'System', message: `次は ${nextPlayer?.name} の番です`, timestamp: Date.now() });

                    await saveGameState(freshGame.id, freshState, 'memory_mismatch_resolve');
                    io.to(roomId).emit('state_update', freshState);
                }, 1000);
            }

        } catch (e) {
            console.error(e);
            sendAck(callback, false, e.message);
        }
    });


    // --- Phase 2: FreeTalk Handlers (Spec) ---

    // 1. Reveal (Merged Scene/Law)
    // Event: free_talk_reveal_scene / free_talk_reveal_law
    const handleFreeTalkReveal = async (roomId, userId, type, version, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // Version Guard
            if (version !== undefined && state.version !== undefined && version !== state.version) {
                return sendAck(callback, false, 'Collision detected. Please retry.');
            }

            if (!state.freeTalk) return sendAck(callback, false, 'Not in free_talk mode');

            if (type === 'scene') {
                if (state.freeTalk.sceneDeck.length === 0) {
                    // Optional: Reshuffle? or just error. Spec doesn't say.
                    return sendAck(callback, false, 'シーンカードがありません');
                }
                const card = state.freeTalk.sceneDeck.pop();
                state.freeTalk.currentScene = card;
                state.chat.push({ sender: 'System', message: `📢 シーン提示: 『${card.name}』\n${card.text || ''}`, timestamp: Date.now() });
            } else if (type === 'law') {
                if (state.freeTalk.lawDeck.length === 0) return sendAck(callback, false, '条例カードがありません');
                const card = state.freeTalk.lawDeck.pop();
                state.freeTalk.currentLaw = card;
                state.chat.push({ sender: 'System', message: `📜 条例提示: 『${card.name}』\n${card.text || ''}`, timestamp: Date.now() });
            }

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);
        } catch (e) {
            sendAck(callback, false, e.message);
        }
    };

    socket.on('free_talk_reveal_scene', ({ roomId, userId, version }, cb) => handleFreeTalkReveal(roomId, userId, 'scene', version, cb));
    socket.on('free_talk_reveal_law', ({ roomId, userId, version }, cb) => handleFreeTalkReveal(roomId, userId, 'law', version, cb));

    // 2. Denounce
    socket.on('free_talk_denounce', async ({ roomId, userId, targetPlayerId, reason, version }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room) return;

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // Version Guard
            if (version !== undefined && state.version !== undefined && version !== state.version) {
                return sendAck(callback, false, 'Collision detected. Please retry.');
            }

            const player = state.players.find(p => p.id === userId);
            const target = state.players.find(p => p.id === targetPlayerId);

            if (!player || !target) return;
            if (player.isSpectator) return sendAck(callback, false, '観戦者は密告できません');

            state.chat.push({
                sender: 'System',
                message: `⚠️ ${player.name} が ${target.name} を密告しました\n理由: ${reason}`,
                timestamp: Date.now()
            });

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);
        } catch (e) {
            sendAck(callback, false, e.message);
        }
    });

    // 3. Award Medal
    socket.on('free_talk_award_medal', async ({ roomId, userId, playerId, delta, version }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // Version Guard
            if (version !== undefined && state.version !== undefined && version !== state.version) {
                return sendAck(callback, false, 'Collision detected. Please retry.');
            }

            if (!state.freeTalk) return;

            const target = state.players.find(p => p.id === playerId);
            if (!target) return;

            const current = state.freeTalk.medals[playerId] || 0;
            const newVal = Math.max(0, current + delta);
            state.freeTalk.medals[playerId] = newVal;

            state.chat.push({
                sender: 'System',
                message: `🏅 ${target.name} にメダル ${delta > 0 ? '+' : ''}${delta} (計${newVal})`,
                timestamp: Date.now()
            });

            // Win Check
            if (newVal >= (state.freeTalk.config?.winMedals || 3)) {
                state.chat.push({ sender: 'System', message: `🎉 勝者決定！ ${target.name} が勝利しました！`, timestamp: Date.now() });
                state.freeTalk.status = 'finished';
            }

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);
        } catch (e) {
            sendAck(callback, false, e.message);
        }
    });

    // 5. Timer Handlers
    socket.on('free_talk_timer_start', async ({ roomId, userId }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);
            if (!state.freeTalk) return;

            const sec = state.freeTalk.config?.roundSeconds || 300;
            state.freeTalk.timer = {
                roundSeconds: sec,
                endsAt: Date.now() + sec * 1000,
                isRunning: true
            };
            state.chat.push({ sender: 'System', message: `⏰ タイマーを開始しました (${sec}秒)`, timestamp: Date.now() });

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);
        } catch (e) { sendAck(callback, false, e.message); }
    });

    socket.on('free_talk_timer_extend', async ({ roomId, userId }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');
            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);
            if (!state.freeTalk || !state.freeTalk.timer?.endsAt) return;

            state.freeTalk.timer.endsAt += 30000; // +30s
            state.chat.push({ sender: 'System', message: `⏰ 時間を延長しました (+30秒)`, timestamp: Date.now() });

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);
        } catch (e) { sendAck(callback, false, e.message); }
    });

    socket.on('free_talk_set_config', async ({ roomId, userId, winMedals }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');
            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);
            if (!state.freeTalk) return;

            state.freeTalk.config = state.freeTalk.config || { winMedals: 3, roundSeconds: 300 };
            if (winMedals) state.freeTalk.config.winMedals = winMedals;

            state.chat.push({ sender: 'System', message: `🔧 ルール変更: 勝利条件を勲章${winMedals}個に設定`, timestamp: Date.now() });

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);
        } catch (e) { sendAck(callback, false, e.message); }
    });

    socket.on('free_talk_purge', async ({ roomId, userId, targetPlayerId }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            const target = state.players.find(p => p.id === targetPlayerId);
            if (!target) return sendAck(callback, false, '対象が見つかりません');

            target.isOut = true;
            state.chat.push({ sender: 'System', message: `🚫 ${target.name} が追放されました`, timestamp: Date.now() });

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            sendAck(callback, true);
        } catch (e) { sendAck(callback, false, e.message); }
    });

    // 7. Draft Template Handlers (Deck Editor)
    socket.on('draft_template_set', async ({ roomId, userId, draftTemplate }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // Safety: Reject empty piles if previous existed?
            if ((!draftTemplate.piles || draftTemplate.piles.length === 0)) {
                console.warn("Received empty draft template. Potentially dangerous overwrite.", JSON.stringify(draftTemplate));
            }

            state.draftTemplate = draftTemplate;
            await saveGameState(game.id, state);
            // await broadcastState(room.code, state); 
        } catch (e) { console.error(e); }
    });

    socket.on('template_apply_to_active', async ({ roomId, userId, version }, callback) => {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room || room.hostUserId !== userId) return sendAck(callback, false, '権限がありません');

            const game = await getActiveGame(room.id);
            let state = JSON.parse(game.stateJson);

            // Version Guard
            if (version !== undefined && state.version !== undefined && version !== state.version) {
                return sendAck(callback, false, 'Collision detected.');
            }

            // Apply draft to active
            if (!state.draftTemplate) return sendAck(callback, false, 'No draft to apply');

            // Validate draft: If empty but active has data, abort
            if ((!state.draftTemplate.piles || state.draftTemplate.piles.length === 0) && state.activeTemplate?.piles?.length > 0) {
                return sendAck(callback, false, 'Safety: Draft is empty. Aborting apply to prevent data loss.');
            }

            state.activeTemplate = JSON.parse(JSON.stringify(state.draftTemplate));
            state.activeTemplate.updatedAt = Date.now();

            await saveGameState(game.id, state, 'template_apply');
            await broadcastState(room.code, state);
            sendAck(callback, true);
        } catch (e) { sendAck(callback, false, e.message); }
    });

    socket.on('disconnect', () => { });
});

nextApp.prepare().then(() => {
    // Next.js Catch-All
    app.all('*', (req, res) => handle(req, res));

    server.listen(PORT, () => {
        console.log(`Recovery Server running on port ${PORT}`);
    });
});
