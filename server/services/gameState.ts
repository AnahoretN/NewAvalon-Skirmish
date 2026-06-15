/**
 * @file Game state management service
 */

import { logger } from '../utils/logger.js';
import { CONFIG } from '../utils/config.js';
import { validateGameStateSize } from '../utils/security.js';
import type { WebSocket } from 'ws';
import { gameTerminationTimers, gameInactivityTimers, playerDisconnectTimers } from './gameLifecycle.js';

// Type definitions
interface Player {
  id: number;
  name: string;
  deck?: any[];
  discard?: any[];
  announcedCard?: any;
  isDummy?: boolean;
  isConnected?: boolean;
  score?: number;
  color?: string;
  [key: string]: any;
}

interface Cell {
  card: any | null;
}

type Board = Cell[][];

type GridSize = 4 | 5 | 6 | 7;

interface GameState {
  id: string;
  players: Player[];
  board: Board;
  isGameStarted: boolean;
  activePlayerId: number | null;
  currentPhase: number;
  turnNumber: number;
  currentRound: number;
  isPrivate: boolean;
  gameMode: string;
  activeGridSize: GridSize;
  isReadyCheckActive: boolean;
  created: number;
  lastActivity: number;
  // Visual effects (synced across all clients)
  floatingTexts: any[];
  highlights: any[];
  [key: string]: any;
}

interface GameOptions {
  isPrivate?: boolean;
  gameMode?: string;
  [key: string]: any;
}

// In-memory storage for game states
const gameStates = new Map<string, GameState>();
const clientGameMap = new Map<WebSocket, string>();
const gameLogs = new Map<string, string[]>();

/**
 * Create new game state
 */
export function createGameState(gameId: string, options: GameOptions = {}): GameState {
  const gameState: GameState = {
    id: gameId,
    players: [],
    spectators: [],
    board: Array(7).fill(null).map(() => Array(7).fill(null).map(() => ({ card: null }))),
    isGameStarted: false,
    activePlayerId: null,
    currentPhase: 0,
    turnNumber: 1,
    currentRound: 1,
    isPrivate: (options && options.isPrivate) || false,
    gameMode: (options && options.gameMode) || 'skirmish',
    activeGridSize: 4,
    isReadyCheckActive: false,
    isMulliganActive: false,
    isRoundTransitionMulligan: false,
    mulliganCompletePlayers: [],
    created: Date.now(),
    lastActivity: Date.now(),
    hostId: 1, // First player (creator) is initially the host
    // Game-level auto flags: authoritative server flags for auto-transitions
    // These control server-side behavior, while client-side localStorage stores UI preferences
    // autoAbilitiesEnabled: if true, server triggers auto-transitions between phases
    // autoDrawEnabled: if true, server auto-draws cards for players on their turn
    // preserveDeployAbilities: if true, deploy abilities remain available after Setup→Main transition
    autoAbilitiesEnabled: true,
    autoDrawEnabled: true,
    preserveDeployAbilities: false,
    // Round end tracking
    roundEndTriggered: false,
    isRoundEndModalOpen: false,
    // Visual effects (synced across all clients)
    floatingTexts: [],
    highlights: [],
    // Server-side auto-draw tracking
    autoDrawnPlayers: [],
    ...options
  };

  gameStates.set(gameId, gameState);
  gameLogs.set(gameId, []);

  logger.info(`Created game ${gameId}`);
  return gameState;
}

/**
 * Get game state by ID
 */
export function getGameState(gameId: string): GameState | undefined {
  return gameStates.get(gameId);
}

/**
 * Update game state
 */
export function updateGameState(gameId: string, updates: Partial<GameState>): GameState {
  const gameState = gameStates.get(gameId);
  if (!gameState) {
    throw new Error(`Game ${gameId} not found`);
  }

  const updatedState = { ...gameState, ...updates, lastActivity: Date.now() };

  if (!validateGameStateSize(updatedState)) {
    throw new Error('Game state size exceeds limit');
  }

  gameStates.set(gameId, updatedState);
  return updatedState;
}

/**
 * Delete game state
 */
export function deleteGameState(gameId: string): void {
  const gameState = gameStates.get(gameId);
  if (gameState) {
    // Clear all timers
    clearGameTimers(gameId);

    gameStates.delete(gameId);
    gameLogs.delete(gameId);

    // Remove client mappings
    for (const [client, clientGameId] of clientGameMap.entries()) {
      if (clientGameId === gameId) {
        clientGameMap.delete(client);
      }
    }

    logger.info(`Deleted game ${gameId}`);
  }
}

/**
 * Add player to game
 */
export function addPlayerToGame(gameId: string, player: Player): Player {
  const gameState = gameStates.get(gameId);
  if (!gameState) {
    throw new Error(`Game ${gameId} not found`);
  }

  if (gameState.players.length >= CONFIG.MAX_PLAYERS) {
    throw new Error('Game is full');
  }

  const existingPlayer = gameState.players.find(p => p.name === player.name);
  if (existingPlayer) {
    throw new Error('Player name already taken');
  }

  // Create new players array instead of mutating
  const newPlayers = [...gameState.players, player];
  updateGameState(gameId, { players: newPlayers });

  logGameAction(gameId, `Player ${player.name} joined`);
  return player;
}

/**
 * Remove player from game
 */
export function removePlayerFromGame(gameId: string, playerId: number): Player {
  const gameState = gameStates.get(gameId);
  if (!gameState) {
    throw new Error(`Game ${gameId} not found`);
  }

  const playerIndex = gameState.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error('Player not found in game');
  }

  const removedPlayer = gameState.players[playerIndex];
  // Create new players array instead of mutating
  const newPlayers = gameState.players.filter(p => p.id !== playerId);
  updateGameState(gameId, { players: newPlayers });

  logGameAction(gameId, `Player ${removedPlayer.name} left`);
  return removedPlayer;
}

/**
 * Get all game states
 */
export function getAllGameStates(): GameState[] {
  return Array.from(gameStates.values());
}

/**
 * Get public games list
 */
export function getPublicGames(): Array<{gameId: string, playerCount: number, maxPlayers: number, isGameStarted: boolean, gameMode: string}> {
  return Array.from(gameStates.values())
    .filter(game => !game.isPrivate && !game.isGameStarted)
    .map(game => ({
      gameId: game.id,
      playerCount: game.players.length,
      maxPlayers: CONFIG.MAX_PLAYERS,
      isGameStarted: game.isGameStarted,
      gameMode: game.gameMode
    }));
}

/**
 * Associate client with game
 */
export function associateClientWithGame(client: WebSocket, gameId: string): void {
  clientGameMap.set(client, gameId);
}

/**
 * Get game ID for client
 */
export function getGameIdForClient(client: WebSocket): string | undefined {
  return clientGameMap.get(client);
}

/**
 * Remove client association
 */
export function removeClientAssociation(client: WebSocket): void {
  clientGameMap.delete(client);
}

/**
 * Get client game map (for broadcasting)
 */
export function getClientGameMap() {
  return clientGameMap;
}

/**
 * Log game action
 */
export function logGameAction(gameId: string, action: string): void {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${action}`;

  const logs = gameLogs.get(gameId) || [];
  logs.push(logEntry);
  gameLogs.set(gameId, logs);

  // Keep only last 1000 log entries
  if (logs.length > 1000) {
    gameLogs.set(gameId, logs.slice(-1000));
  }
}

/**
 * Get game logs
 */
export function getGameLogs(gameId: string): string[] {
  return gameLogs.get(gameId) || [];
}

/**
 * Get all game logs (for use by lifecycle functions)
 */
export function getAllGameLogs(): Map<string, string[]> {
  return gameLogs;
}

/**
 * Clear game timers
 *
 * NOTE: This function relies on shared mutable Map imports from gameLifecycle.js:
 * - gameTerminationTimers: Maps gameId → termination timer
 * - gameInactivityTimers: Maps gameId → inactivity timer
 * - playerDisconnectTimers: Maps "gameId-playerId" → disconnect timer
 *
 * These are singleton Maps shared across the lifecycle module. If gameLifecycle.js
 * is refactored to expose copies or proxies, timer clearing here will silently fail.
 * Timer handles are of type NodeJS.Timeout | number | undefined.
 */
export function clearGameTimers(gameId: string): void {
  const timers = [
    gameTerminationTimers.get(gameId),
    gameInactivityTimers.get(gameId)
  ].filter(Boolean);

  timers.forEach(timer => clearTimeout(timer));

  gameTerminationTimers.delete(gameId);
  gameInactivityTimers.delete(gameId);

  // Clear all player disconnect timers for this game
  for (const [key, timer] of playerDisconnectTimers.entries()) {
    if (key.startsWith(`${gameId}-`)) {
      clearTimeout(timer);
      playerDisconnectTimers.delete(key);
    }
  }
}

/**
 * Get game statistics
 */
export function getGameStats(): {activeGames: number, totalPlayers: number, maxGames: number} {
  const activeGames = gameStates.size;
  const totalPlayers = Array.from(gameStates.values())
    .reduce((sum, game) => sum + game.players.length, 0);

  return {
    activeGames,
    totalPlayers,
    maxGames: CONFIG.MAX_ACTIVE_GAMES
  };
}