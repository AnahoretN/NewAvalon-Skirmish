/**
 * Game Settings handlers for SimpleGameLogic
 *
 * Contains all game settings management logic:
 * - Game mode, grid size, privacy
 * - Team assignment
 * - Dummy player management
 * - Player ready state
 * - Game reset
 */

import type { GameState, Card, Player } from '../../types'
import { DeckType } from '../../types'
import { shuffleDeck } from '../../../shared/utils/array'
import { createDeck } from '../../hooks/core/gameCreators'
import { getDecksData } from '../../content'
import { assignUniqueRandomColor } from '../../utils/colorAssigner'

/**
 * SET_GAME_MODE - set game mode (FFA, 2v2, etc)
 */
export function handleSetGameMode(state: GameState, mode: any): GameState {
  return { ...state, gameMode: mode }
}

/**
 * SET_GRID_SIZE - set active grid size
 */
export function handleSetGridSize(state: GameState, size: any): GameState {
  return { ...state, activeGridSize: size }
}

/**
 * SET_PRIVACY - set game privacy (public/private)
 */
export function handleSetPrivacy(state: GameState, isPrivate: boolean): GameState {
  return { ...state, isPrivate }
}

/**
 * SET_STRICT_RULES - enable/disable strict rules (lateness effect)
 */
export function handleSetStrictRules(state: GameState, enabled: boolean): GameState {
  return { ...state, strictRulesEnabled: enabled }
}

/**
 * SET_STARTING_HERO - enable/disable starting hero rule
 * When enabled, first card of starting hand must be a Hero type card
 */
export function handleSetStartingHero(state: GameState, enabled: boolean): GameState {
  return { ...state, startingHeroEnabled: enabled }
}

/**
 * ASSIGN_TEAMS - assign players to teams
 */
export function handleAssignTeams(state: GameState, teams: any): GameState {
  const newPlayers = state.players.map(p => ({
    ...p,
    teamId: teams[p.id]
  }))

  return { ...state, players: newPlayers }
}

/**
 * SET_DUMMY_PLAYER_COUNT - add/remove dummy players
 */
export function handleSetDummyPlayerCount(state: GameState, count: number): GameState {
  // Cannot change dummy players after game has started
  if (state.isGameStarted) {
    return state
  }

  // Validate count (0-3)
  const numericCount = Number(count)
  if (!Number.isFinite(numericCount) || numericCount < 0 || numericCount > 3) {
    return state
  }

  // Get current real players (non-dummy)
  const realPlayers = state.players.filter(p => !p.isDummy)
  const currentDummies = state.players.filter(p => p.isDummy)

  // If count matches current number of dummies, no change needed
  if (currentDummies.length === numericCount) {
    return { ...state, dummyPlayerCount: numericCount }
  }

  // Keep existing real players
  const newPlayers = [...realPlayers]

  // Keep EXISTING dummy players (preserve their name, color, deck)
  const dummiesToKeep = Math.min(currentDummies.length, numericCount)
  for (let i = 0; i < dummiesToKeep; i++) {
    newPlayers.push(currentDummies[i])
  }

  // Add NEW dummy players only if we need more
  if (numericCount > currentDummies.length) {
    let nextPlayerId = Math.max(...realPlayers.map(p => p.id), ...currentDummies.map(p => p.id), 0)
    for (let i = currentDummies.length; i < numericCount; i++) {
      nextPlayerId++
      const dummyName = `Dummy ${i + 1}`

      // Get random deck type for dummy player
      const decksData = getDecksData()
      const deckKeys = Object.keys(decksData).filter(key =>
        key !== 'Tokens' && key !== 'Commands' && key !== 'Custom'
      ) as DeckType[]
      const randomDeckType = deckKeys[Math.floor(Math.random() * deckKeys.length)] || DeckType.SynchroTech

      const dummyDeck = shuffleDeck(createDeck(randomDeckType, nextPlayerId, dummyName))

      // Assign random unique color (not already used by existing players)
      const existingColors = newPlayers.map(p => p.color)
      const dummyColor = assignUniqueRandomColor(existingColors)

      const dummyPlayer: Player = {
        id: nextPlayerId,
        name: dummyName,
        score: 0,
        hand: [],
        deck: dummyDeck,
        discard: [],
        announcedCard: null,
        selectedDeck: randomDeckType,
        color: dummyColor,
        isDummy: true,
        isReady: true,
        boardHistory: [],
        autoDrawEnabled: true,
      }
      newPlayers.push(dummyPlayer)
    }
  }

  return {
    ...state,
    players: newPlayers,
    dummyPlayerCount: numericCount
  }
}

/**
 * PLAYER_READY - player is ready
 * When all players are ready, the game starts
 */
export function handlePlayerReady(state: GameState, playerId: number, startGameFn: (state: GameState) => GameState): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, isReady: true } : p
  )

  // Check if everyone is ready
  const allReady = newPlayers.every(p => p.isReady || p.isDummy || p.isSpectator)

  // If all ready - start game
  if (allReady) {
    return startGameFn({ ...state, players: newPlayers })
  }

  return { ...state, players: newPlayers }
}

/**
 * CONFIRM_MULLIGAN - player confirms their mulligan hand arrangement
 * When all non-dummy players have confirmed, the mulligan phase ends
 */
export function handleConfirmMulligan(state: GameState, playerId: number, newHand?: any[]): GameState {
  const newPlayers = state.players.map(p => {
    if (p.id === playerId) {
      return {
        ...p,
        hasMulliganed: true,
        hand: newHand || p.hand, // Update hand if new order provided
        handSize: (newHand || p.hand).length,
      }
    }
    return p
  })

  // Check if all non-dummy players have confirmed
  const realPlayers = newPlayers.filter(p => !p.isDummy && !p.isDisconnected && !p.isSpectator)
  const allConfirmed = realPlayers.length > 0 && realPlayers.every(p => p.hasMulliganed)

  // If all confirmed - end mulligan phase and start Setup phase
  if (allConfirmed) {
    // Draw 7th card for starting player (first turn advantage)
    const startingPlayerIndex = newPlayers.findIndex(p => p.id === state.startingPlayerId)
    if (startingPlayerIndex >= 0) {
      const sp = { ...newPlayers[startingPlayerIndex] }
      if (sp.deck && sp.deck.length > 0) {
        const seventhCard = sp.deck.shift()
        if (seventhCard) {
          sp.hand.push(seventhCard)
        }
        sp.handSize = sp.hand.length
        sp.deckSize = sp.deck.length
        newPlayers[startingPlayerIndex] = sp
      }
    }

    return {
      ...state,
      players: newPlayers,
      isMulliganActive: false,
      mulliganCompletePlayers: [],
      currentPhase: 1, // Setup phase
    }
  }

  return { ...state, players: newPlayers }
}

/**
 * EXCHANGE_MULLIGAN_CARD - player exchanges a card from their mulligan hand
 * Removes card at index, puts it at bottom of deck, and draws a new card
 * Special handling for Hero cards when startingHero rule is enabled:
 * - If mulliganing a Hero, draws the next Hero from deck
 * - If only one Hero in deck, cannot mulligan it
 */
export function handleExchangeMulliganCard(state: GameState, playerId: number, cardIndex?: number): GameState {
  const MAX_MULLIGAN_ATTEMPTS = 3

  if (cardIndex === undefined || cardIndex < 0) {
    return state // Invalid index
  }

  const playerIndex = state.players.findIndex(p => p.id === playerId)
  if (playerIndex === -1) {
    return state // Player not found
  }

  const player = state.players[playerIndex]

  // Check if player already confirmed mulligan
  if (player.hasMulliganed) {
    return state // Cannot exchange after confirming
  }

  // Check if player has attempts left
  const attemptsLeft = player.mulliganAttempts ?? MAX_MULLIGAN_ATTEMPTS
  if (attemptsLeft <= 0) {
    return state // No attempts left
  }

  // Validate card index
  if (cardIndex >= player.hand.length) {
    return state // Invalid index
  }

  // Check if deck has cards
  if (!player.deck || player.deck.length === 0) {
    return state // Cannot exchange - deck is empty
  }

  // Create new arrays to avoid mutation
  const newHand = [...player.hand]
  const newDeck = [...player.deck]

  // Remove the card from hand
  const [exchangedCard] = newHand.splice(cardIndex, 1)

  // Check if starting hero rule is enabled and the exchanged card is a Hero
  const isHeroCard = exchangedCard.types && exchangedCard.types.includes('Hero')

  if (state.startingHeroEnabled && isHeroCard) {
    // Count heroes in deck (excluding the one being exchanged)
    const heroesInDeck = newDeck.filter(card => card.types && card.types.includes('Hero'))

    if (heroesInDeck.length > 0) {
      // Put exchanged hero at bottom of deck
      newDeck.push(exchangedCard)

      // Draw the next hero from deck (the topmost one)
      const nextHeroIndex = newDeck.findIndex(card => card.types && card.types.includes('Hero'))
      if (nextHeroIndex !== -1) {
        const [nextHero] = newDeck.splice(nextHeroIndex, 1)
        newHand.push(nextHero)
      }
    } else {
      // No heroes in deck - mulligan as normal card (draw from top)
      newDeck.push(exchangedCard)
      const newCard = newDeck.shift()
      if (newCard) {
        newHand.push(newCard)
      }
    }
  } else {
    // Normal exchange - put card at bottom of deck, draw from top
    newDeck.push(exchangedCard)
    const newCard = newDeck.shift()
    if (newCard) {
      newHand.push(newCard)
    }
  }

  // After mulligan, ensure Hero card is always at first position (if starting hero rule is enabled)
  let finalHand = newHand
  if (state.startingHeroEnabled) {
    const heroIndex = newHand.findIndex(card => card.types && card.types.includes('Hero'))
    if (heroIndex !== -1 && heroIndex !== 0) {
      // Move hero to first position
      finalHand = [...newHand]
      const [heroCard] = finalHand.splice(heroIndex, 1)
      finalHand.unshift(heroCard)
    }
  }

  // Update player with new hand, deck, and decremented attempts
  const newPlayers = [...state.players]
  newPlayers[playerIndex] = {
    ...player,
    hand: finalHand,
    deck: newDeck,
    handSize: finalHand.length,
    deckSize: newDeck.length,
    mulliganAttempts: attemptsLeft - 1,
  }

  return { ...state, players: newPlayers }
}

/**
 * RESET_GAME - reset game to initial state (lobby)
 * Preserves players and their deck choices, but resets everything else
 */
export function handleResetGame(state: GameState): GameState {
  // Preserve player data for restoration
  const playersToKeep = state.players.map(p => {
    const deckType = p.selectedDeck || 'SynchroTech'
    return {
      ...p,
      // Reset game data
      hand: [],
      deck: createDeck(deckType, p.id, p.name),
      discard: [],
      discardSize: 0,
      handSize: 0,
      deckSize: createDeck(deckType, p.id, p.name).length,
      score: 0,
      isReady: false,  // Reset ready status
      announcedCard: null,
      boardHistory: [],
      lastPlayedCardId: null,
      hasLateness: false,
      clearLatenessOnNextPlay: false,
      // Preserve settings
      autoDrawEnabled: p.autoDrawEnabled !== false,
    }
  })

  // Create empty board - ALWAYS 7x7, activeGridSize controls the visible/playable area
  const BOARD_SIZE = 7
  const newBoard: Array<Array<{ card: Card | null }>> = []
  for (let i = 0; i < BOARD_SIZE; i++) {
    const row: Array<{ card: Card | null }> = []
    for (let j = 0; j < BOARD_SIZE; j++) {
      row.push({ card: null })
    }
    newBoard.push(row)
  }

  return {
    ...state,
    // Reset game flags
    isGameStarted: false,
    isReadyCheckActive: false,
    currentPhase: 0,
    currentRound: 1,
    turnNumber: 1,
    activePlayerId: null,
    startingPlayerId: null,
    // Reset round and match
    roundWinners: {},
    gameWinner: null,
    roundEndTriggered: false,
    isRoundEndModalOpen: false,
    scoringLines: [],
    isScoringStep: false,
    // Clear visual effects
    floatingTexts: [],
    highlights: [],
    deckSelections: [],
    handCardSelections: [],
    targetingMode: null,
    clickWaves: [],
    visualEffects: new Map(),
    // New board and players
    board: newBoard,
    players: playersToKeep,
  }
}

/**
 * Start game - deals initial hands and selects random starting player
 * Called when all players are ready
 */
export function startGame(state: GameState): GameState {
  // Select random starting player
  const activePlayers = state.players.filter(p => !p.isDisconnected && !p.isSpectator)
  const startingPlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)]

  // Deal initial hands (6 cards to each player)
  const newPlayers = state.players.map(p => {
    if (p.isSpectator || p.isDisconnected) {return p}

    const hand: Card[] = []
    const deck = [...p.deck]

    // If starting hero rule is enabled, ensure first card is a Hero type card
    if (state.startingHeroEnabled) {
      // Find the first Hero card in the deck
      const heroIndex = deck.findIndex(card => card.types && card.types.includes('Hero'))

      if (heroIndex !== -1) {
        // Remove the hero card from its position and add it as the first card in hand
        const [heroCard] = deck.splice(heroIndex, 1)
        hand.push(heroCard)

        // Fill the rest of the hand with cards from the top of the deck
        for (let i = 1; i < 6; i++) {
          if (deck.length > 0) {
            hand.push(deck.shift()!)
          }
        }
      } else {
        // No hero in deck - deal normally (no hero available)
        for (let i = 0; i < 6; i++) {
          if (deck.length > 0) {
            hand.push(deck.shift()!)
          }
        }
      }
    } else {
      // Normal dealing - just draw 6 cards from top
      for (let i = 0; i < 6; i++) {
        if (deck.length > 0) {
          hand.push(deck.shift()!)
        }
      }
    }

    return {
      ...p,
      hand,
      deck,
      handSize: hand.length,
      deckSize: deck.length,
      mulliganAttempts: p.isDummy ? 0 : 3, // Dummy players don't mulligan
      hasMulliganed: p.isDummy, // Dummy players auto-confirm mulligan
    }
  })

  // Note: 7th card for starting player will be drawn after mulligan phase completes

  return {
    ...state,
    players: newPlayers,
    isGameStarted: true,
    isReadyCheckActive: false,
    isMulliganActive: true,  // Activate mulligan phase
    mulliganCompletePlayers: [],
    startingPlayerId: startingPlayer.id,
    activePlayerId: startingPlayer.id,
    currentPhase: 0,  // Stay at phase 0 during mulligan (will be set to 1 after all confirm)
    turnNumber: 1
  }
}
