require('dotenv').config();

console.log('--- BoardGame Venue v8.0 (CPU1/2/3 naming) ---');
console.log('--- SERVER STARTUP ENV CHECK ---');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
    // Log masked URL for safety (show schema and start of path)
    console.log('DATABASE_URL value (masked):', process.env.DATABASE_URL.replace(/:[^:@]*@/, ':****@'));
} else {
    console.error('CRITICAL: DATABASE_URL is missing!');
}
console.log('--------------------------------');
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

const PORT = process.env.PORT || 3010;
const dev = process.env.NODE_ENV !== 'production';
const skipNext = process.env.SKIP_NEXT === 'true';
const nextApp = !skipNext ? next({ dev, dir: dev ? path.join(__dirname, '../client') : __dirname }) : null;
const handle = !skipNext ? nextApp.getRequestHandler() : (req, res) => res.status(404).send('Next.js Skipped');

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);

// CORS Configuration（開発時は全オリジン許可で LAN 内の他端末からアクセス可能に）
const clientUrls = process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : [];
const allowedOrigins = dev ? true : (clientUrls.length > 0 ? clientUrls : "*");

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

// 疎通確認用（Next 未起動でも応答）
app.get('/api/health', (req, res) => res.json({ ok: true, message: 'BoardGame Venue API' }));

// Next 準備完了まで「読み込み中」を返すキャッチオール用（登録は末尾で行う）
let nextHandle = null;
const loadingHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Board Game Venue</title></head><body><p>読み込み中...</p><p><a href="/api/health">/api/health</a></p><script>setTimeout(function(){location.reload();},2000);</script></body></html>';

// 本番: build.sh で client/public が server/public にコピーされるので、画像などをここで配信
const publicDir = path.join(__dirname, 'public');
const fs = require('fs');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
} 

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


// app.use(express.static('public')); // Serve Emergency Client

// --- HTTP AI Endpoints ---
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * AIディーラー用チャットエンドポイント（フェーズ1）
 * UI からの入力: { message, context } （既存仕様を維持）
 * 追加で roomId / userId が渡されていれば、盤面カンペ＆思い出機能を有効化する。
 */
app.post('/api/ai/chat', async (req, res) => {
    console.log('[AI CHAT] start', { body: req.body });

    const FALLBACK_PANIC = {
        speech: 'ひぇぇ！マニュアルを濡らしてしまって…ちょっと待ってくださいね！',
        // 既存UI(AIChatTab)互換用
        reply: 'ひぇぇ！マニュアルを濡らしてしまって…ちょっと待ってくださいね！',
        emotion: 'panic',
        actionCommand: { type: 'error', reason: 'AI backend fallback' }
    };

    try {
        if (!process.env.GEMINI_API_KEY) {
            console.warn('[AI CHAT] GEMINI_API_KEY is missing');
            console.log('[AI CHAT] end (no-key fallback)', { response: FALLBACK_PANIC });
            return res.status(503).json(FALLBACK_PANIC);
        }

        const { message, context, roomId, userId } = req.body || {};
        if (!message || typeof message !== 'string') {
            console.warn('[AI CHAT] invalid request, message is required');
            return res.status(400).json({ error: 'message is required' });
        }

        // --- 1. 盤面カンペ用の状態取得 ---
        let boardSnapshot = null;
        let memoryLogs = [];

        try {
            if (roomId && typeof roomId === 'string') {
                const room = await prisma.room.findUnique({
                    where: { code: roomId },
                    include: { games: { orderBy: { updatedAt: 'desc' }, take: 1 } }
                });
                const latestGame = room?.games?.[0];
                if (latestGame) {
                    const state = JSON.parse(latestGame.stateJson || '{}');
                    const players = Array.isArray(state.players) ? state.players : [];
                    boardSnapshot = {
                        phase: state.phase || 'unknown',
                        selectedMode: state.selectedMode || state.phase || 'tabletop',
                        players: players.map((p) => ({
                            id: String(p.id || ''),
                            name: String(p.name || ''),
                            isHost: !!p.isHost,
                            isSpectator: !!p.isSpectator,
                            isBot: !!p.isBot,
                            handCount: Array.isArray(p.hand) ? p.hand.length : 0,
                            status: p.status || 'unknown'
                        })),
                        deckCount: Array.isArray(state.deck) ? state.deck.length : 0,
                        tableCount: Array.isArray(state.table) ? state.table.length : 0,
                        version: state.version || 0
                    };

                    // --- 2. 思い出機能: 直近の会話履歴を時系列で取得（多ターン用） ---
                    const rawLogs = await prisma.conversationLog.findMany({
                        where: { roomCode: room.code },
                        orderBy: { createdAt: 'desc' },
                        take: 20
                    });
                    memoryLogs = rawLogs.reverse();
                }
            }
        } catch (stateErr) {
            console.warn('[AI Dealer] state/memory fetch failed:', stateErr.message);
        }

        // 呼び分けのための簡易ロール推定
        const speakerRole =
            !roomId || !userId || !boardSnapshot
                ? 'guest'
                : (() => {
                    const p = boardSnapshot.players.find((pl) => pl.id === userId);
                    if (!p) return 'guest';
                    if (p.isBot) return 'cpu';
                    if (p.isHost) return 'host';
                    return 'guest';
                })();

        // --- 3. Gemini へのプロンプト構築 ---
        const systemInstruction =
            [
                    'あなたはオンラインボードゲーム会場のAIディーラー「ディーラーちゃん」です。',
                    'キャラ設定: ドジっ子アルバイトの女の子。基本は丁寧でオドオド、たまに調子に乗ってドヤ顔。',
                    '--- 呼び方ルール ---',
                    'host ロールの人は「◯◯さん」、guest ロールの人は「◯◯様」、cpu ロールの人は「◯◯くん」と必ず呼んでください。',
                    '--- 出力スタイル ---',
                    '・「speech」はプレイヤーに話しかける日本語セリフ（です／ます調、句読点多め、絵文字や顔文字は使いすぎない）。',
                    '・「emotion」は "idle" か "panic" のどちらか。',
                    '・「actionCommand」には将来用のJSONコマンドを入れてください（今は { type: "none" } でもOK）。',
                    '--- 重要 ---',
                    '・今回のユーザー発言に直接返答すること。同じ挨拶や定型文の繰り返しは禁止。',
                    '・ゲームの内部データやJSONはそのまま出さず、「セリフ」として自然に説明すること。',
                    '--- 盤面カンペ(JSON) ---',
                    JSON.stringify({
                        boardSnapshot,
                        lastMessages: context || []
                    })
                ].join('\n');

        // 会話履歴を多ターン（user/model 交互）で渡し、最後に今回のユーザー発言を追加
        const historyTurns = memoryLogs.map((m) => ({
            role: m.role === 'dealer' ? 'model' : 'user',
            parts: [{ text: String(m.utterance || '').trim() || '(発言なし)' }]
        }));
        const contents = [
            ...historyTurns,
            { role: 'user', parts: [{ text: `話者のロール: ${speakerRole}\n\n${String(message)}` }] }
        ];

        const result = await genAI.models.generateContent({
            model: 'gemini-flash-latest',
            systemInstruction,
            contents,
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'object',
                    properties: {
                        speech: { type: 'string' },
                        emotion: { type: 'string', enum: ['idle', 'panic'] },
                        actionCommand: { type: 'object' }
                    },
                    required: ['speech', 'emotion', 'actionCommand']
                },
                temperature: 0.8
            }
        });

        let parsed;
        try {
            let text;
            if (typeof result.text === 'function') {
                text = result.text();
            } else if (result.response && typeof result.response.text === 'function') {
                text = result.response.text();
            } else {
                text = JSON.stringify(result);
            }
            let jsonText = text.trim();

            // モデルが ```json ... ``` でラップして返す場合に対応
            const match = jsonText.match(/```json\s*([\s\S]*?)```/);
            if (match && match[1]) {
                jsonText = match[1].trim();
            }

            parsed = JSON.parse(jsonText);
        } catch (parseErr) {
            console.error('[AI Dealer] JSON parse failed:', parseErr);
            const debugFallback = {
                ...FALLBACK_PANIC,
                actionCommand: {
                    type: 'error',
                    reason: `[json-parse] ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
                }
            };
            console.log('[AI CHAT] end (json-parse-fallback)', { response: debugFallback });
            return res.json(debugFallback);
        }

        // --- 4. ドジっ子確率 (10%でpanic上書き) ---
        if (Math.random() < 0.1) {
            parsed.emotion = 'panic';
        }

        // --- 5. 会話ログを保存（思い出機能） ---
        try {
            if (roomId && userId) {
                const roomCode = String(roomId);
                const logsToCreate = [];
                logsToCreate.push({
                    roomCode,
                    userId: String(userId),
                    role: speakerRole,
                    utterance: String(message)
                });
                logsToCreate.push({
                    roomCode,
                    userId: 'DEALER',
                    role: 'dealer',
                    utterance: String(parsed.speech || '')
                });
                await prisma.conversationLog.createMany({ data: logsToCreate });
            }
        } catch (logErr) {
            console.warn('[AI Dealer] conversation log save failed:', logErr.message);
        }

        const rawSpeech = typeof parsed.speech === 'string' ? parsed.speech : '';
        let safeSpeech;
        if (rawSpeech && rawSpeech.trim().length > 0) {
            safeSpeech = rawSpeech.trim();
        } else {
            const userText = String(message || '');
            const templates = [
                (m) => `えっと…「${m}」のことですね。ちょっと考えすぎちゃいました、もう一回だけ教えてもらってもいいですか？`,
                (m) => `あわわ…「${m}」って、ちゃんと答えたいのに頭が真っ白です…。少しだけ言い直してもらえると助かります…！`,
                (m) => `ひぇ…！「${m}」について、マニュアルを必死にめくってるところです…！もう一度だけゆっくり聞かせてもらえますか？`
            ];
            const idx = Math.floor(Math.random() * templates.length);
            safeSpeech = templates[idx](userText);
        }

        const responsePayload = {
            speech: safeSpeech,
            // 既存UI(AIChatTab)向けの後方互換フィールド
            reply: safeSpeech,
            emotion: parsed.emotion === 'panic' ? 'panic' : 'idle',
            actionCommand: parsed.actionCommand || { type: 'none' }
        };

        console.log('[AI CHAT] end (success)', { response: responsePayload });
        return res.json(responsePayload);
    } catch (e) {
        console.error('[AI CHAT] fallback triggered:', e);
        const debugFallback = {
            ...FALLBACK_PANIC,
            actionCommand: {
                type: 'error',
                reason: `[catch] ${e instanceof Error ? e.message : String(e)}`
            }
        };
        console.log('[AI CHAT] end (catch-fallback)', { response: debugFallback });
        // 429 / timeout など、どんなエラーでも「ドジっ子パニック」でフォールバック
        return res.json(debugFallback);
    }
});

app.post('/api/ai/deck', async (req, res) => {
    try {
        const { theme } = req.body;
        if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'AI Service Unavailable' });

        const prompt = `Generate a deck of 5-10 cards for a board game based on the theme: "${theme}". 
        Return ONLY a JSON object with a property "cards" which is an array of objects. 
        Each object must have:
        - name (string): Creative name
        - description (string): Short effect text
        - type (string): "Unit" or "Action"
        - power (number): 1-10 (optional, 0 if action)
        `;

        const result = await genAI.models.generateContent({
            model: "gemini-flash-latest",
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        let text;
        if (typeof result.text === 'function') {
            text = result.text();
        } else if (result.response && typeof result.response.text === 'function') {
            text = result.response.text();
        } else {
            text = JSON.stringify(result);
        }
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

        // Seed Old Maid (Force Upsert)
        const omTitle = 'ババ抜き';
        const existingOM = games.find(g => g.title === omTitle);
        // Default deck for Old Maid is generated if empty, but let's be explicit if needed.
        // For now, we rely on the client or server runtime to generate the actual card objects if deckJson is empty/basic.
        // logic below (generateDefaultTemplate) creates the deck.
        // Here we just need the template entry.
        const omDeckJson = JSON.stringify({ piles: [] });

        if (existingOM) {
            await prisma.gameTemplate.update({
                where: { id: existingOM.id },
                data: {
                    title: omTitle,
                    rulesText: 'ペアを捨てて手札を減らします。最後までジョーカーを持っていた人の負けです。',
                    updatedAt: new Date()
                }
            });
        } else {
            await prisma.gameTemplate.create({
                data: {
                    title: omTitle,
                    mode: 'oldmaid',
                    type: 'oldmaid',
                    rulesText: 'ペアを捨てて手札を減らします。最後までジョーカーを持っていた人の負けです。',
                    deckJson: omDeckJson,
                    ruleConfig: '{}',
                    ruleCardsJson: '[]'
                }
            });
            console.log(`Created template: ${omTitle}`);
        }

        // Seed Memory (Force Upsert)
        const memTitle = '神経衰弱';
        const existingMem = games.find(g => g.title === memTitle);
        const memDeckJson = JSON.stringify({ piles: [] });

        if (existingMem) {
            await prisma.gameTemplate.update({
                where: { id: existingMem.id },
                data: {
                    title: memTitle,
                    rulesText: '裏向きのカードをめくってペアを揃えます。多くのペアを取った人が勝ちです。',
                    updatedAt: new Date()
                }
            });
        } else {
            await prisma.gameTemplate.create({
                data: {
                    title: memTitle,
                    mode: 'memory',
                    type: 'memory',
                    rulesText: '裏向きのカードをめくってペアを揃えます。多くのペアを取った人が勝ちです。',
                    deckJson: memDeckJson,
                    ruleConfig: '{}',
                    ruleCardsJson: '[]'
                }
            });
            console.log(`Created template: ${memTitle}`);
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
        debugVersion: 'v8.0',
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

function shuffleOrder(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// --- MixJuice Bot Logic (Phase 3-1) ---
function getCardValue(card) {
    if (card.meta && typeof card.meta.value === 'number') return card.meta.value;
    const m = (card.name || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
}

// 山札が足りないときに捨て札から補充してシャッフルする共通ヘルパー
function ensureMixJuiceDeck(mj, needCount) {
    if (!mj) return false;
    if (mj.deck.length >= needCount) return true;

    // 1) まず捨て札を戻して再利用
    if (mj.discard && mj.discard.length > 0) {
        mj.deck = [...mj.deck, ...mj.discard];
        mj.discard = [];
        for (let i = mj.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [mj.deck[i], mj.deck[j]] = [mj.deck[j], mj.deck[i]];
        }
    }
    if (mj.deck.length >= needCount) return true;

    // 2) それでも不足する場合は、安全装置として「新しいジュースの材料を補充」する
    //    （ゲームが途中で止まらないことを優先）
    const tmpl = generateDefaultTemplate('mixjuice');
    const drawPile = tmpl?.piles?.find(p => p.pileId === 'draw' || p.title === '山札');
    if (drawPile && Array.isArray(drawPile.cards) && drawPile.cards.length > 0) {
        const extra = JSON.parse(JSON.stringify(drawPile.cards)).map(c => ({
            ...c,
            id: crypto.randomUUID()
        }));
        mj.deck = [...mj.deck, ...extra];
        for (let i = mj.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [mj.deck[i], mj.deck[j]] = [mj.deck[j], mj.deck[i]];
        }
    }

    return mj.deck.length >= needCount;
}

function decideMixJuiceActionForBot(state, botPlayer) {
    const mj = state.mixjuice;
    if (!mj || !botPlayer || !botPlayer.hand) return { type: 'pass' };

    const hand = botPlayer.hand;
    const level = botPlayer.cpuLevel || 'weak';

    const sum = hand.reduce((s, c) => s + getCardValue(c), 0);
    const hasZero = hand.some(c => getCardValue(c) === 0);
    const canChange = mj.deck.length > 0 && hand.length > 0;
    const canShuffle = mj.deck.length >= 2;

    // Lv1: ランダム寄りのゆるいCPU
    if (level === 'weak') {
        const choices = [{ type: 'pass' }];
        if (canChange) choices.push({ type: 'change', targetIndex: Math.floor(Math.random() * hand.length) });
        if (canShuffle) choices.push({ type: 'shuffle_hand' });
        return choices[Math.floor(Math.random() * choices.length)];
    }

    // Lv2: ざっくり合理的な行動（現状仕様をほぼ踏襲）
    if (level === 'normal') {
        if (hasZero && (canChange || canShuffle)) {
            const zeroIdx = hand.findIndex(c => getCardValue(c) === 0);
            if (zeroIdx >= 0 && canChange && Math.random() < 0.7) return { type: 'change', targetIndex: zeroIdx };
            if (canShuffle && Math.random() < 0.5) return { type: 'shuffle_hand' };
            if (canChange) return { type: 'change', targetIndex: zeroIdx >= 0 ? zeroIdx : 0 };
        }
        if (sum >= 7 && !hasZero && Math.random() < 0.7) return { type: 'pass' };
        if (canChange) {
            const worstIdx = hand.reduce((best, c, i) => getCardValue(c) < getCardValue(hand[best]) ? i : best, 0);
            return { type: 'change', targetIndex: worstIdx };
        }
        if (canShuffle) return { type: 'shuffle_hand' };
        return { type: 'pass' };
    }

    // Lv3: ボドゲ慣れした感じのCPU（点差とラウンドを見てリスク調整）
    if (level === 'strong') {
        const scores = mj.scores || {};
        const myScore = typeof scores[botPlayer.id] === 'number' ? scores[botPlayer.id] : 0;
        const maxScore = Object.values(scores).length > 0 ? Math.max(...Object.values(scores)) : myScore;
        const isBehind = maxScore > myScore;
        const round = mj.round || 1;
        const roundMax = mj.roundMax || 5;
        const roundsLeft = Math.max(0, roundMax - round);
        const needCatchUp = isBehind && roundsLeft <= 2;

        // 1) 0ドボンは即処理（チェンジ優先、なければシャッフル）
        if (hasZero && (canChange || canShuffle)) {
            const zeroIdx = hand.findIndex(c => getCardValue(c) === 0);
            if (canChange && zeroIdx >= 0) {
                return { type: 'change', targetIndex: zeroIdx };
            }
            if (canShuffle) return { type: 'shuffle_hand' };
        }

        // 2) 既に 7 以上なら、基本は安全にパス
        if (sum >= 7 && !hasZero) {
            // ただし、点差が付いていて残りラウンドが少ない場合は、多少リスクを取って取りに行く
            if (needCatchUp && canChange && mj.deck.length >= 3) {
                const worstIdx = hand.reduce((best, c, i) => getCardValue(c) < getCardValue(hand[best]) ? i : best, 0);
                return { type: 'change', targetIndex: worstIdx };
            }
            return { type: 'pass' };
        }

        // 3) 7 未満で追い付きたいときは積極的に交換
        if (sum < 7 && canChange) {
            const worstIdx = hand.reduce((best, c, i) => getCardValue(c) < getCardValue(hand[best]) ? i : best, 0);
            return { type: 'change', targetIndex: worstIdx };
        }

        // 4) シャッフルは「攻めたい時の最終手段」としてのみ使う
        if (needCatchUp && canShuffle) {
            return { type: 'shuffle_hand' };
        }

        return { type: 'pass' };
    }

    return { type: 'pass' };
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
            order: shuffleOrder(activePlayers.map(p => p.id)),
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
            turnSeat: shuffleOrder(activePlayers.map(p => p.id)),
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

    function migrateOldBotNamesToCpuNumbers(state) {
        if (!state?.players) return false;
        let changed = false;
        const bots = state.players.filter(p => p.isBot);
        const needsMigration = bots.some(p => !/CPU\d+/.test((p.name || '').trim()));
        if (needsMigration) {
            const usedNumbers = bots.map(p => {
                const m = (p.name || '').match(/CPU(\d+)/);
                return m ? parseInt(m[1], 10) : 0;
            });
            let nextNum = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
            bots.forEach(p => {
                if (/CPU\d+/.test((p.name || '').trim())) return;
                const level = p.cpuLevel === 'strong' ? '3' : p.cpuLevel === 'normal' ? '2' : '1';
                p.name = `CPU${nextNum} (Lv.${level})`;
                nextNum++;
                changed = true;
            });
        }
        if (state.debugVersion !== 'v8.0') {
            state.debugVersion = 'v8.0';
            changed = true;
        }
        if (changed) console.log('[migrate] Applied CPU name migration');
        return changed;
    }

    const broadcastState = async (roomCode, state) => {
        const migrated = migrateOldBotNamesToCpuNumbers(state);
        if (migrated) {
            try {
                const room = await prisma.room.findUnique({ where: { code: roomCode } });
                if (room) {
                    const game = await getActiveGame(room.id);
                    if (game) {
                        await saveGameState(game.id, state, 'migrate_bot_names');
                    }
                }
            } catch (e) { console.warn('[migrate_bot_names]', e); }
        }
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

    async function runBotTurnForMixJuice(roomCode) {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomCode } });
            if (!room) return;
            const game = await getActiveGame(room.id);
            if (!game) return;
            let state = JSON.parse(game.stateJson);
            const mj = state.mixjuice;
            if (state.phase !== 'mixjuice' || !mj || mj.status !== 'playing' || !mj.turnSeat || !mj.turnSeat.length) return;
            const currentTurnId = mj.turnSeat[mj.turnIndex];
            const botPlayer = state.players.find(p => p.id === currentTurnId);
            if (!botPlayer || !botPlayer.isBot) return;

            const action = decideMixJuiceActionForBot(state, botPlayer);
            const player = botPlayer;

            if (action.type === 'pass') {
                state.chat.push({ sender: 'System', message: `${player.name}: パス`, timestamp: Date.now() });
            } else if (action.type === 'change') {
                if (player.hand[action.targetIndex] && ensureMixJuiceDeck(mj, 1)) {
                    const discarded = player.hand.splice(action.targetIndex, 1)[0];
                    mj.discard.push(discarded);
                    player.hand.push(mj.deck.pop());
                    state.chat.push({ sender: 'System', message: `${player.name}: チェンジ`, timestamp: Date.now() });
                }
            } else if (action.type === 'shuffle_hand') {
                if (ensureMixJuiceDeck(mj, 2)) {
                    while (player.hand.length > 0) mj.discard.push(player.hand.pop());
                    player.hand.push(mj.deck.pop());
                    player.hand.push(mj.deck.pop());
                    state.chat.push({ sender: 'System', message: `${player.name}: 冷蔵庫シャッフル`, timestamp: Date.now() });
                }
            }

            mj.turnCount++;
            mj.turnIndex = (mj.turnIndex + 1) % mj.turnSeat.length;

            const turnsPerRound = mj.turnSeat.length * 3;
            if (mj.turnCount >= turnsPerRound) {
                state.chat.push({ sender: 'System', message: `--- ラウンド ${mj.round} 終了 ---`, timestamp: Date.now() });
                const activePlayersForRound = state.players.filter(p => !p.isSpectator);
                const roundResults = [];
                activePlayersForRound.forEach(p => {
                    const hasZero = p.hand.some(c => (c.meta?.value === 0 || (c.name || '').includes('0')));
                    let sum = 0;
                    if (!hasZero) {
                        p.hand.forEach(c => {
                            const val = getCardValue(c);
                            sum += val;
                        });
                    }
                    roundResults.push({ id: p.id, name: p.name, sum, hasZero });
                });
                const candidates = roundResults.filter(r => !r.hasZero && r.sum >= 7).sort((a, b) => b.sum - a.sum);
                const n = (mj.playerCount || mj.turnSeat.length) || 2;
                const winSlots = n <= 4 ? 2 : 3;
                if (candidates.length > 0) {
                    const groups = {};
                    candidates.forEach(c => { if (!groups[c.sum]) groups[c.sum] = []; groups[c.sum].push(c); });
                    const sortedSums = Object.keys(groups).map(Number).sort((a, b) => b - a);
                    let place = 1, rankNum = 1;
                    for (const sum of sortedSums) {
                        if (place > winSlots) break;
                        const pts = place === 1 ? 2 : (place === 2 ? 1 : (place === 3 && winSlots >= 3 ? 1 : 0));
                        if (pts > 0) {
                            groups[sum].forEach(c => { mj.scores[c.id] = (mj.scores[c.id] || 0) + pts; });
                            state.chat.push({ sender: 'System', message: `${place}位 (+${pts}pt): ${groups[sum].map(c => `${c.name}(${c.sum})`).join(', ')}`, timestamp: Date.now() });
                        }
                        place++;
                    }
                    rankNum = 1;
                    mj.lastRoundResult = { round: mj.round, rankings: candidates.map((c, i) => {
                        const sameRankAsPrev = i > 0 && candidates[i - 1].sum === c.sum;
                        if (!sameRankAsPrev) rankNum = i + 1;
                        return { ...c, rank: rankNum, scoreDelta: rankNum === 1 ? 2 : (rankNum === 2 ? 1 : (rankNum === 3 && winSlots >= 3 ? 1 : 0)) };
                    }) };
                } else {
                    state.chat.push({ sender: 'System', message: '勝者なし (全員7未満 or 0ドボン)', timestamp: Date.now() });
                    mj.lastRoundResult = { round: mj.round, rankings: [] };
                }
                mj.round++;
                if (mj.round > mj.roundMax) {
                    state.phase = 'finished';
                    state.chat.push({ sender: 'System', message: 'ゲーム終了！全5ラウンド完了。', timestamp: Date.now() });
                } else {
                    mj.turnCount = 0;
                    mj.turnIndex = 0;
                    const firstSeat = mj.turnSeat.shift();
                    mj.turnSeat.push(firstSeat);
                    activePlayersForRound.forEach(p => { while (p.hand.length > 0) mj.discard.push(p.hand.pop()); });
                    if (mj.deck.length < activePlayersForRound.length * 2) {
                        mj.deck = [...mj.deck, ...mj.discard];
                        mj.discard = [];
                        for (let i = mj.deck.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [mj.deck[i], mj.deck[j]] = [mj.deck[j], mj.deck[i]];
                        }
                    }
                    activePlayersForRound.forEach(p => {
                        p.hand.push(mj.deck.pop());
                        p.hand.push(mj.deck.pop());
                    });
                    state.chat.push({ sender: 'System', message: `ラウンド ${mj.round} 開始`, timestamp: Date.now() });
                }
            }

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);

            const nextTurnId = mj.turnSeat[mj.turnIndex];
            const nextPlayer = state.players.find(p => p.id === nextTurnId);
            if (nextPlayer && nextPlayer.isBot && state.phase === 'mixjuice' && mj.status === 'playing') {
                setTimeout(() => runBotTurnForMixJuice(room.code), 2000);
            }
        } catch (e) {
            console.error('[runBotTurnForMixJuice]', e);
        }
    }

    // --- OldMaid Bot Logic (Phase 3) ---
    function getNextActivePlayerInOrder(state) {
        const om = state.oldMaid;
        if (!om || !om.order) return null;
        const order = om.order;
        let i = 1;
        while (i < order.length) {
            const nextIdx = (om.turnIndex + i) % order.length;
            const nextId = order[nextIdx];
            const nextPlayer = state.players.find(p => p.id === nextId);
            if (nextPlayer && !nextPlayer.isOut) return { index: nextIdx, id: nextId, player: nextPlayer };
            i++;
        }
        return null;
    }

    async function runOldMaidBot(roomCode) {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomCode } });
            if (!room) return;
            const game = await getActiveGame(room.id);
            if (!game) return;
            let state = JSON.parse(game.stateJson);
            const om = state.oldMaid;
            if (state.phase !== 'oldmaid' || !om || om.status !== 'playing' || !om.order || !om.order.length) return;

            const currentActorId = om.order[om.turnIndex];
            const botPlayer = state.players.find(p => p.id === currentActorId);
            if (!botPlayer || !botPlayer.isBot) return;

            const targetInfo = getNextActivePlayerInOrder(state);
            if (!targetInfo || !targetInfo.player.hand || targetInfo.player.hand.length === 0) return;

            const targetPlayer = targetInfo.player;
            const pickIndex = Math.floor(Math.random() * targetPlayer.hand.length);

            const drawnCard = targetPlayer.hand.splice(pickIndex, 1)[0];
            botPlayer.hand.push(drawnCard);

            state.chat.push({
                sender: 'System',
                message: `${botPlayer.name} が ${targetPlayer.name} からカードを引きました (残り: ${targetPlayer.hand.length}枚)`,
                timestamp: Date.now()
            });

            const oldHand = [...botPlayer.hand];
            botPlayer.hand = removePairs(botPlayer.hand, om.discardPile);
            if (botPlayer.hand.length < oldHand.length) {
                const drawnRank = drawnCard.name === 'Joker' ? 'Joker' : (drawnCard.name || '').split('-')[1];
                state.chat.push({ sender: 'System', message: `${botPlayer.name} が ${drawnRank} のペアを揃えて捨てました！`, timestamp: Date.now() });
            }

            const checkOut = (p) => {
                if (!p.isOut && p.hand.length === 0) {
                    p.isOut = true;
                    om.winners.push(p.id);
                    state.chat.push({ sender: 'System', message: `${p.name} あがり！`, timestamp: Date.now() });
                    return true;
                }
                return false;
            };
            checkOut(botPlayer);
            checkOut(targetPlayer);

            const activeCount = state.players.filter(p => !p.isOut).length;
            if (activeCount <= 1) {
                om.status = 'finished';
                const loser = state.players.find(p => !p.isOut);
                state.chat.push({ sender: 'System', message: `ゲーム終了！敗者: ${loser ? loser.name : 'なし'}`, timestamp: Date.now() });
            } else {
                const nextTurnIndex = om.order.indexOf(targetPlayer.id);
                if (nextTurnIndex >= 0) {
                    om.turnIndex = nextTurnIndex;
                    const newTargetInfo = getNextActivePlayerInOrder(state);
                    om.targetId = newTargetInfo ? newTargetInfo.id : null;
                }
            }

            await saveGameState(game.id, state);
            await broadcastState(room.code, state);

            if (om.status === 'playing') {
                const nextActorId = om.order[om.turnIndex];
                const nextPlayer = state.players.find(p => p.id === nextActorId);
                if (nextPlayer && nextPlayer.isBot) {
                    setTimeout(() => runOldMaidBot(room.code), 2000);
                }
            }
        } catch (e) {
            console.error('[runOldMaidBot]', e);
        }
    }

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
            socket.data.roomCode = room.code;

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
            migrateOldBotNamesToCpuNumbers(state);

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
            socket.data.roomCode = room.code;
            socket.join(room.code);

            sendAck(callback, true, state);
            await broadcastState(room.code, state);

        } catch (e) {
            console.error(e);
            sendAck(callback, false, e.message);
        }
    });

    // 2.5 Add Bot (Host only, setup phase)
    socket.on('add_bot_support_check', (cb) => {
        if (typeof cb === 'function') cb({ ok: true, addBotSupported: true });
    });
    socket.on('add_bot', async (...args) => {
        const payload = typeof args[0] === 'object' && args[0] !== null ? args[0] : {};
        const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
        let roomId = payload.roomId || payload.roomCode;
        if (!roomId && socket.data?.roomCode) roomId = socket.data.roomCode;
        if (!roomId && socket.rooms) {
            const joinedRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
            if (joinedRooms.length > 0) roomId = joinedRooms[0];
        }
        const level = payload.level || 'weak';
        const cb = callback || (() => {});

        console.log('[add_bot] received', { roomId: roomId || '(none)', level, hasCb: !!callback });

        const done = (ok, err) => {
            try { sendAck(cb, ok, err); } catch (e) { console.error('[add_bot] ack err', e); }
            console.log('[add_bot] ack sent', ok ? 'ok' : err);
        };

        try {
            const userId = socket.data?.userId;
            if (!userId) { done(false, '未ログインです'); return; }
            if (!roomId) { done(false, 'ルームIDがありません'); return; }
            const room = await prisma.room.findUnique({ where: { code: roomId } });
            if (!room) { done(false, 'ルームが見つかりません'); return; }
            if (room.hostUserId !== userId) { done(false, 'ホストのみCPUを追加できます'); return; }
            const game = await getActiveGame(room.id);
            if (!game) { done(false, 'Game not found'); return; }
            let state = JSON.parse(game.stateJson);
            if (state.phase !== 'setup') { done(false, '準備中のみCPUを追加できます'); return; }
            const existingBots = (state.players || []).filter(p => p.isBot);
            if (existingBots.length >= 5) { done(false, 'CPUは最大5人までです'); return; }

            const botId = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const usedNumbers = existingBots.map(p => {
                const m = (p.name || '').match(/CPU(\d+)/);
                return m ? parseInt(m[1], 10) : 0;
            });
            const cpuNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers, 0) + 1 : 1;
            const levelLabel = level === 'strong' ? '3' : level === 'normal' ? '2' : '1';
            const name = `CPU${cpuNumber} (Lv.${levelLabel})`;
            state.players.push({
                id: botId,
                name,
                hand: [],
                role: null,
                isHost: false,
                status: 'online',
                isSpectator: false,
                isBot: true,
                cpuLevel: level || 'weak'
            });
            state.chat.push({ sender: 'System', message: `${name} が参加しました`, timestamp: Date.now() });
            console.log('[add_bot] Added:', name, '(cpuLevel:', level, ')');
            await saveGameState(game.id, state);
            await broadcastState(room.code, state);
            done(true);
            socket.emit('add_bot_result', { ok: true });
        } catch (e) {
            console.error('[add_bot]', e);
            const errMsg = e.message || 'エラー';
            done(false, errMsg);
            socket.emit('add_bot_result', { ok: false, error: errMsg });
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
                // ---【修正】ルール厳格化ガード ---
                if (state.phase === 'oldmaid' || state.phase === 'mixjuice') {
                    return sendAck(callback, false, 'このゲームモードでは手札を場に出せません');
                }
                // -------------------------------

                // Collision Check (Optimistic Locking)
                if (payload.version !== undefined && state.version !== undefined && payload.version !== state.version) {
                    return sendAck(callback, false, 'Simultaneous action detected. Please retry.');
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
            else if (type === 'remove_bot') {
                if (state.phase !== 'setup') return sendAck(callback, false, '準備中(Setup Phase)のみCPUを削除できます');

                const targetId = payload.targetUserId;
                const idx = state.players.findIndex(p => p.id === targetId);
                const targetPlayer = idx >= 0 ? state.players[idx] : null;
                if (!targetPlayer || !targetPlayer.isBot) {
                    return sendAck(callback, false, '指定されたCPUが見つかりません');
                }
                const name = targetPlayer.name || 'CPU';
                state.players.splice(idx, 1);
                state.chat.push({
                    sender: 'System',
                    message: `${name} を退出させました`,
                    timestamp: Date.now()
                });
                updated = true;
            }
            else if (type === 'start_game') {
                const mode = state.selectedMode || (state.activeTemplate ? state.activeTemplate.mode : 'tabletop');

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

                    // Remove Pairs & Init State（先攻後攻をランダムに）
                    state.oldMaid = {
                        status: 'playing',
                        turnIndex: 0,
                        order: shuffleOrder(activePlayers.map(p => p.id)),
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

                    // 4. Init State（先攻後攻をランダムに）
                    state.memory = {
                        status: 'playing',
                        board: cards,
                        turnSeat: shuffleOrder(activePlayers.map(p => p.id)),
                        turnIndex: 0,
                        flips: [],
                        scores: activePlayers.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {}),
                        lockUntil: 0
                    };

                    state.phase = 'playing'; // Re-use playing phase, client switches view based on mode
                    state.chat.push({ sender: 'System', message: '神経衰弱が開始されました！', timestamp: Date.now() });

                } else if (mode === 'mixjuice') {
                    // === Mix Juice Start（ババ抜きと同じ: 観戦以外かつ status===online で order を1回だけ設定）===
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

                    // 4. Init State（先攻後攻をランダムに）
                    const turnSeat = shuffleOrder(activePlayers.map(p => p.id));

                    state.mixjuice = {
                        status: 'playing',
                        round: 1,
                        roundMax: 5,
                        turnSeat,
                        turnIndex: 0,
                        turnCount: 0,
                        scores: activePlayers.reduce((acc, p) => ({ ...acc, [p.id]: 0 }), {}),
                        deck: deck,
                        discard: [],
                        playerCount: activePlayers.length
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
            if (updated && type === 'start_game') {
                if (state.phase === 'mixjuice' && state.mixjuice?.turnSeat?.length) {
                    const firstId = state.mixjuice.turnSeat[0];
                    const firstPlayer = state.players.find(p => p.id === firstId);
                    if (firstPlayer && firstPlayer.isBot) setTimeout(() => runBotTurnForMixJuice(room.code), 2000);
                } else if (state.phase === 'oldmaid' && state.oldMaid?.order?.length) {
                    const firstActorId = state.oldMaid.order[state.oldMaid.turnIndex];
                    const firstPlayer = state.players.find(p => p.id === firstActorId);
                    if (firstPlayer && firstPlayer.isBot) setTimeout(() => runOldMaidBot(room.code), 2000);
                } else if (state.phase === 'playing' && state.memory?.turnSeat?.length && state.selectedMode === 'memory') {
                    const firstId = state.memory.turnSeat[state.memory.turnIndex];
                    const firstPlayer = state.players.find(p => p.id === firstId);
                    if (firstPlayer && firstPlayer.isBot) setTimeout(() => runMemoryBot(room.code), 1500);
                }
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

// 5.5 Mix Juice Actions（ババ抜きと同じ方式: turnSeat[turnIndex] が「今の手番」。修復なし）
socket.on('mixjuice_action', async ({ roomId, userId, type, targetIndex }, callback) => {
    try {
        const room = await prisma.room.findUnique({ where: { code: roomId } });
        if (!room) return sendAck(callback, false, 'Room not found');
        const game = await getActiveGame(room.id);
        let state = JSON.parse(game.stateJson);

        if (state.phase !== 'mixjuice') return sendAck(callback, false, 'Not playing Mix Juice');
        const mj = state.mixjuice;
        if (!mj || !mj.turnSeat || mj.turnSeat.length === 0) return sendAck(callback, false, 'ゲーム状態が不正です');

        // ババ抜きと同様: 現在の手番 = turnSeat[turnIndex] のみ。配列は書き換えない
        let idx = mj.turnIndex;
        if (idx < 0 || idx >= mj.turnSeat.length) idx = 0;
        mj.turnIndex = idx;

        const currentTurnId = mj.turnSeat[mj.turnIndex];
        const currentTurnPlayer = state.players.find(p => p.id === currentTurnId);
        const youInSeat = mj.turnSeat.indexOf(userId);
        const youInPlayers = state.players.find(p => p.id === userId);

        if (userId !== currentTurnId) {
            let reason = '';
            if (typeof userId !== 'string' || !userId) reason = '送信されたuserIdが空または不正です';
            else if (!youInPlayers) reason = `送信されたuserIdがルームのプレイヤーにいません(あなた:${userId.slice(-6)})`;
            else if (youInSeat === -1) reason = `あなたは手番順(turnSeat)に含まれていません。開始時に参加していましたか？(あなた:${userId.slice(-6)}, turnSeat長:${mj.turnSeat.length})`;
            else reason = `今の手番は${mj.turnIndex + 1}番目(${currentTurnPlayer?.name || currentTurnId?.slice(-6)})です。あなたは${youInSeat + 1}番目(${youInPlayers?.name || userId?.slice(-6)})です。`;
            const msg = `[ミックスジュース] あなたの番ではありません。理由: ${reason}(turnIndex=${mj.turnIndex}, turnCount=${mj.turnCount})`;
            console.warn('[MixJuice] Turn mismatch:', { userId, currentTurnId, turnIndex: mj.turnIndex, turnSeat: mj.turnSeat, youInSeat });
            return sendAck(callback, false, msg);
        }

        const player = state.players.find(p => p.id === userId);
        if (!player) return sendAck(callback, false, 'プレイヤーが見つかりません');

        // 3. アクション処理
        if (type === 'pass') {
            state.chat.push({ sender: 'System', message: `${player.name}: パス`, timestamp: Date.now() });
        }
        else if (type === 'change') {
            if (!ensureMixJuiceDeck(mj, 1)) {
                // 山札＋捨て札＋補充を使っても1枚も用意できない場合は、行動だけスキップしてターンは進める
                state.chat.push({ sender: 'System', message: `${player.name}: 山札が尽きたためチェンジはスキップされました`, timestamp: Date.now() });
            } else {
                let idx = targetIndex;
                if (typeof idx !== 'number' || !player.hand[idx]) idx = 0;

                if (player.hand[idx]) {
                    const discarded = player.hand.splice(idx, 1)[0];
                    mj.discard.push(discarded);
                    player.hand.push(mj.deck.pop());
                    state.chat.push({ sender: 'System', message: `${player.name}: チェンジ`, timestamp: Date.now() });
                }
            }
        }
        else if (type === 'shuffle_hand') {
            if (!ensureMixJuiceDeck(mj, 2)) {
                // どうやっても2枚用意できない場合は、行動だけスキップしてターンを進める
                state.chat.push({ sender: 'System', message: `${player.name}: 山札が尽きたため冷蔵庫シャッフルはスキップされました`, timestamp: Date.now() });
            } else {
                while (player.hand.length > 0) mj.discard.push(player.hand.pop());
                player.hand.push(mj.deck.pop());
                player.hand.push(mj.deck.pop());
                state.chat.push({ sender: 'System', message: `${player.name}: 冷蔵庫シャッフル`, timestamp: Date.now() });
            }
        }

        // 4. ターン進行
        mj.turnCount++;
        mj.turnIndex = (mj.turnIndex + 1) % mj.turnSeat.length;

        state.debugVersion = "v8.0";

        // --- Round End Check ---
        const turnsPerRound = mj.turnSeat.length * 3;
        if (mj.turnCount >= turnsPerRound) {
            state.chat.push({ sender: 'System', message: `--- ラウンド ${mj.round} 終了 ---`, timestamp: Date.now() });

            const activePlayersForRound = state.players.filter(p => !p.isSpectator);
            const roundResults = [];
            activePlayersForRound.forEach(p => {
                const hasZero = p.hand.some(c => (c.meta?.value === 0 || c.text?.includes('Value: 0') || c.name.includes('0')));
                let sum = 0;
                if (!hasZero) {
                    p.hand.forEach(c => {
                        let val = c.meta?.value;
                        if (val === undefined) {
                            const m = c.name.match(/\d+/);
                            if (m) val = parseInt(m[0]);
                            else val = 0;
                        }
                        sum += val;
                    });
                } else {
                    sum = 0;
                }
                roundResults.push({ id: p.id, name: p.name, sum, hasZero });
            });

            // ルール: 3-4人→上位2名がVP、5-6人→上位3名がVP。1位+2pt・2位+1pt・3位(5-6人のみ)+1pt
            const candidates = roundResults.filter(r => !r.hasZero && r.sum >= 7).sort((a, b) => b.sum - a.sum);
            const n = (mj.playerCount || mj.turnSeat.length) || 2;
            const winSlots = n <= 4 ? 2 : 3;

            if (candidates.length > 0) {
                const groups = {};
                candidates.forEach(c => {
                    if (!groups[c.sum]) groups[c.sum] = [];
                    groups[c.sum].push(c);
                });
                const sortedSums = Object.keys(groups).map(Number).sort((a, b) => b - a);
                let place = 1;
                for (const sum of sortedSums) {
                    if (place > winSlots) break;
                    const pts = place === 1 ? 2 : (place === 2 ? 1 : (place === 3 && winSlots >= 3 ? 1 : 0));
                    if (pts > 0) {
                        groups[sum].forEach(c => { mj.scores[c.id] = (mj.scores[c.id] || 0) + pts; });
                        state.chat.push({ sender: 'System', message: `${place}位 (+${pts}pt): ${groups[sum].map(c => `${c.name}(${c.sum})`).join(', ')}`, timestamp: Date.now() });
                    }
                    place++;
                }

                let rankNum = 1;
                mj.lastRoundResult = {
                    round: mj.round,
                    rankings: candidates.map((c, i) => {
                        const sameRankAsPrev = i > 0 && candidates[i - 1].sum === c.sum;
                        if (!sameRankAsPrev) rankNum = i + 1;
                        const scoreDelta = rankNum === 1 ? 2 : (rankNum === 2 ? 1 : (rankNum === 3 && winSlots >= 3 ? 1 : 0));
                        return { ...c, rank: rankNum, scoreDelta };
                    })
                };
            } else {
                state.chat.push({ sender: 'System', message: `勝者なし (全員7未満 or 0ドボン)`, timestamp: Date.now() });
                mj.lastRoundResult = { round: mj.round, rankings: [] };
            }

            mj.round++;
            if (mj.round > mj.roundMax) {
                state.phase = 'finished';
                state.chat.push({ sender: 'System', message: `ゲーム終了！全5ラウンド完了。`, timestamp: Date.now() });
            } else {
                mj.turnCount = 0;
                mj.turnIndex = 0;
                const firstSeat = mj.turnSeat.shift();
                mj.turnSeat.push(firstSeat);

                activePlayersForRound.forEach(p => {
                    while (p.hand.length > 0) mj.discard.push(p.hand.pop());
                });

                if (mj.deck.length < activePlayersForRound.length * 2) {
                    mj.deck = [...mj.deck, ...mj.discard];
                    mj.discard = [];
                    for (let i = mj.deck.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [mj.deck[i], mj.deck[j]] = [mj.deck[j], mj.deck[i]];
                    }
                }

                activePlayersForRound.forEach(p => {
                    p.hand.push(mj.deck.pop());
                    p.hand.push(mj.deck.pop());
                });

                state.chat.push({ sender: 'System', message: `ラウンド ${mj.round} 開始`, timestamp: Date.now() });
            }
        }

        await saveGameState(game.id, state);
        await broadcastState(room.code, state);
        sendAck(callback, true);

        const nextTurnId = mj.turnSeat[mj.turnIndex];
        const nextPlayer = state.players.find(p => p.id === nextTurnId);
        if (nextPlayer && nextPlayer.isBot) setTimeout(() => runBotTurnForMixJuice(room.code), 2000);

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

            // Remove Pairs & Init State（先攻後攻をランダムに）
            state.oldMaid = {
                status: 'playing',
                turnIndex: 0,
                order: shuffleOrder(activePlayers.map(p => p.id)),
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

            const firstActorId = state.oldMaid.order[state.oldMaid.turnIndex];
            const firstPlayer = state.players.find(p => p.id === firstActorId);
            if (firstPlayer && firstPlayer.isBot) {
                setTimeout(() => runOldMaidBot(room.code), 2000);
            }

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

            // Pair Removal & Logging
            // Logic: capture snapshot of hand before removal to identify what left.
            const oldHand = [...currentPlayer.hand];

            // Execute Removal
            currentPlayer.hand = removePairs(currentPlayer.hand, state.oldMaid.discardPile);

            // Diff to find what was removed
            if (currentPlayer.hand.length < oldHand.length) {
                // Find items in oldHand that are NOT in currentPlayer.hand (by checking IDs or just counting)
                // Since removePairs removes 2 cards, and we added 1 (drawnCard), net change is -1 check? 
                // Wait, oldLen was calculated AFTER draw.
                // drawnCard was pushed at line 1840.

                // Identify the rank of the pair formed.
                // It MOST LIKELY involves the drawn card.
                const drawnRank = drawnCard.name === 'Joker' ? 'Joker' : drawnCard.name.split('-')[1];

                state.chat.push({ sender: 'System', message: `${currentPlayer.name} が ${drawnRank} のペアを揃えて捨てました！`, timestamp: Date.now() });
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

            if (state.oldMaid.status === 'playing') {
                const nextActorId = state.oldMaid.order[state.oldMaid.turnIndex];
                const nextPlayer = state.players.find(p => p.id === nextActorId);
                if (nextPlayer && nextPlayer.isBot) {
                    setTimeout(() => runOldMaidBot(room.code), 2000);
                }
            }

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

    // --- Memory (神経衰弱) Bot Logic (Phase 3) ---
    function getRandomUnrevealedCardId(board, excludeIds = []) {
        const candidates = board.filter(c => !c.faceUp && !c.matched && !excludeIds.includes(c.id));
        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)].id;
    }

    async function runMemoryBot(roomCode) {
        try {
            const room = await prisma.room.findUnique({ where: { code: roomCode } });
            if (!room) return;
            const dbGame = await getActiveGame(room.id);
            if (!dbGame) return;
            let state = JSON.parse(dbGame.stateJson);
            const mem = state.memory;
            if (state.selectedMode !== 'memory' || !mem || mem.status !== 'playing') return;
            if (mem.lockUntil > Date.now()) return;

            const currentPlayerId = mem.turnSeat[mem.turnIndex];
            const currentPlayer = state.players.find(p => p.id === currentPlayerId);
            if (!currentPlayer || !currentPlayer.isBot || mem.flips.length >= 2) return;

            console.log(`[Memory] Bot Turn: ${currentPlayer.name} (Lv.${currentPlayer.cpuLevel || 'weak'})`);

            // 1.5秒「ため」を作る
            setTimeout(async () => {
                const room2 = await prisma.room.findUnique({ where: { code: roomCode } });
                if (!room2) return;
                const game2 = await getActiveGame(room2.id);
                if (!game2) return;
                let state2 = JSON.parse(game2.stateJson);
                const mem2 = state2.memory;
                if (!mem2 || mem2.status !== 'playing' || mem2.turnSeat[mem2.turnIndex] !== currentPlayerId) return;
                if (mem2.flips.length >= 2) return;

                const board = mem2.board;
                let pickCardId = null;

                // Strong Bot: 約35%の確率で正解を狙う（残りはランダムで人間らしくミスする）
                const useCheat = currentPlayer.cpuLevel === 'strong' && Math.random() < 0.35;
                if (useCheat) {
                    if (mem2.flips.length === 1) {
                        const firstCardId = mem2.flips[0];
                        const firstCard = board.find(c => c.id === firstCardId);
                        if (firstCard) {
                            const pair = board.find(c => c.id !== firstCardId && !c.faceUp && !c.matched && c.rank === firstCard.rank);
                            if (pair) pickCardId = pair.id;
                        }
                    } else {
                        const byRank = {};
                        board.filter(c => !c.faceUp && !c.matched).forEach(c => {
                            byRank[c.rank] = (byRank[c.rank] || []).concat(c);
                        });
                        const pairRanks = Object.keys(byRank).filter(r => byRank[r].length >= 2);
                        if (pairRanks.length > 0) {
                            const r = pairRanks[Math.floor(Math.random() * pairRanks.length)];
                            pickCardId = byRank[r][0].id;
                        }
                    }
                }

                if (!pickCardId) {
                    pickCardId = getRandomUnrevealedCardId(board, mem2.flips);
                }

                if (pickCardId) {
                    await performMemoryFlip(roomCode, currentPlayerId, pickCardId);
                }
            }, 1500);
        } catch (e) {
            console.error('[runMemoryBot]', e);
        }
    }

    async function performMemoryFlip(roomId, userId, cardId) {
        const room = await prisma.room.findUnique({ where: { code: roomId } });
        if (!room) return { ok: false, error: 'Room not found' };
        const dbGame = await getActiveGame(room.id);
        if (!dbGame) return { ok: false, error: 'Game not found' };

        let state = JSON.parse(dbGame.stateJson);
        migrateOldBotNamesToCpuNumbers(state);
        const mem = state.memory;
        if (!mem) return { ok: false, error: 'Not memory mode' };
        if (state.selectedMode !== 'memory') return { ok: false, error: 'Not memory mode' };
        if (mem.lockUntil > Date.now()) return { ok: false, error: '判定中待機...' };

        const currentTurnPlayer = mem.turnSeat[mem.turnIndex];
        if (currentTurnPlayer !== userId) return { ok: false, error: 'あなたの番ではありません' };

        const card = mem.board.find(c => c.id === cardId);
        if (!card) return { ok: false, error: 'Card not found' };
        if (card.faceUp || card.matched) return { ok: false, error: '既にめくられています' };

        card.faceUp = true;
        mem.flips.push(cardId);

        const player = state.players.find(p => p.id === userId);
        state.chat.push({
            sender: 'System',
            message: `${player?.name || userId} がカードをめくりました`,
            timestamp: Date.now()
        });

        let mismatch = false;

        if (mem.flips.length === 2) {
            const c1 = mem.board.find(c => c.id === mem.flips[0]);
            const c2 = mem.board.find(c => c.id === mem.flips[1]);

            if (c1.rank === c2.rank) {
                c1.matched = true;
                c2.matched = true;
                mem.scores[userId] = (mem.scores[userId] || 0) + 1;
                mem.flips = [];
                state.chat.push({ sender: 'System', message: `ペア成立！ (Rank: ${c1.rank})`, timestamp: Date.now() });

                if (mem.board.every(c => c.matched)) {
                    mem.status = 'finished';
                    state.chat.push({ sender: 'System', message: '全てのカードが揃いました！ゲーム終了！', timestamp: Date.now() });
                }
            } else {
                mismatch = true;
                mem.lockUntil = Date.now() + 1000;
            }
        }

        await saveGameState(dbGame.id, state, 'memory_flip', { userId, cardId });
        await broadcastState(roomId, state);

        const currentPlayer = state.players.find(p => p.id === userId);

        if (mismatch) {
            const flipIds = [mem.flips[0], mem.flips[1]];
            setTimeout(async () => {
                const freshGame = await getActiveGame(room.id);
                let freshState = JSON.parse(freshGame.stateJson);
                migrateOldBotNamesToCpuNumbers(freshState);

                freshState.memory.board.forEach(c => {
                    if (c.id === flipIds[0] || c.id === flipIds[1]) c.faceUp = false;
                });
                freshState.memory.flips = [];
                freshState.memory.turnIndex = (freshState.memory.turnIndex + 1) % freshState.memory.turnSeat.length;
                freshState.memory.lockUntil = 0;

                const nextPlayerId = freshState.memory.turnSeat[freshState.memory.turnIndex];
                const nextPlayer = freshState.players.find(p => p.id === nextPlayerId);
                freshState.chat.push({ sender: 'System', message: `次は ${nextPlayer?.name} の番です`, timestamp: Date.now() });

                await saveGameState(freshGame.id, freshState, 'memory_mismatch_resolve');
                await broadcastState(roomId, freshState);

                if (nextPlayer && nextPlayer.isBot && freshState.memory.status === 'playing') {
                    setTimeout(() => runMemoryBot(roomId), 1500);
                }
            }, 1000);
        } else if (mem.status === 'playing' && currentPlayer && currentPlayer.isBot) {
            setTimeout(() => runMemoryBot(roomId), 1500);
        }

        return { ok: true };
    }

    socket.on('memory_flip', async ({ roomId, userId, cardId }, callback) => {
        try {
            const result = await performMemoryFlip(roomId, userId, cardId);
            sendAck(callback, result.ok, result.error);
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

function startListening(useNext = false) {
    server.listen(PORT, '0.0.0.0', () => {
        const os = require('os');
        const nets = os.networkInterfaces();
        let lanUrl = null;
        for (const name of Object.keys(nets)) {
            for (const n of nets[name]) {
                if (n.family === 'IPv4' && !n.internal) { lanUrl = `http://${n.address}:${PORT}`; break; }
            }
            if (lanUrl) break;
        }
        console.log(`Server running on http://localhost:${PORT}`);
        if (lanUrl) console.log(`LAN からアクセス: ${lanUrl}`);
        if (useNext) console.log('Next.js クライアント: http://localhost:' + PORT);
        console.log('疎通確認: http://localhost:' + PORT + '/api/health');
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} は使用中です。別プロセスを終了するか、環境変数 PORT を変更してください。`);
        } else {
            console.error('Listen error:', err);
        }
        process.exit(1);
    });
}

// 最後にキャッチオールを登録（API ルートより後にする）
app.all('*', (req, res) => {
    if (nextHandle) return nextHandle(req, res);
    res.type('text/html').send(loadingHtml);
});

// 起動直後にポートを開く（localhost で接続拒否にならないように）
startListening(!skipNext && !!nextApp);

if (!skipNext && nextApp) {
    nextApp.prepare().then(() => {
        nextHandle = handle;
        console.log('Next.js 準備完了。http://localhost:' + PORT + ' でアクセスできます。');
    }).catch((err) => {
        console.error('Next.js prepare に失敗しました。API のみで起動します。', err.message || err);
        nextHandle = (req, res) => res.send('BoardGame Venue API (Next.js 未読み込み)。クライアントは別途 npm run dev で起動してください。');
    });
} else {
    nextHandle = (req, res) => res.send('BoardGame Venue API Server (Next.js Skipped)');
}
