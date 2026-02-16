# 🚨 Current Issues & Tasks (2026/02/16 Updated)

## Priority S: Critical (Blocker)

- **Syntax Error in Build:**
  - File: `client/app/components/UnifiedTable.tsx` (Bottom of file)
  - Error: `Expected ',', got '<eof>'`
  - Status: Currently blocking deployment. Needs immediate fix (closing brackets missing).

## Priority A: Major Bugs

- **MixJuice Turn Loop:**
  - Symptom: Server rejects actions with "Not your turn" loop in 2+ player games.
  - Cause: Race condition in `turnSeat` vs `players` synchronization. Suspect `p.status === 'online'` filter excludes some players from `activePlayers`, so `turnSeat` gets repaired to a subset and other players never get their turn.
  - Reference: See `docs/ボドゲ　ミックスジュース.txt` for correct turn rules.

## Priority B: UI/UX

- **Mobile Layout:** Buttons are too small on smartphone. Needs `v0` redesign.

---

## For AI Handover

- **Rules (Source of Truth):** All game rules live in `docs/`. Do not rely on chat history.
- **Env:** Copy `.env.example` to `.env` and fill in values (see root).
- **First steps:** Fix Priority S (UnifiedTable syntax if still present), then Priority A (MixJuice turn logic using rules in `docs/ボドゲ　ミックスジュース.txt`).
