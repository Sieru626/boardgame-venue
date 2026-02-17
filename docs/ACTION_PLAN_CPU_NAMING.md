# CPU名修正のアクションプラン（スプリットブレイン解消）

## 原因
- **編集対象**: `C:\Users\user\.gemini\antigravity\scratch\boardgame-venue-mvp`（AIの一時サンドボックス）
- **起動対象**: デスクトップなど別フォルダの「本物のプロジェクト」
- → パスが違うため、修正が反映されない

---

## 手順1: 「本物」の場所を特定する

1. 普段使っている **start-all.bat** があるフォルダを開く
2. エクスプローラーのアドレスバーでパスを確認（例: `C:\Users\user\Desktop\boardgame-venue`）
3. Cursor/VSCode で開いているフォルダのパスと比較
   - エディタが `.gemini\antigravity\...` を指している → **本物のフォルダを開き直す**

---

## 手順2: 修正を「本物」に移植する

エディタで**本物のフォルダ**を開いた上で、以下を適用。

### A. サーバー `server/index.js` の add_bot 内

**探す**: `const name = \`CPU (Lv.${levelLabel})\`;` または類似

**置き換え**:
```javascript
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
```

### B. クライアント `client/app/room/[id]/page.tsx` のチャット判定

**探す**: `msg.includes('CPU (Lv.')`

**置き換え**:
```javascript
        const isCpuRelated =
            /CPU\d+/.test(msg) ||
            msg.includes('ラウンド') ||
            ...
```

### C. バージョン表記 `client/app/components/UnifiedTable.tsx`

**探す**: `"v6.0 (Old)"` または `state.debugVersion || "v6.0"`

**置き換え**:
```javascript
            {state.debugVersion || "v8.0 (CPU Numbering)"}
```

→ バージョンが変われば「反映された」と一発で分かる。

---

## 手順3: マイグレーション（既存データ変換）

既存の「CPU (Lv.3)」を「CPU1 (Lv.3)」に変換するには、**本物のフォルダ**で:

```bat
cd （本物のパス）\server
node migrate-cpu-names.js
```

`migrate-cpu-names.js` が無ければ、サンドボックスの `server/migrate-cpu-names.js` を本物の `server/` にコピーする。

---

## 手順4: 強制再ビルドと確認

1. ターミナルを全終了（Ctrl+C）
2. `start-all.bat` を再実行
3. 確認:
   - 画面上のバージョンが **v8.0** になっているか
   - 新規ルームでCPU追加 → **CPU1 (Lv.普)** と表示されるか

---

## オプションA: サンドボックスを「本物」として使う

`.gemini\antigravity\scratch\boardgame-venue-mvp` を普段の作業フォルダにする場合:

1. このフォルダをエクスプローラーで開く
2. `start-all.bat` をダブルクリックして起動
3. Cursor でこのフォルダを開く

→ 修正済みコードがそのまま使える。

---

## オプションB: 修正済みプロジェクトをデスクトップにコピー

サンドボックスを「本物」として使い続ける場合:

```
エクスプローラーで C:\Users\user\.gemini\antigravity\scratch\boardgame-venue-mvp を開く
→ フォルダ全体を C:\Users\user\Desktop\boardgame-venue-mvp にコピー
→ デスクトップのコピーで start-all.bat を起動
→ Cursor でデスクトップのフォルダを開く
```

これでデスクトップに修正済みの独立したプロジェクトができる。
