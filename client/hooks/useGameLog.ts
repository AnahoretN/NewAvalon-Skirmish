import { useState, useCallback, useRef } from 'react'
import type { GameState, GameLogEntry, GameLogActionType, Player, PlayerColor, GameDelta } from '@/types'
import { deepCloneState } from '@/utils/common'
import { applyDeltas, invertDeltas } from '@/utils/deltaUtils'

interface UseGameLogProps {
  gameState: GameState | null
  localPlayerId: number | null
  isHost: boolean
  sendAction: (action: string, data?: any) => void
}

interface UseGameLogReturn {
  logs: GameLogEntry[]
  addLogEntry: (type: GameLogActionType, details: any, playerId?: number, deltas?: GameDelta[]) => void
  addLogEntryDirect: (entry: GameLogEntry) => void
  clearLogs: () => void
  getLogSnapshot: () => GameLogEntry[]
  restoreLogSnapshot: (logs: GameLogEntry[]) => void
  canRewind: boolean
  canForward: boolean
  currentLogIndex: number
  rewindToLog: (logId: string) => void
  forwardLog: () => void
  backwardLog: () => void
  resetRewindState: () => void
  // New: base state for delta reconstruction
  getBaseState: () => GameState | null
  setBaseState: (state: GameState) => void
  // New: compute state at specific log index
  computeStateAtIndex: (index: number) => GameState | null
}

// Storage for rewind functionality (host only)
let rewindHistory: { entryId: string; inverseDeltas: GameDelta[] }[] = []
// Use -1 to indicate "no logs yet", will be set to logs.length - 1 when logs exist
let rewindIndex = -1
// Base state - the state before any logged actions
let baseState: GameState | null = null

export const useGameLog = ({
  gameState,
  localPlayerId,
  isHost,
  sendAction,
}: UseGameLogProps): UseGameLogReturn => {
  const [logs, setLogs] = useState<GameLogEntry[]>([])

  // Generate unique ID for log entries
  const generateLogId = useCallback((): string => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }, [])

  // Initialize base state (call once when game starts)
  const initializeBaseState = useCallback((initialState: GameState) => {
    if (!baseState) {
      baseState = deepCloneState(initialState)
    }
  }, [])

  // Get base state
  const getBaseState = useCallback(() => {
    return baseState ? deepCloneState(baseState) : null
  }, [])

  // Set base state (for testing/manual override)
  const setBaseState = useCallback((state: GameState) => {
    baseState = deepCloneState(state)
  }, [])

  /**
   * Compute game state at a specific log index by applying deltas
   * Starting from base state, apply all deltas up to the index
   */
  const computeStateAtIndex = useCallback((index: number): GameState | null => {
    if (!baseState) {
      return null
    }

    if (index < 0) {
      return deepCloneState(baseState)
    }

    if (index >= logs.length) {
      index = logs.length - 1
    }

    // Start from base state
    let computedState = deepCloneState(baseState)

    // Apply all deltas up to and including the index
    for (let i = 0; i <= index; i++) {
      const entry = logs[i]
      if (entry.deltas && entry.deltas.length > 0) {
        computedState = applyDeltas(computedState, entry.deltas)
      }
    }

    return computedState
  }, [logs])

  /**
   * Add a log entry with deltas
   * @param type - Action type
   * @param details - Action details for display
   * @param playerId - Player who performed the action
   * @param deltas - Deltas representing the state change
   */
  const addLogEntry = useCallback((
    type: GameLogActionType,
    details: any = {},
    playerId?: number,
    deltas?: GameDelta[]
  ) => {
    if (!gameState) {
      return
    }

    // Initialize base state on first log entry (any type)
    // For perfect accuracy, we'd need state BEFORE the action, but using current state as fallback
    if (!baseState) {
      if (type === 'GAME_START') {
        // GAME_START happens at initialization, so current state IS the base
        initializeBaseState(gameState)
      } else if (logs.length === 0) {
        // First entry is not GAME_START - use current state as base (imperfect but functional)
        initializeBaseState(gameState)
      }
    }

    const actorId = playerId ?? localPlayerId ?? 0
    const player = gameState.players.find(p => p.id === actorId)

    if (!player) {
      return
    }

    const entry: GameLogEntry = {
      id: generateLogId(),
      timestamp: Date.now(),
      type,
      playerId: actorId,
      playerName: player.name,
      playerColor: player.color,
      round: gameState.currentRound,
      turn: gameState.turnNumber,
      phase: gameState.currentPhase,
      details,
      deltas: deltas ? deepCloneState(deltas) : undefined,
      inverseDeltas: deltas ? invertDeltas(deltas) : undefined
    }


    // Update local state
    setLogs(prev => {
      const newLogs = [...prev, entry]
      return newLogs
    })

    // Add to rewind history (host only) - only store inverse deltas
    if (isHost && entry.inverseDeltas) {
      rewindHistory.push({ entryId: entry.id, inverseDeltas: entry.inverseDeltas })
      rewindIndex = rewindHistory.length - 1
    }

    // Broadcast to other players (guests get deltas but no inverseDeltas)
    const entryForGuests = { ...entry, inverseDeltas: undefined }
    sendAction('ADD_GAME_LOG_ENTRY', { entry: entryForGuests })

    return entry
  }, [gameState, localPlayerId, isHost, generateLogId, sendAction, initializeBaseState, logs])

  // Add a log entry directly (for receiving from host)
  const addLogEntryDirect = useCallback((entry: GameLogEntry) => {
    setLogs(prev => [...prev, entry])

    // Guests don't store rewind history
    // Only host stores inverseDeltas for rewind functionality
  }, [])

  // Clear all logs
  const clearLogs = useCallback(() => {
    setLogs([])
    rewindHistory = []
    rewindIndex = 0  // Reset to 0, not -1
    baseState = null
  }, [])

  // Get current log snapshot
  const getLogSnapshot = useCallback(() => {
    return [...logs]
  }, [logs])

  // Restore log snapshot
  const restoreLogSnapshot = useCallback((snapshot: GameLogEntry[]) => {
    setLogs(snapshot)
  }, [])

  /**
   * Rewind to a specific log entry (host only)
   * Instead of restoring a full snapshot, we apply inverse deltas
   * from current point back to the target point
   */
  const rewindToLog = useCallback((logId: string) => {
    if (!isHost) {return}

    const targetIndex = logs.findIndex(l => l.id === logId)
    if (targetIndex === -1) {return}

    // Find current rewind index
    const currentIndex = rewindIndex

    if (targetIndex === currentIndex) {return}

    // Compute state at target index
    const restoredState = computeStateAtIndex(targetIndex)
    if (!restoredState) {
      return
    }

    // Update rewind index
    rewindIndex = targetIndex

    // Send restore state action
    sendAction('RESTORE_GAME_STATE', {
      gameState: restoredState,
      logId,
      targetIndex,
    })

  }, [isHost, logs, computeStateAtIndex, sendAction])

  // Forward one step (host only)
  const forwardLog = useCallback(() => {
    if (!isHost || rewindIndex >= logs.length - 1) {return}

    const targetIndex = rewindIndex + 1
    const restoredState = computeStateAtIndex(targetIndex)

    if (!restoredState) {
      return
    }

    rewindIndex = targetIndex
    const targetLog = logs[targetIndex]

    sendAction('RESTORE_GAME_STATE', {
      gameState: restoredState,
      logId: targetLog?.id,
      targetIndex,
    })
  }, [isHost, logs, computeStateAtIndex, sendAction])

  // Backward one step (host only)
  const backwardLog = useCallback(() => {
    if (!isHost || rewindIndex <= 0) {return}

    const targetIndex = rewindIndex - 1
    const restoredState = computeStateAtIndex(targetIndex)

    if (!restoredState) {
      return
    }

    rewindIndex = targetIndex
    const targetLog = logs[targetIndex]

    sendAction('RESTORE_GAME_STATE', {
      gameState: restoredState,
      logId: targetLog?.id,
      targetIndex,
    })
  }, [isHost, computeStateAtIndex, sendAction])

  // Reset rewind state (called when new actions occur after rewind)
  const resetRewindState = useCallback(() => {
    rewindIndex = logs.length - 1
  }, [logs.length])

  // Calculate can rewind/forward
  // rewindIndex = -1 means no logs yet or not initialized
  const canRewind = isHost && rewindIndex > 0
  const canForward = isHost && rewindIndex >= 0 && rewindIndex < logs.length - 1

  return {
    logs,
    addLogEntry,
    addLogEntryDirect,
    clearLogs,
    getLogSnapshot,
    restoreLogSnapshot,
    canRewind,
    canForward,
    currentLogIndex: rewindIndex,
    rewindToLog,
    forwardLog,
    backwardLog,
    resetRewindState,
    getBaseState,
    setBaseState,
    computeStateAtIndex,
  }
}

// Helper functions for creating log entries
export const createLogDetails = {
  drawCard: (cardName: string) => ({ cardName }),
  drawMultipleCards: (count: number) => ({ count }),
  playCard: (cardName: string, coords?: { row: number; col: number }) => ({ cardName, coords }),
  announceCard: (cardName: string, module?: number) => ({ cardName, commandModule: module }),
  moveCard: (cardName: string, from?: string, to?: string, fromCoords?: { row: number; col: number }, toCoords?: { row: number; col: number }) => ({ cardName, from, to, fromCoords, toCoords }),
  destroyCard: (cardName: string) => ({ cardName }),
  returnToHand: (cardName: string) => ({ cardName }),
  discardCard: (cardName: string) => ({ cardName }),
  discardFromBoard: (cardName: string) => ({ cardName }),
  activateAbility: (cardName: string, abilityText: string, targetLocation?: 'board' | 'hand' | 'discard' | 'deck' | 'showcase', targetPlayerName?: string, toCoords?: { row: number; col: number }) => ({ cardName, abilityText, targetLocation, targetPlayerName, toCoords }),
  placeToken: (tokenType: string, targetCardName?: string) => ({ abilityText: tokenType, targetCardName }),
  placeTokenOnCard: (tokenType: string, targetPlayerName?: string, targetCardName?: string, toCoords?: { row: number; col: number }, targetLocation?: 'board' | 'hand') => ({ abilityText: tokenType, targetPlayerName, targetCardName, toCoords, targetLocation }),
  removeStatus: (statusType: string, cardName: string) => ({ abilityText: statusType, cardName }),
  addStatus: (statusType: string, cardName: string) => ({ abilityText: statusType, cardName }),
  scorePoints: (amount: number, newScore: number) => ({ amount, newScore }),
  roundWin: (winners: number[], winnerName?: string) => ({ winners, winnerName }),
  matchWin: (winnerName: string) => ({ winnerName }),
  commandOption: (cardName: string, option: string) => ({ cardName, commandOption: option }),
  playerAction: (targetPlayerName: string) => ({ targetPlayerName }),
}

// Handle log entry from server
export const handleGameLogEntry = (
  data: { entry: GameLogEntry },
  addLogEntryDirect: (entry: GameLogEntry) => void
) => {
  addLogEntryDirect(data.entry)
}

// Handle logs sync from server
export const handleGameLogsSync = (
  data: { logs: GameLogEntry[] },
  restoreLogSnapshot: (logs: GameLogEntry[]) => void
) => {
  restoreLogSnapshot(data.logs)
}
