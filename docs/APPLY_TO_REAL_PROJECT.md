# 本番プロジェクトへの適用ガイド（CPU名 CPU1/2/3 化）

## 前提：スプリットブレインの解消

- **編集していた場所**: `C:\Users\user\.gemini\antigravity\scratch\boardgame-venue-mvp`（AI用サンドボックス）
- **普段起動している場所**: デスクトップなど別フォルダの可能性が高い
- **対処**: 本番フォルダを開き、以下を適用する

---

## 手順1: 本番フォルダの特定

1. 普段 `start-all.bat` をダブルクリックしているフォルダを開く
2. エクスプローラーのアドレスバーでパスを確認（例: `C:\Users\user\Desktop\boardgame-venue-mvp`）
3. **Cursor/VSCode でそのフォルダを開き直す**（ファイル → フォルダーを開く）

---

## 手順2: サーバー修正（server/index.js）

### A. add_bot 内の名前生成ロジック

**検索**: `const name = ` または `CPU (Lv.`

**置換後**（既存の add_bot 内、state.players.push の直前）:
```javascript
            const botId = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const usedNumbers = existingBots.map(p => {
                const m = (p.name || '').match(/CPU(\d+)/);
                return m ? parseInt(m[1], 10) : 0;
            });
            const cpuNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers, 0) + 1 : 1;
            const levelLabel = level === 'strong' ? '3' : level === 'normal' ? '2' : '1';
            const name = `CPU${cpuNumber} (Lv.${levelLabel})`;
```

### B. マイグレーション関数の追加

`broadcastState` の**直前**に以下を追加:
```javascript
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
        return changed;
    }
```

### C. broadcastState の先頭でマイグレーション呼び出し

`const broadcastState = async (roomCode, state) => {` の直後に追加:
```javascript
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
```

### D. join_room 内でマイグレーション呼び出し

`let state = JSON.parse(game.stateJson);` の直後、`if (!state.chat)` の直前に追加:
```javascript
            migrateOldBotNamesToCpuNumbers(state);
```

### E. createInitialState に debugVersion 追加

`return {` の直後に追加:
```javascript
        debugVersion: 'v8.0',
```

---

## 手順3: クライアント修正

### client/app/room/[id]/page.tsx

**検索**: `msg.includes('CPU (Lv.')`

**置換後**:
```javascript
            /CPU\d+/.test(msg) ||
```

### client/app/components/UnifiedTable.tsx

**検索**: `"v6.0 (Old)"` または `state.debugVersion ||`

**置換後**:
```javascript
{state.debugVersion || "v8.0 (CPU Numbering)"}
```

---

## 手順4: マイグレーションスクリプトの配置

`server/migrate-cpu-names.js` を新規作成し、以下を貼り付け:

```javascript
/**
 * CPU名を一括で CPU1, CPU2 形式にマイグレーション
 * 実行: cd server && node migrate-cpu-names.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function migrateState(state) {
    if (!state?.players) return false;
    let changed = false;
    const bots = state.players.filter(p => p.isBot);
    const usedMax = Math.max(0, ...bots.map(b => {
        const m = (b.name || '').match(/CPU(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
    }));
    let nextNum = usedMax + 1;
    bots.forEach(p => {
        const n = (p.name || '').trim();
        if (/CPU\d+/.test(n)) return;
        const level = p.cpuLevel === 'strong' ? '3' : p.cpuLevel === 'normal' ? '2' : '1';
        p.name = `CPU${nextNum} (Lv.${level})`;
        nextNum++;
        changed = true;
    });
    if (changed) state.debugVersion = 'v8.0';
    return changed;
}

async function main() {
    const games = await prisma.game.findMany({ orderBy: { createdAt: 'desc' } });
    let count = 0;
    for (const game of games) {
        try {
            const state = JSON.parse(game.stateJson || '{}');
            if (migrateState(state)) {
                await prisma.game.update({
                    where: { id: game.id },
                    data: { stateJson: JSON.stringify(state) }
                });
                count++;
                console.log('Migrated game:', game.id);
            }
        } catch (e) {
            console.error('Error migrating game', game.id, e.message);
        }
    }
    console.log('Done. Migrated', count, 'game(s).');
}

main()
    .then(() => prisma.$disconnect())
    .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
```

---

## 手順5: 実行と確認

1. **DBマイグレーション**（本番の server フォルダで）:
   ```
   cd C:\Users\user\【本番パス】\boardgame-venue-mvp\server
   node migrate-cpu-names.js
   ```

2. **サーバー再起動**: 起動中のサーバーを Ctrl+C で停止し、`start-all.bat` を再実行

3. **確認**:
   - 画面右上のバージョンが `v8.0 (CPU Numbering)` になっているか
   - 新規ルームでCPU追加 → `CPU1 (Lv.3)` などと表示されるか

---

## 別案: サンドボックスをそのまま本番として使う

以下のバッチで、修正済みプロジェクトをデスクトップにコピーできます:

```
xcopy /E /I /Y "C:\Users\user\.gemini\antigravity\scratch\boardgame-venue-mvp" "C:\Users\user\Desktop\boardgame-venue-mvp"
```

コピー後、`C:\Users\user\Desktop\boardgame-venue-mvp\start-all.bat` をダブルクリックして起動。
