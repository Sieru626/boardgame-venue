# Implementation Plan - Phase 9: Old Maid Setup Phase

## Goal
Insert a "Preparation Phase" before the Old Maid game starts. This allows the Host to verify and adjust Player/Spectator roles before cards are dealt.

## User Review Required
> [!NOTE]
> **New Flow**:
> 1.  Host clicks "Start Old Maid".
> 2.  Game Phase becomes `oldmaid`, but Status is `setup`.
> 3.  **Screen**: Displays "Participant Selection".
>     -   List of all users.
>     -   Host can toggle "Play/Spectate".
> 4.  Host clicks "Deal Cards!".
> 5.  Game proceeds to `playing` (Deal -> Auto Discard -> Turn Limit).

## Proposed Changes

### Server (`server/index.js`)
#### [MODIFY] [index.js](file:///server/index.js)
-   **Update `oldmaid_start_game`**:
    -   Payload: `{ confirm: boolean }`.
    -   Logic:
        -   IF `!confirm`:
            -   Reset game state (hands empty).
            -   Set `oldmaid` state: `{ status: 'setup', ... }`.
            -   Set `state.phase = 'oldmaid'`.
            -   Broadcast. (This shows the setup screen).
        -   IF `confirm`:
            -   **Validation**: Check active players (non-spectators) >= 2.
            -   **Deal**: Shuffle & Deal to `!p.isSpectator`.
            -   Set `oldmaid` state: `{ status: 'playing', ... }`.

### Client (`client/app/room/[id]/page.tsx` & `OldMaidView.tsx`)
#### [MODIFY] [page.tsx](file:///client/app/room/[id]/page.tsx)
-   **Start Button**:
    -   Update "Start Old Maid" button to fallback to `oldmaid_start_game` (no args -> Setup).

#### [MODIFY] [OldMaidView.tsx](file:///client/app/components/OldMaidView.tsx)
-   **Setup Screen**:
    -   Render when `oldMaid.status === 'setup'`.
    -   **UI**:
        -   Title: "準備中 (Preparation)".
        -   List of Players:
            -   Name + [Participating/Spectating] Toggle (Host only).
        -   "Start Game" Button (Host only). -> Emits `oldmaid_start_game` with `{ confirm: true }`.

## Verification Plan
1.  **Setup Flow**:
    -   Host starts Old Maid.
    -   Verify "Preparation" screen appears.
    -   Toggle a user to Spectator.
    -   Click Start.
    -   Verify cards are dealt ONLY to Participants.
    -   Verify Spectator has no cards and sees the game.
