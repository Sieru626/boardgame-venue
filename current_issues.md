# Current Issues & Technical Limitations

## 1. Environment & Access
- **Port Instability**: The frontend usually runs on port 3000, but sometimes falls back to 3001 (currently 3001), causing "Site not found" confusion.
- **Local Database**: Persistence uses SQLite (`dev.db`). This works great locally but will **reset** on platforms like Vercel/Heroku unless persistent volumes are configured.

## 2. User Identity & Security
- **No Authentication**: Users are identified solely by a UUID in `localStorage`.
    - *Problem*: If a user clears cookies or switches browsers, they verify as a new player and lose their hand.
- **No Room Passwords**: Anyone can join a room if they see it in the list.
- **Admin Rights**: Based on `userId`. Weak security model.

## 3. Game Logic (MVP Limitations)
- **Turn Enforcement**: While there is a "Turn" indicator, the server does not strictly block actions out of turn (designed for flexibility, but potential for griefing).
- **Concurrency**: Race conditions possible if multiple users grab the same card simultaneously (Collision handling is optimistic).

## 4. Codebase
- **Prisma Version**: Forced to downgrade to v5 due to v7 compatibility issues with `prisma.config.ts`.
- **Type Safety**: `any` types used in some Socket payloads (e.g. `room`, `socket` states).
- **Error Handling**: mostly `console.error` logs, user sees generic alerts mostly.

## Recently Resolved
- **Data Persistence**: Server restarts no longer erase game data.
- **Connection Feedback**: Added "CONNECTION LOST" indicator to UI.
- **Deck Editor**: Fixed blank card list when loading "Distopia Family Meeting" (Added server-side deckJson parsing).
- **Memory Game**: Fixed empty deck issue by adding default generation logic for 'memory' mode.
