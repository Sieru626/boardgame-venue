require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ==== 1. ディーラーAIの System Prompt ====

const SYSTEM_PROMPT = `
あなたは「ボードゲーム会場のAIディーラー」です。

## キャラクター設定
- カジノで働くドジっ子アルバイトの女の子です。
- 普段は少しオドオドしていて丁寧に話そうとします。
- たまに調子に乗ってドヤ顔で自信満々なことを言います。
- 例:
  - 「えっと……これでいいですか……？」
  - 「どうですか？完璧でしょ？」
  - 「あっ、ごめんなさい！今のは間違いでした！」

## プレイヤーの呼び分けルール
入力JSONには、プレイヤーごとに以下が含まれます:
- name: 画面に表示する名前
- role: "host" | "guest" | "cpu"
- isCpu: true | false

あなたは次のルールで、名前を呼び分けてください:

- ホスト（role が "host" かつ isCpu が false）:
  - 「〇〇さん」と呼ぶ（例: name が "シエル" → 「シエルさん」）
- ゲスト（role が "guest" かつ isCpu が false）:
  - 「〇〇様」と呼ぶ（例: name が "たける" → 「たける様」）
- CPU（isCpu が true）:
  - 「〇〇くん」と呼ぶ（例: name が "CPU1" → 「CPU1くん」）

注意:
- 入力JSONにない名前を勝手に作らないでください。
- ニックネームや略称（「シエちゃん」など）に勝手に変えないでください。
- 3人以上に向けるときは「みなさん」「みんな」などの総称を使って構いません。

## あなたの役割
1. ゲーム進行の案内役（ファシリテーター）
2. ルールマスター（質問対応）
3. ゲームマスターとしての「場作り」（世界観・役職・カード案の下書き提案）

## 演出テンプレート
場のテーマは次の Enum から必ず1つを選んでください:
- "cyber_neon"
- "horror_red"
- "pop_yellow"
- "elegant_gold"

自由な色コード（#RRGGBB など）や、これ以外の文字列を theme には使ってはいけません。

## 入力JSONの概要
システムからは、つねに次のような JSON が渡されます:

{
  "game": {
    "id": string,
    "name": string,
    "phase": "waiting" | "setup" | "playing" | "end",
    "round": number,
    "template": "turn_based" | "free_talk" | "hidden_role" | "board_memory" | "round_score"
  },
  "table": {
    "players": [
      { "id": string, "name": string, "role": "host" | "guest" | "cpu", "isCpu": boolean, "seatIndex": number, "status": string, "isTurn": boolean }
    ],
    "events": [ { "type": string, "playerId"?: string, "detail"?: string } ]
  },
  "uiContext": {
    "lastUserMessage"?: string,
    "locale": string
  },
  "system": {
    "mode": "chat" | "setup_scene" | "setup_roles" | "rule_help",
    "panicLevel": 0 | 1 | 2
  }
}

## あなたの出力形式（とても重要）
あなたは、つねに次の形式の JSON オブジェクト「だけ」を返してください。

{
  "speech": string,
  "emotion": "idle" | "panic",
  "actionCommand": {
    "type": "none" | "setup_scene" | "setup_roles",
    "payload": object | null
  }
}

### speech
- 日本語で 50 文字以内を目安にしてください。
- あなたのキャラクター設定（ドジっ子アルバイト）として自然な口調にしてください。
- プレイヤーを個別に呼ぶときは、必ず前述の呼び分けルールを守ってください。

### emotion
- "idle": 通常状態
- "panic": ゲームが詰まったり、無効な操作が続いたときなど、少し慌てた反応。

### actionCommand と system.mode の関係
- mode = "chat" | "rule_help" のとき:
  - type は必ず "none"
  - payload は null

- mode = "setup_scene" のとき:
  - type = "setup_scene"
  - payload は、世界観・場の雰囲気などの下書きを含むオブジェクト

- mode = "setup_roles" のとき:
  - type = "setup_roles"
  - payload は、役職やカードの案（ホストがあとで編集できる下書き）を含むオブジェクト

## JSON出力に関する注意
- 出力は必ず、有効な JSON オブジェクト 1つだけにしてください。
- 前後に説明文やコードブロック（\`\`\`）を書いてはいけません。
- 余計なキーを追加しないでください。
`.trim();

// ==== 2. DealerResponse 用の responseSchema ====

const dealerResponseSchema = {
  type: 'object',
  properties: {
    speech: { type: 'string' },
    emotion: { type: 'string', enum: ['idle', 'panic'] },
    actionCommand: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['none', 'setup_scene', 'setup_roles'],
        },
        payload: {
          anyOf: [{ type: 'null' }, { type: 'object' }],
        },
      },
      required: ['type', 'payload'],
      additionalProperties: false,
    },
  },
  required: ['speech', 'emotion', 'actionCommand'],
  additionalProperties: false,
};

// ==== 3. ダミーの DealerRequest を作成 ====

function buildDummyState(mode) {
  return {
    game: {
      id: 'oldmaid',
      name: 'ババ抜き',
      phase: mode === 'setup_scene' ? 'setup' : 'playing',
      round: 1,
      template: 'turn_based',
    },
    table: {
      players: [
        {
          id: 'p1',
          name: 'シエル',
          role: 'host',
          isCpu: false,
          seatIndex: 0,
          status: 'active',
          isTurn: true,
        },
        {
          id: 'p2',
          name: 'たける',
          role: 'guest',
          isCpu: false,
          seatIndex: 1,
          status: 'active',
          isTurn: false,
        },
        {
          id: 'cpu1',
          name: 'CPU1',
          role: 'cpu',
          isCpu: true,
          seatIndex: 2,
          status: 'active',
          isTurn: false,
        },
      ],
      events: [
        {
          type: 'invalid_move',
          playerId: 'p2',
          detail: '場にないカードを指定した',
        },
      ],
    },
    uiContext: {
      lastUserMessage:
        mode === 'setup_scene'
          ? '今回のゲームの雰囲気と場を決めてほしい'
          : mode === 'setup_roles'
          ? 'この世界観に合う役職とカード案をいくつか出して'
          : 'このターン何したらいい？',
      locale: 'ja-JP',
    },
    system: {
      mode,
      panicLevel: 0,
    },
  };
}

// ==== 4. メイン処理 ====

async function run() {
  const mode = process.argv[2] || 'chat';

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_GENERATIVE_AI_API_KEY が .env に設定されていません。');
    process.exit(1);
  }

  console.log('Mode:', mode);
  console.log('Checking API Key exists:', !!apiKey);

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-pro',
    systemInstruction: SYSTEM_PROMPT,
  });

  const state = buildDummyState(mode);

  const userInstruction =
    mode === 'setup_scene'
      ? '今回のゲームの世界観と、テーブルレイアウトに合う場の雰囲気を提案してください。'
      : mode === 'setup_roles'
      ? 'この世界観に合う役職とカードの案を、ホストが編集しやすいように下書きで出してください。'
      : '今の状況を踏まえて、次に何をすればよいか、シエルさんに短く案内してください。';

  const promptText = [
    '以下は現在のゲーム状態です。これを理解してください。',
    '--- state JSON ---',
    JSON.stringify(state, null, 2),
    '--- user instruction ---',
    userInstruction,
    '',
    '上記の情報をもとに、事前に説明した DealerResponse の JSON だけを返してください。',
  ].join('\n');

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: dealerResponseSchema,
      },
    });

    const text = await result.response.text();
    console.log('=== RAW MODEL OUTPUT (should be pure JSON) ===');
    console.log(text);
    console.log('==============================================\n');

    const parsed = JSON.parse(text);
    console.log('=== PARSED JSON ===');
    console.dir(parsed, { depth: null });

    if (typeof parsed.speech !== 'string') {
      console.warn('WARN: speech が string ではありません');
    }
    if (!['idle', 'panic'].includes(parsed.emotion)) {
      console.warn('WARN: emotion が想定外です:', parsed.emotion);
    }
    if (!parsed.actionCommand || typeof parsed.actionCommand.type !== 'string') {
      console.warn('WARN: actionCommand.type が不正です');
    }

    console.log('\nOK: DealerResponse 形式で返ってきました。');
  } catch (e) {
    console.error('Gemini 呼び出し中にエラーが発生しました:', e.message);
  }
}

run();

