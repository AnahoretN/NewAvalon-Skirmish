/**
 * @file WebSocket service for real-time game communication
 */

import { logger } from '../utils/logger.js';
import { validateMessageSize, sendErrorResponse, validateMessageStructure } from '../utils/security.js';
import { isRateLimited, cleanupRateLimitData } from './rateLimit.js';
import {
  getGameState,
  removeClientAssociation,
  getGameIdForClient,
  getClientGameMap,
  getPublicGames,
  getAllGameLogs,
} from './gameState.js';
import { handlePlayerLeave, broadcastGamesList } from './gameLifecycle.js';

// Store wss instance for broadcasting
let wssInstance = null;

// Export wssInstance for use in other modules (like visualEffects)
export function getWssInstance() {
  return wssInstance;
}

// Import handler modules
import {
  handleSubscribe,
  handleUpdateState,
  handleJoinGame,
  handleJoinAsInvite,
  handleSpectatorLeave,
  handleExitGame,
  handleForceSync,
  handleResetGame
} from '../handlers/gameManagement.js';
import {
  handleStartReadyCheck,
  handleCancelReadyCheck,
  handlePlayerReady
} from '../handlers/readyCheck.js';
import {
  handleConfirmMulligan,
  handleExchangeMulliganCard
} from '../handlers/mulligan.js';
import {
  handleSetGameMode,
  handleSetGamePrivacy,
  handleAssignTeams,
  handleSetGridSize
} from '../handlers/gameSettings.js';
import {
  handleTriggerHighlight,
  handleTriggerNoTarget,
  handleTriggerFloatingText,
  handleTriggerFloatingTextBatch,
  handleTriggerDeckSelection,
  handleTriggerHandCardSelection,
  handleTriggerClickWave,
  handleSetTargetingMode,
  handleClearTargetingMode,
  handleSyncValidTargets
} from '../handlers/visualEffects.js';
import {
  handleUpdateDeckData
} from '../handlers/deckData.js';
import {
  handleUpdatePlayerName,
  handleChangePlayerColor,
  handleUpdatePlayerScore,
  handleChangePlayerDeck,
  handleLoadCustomDeck,
  handleSetDummyPlayerCount,
  handleLogGameAction,
  handleGetGameLogs,
  handleRemoveCountersWithReward
} from '../handlers/playerSettings.js';
import {
  handleToggleAutoAbilities,
  handleToggleAutoDraw,
  handleToggleActivePlayer,
  handleNextPhase,
  handlePrevPhase,
  handleSetPhase,
  handleStartNextRound,
  handleCompleteRound,
  handleStartNewMatch
} from '../handlers/phaseManagement.js';

/**
 * Setup WebSocket server
 */
export function setupWebSocket(wss) {
  // Store wss instance for broadcasting
  wssInstance = wss;

  wss.on('connection', (ws) => {
    logger.info('New WebSocket connection established');

    // Handle connection close
    ws.on('close', () => {
      handleDisconnection(ws);
    });

    // Handle incoming messages
    ws.on('message', (message) => {
      handleWebSocketMessage(ws, message);
    });

    // Handle connection errors
    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
      cleanupRateLimitData(ws);
    });
    // NOTE: Don't send any message on connect - wait for client to send first message
    // This is important for tunnel compatibility (ngrok, cloudflared)
  });

  logger.info('WebSocket server initialized');
}

/**
 * Handle WebSocket messages
 */
function handleWebSocketMessage(ws, message) {
  try {
    // Validate message size (before parsing to prevent memory issues)
    if (!validateMessageSize(message)) {
      sendErrorResponse(ws, 'Message too large');
      return;
    }

    // Parse message
    const messageStr = message.toString();
    let parsedData;
    try {
      parsedData = JSON.parse(messageStr);
    } catch {
      sendErrorResponse(ws, 'Invalid message format');
      return;
    }

    // Rate limiting check
    if (isRateLimited(ws)) {
      sendErrorResponse(ws, 'Rate limit exceeded');
      return;
    }

    // Validate message structure using centralized validator
    const structureResult = validateMessageStructure(parsedData);
    if (!structureResult.isValid) {
      sendErrorResponse(ws, structureResult.errorMessage || 'Invalid message structure');
      return;
    }

    // Route message to appropriate handler
    routeMessage(ws, parsedData);

  } catch (error) {
    logger.error('Error handling WebSocket message:', error);
    sendErrorResponse(ws, 'Internal server error');
  }
}

/**
 * Route message to appropriate handler
 */
function routeMessage(ws, data) {
  const handlers = {
    'SUBSCRIBE': handleSubscribe,
    'CREATE_GAME': handleCreateGame,
    'JOIN_GAME': handleJoinGame,
    'JOIN_AS_INVITE': handleJoinAsInvite,
    'SPECTATOR_LEAVE': handleSpectatorLeave,
    'PLAY_CARD': handlePlayCard,
    'MOVE_CARD': handleMoveCard,
    'END_TURN': handleEndTurn,
    'CHAT_MESSAGE': handleChatMessage,
    'GET_GAMES_LIST': handleGetGamesList,
    'UPDATE_DECK_DATA': handleUpdateDeckData,
    'UPDATE_STATE': handleUpdateState,
    'PLAYER_READY': handlePlayerReady,
    'CONFIRM_MULLIGAN': handleConfirmMulligan,
    'EXCHANGE_MULLIGAN_CARD': handleExchangeMulliganCard,
    'ASSIGN_TEAMS': handleAssignTeams,
    'SET_GAME_MODE': handleSetGameMode,
    'SET_GAME_PRIVACY': handleSetGamePrivacy,
    'SET_GRID_SIZE': handleSetGridSize,
    'DRAW_CARD': handleDrawCard,
    'DRAW_CARDS_BATCH': handleDrawCardsBatch,
    'SHUFFLE_DECK': handleShuffleDeck,
    'ANNOUNCE_CARD': handleAnnounceCard,
    'PLAY_COUNTER': handlePlayCounter,
    'PLAY_TOKEN': handlePlayToken,
    'DESTROY_CARD': handleDestroyCard,
    'RETURN_CARD_TO_HAND': handleReturnCardToHand,
    'ADD_COMMAND': handleAddCommand,
    'CANCEL_PENDING_COMMAND': handleCancelPendingCommand,
    'EXECUTE_PENDING_COMMAND': handleExecutePendingCommand,
    'FLIP_CARD': handleFlipCard,
    'REMOVE_COUNTERS_WITH_REWARD': handleRemoveCountersWithReward,
    'CLEANUP_COMMAND': handleCleanupCommand,
    'START_READY_CHECK': handleStartReadyCheck,
    'CANCEL_READY_CHECK': handleCancelReadyCheck,
    'TRIGGER_HIGHLIGHT': handleTriggerHighlight,
    'TRIGGER_FLOATING_TEXT': handleTriggerFloatingText,
    'TRIGGER_FLOATING_TEXT_BATCH': handleTriggerFloatingTextBatch,
    'TRIGGER_NO_TARGET': handleTriggerNoTarget,
    'TRIGGER_DECK_SELECTION': handleTriggerDeckSelection,
    'TRIGGER_HAND_CARD_SELECTION': handleTriggerHandCardSelection,
    'TRIGGER_CLICK_WAVE': handleTriggerClickWave,
    'SET_TARGETING_MODE': handleSetTargetingMode,
    'CLEAR_TARGETING_MODE': handleClearTargetingMode,
    'SYNC_VALID_TARGETS': handleSyncValidTargets,
    'EXIT_GAME': handleExitGame,
    'FORCE_SYNC': handleForceSync,
    'RESET_GAME': handleResetGame,
    'SYNC_GAME': handleSyncGame,
    'TOGGLE_AUTO_ABILITIES': handleToggleAutoAbilities,
    'TOGGLE_AUTO_DRAW': handleToggleAutoDraw,
    'TOGGLE_ACTIVE_PLAYER': handleToggleActivePlayer,
    'NEXT_PHASE': handleNextPhase,
    'PREV_PHASE': handlePrevPhase,
    'SET_PHASE': handleSetPhase,
    'START_NEXT_ROUND': handleStartNextRound,
    'COMPLETE_ROUND': handleCompleteRound,
    'START_NEW_MATCH': handleStartNewMatch,
    'SET_DUMMY_PLAYER_COUNT': handleSetDummyPlayerCount,
    'UPDATE_PLAYER_NAME': handleUpdatePlayerName,
    'CHANGE_PLAYER_COLOR': handleChangePlayerColor,
    'UPDATE_PLAYER_SCORE': handleUpdatePlayerScore,
    'CHANGE_PLAYER_DECK': handleChangePlayerDeck,
    'LOAD_CUSTOM_DECK': handleLoadCustomDeck,
    'LOG_GAME_ACTION': handleLogGameAction,
    'GET_GAME_LOGS': handleGetGameLogs
  };

  const handler = handlers[data.type];
  if (handler) {
    handler(ws, data);
  } else {
    logger.warn(`Unknown message type: ${data.type}`);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Unknown message type'
    }));
  }
}

/**
 * Handle client disconnection
 */
function handleDisconnection(ws) {
  try {
    const gameId = getGameIdForClient(ws);

    if (gameId && ws.playerId) {
      // Use the new handlePlayerLeave function with isManualExit=false
      // This will mark as disconnected after 10s and remove after 5min
      handlePlayerLeave(
        gameId,
        ws.playerId,
        false, // Not a manual exit - it's a disconnect
        getAllGameLogs(),
        { clients: wssInstance?.clients || [] },
        (gid, state) => broadcastToGame(gid, state, ws),
        () => broadcastGamesList(getAllGameLogs(), { clients: wssInstance?.clients || [] })
      );
    }

    // Clean up rate limiting data
    cleanupRateLimitData(ws);

    // Remove client association
    removeClientAssociation(ws);

    logger.info('Client disconnected');
  } catch (error) {
    logger.error('Error handling disconnection:', error);
  }
}

/**
 * Broadcast game state to all clients in a game
 */
export function broadcastToGame(gameId, gameState, excludeClient = null) {
  try {
    const sanitizedGameState = sanitizeGameState(gameState);
    const message = JSON.stringify(sanitizedGameState);

    // Get the client game map to find all clients associated with this game
    const clientGameMap = getClientGameMap();

    // Send to all connected clients associated with this game
    if (wssInstance && wssInstance.clients) {
      wssInstance.clients.forEach(client => {
        if (client !== excludeClient &&
            client.readyState === 1 && // WebSocket.OPEN
            clientGameMap.get(client) === gameId) {
          try {
            client.send(message);
          } catch (error) {
            logger.error('Error sending to client:', error);
          }
        }
      });
    }

  } catch (error) {
    logger.error('Error broadcasting to game:', error);
  }
}

/**
 * Send message to specific client
 */
export function sendToClient(client, message) {
  if (client && client.readyState === 1) {
    try {
      const payload = JSON.stringify(message);
      client.send(payload);
    } catch (error) {
      logger.error('Error sending to client:', error);
    }
  }
}

/**
 * Broadcast a compact message to all clients in a game (not full gameState)
 * Use this for events, notifications, and partial updates to save bandwidth
 */
export function broadcastToGameMessage(gameId: string, message: Record<string, unknown>, excludeClient = null) {
  try {
    const payload = JSON.stringify(message);

    // Get the client game map to find all clients associated with this game
    const clientGameMap = getClientGameMap();

    // Send to all connected clients associated with this game
    if (wssInstance && wssInstance.clients) {
      wssInstance.clients.forEach(client => {
        if (client !== excludeClient &&
            client.readyState === 1 && // WebSocket.OPEN
            clientGameMap.get(client) === gameId) {
          try {
            client.send(payload);
          } catch (error) {
            logger.error('Error sending message to client:', error);
          }
        }
      });
    }
  } catch (error) {
    logger.error('Error broadcasting message to game:', error);
  }
}

/**
 * Sanitize game state for client transmission
 */
function sanitizeGameState(gameState) {
  return {
    ...gameState,
    gameId: gameState.id, // Map server's 'id' to client's expected 'gameId'
    players: gameState.players.map(player => ({
      ...player,
      ws: undefined // Remove WebSocket references
    }))
  };
}

// ============================================================================
// Placeholder handlers for functionality not yet implemented
// These are primarily client-side actions that use UPDATE_STATE
// ============================================================================

// Get games list handler
function handleGetGamesList(ws) {
  const publicGames = getPublicGames();
  sendToClient(ws, { type: 'GAMES_LIST', games: publicGames });
}

// Sync game handler
function handleSyncGame(ws) {
  const gameId = getGameIdForClient(ws);
  if (gameId) {
    const gameState = getGameState(gameId);
    if (gameState) {
      sendToClient(ws, gameState);
    }
  }
}

// Card action handlers - primarily client-side, logged here for tracking
// These actions are handled via UPDATE_STATE by the client
function handleClientSideAction() {
  // No-op - actions are handled via UPDATE_STATE by the client
}

// Handler wrappers for client-side actions
const handleCreateGame = () => handleClientSideAction();
const handlePlayCard = () => handleClientSideAction();
const handleMoveCard = () => handleClientSideAction();
const handleEndTurn = () => handleClientSideAction();
const handleDrawCard = () => handleClientSideAction();
const handleDrawCardsBatch = () => handleClientSideAction();
const handleShuffleDeck = () => handleClientSideAction();
const handleAnnounceCard = () => handleClientSideAction();
const handlePlayCounter = () => handleClientSideAction();
const handlePlayToken = () => handleClientSideAction();
const handleDestroyCard = () => handleClientSideAction();
const handleReturnCardToHand = () => handleClientSideAction();
const handleAddCommand = () => handleClientSideAction();
const handleCancelPendingCommand = () => handleClientSideAction();
const handleExecutePendingCommand = () => handleClientSideAction();
const handleFlipCard = () => handleClientSideAction();

// CLEANUP_COMMAND - discard command card from showcase to discard
const handleCleanupCommand = (ws, data) => {
  const gameId = getGameIdForClient(ws);
  if (!gameId) {
    sendErrorResponse(ws, 'No game associated with client');
    return;
  }

  const gameState = getGameState(gameId);
  if (!gameState) {
    sendErrorResponse(ws, 'Game not found');
    return;
  }

  const { playerId, cardId } = data;
  if (playerId === undefined) {
    sendErrorResponse(ws, 'No playerId provided');
    return;
  }

  // Find the player and their announced card
  const player = gameState.players.find(p => p.id === playerId);
  if (!player) {
    sendErrorResponse(ws, 'Player not found');
    return;
  }

  const announcedCard = player.announcedCard;
  if (!announcedCard) {
    sendErrorResponse(ws, 'No announced card for player');
    return;
  }

  // Move the announced card to discard
  const newPlayers = gameState.players.map(p => {
    if (p.id === playerId) {
      const discard = [...(p.discard || []), announcedCard];
      return {
        ...p,
        discard,
        discardSize: discard.length,
        announcedCard: null
      };
    }
    return p;
  });

  const updatedState = { ...gameState, players: newPlayers };
  broadcastToGame(gameId, updatedState, ws);
};

// Note: CHAT_MESSAGE is not yet implemented
const handleChatMessage = () => {
  // No-op
};
