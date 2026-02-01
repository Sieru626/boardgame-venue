# Tasks

## Phase 1: Production Environment (Priority: Creating "Making" Environment)
Goal: "Create -> Save -> Apply -> Test -> Fix" cycle should be fast.
- [x] **Data Model & Backend**
    - [x] DB: Update `GameTemplate` schema (type: `turn_based` | `free_talk` | `round_score`, ruleConfig).
    - [x] Server: Logic to auto-generate "Rule Cards" (Summary, Prep, Turn, Win, Ban/Exception, Terms).
    - [x] Server: API/Socket updates for handling structured rule data.
- [x] **Frontend: Rule Profile Editor**
    - [x] UI: Form for selecting game type and filling rule blanks (Short text inputs).
    - [x] UI: Preview generated Rule Cards.
- [x] **Frontend: Review & Play Experience**
    - [x] UI: Right Tab "📘 Rules" (Search + Pinning max 3).
    - [x] UI: Card Dictionary (Click card -> View Effect/Tags details).
- [x] **Verification**
    - [x] Verify creating a game (e.g., Simple free_talk) saves correctly.
    - [x] Verify applying the game loads Rule Cards into the "Rules" tab.

## Phase 1.5: UI Renovation & Localization
Goal: "Japanese by default" & "Friendly UI".
- [x] **Server: Localization**
    - [x] Rule Card Generation Text -> Japanese.
- [x] **Client: Localization & UI Polish**
    - [x] `GameLibrary`: "Game Type" labels, hints, and preview text -> Japanese.
    - [x] `RoomPage`: Header buttons, Player status -> Japanese.
    - [x] `UnifiedTable`: "DISCARD PILE", "DRAW", "GET!", "TABLE" -> Japanese / Icons.
- [x] **Client: Layout Fixes**
    - [x] Fix `RightPane` flexbox issue causing invisible rules for guests.
    - [x] Polish padding/spacing in RuleBook.

## Phase 2: Validation Game 1 - Dystopian Family Meeting (free_talk)
Goal: Verify conversation-based game mechanics in a broken venue.
- [ ] **Core Features**
    - [ ] Host Action: Present Scene/Ordinance Cards.
    - [ ] Action: Inform/Betray (Log + Result).
    - [ ] State: Medal/Score management + Victory determination.
    - [ ] UI: Rule Card reference is the main UI interaction.
- [ ] **Verification**
    - [/] Play a full cycle with Spectators.

## Phase 3: Validation Game 2 - Mix Juice (round_score)
Goal: Verify Score-based + High Effect volume.
- [ ] **3-1: Simplified Version**
    - [ ] Basic Loop: Turn -> Round -> Score -> End.
    - [ ] Limited Special Effects.
- [ ] **3-2: Complete Version**
    - [ ] Full Effects/Exceptions/Defense.
    - [ ] Visual Logs of "What happened".

## Phase 4: External Release (No Registration)
Goal: URL sharing for online play.
- [ ] Deployment (Next.js + API + Socket).
- [ ] DB Migration (SQLite -> Postgres).
- [ ] Room Lifecycle (Anonymous ID + Invite Links).

## Phase 5: Browser Registration (Value Add)
Goal: "Save my shelf".
- [ ] Auth: Link "My Shelf" (templates) to account.
- [ ] Features: Public/Private, History, Favorites.

## Phase 6: CPU (Optional)
Goal: Bots for simple games.
- [ ] Simple Bots (Memory/Old Maid).
- [ ] Expansion to Score-based.
