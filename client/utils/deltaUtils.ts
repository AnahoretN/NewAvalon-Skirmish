/**
 * @file Delta utilities for game state changes and rewind system
 * Provides functions to create, apply, and reverse state deltas
 */

import type { GameDelta, DeltaPath, GameState } from '@/types'
import { deepCloneState } from './common'

/**
 * Deep clone a value (using common utility)
 */
function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(deepClone) as T
  }
  const cloned = {} as T
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      cloned[key] = deepClone(value[key])
    }
  }
  return cloned
}

/**
 * Resolve a path to get the target object and final key
 * Returns { target, key } where target[key] is the final destination
 */
export function resolvePath(state: any, path: DeltaPath): { target: any; key: string | number } {
  if (path.length === 0) {
    return { target: null, key: '' }
  }

  let current = state
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i]
    if (current === null || current === undefined) {
      return { target: null, key: path[path.length - 1] }
    }
    current = current[segment]
  }

  return { target: current, key: path[path.length - 1] }
}

/**
 * Get a value at a specific path in the state
 */
export function getValueAtPath(state: any, path: DeltaPath): any {
  const { target, key } = resolvePath(state, path)
  if (target === null || target === undefined) {return undefined}
  return target[key]
}

/**
 * Set a value at a specific path in the state (mutates!)
 */
export function setValueAtPath(state: any, path: DeltaPath, value: any): void {
  const { target, key } = resolvePath(state, path)
  if (target !== null && target !== undefined) {
    target[key] = value
  }
}

/**
 * Apply a single delta to the state
 * @returns New state with delta applied (does NOT mutate original)
 */
export function applyDelta(state: any, delta: GameDelta): any {
  const newState = deepClone(state)
  const { target, key } = resolvePath(newState, delta.path)

  if (target === null || target === undefined) {
    return state
  }

  switch (delta.op) {
    case 'add':
      // For arrays, push; for objects, merge
      if (Array.isArray(target[key])) {
        target[key].push(delta.after)
      } else if (typeof target[key] === 'object' && target[key] !== null) {
        target[key] = { ...target[key], ...delta.after }
      } else {
        target[key] = delta.after
      }
      break
    case 'remove':
      if (Array.isArray(target)) {
        target.splice(key as number, 1)
      } else {
        delete target[key]
      }
      break
    case 'set':
    default:
      target[key] = deepClone(delta.after)
      break
  }

  return newState
}

/**
 * Apply multiple deltas to the state
 * @returns New state with all deltas applied
 */
export function applyDeltas(state: any, deltas: GameDelta[]): any {
  return deltas.reduce((acc, delta) => applyDelta(acc, delta), state)
}

/**
 * Create an inverse delta (swap before/after)
 */
export function invertDelta(delta: GameDelta): GameDelta {
  const inverseOp: Record<string, string> = {
    add: 'remove',
    remove: 'add',
    set: 'set'
  }

  return {
    path: [...delta.path],
    before: deepClone(delta.after),
    after: deepClone(delta.before),
    op: inverseOp[delta.op || 'set'] as any
  }
}

/**
 * Create inverse deltas for an array of deltas
 */
export function invertDeltas(deltas: GameDelta[]): GameDelta[] {
  return deltas.map(invertDelta).reverse()
}

/**
 * Create a delta by comparing before and after states
 * Detects changes and creates appropriate delta entries
 */
export function createDelta(
  path: DeltaPath,
  before: any,
  after: any,
  op?: 'set' | 'add' | 'remove'
): GameDelta {
  return {
    path: [...path],
    before: deepClone(before),
    after: deepClone(after),
    op
  }
}

/**
 * Compare two states and create deltas for differences
 * This is a simplified version - for complex nested diffs, more logic is needed
 */
export function createDeltasFromDiff(
  beforeState: any,
  afterState: any,
  basePath: DeltaPath = []
): GameDelta[] {
  const deltas: GameDelta[] = []

  // Handle null/undefined cases
  if (beforeState === afterState) {return []}
  if (beforeState === null || beforeState === undefined) {
    return [{ path: basePath, before: null, after: deepClone(afterState), op: 'set' }]
  }
  if (afterState === null || afterState === undefined) {
    return [{ path: basePath, before: deepClone(beforeState), after: null, op: 'set' }]
  }

  // Handle primitives
  if (typeof beforeState !== 'object' || typeof afterState !== 'object') {
    if (beforeState !== afterState) {
      return [{ path: basePath, before: beforeState, after: afterState, op: 'set' }]
    }
    return []
  }

  // Handle arrays
  if (Array.isArray(beforeState) && Array.isArray(afterState)) {
    const maxLength = Math.max(beforeState.length, afterState.length)
    for (let i = 0; i < maxLength; i++) {
      const before = beforeState[i]
      const after = afterState[i]

      if (before === undefined && after !== undefined) {
        deltas.push({ path: [...basePath, i], before: undefined, after: deepClone(after), op: 'add' })
      } else if (after === undefined && before !== undefined) {
        deltas.push({ path: [...basePath, i], before: deepClone(before), after: undefined, op: 'remove' })
      } else if (before !== after) {
        // Recursively diff nested objects/arrays
        const nestedDeltas = createDeltasFromDiff(before, after, [...basePath, i])
        deltas.push(...nestedDeltas)
      }
    }
    return deltas
  }

  // Handle objects
  const allKeys = new Set([...Object.keys(beforeState || {}), ...Object.keys(afterState || {})])
  for (const key of allKeys) {
    const before = beforeState?.[key]
    const after = afterState?.[key]

    if (before === undefined && after !== undefined) {
      deltas.push({ path: [...basePath, key], before: undefined, after: deepClone(after), op: 'add' })
    } else if (after === undefined && before !== undefined) {
      deltas.push({ path: [...basePath, key], before: deepClone(before), after: undefined, op: 'remove' })
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      // Recursively diff nested objects/arrays
      const nestedDeltas = createDeltasFromDiff(before, after, [...basePath, key])
      deltas.push(...nestedDeltas)
    }
  }

  return deltas
}

/**
 * Helper functions to create common game action deltas
 */
export const GameDeltaHelpers = {
  /**
   * Delta for playing a card to board
   */
  playCard: (row: number, col: number, cardBefore: any, cardAfter: any): GameDelta => ({
    path: ['board', row, col, 'card'],
    before: cardBefore,
    after: cardAfter,
    op: 'set'
  }),

  /**
   * Delta for drawing a card (adds to hand)
   */
  drawCard: (playerId: number, handBefore: any[], handAfter: any[]): GameDelta => ({
    path: ['players', playerId, 'hand'],
    before: handBefore,
    after: handAfter,
    op: 'set'
  }),

  /**
   * Delta for destroying a card
   */
  destroyCard: (row: number, col: number, cardBefore: any): GameDelta => ({
    path: ['board', row, col, 'card'],
    before: cardBefore,
    after: null,
    op: 'set'
  }),

  /**
   * Delta for returning card to hand
   */
  returnToHand: (
    row: number,
    col: number,
    cardFromBoard: any,
    playerId: number,
    handBefore: any[],
    handAfter: any[]
  ): GameDelta[] => [
    {
      path: ['board', row, col, 'card'],
      before: cardFromBoard,
      after: null,
      op: 'set'
    },
    {
      path: ['players', playerId, 'hand'],
      before: handBefore,
      after: handAfter,
      op: 'set'
    }
  ],

  /**
   * Delta for score change
   */
  scoreChange: (playerId: number, scoreBefore: number, scoreAfter: number): GameDelta => ({
    path: ['players', playerId, 'score'],
    before: scoreBefore,
    after: scoreAfter,
    op: 'set'
  }),

  /**
   * Delta for moving card between board positions
   */
  moveCard: (
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number,
    card: any,
    toCellBefore: any
  ): GameDelta[] => [
    {
      path: ['board', fromRow, fromCol, 'card'],
      before: card,
      after: null,
      op: 'set'
    },
    {
      path: ['board', toRow, toCol, 'card'],
      before: toCellBefore,
      after: card,
      op: 'set'
    }
  ],

  /**
   * Delta for announcing a card
   */
  announceCard: (playerId: number, announcedBefore: any, announcedAfter: any): GameDelta => ({
    path: ['players', playerId, 'announcedCard'],
    before: announcedBefore,
    after: announcedAfter,
    op: 'set'
  })
}
