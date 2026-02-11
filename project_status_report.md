# ボードゲーム会場 MVP (Board Game Venue MVP) - 現在のステータス

## 1. プロジェクト概要
オンラインでボードゲームを遊ぶためのプラットフォーム。
「テーブルトップモード（自由操作）」をベースに、「ババ抜き（Old Maid）」や「神経衰弱（Memory）」などの自動化されたゲームモードもサポートする。

## 2. 技術スタック (Tech Stack)
- **Repo**: Monorepo (Turborepo)
- **Frontend**: Next.js 14+ (App Router), Tailwind CSS, Socket.IO Client
- **Backend**: Node.js (Express), Socket.IO Server, Prisma (SQLite)
- **Language**: TypeScript throughout
- **State Definition**: Server-authoritative state synced via WebSocket (`state_update` events).

## 3. デプロイメント (Deployment)
- **Method**: Infrastructure as Code (IaC) via `render.yaml`.
- **Platform**: Render (Web Service + Managed PostgreSQL).
- **Configuration**:
    - **Blueprint**: `render.yaml` defines the environment.
    - **Build**: Client build (`next build`) + Server install (`npm install`) + Prisma generate.
    - **Start**: `npm run start:render` (includes `db:push` with --accept-data-loss)
    - **Env**: `NODE_ENV=production`, `DATABASE_URL` auto-linked.

## 3. 実装済み機能 (Features)

### コアシステム
- **ルーム管理**: ルーム作成、参加（ニックネーム指定）、招待リンク対応。
- **プレイヤー管理**: ホスト権限、観戦モード（Hostによる切り替え、Setup中の自己切り替え）。
- **ステート管理**: ゲームの状態（カード位置、スコア、フェーズ）をJSONでDBに保存し、差分をクライアントに同期。

### ゲームモード
1.  **Tabletop Mode (テーブルトップ)**
    *   物理的なカードゲームのように、カードを自由にドラッグ＆ドロップ可能。
    *   山札からのドロー、手札の管理、場へのプレイ。
    *   デッキ編集機能（JSON形式での保存・読み込み）。

2.  **Old Maid (ババ抜き)**
    *   ゲーム開始時に自動配布・ペア破棄。
    *   ターン制による「隣の人から引く」アクションの実装。
    *   勝利/敗北判定。他人手札のマスキング（裏面表示）。

3.  **Memory (神経衰弱)**
    *   **New!** 4x4グリッド（16枚/8ペア）の自動生成。
    *   ターン制のカードめくりアクション。
    *   マッチ判定（スコア加算）とミスマッチ時のペナルティ（1秒ウェイト）。
    *   ゲーム終了判定（全ペア成立）。

### ライブラリ・管理機能
- **Game Library**:
    *   ゲーム設定（モード、デッキ、ルール）をテンプレートとして保存・適用可能。
    *   ホスト専用の「削除」機能（API実装済み）。
    *   重複テンプレートのクリーンアップ対応済み。
- **UI/UX**:
    *   モードに応じたビューの自動切り替え (`UnifiedTable`)。
    *   チャットログ機能。

## 4. 最新の変更点 (Recent Changes)
- **バグ修正**: `Card.tsx` で発生していた `TypeError` (カード名の未定義エラー) を修正。`MemoryGameView` から適切なプロパティを渡すように変更。
- **リファクタリング**: サーバーサイド (`server/index.js`) の重複コードを削除し、メンテナンス性を向上。
- **機能追加**: ゲームライブラリに削除ボタンを追加 (`DELETE /api/games/:id`)。
- **インフラ (Infrastructure)**: `render.yaml` を導入。Client/Serverのビルドプロセスを統合し、`start:render` でのDBスキーマ同期を自動化。

## 5. ディレクトリ構造 (Key Files)
- `apps/web`: Next.js フロントエンド
    - `components/UnifiedTable.tsx`: メインのゲーム画面（モード分岐）。
    - `components/MemoryGameView.tsx`: 神経衰弱専用ビュー。
    - `components/GameLibrary.tsx`: ゲーム設定の保存・読み込み・削除。
- `apps/api`: Express サーバー
    - `server/index.js`: WebSocketハンドラ、APIエンドポイント、ゲームロジック（`start_game`, `memory_flip` 等）。
- `packages/database`: Prisma schema (`Game`, `Room`, `GameTemplate`).

## 6. 直近の対応と課題 (Current Status & Issues)
- **対応済み**:
    - ゲームライブラリの自動復旧ロジックを修正。
    - 「ババ抜き」「神経衰弱」もライブラリに表示されるように `server/index.js` を更新。
- **現在の課題**:
    - 本番環境 (Render) で変更が反映されていない（デプロイ待ちの可能性大）。
- **次のアクション**:
    - コードの変更を GitHub にプッシュし、Render へのデプロイを完了させる。
    - ゲームライブラリから「ババ抜き」「神経衰弱」が選択できるか確認する。
