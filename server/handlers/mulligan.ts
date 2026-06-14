/**
 * @file Mulligan handlers
 * Manages the mulligan phase after starting hands are drawn
 */

import { logger } from '../utils/logger.js';
import { getGameState, updateGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';
import { logGameAction as logAction, GameActions } from '../utils/gameLogger.js';

const MAX_MULLIGAN_ATTEMPTS = 3;

/**
 * Handle EXCHANGE_MULLIGAN_CARD message
 * Player exchanges a card from their mulligan hand for a new card from deck
 */
export function handleExchangeMulliganCard(ws, data) {
  try {
    const gameState = getGameState(data.gameId);
    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isMulliganActive) {
      return; // Not in mulligan phase
    }

    if (!data.playerId) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player ID is required'
      }));
      return;
    }

    if (typeof data.cardIndex !== 'number') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Card index is required'
      }));
      return;
    }

    // Find the player
    const player = gameState.players.find(p => p.id === data.playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: `Player with ID ${data.playerId} not found in game`
      }));
      return;
    }

    // Check if player already confirmed
    if (player.hasMulliganed) {
      return; // Cannot exchange after confirming
    }

    // Check if player has attempts left
    const attemptsLeft = player.mulliganAttempts ?? MAX_MULLIGAN_ATTEMPTS;
    if (attemptsLeft <= 0) {
      return; // No attempts left
    }

    // Validate card index
    if (data.cardIndex < 0 || data.cardIndex >= player.hand.length) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid card index'
      }));
      return;
    }

    // Check if deck has cards
    if (!player.deck || player.deck.length === 0) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Cannot exchange - deck is empty'
      }));
      return;
    }

    // Remove the card from hand
    const [exchangedCard] = player.hand.splice(data.cardIndex, 1);

    // Variable to track the new card drawn (for logging)
    let newCard = null;

    // Check if starting hero rule is enabled and the exchanged card is a Hero
    const isHeroCard = exchangedCard.types && exchangedCard.types.includes('Hero');

    if (gameState.startingHeroEnabled && isHeroCard) {
      // Count heroes in deck (excluding the one being exchanged)
      const heroesInDeck = player.deck.filter(card => card.types && card.types.includes('Hero'));

      if (heroesInDeck.length > 0) {
        // Put exchanged hero at bottom of deck
        player.deck.push(exchangedCard);

        // Draw the next hero from deck (the topmost one)
        const nextHeroIndex = player.deck.findIndex(card => card.types && card.types.includes('Hero'));
        if (nextHeroIndex !== -1) {
          const [nextHero] = player.deck.splice(nextHeroIndex, 1);
          player.hand.push(nextHero);
          newCard = nextHero;
        }
      } else {
        // No heroes in deck - mulligan as normal card (draw from top)
        player.deck.push(exchangedCard);
        newCard = player.deck.shift();
        if (newCard) {
          player.hand.push(newCard);
        }
      }
    } else {
      // Normal exchange - put card at bottom of deck, draw from top
      player.deck.push(exchangedCard);

      // Draw new card from top of deck
      newCard = player.deck.shift();
      if (newCard) {
        player.hand.push(newCard);
      }
    }

    // After mulligan, ensure Hero card is always at first position (if starting hero rule is enabled)
    if (gameState.startingHeroEnabled) {
      const heroIndex = player.hand.findIndex(card => card.types && card.types.includes('Hero'));
      if (heroIndex !== -1 && heroIndex !== 0) {
        // Move hero to first position
        const [heroCard] = player.hand.splice(heroIndex, 1);
        player.hand.unshift(heroCard);
      }
    }

    // Update sizes
    player.handSize = player.hand.length;
    player.deckSize = player.deck.length;

    // Decrement mulligan attempts
    player.mulliganAttempts = attemptsLeft - 1;

    logger.info(`[MULLIGAN] Player ${player.id} exchanged card at index ${data.cardIndex}, attempts remaining: ${player.mulliganAttempts}`);

    // Log card exchange
    logAction(data.gameId, GameActions.CARD_MOVED, {
      playerId: player.id,
      playerName: player.name,
      action: 'mulligan_exchange',
      exchangedCard: exchangedCard.name,
      newCard: newCard?.name,
      cardIndex: data.cardIndex,
      cardsInHand: player.hand.length,
      attemptsRemaining: player.mulliganAttempts
    }).catch();

    broadcastToGame(data.gameId, gameState);
  } catch (error) {
    logger.error('Failed to exchange mulligan card:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to exchange card'
    }));
  }
}

/**
 * Handle CONFIRM_MULLIGAN message
 * Player confirms their mulligan hand arrangement
 */
export function handleConfirmMulligan(ws, data) {
  try {
    const gameState = getGameState(data.gameId);
    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isMulliganActive) {
      return; // Not in mulligan phase
    }

    if (!data.playerId) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player ID is required'
      }));
      return;
    }

    // Find the player
    const player = gameState.players.find(p => p.id === data.playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: `Player with ID ${data.playerId} not found in game`
      }));
      return;
    }

    // Update player's hand with the new arrangement (if provided)
    if (data.newHand && Array.isArray(data.newHand)) {
      player.hand = data.newHand;
      player.handSize = data.newHand.length;
    }

    // Mark player as having confirmed mulligan
    player.hasMulliganed = true;

    // Log mulligan confirmation
    logAction(data.gameId, GameActions.CARD_MOVED, {
      playerId: player.id,
      playerName: player.name,
      action: 'mulligan_confirmed',
      cardsInHand: player.hand.length
    }).catch();

    // Check if all non-dummy players have confirmed
    const realPlayers = gameState.players.filter(p => !p.isDummy && !p.isDisconnected && !p.isSpectator);
    const allConfirmed = realPlayers.length > 0 && realPlayers.every(p => p.hasMulliganed);

    if (allConfirmed) {
      // All players confirmed - end mulligan phase
      gameState.isMulliganActive = false;
      gameState.mulliganCompletePlayers = [];

      // Draw 7th card for starting player (first turn advantage)
      const startingPlayer = gameState.players.find(p => p.id === gameState.startingPlayerId);
      if (startingPlayer && startingPlayer.deck && startingPlayer.deck.length > 0) {
        const seventhCard = startingPlayer.deck.shift();
        if (seventhCard) {
          startingPlayer.hand.push(seventhCard);
          startingPlayer.handSize = startingPlayer.hand.length;
          startingPlayer.deckSize = startingPlayer.deck.length;

          logger.info(`[MULLIGAN] Starting player ${startingPlayer.id} drew 7th card`);

          logAction(data.gameId, GameActions.CARD_DRAWN, {
            playerId: startingPlayer.id,
            playerName: startingPlayer.name,
            cardsDrawn: 1,
            isStartingHand: false,
            cardsInDeck: startingPlayer.deck.length,
            cardsInHand: startingPlayer.hand.length
          }).catch();
        }
      }

      // Set phase to Setup
      gameState.currentPhase = 1;

      logger.info(`[MULLIGAN] All players confirmed mulligan for game ${data.gameId}. Starting Setup phase.`);

      // Log phase transition
      logAction(data.gameId, GameActions.PHASE_CHANGED, {
        phase: 1,
        phaseName: 'Setup',
        trigger: 'mulligan_complete'
      }).catch();
    }

    broadcastToGame(data.gameId, gameState);
  } catch (error) {
    logger.error('Failed to confirm mulligan:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to confirm mulligan'
    }));
  }
}

/**
 * Initialize mulligan attempts for all real players
 * Called when mulligan phase is activated
 */
export function initializeMulliganAttempts(gameState) {
  gameState.players.forEach(player => {
    if (!player.isDummy && !player.isSpectator) {
      player.mulliganAttempts = MAX_MULLIGAN_ATTEMPTS;
    }
  });
  return gameState;
}
