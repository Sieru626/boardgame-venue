# Board Game Venue MVP - Project Context

## Overview
This is an MVP for an online board game test-play venue. It allows users to create rooms, share a table, manipulate cards/dice, and chat in real-time.

## Tech Stack
- **Frontend**: Next.js (App Router), React, TailwindCSS, Socket.io-client
- **Backend**: Node.js, Express, Socket.io, Prisma, SQLite
- **Database**: SQLite (via Prisma)

## Directory Structure
- `client/`: Next.js frontend application
- `server/`: Express + Socket.io backend server
- `server/prisma/`: Database schema and migrations

## Key Files

### 1. Database Schema (`server/prisma/schema.prisma`)
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Room {
  id          String   @id
  adminId     String
  name        String
  maxPlayers  Int      @default(4)
  isSetupMode Boolean  @default(true)
  rules       String   @default("")
  
  // Game State JSON (deck, table, lastAction, activePlayerIndex, timer)
  gameState   String   @default("{}") 
  chatHistory String   @default("[]")

  players     Player[]
  
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())
}

model Player {
  id        String   @id
  nickname  String
  
  roomId    String
  room      Room     @relation(fields: [roomId], references: [id], onDelete: Cascade)
  
  hand      String   @default("[]") // JSON string

  createdAt DateTime @default(now())
}
```

### 2. Backend Logic (`server/index.js`)
```javascript
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

console.log("DB URL:", process.env.DATABASE_URL); // Debug

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all for MVP simplicity
        methods: ["GET", "POST"]
    }
});

// Helper to format room for client
function formatRoom(room) {
    if (!room) return null;
    return {
        ...room,
        gameState: JSON.parse(room.gameState || '{}'),
        chat: JSON.parse(room.chatHistory || '[]'),
        chatHistory: undefined // hide raw string
    };
}

// Ensure game state structure
function ensureGameState(gameStateStr) {
    const state = JSON.parse(gameStateStr || '{}');
    if (!state.deck) state.deck = [];
    if (!state.table) state.table = [];
    if (!state.activePlayerIndex) state.activePlayerIndex = 0;
    if (!state.timer) state.timer = { endTime: null, duration: 0, isRunning: false };
    return state;
}

// Helper to generate a simple deck
function generateDeck() {
    const deck = [];
    for (let i = 1; i <= 20; i++) {
        deck.push(`Card #${i}`);
    }
    return deck;
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // List Rooms
    socket.on('get_rooms', async (callback) => {
        try {
            const rooms = await prisma.room.findMany({
                include: { players: true }
            });
            const roomList = rooms.map(r => ({
                id: r.id,
                name: r.name,
                currentPlayers: r.players.length,
                maxPlayers: r.maxPlayers
            }));
            callback(roomList);
        } catch (e) {
            console.error(e);
            callback([]);
        }
    });

    // Create Room
    socket.on('create_room', async ({ name, maxPlayers, nickname, userId }, callback) => {
        try {
            const roomId = Math.random().toString(36).substring(2, 8);
            const gameState = {
                deck: generateDeck(),
                lastAction: null,
                table: [],
                activePlayerIndex: 0,
                timer: { endTime: null, duration: 0, isRunning: false }
            };

            const room = await prisma.room.create({
                data: {
                    id: roomId,
                    adminId: userId,
                    name: name || `ルーム ${roomId}`,
                    maxPlayers: maxPlayers || 4,
                    gameState: JSON.stringify(gameState),
                    chatHistory: JSON.stringify([])
                }
            });

            callback({ roomId });
        } catch (e) {
            console.error(e);
            callback({ error: '作成に失敗しました' });
        }
    });

    // Join Room
    socket.on('join_room', async ({ roomId, nickname, userId }, callback) => {
        try {
            let room = await prisma.room.findUnique({
                where: { id: roomId },
                include: { players: true }
            });

            if (!room) {
                return callback({ error: 'ルームが見つかりません' });
            }

            // Check if player exists
            let player = await prisma.player.findUnique({ where: { id: userId } });
            
            if (player) {
                // Update nickname if changed
                if (player.nickname !== nickname) {
                    player = await prisma.player.update({
                        where: { id: userId },
                        data: { nickname }
                    });
                }
                
                if (player.roomId !== roomId) {
                    if (room.players.length >= room.maxPlayers) return callback({ error: 'ルームは満員です' });
                    await prisma.player.update({
                        where: { id: userId },
                        data: { roomId }
                    });
                }
            } else {
                // New player
                if (room.players.length >= room.maxPlayers) return callback({ error: 'ルームは満員です' });
                player = await prisma.player.create({
                    data: {
                        id: userId,
                        nickname,
                        roomId
                    }
                });
                
                // Add join message
                const chat = JSON.parse(room.chatHistory);
                chat.push({ sender: 'System', message: `${nickname} が入室しました。`, timestamp: Date.now() });
                await prisma.room.update({
                    where: { id: roomId },
                    data: { chatHistory: JSON.stringify(chat) }
                });
            }

            socket.join(roomId);

            // Refetch room with updated players
            room = await prisma.room.findUnique({
                 where: { id: roomId },
                 include: { players: true }
            });
            
            // Allow hand parsing
            room.players = room.players.map(p => ({
                ...p,
                hand: JSON.parse(p.hand || '[]')
            }));

            const formattedRoom = formatRoom(room);
            io.to(roomId).emit('room_update', formattedRoom);
            callback({ success: true, room: formattedRoom });
            
        } catch (e) {
            console.error(e);
            callback({ error: '入室エラー' });
        }
    });

    // Chat
    socket.on('send_message', async ({ roomId, message, userId }) => {
        try {
            const room = await prisma.room.findUnique({ where: { id: roomId } });
            if (!room) return;

            const player = await prisma.player.findUnique({ where: { id: userId } });
            const sender = player ? player.nickname : 'Unknown';
            const chatMsg = { sender, message, timestamp: Date.now() };
            
            const chat = JSON.parse(room.chatHistory);
            chat.push(chatMsg);
            
            await prisma.room.update({
                where: { id: roomId },
                data: { chatHistory: JSON.stringify(chat) }
            });

            io.to(roomId).emit('chat_message', chatMsg);
        } catch (e) { console.error(e); }
    });

    // Roll Dice
    socket.on('roll_dice', async ({ roomId, sides, userId }) => {
        try {
            const room = await prisma.room.findUnique({ where: { id: roomId } });
            if (!room || room.isSetupMode) return;

            const player = await prisma.player.findUnique({ where: { id: userId } });
            const diceSides = sides || 6;
            const value = Math.floor(Math.random() * diceSides) + 1;
            
            const result = {
                player: player ? player.nickname : 'Unknown',
                value,
                type: 'dice',
                sides: diceSides
            };

            // Update lastAction
            const gameState = ensureGameState(room.gameState);
            gameState.lastAction = result; 
            
            const chat = JSON.parse(room.chatHistory);
            chat.push({ sender: 'System', message: `${result.player} が ${diceSides}面サイコロで ${value} を出しました`, timestamp: Date.now() });

            await prisma.room.update({
                where: { id: roomId },
                data: { 
                    gameState: JSON.stringify(gameState),
                    chatHistory: JSON.stringify(chat)
                }
            });

            io.to(roomId).emit('game_action', result);
            io.to(roomId).emit('chat_message', chat[chat.length-1]);
        } catch (e) { console.error(e); }
    });

    // Reset Game
    socket.on('reset_game', async ({ roomId, deckConfig, userId }) => {
        try {
            const room = await prisma.room.findUnique({ where: { id: roomId } });
            if (!room || room.adminId !== userId) return;

            let newDeck = [];
            if (deckConfig.type === 'custom') {
                newDeck = deckConfig.customValues || [];
            } else {
                const count = deckConfig.count || 20;
                for (let i = 1; i <= count; i++) {
                    newDeck.push(`Card #${i}`);
                }
            }

            const gameState = ensureGameState(room.gameState);
            gameState.deck = newDeck;
            gameState.lastAction = null;
            gameState.table = [];
            
            const chat = JSON.parse(room.chatHistory);
            chat.push({ sender: 'System', message: 'ホストがゲームをリセット・デッキを再構成しました。', timestamp: Date.now() });

            await prisma.room.update({
                where: { id: roomId },
                data: { 
                    gameState: JSON.stringify(gameState),
                    chatHistory: JSON.stringify(chat)
                }
            });

            // Reset all players in this room
            await prisma.player.updateMany({
                where: { roomId },
                data: { hand: JSON.stringify([]) }
            });

            const updatedRoom = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
            updatedRoom.players = updatedRoom.players.map(p => ({ ...p, hand: [] }));

            io.to(roomId).emit('room_update', formatRoom(updatedRoom));
            io.to(roomId).emit('game_reset', { deckCount: newDeck.length });
            io.to(roomId).emit('chat_message', chat[chat.length-1]);
        } catch (e) { console.error(e); }
    });

    // Toggle Setup Mode
    socket.on('toggle_setup_mode', async ({ roomId, isSetupMode, userId }) => {
        try {
            const room = await prisma.room.findUnique({ where: { id: roomId }, include: { players: true } });
            if (!room || room.adminId !== userId) return;

            const chat = JSON.parse(room.chatHistory);
            const msg = isSetupMode ? '準備モードになりました（操作停止）' : 'ゲームスタート！';
            chat.push({ sender: 'System', message: msg, timestamp: Date.now() });

            const updated = await prisma.room.update({
                where: { id: roomId },
                data: { 
                    isSetupMode,
                    chatHistory: JSON.stringify(chat)
                },
                include: { players: true }
            });

            updated.players = updated.players.map(p => ({...p, hand: JSON.parse(p.hand || '[]')}));

            io.to(roomId).emit('room_update', formatRoom(updated));
            io.to(roomId).emit('chat_message', chat[chat.length-1]);
        } catch (e) { console.error(e); }
    });

    // Timer Events (start/stop) - omitted for brevity (similar pattern)
    // ...

    // Draw Card / Play Card / Pass Turn - omitted for brevity (similar pattern, using ensureGameState & prisma.room.update)
    // ... 
    // (See full source if needed, pattern is consistent)

    // AI Generate
    socket.on('ai_generate_deck', async ({ roomId, rules, apiKey, userId }) => {
         // ... (AI logic with Prisma update) ...
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = 4001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
```

### 3. Frontend Room Page (`client/app/room/[id]/page.tsx`)
```tsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

// ... (Types: Player, ChatMessage, GameAction) ...

export default function RoomPage() {
    // ... (State: room, messages, socket, isConnected, etc.) ...
    
    useEffect(() => {
        // ... (Socket connection logic: connect, join_room, room_update, disconnect handling) ...
    }, [roomId, router]);

    // ... (Handlers: sendMessage, rollDice, resetGame, drawCard, playCard) ...
    
    // ... (Render: Header with status, Players list, Tabletop area, Control panel) ...
}
```
