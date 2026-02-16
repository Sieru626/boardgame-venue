# 本番デプロイ（Render）— Render だけ操作する

## 普段やること（あなたが触るのはここだけ）

- コードを直したら **GitHub の `main` に push** するだけ。
- **Render の画面は開かなくてよい。**  
  → Auto-Deploy がオンなら、push のあと自動でデプロイされる。

「デプロイ」のために押すボタンは **Render にはない**。**Git に push するだけ**で本番が更新されます。

---

## 初回だけ（Render の用意・一度だけ）

まだ Render にサービスがない場合:

1. [Render](https://render.com) にログインする。
2. **「New +」→「Blueprint」** を選ぶ。
3. リポジトリ **Sieru626/boardgame-venue** を接続する（GitHub 連携で選択）。
4. Render が **render.yaml** を読んでサービスを作成するので、そのまま **「Apply」** する。
5. 作成されたサービス **boardgame-venue** の **Settings** を開く。
6. **Build & Deploy** の **Auto-Deploy** を **Yes** にする（これで `main` に push するたびに自動デプロイ）。
7. サービス名が `boardgame-venue` 以外なら、**Environment** で  
   `NEXT_PUBLIC_SOCKET_URL` を **自分のサービスの URL**（例: `https://自分のサービス名.onrender.com`）に変更する。
8. 必要なら **GEMINI_API_KEY** などを **Environment** に追加する。

以降は **GitHub に push するだけ**。Render は開かなくてOKです。

---

## 失敗したときの確認

- **Build がこける**  
  → Render の **Logs** タブで **Build log** の最後のエラー行を確認。
- **起動しない / 接続できない**  
  → **Environment** の `NEXT_PUBLIC_SOCKET_URL` が **本番の URL**（`https://〜.onrender.com`）になっているか確認。
- **DB エラー**  
  → 無料プランではスピンダウンで DB がリセットされることがあります。必要なら **Manual Deploy** で再デプロイ。

---

## 手動でデプロイしたい場合だけ

「いまのコミットじゃなく、前のコミットでデプロイし直したい」など、**Render の画面だけ**でやりたいとき:

- Render のサービス **boardgame-venue** を開く → **「Manual Deploy」→「Deploy latest commit」**（または特定のコミットを選択）でOK。
