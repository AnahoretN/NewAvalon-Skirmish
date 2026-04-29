/**
 * @file Game State Logger - Integrates delta generation with game actions
 * Wraps game logic functions to automatically generate deltas for logging
 */

import type { GameState, GameDelta, Card, Player } from '@/types'
import { createDeltasFromDiff, GameDeltaHelpers } from './deltaUtils'

/**
 * Context for tracking state changes during an action
 */
interface ActionContext {
  beforeState: GameState
  afterState: GameState
  actionType: string
  playerId: number
}

/**
 * Logger class that tracks state changes
 */
export class GameStateLogger {
  private beforeState: GameState | null = null
  private actionType: string | null = null
  private playerId: number | null = null

  /**
   * Start tracking an action
   * Call this BEFORE performing the action
   */
  startAction(actionType: string, playerId: number, currentState: GameState): void {
    this.beforeState = JSON.parse(JSON.stringify(currentState))
    this.actionType = actionType
    this.playerId = playerId
  }

  /**
   * End tracking and generate deltas
   * Call this AFTER performing the action
   */
  endAction(currentState: GameState): GameDelta[] | null {
    if (!this.beforeState || !this.actionType || this.playerId === null) {
      console.warn('[GameStateLogger] endAction called without startAction')
      return null
    }

    const afterState = currentState
    const deltas = createDeltasFromDiff(this.beforeState, afterState)

    // Reset tracking
    this.beforeState = null
    this.actionType = null
    this.playerId = null

    return deltas
  }

  /**
   * Check if currently tracking an action
   */
  isTracking(): boolean {
    return this.beforeState !== null
  }
}

// Global instance for use across the app
const globalLogger = new GameStateLogger()

/**
 * Wrapper function that executes a game action and generates deltas
 *
 * Usage:
 * const result = withDeltaLogging(
 *   gameState,
 *   'PLAY_CARD',
 *   playerId,
 *   (state) => performPlayCard(state, ...args)
 * )
 *
 * Returns: { newState: GameState, deltas: GameDelta[] }
 */
export function withDeltaLogging<T = GameState>(
  beforeState: GameState,
  actionType: string,
  playerId: number,
  actionFn: (state: GameState) => T
): { result: T; deltas: GameDelta[] } {
  // Clone state to avoid mutations during comparison
  const stateClone = JSON.parse(JSON.stringify(beforeState))

  // Execute the action
  const result = actionFn(stateClone)

  // Generate deltas
  const deltas = createDeltasFromDiff(beforeState, result as any)

  return { result, deltas }
}

/**
 * Helper functions for creating specific action deltas
 * These create deltas manually for common actions without full state diff
 */
export const ActionDeltas = {
  /**
   * Create deltas for playing a card from hand to board
   */
  playCard: (
    beforeState: GameState,
    playerId: number,
    cardIndex: number,
    row: number,
    col: number,
    faceUp: boolean
  ): GameDelta[] => {
    const player = beforeState.players.find(p => p.id === playerId)
    if (!player) {
      return []
    }

    const card = player.hand?.[cardIndex]
    if (!card) {
      return []
    }

    const handBefore = [...(player.hand || [])]
    const handAfter = handBefore.filter((_, i) => i !== cardIndex)

    const cellBefore = beforeState.board[row]?.[col]
    const cardAfter = { ...card, faceUp }

    return [
      GameDeltaHelpers.playCard(row, col, cellBefore?.card || null, cardAfter),
      {
        path: ['players', playerId, 'hand'],
        before: handBefore,
        after: handAfter,
        op: 'set'
      }
    ]
  },

  /**
   * Create deltas for drawing a card
   */
  drawCard: (
    beforeState: GameState,
    playerId: number,
    drawnCard: Card
  ): GameDelta[] => {
    const player = beforeState.players.find(p => p.id === playerId)
    if (!player) {
      return []
    }

    const handBefore = [...(player.hand || [])]
    const handAfter = [...handBefore, drawnCard]

    const deckSizeBefore = player.deck?.length || 0
    const deckSizeAfter = deckSizeBefore - 1

    const deltas: GameDelta[] = [
      {
        path: ['players', playerId, 'hand'],
        before: handBefore,
        after: handAfter,
        op: 'set'
      }
    ]

    if (deckSizeAfter !== deckSizeBefore) {
      deltas.push({
        path: ['players', playerId, 'deckSize'],
        before: deckSizeBefore,
        after: deckSizeAfter,
        op: 'set'
      })
    }

    return deltas
  },

  /**
   * Create deltas for destroying a card
   */
  destroyCard: (
    beforeState: GameState,
    row: number,
    col: number
  ): GameDelta[] => {
    const cell = beforeState.board[row]?.[col]
    if (!cell) {
      return []
    }

    return [
      GameDeltaHelpers.destroyCard(row, col, cell.card)
    ]
  },

  /**
   * Create deltas for moving a card
   */
  moveCard: (
    beforeState: GameState,
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ): GameDelta[] => {
    const fromCell = beforeState.board[fromRow]?.[fromCol]
    const toCell = beforeState.board[toRow]?.[toCol]

    if (!fromCell) {
      return []
    }

    return GameDeltaHelpers.moveCard(
      fromRow,
      fromCol,
      toRow,
      toCol,
      fromCell.card,
      toCell?.card || null
    )
  },

  /**
   * Create deltas for announcing a card
   */
  announceCard: (
    beforeState: GameState,
    playerId: number,
    card: Card
  ): GameDelta[] => {
    const player = beforeState.players.find(p => p.id === playerId)
    if (!player) {
      return []
    }

    return [
      GameDeltaHelpers.announceCard(playerId, player.announcedCard, card)
    ]
  },

  /**
   * Create deltas for returning a card to hand
   */
  returnToHand: (
    beforeState: GameState,
    row: number,
    col: number,
    playerId: number
  ): GameDelta[] => {
    const cell = beforeState.board[row]?.[col]
    const player = beforeState.players.find(p => p.id === playerId)

    if (!cell?.card || !player) {
      return []
    }

    const handBefore = [...(player.hand || [])]
    const handAfter = [...handBefore, cell.card]

    return GameDeltaHelpers.returnToHand(
      row,
      col,
      cell.card,
      playerId,
      handBefore,
      handAfter
    )
  },

  /**
   * Create deltas for score change
   */
  scoreChange: (
    beforeState: GameState,
    playerId: number,
    scoreDelta: number
  ): GameDelta[] => {
    const player = beforeState.players.find(p => p.id === playerId)
    if (!player) {
      return []
    }

    const scoreBefore = player.score || 0
    const scoreAfter = scoreBefore + scoreDelta

    return [
      GameDeltaHelpers.scoreChange(playerId, scoreBefore, scoreAfter)
    ]
  },

  /**
   * Create deltas for phase change
   */
  phaseChange: (
    beforeState: GameState,
    newPhase: number
  ): GameDelta[] => {
    return [
      {
        path: ['currentPhase'],
        before: beforeState.currentPhase,
        after: newPhase,
        op: 'set'
      }
    ]
  },

  /**
   * Create deltas for turn change
   */
  turnChange: (
    beforeState: GameState,
    newPlayerId: number
  ): GameDelta[] => {
    return [
      {
        path: ['activePlayerId'],
        before: beforeState.activePlayerId,
        after: newPlayerId,
        op: 'set'
      }
    ]
  },

  /**
   * Create deltas for round start
   */
  roundStart: (
    beforeState: GameState,
    roundNumber: number
  ): GameDelta[] => {
    return [
      {
        path: ['currentRound'],
        before: beforeState.currentRound,
        after: roundNumber,
        op: 'set'
      },
      {
        path: ['turnNumber'],
        before: beforeState.turnNumber,
        after: 1,
        op: 'set'
      }
    ]
  }
}

/**
 * Hook for use in components to log actions with deltas
 * This is a simpler interface that works with useGameLog
 */
export function logActionWithDeltas(
  addLogEntry: (
    type: string,
    details: any,
    playerId?: number,
    deltas?: any[]
  ) => void,
  actionType: string,
  details: any,
  playerId: number,
  getDeltas: () => any[] | undefined
): void {
  const deltas = getDeltas()
  addLogEntry(actionType, details, playerId, deltas)
}

export { globalLogger }
