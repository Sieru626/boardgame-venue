# BoardGame Venue：プロジェクト憲章（修正版）

## 1. サイトの核心的コンセプト (Core Concept)

**「AIと共に、まだ見ぬボードゲームを生み出す実験室（Laboratory）」**

このサイトは、単に既存のゲームを遊ぶ場所ではない。
ボードゲーム製作者（ユーザー）が、**「Dealer AI（相談役）」**や**「CPU（対戦相手）」**の手を借りて、ルールやデッキ構成をその場で試行錯誤し、検証できる**クリエイター支援プラットフォーム**である。

- **Target:** 自作ボードゲームを作りたいクリエイター、およびそのテスター。
- **Future Vision:**
  - **Dealer AI:** 「このカード強すぎない？」といったバランス相談や、ルールの自動生成・裁定を行うAI GM。
  - **CPU:** 人が集まらなくてもテストプレイができるAI対戦相手。
  - **Playground Creation:** AIと一緒にデッキやカードセットを即座に生成する機能。

## 2. 現在のフェーズと実装済みゲーム (Current Phase)

### Phase 2.5: 基本機能の安定化（Foundation）

AI機能を載せる前に、まずは**「人間同士がバグなく快適に遊べる土台」**を完成させる段階。

#### A. ディストピア家族会議 (#FreeTalk)

- **ステータス:** ✅ 実装完了
- **内容:** 正体隠匿・大喜利系。ログと会話が主体のゲーム。
- **ルール原典:** `docs/ディストピア家族会議.txt`

#### B. ミックスジュース (MixJuice)

- **ステータス:** ⚠️ 致命的バグ修正中
- **内容:** セットコレクション・数値計算（足して7以上）。
- **ルール原典:** `docs/ボドゲ　ミックスジュース.txt`
- **課題:**
  - 2人以上でのプレイ時にターンが回らない（無限ループバグ）。
  - Syntax Error によりデプロイが停止する可能性（`UnifiedTable.tsx`）。

## 3. 開発における絶対ルール (The Iron Rules)

1. **AI導入を見据えた設計 (Ready for AI-GM):**
   - 将来、Dealer AIがゲームログを読んで裁定したり、CPUがアクションを選んだりできるように、状態管理（State）は明確に構造化しておくこと。
2. **原典への忠誠 (Source of Truth):**
   - ゲームルールの正解は `docs/` 内のテキストファイル（例: `ボドゲ　ミックスジュース.txt`）にある。
3. **動くことが正義 (Running Code First):**
   - まずは Syntax Error を直し、Render で動く状態に復旧させることが先決。

## 4. 技術スタック

- **Client:** Next.js (React), Socket.IO client, Tailwind CSS
- **Server:** Node.js, Express, Socket.IO, Prisma (SQLite / PostgreSQL)
- **Deploy:** Render 等を想定（`render.yaml` 参照）

## 5. 環境構築

- ルートの `.env.example` をコピーして `.env` を作成し、必要な値を設定する。
- `docs/current_issues.md` に現在の優先課題を記載。引き継ぎ時はここを最優先で確認すること。
