# BoardGame Venue: Project Status & Technical Context

## 1. 目的（何を実現したいか）

「BoardGame Venue（ボドゲテスト会場）」の構築。
オンラインで多様なカードゲーム・ボードゲームをテストプレイし、ルールやデッキをプレイ後に修正して即リマッチできる**"検証特化"**の環境を作る。
将来的に AI（Gemini）を活用したルール/デッキ生成や、AI GM（裁定・提案）を視野に入れている。

## 2. 現在のフェーズ

**Phase 2.5: 実践テスト検証＆バグ修正（現在進行中）**

- **完了:** 「ディストピア家族会議」の実装。検証サイクル（編集→即リマッチ）の成立。
- **現在:** 「ミックスジュース」のバグ修正（ターン無限ループ対応）およびデプロイ復旧（Syntax Error修正）。
- **次:** スマホUI最適化、AI GMプロトタイプ。

## 3. 実装済み機能 (Done)

### 3.1 エンジン/通信/基盤

- ルーム作成・参加、Socket.io によるリアルタイム同期
- サーバー再接続リカバリ（復帰フロー）
- タイマー同期修正（クライアント側の再描画/依存関係を調整済み）

### 3.2 ゲームモード

- **FreeTalk（ディストピア家族会議）:** シーン/条例カードヘッダー、密告アクション、勲章トラッキング実装済み。
- **MixJuice（ミックスジュース）:** 実装中。チェンジ/冷蔵庫シャッフルなどの基本アクションあり（※バグ修正待ち）。
- **Others:** Memory（神経衰弱）、OldMaid（ババ抜き）、TurnBased基盤。

### 3.3 技術スタック

- **Client:** Next.js 15 (App Router), TailwindCSS
- **Server:** Node.js (Express, Socket.io)
- **DB:** SQLite + Prisma
- **AI:** Google GenAI SDK (@google/genai) 導入済み

## 4. 開発運用・環境変数

- **起動手順:** ルート直下の `start-all.bat` を実行（推奨）。
- **Env:**
  - Server: `.env` (PORT=3010, GEMINI_API_KEY 等)
  - Client: Port 3000 (稀に 3001 fallback 問題あり)

## 5. 技術的負債・既知の課題 (Technical Debt)

### 5.1 Port Instability (3000/3001問題)

- **現象:** Client が稀に 3001 で立ち上がり、Server(3010) との CORS 設定と整合せず通信エラーになる。
- **方針:** `start-all.bat` でポートを固定化しているが、環境によってはゾンビプロセスに注意。

### 5.2 Collision / Race Condition (MixJuice Turn Loop)

- **現象:** 同時操作や再接続時に排他制御が甘く、ステート（`turnSeat`）の整合性が崩れる。
- **方針:** サーバー権威でのステート自動修復ロジック（Auto-Repair）を実装して対応する。

## 6. 重要ファイル・領域

- `server/index.js` (および Socket ハンドラ): ゲームステート管理の中枢。変更時は全モードへの影響確認が必須。
- `client/app/components/Card.tsx`: 全モード共通のカード描画コンポーネント。
- `docs/*.txt`: ゲームルールの正解データ（原典）。

---

## 7. 開発における絶対ルール (引き継ぎ用)

- **原典への忠誠:** ゲームルールの正解は `docs/` 内のテキスト（例: `ボドゲ　ミックスジュース.txt`）にある。
- **動くことが正義:** まず Syntax Error 解消とデプロイ復旧を最優先にする。
- **AI を見据えた設計:** 状態管理（State）は明確に構造化し、将来の AI GM / CPU がログを読める形にする。

---

*(Source: BoardGameVenue_status_for_Notebook.docx / 2026-02 Updated)*
