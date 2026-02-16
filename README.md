# ボードゲーム会場 MVP ガイド

**GitHub 完全再現**: [Sieru626/boardgame-venue](https://github.com/Sieru626/boardgame-venue) と同じ構成です。  
**重要: ローカルは http://localhost:3010 のみ使用します。3000 は成立たせ屋本舗で使用するため使用しません。**

- **本番デプロイ（Render）**: [docs/DEPLOY.md](docs/DEPLOY.md) — **main に push するだけ**（Render は初回設定のみ）。

## 起動手順

1. **初回のみ**: `server\.env` と `client\.env.local` があること。
   - `server\.env` はルートの `.env.example` を server 用にコピーし、`PORT=3010` と `DATABASE_URL="file:./prisma/dev.db"` を設定。
   - `client\.env.local` に **必ず** 次の1行を入れる（ないと「ずっと読み込み」になります）:
     ```
     NEXT_PUBLIC_SOCKET_URL=http://localhost:3010
     ```
   - DB 初期化: `cd server` のあと `npx prisma db push`
2. **`start-all.bat`** をダブルクリックする。
3. サーバー (Port **3010**) が立ち上がり、API と画面の両方を **3010** で提供します。ブラウザで **http://localhost:3010** を開いてください。
4. 表示されない場合は手動で **http://localhost:3010** にアクセスしてください。

## 使い方

1. **トップページ**: ニックネームを入力して「Create Room」をクリック。
2. **ルーム画面**: 同じ PC で別ブラウザ or シークレットウィンドウで同じ URL を開くと 2 人目として参加できる。ゲーム選択 → 開始でミックスジュースなどが遊べる。

## 復旧・トラブルシューティング

- **ずっと読み込んで入れない**
  - `client\.env.local` に `NEXT_PUBLIC_SOCKET_URL=http://localhost:3010` があるか確認してください。
- **起動しない場合**
  - 開いている黒い画面（コマンドプロンプト）を全て閉じてから、再度 `start-all.bat` を実行してください。
- **ログ確認**
  - 「BoardGame Venue」ウィンドウ 1 つで API + Web (3010) が動いています。

## 開発情報

- ソース: [GitHub - Sieru626/boardgame-venue](https://github.com/Sieru626/boardgame-venue)
- ローカル: **http://localhost:3010 のみ**（API + Next 同一プロセス）。3000 は使用しない（成立たせ屋本舗とポート被り防止）。
