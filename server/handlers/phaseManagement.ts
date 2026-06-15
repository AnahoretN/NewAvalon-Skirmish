/**
 * @file Phase management handlers (Server Mode)
 *
 * ALL LOGIC REMOVED - Only interface stubs remain.
 * Phase management and turn passing is now handled client-side only.
 */

import { logger } from '../utils/logger.js';
import { getGameState, updateGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';

// Export empty/placeholder functions for API compatibility
export function checkRoundEnd(_gameState: any, _isDeselectCheck = false): boolean {
  return false;
}

export function endRound(_gameState: any): void {
  // No-op - logic removed
}

/**
 * Handle TOGGLE_AUTO_ABILITIES message
 */
export function handleToggleAutoAbilities(ws, data) {
  try {
    const { gameId, enabled } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    gameState.autoAbilitiesEnabled = enabled;
    broadcastToGame(gameId, gameState);
    logger.info(`[ToggleAutoAbilities] Game ${gameId}: autoAbilitiesEnabled = ${enabled}`);
  } catch (err) {
    logger.error('[ToggleAutoAbilities] Error:', err);
  }
}

/**
 * Handle NEXT_PHASE message
 */
export function handleNextPhase(ws, data) {
  // No-op - phase logic removed
  logger.info('[handleNextPhase] No-op - phase management removed');
}

/**
 * Handle PREV_PHASE message
 */
export function handlePrevPhase(ws, data) {
  // No-op - phase logic removed
  logger.info('[handlePrevPhase] No-op - phase management removed');
}

/**
 * Handle SET_PHASE message
 */
export function handleSetPhase(ws, data) {
  // No-op - phase logic removed
  logger.info('[handleSetPhase] No-op - phase management removed');
}

/**
 * Handle TOGGLE_ACTIVE_PLAYER message
 */
export function handleToggleActivePlayer(ws, data) {
  // No-op - turn passing logic removed
  logger.info('[handleToggleActivePlayer] No-op - turn passing removed');
}

/**
 * Handle TOGGLE_AUTO_DRAW message
 */
export function handleToggleAutoDraw(ws, data) {
  // No-op - auto draw logic removed
  logger.info('[handleToggleAutoDraw] No-op - auto draw removed');
}

/**
 * Handle START_NEXT_ROUND message
 * - Increments round number
 * - Resets all players' scores to 0
 * - Closes round end modal
 * - Clears game winner
 * - ALL players draw 1 additional card for the new round
 * - Activates mulligan phase with attempts based on round results:
 *   - Base: 3 attempts
 *   - Round winner(s): lose 1 attempt (so 2 attempts)
 *   - Player with lowest score: +1 attempt (so 4 attempts)
 */
export function handleStartNextRound(ws, data) {
  try {
    const { gameId } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    const newRound = (gameState.currentRound || 1) + 1;

    // Get round winners and find lowest score player
    const roundWinnerIds = gameState.roundWinners[gameState.currentRound] || [];
    const activeNonDummyPlayers = gameState.players.filter(p => !p.isDummy && !p.isSpectator && !p.isDisconnected);

    // Find player with lowest score at end of round
    let lowestScore = Infinity;
    let lowestScorePlayerIds = [];

    activeNonDummyPlayers.forEach(p => {
      if (p.score < lowestScore) {
        lowestScore = p.score;
        lowestScorePlayerIds = [p.id];
      } else if (p.score === lowestScore) {
        lowestScorePlayerIds.push(p.id);
      }
    });

    // Update players: reset scores, draw 1 card, calculate mulligan attempts
    const newPlayers = gameState.players.map(p => {
      // Skip disconnected and spectators
      if (p.isDisconnected || p.isSpectator) {
        return { ...p, score: 0 };
      }

      // Skip dummy players - reset score, no draw, no mulligan
      if (p.isDummy) {
        return {
          ...p,
          score: 0,
          mulliganAttempts: 0,
          hasMulliganed: true
        };
      }

      // Calculate mulligan attempts for real players
      let attempts = 3;  // Base

      // Round winner loses 1 attempt
      if (roundWinnerIds.includes(p.id)) {
        attempts = Math.max(0, attempts - 1);
      }
      // Lowest score player gets +1 attempt (but NOT if they're also a winner)
      else if (lowestScorePlayerIds.includes(p.id)) {
        attempts = attempts + 1;
      }

      // Draw 1 card for new round
      const newHand = [...(p.hand || [])];
      const newDeck = [...(p.deck || [])];

      if (newDeck.length > 0) {
        const drawnCard = newDeck.shift();
        if (drawnCard) {
          newHand.push(drawnCard);
        }
      }

      return {
        ...p,
        score: 0,
        hand: newHand,
        deck: newDeck,
        handSize: newHand.length,
        deckSize: newDeck.length,
        mulliganAttempts: attempts,
        hasMulliganed: false
      };
    });

    // Update game state with new round, reset scores, and activate mulligan
    const updatedState = {
      ...gameState,
      currentRound: newRound,
      players: newPlayers,
      isRoundEndModalOpen: false,
      gameWinner: null,
      isMulliganActive: true,  // Activate mulligan phase
      isRoundTransitionMulligan: true,  // This is round transition mulligan
      mulliganCompletePlayers: [],
      currentPhase: 0  // Stay at phase 0 during mulligan (will be set to 1 after all confirm)
    };

    // Update the game state
    updateGameState(gameId, updatedState);
    // Broadcast to all players
    broadcastToGame(gameId, updatedState);

    logger.info(`[handleStartNextRound] Game ${gameId}: Round ${newRound} started, mulligan activated`);
  } catch (err) {
    logger.error('[handleStartNextRound] Error:', err);
  }
}

/**
 * Handle COMPLETE_ROUND message
 * - Closes the round end modal
 * - Does NOT start a new round or reset scores
 * - Allows player to view the battlefield after game over
 */
export function handleCompleteRound(ws, data) {
  try {
    const { gameId } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Just close the modal, don't change anything else
    const updatedState = {
      ...gameState,
      isRoundEndModalOpen: false
    };

    // Update the game state
    updateGameState(gameId, updatedState);
    // Broadcast to all players
    broadcastToGame(gameId, updatedState);

    logger.info(`[handleCompleteRound] Game ${gameId}: Round end modal closed`);
  } catch (err) {
    logger.error('[handleCompleteRound] Error:', err);
  }
}

/**
 * Handle START_NEW_MATCH message
 */
export function handleStartNewMatch(ws, data) {
  // No-op - match management logic removed
  logger.info('[handleStartNewMatch] No-op - match management removed');
}

/**
 * Handle RESET_GAME message
 */
export function handleResetGame(ws, data) {
  // No-op - game reset logic removed
  logger.info('[handleResetGame] No-op - game reset removed');
}

// Export performPreparationPhase for compatibility (no-op)
export function performPreparationPhase(gameState: any, _playerId?: number): any {
  // No-op - just return the state unchanged
  return gameState;
}
