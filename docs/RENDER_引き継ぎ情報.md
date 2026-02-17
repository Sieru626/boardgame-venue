# Render 本番デプロイ 引き継ぎ情報

## 本番環境

| 項目 | 値 |
|------|-----|
| **URL** | https://boardgame-venue.onrender.com/ |
| **リポジトリ** | https://github.com/Sieru626/boardgame-venue |
| **ブランチ** | **main** |
| **サービス名** | boardgame-venue |

---

## 自動デプロイの仕組み

1. **main に push** → Render が検知して自動でビルド・デプロイ
2. デプロイ完了まで **約5〜10分**（無料プランはビルドに時間がかかる場合あり）

---

## 重要: Render が render.yaml を無視する場合

Render ダッシュボードで **Build Command** が手動設定されていると、render.yaml の buildCommand が**上書き**されます。  
その場合、以下を Dashboard で設定してください：

**Build Command** を次に変更：
```
bash ../build.sh
```

（リポジトリの `build.sh` が正しい .next-venue コピーを行います）

---

## デプロイが反映されない場合の確認

### 1. Render ダッシュボードで確認

1. [Render Dashboard](https://dashboard.render.com/) にログイン（**Render 日本版**も同じ https://dashboard.render.com）
2. **boardgame-venue** サービスをクリック
3. 以下を確認：

| 確認項目 | 期待値 |
|----------|--------|
| **Branch** | `main` に設定されているか |
| **Auto-Deploy** | **Yes** になっているか |
| **Latest Deploy** | 直近の push 後に新しいデプロイが走っているか |

### 2. Auto-Deploy が No の場合

- **Settings** → **Build & Deploy** → **Auto-Deploy** を **Yes** に変更

### 3. 手動デプロイで即時反映

- **Manual Deploy** ボタン → **Deploy latest commit** をクリック
- これで main の最新コミットを強制的にデプロイ

### 4. ビルド失敗の確認

- **Logs** タブ → **Build log** を開く
- エラーが出ている場合はログ末尾を確認

### 5. 環境変数の確認

- **Environment** タブで以下が正しく設定されているか：
  - `NEXT_PUBLIC_SOCKET_URL` = `https://boardgame-venue.onrender.com`
  - `DATABASE_URL`（Render が自動設定する場合あり）
  - `GEMINI_API_KEY`（AI機能を使う場合）

---

## ローカルから本番へ反映する手順

```bash
cd C:\Users\user\.gemini\antigravity\scratch\boardgame-venue-mvp

# 変更をコミット
git add .
git commit -m "説明メッセージ"

# main に push（これで Render が自動デプロイ）
git push origin main
```

---

## デプロイ反映の確認方法

- トップページに表示されるバージョン（例: **v8.1 (CPU1/2/3・神経衰弱Bot)**）で確認
- ブラウザの強制リロード（Ctrl+Shift+R）でキャッシュをクリアしてから確認
