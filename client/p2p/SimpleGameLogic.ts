/**
 * Simple Game Logic
 *
 * Core game logic for WebRTC P2P mode.
 * The applyAction function takes current state and action,
 * returns new state.
 *
 * Some specialized handlers are split into separate modules:
 * - handlers/scoringHandlers.ts - scoring and round management
 * - handlers/gameSettingsHandlers.ts - game configuration
 */

import type { GameState, Card, Player, ScoringLineData, CardStatus, CustomDeckFile, FloatingTextData } from '../types'
import { DeckType } from '../types'
import type { ActionType } from './SimpleP2PTypes'
import { shuffleDeck } from '../../shared/utils/array'
import { recalculateBoardStatuses } from '../../shared/utils/boardUtils'
import { recalculateAllReadyStatuses, getCardAbilityInfo, recheckReadyStatuses } from '../utils/autoAbilities'
import { READY_STATUS } from '@shared/abilities/index.js'
import { createDeck } from '../hooks/core/gameCreators'
import { logger } from '../utils/logger'
import { getCardDefinition } from '@/content'

// Import handlers from separate modules
import * as ScoringHandlers from './handlers/scoringHandlers'
import * as GameSettingsHandlers from './handlers/gameSettingsHandlers'

// Import helper functions used internally
import { findScoringLinesWithPlayerCard, getActivePlayerIds, shouldRoundEnd, endRound, calculateLineScore } from './handlers/scoringHandlers'

// Re-export helper functions that are used externally
export { findScoringLinesWithPlayerCard }
export { getActivePlayerIds, shouldRoundEnd, endRound }
export { startGame } from './handlers/gameSettingsHandlers'

/**
 * Check if card is a token
 * Tokens are identified by deck === 'counter', deck === 'Tokens', or having 'Token' type
 */
function isToken(card: Card): boolean {
  return card.deck === 'counter' ||
         card.deck === 'Tokens' ||
         card.types?.includes('Token') === true
}

/**
 * Check if card is a command card by looking at contentDatabase
 * This is more reliable than checking runtime card properties
 */
function isCommandCardByDefinition(card: Card): boolean {
  if (!card.baseId) {
    // Fallback to runtime properties if baseId is not available
    return card.deck === 'Command' ||
           card.types?.includes('Command') === true ||
           card.faction === 'Command'
  }

  // Check contentDatabase for definitive answer using getCardDefinition
  const cardDef = getCardDefinition(card.baseId)
  if (!cardDef) {
    // Fallback to runtime properties if not found in database
    return card.deck === 'Command' ||
           card.types?.includes('Command') === true ||
           card.faction === 'Command'
  }

  return cardDef.types?.includes('Command') === true ||
         cardDef.faction === 'Command'
}

/**
 * Clear all card statuses except Revealed
 * Called when moving card from battlefield
 * Also resets power modifiers to base value
 */
function clearAllStatusesExceptRevealed(card: Card): void {
  if (!card.statuses) {
    card.statuses = []
  }
  // Keep only Revealed statuses, remove all others
  card.statuses = card.statuses.filter(s => s.type === 'Revealed')

  // Reset power modifiers to base value when card leaves battlefield
  card.powerModifier = 0
  card.bonusPower = 0
}

/**
 * Clear all card statuses including Revealed
 * Called when moving card to discard/deck
 * Also resets power modifiers to base value
 */
function clearAllStatuses(card: Card): void {
  if (!card.statuses) {
    card.statuses = []
  }
  // Clear ALL statuses including Revealed when card goes to discard/deck
  card.statuses = []

  // Reset power modifiers to base value
  card.powerModifier = 0
  card.bonusPower = 0
}

/**
 * Check if a card is Lucius, The Immortal
 * Lucius has pass abilities: Immunity to Stun, +2 power if exited from Discard
 */
function isLucius(card: Card): boolean {
  // Check by baseId (e.g., 'luciusTheImmortal' or similar)
  if (!card.baseId) {return false}
  const baseId = card.baseId.toLowerCase()
  return baseId === 'luciustheimmortal' || baseId.includes('lucius')
}

/**
 * Remove all Stun tokens from Lucius (his passive immunity)
 * This should be called after any state update that might add Stun to Lucius
 */
function removeStunFromLucius(state: GameState): GameState {
  let modified = false
  const newBoard = state.board.map(row =>
    row.map(cell => {
      if (cell.card && isLucius(cell.card) && cell.card.statuses) {
        const hadStun = cell.card.statuses.some((s: any) => s.type === 'Stun')
        if (hadStun) {
          modified = true
          const newStatuses = cell.card.statuses.filter((s: any) => s.type !== 'Stun')
          return { card: { ...cell.card, statuses: newStatuses } }
        }
      }
      return cell
    })
  )

  return modified ? { ...state, board: newBoard } : state
}

/**
 * Process Resurrected tokens when phase changes
 * All cards with Resurrected receive 2 Stun tokens, then all Resurrected tokens are removed
 * Note: Cards with Stun immunity (like Lucius) won't receive Stun tokens
 */
function processResurrectedTokens(state: GameState): GameState {
  let modified = false
  const newState = { ...state }
  let resurrectedCount = 0

  // First pass: Add 2 Stun tokens to cards with Resurrected
  const newBoard = newState.board.map(row =>
    row.map(cell => {
      if (cell.card && cell.card.statuses?.some((s: any) => s.type === 'Resurrected')) {
        resurrectedCount++

        // Get the owner of the Resurrected status
        const resurrectedStatus = cell.card.statuses.find((s: any) => s.type === 'Resurrected')
        const ownerPlayerId = resurrectedStatus?.addedByPlayerId ?? cell.card.ownerId ?? 0

        // Check if card is Lucius (immune to Stun)
        if (isLucius(cell.card)) {
          // Just remove Resurrected, don't add Stun
          modified = true
          const newStatuses = cell.card.statuses.filter((s: any) => s.type !== 'Resurrected')
          return { card: { ...cell.card, statuses: newStatuses } }
        }

        // Add 2 Stun tokens to non-immune cards
        modified = true
        const existingStatuses = cell.card.statuses || []
        const statussWithoutResurrected = existingStatuses.filter((s: any) => s.type !== 'Resurrected')

        // Add 2 Stun tokens with same owner as Resurrected status
        const newStatuses = [...statussWithoutResurrected]
        for (let i = 0; i < 2; i++) {
          newStatuses.push({ type: 'Stun', addedByPlayerId: ownerPlayerId })
        }

        return { card: { ...cell.card, statuses: newStatuses } }
      }
      return cell
    })
  )

  return modified ? { ...newState, board: newBoard } : newState
}

/**
 * Check for Vigilant Spotter passive trigger
 * When a revealed card is played, each Vigilant Spotter with Support status
 * belonging to the same player as the Revealed token owner gains 2 points
 *
 * @param state - Current game state
 * @param playedCard - The card that was played (has Revealed status)
 * @param caller - Source of the call for debugging (e.g., 'handlePlayCard', 'cleanupCommand')
 * @returns Updated game state with score changes and floating texts
 */
function checkVigilantSpotterTrigger(
  state: GameState,
  playedCard: Card,
  caller: string = 'unknown'
): GameState {
  console.log(`[checkVigilantSpotterTrigger] ========== START ==========`)
  console.log(`[checkVigilantSpotterTrigger] CALLED FROM: ${caller}`)
  console.log('[checkVigilantSpotterTrigger] Checking card:', playedCard.name, 'statuses:', playedCard.statuses)
  console.log('[checkVigilantSpotterTrigger] Current floatingTexts count:', state.floatingTexts?.length ?? 0)

  // Log stack trace for debugging duplicate calls
  const stack = new Error().stack
  if (stack) {
    const lines = stack.split('\n').slice(2, 6) // Skip first 2 lines (Error and this function)
    console.log('[checkVigilantSpotterTrigger] Call stack:')
    lines.forEach((line, i) => console.log(`  [${i}] ${line.trim()}`))
  }

  // Check if played card has Revealed status
  if (!playedCard.statuses) {
    console.log('[checkVigilantSpotterTrigger] No statuses on card, returning')
    return state
  }

  // Find all Revealed statuses and their owners
  const revealedOwners: number[] = []
  playedCard.statuses.forEach((status: any) => {
    if (status.type === 'Revealed') {
      const ownerId = status.addedByPlayerId ?? playedCard.ownerId ?? 0
      if (ownerId > 0 && !revealedOwners.includes(ownerId)) {
        revealedOwners.push(ownerId)
      }
    }
  })

  console.log('[checkVigilantSpotterTrigger] Revealed owners:', revealedOwners)

  if (revealedOwners.length === 0) {
    return state // No Revealed status, no trigger
  }

  // Check each player who owns a Revealed status
  let newState = state
  const newFloatingTexts: FloatingTextData[] = [...(state.floatingTexts || [])]

  for (const revealOwnerId of revealedOwners) {
    console.log('[checkVigilantSpotterTrigger] Checking for Vigilant Spotters owned by player:', revealOwnerId)
    // Find all Vigilant Spotters on the battlefield owned by this player
    state.board.forEach((row, r) => {
      row.forEach((cell, c) => {
        const boardCard = cell.card
        if (!boardCard) return

        // Check if this is a Vigilant Spotter
        if (boardCard.baseId !== 'vigilantSpotter') return

        console.log('[checkVigilantSpotterTrigger] Found Vigilant Spotter at', r, c, 'owned by player:', boardCard.ownerId, 'looking for:', revealOwnerId)

        // Check if the Spotter is owned by the same player who owns the Revealed status
        if (boardCard.ownerId !== revealOwnerId) {
          console.log('[checkVigilantSpotterTrigger] Skipping - owner mismatch')
          return
        }

        // Check if Spotter has Support status
        const hasSupport = boardCard.statuses?.some((s: any) => s.type === 'Support')
        console.log('[checkVigilantSpotterTrigger] Spotter has Support:', hasSupport)
        if (!hasSupport) return

        // Trigger the ability: award 2 points
        const spotterPlayerId = boardCard.ownerId ?? 0
        if (spotterPlayerId <= 0) return

        // Get current score before change
        const playerBefore = newState.players.find(p => p.id === spotterPlayerId)
        if (!playerBefore) return
        const scoreBefore = playerBefore.score

        console.log('[checkVigilantSpotterTrigger] Player', spotterPlayerId, 'score before:', scoreBefore)

        // Update player score
        newState = {
          ...newState,
          players: newState.players.map(p =>
            p.id === spotterPlayerId
              ? { ...p, score: Math.max(0, p.score + 2) }
              : p
          )
        }

        // Get score after change
        const playerAfter = newState.players.find(p => p.id === spotterPlayerId)
        const scoreAfter = playerAfter?.score ?? scoreBefore

        console.log('[checkVigilantSpotterTrigger] Player', spotterPlayerId, 'score after:', scoreAfter, 'increased:', scoreAfter > scoreBefore)

        // Only add floating text if score actually increased
        if (scoreAfter > scoreBefore) {
          // Add floating text over the Spotter card with player ID for color
          const newFloatingText = {
            row: r,  // Spotter's row
            col: c,  // Spotter's column
            text: '+2',
            playerId: spotterPlayerId,  // Player who gains points (determines color)
            timestamp: Date.now()
          }
          newFloatingTexts.push(newFloatingText)

          console.log(`[Vigilant Spotter] TRIGGERED! Player ${spotterPlayerId} gains 2 points.`)
          console.log(`[Vigilant Spotter] Revealed card: ${playedCard.name}`)
          console.log(`[Vigilant Spotter] Floating text added at [${r}, ${c}]`, newFloatingText)
          console.log(`[Vigilant Spotter] Floating texts count BEFORE: ${state.floatingTexts?.length ?? 0}, AFTER: ${newFloatingTexts.length}`)
        } else {
          console.log(`[Vigilant Spotter] Score did not increase, skipping floating text`)
        }
      })
    })
  }

  if (newFloatingTexts.length > (state.floatingTexts?.length || 0)) {
    console.log(`[checkVigilantSpotterTrigger] Adding ${newFloatingTexts.length - (state.floatingTexts?.length || 0)} new floating texts to state`)
    newState = { ...newState, floatingTexts: newFloatingTexts }
  } else {
    console.log(`[checkVigilantSpotterTrigger] No new floating texts added`)
  }

  console.log(`[checkVigilantSpotterTrigger] RETURNING from ${caller}. Final floatingTexts count: ${newState.floatingTexts?.length ?? 0}`)
  console.log(`[checkVigilantSpotterTrigger] ========== END ==========`)
  return newState
}

/**
 * Restore LastPlayed status to previous card when a card with LastPlayed leaves battlefield
 * @param removedCard - The card being removed from battlefield
 * @param ownerId - The owner of the removed card
 * @param state - Current game state
 * @param hadLastPlayedOverride - Optional override for hadLastPlayed check (use when statuses were already cleared)
 * @returns Updated game state with LastPlayed restored to previous card
 */
function restoreLastPlayedToPreviousCard(
  state: GameState,
  removedCard: Card,
  ownerId: number,
  hadLastPlayedOverride?: boolean
): GameState {
  // Check if the removed card had LastPlayed status
  // Use override if provided (for cases where statuses were already cleared)
  const hadLastPlayed = hadLastPlayedOverride ?? removedCard.statuses?.some(
    s => s.type === 'LastPlayed' && s.addedByPlayerId === ownerId
  )

  if (!hadLastPlayed) {
    return state // No restoration needed
  }

  const player = state.players.find(p => p.id === ownerId)
  if (!player || !player.boardHistory) {
    return state
  }

  // Find previous card in boardHistory (excluding the removed card)
  const historyWithoutRemoved = player.boardHistory.filter(id => id !== removedCard.id)

  if (historyWithoutRemoved.length === 0) {
    // No previous cards - just update boardHistory and lastPlayedCardId
    // Also clear hasLateness since LastPlayed card is returning to hand
    const newPlayers = state.players.map(p =>
      p.id === ownerId
        ? { ...p, boardHistory: historyWithoutRemoved, lastPlayedCardId: null, hasLateness: false }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Find the most recent card in history that's still on board
  // Search from most recent backwards
  let foundCardId: string | null = null
  for (let i = historyWithoutRemoved.length - 1; i >= 0; i--) {
    const cardId = historyWithoutRemoved[i]
    // Check if this card is still on the board
    for (let r = 0; r < state.board.length; r++) {
      for (let c = 0; c < state.board[r].length; c++) {
        if (state.board[r][c]?.card?.id === cardId) {
          foundCardId = cardId
          break
        }
      }
      if (foundCardId) {break}
    }
    if (foundCardId) {break}
  }

  if (!foundCardId) {
    // No cards from history are still on board - clear LastPlayed
    // Also clear hasLateness since LastPlayed card is returning to hand
    const newPlayers = state.players.map(p =>
      p.id === ownerId
        ? { ...p, boardHistory: historyWithoutRemoved, lastPlayedCardId: null, hasLateness: false }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Remove all cards after the found one from history (they left the board)
  const foundIndex = historyWithoutRemoved.indexOf(foundCardId)
  const trimmedHistory = historyWithoutRemoved.slice(0, foundIndex + 1)

  // Find this card on board and restore LastPlayed status
  const newBoard = state.board.map(row =>
    row.map(cell => {
      if (cell.card?.id === foundCardId) {
        const lastPlayedStatus = { type: 'LastPlayed' as const, addedByPlayerId: ownerId }
        const existingStatuses = cell.card.statuses || []
        // Remove any existing LastPlayed from this player
        const filteredStatuses = existingStatuses.filter(
          s => !(s.type === 'LastPlayed' && s.addedByPlayerId === ownerId)
        )
        return {
          card: {
            ...cell.card,
            statuses: [...filteredStatuses, lastPlayedStatus]
          }
        }
      }
      return cell
    })
  )

  // Update player's boardHistory and lastPlayedCardId
  // Also clear hasLateness since LastPlayed is back on board
  const newPlayers = state.players.map(p =>
    p.id === ownerId
      ? { ...p, boardHistory: trimmedHistory, lastPlayedCardId: foundCardId, hasLateness: false }
      : p
  )

  return { ...state, board: newBoard, players: newPlayers }
}

/**
 * Apply action to game state
 * This is the only place where game state is modified!
 */
export function applyAction(
  state: GameState,
  playerId: number,
  action: ActionType,
  data?: any
): GameState {
  // DEBUG: Log all actions to track when Vigilant Spotter might be affected
  const isCleanupCommand = action === 'CLEANUP_COMMAND'
  const isPlayCard = action === 'PLAY_CARD'
  if (isCleanupCommand || isPlayCard) {
    console.log(`[applyAction] ACTION: ${action} by player ${playerId}`, isCleanupCommand ? `cardId: ${data?.cardId}` : `faceDown: ${data?.faceDown}`)
  }

  // Validation - can this player perform this action
  if (!canPlayerAct(state, playerId, action, data)) {
    return state
  }

  let newState = { ...state }

  switch (action) {
    case 'NEXT_PHASE':
      newState = handleNextPhase(newState, playerId)
      break

    case 'PREVIOUS_PHASE':
      newState = handlePreviousPhase(newState, playerId)
      break

    case 'PASS_TURN': {
      // Always use activePlayerId for Stun removal, not who clicked the button
      const activeId = newState.activePlayerId ?? playerId
      newState = handlePassTurn(newState, activeId, data?.reason || 'manual')
      break
    }

    case 'SET_PHASE':
      newState = handleSetPhase(newState, data?.phase)
      break

    case 'PLAY_CARD':
      newState = handlePlayCard(newState, playerId, data)
      break

    case 'PLAY_CARD_FROM_DECK':
      newState = handlePlayCardFromDeck(newState, playerId, data)
      break

    case 'PLAY_CARD_FROM_DISCARD':
      newState = handlePlayCardFromDiscard(newState, playerId, data)
      break

    case 'MOVE_CARD_ON_BOARD':
      newState = handleMoveCardOnBoard(newState, playerId, data)
      break

    case 'MOVE_CARD':
      newState = handleMoveCard(newState, playerId, data)
      break

    case 'RETURN_CARD_TO_HAND':
      newState = handleReturnCardToHand(newState, playerId, data)
      break

    case 'ANNOUNCE_CARD':
      newState = handleAnnounceCard(newState, playerId, data)
      break

    // Movement between zones
    case 'MOVE_CARD_TO_HAND':
      newState = handleMoveCardToHand(newState, playerId, data)
      break

    case 'MOVE_CARD_TO_DECK':
      newState = handleMoveCardToDeck(newState, playerId, data)
      break

    case 'MOVE_CARD_TO_DISCARD':
      newState = handleMoveCardToDiscard(newState, playerId, data)
      break

    case 'MOVE_HAND_CARD_TO_DECK':
      newState = handleMoveHandCardToDeck(newState, playerId, data)
      break

    case 'MOVE_HAND_CARD_TO_DISCARD':
      newState = handleMoveHandCardToDiscard(newState, playerId, data)
      break

    case 'MOVE_ANNOUNCED_TO_HAND':
      newState = handleMoveAnnouncedToHand(newState, playerId, data)
      break

    case 'MOVE_ANNOUNCED_TO_DECK':
      newState = handleMoveAnnouncedToDeck(newState, playerId, data)
      break

    case 'MOVE_ANNOUNCED_TO_DISCARD':
      newState = handleMoveAnnouncedToDiscard(newState, playerId, data)
      break

    case 'PLAY_ANNOUNCED_TO_BOARD':
      newState = handlePlayAnnouncedToBoard(newState, playerId, data)
      break

    case 'DESTROY_CARD':
      newState = handleDestroyCard(newState, playerId, data)
      break

    case 'SWAP_CARDS':
      newState = handleSwapCards(newState, playerId, data)
      break

    case 'SPAWN_TOKEN':
      newState = handleSpawnToken(newState, playerId, data)
      break

    case 'RESURRECT_DISCARDED':
      newState = handleResurrectDiscarded(newState, playerId, data)
      break

    case 'DRAW_CARD':
      newState = handleDrawCard(newState, playerId, data)
      break

    case 'DRAW_CARDS_BATCH':
      newState = handleDrawCardsBatch(newState, playerId, data)
      break

    case 'SHUFFLE_DECK':
      newState = handleShuffleDeck(newState, playerId)
      break

    case 'UPDATE_SCORE':
      newState = handleUpdateScore(newState, data?.playerId ?? playerId, data?.delta || 0)
      break

    case 'CHANGE_PLAYER_NAME':
      newState = handleChangePlayerName(newState, data?.playerId ?? playerId, data?.name)
      break

    case 'CHANGE_PLAYER_COLOR':
      newState = handleChangePlayerColor(newState, data?.playerId ?? playerId, data?.color)
      break

    case 'CHANGE_PLAYER_DECK':
      newState = handleChangePlayerDeck(newState, data?.playerId ?? playerId, data?.deck)
      break

    case 'LOAD_CUSTOM_DECK':
      newState = handleLoadCustomDeck(newState, data?.playerId ?? playerId, data?.deckFile)
      break

    case 'START_SCORING':
      newState = ScoringHandlers.handleStartScoring(newState, playerId, enterScoringPhase)
      break

    case 'SELECT_SCORING_LINE':
      newState = ScoringHandlers.handleSelectScoringLine(newState, playerId, data)
      break

    case 'SCORE_DIAGONAL':
      newState = ScoringHandlers.handleScoreDiagonal(newState, playerId, data)
      break

    case 'COMPLETE_ROUND':
      newState = ScoringHandlers.handleCompleteRound(newState)
      break

    case 'START_NEXT_ROUND':
      newState = ScoringHandlers.handleStartNextRound(newState)
      break

    case 'START_NEW_MATCH':
      newState = ScoringHandlers.handleStartNewMatch(newState)
      break

    case 'PLAYER_READY':
      newState = GameSettingsHandlers.handlePlayerReady(newState, playerId, GameSettingsHandlers.startGame)
      break

    case 'CONFIRM_MULLIGAN':
      newState = GameSettingsHandlers.handleConfirmMulligan(newState, playerId, data?.newHand)
      break

    case 'EXCHANGE_MULLIGAN_CARD':
      newState = GameSettingsHandlers.handleExchangeMulliganCard(newState, playerId, data?.cardIndex)
      break

    case 'RESET_GAME':
      newState = GameSettingsHandlers.handleResetGame(newState)
      break

    case 'MARK_ABILITY_USED':
      newState = handleMarkAbilityUsed(newState, data)
      break

    case 'EXECUTE_ABILITY_CHAINED':
      newState = handleExecuteAbilityChained(newState, playerId, data)
      break

    case 'GLOBAL_AUTO_APPLY':
      newState = handleGlobalAutoApply(newState, playerId, data)
      break

    case 'REMOVE_ALL_COUNTERS_BY_TYPE':
      newState = handleRemoveAllCountersByType(newState, data)
      break

    case 'REMOVE_COUNTER_BY_TYPE':
      newState = handleRemoveCounterByType(newState, data)
      break

    case 'REMOVE_COUNTERS_WITH_REWARD':
      newState = handleRemoveCountersWithReward(newState, playerId, data)
      break

    case 'CLEANUP_COMMAND':
      // CRITICAL: Use data.playerId (command card owner) instead of playerId (local player)
      // This fixes cleanup for command cards played by local player but owned by other players (e.g., dummy control)
      newState = handleCleanupCommandAction(newState, data.playerId || playerId, data)
      break

    case 'ADD_STATUS_TO_BOARD_CARD':
      newState = handleAddStatusToBoardCard(newState, playerId, data)
      break

    case 'ADD_STATUS_TO_HAND_CARD':
      newState = handleAddStatusToHandCard(newState, playerId, data)
      break

    case 'TRANSFER_ALL_STATUSES':
      newState = handleTransferAllStatuses(newState, playerId, data)
      break

    case 'PLAY_TOKEN_CARD':
      newState = handlePlayTokenCard(newState, playerId, data)
      break

    case 'PLAY_COMMAND_FROM_TOKEN_PANEL':
      newState = handlePlayCommandFromTokenPanel(newState, playerId, data)
      break

    case 'PLAY_COMMAND_FROM_DECK':
      newState = handlePlayCommandFromDeck(newState, playerId, data)
      break

    case 'FLIP_CARD':
      newState = handleFlipCard(newState, playerId, data)
      break

    case 'SET_GAME_MODE':
      newState = GameSettingsHandlers.handleSetGameMode(newState, data?.mode)
      break

    case 'SET_GRID_SIZE':
      newState = GameSettingsHandlers.handleSetGridSize(newState, data?.size)
      break

    case 'SET_PRIVACY':
      newState = GameSettingsHandlers.handleSetPrivacy(newState, data?.isPrivate)
      break

    case 'ASSIGN_TEAMS':
      newState = GameSettingsHandlers.handleAssignTeams(newState, data?.teams)
      break

    case 'SET_DUMMY_PLAYER_COUNT':
      newState = GameSettingsHandlers.handleSetDummyPlayerCount(newState, data?.count)
      break

    case 'SET_STRICT_RULES':
      newState = GameSettingsHandlers.handleSetStrictRules(newState, data?.enabled)
      break

    case 'REORDER_CARDS':
      newState = handleReorderCards(newState, playerId, data)
      break

    case 'REORDER_TOP_DECK':
      newState = handleReorderTopDeck(newState, playerId, data)
      break

    case 'REQUEST_DECK_VIEW':
      newState = handleRequestDeckView(newState, playerId, data)
      break

    case 'MODIFY_CARD_POWER':
      newState = handleModifyCardPower(newState, data)
      break

    default:
    }

  // Always recalculate board card statuses (Support, Threat, etc.)
  newState.board = recalculateBoardStatuses(newState)

  // After board statuses are recalculated, recalculate ready statuses
  // This ensures cards gain/lose readySetup/readyCommit when Support changes
  recalculateAllReadyStatuses(newState)

  // LUCIUS PASSIVE: Remove any Stun tokens that somehow got on Lucius
  // This is a fail-safe after any state update
  newState = removeStunFromLucius(newState)

  return newState
}

/**
 * Check if player can perform this action
 */
function canPlayerAct(
  state: GameState,
  playerId: number,
  action: ActionType,
  _data?: any
): boolean {
  // Any player can do game settings in lobby
  if (!state.isGameStarted) {
    return ['PLAYER_READY', 'CHANGE_PLAYER_NAME', 'CHANGE_PLAYER_COLOR',
            'CHANGE_PLAYER_DECK', 'LOAD_CUSTOM_DECK', 'SET_GAME_MODE', 'SET_GRID_SIZE',
            'SET_PRIVACY', 'ASSIGN_TEAMS', 'SET_DUMMY_PLAYER_COUNT', 'SET_STRICT_RULES',
            'ANNOUNCE_CARD', 'RESET_GAME'].includes(action)
  }

  // RESET_GAME can always be performed (for restarting game)
  if (action === 'RESET_GAME') {
    return true
  }

  // Mulligan phase actions
  if (state.isMulliganActive) {
    return action === 'CONFIRM_MULLIGAN' || action === 'EXCHANGE_MULLIGAN_CARD'
  }

  // Players can change their settings
  if (action === 'CHANGE_PLAYER_NAME' || action === 'CHANGE_PLAYER_COLOR') {
    return true
  }

  // Dummy players can control all
  const player = state.players.find(p => p.id === playerId)
  if (player?.isDummy) {return true}

  // All other actions can be performed by any player
  // (cards can be moved any turn, phases can be switched by any player)
  return true
}

// ============================================================================
// Phase actions
// ============================================================================

/**
 * NEXT_PHASE - transition to next phase
 */
function handleNextPhase(state: GameState, _playerId: number): GameState {
  // RESURRECTED TOKEN: Process before phase change
  // All cards with Resurrected receive 2 Stun, then Resurrected is removed
  const stateAfterResurrected = processResurrectedTokens(state)

  const phase = stateAfterResurrected.currentPhase

  // Preparation (0) → Setup (1) - automatic, handled in passTurn
  if (phase === 0) {
    const newState = { ...stateAfterResurrected, currentPhase: 1, floatingTexts: [] }
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Setup (1) → Main (2) - happens when playing card
  if (phase === 1) {
    const newState = { ...stateAfterResurrected, currentPhase: 2, floatingTexts: [] }
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Main (2) → Commit (3)
  if (phase === 2) {
    const newState = { ...stateAfterResurrected, currentPhase: 3, floatingTexts: [] }
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Commit (3) → Scoring (4) or PassTurn
  if (phase === 3) {
    // Check if ACTIVE player has cards with "LastPlayed" status on board
    // We use state.activePlayerId, not playerId (who clicked the button)
    // This is important when Player A plays cards for Dummy Player B
    const activePlayerId = state.activePlayerId

    const player = stateAfterResurrected.players.find(p => p.id === activePlayerId)
    const isDummyPlayer = player?.isDummy ?? false

    // For dummy players, check if card belongs to them and has LastPlayed (any player could have added it)
    // For real players, check if card belongs to them AND was added by them this turn
    const hasLastPlayedCards = stateAfterResurrected.board.some(row =>
      row.some(cell => {
        if (cell.card?.ownerId !== activePlayerId) {return false}

        if (isDummyPlayer) {
          // Dummy player: check for any LastPlayed status (regardless of who added it)
          return cell.card?.statuses?.some(s => s.type === 'LastPlayed')
        } else {
          // Real player: only count cards they played themselves
          return cell.card?.statuses?.some(s => s.type === 'LastPlayed' && s.addedByPlayerId === activePlayerId)
        }
      })
    )

    if (hasLastPlayedCards) {
      // Has cards with LastPlayed status - enter Scoring and calculate lines
      return enterScoringPhase(stateAfterResurrected, activePlayerId ?? 0)
    } else {
      // No cards with LastPlayed status - pass turn to next player
      return handlePassTurn(stateAfterResurrected, activePlayerId ?? 0, 'no_new_cards')
    }
  }

  // Scoring (4) → PassTurn
  if (phase === 4) {
    // IMPORTANT: Use activePlayerId, not playerId (who clicked the button)
    // This ensures Stun is removed from the correct player's cards
    const activePlayerId = state.activePlayerId
    return handlePassTurn(stateAfterResurrected, activePlayerId ?? 0, 'scoring_complete')
  }

  return stateAfterResurrected
}

/**
 * Enter Scoring phase - calculate lines for highlighting
 */
function enterScoringPhase(state: GameState, playerId: number): GameState {
  // Find lines containing player's cards
  const lines = findScoringLinesWithPlayerCard(state, playerId)

  // Calculate points for each line
  const scoringLines: ScoringLineData[] = lines.map(line => ({
    playerId,
    lineType: line.type as any,
    lineIndex: line.index,
    score: calculateLineScore(state, playerId, line.type, line.index)
  }))

  return {
    ...state,
    currentPhase: 4,
    isScoringStep: true,
    scoringLines,
    floatingTexts: []  // Clear floating texts when entering scoring phase
  }
}

/**
 * PREVIOUS_PHASE - return to previous phase
 */
function handlePreviousPhase(state: GameState, _playerId: number): GameState {
  const phase = state.currentPhase

  if (phase > 1) {
    return { ...state, currentPhase: phase - 1 as any, floatingTexts: [] }
  }

  return state
}

/**
 * PASS_TURN - pass turn to next player
 */
function handlePassTurn(state: GameState, playerId: number, reason: string): GameState {
  const activePlayerIds = getActivePlayerIds(state)
  if (activePlayerIds.length === 0) {return state}

  const currentIndex = activePlayerIds.indexOf(state.activePlayerId || 1)
  const nextIndex = (currentIndex + 1) % activePlayerIds.length
  const nextPlayerId = activePlayerIds[nextIndex]

  // Check if player just finished scoring phase - remove 1 Stun token from each of their cards
  const scoringComplete = reason === 'scoring_complete'

  // Reset enteredThisTurn on all board cards when passing turn
  // Also clear setupUsedThisTurn and commitUsedThisTurn (but not deployUsedThisTurn!)
  const newBoard = state.board.map(row =>
    row.map(cell => {
      if (cell.card) {
        let newStatuses = cell.card.statuses?.filter((s: any) => {
          // Keep all statuses except setupUsedThisTurn and commitUsedThisTurn
          if (s.type === 'setupUsedThisTurn') {return false}
          if (s.type === 'commitUsedThisTurn') {return false}
          return true
        }) || []

        // After scoring, remove 1 Stun token from the player's own cards
        if (scoringComplete && cell.card.ownerId === playerId) {
          const stunIndex = newStatuses.findIndex((s: any) => s.type === 'Stun')
          if (stunIndex !== -1) {
            // Remove only the first Stun token
            newStatuses = newStatuses.filter((_: any, i: number) => i !== stunIndex)
          }
        }

        return {
          card: {
            ...cell.card,
            enteredThisTurn: false,
            statuses: newStatuses
          }
        }
      }
      return cell
    })
  )

  // IMPORTANT: Do NOT reset lastPlayedCardId when passing turn!
  // The lastPlayedCardId should persist as long as the card is on battlefield.
  // It's only cleared when the card leaves battlefield (handled by restoreLastPlayedToPreviousCard)
  const newPlayers = state.players.map(p => ({
    ...p
    // lastPlayedCardId is preserved
  })) as Player[]

  let newState: GameState = {
    ...state,
    board: newBoard,
    players: newPlayers,
    activePlayerId: nextPlayerId,
    currentPhase: 0,  // Preparation
    scoringLines: [],  // Clear scoring lines when passing turn
    floatingTexts: []  // Clear floating texts when passing turn
  }

  // Check full cycle (returned to starting player)
  if (nextPlayerId === state.startingPlayerId) {
    newState.turnNumber = (state.turnNumber || 0) + 1
  }

  // Preparation phase: auto-draw for new active player
  newState = executePreparationPhase(newState, nextPlayerId)

  return newState
}

/**
 * SET_PHASE - set specific phase
 */
function handleSetPhase(state: GameState, phaseNumber: number): GameState {
  const clamped = Math.max(0, Math.min(4, phaseNumber))
  const newState = { ...state, currentPhase: clamped }

  // When entering Preparation phase (0), clear setup/commit usage markers
  // This allows abilities to be used again in the new turn
  if (clamped === 0) {
    newState.board = newState.board.map(row =>
      row.map(cell => {
        if (cell.card) {
          const newStatuses = cell.card.statuses?.filter((s: any) => {
            // Remove only setupUsedThisTurn and commitUsedThisTurn
            // Keep deployUsedThisTurn (only clears when card leaves battlefield)
            if (s.type === 'setupUsedThisTurn') {return false}
            if (s.type === 'commitUsedThisTurn') {return false}
            return true
          }) || []

          return {
            ...cell,
            card: { ...cell.card, statuses: newStatuses }
          }
        }
        return cell
      })
    )
  }

  // When entering Scoring phase (4), initialize scoring mode
  if (clamped === 4) {
    // Use activePlayerId for scoring, or default to player 1
    const scoringPlayerId = state.activePlayerId || 1
    return enterScoringPhase(newState, scoringPlayerId)
  }

  // Clear scoring mode when leaving scoring phase (4)
  // If setting any phase other than scoring, close scoring selection
  if (clamped !== 4) {
    newState.isScoringStep = false
    newState.scoringLines = []
  }

  // Clear floating texts when changing phase
  newState.floatingTexts = []

  recalculateAllReadyStatuses(newState)
  return newState
}

/**
 * Preparation phase - auto-draw and check round end
 */
function executePreparationPhase(state: GameState, activePlayerId: number): GameState {
  let newState = { ...state }
  const playerIndex = newState.players.findIndex(p => p.id === activePlayerId)

  if (playerIndex === -1) {return state}
  const player = newState.players[playerIndex]

  // Clear lateness effect at the start of player's turn
  // This allows all cards in hand to be playable again
  const updatedPlayer = { ...player, hasLateness: false }
  newState.players[playerIndex] = updatedPlayer

  // Auto-draw if enabled and deck has cards
  if (state.autoDrawEnabled && updatedPlayer.deck && updatedPlayer.deck.length > 0) {
    const drawnCard = updatedPlayer.deck.shift()
    if (drawnCard) {
      newState.players[playerIndex].hand.push(drawnCard)
      newState.players[playerIndex].handSize = newState.players[playerIndex].hand.length
      newState.players[playerIndex].deckSize = newState.players[playerIndex].deck.length
    }
  }

  // Check round end - ONLY for starting player, at the end of Preparation phase
  // This ensures round only ends when starting player's turn comes back around
  if (activePlayerId === newState.startingPlayerId && shouldRoundEnd(newState)) {
    newState = endRound(newState)
    return newState
  }

  // Transition to Setup
  newState.currentPhase = 1

  // Clear floating texts when transitioning to Setup
  newState.floatingTexts = []

  // Recalculate ready statuses for new active player in Setup phase
  recalculateAllReadyStatuses(newState)

  return newState
}

// ============================================================================
// Card actions
// ============================================================================

/**
 * PLAY_CARD - play card from hand to board
 * Also supports direct card parameter for playing from deck/discard
 * Supports fromDiscard parameter for Lucius's passive (+2 power if exited from Discard)
 */
function handlePlayCard(state: GameState, playerId: number, data: any): GameState {
  const { card, cardIndex, boardCoords, faceDown = false, playerId: targetPlayerId, fromDiscard = false, clearLatenessOnNextPlay = false } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || !boardCoords) {return state}

  // Check if target cell is already occupied - if so, do nothing
  const targetCell = state.board[boardCoords.row]?.[boardCoords.col]
  if (targetCell?.card) {
    // Cell is occupied, return state unchanged
    return state
  }

  let cardToPlay: Card | null = null
  let newHand = player.hand
  let newHandSize = player.hand.length
  let isFromHand = false  // Track if card comes from hand (not deck/discard)

  // If card is passed directly (from deck/discard), use it
  if (card) {
    cardToPlay = card
    // Hand remains unchanged when playing from deck/discard
    isFromHand = false
  } else {
    // Otherwise, get card from hand
    const cardIndexNum = cardIndex ?? player.hand.length - 1
    cardToPlay = player.hand[cardIndexNum]

    if (!cardToPlay) {return state}

    // Remove card from hand
    newHand = [...player.hand]
    newHand.splice(cardIndexNum, 1)
    newHandSize = newHand.length
    isFromHand = true
  }

  if (!cardToPlay) {return state}

  // LastPlayed status transfers to newly played cards (only one card has LastPlayed at a time)
  // This ensures the most recently played card is the one used for scoring
  // The status persists while the card is on the battlefield
  const boardWithoutLastPlayed = isFromHand ? state.board.map((row, _r) =>
    row.map((cell, _c) => {
      if (cell.card?.ownerId === actualPlayerId && cell.card?.statuses) {
        const filteredStatuses = cell.card.statuses.filter(s => !(s.type === 'LastPlayed' && s.addedByPlayerId === actualPlayerId))
        if (filteredStatuses.length !== cell.card.statuses.length) {
          return {
            card: {
              ...cell.card,
              statuses: filteredStatuses
            }
          }
        }
      }
      return cell
    })
  ) : state.board

  // Add card to board with LastPlayed status (only if from hand)
  const wasSetupPhase = state.currentPhase === 1
  const newBoard = boardWithoutLastPlayed.map((row, r) =>
    row.map((cell, c) => {
      if (r === boardCoords.row && c === boardCoords.col) {
        const existingStatuses = cardToPlay.statuses || []
        // Remove any existing LastPlayed status from this card (to avoid duplicates)
        const filteredStatuses = existingStatuses.filter((s: any) => !(s.type === 'LastPlayed' && s.addedByPlayerId === actualPlayerId))

        // Add LastPlayed status only when card is played from hand
        // This status is used to determine if player can enter scoring phase
        let finalStatuses = isFromHand
          ? [...filteredStatuses, { type: 'LastPlayed', addedByPlayerId: actualPlayerId }]
          : filteredStatuses

        // SPECIAL CASE: If played during Setup phase and card has Setup ability,
        // add readySetup status so it can be used even after phase switches to Main
        // This allows cards like Finn to use their "Move 1 allied card" ability upon entering
        if (wasSetupPhase && !faceDown) {
          const cardDef = getCardDefinition(cardToPlay.baseId ?? '')
          if (cardDef && (cardDef as any).ABILITIES?.some((a: any) => a.type === 'setup')) {
            finalStatuses = [...finalStatuses, { type: 'readySetup', addedByPlayerId: actualPlayerId }]
          }
        }

        // LUCIUS PASSIVE: +2 power if exited from Discard
        let powerModifier = 0
        if (fromDiscard && isLucius(cardToPlay)) {
          powerModifier = 2
        }

        // Create new card object - set powerModifier AFTER spread to ensure it's applied
        const boardCard = {
          ...cardToPlay,
          ownerId: actualPlayerId,
          isFaceDown: faceDown,
          enteredThisTurn: true,
          statuses: finalStatuses,
          powerModifier: (cardToPlay.powerModifier || 0) + powerModifier  // Set last to override any existing value
        }

        return {
          card: boardCard
        }
      }
      return cell
    })
  )

  // Add to boardHistory and update lastPlayedCardId only if from hand
  const newBoardHistory = isFromHand ? [...player.boardHistory, cardToPlay.id] : player.boardHistory
  const newLastPlayedCardId = isFromHand ? cardToPlay.id : player.lastPlayedCardId

  // Lateness effect: When a non-command card is played from hand to board,
  // all other non-command cards in that player's hand get lateness effect
  // Command cards are excluded from triggering lateness
  // EXCEPTION: clearLatenessOnNextPlay flag (Quick Response Team option 1) clears lateness instead of setting it
  // EXCEPTION: strictRulesEnabled = false disables lateness effect entirely
  const isCommandCard = isCommandCardByDefinition(cardToPlay)
  const strictRulesEnabled = state.strictRulesEnabled ?? true // Default to true if undefined
  const shouldTriggerLateness = isFromHand && !isCommandCard && strictRulesEnabled
  // When clearLatenessOnNextPlay is true, clear hasLateness instead of setting it
  const newHasLateness = clearLatenessOnNextPlay ? false : shouldTriggerLateness

  // Update player
  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? {
          ...p,
          hand: newHand,
          handSize: newHandSize,
          boardHistory: newBoardHistory,
          lastPlayedCardId: newLastPlayedCardId,
          hasLateness: newHasLateness
        }
      : p
  )

  // Switch to Main phase (2) - this should happen before ready status recalculation
  // Note: isCommandCard was already calculated above (line 1107) for lateness logic
  // Command cards go through announce → discard flow and should NOT trigger phase switch here
  // CRITICAL: Command cards do NOT switch phase here - they switch when moved to discard
  let newState: GameState = {
    ...state,
    board: newBoard,
    players: newPlayers,
    currentPhase: isCommandCard ? state.currentPhase : 2  // Command cards keep current phase, others go to Main
  }

  // Clear scoring mode if somehow active
  newState.isScoringStep = false
  newState.scoringLines = []

  // Recalculate ready statuses AFTER phase switch
  // This ensures cards get correct ready statuses for the new phase
  recalculateAllReadyStatuses(newState)

  // VIGILANT SPOTTER TRIGGER: Check if the played card has Revealed status
  // If so, check for Vigilant Spotters with Support on the battlefield
  // The trigger should only fire for non-command cards played to the battlefield from hand
  const cardData = data?.card
  console.log('[handlePlayCard] Vigilant Spotter check - isFromHand:', isFromHand, 'isCommandCard:', isCommandCard, 'faceDown:', faceDown, 'card:', cardData?.name || cardData?.baseId)
  if (isFromHand && !isCommandCard && !faceDown) {
    // Get the card from the new board to check for Revealed status
    const boardCard = newState.board[boardCoords.row][boardCoords.col]?.card
    if (boardCard) {
      const hasRevealed = boardCard.statuses?.some((s: any) => s.type === 'Revealed')
      console.log('[handlePlayCard] Board card:', boardCard.name, 'at [', boardCoords.row, ',', boardCoords.col, '] hasRevealed:', hasRevealed, 'statuses:', boardCard.statuses)
      if (hasRevealed) {
        newState = checkVigilantSpotterTrigger(newState, boardCard, 'handlePlayCard')
      } else {
        console.log('[handlePlayCard] Skipping Vigilant Spotter trigger - no Revealed status on board card')
      }
    } else {
      console.log('[handlePlayCard] WARNING - No board card found at [', boardCoords.row, ',', boardCoords.col, ']')
    }
  } else {
    const skipReason = !isFromHand ? 'not from hand' : isCommandCard ? 'is command card' : 'face down'
    console.log('[handlePlayCard] Skipping Vigilant Spotter trigger -', skipReason)
  }

  return newState
}

/**
 * MOVE_CARD_ON_BOARD - move card from one cell to another
 */
function handleMoveCardOnBoard(state: GameState, playerId: number, data: any): GameState {
  const timestamp = Date.now()
  const { fromCoords, toCoords, faceDown, targetingMode, contextCardId: directContextCardId } = data || {}


  if (!fromCoords || !toCoords) {
    return state
  }

  const fromRow = fromCoords.row
  const fromCol = fromCoords.col
  const toRow = toCoords.row
  const toCol = toCoords.col

  // Check boundaries - use actual board size (always 7x7), not activeGridSize
  // Coordinates are actual board indices, activeGridSize is only for visual rendering
  const boardSize = state.board.length
  if (fromRow < 0 || fromRow >= boardSize || fromCol < 0 || fromCol >= boardSize) {
    return state
  }
  if (toRow < 0 || toRow >= boardSize || toCol < 0 || toCol >= boardSize) {
    return state
  }

  // Check if source cell contains card
  const sourceCard = state.board[fromRow]?.[fromCol]?.card
  if (!sourceCard) {
    // Show what cards are on the board
    state.board.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell.card) {
        }
      })
    })
    return state
  }

  // Check if target cell is empty
  const targetCell = state.board[toRow]?.[toCol]
  if (!targetCell || targetCell.card) {
    return state
  }


  // STUN RULE: If card is stunned and owner tries to move it, skip movement but apply other effects
  const isStunned = sourceCard.statuses?.some((s: any) => s.type === 'Stun')
  const isOwnedByMover = sourceCard.ownerId === playerId
  const skipMovement = isStunned && isOwnedByMover

  if (skipMovement) {
    // Skip movement but still process token placement (other effects) below
    // We keep the original state.board since no movement occurred
    let newState = { ...state }

    // CRITICAL: Handle token placement on the (non-moved) card (False Orders Option 1: Stun x2)
    // The card stays at fromCoords, not toCoords
    const payload = targetingMode?.chainedAction?.payload || targetingMode?.action?.chainedAction?.payload || targetingMode?.action?.payload?.chainedAction?.payload
    const contextCardId = directContextCardId || payload?.contextCardId
    const tokenType = payload?.tokenType
    const count = payload?.count
    const ownerId = payload?.ownerId

    if (tokenType && count && contextCardId) {
      // Find the card by ID - it's at fromCoords since movement was skipped
      const cardAtSource = state.board[fromRow]?.[fromCol]?.card
      if (cardAtSource && cardAtSource.id === contextCardId) {
        const targetCoords = { row: fromRow, col: fromCol }
        for (let i = 0; i < count; i++) {
          newState = handleAddStatusToBoardCard(newState, playerId, {
            boardCoords: targetCoords,
            statusType: tokenType,
            ownerId: ownerId || playerId,
            count: 1,
          })
        }
      }
    }

    return newState
  }

  // Move card
  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      // Clear source cell
      if (r === fromRow && c === fromCol) {
        return { card: null }
      }
      // Place card in new cell
      if (r === toRow && c === toCol) {
        const movedCard = {
          ...sourceCard,
          isFaceDown: faceDown !== undefined ? faceDown : sourceCard.isFaceDown
        }
        return { card: movedCard }
      }
      return cell
    })
  )

  let newState = { ...state, board: newBoard }

  // CRITICAL: Handle token placement on moved card (False Orders Option 1: Stun x2)
  // Check direct contextCardId first (from actionData), then fall back to chainedAction.payload
  const payload = targetingMode?.chainedAction?.payload || targetingMode?.action?.chainedAction?.payload || targetingMode?.action?.payload?.chainedAction?.payload
  const contextCardId = directContextCardId || payload?.contextCardId
  const tokenType = payload?.tokenType
  const count = payload?.count
  const ownerId = payload?.ownerId

  if (tokenType && count && contextCardId) {

    // Find the moved card by ID
    let targetCoords: { row: number; col: number } | null = null
    for (let r = 0; r < newState.board.length; r++) {
      for (let c = 0; c < newState.board[r].length; c++) {
        const card = newState.board[r][c].card
        if (card && card.id === contextCardId) {
          targetCoords = { row: r, col: c }
          break
        }
      }
      if (targetCoords) {
        break
      }
    }

    if (!targetCoords && sourceCard) {
      // Fallback: try to find card by sourceCard.id
      for (let r = 0; r < newState.board.length; r++) {
        for (let c = 0; c < newState.board[r].length; c++) {
          const card = newState.board[r][c].card
          if (card && card.id === sourceCard.id) {
            targetCoords = { row: r, col: c }
            break
          }
        }
        if (targetCoords) {
          break
        }
      }
    }

    if (targetCoords) {
      // Add the tokens using handleAddStatusToBoardCard
      for (let i = 0; i < count; i++) {
        newState = handleAddStatusToBoardCard(newState, playerId, {
          boardCoords: targetCoords,
          statusType: tokenType,
          ownerId: ownerId || playerId,
          count: 1,
        })
      }
    }
  }

  // NOTE: Context rewards (DRAW_MOVED_POWER, SCORE_MOVED_POWER) are now handled by the client
  // The client calls handleContextReward which sends DRAW_CARDS_BATCH and UPDATE_SCORE messages
  // This prevents double-drawing/double-scoring when the host processes MOVE_CARD_ON_BOARD
  // Token placement from chainedAction is still handled below

  // Handle token placement from chainedAction (fallback if not handled above)
  if (!contextCardId && targetingMode) {
    const chainedAction = targetingMode?.chainedAction || targetingMode?.action?.chainedAction || targetingMode?.action?.payload?.chainedAction

    if (chainedAction) {
      const chainedPayload = chainedAction.payload

      if (chainedPayload?.tokenType && chainedPayload?.count && chainedPayload?.contextCardId && !contextCardId) {

        // Find the moved card by ID
        let targetCoords: { row: number; col: number } | null = null
        for (let r = 0; r < newState.board.length; r++) {
          for (let c = 0; c < newState.board[r].length; c++) {
            const card = newState.board[r][c].card
            if (card && card.id === chainedPayload.contextCardId) {
              targetCoords = { row: r, col: c }
              break
            }
          }
          if (targetCoords) {
            break
          }
        }

        if (targetCoords) {
          // Add the tokens using handleAddStatusToBoardCard
          for (let i = 0; i < chainedPayload.count; i++) {
            newState = handleAddStatusToBoardCard(newState, playerId, {
              boardCoords: targetCoords,
              statusType: chainedPayload.tokenType,
              ownerId: chainedPayload.ownerId || playerId,
              count: 1,
            })
          }
        }
      }
    }
  }

  // Clear targeting mode after move
  if (targetingMode) {
    newState = { ...newState, targetingMode: null }
  }

  // DEBUG: Check what's in the new board at fromCoords and toCoords
  const cardAtFrom = newState.board[fromRow]?.[fromCol]?.card
  const cardAtTo = newState.board[toRow]?.[toCol]?.card

  return newState
}

/**
 * MOVE_CARD - move card
 */
function handleMoveCard(state: GameState, _playerId: number, _data: any): GameState {
  // TODO: implement card movement
  return state
}

/**
 * RETURN_CARD_TO_HAND - return card to hand
 */
function handleReturnCardToHand(state: GameState, playerId: number, data: any): GameState {
  const { cardId } = data || {}
  if (!cardId) {return state}

  let cardToReturn: Card | null = null
  let sourceCoords: { row: number; col: number } | null = null

  // Находим карту на доске
  // IMPORTANT: Check if card has LastPlayed status BEFORE clearing it
  let hadLastPlayedBeforeClear = false
  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      if (cell.card?.id === cardId) {
        const foundCard = cell.card
        if (foundCard) {
          cardToReturn = foundCard
          sourceCoords = { row: r, col: c }
          // Check for LastPlayed status BEFORE clearing (needed for lateness effect)
          hadLastPlayedBeforeClear = foundCard.statuses?.some(
            s => s.type === 'LastPlayed' && s.addedByPlayerId === foundCard.ownerId
          ) ?? false
          // Clear all statuses except Revealed and reset power when card leaves battlefield
          clearAllStatusesExceptRevealed(foundCard)
        }
        return { card: null }
      }
      return cell
    })
  )

  if (!cardToReturn || !sourceCoords) {return state}

  // STUN RULE: If player tries to return THEIR OWN stunned card to hand, prevent it
  const isStunned = (cardToReturn as Card).statuses?.some((s: any) => s.type === 'Stun')
  const isOwned = (cardToReturn as Card).ownerId === playerId
  if (isStunned && isOwned) {
    return state
  }

  // Add to owner's hand
  // cardToReturn is non-null here due to the check above
  const finalCard: Card = cardToReturn
  const ownerId = finalCard.ownerId ?? playerId
  const newPlayers = state.players.map(p => {
    if (p.id === ownerId) {
      return {
        ...p,
        hand: [...p.hand, finalCard],
        handSize: p.hand.length + 1
      }
    }
    return p
  })

  // Restore LastPlayed to previous card if this card had it
  let updatedState = { ...state, board: newBoard, players: newPlayers as Player[] }
  updatedState = restoreLastPlayedToPreviousCard(updatedState, finalCard, ownerId, hadLastPlayedBeforeClear)

  return updatedState
}

/**
 * MOVE_CARD_TO_HAND - move card from board/discard/deck to hand
 */
function handleMoveCardToHand(state: GameState, playerId: number, data: any): GameState {
  const { cardId, source, cardIndex: dataCardIndex, playerId: dataPlayerId } = data || {}
  if (!cardId) {return state}

  let cardToMove: Card | null = null
  // Use data.playerId if provided, otherwise fall back to sender's playerId
  let targetPlayerId = dataPlayerId ?? playerId
  let sourcePlayerId: number | undefined = undefined // Track source player separately
  let newBoard = state.board
  let newDiscard: Card[] | null = null
  let newDeck: Card[] | null = null
  let newState = state
  let cardFromBoard: Card | null = null // Track if card came from board for LastPlayed restoration
  let ownerIdFromBoard: number | null = null

  if (source === 'board') {
    newBoard = state.board.map((row, _r) =>
      row.map((cell, _c) => {
        if (cell.card?.id === cardId) {
          const foundCard = cell.card
          if (foundCard) {
            cardToMove = foundCard
            // Save a copy with original statuses BEFORE clearing
            cardFromBoard = { ...foundCard, statuses: [...(foundCard.statuses || [])] }
            ownerIdFromBoard = foundCard.ownerId || playerId
            targetPlayerId = foundCard.ownerId || playerId
            sourcePlayerId = foundCard.ownerId || playerId
            // Clear all statuses except Revealed when card leaves battlefield to hand
            clearAllStatusesExceptRevealed(foundCard)
          }
          return { card: null }
        }
        return cell
      })
    )

    // STUN RULE: If player tries to move THEIR OWN stunned card from board to hand, prevent it
    if (cardFromBoard && ownerIdFromBoard !== null) {
      const isStunned = (cardFromBoard as Card).statuses?.some((s: any) => s.type === 'Stun')
      const isOwnedByMover = ownerIdFromBoard === playerId
      if (isStunned && isOwnedByMover) {
            return state
      }
    }
  } else if (source === 'discard') {
    // Use data.playerId if provided, otherwise fall back to sender's playerId
    sourcePlayerId = dataPlayerId ?? playerId
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    const idx = player.discard?.findIndex(c => c.id === cardId)
    if (idx === undefined || idx === -1) {return state}
    cardToMove = player.discard[idx]
    targetPlayerId = sourcePlayerId
    newDiscard = [...player.discard]
    newDiscard.splice(idx, 1)
    // Clear ALL statuses including Revealed when card moves from discard to hand
    clearAllStatuses(cardToMove)
  } else if (source === 'deck') {
    // Use data.playerId if provided, otherwise fall back to sender's playerId
    sourcePlayerId = dataPlayerId ?? playerId
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player || !player.deck) {return state}
    // For deck, use cardIndex if provided, otherwise find by cardId
    let idx = dataCardIndex
    if (idx === undefined) {
      idx = player.deck.findIndex(c => c.id === cardId)
    }
    if (idx === undefined || idx === -1) {return state}
    cardToMove = player.deck[idx]
    targetPlayerId = sourcePlayerId
    // Update player deck by removing card
    newDeck = [...player.deck]
    newDeck.splice(idx, 1)
    // Update players array with new deck
    const playersWithUpdatedDeck = newState.players.map(p =>
      p.id === sourcePlayerId ? { ...p, deck: newDeck!, deckSize: newDeck!.length } : p
    )
    newState = { ...newState, players: playersWithUpdatedDeck as Player[] }
    // Clear ALL statuses including Revealed when card moves from deck to hand
    clearAllStatuses(cardToMove)
  }

  if (!cardToMove) {return newState}

  // If card is a token, destroy it instead of adding to hand
  if (isToken(cardToMove)) {
    // Token is removed from source and not added to destination
    // Still restore LastPlayed if token had it
    let resultState = { ...newState, board: newBoard, players: newState.players.map(p => {
      // Update discard for the source player
      if (sourcePlayerId !== undefined && p.id === sourcePlayerId && newDiscard !== null) {
        return { ...p, discard: newDiscard, discardSize: newDiscard.length }
      }
      return p
    })}
    if (cardFromBoard && ownerIdFromBoard !== null) {
      resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
    }
    return resultState
  }

  const newPlayers = newState.players.map(p => {
    // Update hand for the target player
    if (p.id === targetPlayerId) {
      const newHand = [...p.hand, cardToMove]
      const updates: any = { hand: newHand, handSize: newHand.length }
      // Also update discard if source and target are the same player
      if (sourcePlayerId !== undefined && p.id === sourcePlayerId && newDiscard !== null) {
        updates.discard = newDiscard
        updates.discardSize = newDiscard.length
      }
      return { ...p, ...updates }
    }
    // Update discard for the source player (different from target player)
    if (sourcePlayerId !== undefined && p.id === sourcePlayerId && newDiscard !== null) {
      return { ...p, discard: newDiscard, discardSize: newDiscard.length }
    }
    return p
  })

  let resultState = { ...newState, board: newBoard, players: newPlayers as Player[] }
  // Restore LastPlayed if card came from board
  if (cardFromBoard && ownerIdFromBoard !== null) {
    resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
  }
  return resultState
}

/**
 * MOVE_CARD_TO_DECK - move card from board/hand/discard to deck
 */
function handleMoveCardToDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardId, cardIndex, source, playerId: dataPlayerId } = data || {}
  // Use data.playerId if provided, otherwise fall back to sender's playerId
  const sourcePlayerId = dataPlayerId ?? playerId
  let cardToMove: Card | null = null
  let targetPlayerId = sourcePlayerId
  let newBoard = state.board
  let newHand: Card[] | null = null
  let newDiscard: Card[] | null = null
  let cardFromBoard: Card | null = null
  let ownerIdFromBoard: number | null = null

  if (source === 'board') {
    if (!cardId) {return state}
    newBoard = state.board.map((row, _r) =>
      row.map((cell, _c) => {
        if (cell.card?.id === cardId) {
          const foundCard = cell.card
          if (foundCard) {
            cardToMove = foundCard
            // Save a copy with original statuses BEFORE clearing
            cardFromBoard = { ...foundCard, statuses: [...(foundCard.statuses || [])] }
            ownerIdFromBoard = foundCard.ownerId || playerId
            targetPlayerId = foundCard.ownerId || playerId
            // Clear ALL statuses including Revealed when card leaves battlefield to deck/discard
            clearAllStatuses(foundCard)
          }
          return { card: null }
        }
        return cell
      })
    )
  } else if (source === 'hand') {
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    let idx: number
    if (cardIndex !== undefined) {
      idx = cardIndex
    } else {
      if (!cardId) {return state}
      idx = player.hand?.findIndex(c => c.id === cardId) ?? -1
    }
    if (idx < 0 || idx >= (player.hand?.length || 0)) {return state}
    cardToMove = player.hand[idx]
    targetPlayerId = sourcePlayerId
    newHand = [...player.hand]
    newHand.splice(idx, 1)
    // Clear ALL statuses including Revealed when card goes to deck
    clearAllStatuses(cardToMove)
  } else if (source === 'discard') {
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    let idx: number
    if (cardIndex !== undefined) {
      idx = cardIndex
    } else {
      if (!cardId) {return state}
      idx = player.discard?.findIndex(c => c.id === cardId) ?? -1
    }
    if (idx < 0 || idx >= (player.discard?.length || 0)) {return state}
    cardToMove = player.discard[idx]
    targetPlayerId = sourcePlayerId
    newDiscard = [...player.discard]
    newDiscard.splice(idx, 1)
    // Clear ALL statuses including Revealed when card goes to deck
    clearAllStatuses(cardToMove)
  } else if (source === 'deck') {
    // Moving from deck to deck (should be a no-op or reorder, but handle it)
    return state
  }

  if (!cardToMove) {return state}

  // If card is a token, destroy it instead of adding to deck
  if (isToken(cardToMove)) {
    // Token is removed from source and not added to destination
    let resultState = { ...state, board: newBoard, players: state.players.map(p => {
      if (p.id === sourcePlayerId) {
        const updates: any = {}
        if (newHand !== null) {
          updates.hand = newHand
          updates.handSize = newHand.length
        }
        if (newDiscard !== null) {
          updates.discard = newDiscard
          updates.discardSize = newDiscard.length
        }
        return { ...p, ...updates }
      }
      return p
    })}
    if (cardFromBoard && ownerIdFromBoard !== null) {
      resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
    }
    return resultState
  }

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      const updates: any = {}
      // Add card to deck
      const newDeck = [cardToMove, ...(p.deck || [])]
      updates.deck = newDeck
      updates.deckSize = newDeck.length

      // If source and target are the same player, also update source arrays
      if (p.id === sourcePlayerId) {
        if (newHand !== null) {
          updates.hand = newHand
          updates.handSize = newHand.length
        }
        if (newDiscard !== null) {
          updates.discard = newDiscard
          updates.discardSize = newDiscard.length
        }
      }
      return { ...p, ...updates }
    }
    if (p.id === sourcePlayerId && p.id !== targetPlayerId) {
      const updates: any = {}
      if (newHand !== null) {
        updates.hand = newHand
        updates.handSize = newHand.length
      }
      if (newDiscard !== null) {
        updates.discard = newDiscard
        updates.discardSize = newDiscard.length
      }
      return { ...p, ...updates }
    }
    return p
  })

  let resultState = { ...state, board: newBoard, players: newPlayers as Player[] }
  if (cardFromBoard && ownerIdFromBoard !== null) {
    resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
  }
  return resultState
}

/**
 * MOVE_CARD_TO_DISCARD - move card from board/hand/deck to discard
 */
function handleMoveCardToDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardId, cardIndex, source, playerId: dataPlayerId } = data || {}
  // Use data.playerId if provided, otherwise fall back to sender's playerId
  const sourcePlayerId = dataPlayerId ?? playerId
  let cardToMove: Card | null = null
  let targetPlayerId = sourcePlayerId
  let newBoard = state.board
  let newHand: Card[] | null = null
  let newDeck: Card[] | null = null
  let cardFromBoard: Card | null = null
  let ownerIdFromBoard: number | null = null

  if (source === 'board') {
    if (!cardId) {return state}
    newBoard = state.board.map((row, _r) =>
      row.map((cell, _c) => {
        if (cell.card?.id === cardId) {
          const foundCard = cell.card
          if (foundCard) {
            cardToMove = foundCard
            // Save a copy with original statuses BEFORE clearing
            cardFromBoard = { ...foundCard, statuses: [...(foundCard.statuses || [])] }
            ownerIdFromBoard = foundCard.ownerId || playerId
            targetPlayerId = foundCard.ownerId || playerId
            // Clear ALL statuses including Revealed when card leaves battlefield to deck/discard
            clearAllStatuses(foundCard)
          }
          return { card: null }
        }
        return cell
      })
    )
  } else if (source === 'hand') {
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    let idx: number
    if (cardIndex !== undefined) {
      idx = cardIndex
    } else {
      if (!cardId) {return state}
      idx = player.hand?.findIndex(c => c.id === cardId) ?? -1
    }
    if (idx < 0 || idx >= (player.hand?.length || 0)) {return state}
    cardToMove = player.hand[idx]
    targetPlayerId = sourcePlayerId
    newHand = [...player.hand]
    newHand.splice(idx, 1)
    // Clear ALL statuses including Revealed when card goes to discard
    clearAllStatuses(cardToMove)
  } else if (source === 'deck') {
    const player = state.players.find(p => p.id === sourcePlayerId)
    if (!player) {return state}
    let idx: number
    if (cardIndex !== undefined) {
      idx = cardIndex
    } else {
      if (!cardId) {return state}
      idx = player.deck?.findIndex(c => c.id === cardId) ?? -1
    }
    if (idx < 0 || idx >= (player.deck?.length || 0)) {return state}
    cardToMove = player.deck[idx]
    targetPlayerId = sourcePlayerId
    newDeck = [...player.deck]
    newDeck.splice(idx, 1)
    // Clear ALL statuses including Revealed when card goes to discard
    clearAllStatuses(cardToMove)
  } else if (source === 'discard') {
    // Moving from discard to discard (should be a no-op or reorder, but handle it)
    return state
  }

  if (!cardToMove) {return state}

  // If card is a token, destroy it instead of adding to discard
  if (isToken(cardToMove)) {
    // Token is removed from source and not added to destination
    let resultState = { ...state, board: newBoard, players: state.players.map(p => {
      if (p.id === sourcePlayerId) {
        const updates: any = {}
        if (newHand !== null) {
          updates.hand = newHand
          updates.handSize = newHand.length
        }
        if (newDeck !== null) {
          updates.deck = newDeck
          updates.deckSize = newDeck.length
        }
        return { ...p, ...updates }
      }
      return p
    })}
    if (cardFromBoard && ownerIdFromBoard !== null) {
      resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
    }
    return resultState
  }

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      const updates: any = {}
      // Add card to discard
      const newDiscard = [...(p.discard || []), cardToMove]
      updates.discard = newDiscard
      updates.discardSize = newDiscard.length

      // If source and target are the same player, also update source arrays
      if (p.id === sourcePlayerId) {
        if (newHand !== null) {
          updates.hand = newHand
          updates.handSize = newHand.length
        }
        if (newDeck !== null) {
          updates.deck = newDeck
          updates.deckSize = newDeck.length
        }
      }
      return { ...p, ...updates }
    }
    if (p.id === sourcePlayerId && p.id !== targetPlayerId) {
      const updates: any = {}
      if (newHand !== null) {
        updates.hand = newHand
        updates.handSize = newHand.length
      }
      if (newDeck !== null) {
        updates.deck = newDeck
        updates.deckSize = newDeck.length
      }
      return { ...p, ...updates }
    }
    return p
  })

  let resultState = { ...state, board: newBoard, players: newPlayers as Player[] }
  if (cardFromBoard && ownerIdFromBoard !== null) {
    resultState = restoreLastPlayedToPreviousCard(resultState, cardFromBoard, ownerIdFromBoard)
  }
  return resultState
}

/**
 * MOVE_HAND_CARD_TO_DECK - move card from hand to deck
 */
function handleMoveHandCardToDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || cardIndex === undefined || cardIndex < 0 || cardIndex >= player.hand.length) {
    return state
  }

  const cardToMove = player.hand[cardIndex]
  const newHand = [...player.hand]
  newHand.splice(cardIndex, 1)

  // If card is a token, destroy it instead of adding to deck
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, hand: newHand, handSize: newHand.length }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Clear ALL statuses including Revealed when card goes to deck
  clearAllStatuses(cardToMove)

  const newDeck = [cardToMove, ...player.deck]

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, hand: newHand, handSize: newHand.length, deck: newDeck, deckSize: newDeck.length }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_HAND_CARD_TO_DISCARD - move card from hand to discard
 */
function handleMoveHandCardToDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || cardIndex === undefined || cardIndex < 0 || cardIndex >= player.hand.length) {
    return state
  }

  const cardToMove = player.hand[cardIndex]
  const newHand = [...player.hand]
  newHand.splice(cardIndex, 1)

  // If card is a token, destroy it instead of adding to discard
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, hand: newHand, handSize: newHand.length }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Clear ALL statuses including Revealed when card goes to discard
  clearAllStatuses(cardToMove)

  const newDiscard = [...player.discard, cardToMove]

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, hand: newHand, handSize: newHand.length, discard: newDiscard, discardSize: newDiscard.length }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_ANNOUNCED_TO_HAND - move card from showcase to hand
 */
function handleMoveAnnouncedToHand(state: GameState, playerId: number, data: any): GameState {
  const { playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.announcedCard) {return state}

  const cardToMove = player.announcedCard

  // If card is a token, destroy it instead of adding to hand
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, announcedCard: null }
        : p
    )
    return { ...state, players: newPlayers }
  }

  const newHand = [...player.hand, cardToMove]

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, hand: newHand, handSize: newHand.length, announcedCard: null }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_ANNOUNCED_TO_DECK - move card from showcase to deck
 */
function handleMoveAnnouncedToDeck(state: GameState, playerId: number, data: any): GameState {
  const { playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.announcedCard) {return state}

  const cardToMove = player.announcedCard

  // If card is a token, destroy it instead of adding to deck
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, announcedCard: null }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // Clear ALL statuses including Revealed when card goes to deck
  clearAllStatuses(cardToMove)

  const newDeck = [cardToMove, ...player.deck]

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, deck: newDeck, deckSize: newDeck.length, announcedCard: null }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * MOVE_ANNOUNCED_TO_DISCARD - move card from showcase to discard
 */
function handleMoveAnnouncedToDiscard(state: GameState, playerId: number, data: any): GameState {

  const { playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.announcedCard) {return state}

  const cardToMove = player.announcedCard

  // If card is a token, destroy it instead of adding to discard
  if (isToken(cardToMove)) {
    const newPlayers = state.players.map(p =>
      p.id === actualPlayerId
        ? { ...p, announcedCard: null }
        : p
    )
    return { ...state, players: newPlayers }
  }

  // NOTE: Trigger check removed from handleMoveAnnouncedToDiscard to prevent duplication
  // Triggers for command cards with Revealed status are now ONLY checked in handleCleanupCommandAction
  // This fixes the issue where some commands (Logistics Chain, Temporary Shelter) would trigger twice:
  // once at the start of play and once at cleanup
  //
  // The trigger system now ensures Vigilant Spotter only triggers ONCE per command card:
  // - In the final CLEANUP_COMMAND step when the revealed command card is discarded
  // - NOT in handleMoveAnnouncedToDiscard (which is legacy/deprecated)
  //
  // If handleMoveAnnouncedToDiscard is still being called (old code path), it should NOT check triggers
  // because handleCleanupCommandAction will be called separately and check triggers there.

  const isCommandCard = isCommandCardByDefinition(cardToMove)

  // Check if command has Revealed status from ANY player
  const hasAnyRevealedStatus = cardToMove.statuses?.some((s: any) => s.type === 'Revealed')

  console.log('[handleMoveAnnouncedToDiscard] Command card:', cardToMove.name, 'hasRevealedStatus:', hasAnyRevealedStatus, 'statuses:', cardToMove.statuses, '- SKIPPING trigger check (handled by handleCleanupCommandAction)')

  let newState = state

  // Clear ALL statuses including Revealed when card goes to discard
  clearAllStatuses(cardToMove)

  const newDiscard = [...player.discard, cardToMove]

  const newPlayers = newState.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, discard: newDiscard, discardSize: newDiscard.length, announcedCard: null }
      : p
  )

  newState = { ...newState, players: newPlayers }

  // NOTE: Phase already switched when command was announced (in handleAnnounceCard)
  // No need to switch phase here - command goes to discard without changing phase

  return newState
}

/**
 * PLAY_ANNOUNCED_TO_BOARD - play card from showcase to battlefield
 */
function handlePlayAnnouncedToBoard(state: GameState, playerId: number, data: any): GameState {
  const { row, col, faceDown = false, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || !player.announcedCard) {return state}
  if (row === undefined || col === undefined) {return state}
  if (row < 0 || row >= state.activeGridSize || col < 0 || col >= state.activeGridSize) {return state}

  // Check if cell is empty
  if (state.board[row]?.[col]?.card) {return state}

  const cardToPlay = { ...player.announcedCard, ownerId: actualPlayerId, isFaceDown: faceDown }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: cardToPlay }
      }
      return cell
    })
  )

  const newPlayers = state.players.map(p =>
    p.id === actualPlayerId
      ? { ...p, announcedCard: null }
      : p
  )

  // Switch to Main phase (2) if currently in Setup phase (1)
  // This matches the behavior of playing cards from hand
  const wasSetupPhase = state.currentPhase === 1
  const wasFaceDown = faceDown

  // Check if card has Setup ability before creating final board state
  const cardDef = getCardDefinition(cardToPlay.baseId ?? '')
  const cardHasSetupAbility = cardDef && (cardDef as any).ABILITIES?.some((a: any) => a.type === 'setup')

  let newState: GameState = {
    ...state,
    board: newBoard,
    players: newPlayers as Player[]
  }

  if (wasSetupPhase) {
    newState.currentPhase = 2
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []

    // If card has Setup ability and is not face-down, add readySetup status
    if (cardHasSetupAbility && !wasFaceDown) {
      newState = {
        ...newState,
        board: newState.board.map((r, rIdx) =>
          r.map((cell, cIdx) => {
            if (rIdx === row && cIdx === col && cell.card) {
              return {
                card: {
                  ...cell.card,
                  statuses: [...(cell.card.statuses || []), { type: 'readySetup', addedByPlayerId: actualPlayerId }]
                }
              }
            }
            return cell
          })
        )
      }
    }
  }

  // Recalculate ready statuses AFTER phase switch
  // This ensures cards get correct ready statuses for the new phase
  recalculateAllReadyStatuses(newState)

  // NOTE: Trigger check removed - cards announced then played are handled by handlePlayCard with source='hand'
  // Command cards with Revealed status trigger in MOVE_ANNOUNCED_TO_DISCARD with isCommandCardDiscard=true

  return newState
}

/**
 * ANNOUNCE_CARD - announce card
 * If player already has an announced card, they are swapped:
 * - The existing announced card returns to player's hand
 * - The new card becomes the announced card
 *
 * Supports sources: 'hand', 'deck', 'discard'
 */
function handleAnnounceCard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, playerId: targetPlayerId, source } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)

  if (!player || cardIndex === undefined) {return state}

  // Determine source array
  let sourceArray: Card[]
  if (source === 'deck') {
    sourceArray = player.deck || []
  } else if (source === 'discard') {
    sourceArray = player.discard || []
  } else {
    sourceArray = player.hand
  }

  const cardToAnnounce = sourceArray[cardIndex]

  if (!cardToAnnounce) {
    return state
  }

  // Check if this is a Command card from deck - use PLAY_COMMAND_FROM_DECK instead
  const isCommandCard = isCommandCardByDefinition(cardToAnnounce)

  if (source === 'deck' && isCommandCard) {
    return handlePlayCommandFromDeck(state, playerId, {
      card: cardToAnnounce,
      cardIndex,
      ownerId: actualPlayerId
    })
  }

  // Command cards from discard also use special handling
  if (source === 'discard' && isCommandCard) {
    return handlePlayCommandFromDiscard(state, playerId, {
      card: cardToAnnounce,
      cardIndex,
      ownerId: actualPlayerId
    })
  }

  // Build new arrays based on source
  const existingAnnouncedCard = player.announcedCard
  let newHand = [...player.hand]
  let newDeck = player.deck || []
  let newDiscard = player.discard || []

  if (source === 'deck') {
    // Remove from deck, existing announced goes to hand
    newDeck = [...newDeck]
    if (existingAnnouncedCard) {
      newHand = [...newHand, existingAnnouncedCard]
    }
    newDeck.splice(cardIndex, 1)
  } else if (source === 'discard') {
    // Remove from discard, existing announced goes to discard
    newDiscard = [...newDiscard]
    if (existingAnnouncedCard) {
      newDiscard = [...newDiscard, existingAnnouncedCard]
    }
    newDiscard.splice(cardIndex, 1)
  } else {
    // Remove from hand, existing announced goes to hand
    if (existingAnnouncedCard) {
      newHand = [...newHand, existingAnnouncedCard]
    }
    newHand.splice(cardIndex, 1)
  }

  // Announced card does NOT get LastPlayed status
  // (LastPlayed is only for cards that enter the battlefield, not showcase)
  // Remove any existing LastPlayed status from this card
  const existingStatuses = cardToAnnounce.statuses || []
  const filteredStatuses = existingStatuses.filter(s => !(s.type === 'LastPlayed' && s.addedByPlayerId === actualPlayerId))

  const announcedCard = {
    ...cardToAnnounce,
    statuses: filteredStatuses,
    ownerId: actualPlayerId  // CRITICAL: Set ownerId so command cards know which player owns them
  }

  const newPlayers = state.players.map(p => {
    if (p.id === actualPlayerId) {
      return {
        ...p,
        hand: newHand,
        handSize: newHand.length,
        deck: newDeck,
        deckSize: newDeck.length,
        discard: newDiscard,
        discardSize: newDiscard.length,
        announcedCard: announcedCard
        // Do NOT update boardHistory or lastPlayedCardId - card hasn't entered battlefield yet
      }
    }
    return p
  })

  let newState = { ...state, players: newPlayers }

  // Set phase to Main when command card is announced from hand
  // CRITICAL FIX: Change Setup (1) to Main (2), not to Setup!
  if (isCommandCard) {
    const wasSetupPhase = state.currentPhase === 1
    newState = { ...newState, currentPhase: wasSetupPhase ? 2 : state.currentPhase }
  }

  return newState
}

/**
 * DESTROY_CARD - destroy card
 */
function handleDestroyCard(state: GameState, _playerId: number, data: any): GameState {
  const { cardId } = data || {}
  if (!cardId) {return state}

  let destroyedCard: Card | null = null
  let ownerId: number | null = null
  let originalStatuses: CardStatus[] = [] // Save original statuses before clearing

  const newBoard = state.board.map((row, _r) =>
    row.map((cell, _c) => {
      if (cell.card?.id === cardId) {
        const foundCard = cell.card
        if (foundCard) {
          destroyedCard = foundCard
          ownerId = foundCard.ownerId ?? null
          // Save original statuses BEFORE clearing
          originalStatuses = [...(foundCard.statuses || [])]
        }
        return { card: null }
      }
      return cell
    })
  )

  if (!destroyedCard || !ownerId) {return state}

  // Clear all statuses except Revealed when card is destroyed and goes to discard
  // This allows deploy ability to be used again when card returns to battlefield
  clearAllStatusesExceptRevealed(destroyedCard)

  // Check if destroyed card is a token - tokens don't go to discard

  // Add to owner's discard ONLY if it's NOT a token
  let updatedState = {
    ...state,
    board: newBoard,
    players: state.players.map(p => {
      if (p.id === ownerId && !isToken(destroyedCard)) {
        return {
          ...p,
          discard: [...p.discard, destroyedCard],
          discardSize: p.discard.length + 1
        }
      }
      return p
    })
  }

  // Restore LastPlayed to previous card if destroyed card had it
  // Use the card with original statuses (before clearing)
  if (destroyedCard) {
    const card: Card = destroyedCard
    const cardWithOriginalStatuses = { ...card, statuses: originalStatuses }
    updatedState = restoreLastPlayedToPreviousCard(updatedState as any, cardWithOriginalStatuses, ownerId ?? 0)
  }

  return updatedState as any
}

/**
 * SWAP_CARDS - swap positions of two cards on board
 */
function handleSwapCards(state: GameState, playerId: number, data?: any): GameState {
  const { coords1, coords2 } = data || {}

  if (!coords1 || !coords2) { return state }

  const { row: r1, col: c1 } = coords1
  const { row: r2, col: c2 } = coords2

  // Check bounds
  if (r1 < 0 || r1 >= state.board.length || c1 < 0 || c1 >= state.board[0].length ||
      r2 < 0 || r2 >= state.board.length || c2 < 0 || c2 >= state.board[0].length) {
    return state
  }

  const card1 = state.board[r1][c1].card
  const card2 = state.board[r2][c2].card

  // Both cells must have cards
  if (!card1 || !card2) { return state }

  // STUN RULE: If player tries to swap THEIR OWN stunned card, prevent the swap
  const isCard1Stunned = card1.statuses?.some((s: any) => s.type === 'Stun')
  const isCard1Owned = card1.ownerId === playerId
  const isCard2Stunned = card2.statuses?.some((s: any) => s.type === 'Stun')
  const isCard2Owned = card2.ownerId === playerId

  // If either card is stunned and owned by the player, prevent swap
  if ((isCard1Stunned && isCard1Owned) || (isCard2Stunned && isCard2Owned)) {
    return state
  }

  // Create new board with swapped cards
  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      if (r === r1 && c === c1) {
        return { card: card2 }
      }
      if (r === r2 && c === c2) {
        return { card: card1 }
      }
      return cell
    })
  )

  return {
    ...state,
    board: newBoard
  }
}

/**
 * SPAWN_TOKEN - spawn a token card on the board
 * Special case: Resurrected is added as a status to existing card (Immunis Deploy)
 */
function handleSpawnToken(state: GameState, _playerId: number, data?: any): GameState {
  const { coords, tokenName, ownerId } = data || {}

  if (!coords || !tokenName || ownerId === undefined) { return state }

  const { row, col } = coords

  // Check bounds
  if (row < 0 || row >= state.board.length || col < 0 || col >= state.board[0].length) {
    return state
  }

  // Special case: Resurrected is a status, not a token card (for Immunis Deploy)
  if (tokenName === 'Resurrected') {
    const cell = state.board[row][col]
    if (!cell.card) { return state } // Must have a card to add status to

    const newBoard = state.board.map((r, rIdx) =>
      r.map((cell, cIdx) => {
        if (rIdx === row && cIdx === col && cell.card) {
          return {
            card: {
              ...cell.card,
              statuses: [...(cell.card.statuses || []), {
                type: 'Resurrected',
                                        addedByPlayerId: ownerId
                                      }]
            }
          }
        }
        return cell
      })
    )

    // Recalculate ready statuses
    const newState = { ...state, board: newBoard }
    recalculateAllReadyStatuses(newState)
    return newState
  }

  // Check if cell is empty (for regular token cards)
  if (state.board[row][col].card) { return state }

  // Use tokenData if provided, otherwise create basic token
  const tokenData = data?.tokenData
  const tokenCard: Card = {
    id: `token_${Date.now()}_${Math.random()}`,
    baseId: tokenName,
    name: tokenData?.name || tokenName,
    deck: 'Tokens' as DeckType,
    types: tokenData?.types || ['Token'],
    power: tokenData?.power ?? 1,
    abilityText: tokenData?.abilityText || '',
    imageUrl: tokenData?.imageUrl || '',
    fallbackImage: tokenData?.fallbackImage || '',
    ownerId,
    statuses: [],
    enteredThisTurn: false
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: tokenCard } as any
      }
      return cell
    })
  )

  // Switch to Main phase (2) if currently in Setup phase (1)
  // This matches the behavior of playing cards from hand
  const wasSetupPhase = state.currentPhase === 1

  // Check if token has Setup ability before creating final board state
  const tokenDef = getCardDefinition(tokenName)
  const tokenHasSetupAbility = tokenDef && (tokenDef as any).ABILITIES?.some((a: any) => a.type === 'setup')

  let newState: GameState = {
    ...state,
    board: newBoard
  }

  if (wasSetupPhase) {
    newState.currentPhase = 2
    // Clear scoring mode if somehow active
    newState.isScoringStep = false
    newState.scoringLines = []

    // If token has Setup ability, add readySetup status
    if (tokenHasSetupAbility) {
      newState = {
        ...newState,
        board: newState.board.map((r, rIdx) =>
          r.map((cell, cIdx) => {
            if (rIdx === row && cIdx === col && cell.card) {
              return {
                card: {
                  ...cell.card,
                  statuses: [...(cell.card.statuses || []), { type: 'readySetup', addedByPlayerId: ownerId }]
                }
              }
            }
            return cell
          })
        )
      }
    }
  }

  // Recalculate ready statuses for all cards AFTER phase switch
  // This ensures the token gets correct ready statuses for the new phase
  recalculateAllReadyStatuses(newState)

  return newState
}

/**
 * RESURRECT_DISCARDED - return a card from discard pile to board (Immunis Deploy)
 * Takes a card from discard and places it on the board at specified coordinates.
 * The card will then receive a token via SPAWN_TOKEN.
 */
function handleResurrectDiscarded(state: GameState, _playerId: number, data?: any): GameState {
  const { cardOwnerId, cardIndex, boardCoords } = data || {}

  if (cardOwnerId === undefined || cardIndex === undefined || !boardCoords) {
    return state
  }

  const { row, col } = boardCoords

  // Check bounds
  if (row < 0 || row >= state.board.length || col < 0 || col >= state.board[0].length) {
    return state
  }

  // Check if cell is empty
  if (state.board[row][col].card) {
    return state
  }

  // Find the player and their discard pile
  const player = state.players.find(p => p.id === cardOwnerId)
  if (!player || !player.discard || cardIndex < 0 || cardIndex >= player.discard.length) {
    return state
  }

  // Get the card to resurrect
  const cardToResurrect = player.discard[cardIndex]

  // LUCIUS PASSIVE: +2 power if exited from Discard
  let powerModifier = 0
  if (isLucius(cardToResurrect)) {
    powerModifier = 2
  }

  // Create the card for the board
  const boardCard: Card = {
    ...cardToResurrect,
    id: `resurrected_${cardToResurrect.id}_${Date.now()}`, // New ID to avoid conflicts
    ownerId: cardOwnerId,
    enteredThisTurn: false,
    powerModifier: (cardToResurrect.powerModifier || 0) + powerModifier  // Set last to override any existing value
  }

  // Remove card from discard
  const newDiscard = [...player.discard]
  newDiscard.splice(cardIndex, 1)

  // Place card on board
  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: boardCard }
      }
      return cell
    })
  )

  // Update player's discard
  const newPlayers = state.players.map(p =>
    p.id === cardOwnerId
      ? { ...p, discard: newDiscard, discardSize: newDiscard.length }
      : p
  )

  let newState: GameState = {
    ...state,
    board: newBoard,
    players: newPlayers
  }

  // Switch to Main phase (2) if currently in Setup phase (1)
  const wasSetupPhase = state.currentPhase === 1
  if (wasSetupPhase) {
    newState = {
      ...newState,
      currentPhase: 2
    }
  }

  // Recalculate ready statuses
  recalculateAllReadyStatuses(newState)

  return newState
}

// ============================================================================
// Deck control
// ============================================================================

/**
 * DRAW_CARD - draw card from deck
 */
function handleDrawCard(state: GameState, playerId: number, data?: any): GameState {
  // Use targetPlayerId if specified (for drawing cards for dummy players)
  // Otherwise use the playerId of who sent the action
  const targetPlayerId = data?.targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === targetPlayerId)
  if (!player || !player.deck || player.deck.length === 0) {return state}

  const newDeck = [...player.deck]
  const card = newDeck.shift()

  if (!card) {return state}

  const newPlayers = state.players.map(p =>
    p.id === targetPlayerId
      ? {
          ...p,
          deck: newDeck,
          deckSize: newDeck.length,
          hand: [...p.hand, card],
          handSize: p.hand.length + 1
        }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * DRAW_CARDS_BATCH - draw multiple cards for a player
 * Used by Tactical Maneuver, Inspiration, and other abilities
 */
function handleDrawCardsBatch(state: GameState, playerId: number, data?: any): GameState {
  const { count, targetPlayerId } = data || {}
  const actualCount = count || 1
  const targetId = targetPlayerId ?? playerId

  const player = state.players.find(p => p.id === targetId)
  if (!player || !player.deck || player.deck.length === 0) {return state}

  // Draw cards from deck (up to count or deck size, whichever is smaller)
  const cardsToDraw = Math.min(actualCount, player.deck.length)
  const drawnCards: Card[] = []

  for (let i = 0; i < cardsToDraw; i++) {
    const card = player.deck[i]
    if (card) {
      drawnCards.push(card)
    }
  }

  const newDeck = player.deck.slice(cardsToDraw)
  const newHand = [...player.hand, ...drawnCards]

  const newPlayers = state.players.map(p =>
    p.id === targetId
      ? {
          ...p,
          deck: newDeck,
          deckSize: newDeck.length,
          hand: newHand,
          handSize: newHand.length
        }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * SHUFFLE_DECK - shuffle deck
 */
function handleShuffleDeck(state: GameState, playerId: number): GameState {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {return state}

  const newDeck = shuffleDeck([...player.deck])

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, deck: newDeck }
      : p
  )

  return { ...state, players: newPlayers }
}

// ============================================================================
// Score and player status
// ============================================================================

/**
 * UPDATE_SCORE - update player score
 */
function handleUpdateScore(state: GameState, playerId: number, delta: number): GameState {
  const newPlayers = state.players.map(p => {
    if (p.id === playerId) {
      return { ...p, score: Math.max(0, p.score + delta) }
    }
    return p
  })

  return { ...state, players: newPlayers }
}

/**
 * CHANGE_PLAYER_NAME - change player name
 */
function handleChangePlayerName(state: GameState, playerId: number, name: string): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, name } : p
  )

  return { ...state, players: newPlayers }
}

/**
 * CHANGE_PLAYER_COLOR - change player color
 */
function handleChangePlayerColor(state: GameState, playerId: number, color: any): GameState {
  const newPlayers = state.players.map(p =>
    p.id === playerId ? { ...p, color } : p
  )

  return { ...state, players: newPlayers }
}

/**
 * CHANGE_PLAYER_DECK - change player deck
 * Creates new deck of selected type
 */
function handleChangePlayerDeck(state: GameState, playerId: number, deckType: DeckType): GameState {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {return state}

  // Create new deck
  const newDeck = createDeck(deckType, playerId, player.name)

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? { ...p, selectedDeck: deckType, deck: newDeck, deckSize: newDeck.length }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * LOAD_CUSTOM_DECK - load a custom deck file
 * Builds deck from custom deck file and sets it as player's deck
 */
function handleLoadCustomDeck(state: GameState, playerId: number, deckFile: CustomDeckFile): GameState {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {return state}

  // Build the deck from the custom deck file
  const newDeck: Card[] = []
  for (const deckCard of deckFile.cards) {
    const cardDef = getCardDefinition(deckCard.cardId)
    if (!cardDef) {
      continue
    }

    // Add the specified quantity of this card
    for (let i = 0; i < deckCard.quantity; i++) {
      newDeck.push({
        ...cardDef,  // Spread the full card definition
        id: `${deckCard.cardId}_${playerId}_${Date.now()}_${i}`,
        baseId: deckCard.cardId,
        deck: DeckType.Custom,
        ownerId: playerId,
        ownerName: player.name,
        isFaceDown: false,
        statuses: []
      })
    }
  }

  // Shuffle the custom deck before assigning it
  const shuffledDeck = shuffleDeck(newDeck)

  const newPlayers = state.players.map(p =>
    p.id === playerId
      ? {
          ...p,
          selectedDeck: DeckType.Custom,
          deck: shuffledDeck,
          deckSize: newDeck.length,
          customDeckName: deckFile.deckName,
          hand: [],
          discard: []
        }
      : p
  )

  return { ...state, players: newPlayers }
}

/**
 * EXECUTE_ABILITY_CHAINED - Execute ability with chained action on host
 * Used by guests who don't have opponent hand data to properly calculate targets
 * The host has full game state and can execute the chained action correctly
 */
function handleExecuteAbilityChained(state: GameState, playerId: number, data: any): GameState {
  const { sourceCoords, chainedAction, onlyOpponents } = data || {}
  if (!sourceCoords || !chainedAction) {
    return state
  }

  let newState = state

  // First, mark the ability as used (remove ready status)
  const { row, col } = sourceCoords
  const sourceCard = newState.board[row]?.[col]?.card
  if (sourceCard) {
    // Get ability info to determine which ready status to remove
    const abilityInfo = getCardAbilityInfo(sourceCard)
    let readyStatusToRemove: string | undefined

    if (chainedAction.mode === 'DRAW_CARD' || chainedAction.type === 'DRAW_CARD') {
      // Vigilant Spotter and similar abilities use readyCommit
      readyStatusToRemove = abilityInfo.hasCommitAbility ? 'readyCommit' : undefined
    } else if (chainedAction.mode === 'DISCARD_AND_DRAW' || chainedAction.type === 'DISCARD_AND_DRAW') {
      readyStatusToRemove = abilityInfo.hasCommitAbility ? 'readyCommit' : undefined
    }

    // Mark ability as used
    if (readyStatusToRemove) {
      newState = handleMarkAbilityUsed(newState, {
        coords: sourceCoords,
        isDeploy: false,
        readyStatusToRemove
      })
    }
  }

  // Execute the chained action
  if (chainedAction.type === 'DRAW_CARD' || chainedAction.mode === 'DRAW_CARD') {
    // Draw a card for the player
    newState = {
      ...newState,
      players: newState.players.map(p => {
        if (p.id === playerId && p.deck && p.deck.length > 0) {
          const drawnCard = p.deck.shift()
          if (drawnCard) {
            return {
              ...p,
              hand: [...p.hand, drawnCard],
              handSize: p.hand.length + 1,
              deckSize: p.deck.length
            }
          }
        }
        return p
      })
    }
  } else if (chainedAction.type === 'DISCARD_AND_DRAW' || chainedAction.mode === 'DISCARD_AND_DRAW') {
    // Discard and draw (for abilities like "discard a card, then draw a card")
    newState = {
      ...newState,
      players: newState.players.map(p => {
        if (p.id === playerId) {
          // Discard first card from hand
          const newHand = [...(p.hand || [])]
          const newDiscard = [...(p.discard || [])]
          if (newHand.length > 0) {
            const discardedCard = newHand.shift()
            if (discardedCard) {
              newDiscard.push(discardedCard)
            }
          }
          // Then draw a card
          const newDeck = [...(p.deck || [])]
          if (newDeck.length > 0) {
            const drawnCard = newDeck.shift()
            if (drawnCard) {
              newHand.push(drawnCard)
            }
          }
          return {
            ...p,
            hand: newHand,
            handSize: newHand.length,
            deck: newDeck,
            deckSize: newDeck.length,
            discard: newDiscard,
            discardSize: newDiscard.length
          }
        }
        return p
      })
    }
  } else {
  }

  return newState
}

/**
 * MARK_ABILITY_USED - mark ability as used
 * Removes ready status, adds usage marker, and updates ready statuses for phase-specific abilities
 */
function handleMarkAbilityUsed(state: GameState, data: any): GameState {
  const { coords, isDeploy, readyStatusToRemove } = data || {}
  if (!coords) {return state}

  const { row, col } = coords
  if (row === undefined || col === undefined) {return state}

  const newBoard = state.board.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const newCard = { ...cell.card }
        if (!newCard.statuses) {newCard.statuses = []}

        // Remove the ready status
        if (readyStatusToRemove) {
          newCard.statuses = newCard.statuses.filter(s => s.type !== readyStatusToRemove)
        }

        // Mark ability as used based on type
        if (isDeploy) {
          // Deploy: mark as used (persists until card leaves battlefield)
          const deployUsedStatus = 'deployUsedThisTurn'
          if (!newCard.statuses.some(s => s.type === deployUsedStatus)) {
            newCard.statuses.push({ type: deployUsedStatus, addedByPlayerId: newCard.ownerId || 0 })
          }

          // After Deploy is used, check if card has phase-specific ability for current phase
          // E.g., Walking Turret uses Deploy in Setup phase, then gets Setup status
          const abilityInfo = getCardAbilityInfo(newCard)
          const { hasSetupAbility, hasCommitAbility } = abilityInfo

          if (state.currentPhase === 1 && hasSetupAbility) {
            // Add Setup status after Deploy is used
            newCard.statuses.push({ type: READY_STATUS.SETUP, addedByPlayerId: newCard.ownerId || 0 })
          } else if (state.currentPhase === 3 && hasCommitAbility) {
            // Add Commit status after Deploy is used
            newCard.statuses.push({ type: READY_STATUS.COMMIT, addedByPlayerId: newCard.ownerId || 0 })
          }
        } else if (readyStatusToRemove === 'readySetup') {
          // Setup: mark as used this turn
          const setupUsedStatus = 'setupUsedThisTurn'
          if (!newCard.statuses.some(s => s.type === setupUsedStatus)) {
            newCard.statuses.push({ type: setupUsedStatus, addedByPlayerId: newCard.ownerId || 0 })
          }
        } else if (readyStatusToRemove === 'readyCommit') {
          // Commit: mark as used this turn
          const commitUsedStatus = 'commitUsedThisTurn'
          if (!newCard.statuses.some(s => s.type === commitUsedStatus)) {
            newCard.statuses.push({ type: commitUsedStatus, addedByPlayerId: newCard.ownerId || 0 })
          }
        }

        return { ...cell, card: newCard }
      }
      return cell
    })
  )

  return { ...state, board: newBoard }
}

/**
 * GLOBAL_AUTO_APPLY - Handle global apply actions with context rewards
 * Used by Tactical Maneuver, Temporary Shelter, and other command cards
 * Supports contextReward: DRAW_MOVED_POWER, SCORE_MOVED_POWER
 * Supports customAction: REMOVE_ALL_AIM_FROM_CONTEXT (Temporary Shelter)
 */
function handleGlobalAutoApply(state: GameState, playerId: number, data: any): GameState {
  const { payload, sourceCard } = data || {}
  if (!payload) {return state}

  // Handle context rewards (Tactical Maneuver, etc.)
  if (payload.contextReward && sourceCard) {
    return handleContextReward(state, playerId, data)
  }

  // Handle custom actions (Temporary Shelter: REMOVE_ALL_AIM_FROM_CONTEXT)
  if (payload.customAction === 'REMOVE_ALL_AIM_FROM_CONTEXT') {
    let targetCoords: { row: number; col: number } | null = null

    // Method 1: Use contextCardId if provided
    if (payload.contextCardId) {
      for (let r = 0; r < state.board.length; r++) {
        for (let c = 0; c < state.board[r].length; c++) {
          const card = state.board[r][c].card
          if (card && card.id === payload.contextCardId) {
            targetCoords = { row: r, col: c }
            break
          }
        }
        if (targetCoords) {
          break
        }
      }
    }

    // Method 2: Use _tempContextId if provided (fallback)
    if (!targetCoords && payload._tempContextId) {
      for (let r = 0; r < state.board.length; r++) {
        for (let c = 0; c < state.board[r].length; c++) {
          const card = state.board[r][c].card
          if (card && card.id === payload._tempContextId) {
            targetCoords = { row: r, col: c }
            break
          }
        }
        if (targetCoords) {
          break
        }
      }
    }

    // Method 3: Use lastMovedCardCoords if provided (direct coordinates)
    if (!targetCoords && payload.lastMovedCardCoords) {
      const { row, col } = payload.lastMovedCardCoords
      if (row >= 0 && row < state.board.length && col >= 0 && col < state.board[row].length) {
        const card = state.board[row][col].card
        if (card) {
          targetCoords = { row, col }
        }
      }
    }

    if (!targetCoords) {
      return state
    }

    // Remove ALL Aim counters from the target card (regardless of owner)
    return handleRemoveAllCountersByType(state, {
      coords: targetCoords,
      type: 'Aim',
    })
  }

  // Handle token placement on moved card (False Orders option 2: Stun x2)
  // CRITICAL: Support multiple ways to find the target card
  if (payload.tokenType && (payload.count || payload.count === 0)) {
    let targetCoords: { row: number; col: number } | null = null

    // Method 1: Use contextCardId if provided
    if (payload.contextCardId) {
      for (let r = 0; r < state.board.length; r++) {
        for (let c = 0; c < state.board[r].length; c++) {
          const card = state.board[r][c].card
          if (card && card.id === payload.contextCardId) {
            targetCoords = { row: r, col: c }
            break
          }
        }
        if (targetCoords) {
          break
        }
      }
    }

    // Method 2: Use _tempContextId if provided (fallback)
    if (!targetCoords && payload._tempContextId) {
      for (let r = 0; r < state.board.length; r++) {
        for (let c = 0; c < state.board[r].length; c++) {
          const card = state.board[r][c].card
          if (card && card.id === payload._tempContextId) {
            targetCoords = { row: r, col: c }
            break
          }
        }
        if (targetCoords) {
          break
        }
      }
    }

    // Method 3: Use lastMovedCardCoords if provided (direct coordinates)
    if (!targetCoords && payload.lastMovedCardCoords) {
      const { row, col } = payload.lastMovedCardCoords
      if (row >= 0 && row < state.board.length && col >= 0 && col < state.board[row].length) {
        const card = state.board[row][col].card
        if (card) {
          targetCoords = { row, col }
        }
      }
    }

    if (!targetCoords) {
      return state
    }

    // Add the tokens using handleAddStatusToBoardCard
    // CRITICAL: Handle ownerId === "source" to use sourceCard owner (False Orders)
    // Tokens should belong to the player who played the command card
    let tokenOwnerId = payload.ownerId === "source" ? (sourceCard?.ownerId || playerId) : (payload.ownerId || playerId)

    let newState = state
    for (let i = 0; i < payload.count; i++) {
      newState = handleAddStatusToBoardCard(newState, playerId, {
        boardCoords: targetCoords,
        statusType: payload.tokenType,
        ownerId: tokenOwnerId,
        count: 1,
      })
    }

    return newState
  }

  // Handle cleanup command (discard command card after use)
  if (payload.cleanupCommand && payload.card) {
    const commandOwnerId = sourceCard?.ownerId || playerId
    return handleCleanupCommand(state, commandOwnerId, payload.card)
  }

  // Handle FINN_SCORING custom action (Finn, Most Wanted Commit ability)
  // Gain 1 point for each card that is revealed to you in opponents' hands or on the battlefield
  if (payload.customAction === 'FINN_SCORING' && sourceCard) {
    const finnOwnerId = sourceCard.ownerId
    if (finnOwnerId !== undefined) {
      let revealedCount = 0

      // Count Revealed cards in opponents' hands
      state.players.forEach(p => {
        if (p.id !== finnOwnerId) {
          p.hand.forEach((c: any) => {
            if (c.statuses?.some((s: any) => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId)) {
              revealedCount++
            }
          })
        }
      })

      // Count Revealed statuses on battlefield (multiple per card)
      state.board.forEach((row: any[]) => {
        row.forEach((cell: any) => {
          const card = cell.card
          if (card && card.ownerId !== finnOwnerId) {
            const revealedByFinn = card.statuses?.filter((s: any) => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId).length || 0
            revealedCount += revealedByFinn
          }
        })
      })

      if (revealedCount > 0) {
        // Find Finn's coordinates on the board
        let finnCoords: { row: number; col: number } | null = null
        for (let r = 0; r < state.board.length; r++) {
          for (let c = 0; c < state.board[r].length; c++) {
            const card = state.board[r][c].card
            if (card && card.id === sourceCard.id) {
              finnCoords = { row: r, col: c }
              break
            }
          }
          if (finnCoords) break
        }

        // Update player score
        let newState = {
          ...state,
          players: state.players.map(p =>
            p.id === finnOwnerId
              ? { ...p, score: Math.max(0, p.score + revealedCount) }
              : p
          )
        }

        // Add floating text at Finn's location
        if (finnCoords) {
          const newFloatingText: FloatingTextData = {
            row: finnCoords.row,
            col: finnCoords.col,
            text: `+${revealedCount}`,
            playerId: finnOwnerId,
            timestamp: Date.now()
          }
          return {
            ...newState,
            floatingTexts: [...(newState.floatingTexts || []), newFloatingText]
          }
        }

        return newState
      }
    }
  }

  return state
}

/**
 * Handle context reward actions
 * This is the SINGLE SOURCE OF TRUTH for all context rewards.
 * Called from handleGlobalAutoApply when GLOBAL_AUTO_APPLY message has contextReward.
 *
 * Supported reward types:
 * - DRAW_MOVED_POWER: Draw cards equal to moved card's power (Tactical Maneuver)
 * - DRAW_EQUAL_POWER: Draw cards equal to card's power
 * - SCORE_MOVED_POWER: Add score equal to moved card's power (Tactical Maneuver)
 * - STUN_MOVED_UNIT: Add Stun status to moved unit (False Orders)
 * - REMOVE_AIM: Remove Aim status from card
 * - WEAKEN: Reduce card power by 1
 */
function handleContextReward(state: GameState, playerId: number, data: any): GameState {
  const { payload, sourceCard } = data || {}
  const rewardType = payload?.contextReward

  if (!rewardType || !sourceCard) {return state}

  // CRITICAL: Use pre-calculated card power from payload first (most reliable)
  // This is set when selecting the unit in handleSelectUnitForMove
  let amount = payload?._cardPower || payload?.contextCardPower || 0

  // Fallback: search for card on board if power not provided
  if (amount === 0) {
    // CRITICAL: _sourceCoordsBeforeMove points to OLD position (where card WAS)
    // We need to find the card at its NEW position after move
    const searchId = payload?._tempContextId

    // First try using lastMovedCardCoords (destination, where card IS now)
    let card: Card | undefined
    const lastMovedCoords = payload?.lastMovedCardCoords
    if (lastMovedCoords && lastMovedCoords.row >= 0) {
      card = state.board[lastMovedCoords.row][lastMovedCoords.col]?.card
    }

    // If not found, search by card ID across entire board
    if ((!card || (searchId && card.id !== searchId)) && searchId) {
      for (let r = 0; r < state.board.length; r++) {
        for (let c = 0; c < state.board[r].length; c++) {
          if (state.board[r][c].card?.id === searchId) {
            card = state.board[r][c].card
            break
          }
        }
        if (card) {break}
      }
    }

    if (card) {
      amount = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
    }
  }

  // CRITICAL: Use originalOwnerId for command card rewards (Tactical Maneuver, False Orders)
  // sourceCard might be the selected unit, not the command card
  const rewardOwnerId = data.originalOwnerId ?? sourceCard.ownerId ?? playerId

  // Handle different reward types
  if (rewardType === 'DRAW_MOVED_POWER' || rewardType === 'DRAW_EQUAL_POWER') {
    // Draw cards for the reward owner
    const newPlayers = state.players.map(p => {
      if (p.id === rewardOwnerId && p.deck && p.hand) {
        const cardsToDraw = Math.min(amount, p.deck.length)
        const drawnCards: Card[] = []
        for (let i = 0; i < cardsToDraw; i++) {
          const cardDrawn = p.deck.shift()
          if (cardDrawn) {
            drawnCards.push(cardDrawn)
          }
        }
        return {
          ...p,
          deck: p.deck,
          deckSize: p.deck.length,
          hand: [...p.hand, ...drawnCards],
          handSize: p.hand.length + drawnCards.length
        }
      }
      return p
    })
    return { ...state, players: newPlayers }
  } else if (rewardType === 'SCORE_MOVED_POWER') {
    // Add score for the reward owner
    const newPlayers = state.players.map(p => {
      if (p.id === rewardOwnerId) {
        return { ...p, score: (p.score || 0) + amount }
      }
      return p
    })
    return { ...state, players: newPlayers }
  } else if (rewardType === 'STUN_MOVED_UNIT') {
    // Add Stun status to the moved card
    return handleAddStatusToBoardCard(state, rewardOwnerId, {
      boardCoords: coords,
      statusType: 'Stun',
      ownerId: rewardOwnerId,
      count: 1,
    })
  } else if (rewardType === 'REMOVE_AIM') {
    // Remove Aim status from the card
    return handleRemoveCounterByType(state, {
      boardCoords: coords,
      counterType: 'Aim',
    })
  } else if (rewardType === 'WEAKEN') {
    // Reduce card power by 1
    return handleWeaken(state, coords)
  }

  return state
}

/**
 * Weaken a card at coords (reduce power by 1)
 */
function handleWeaken(state: GameState, coords: { row: number; col: number }): GameState {
  const newBoard = state.board.map((row, r) =>
    row.map((cell, c) => {
      if (r === coords.row && c === coords.col && cell.card) {
        return {
          ...cell,
          card: {
            ...cell.card,
            powerModifier: (cell.card.powerModifier || 0) - 1
          }
        }
      }
      return cell
    })
  )
  return { ...state, board: newBoard }
}

/**
 * Handle cleanup command - discard command card after use
 */
function handleCleanupCommand(state: GameState, playerId: number, commandCard: Card): GameState {

  // Find the command card in the player's announced cards and move to discard
  const player = state.players.find(p => p.id === playerId)
  if (!player || !player.announcedCard) {
    return state
  }

  const newPlayers = state.players.map(p => {
    if (p.id === playerId) {
      const discard = [...(p.discard || []), commandCard]
      return {
        ...p,
        discard,
        discardSize: discard.length,
        announcedCard: null
      }
    }
    return p
  })

  const newState: GameState = { ...state, players: newPlayers }

  // NOTE: Phase already switched when command was announced (in handleAnnounceCard)
  // No need to switch phase here - command goes to discard without changing phase

  return newState
}

/**
 * Handle CLEANUP_COMMAND action - discard command card from showcase to discard
 * This is the final step of all command cards
 */
function handleCleanupCommandAction(state: GameState, playerId: number, data: any): GameState {
  const { cardId } = data || {}

  if (!cardId) {
    return state
  }

  // Find the player and their announced card
  const player = state.players.find(p => p.id === playerId)
  if (!player) {
    return state
  }

  const announcedCard = player.announcedCard
  if (!announcedCard) {
    return state
  }

  // Check if this is a Command card with Revealed status BEFORE clearing statuses
  // Check if command has Revealed status from ANY player
  // The trigger system will filter by owner, so we just need to know if ANY Revealed status exists
  const hasAnyRevealedStatus = announcedCard.statuses?.some((s: any) => s.type === 'Revealed')

  console.log('[handleCleanupCommandAction] Command card:', announcedCard.name, 'hasRevealedStatus:', hasAnyRevealedStatus, 'statuses:', announcedCard.statuses)

  // VIGILANT SPOTTER TRIGGER: Check if the command card has Revealed status
  // Trigger BEFORE clearing statuses so the Revealed information is available
  let newState = state
  if (hasAnyRevealedStatus) {
    console.log('[handleCleanupCommandAction] Triggering Vigilant Spotter check for command card:', announcedCard.name)
    // CRITICAL: Pass newState (not state) to preserve any floatingTexts from trigger
    newState = checkVigilantSpotterTrigger(newState, announcedCard, 'handleCleanupCommandAction')
  } else {
    console.log('[handleCleanupCommandAction] No Revealed status, skipping Vigilant Spotter trigger')
  }

  // CRITICAL: Clear statuses on the ORIGINAL announcedCard before moving to discard
  // This ensures the card in discard has no statuses (including Revealed)
  // We must clear BEFORE moving to prevent status persistence issues
  clearAllStatuses(announcedCard)
  console.log('[handleCleanupCommandAction] After clearing, announcedCard.statuses:', announcedCard.statuses)

  // Move the announced card to discard
  const newPlayers = newState.players.map(p => {
    if (p.id === playerId) {
      const discard = [...(p.discard || []), announcedCard]
      return {
        ...p,
        discard,
        discardSize: discard.length,
        announcedCard: null
      }
    }
    return p
  })

  const finalState = { ...newState, players: newPlayers }
  console.log('[handleCleanupCommandAction] Final state floatingTexts count:', finalState.floatingTexts?.length ?? 0)

  return finalState
}

/**
 * REMOVE_ALL_COUNTERS_BY_TYPE - remove all counters/statuses of specific type from card
 */
function handleRemoveAllCountersByType(state: GameState, data: any): GameState {
  const { coords, type } = data || {}
  if (!coords || !type) {return state}

  const { row, col } = coords
  if (row === undefined || col === undefined) {return state}

  const cell = state.board[row][col]
  if (!cell?.card) {return state}

  const targetCard = cell.card
  const hadSupport = targetCard.statuses?.some(s => s.type === 'Support') ?? false

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const newStatuses = cell.card.statuses?.filter(s => s.type !== type) || []
        const newCard = { ...cell.card, statuses: newStatuses }
        return { ...cell, card: newCard }
      }
      return c
    })
  )

  const newState = { ...state, board: newBoard }

  // If Support status was removed, recalculate ready statuses for this card
  if (type === 'Support' && hadSupport) {
    const newCard = newBoard[row][col].card
    if (newCard) {
      recheckReadyStatuses(newCard, newState)
    }
  }

  return newState
}

/**
 * REMOVE_COUNTER_BY_TYPE - remove counter/status of specific type from card
 * - If ownerId provided: remove ALL counters of that type from that owner (Censor Commit)
 * - If ownerId NOT provided: remove ONE counter of that type from any owner (context menu)
 */
function handleRemoveCounterByType(state: GameState, data: any): GameState {
  const { coords, type, ownerId } = data || {}
  if (!coords || !type) {return state}

  const { row, col } = coords
  if (row === undefined || col === undefined) {return state}

  const cell = state.board[row][col]
  if (!cell?.card) {return state}

  const targetCard = cell.card
  const hadSupport = targetCard.statuses?.some(s => s.type === 'Support') ?? false

  let newStatuses: any[] = []
  if (ownerId !== undefined) {
    // Remove ALL counters of this type from this owner (Censor Commit behavior)
    newStatuses = cell.card.statuses?.filter(s => !(s.type === type && (s as any).addedByPlayerId === ownerId)) || []
  } else {
    // Remove ONE counter of this type from any owner (context menu behavior)
    const statuses = cell.card.statuses ? [...cell.card.statuses] : []
    const foundIndex = statuses.findIndex(s => s.type === type)
    if (foundIndex !== -1) {
      statuses.splice(foundIndex, 1)
    }
    newStatuses = statuses
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const newCard = { ...cell.card, statuses: newStatuses }
        return { ...cell, card: newCard }
      }
      return c
    })
  )

  const newState = { ...state, board: newBoard }

  // If Support status was removed, recalculate ready statuses for this card
  if (type === 'Support' && hadSupport) {
    const newCard = newBoard[row][col].card
    if (newCard) {
      recheckReadyStatuses(newCard, newState)
    }
  }

  return newState
}

/**
 * REMOVE_COUNTERS_WITH_REWARD - Remove multiple counters from a card and give reward
 * Used by Inspiration command - removes counters and gives draw or score reward
 * CRITICAL: The reward goes to the CARD OWNER, not the player who sent the action
 * This ensures that when a player uses Inspiration on a dummy player's card,
 * the dummy player (card owner) gets the reward, not the local player.
 */
function handleRemoveCountersWithReward(state: GameState, playerId: number, data: any): GameState {
  const { coords, countsToRemove, callbackAction } = data || {}
  if (!coords || !countsToRemove || !callbackAction) {return state}

  const { row, col } = coords
  if (row === undefined || col === undefined) {return state}

  const cell = state.board[row][col]
  if (!cell?.card) {return state}

  // CRITICAL: Use card owner for reward, not action sender
  // For Inspiration, the card owner should draw the cards
  const rewardOwnerId = cell.card.ownerId || playerId

  // Remove counters from card
  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const cardStatuses = cell.card.statuses ? [...cell.card.statuses] : []
        let totalRemoved = 0

        // Remove each counter type by count
        Object.entries(countsToRemove).forEach(([type, count]) => {
          for (let i = 0; i < (count as number); i++) {
            const lastIndex = cardStatuses.map(s => s.type).lastIndexOf(type)
            if (lastIndex > -1) {
              cardStatuses.splice(lastIndex, 1)
              totalRemoved++
            }
          }
        })

        return { ...c, card: { ...cell.card, statuses: cardStatuses } }
      }
      return c
    })
  )

  const newState = { ...state, board: newBoard }

  // Apply reward: Draw cards from deck
  if (callbackAction === 'DRAW_REMOVED') {
    const totalRemoved = Object.values(countsToRemove).reduce((sum: number, count: unknown) => sum + (count as number), 0)
    if (totalRemoved > 0) {
      // CRITICAL: Use rewardOwnerId (card owner), not playerId (action sender)
      const playerToUpdate = newState.players.find(p => p.id === rewardOwnerId)
      if (playerToUpdate && playerToUpdate.deck) {
        const cardsToDraw = Math.min(totalRemoved, playerToUpdate.deck.length)
        for (let i = 0; i < cardsToDraw; i++) {
          const cardDrawn = playerToUpdate.deck.shift()
          if (cardDrawn && playerToUpdate.hand) {
            playerToUpdate.hand.push(cardDrawn)
          }
        }
        // Update hand size
        playerToUpdate.handSize = playerToUpdate.hand.length
      }
    }
  }
  // Score reward is handled separately via UPDATE_PLAYER_SCORE action

  return newState
}

/**
 * MODIFY_CARD_POWER - modify power of a card on the battlefield
 * Used by Walking Turret Setup and other MODIFY_POWER abilities
 */
function handleModifyCardPower(state: GameState, data: any): GameState {
  const { coords, delta } = data || {}
  if (!coords || delta === undefined) {return state}

  const { row, col } = coords
  if (row === undefined || col === undefined) {return state}

  const cell = state.board[row][col]
  if (!cell?.card) {return state}

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col && cell.card) {
        const currentPowerModifier = cell.card.powerModifier || 0
        const newCard = { ...cell.card, powerModifier: currentPowerModifier + delta }
        return { ...cell, card: newCard }
      }
      return c
    })
  )

  return { ...state, board: newBoard }
}

/**
 * PLAY_CARD_FROM_DECK - play top card from deck to battlefield
 */
function handlePlayCardFromDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, boardCoords, faceDown, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.deck || player.deck.length === 0) {return state}

  // Get the card to play (top card from deck by default)
  const indexToPlay = cardIndex !== undefined ? cardIndex : 0
  const cardToPlay = player.deck[indexToPlay]
  if (!cardToPlay) {return state}

  // Remove card from deck
  const newDeck = [...player.deck]
  newDeck.splice(indexToPlay, 1)

  // Create modified player
  const updatedPlayer = {
    ...player,
    deck: newDeck,
    deckSize: newDeck.length
  }

  const newPlayers = state.players.map(p => p.id === actualPlayerId ? updatedPlayer : p)

  // Use handlePlayCard logic to place the card on board
  const newState = { ...state, players: newPlayers }
  return handlePlayCard(newState, actualPlayerId, { card: cardToPlay, boardCoords, faceDown })
}

/**
 * PLAY_CARD_FROM_DISCARD - play card from discard to battlefield
 */
function handlePlayCardFromDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, boardCoords, faceDown, playerId: targetPlayerId } = data || {}
  const actualPlayerId = targetPlayerId ?? playerId
  const player = state.players.find(p => p.id === actualPlayerId)
  if (!player || !player.discard || player.discard.length === 0) {return state}

  // Get the card to play (top card from discard by default)
  const indexToPlay = cardIndex !== undefined ? cardIndex : player.discard.length - 1
  const cardToPlay = player.discard[indexToPlay]
  if (!cardToPlay) {return state}

  // Remove card from discard
  const newDiscard = [...player.discard]
  newDiscard.splice(indexToPlay, 1)

  // Create modified player
  const updatedPlayer = {
    ...player,
    discard: newDiscard,
    discardSize: newDiscard.length
  }

  const newPlayers = state.players.map(p => p.id === actualPlayerId ? updatedPlayer : p)

  // Use handlePlayCard logic to place the card on board
  // Pass fromDiscard: true for Lucius's passive (+2 power if exited from Discard)
  const newState = { ...state, players: newPlayers }
  return handlePlayCard(newState, actualPlayerId, { card: cardToPlay, boardCoords, faceDown, fromDiscard: true })
}

/**
 * ADD_STATUS_TO_BOARD_CARD - add status (token) to card on battlefield
 * Supports token stacking: up to 99 tokens of same type can be added
 * Exception: singleton statuses (Threat, Support, Revealed) remain single
 * Supports count parameter for placing multiple tokens at once
 */
function handleAddStatusToBoardCard(state: GameState, _playerId: number, data: any): GameState {
  const { boardCoords, statusType, ownerId, replaceStatusType, count = 1 } = data || {}
  if (!boardCoords || !statusType || ownerId === undefined) {
    return state
  }

  const { row, col } = boardCoords
  if (row === undefined || col === undefined) {
    return state
  }

  // Validate bounds
  if (row < 0 || row >= state.board.length || col < 0 || col >= state.board[row]?.length) {
    return state
  }

  const cell = state.board[row][col]
  if (!cell || !cell.card) {
    return state
  }

  // Create new card with added status
  const targetCard = cell.card
  const existingStatuses = targetCard.statuses || []

  // LUCIUS PASSIVE: Immunity to Stun - Lucius cannot receive Stun tokens
  if (statusType === 'Stun' && isLucius(targetCard)) {
    return state
  }

  // If replaceStatusType is specified, remove that status type first
  let filteredStatuses = existingStatuses
  if (replaceStatusType) {
    filteredStatuses = existingStatuses.filter(s => s.type !== replaceStatusType)
  }

  // STUN RULE: When Stun is added to a card with readyDeploy, mark deploy as used
  // This prevents readyDeploy from being restored when Stun is removed
  if (statusType === 'Stun') {
    const hasReadyDeploy = filteredStatuses.some(s => s.type === 'readyDeploy')
    const alreadyHasDeployUsed = filteredStatuses.some(s => s.type === 'deployUsedThisTurn')
    if (hasReadyDeploy && !alreadyHasDeployUsed) {
      // Mark deploy ability as used (skip) so it doesn't come back after stun removal
      filteredStatuses = filteredStatuses.filter(s => s.type !== 'readyDeploy')
      filteredStatuses.push({ type: 'deployUsedThisTurn', addedByPlayerId: targetCard.ownerId || 0 })
    }
  }

  // Singleton statuses that cannot stack (only one instance allowed per owner)
  const SINGLETON_STATUSES = ['Threat', 'Support', 'Revealed']

  // Check if this is a singleton status
  const isSingletonStatus = SINGLETON_STATUSES.includes(statusType)

  if (isSingletonStatus) {
    // For singleton statuses, check if this owner already has this status on the card
    const alreadyHasStatus = filteredStatuses.some(s => s.type === statusType && s.addedByPlayerId === ownerId)
    if (alreadyHasStatus) {
      // Card already has this singleton status from this owner - don't add another
      return state
    }
  }

  // Add the new status(es) - supports count parameter for placing multiple tokens at once
  let newStatuses = [...filteredStatuses]
  const MAX_TOKENS_PER_TYPE = 99

  for (let i = 0; i < count; i++) {
    if (isSingletonStatus) {
      // For singleton, only add if not already present (checked above)
      const newStatus = { type: statusType, addedByPlayerId: ownerId }
      newStatuses = [...newStatuses, newStatus]
      break // Only add one for singleton statuses
    } else {
      // For stackable tokens, count existing tokens of this type from this owner
      const existingTokenCount = newStatuses.filter(s => s.type === statusType && s.addedByPlayerId === ownerId).length

      if (existingTokenCount >= MAX_TOKENS_PER_TYPE) {
        // Already at max capacity, don't add more
        break
      }

      const newStatus = { type: statusType, addedByPlayerId: ownerId }
      newStatuses = [...newStatuses, newStatus]
    }
  }

  // If adding Revealed status, the card becomes visible to the token owner
  let revealedTo = targetCard.revealedTo
  if (statusType === 'Revealed') {
    const currentRevealed = Array.isArray(revealedTo) ? revealedTo : []
    if (!currentRevealed.includes(ownerId)) {
      revealedTo = [...currentRevealed, ownerId]
    }
  }

  const newCard = {
    ...targetCard,
    statuses: newStatuses,
    revealedTo
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: newCard }
      }
      return c
    })
  )

  let newState = { ...state, board: newBoard }

  // If Support status was added/removed, recalculate ready statuses for this card
  // This handles abilities that require Support (like Inventive Maker's Setup)
  if (statusType === 'Support' || replaceStatusType === 'Support') {
    recheckReadyStatuses(newCard, newState)
    // Get the updated card from the board after recheckReadyStatuses modified it
    const updatedCard = newState.board[row][col].card
    if (updatedCard !== newCard) {
      // Card was modified, update the board again
      newState = { ...newState, board: newState.board.map((r, rIdx) =>
        r.map((c, cIdx) => {
          if (rIdx === row && cIdx === col) {
            return c
          }
          return c
        })
      )}
    }
  }

  return newState
}

/**
 * ADD_STATUS_TO_HAND_CARD - add status (token) to card in hand
 * Used for Revealed token placement on opponent/dummy hand cards
 * Supports singleton statuses (Threat, Support, Revealed) - only one per owner
 */
function handleAddStatusToHandCard(state: GameState, _playerId: number, data: any): GameState {
  const { playerId, cardIndex, statusType, ownerId, count = 1 } = data || {}
  if (playerId === undefined || cardIndex === undefined || !statusType || ownerId === undefined) {
    return state
  }

  // Find the target player
  const targetPlayer = state.players.find(p => p.id === playerId)
  if (!targetPlayer) {
    return state
  }

  // Check if card exists at index
  if (cardIndex < 0 || cardIndex >= targetPlayer.hand.length) {
    return state
  }

  const targetCard = targetPlayer.hand[cardIndex]
  if (!targetCard) {
    return state
  }

  const existingStatuses = targetCard.statuses || []

  // Singleton statuses that cannot stack (only one instance allowed per owner)
  const SINGLETON_STATUSES = ['Threat', 'Support', 'Revealed']

  // Check if this is a singleton status
  const isSingletonStatus = SINGLETON_STATUSES.includes(statusType)

  if (isSingletonStatus) {
    // For singleton statuses, check if this owner already has this status on the card
    const alreadyHasStatus = existingStatuses.some(s => s.type === statusType && s.addedByPlayerId === ownerId)
    if (alreadyHasStatus) {
      // Card already has this singleton status from this owner - don't add another
      return state
    }
  }

  // Add the new status
  let newStatuses = [...existingStatuses]

  if (isSingletonStatus) {
    // For singleton, only add one
    const newStatus = { type: statusType, addedByPlayerId: ownerId }
    newStatuses = [...newStatuses, newStatus]
  } else {
    // For stackable tokens, add count tokens
    for (let i = 0; i < count; i++) {
      const newStatus = { type: statusType, addedByPlayerId: ownerId }
      newStatuses = [...newStatuses, newStatus]
    }
  }

  // If adding Revealed status, the card becomes visible to the token owner
  let revealedTo = targetCard.revealedTo
  if (statusType === 'Revealed') {
    const currentRevealed = Array.isArray(revealedTo) ? revealedTo : []
    if (!currentRevealed.includes(ownerId)) {
      revealedTo = [...currentRevealed, ownerId]
        }
  }

  const newCard = {
    ...targetCard,
    statuses: newStatuses,
    revealedTo
  }

  // Update player's hand
  const newHand = [...targetPlayer.hand]
  newHand[cardIndex] = newCard

  const newPlayers = state.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p)

  return { ...state, players: newPlayers }
}

/**
 * TRANSFER_ALL_STATUSES - transfer all statuses from one card to another
 * Used by Reckless Provocateur Commit
 * fromCoords: source card (has tokens to transfer)
 * toCoords: destination card (receives all tokens)
 *
 * CRITICAL: Only transfers gameplay tokens (Aim, Exploit, Rule, Shield, Stun, Revealed)
 * Does NOT transfer ready statuses (readyDeploy, readyCommit, readySetup) or internal states
 */
function handleTransferAllStatuses(state: GameState, _playerId: number, data: any): GameState {
  const { fromCoords, toCoords } = data || {}
  if (!fromCoords || !toCoords) {
    return state
  }

  const { row: fromRow, col: fromCol } = fromCoords
  const { row: toRow, col: toCol } = toCoords

  // Validate bounds
  if (fromRow === undefined || fromCol === undefined || toRow === undefined || toCol === undefined) {
    return state
  }
  if (fromRow < 0 || fromRow >= state.board.length || fromCol < 0 || fromCol >= state.board[fromRow]?.length) {
    return state
  }
  if (toRow < 0 || toRow >= state.board.length || toCol < 0 || toCol >= state.board[toRow]?.length) {
    return state
  }

  const fromCell = state.board[fromRow][fromCol]
  const toCell = state.board[toRow][toCol]

  if (!fromCell.card || !toCell.card) {
    return state
  }

  const fromCard = fromCell.card
  const toCard = toCell.card

  // Only transfer gameplay tokens, NOT ready statuses or internal states
  // Valid tokens: Aim, Exploit, Rule, Shield, Stun, Revealed
  const validTokenTypes = new Set(['Aim', 'Exploit', 'Rule', 'Shield', 'Stun', 'Revealed'])
  const allStatuses = fromCard.statuses || []

  // Filter to only valid gameplay tokens
  const statusesToTransfer = allStatuses.filter((s: any) => validTokenTypes.has(s.type))

  if (statusesToTransfer.length === 0) {
    return state
  }

  // Add only valid tokens to destination card
  const newToCardStatuses = [...(toCard.statuses || []), ...statusesToTransfer]

  // Preserve all non-transferred statuses on source card (ready statuses, internal states, etc.)
  // This includes: readyDeploy, readyCommit, readySetup, deployUsedThisTurn, etc.
  const newFromCardStatuses = allStatuses.filter((s: any) => !validTokenTypes.has(s.type))

  // Update both cards
  const newBoard = state.board.map((row, rIdx) =>
    row.map((cell, cIdx) => {
      if (rIdx === fromRow && cIdx === fromCol) {
        return {
          ...cell,
          card: {
            ...fromCard,
            statuses: newFromCardStatuses
          }
        }
      }
      if (rIdx === toRow && cIdx === toCol) {
        return {
          ...cell,
          card: {
            ...toCard,
            statuses: newToCardStatuses
          }
        }
      }
      return cell
    })
  )

  return { ...state, board: newBoard }
}

/**
 * PLAY_TOKEN_CARD - place token card on battlefield
 * Token is NOT removed from panel (can be used multiple times)
 * Owner = player who placed it (or dummy if active)
 *
 * CRITICAL: For Command cards, use the same flow as playing from hand:
 * 1. Move to announced (showcase) - removes from deck
 * 2. Then process command modal or execute actions
 */
function handlePlayTokenCard(state: GameState, playerId: number, data: any): GameState {
  const { card, boardCoords, ownerId } = data || {}
  if (!card || !boardCoords) {
    return state
  }

  const { row, col } = boardCoords
  if (row === undefined || col === undefined) {
    return state
  }

  // Validate bounds
  if (row < 0 || row >= state.board.length || col < 0 || col >= state.board[row]?.length) {
    return state
  }

  const cell = state.board[row][col]

  // CRITICAL: Check if this is a Command card
  const isCommandCard = isCommandCardByDefinition(card)

  if (isCommandCard) {
    // Command cards go through announced → discard flow, NOT directly to board
    // Find the player who owns this card
    const cardOwner = state.players.find(p => p.id === (ownerId ?? playerId))
    if (!cardOwner) {
      return state
    }

    // Move card from deck to announced (showcase)
    const updatedPlayers = state.players.map(p => {
      if (p.id === cardOwner.id) {
        // Remove card from deck
        const newDeck = (p.deck || []).filter((c: Card) => c.id !== card.id)

        // Add to announced
        const announcedCard = {
          ...card,
          isFaceUp: true,
          revealedTo: 'all' as const,
          revealedToPlayerIds: [],
        }

        return {
          ...p,
          deck: newDeck,
          deckSize: newDeck.length,
          announcedCard,
        }
      }
      return p
    })

    // NOTE: Command modal opening and action execution is handled client-side
    // This server-side change just moves the card to announced
    return { ...state, players: updatedPlayers }
  }

  // Regular token cards (Units, etc.) - place on empty cell only
  if (cell.card) {
    return state
  }

  // Create token card with proper owner
  const tokenCard: Card = {
    ...card,
    id: `token_${Date.now()}_${row}_${col}_${Math.random().toString(36).substring(2, 11)}`,
    ownerId: ownerId ?? playerId,
    enteredThisTurn: true,
    statuses: []
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: tokenCard }
      }
      return c
    })
  )

  return { ...state, board: newBoard }
}

/**
 * PLAY_COMMAND_FROM_TOKEN_PANEL - play command card from token panel
 * Moves command card from deck to announced (showcase)
 * Modal opening is handled client-side after receiving updated state
 */
function handlePlayCommandFromTokenPanel(state: GameState, playerId: number, data: any): GameState {
  const { card, ownerId } = data || {}
  if (!card) {
    return state
  }

  // Find the player who owns this card
  const cardOwner = state.players.find(p => p.id === (ownerId ?? playerId))
  if (!cardOwner) {
    return state
  }

  // Move card from deck to announced (showcase)
  const updatedPlayers = state.players.map(p => {
    if (p.id === cardOwner.id) {
      // Remove card from deck
      const newDeck = (p.deck || []).filter((c: Card) => c.id !== card.id)

      // Add to announced
      const announcedCard = {
        ...card,
        isFaceUp: true,
        revealedTo: 'all' as const,
        revealedToPlayerIds: [],
        ownerId: cardOwner.id  // CRITICAL: Set ownerId so command cards know which player owns them
      }

      return {
        ...p,
        deck: newDeck,
        deckSize: newDeck.length,
        announcedCard,
      }
    }
    return p
  })

  // Set phase to Main when command card is played
  // CRITICAL FIX: Only switch from Setup (1) to Main (2), never set to Setup
  const wasSetupPhase = state.currentPhase === 1
  return { ...state, players: updatedPlayers, currentPhase: wasSetupPhase ? 2 : state.currentPhase }
}

/**
 * PLAY_COMMAND_FROM_DECK - play command card from deck view
 * Moves command card from deck to announced (showcase)
 * Modal opening is handled client-side after receiving updated state
 */
function handlePlayCommandFromDeck(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, ownerId } = data || {}

  if (cardIndex === undefined) {
    return state
  }

  // Find the player who owns this card
  const cardOwner = state.players.find(p => p.id === (ownerId ?? playerId))
  if (!cardOwner) {
    return state
  }

  // Always get the actual card from deck to ensure all properties (imageUrl, etc.) are preserved
  // The passed 'card' object might only have cardId, so we get the full card from deck
  const deck = cardOwner.deck || []
  if (cardIndex < 0 || cardIndex >= deck.length) {
    return state
  }

  const actualCard = deck[cardIndex]
  if (!actualCard) {
    return state
  }

  // Move card from deck to announced (showcase)
  const updatedPlayers = state.players.map(p => {
    if (p.id === cardOwner.id) {
      // Remove card from deck by index
      const newDeck = [...deck]
      newDeck.splice(cardIndex, 1)

      // Add to announced - preserve all card properties including image
      const announcedCard = {
        ...actualCard,
        isFaceUp: true,
        revealedTo: 'all' as const,
        revealedToPlayerIds: [],
        ownerId: cardOwner.id  // CRITICAL: Set ownerId so command cards know which player owns them
      }

      return {
        ...p,
        deck: newDeck,
        deckSize: newDeck.length,
        announcedCard,
      }
    }
    return p
  })

  // Set phase to Main when command card is played
  // CRITICAL FIX: Only switch from Setup (1) to Main (2), never set to Setup
  const wasSetupPhase = state.currentPhase === 1
  return { ...state, players: updatedPlayers, currentPhase: wasSetupPhase ? 2 : state.currentPhase }
}

/**
 * PLAY_COMMAND_FROM_DISCARD - play command card from discard view
 * Moves command card from discard to announced (showcase)
 * Modal opening is handled client-side after receiving updated state
 */
function handlePlayCommandFromDiscard(state: GameState, playerId: number, data: any): GameState {
  const { cardIndex, ownerId } = data || {}

  if (cardIndex === undefined) {
    return state
  }

  // Find the player who owns this card
  const cardOwner = state.players.find(p => p.id === (ownerId ?? playerId))
  if (!cardOwner) {
    return state
  }

  // Always get the actual card from discard to ensure all properties (imageUrl, etc.) are preserved
  // The passed 'card' object might only have cardId, so we get the full card from discard
  const discard = cardOwner.discard || []
  if (cardIndex < 0 || cardIndex >= discard.length) {
    return state
  }

  const actualCard = discard[cardIndex]
  if (!actualCard) {
    return state
  }

  // Move card from discard to announced (showcase)
  const updatedPlayers = state.players.map(p => {
    if (p.id === cardOwner.id) {
      // Remove card from discard by index
      const newDiscard = [...discard]
      newDiscard.splice(cardIndex, 1)

      // Add to announced - preserve all card properties including image
      const announcedCard = {
        ...actualCard,
        isFaceUp: true,
        revealedTo: 'all' as const,
        revealedToPlayerIds: [],
        ownerId: cardOwner.id  // CRITICAL: Set ownerId so command cards know which player owns them
      }

      return {
        ...p,
        discard: newDiscard,
        discardSize: newDiscard.length,
        announcedCard,
      }
    }
    return p
  })

  // Set phase to Main when command card is played
  // CRITICAL FIX: Only switch from Setup (1) to Main (2), never set to Setup
  const wasSetupPhase = state.currentPhase === 1
  return { ...state, players: updatedPlayers, currentPhase: wasSetupPhase ? 2 : state.currentPhase }
}

/**
 * FLIP_CARD - flip a card face-up or face-down on the battlefield
 *
 * When flipping face-up:
 * - Card immediately receives readyDeploy status if it has a deploy ability
 * - Card starts receiving ready statuses in future updates
 *
 * When flipping face-down:
 * - Card loses all ready statuses (handled by updateCardReadyStatuses)
 * - Card stops receiving ready statuses until flipped face-up again
 */
function handleFlipCard(state: GameState, _playerId: number, data: any): GameState {
  const { boardCoords, faceDown } = data || {}
  if (!boardCoords || faceDown === undefined) {
    return state
  }

  const { row, col } = boardCoords
  if (row === undefined || col === undefined) {
    return state
  }

  // Validate bounds
  if (row < 0 || row >= state.board.length || col < 0 || col >= state.board[row]?.length) {
    return state
  }

  const cell = state.board[row][col]
  if (!cell || !cell.card) {
    return state
  }

  // Create new card with flipped isFaceDown value
  const targetCard = cell.card
  let newCard = {
    ...targetCard,
    isFaceDown: faceDown
  }

  // When flipping face-up, immediately add readyDeploy if card has deploy ability
  if (!faceDown && targetCard.ownerId !== undefined) {
    const abilityInfo = getCardAbilityInfo(targetCard)

    if (abilityInfo.hasDeployAbility && targetCard.statuses) {
      // Check if deploy ability hasn't been used yet
      const deployAlreadyUsed = targetCard.statuses.some(
        (s: any) => s.type === 'deployUsedThisTurn'
      )

      if (!deployAlreadyUsed) {
        // Add readyDeploy status
        if (!targetCard.statuses.some((s: any) => s.type === READY_STATUS.DEPLOY)) {
          newCard = {
            ...newCard,
            statuses: [
              ...(newCard.statuses || []),
              { type: READY_STATUS.DEPLOY, addedByPlayerId: targetCard.ownerId }
            ]
          }
            }
      }
    }
  }

  const newBoard = state.board.map((r, rIdx) =>
    r.map((c, cIdx) => {
      if (rIdx === row && cIdx === col) {
        return { card: newCard }
      }
      return c
    })
  )

  return { ...state, board: newBoard }
}

/**
 * REORDER_CARDS - Reorder cards in a player's deck or discard
 * Used by DeckViewModal when player drags cards to reorder them
 */
function handleReorderCards(state: GameState, _playerId: number, data: any): GameState {
  const { playerId: targetPlayerId, newOrder } = data || {}
  if (!targetPlayerId || !newOrder || !Array.isArray(newOrder)) {
    return state
  }

  const player = state.players.find(p => p.id === targetPlayerId)
  if (!player) {
    return state
  }

  // Determine if we're updating deck or discard based on card count
  // Deck typically has many cards, discard is usually smaller
  const isDeck = newOrder.length > 10 || (player.deckSize && newOrder.length === player.deckSize)

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      if (isDeck) {
        return { ...p, deck: newOrder, deckSize: newOrder.length }
      } else {
        return { ...p, discard: newOrder, discardSize: newOrder.length }
      }
    }
    return p
  })

  return { ...state, players: newPlayers as Player[] }
}

/**
 * REORDER_TOP_DECK - Reorder top cards of a deck (for TopDeckView)
 * Updates the player's deck with the reordered top cards
 */
function handleReorderTopDeck(state: GameState, _playerId: number, data: any): GameState {
  const { playerId: targetPlayerId, newTopCards } = data || {}
  if (!targetPlayerId || !newTopCards || !Array.isArray(newTopCards)) {
    return state
  }

  const player = state.players.find(p => p.id === targetPlayerId)
  if (!player || !player.deck) {
    return state
  }

  // Reorder: replace top cards with new order, keep rest of deck unchanged
  const topCount = newTopCards.length
  const remainingDeck = player.deck.slice(topCount)
  const newDeck = [...newTopCards, ...remainingDeck]

  const newPlayers = state.players.map(p => {
    if (p.id === targetPlayerId) {
      return { ...p, deck: newDeck, deckSize: newDeck.length }
    }
    return p
  })

  return { ...state, players: newPlayers as Player[] }
}

/**
 * REQUEST_DECK_VIEW - Request full deck data for viewing another player's deck
 * This sets a temporary flag that personalizes the state to include full deck data
 * for the requesting player. The flag is cleared by the host after broadcasting.
 *
 * data: { targetPlayerId: number } - the player whose deck we want to view
 */
function handleRequestDeckView(state: GameState, playerId: number, data: any): GameState {
  const { targetPlayerId } = data || {}
  if (targetPlayerId === undefined) {
    return state
  }

  const targetPlayer = state.players.find(p => p.id === targetPlayerId)
  if (!targetPlayer) {
    return state
  }


  // Add a temporary flag to the state that tells personalizeForPlayer
  // to include full deck data for this player's deck to the requesting player
  // This flag will be cleared by SimpleHost after broadcasting
  return {
    ...state,
    // @ts-ignore - temporary flag for deck view request
    _deckViewRequest: {
      requestingPlayerId: playerId,
      targetPlayerId
    }
  }
}

