/**
 * Empty Cell Click Handlers
 *
 * Handles clicks on empty cells on the game board
 */

import type { AbilityAction, CursorStackState, CommandContext, Card } from '@/types'
import { validateTarget } from '@shared/utils/targeting'
import { TIMING } from '@/utils/common'
import { handleLineSelection as handleLineSelectionModule } from './lineSelectionHandlers.js'
import { advanceToNextStepWithCoords, type ModeHandlersProps } from './modeHandlers.js'

export interface EmptyCellClickProps {
  gameState: any
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  clearTargetingMode: () => void
  cursorStack: CursorStackState | null
  commandContext: CommandContext
  setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>
  playMode: any
  draggedItem: any
  interactionLock: React.MutableRefObject<boolean>
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  handleDrop: (item: any, target: any) => void
  moveItem: (item: any, target: any) => void
  setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>
  triggerNoTarget: (coords: { row: number; col: number }) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  spawnToken: (coords: {row: number; col: number}, name: string, ownerId: number) => void
  resurrectDiscardedCard: (playerId: number, cardIndex: number, targetCoords: {row: number, col: number}) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: any) => void
  handleLineSelection: (coords: {row: number, col: number}) => void
  addBoardCardStatus: (coords: { row: number; col: number }, status: string, playerId: number, count?: number) => void
  updateState?: (stateOrFn: any) => void
  nextPhase?: (forceTurnPass?: boolean) => void
  modifyBoardCardPower?: (coords: any, delta: number) => void
  scoreLine?: (r1: number, c1: number, r2: number, c2: number, pid: number) => void
  scoreDiagonal?: (r1: number, c1: number, r2: number, c2: number, pid: number, bonusType?: 'point_per_support' | 'draw_per_support') => void
  openContextMenu: (e: React.MouseEvent, type: string, data: any) => void
  triggerDeckSelection: (playerId: number, selectedByPlayerId: number) => void
  isWebRTCMode?: boolean
  setActionQueue?: React.Dispatch<React.SetStateAction<AbilityAction[]>>
  // CRITICAL: Props needed for AUTO_STEPS continuation (Logistics Chain, etc.)
  getFreshGameState?: () => any
  setTargetingMode?: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: CommandContext, preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]) => void
  calculateValidTargets?: (action: AbilityAction, gameState: any, ownerId: number, commandContext?: CommandContext) => {row: number, col: number}[]
}

/**
 * Handle click on empty board cell
 */
export function handleEmptyCellClick(
  boardCoords: { row: number; col: number },
  props: EmptyCellClickProps
): boolean {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    setAbilityMode,
    clearTargetingMode,
    cursorStack,
    commandContext,
    setCommandContext,
    playMode,
    draggedItem,
    interactionLock,
    handleActionExecution,
    handleDrop,
    moveItem,
    markAbilityUsed,
    spawnToken,
    resurrectDiscardedCard,
    updatePlayerScore,
    triggerFloatingText,
    handleLineSelection: _handleLineSelection,
    addBoardCardStatus,
    nextPhase,
    modifyBoardCardPower,
    scoreLine,
    scoreDiagonal,
    setActionQueue,
    // CRITICAL: Props needed for AUTO_STEPS continuation
    getFreshGameState,
    setTargetingMode,
    calculateValidTargets,
  } = props

  // Alias for backward compatibility
  const modifyBoardPower = modifyBoardCardPower

  // Ignore if interaction is locked
  if (interactionLock.current) {
    return false
  }

  const gridSize = gameState.board.length

  // === DRAG & DROP ===
  if (draggedItem) {
    // Check if dragging to valid empty cell
    if (boardCoords.row >= 0 && boardCoords.row < gridSize && boardCoords.col >= 0 && boardCoords.col < gameState.board[boardCoords.row].length) {
      handleDrop(draggedItem, { location: 'board', row: boardCoords.row, col: boardCoords.col } as any)
      return true
    }
    return false
  }

  // === CURSOR STACK (Token placement) ===
  if (cursorStack && cursorStack.isDragging) {
    // Validate the target
    const isValid = validateTarget(
      { location: 'board', row: boardCoords.row, col: boardCoords.col } as any,
      {
        ...(cursorStack.targetOwnerId !== undefined && { targetOwnerId: cursorStack.targetOwnerId }),
        ...(cursorStack.excludeOwnerId !== undefined && { excludeOwnerId: cursorStack.excludeOwnerId }),
        onlyOpponents: cursorStack.onlyOpponents,
        onlyFaceDown: cursorStack.onlyFaceDown,
        ...(cursorStack.targetType && { targetType: cursorStack.targetType }),
        ...(cursorStack.requiredTargetStatus && { requiredTargetStatus: cursorStack.requiredTargetStatus }),
        ...(cursorStack.requireStatusFromSourceOwner !== undefined && { requireStatusFromSourceOwner: cursorStack.requireStatusFromSourceOwner }),
        ...(cursorStack.mustBeAdjacentToSource && cursorStack.sourceCoords && { mustBeAdjacentTo: cursorStack.sourceCoords }),
        ...(cursorStack.mustBeInLineWithSource && cursorStack.sourceCoords && { mustBeInLineWith: cursorStack.sourceCoords }),
        ...(cursorStack.maxDistanceFromSource !== undefined && { maxDistance: cursorStack.maxDistanceFromSource }),
        ...(cursorStack.range && { range: cursorStack.range }),
      },
      localPlayerId ?? 0,
      gameState.players,
      cursorStack.originalOwnerId // CRITICAL: Pass token owner ID for command cards
    )

    if (isValid) {
      // Token is valid, but we need the card that owns this token
      // Check if there's a card at sourceCoords
      let sourceCard: Card | null = null
      if (cursorStack.sourceCoords) {
        const { row, col } = cursorStack.sourceCoords
        if (row >= 0 && row < gridSize && col >= 0 && col < gameState.board[row].length) {
          sourceCard = gameState.board[row][col].card
        }
      }

      if (sourceCard) {
        // Token belongs to a card - use the card's action
        // This is handled by the token stacking system
        // For now, just place the token
        handleActionExecution({
          type: 'GLOBAL_AUTO_APPLY',
          payload: {
            tokenType: cursorStack.type,
            count: cursorStack.count,
            targetOwnerId: cursorStack.targetOwnerId,
            onlyOpponents: cursorStack.onlyOpponents,
            onlyFaceDown: cursorStack.onlyFaceDown,
            ...(cursorStack.range && { range: cursorStack.range }),
            ...(cursorStack.requiredTargetStatus && { requiredTargetStatus: cursorStack.requiredTargetStatus }),
            cleanupCommand: true,
          },
          sourceCard,
          sourceCoords: cursorStack.sourceCoords,
        }, boardCoords)
        return true
      }
    }

    // Invalid target - do NOT clear cursor stack, tokens should remain
    return false
  }

  // === ABILITY MODE - SPAWN_TOKEN ===
  if (abilityMode && abilityMode.mode === 'SPAWN_TOKEN') {
    const { sourceCoords, payload, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    if (!sourceCoords || !payload?.tokenId) {
      return false
    }

    const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
    if (!isAdj) {
      return false
    }

    const tokenOwnerId = sourceCard?.ownerId ?? abilityMode.sourceCard?.ownerId
    spawnToken(boardCoords, payload.tokenId, tokenOwnerId!)
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
    // This prevents useEffect in App.tsx from re-setting targeting mode
    setAbilityMode(null)
    clearTargetingMode()
    return true
  }

  // === ABILITY MODE - PLACE_TOKEN ===
  if (abilityMode && abilityMode.mode === 'PLACE_TOKEN') {
    const { sourceCoords, payload, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    if (!sourceCoords || !payload?.tokenId) {
      return false
    }

    const range = payload.range || 'global'

    // Check if placement is valid based on range
    if (range === 'adjacent') {
      const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
      if (!isAdj) {
        return false
      }
    }

    const tokenOwnerId = sourceCard?.ownerId ?? abilityMode.sourceCard?.ownerId
    spawnToken(boardCoords, payload.tokenId, tokenOwnerId!)
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
    // This prevents useEffect in App.tsx from re-setting targeting mode
    setAbilityMode(null)
    clearTargetingMode()
    return true
  }

  // === ABILITY MODE - SHIELD_SELF_THEN_SPAWN (Edith Byron Deploy) ===
  if (abilityMode && abilityMode.mode === 'SHIELD_SELF_THEN_SPAWN') {
    const { sourceCoords, payload, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    if (!sourceCoords || !payload?.tokenId) {
      return false
    }

    // Check if the selected cell is adjacent to source
    const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
    if (!isAdj) {
      return false
    }

    const tokenOwnerId = sourceCard?.ownerId ?? abilityMode.sourceCard?.ownerId
    spawnToken(boardCoords, payload.tokenId, tokenOwnerId!)
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
    // This prevents useEffect in App.tsx from re-setting targeting mode
    setAbilityMode(null)
    clearTargetingMode()
    return true
  }

  // === ABILITY MODE - SELECT_CELL ===
  if (abilityMode && abilityMode.mode === 'SELECT_CELL') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload, chainedAction } = abilityMode

    // Find current card coordinates
    const currentCardCoords = (() => {
      if (sourceCoords && sourceCoords.row >= 0) {
        return sourceCoords
      }
      if (!sourceCard) {
        return null
      }
      for (let r = 0; r < gameState.board.length; r++) {
        for (let c = 0; c < gameState.board.length; c++) {
          if (gameState.board[r][c].card?.id === sourceCard.id) {
            return { row: r, col: c }
          }
        }
      }
      return null
    })()

    if (!currentCardCoords || !sourceCard) {
      return false
    }

    let isValidMove = false

    // Check range constraints
    if (payload?.range === 'line') {
      isValidMove = (boardCoords.row === currentCardCoords.row || boardCoords.col === currentCardCoords.col)
    } else if (payload?.range === 'global') {
      isValidMove = true
    } else if (payload?.range === 2) {
      const dist = Math.abs(boardCoords.row - currentCardCoords.row) + Math.abs(boardCoords.col - currentCardCoords.col)
      if (dist === 1) {
        isValidMove = true
      } else if (dist === 2) {
        const r1 = currentCardCoords.row, c1 = currentCardCoords.col
        const r2 = boardCoords.row, c2 = boardCoords.col
        const inters = [
          { r: r2, c: c1 },
          { r: r1, c: c2 },
          { r: (r1 + r2) / 2, c: (c1 + c2) / 2 },
        ]
        isValidMove = inters.some(i => {
          if (!Number.isInteger(i.r) || !Number.isInteger(i.c)) {
            return false
          }
          const offset = Math.floor((gameState.board.length - gameState.activeGridSize) / 2)
          const minBound = offset
          const maxBound = offset + gameState.activeGridSize - 1
          if (i.r < minBound || i.r > maxBound || i.c < minBound || i.c > maxBound) {
            return false
          }
          if (Math.abs(i.r - r1) + Math.abs(i.c - c1) !== 1) {
            return false
          }
          return !gameState.board[i.r][i.c].card
        })
      }
    } else if (payload?.filter) {
      // Use filter function
      isValidMove = payload.filter(null, boardCoords.row, boardCoords.col)
    } else {
      // Default: adjacent only
      isValidMove = Math.abs(boardCoords.row - currentCardCoords.row) + Math.abs(boardCoords.col - currentCardCoords.col) === 1
    }

    if (!isValidMove) {
      return false
    }

    // Handle moveFromHand case
    if (payload?.moveFromHand && commandContext.selectedHandCard) {
      const { playerId, cardIndex } = commandContext.selectedHandCard
      const player = gameState.players.find((p: any) => p.id === playerId)
      const handCard = player?.hand[cardIndex]

      if (handCard) {
        moveItem({ card: handCard, source: 'hand', playerId, cardIndex, isManual: true }, { target: 'board', boardCoords })
        markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return true
      }
    }

    // Check if allowSelf and clicking on same position
    const isSelfMove = payload?.allowSelf && boardCoords.row === currentCardCoords.row && boardCoords.col === currentCardCoords.col

    // CRITICAL: Capture the moved card BEFORE calling moveItem
    // This is needed for False Orders Option 1 to place tokens on the moved card
    const movedCard = gameState.board[currentCardCoords.row][currentCardCoords.col].card

    if (!isSelfMove) {
      if (movedCard) {
        moveItem({ card: movedCard, source: 'board', boardCoords: currentCardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords })
      }
    }

    if (payload?.recordContext) {
      setCommandContext({ lastMovedCardCoords: boardCoords, lastMovedCardId: sourceCard.id })
    }

    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)

    // CRITICAL: Check for AUTO_STEPS context FIRST, before handling chainedAction directly
    // This fixes False Orders Option 1 where chainedAction (CREATE_STACK for Revealed tokens)
    // should be executed as part of the next step (GLOBAL_AUTO_APPLY), not directly
    if (payload?._autoStepsContext && setActionQueue) {
      const autoStepsContext = { ...payload._autoStepsContext }
      const continueAction: any = {
        type: 'CONTINUE_AUTO_STEPS',
        sourceCard: abilityMode.sourceCard,
        sourceCoords: boardCoords, // Use new coords as source
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: abilityMode.readyStatusToRemove,
        payload: {
          _autoStepsContext: autoStepsContext,
          // CRITICAL: Pass stepContext with sourceOwnerId for False Orders Option 1
          // This ensures the next step (GLOBAL_AUTO_APPLY with chainedAction) knows which player's hand to target
          stepContext: {
            targetCoords: boardCoords,
            targetCard: movedCard,
            // CRITICAL: Pass sourceOwnerId so chainedAction can resolve targetOwnerId: -2 correctly
            sourceOwnerId: movedCard?.ownerId ?? sourceCard?.ownerId,
          },
          // CRITICAL: Pass chainedAction so advanceToNextStepWithCoords can execute it
          // This fixes False Orders Option 2 where Stun x2 needs to be placed after move
          ...(chainedAction ? { chainedAction } : {})
        }
      }

      console.log('[handleEmptyCellClick] SELECT_CELL: Continuing AUTO_STEPS (with chainedAction), stepIndex:', autoStepsContext.currentStepIndex, {
        hasChainedAction: !!chainedAction,
        chainedActionType: chainedAction?.type,
        sourceOwnerId: movedCard?.ownerId ?? sourceCard?.ownerId,
      })

      setActionQueue(prev => {
        const cleanupActions = prev.filter(a => a.payload?.cleanupCommand)
        const otherActions = prev.filter(a => !a.payload?.cleanupCommand)
        return [...otherActions, continueAction, ...cleanupActions]
      })

      // CRITICAL: Clear targeting mode AND ability mode immediately (not via setTimeout)
      clearTargetingMode()
      setAbilityMode(null)
      return
    }

    // Only execute chainedAction directly if NOT in AUTO_STEPS context
    // This handles single-step abilities with chainedAction (not multi-step commands)
    if (chainedAction) {
      const nextAction = { ...chainedAction }
      // CRITICAL: Ensure payload exists for targetOwnerId check
      if (!nextAction.payload) {
        nextAction.payload = {}
      }
      // CRITICAL: Handle targetOwnerId === -2 (TARGET_MOVED_OWNER) for False Orders Option 1
      // This restricts Revealed tokens to only the player whose card was moved
      // NOTE: After normalizeChainedAction, targetOwnerId is in payload, not at action level
      if (nextAction.payload.targetOwnerId === -2) {
        // Use movedCard.ownerId (the opponent whose card we moved), not sourceCard (command card)
        if (movedCard) {
          nextAction.payload.targetOwnerId = movedCard.ownerId
          // CRITICAL: Also set _sourceOwnerId to the moved card's owner
          // This is used in actionExecutionHandler to determine which player's hand to target
          // This fixes the bug where False Orders Option 1 targets the wrong player's hand on repeated uses
          nextAction.payload._sourceOwnerId = movedCard.ownerId
        } else {
          // Fallback: if movedCard not available, try to find from context
          console.warn('[emptyCellHandlers] TARGET_MOVED_OWNER (-2) used but movedCard not available')
          nextAction.payload.targetOwnerId = sourceCard.ownerId
          nextAction.payload._sourceOwnerId = sourceCard.ownerId
        }
      }
      // CRITICAL: Set sourceCard for the chained action (False Orders command card)
      // This ensures tokens are owned by the player who played the command card
      // CRITICAL: Use _commandCard from payload if available (preserved command card), otherwise fall back to abilityMode.sourceCard
      // For False Orders: _commandCard is the False Orders card owned by Player A, abilityMode.sourceCard is the unit with Exploit (Player B's card)
      const commandCard = payload?._commandCard
      if (!nextAction.sourceCard) {
        nextAction.sourceCard = commandCard || abilityMode.sourceCard || sourceCard
      }
      // CRITICAL: Set originalOwnerId for chained action to ensure correct highlight color
      // This fixes False Orders Option 1 where highlight should use command card owner's color (Player A), not target player's color (Player B)
      if (!nextAction.originalOwnerId && commandCard) {
        nextAction.originalOwnerId = commandCard.ownerId
      }
      // Set context identifiers for token placement (False Orders Stun x2)
      if (payload.recordContext) {
        nextAction.payload._tempContextId = sourceCard.id
      }
      // CRITICAL: Set contextCardId for token placement after card move
      // This is needed for abilities like False Orders Option 1 that place tokens on the moved card
      // IMPORTANT: Use the movedCard captured above (from the board), NOT sourceCard (which is the command card)
      if (!nextAction.payload.contextCardId) {
        if (movedCard) {
          nextAction.payload.contextCardId = movedCard.id
        }
      }
      // Set sourceCoords for the chained action
      nextAction.sourceCoords = boardCoords

      // CRITICAL: Clear targeting mode BEFORE setting abilityMode to null
      // This prevents targeting mode from being re-set after chained action
      clearTargetingMode()
      setAbilityMode(null)

      // CRITICAL: Add chainedAction to actionQueue, ensuring cleanupCommand stays at the end
      if (setActionQueue) {
        setActionQueue(prev => {
          const cleanupActions = prev.filter(a => a.payload?.cleanupCommand)
          const otherActions = prev.filter(a => !a.payload?.cleanupCommand)
          return [...otherActions, nextAction, ...cleanupActions]
        })
      }
    } else {
      // No chainedAction and no AUTO_STEPS - just clear modes
      clearTargetingMode()
      setAbilityMode(null)
    }

    return true
  }

  // === ABILITY MODE - PATROL_MOVE ===
  if (abilityMode && abilityMode.mode === 'PATROL_MOVE') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    if (!sourceCoords || !sourceCard) {return false}

    // Same cell = cancel
    if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
      clearTargetingMode() // Clear highlighting immediately
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    // Check if in same row or column
    const sameRow = boardCoords.row === sourceCoords.row
    const sameCol = boardCoords.col === sourceCoords.col

    if (!sameRow && !sameCol) {return false}

    // Check if cell is empty
    if (gameState.board[boardCoords.row][boardCoords.col].card !== null) {return false}

    clearTargetingMode() // Clear highlighting immediately
    moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
    markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // === ABILITY MODE - PUSH_MOVE ===
  if (abilityMode && abilityMode.mode === 'PUSH_MOVE') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

    if (!sourceCoords || !sourceCard || !payload?.vacatedCoords) {return false}

    // Option 1: Stay in place (click on sourceCoords)
    if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
      clearTargetingMode()
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    // Option 2: Move to vacated cell (where the pushed card was)
    if (boardCoords.row === payload.vacatedCoords.row && boardCoords.col === payload.vacatedCoords.col) {
      clearTargetingMode()
      moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
      markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    // Option 3: Move to intermediate cells (between source and vacated)
    // Check if source, vacated, and clicked are in a line (row or column)
    const sameRow = sourceCoords.row === payload.vacatedCoords.row && payload.vacatedCoords.row === boardCoords.row
    const sameCol = sourceCoords.col === payload.vacatedCoords.col && payload.vacatedCoords.col === boardCoords.col

    if (sameRow || sameCol) {
      // Check if clicked cell is between source and vacated (inclusive, but we already handled exact positions above)
      if (sameRow) {
        const minCol = Math.min(sourceCoords.col, payload.vacatedCoords.col)
        const maxCol = Math.max(sourceCoords.col, payload.vacatedCoords.col)
        if (boardCoords.col > minCol && boardCoords.col < maxCol) {
          // Intermediate cell in the same row
          clearTargetingMode()
          moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
          markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
          setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
          return true
        }
      } else if (sameCol) {
        const minRow = Math.min(sourceCoords.row, payload.vacatedCoords.row)
        const maxRow = Math.max(sourceCoords.row, payload.vacatedCoords.row)
        if (boardCoords.row > minRow && boardCoords.row < maxRow) {
          // Intermediate cell in the same column
          clearTargetingMode()
          moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
          markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
          setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
          return true
        }
      }
    }

    // If clicked elsewhere, cancel
    clearTargetingMode()
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setAbilityMode(null)
    return true
  }

  // === ABILITY MODE - IMMUNIS_RETRIEVE ===
  if (abilityMode && abilityMode.mode === 'IMMUNIS_RETRIEVE') {
    const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode

    if (!sourceCoords) {return false}

    const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
    if (!isAdj) {return false}

    if (payload?.selectedCardIndex !== undefined) {
      const ownerId = sourceCard?.ownerId || 0
      resurrectDiscardedCard(ownerId, payload.selectedCardIndex, boardCoords)
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    return false
  }

  // === ABILITY MODE - SELECT_LINE_FOR_SUPPORT_COUNTERS ===
  if (abilityMode && abilityMode.mode === 'SELECT_LINE_FOR_SUPPORT_COUNTERS') {
    const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode

    if (!sourceCoords) {return false}

    const ownerId = sourceCard?.ownerId ?? 0
    const { row: sourceRow, col: sourceCol } = sourceCoords
    const { row: clickRow, col: clickCol } = boardCoords

    // Check if clicked cell is in same row or column as source
    const sameRow = clickRow === sourceRow
    const sameCol = clickCol === sourceCol

    if (!sameRow && !sameCol) {
      // Clicked outside valid lines - cancel ability
      clearTargetingMode()
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      setAbilityMode(null)
      return true
    }

    // Find all ally cards in the selected line, then check which have Support
    const targets: { row: number; col: number }[] = []
    const gridSize = gameState.board.length

    if (sameRow) {
      // Horizontal line selected - find all ally cards, then check for Support
      for (let c = 0; c < gridSize; c++) {
        const cell = gameState.board[clickRow][c]
        if (cell.card?.ownerId === ownerId) {
          // Card belongs to same player - check if it has Support from any player
          const hasSupport = cell.card.statuses?.some((s: any) => s.type === 'Support')
          if (hasSupport) {
            targets.push({ row: clickRow, col: c })
          }
        }
      }
    } else {
      // Vertical line selected - find all ally cards, then check for Support
      for (let r = 0; r < gridSize; r++) {
        const cell = gameState.board[r][clickCol]
        if (cell.card?.ownerId === ownerId) {
          // Card belongs to same player - check if it has Support from any player
          const hasSupport = cell.card.statuses?.some((s: any) => s.type === 'Support')
          if (hasSupport) {
            targets.push({ row: r, col: clickCol })
          }
        }
      }
    }

    // Apply Exploit counter to all targets using addBoardCardStatus
    const counterType = payload?.tokenType || 'Exploit'

    for (const target of targets) {
      addBoardCardStatus(target, counterType, ownerId)
    }

    clearTargetingMode()
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // === ABILITY MODE - SELECT_LINE_FOR_THREAT_COUNTERS ===
  if (abilityMode && abilityMode.mode === 'SELECT_LINE_FOR_THREAT_COUNTERS') {
    const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode

    if (!sourceCoords) {return false}

    const ownerId = sourceCard?.ownerId ?? 0
    const { row: sourceRow, col: sourceCol } = sourceCoords
    const { row: clickRow, col: clickCol } = boardCoords

    // Check if clicked cell is in same row or column as source
    const sameRow = clickRow === sourceRow
    const sameCol = clickCol === sourceCol

    if (!sameRow && !sameCol) {
      // Clicked outside valid lines - cancel ability
      clearTargetingMode()
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      setAbilityMode(null)
      return true
    }

    // Find all opponent cards in the selected line, then check which have Threat from owner
    const targets: { row: number; col: number }[] = []
    const gridSize = gameState.board.length

    if (sameRow) {
      // Horizontal line selected - find all opponent cards, then check for Threat from owner
      for (let c = 0; c < gridSize; c++) {
        const cell = gameState.board[clickRow][c]
        // Card belongs to opponent (not same player)
        if (cell.card && cell.card.ownerId !== ownerId) {
          // Check if it has Threat from the ability owner
          const hasThreatFromOwner = cell.card.statuses?.some((s: any) =>
            s.type === 'Threat' && s.addedByPlayerId === ownerId
          )
          if (hasThreatFromOwner) {
            targets.push({ row: clickRow, col: c })
          }
        }
      }
    } else {
      // Vertical line selected - find all opponent cards, then check for Threat from owner
      for (let r = 0; r < gridSize; r++) {
        const cell = gameState.board[r][clickCol]
        // Card belongs to opponent (not same player)
        if (cell.card && cell.card.ownerId !== ownerId) {
          // Check if it has Threat from the ability owner
          const hasThreatFromOwner = cell.card.statuses?.some((s: any) =>
            s.type === 'Threat' && s.addedByPlayerId === ownerId
          )
          if (hasThreatFromOwner) {
            targets.push({ row: r, col: clickCol })
          }
        }
      }
    }

    // Apply Exploit counter to all targets using addBoardCardStatus
    const counterType = payload?.tokenType || 'Exploit'

    for (const target of targets) {
      addBoardCardStatus(target, counterType, ownerId)
    }

    clearTargetingMode()
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // === ABILITY MODE - RESURRECT_FROM_DISCARD ===
  if (abilityMode && abilityMode.mode === 'RESURRECT_FROM_DISCARD') {
    const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode

    if (!sourceCoords) {return false}

    const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
    if (!isAdj) {return false}

    if (payload?.selectedCardIndex !== undefined) {
      const ownerId = sourceCard?.ownerId || 0
      // Resurrect the card to the selected cell
      resurrectDiscardedCard(ownerId, payload.selectedCardIndex, boardCoords)

      // Add the specified token (e.g., Resurrection)
      const tokenType = payload?.withToken || 'Resurrection'
      spawnToken(boardCoords, tokenType, ownerId)

      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    return false
  }

  // === ABILITY MODE - MOVE_SELF_ANY_EMPTY ===
  if (abilityMode && abilityMode.mode === 'MOVE_SELF_ANY_EMPTY') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode



    if (!sourceCoords || !sourceCard) {return false}

    // Check if cell is empty
    if (gameState.board[boardCoords.row][boardCoords.col].card !== null) {return false}



    // Move the card to the selected empty cell
    moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
    markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
    // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
    // This prevents useEffect in App.tsx from re-setting targeting mode
    setAbilityMode(null)
    clearTargetingMode()
    return true
  }

  // === ABILITY MODE - IP_AGENT_THREAT_SCORING ===
  if (abilityMode && abilityMode.mode === 'IP_AGENT_THREAT_SCORING') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    if (!sourceCoords) {return false}

    const sameRow = boardCoords.row === sourceCoords.row
    const sameCol = boardCoords.col === sourceCoords.col

    if (!sameRow && !sameCol) {return false}

    const ownerId = sourceCard?.ownerId || 0
    let threatCount = 0

    if (sameRow) {
      for (let c = 0; c < gridSize; c++) {
        const card = gameState.board[boardCoords.row][c].card
        if (card?.statuses) {
          threatCount += card.statuses.filter((s: any) => s.type === 'Threat' && s.addedByPlayerId === ownerId).length
        }
      }
    } else {
      for (let r = 0; r < gridSize; r++) {
        const card = gameState.board[r][boardCoords.col].card
        if (card?.statuses) {
          threatCount += card.statuses.filter((s: any) => s.type === 'Threat' && s.addedByPlayerId === ownerId).length
        }
      }
    }

    const points = threatCount * 2
    if (points > 0) {
      updatePlayerScore(ownerId, points)
      triggerFloatingText({
        row: sourceCoords.row,
        col: sourceCoords.col,
        text: `+${points}`,
        playerId: ownerId,
      })
    }

    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // === ABILITY MODE - ZIUS_LINE_SELECT ===
  if (abilityMode && abilityMode.mode === 'ZIUS_LINE_SELECT') {
    const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

    const contextCoords = commandContext.lastMovedCardCoords || sourceCoords
    if (!contextCoords) {return false}

    const sameRow = boardCoords.row === contextCoords.row
    const sameCol = boardCoords.col === contextCoords.col

    if (!sameRow && !sameCol) {return false}

    const ownerId = sourceCard?.ownerId || 0
    let exploitCount = 0

    if (sameRow) {
      for (let c = 0; c < gridSize; c++) {
        const card = gameState.board[boardCoords.row][c].card
        if (card?.statuses) {
          exploitCount += card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
        }
      }
    } else {
      for (let r = 0; r < gridSize; r++) {
        const card = gameState.board[r][boardCoords.col].card
        if (r === contextCoords.row) {continue}
        if (card?.statuses) {
          exploitCount += card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
        }
      }
    }

    if (exploitCount > 0) {
      updatePlayerScore(ownerId, exploitCount)

      // Show only ONE total floating text over Zius card (the card that performed the ability)
      const textCoords = sourceCoords || contextCoords
      triggerFloatingText({
        row: textCoords.row,
        col: textCoords.col,
        text: `+${exploitCount}`,
        playerId: ownerId,
      })
    }

    markAbilityUsed(sourceCoords || contextCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // === ABILITY MODE - LINE SELECTION MODES ===
  if (abilityMode?.mode && ['SCORE_LAST_PLAYED_LINE', 'SELECT_LINE_END', 'SELECT_LINE_START', 'SELECT_DIAGONAL', 'SELECT_LINE_FOR_EXPLOIT_SCORING', 'SELECT_LINE_FOR_SUPPORT_COUNTERS', 'SELECT_LINE_FOR_THREAT_COUNTERS'].includes(abilityMode.mode)) {
    // CRITICAL: Only the active player can click to select lines
    // EXCEPT: When active player is a dummy, any player can click (they're controlling the dummy)
    const activePlayer = gameState.players.find((p: { id: number }) => p.id === gameState.activePlayerId)
    const isDummyActivePlayer = activePlayer?.isDummy
    const canSelect = localPlayerId === gameState.activePlayerId || isDummyActivePlayer

    if (canSelect) {
      // CRITICAL: Create continueAutoSteps function for AUTO_STEPS continuation
      // This fixes Logistics Chain not discarding after diagonal selection
      const continueAutoSteps = (nextStepIndex: number) => {
        // Build ModeHandlersProps from available props
        const modeProps: Partial<ModeHandlersProps> = {
          gameState,
          getFreshGameState: getFreshGameState || (() => gameState),
          localPlayerId,
          abilityMode,
          setAbilityMode,
          markAbilityUsed,
          commandContext,
          setCommandContext,
          setTargetingMode: setTargetingMode || (() => {}),
          calculateValidTargets: calculateValidTargets || (() => []),
          handleActionExecution,
        }
        // Use abilityMode.sourceCoords as sourceCoords
        const sourceCoords = abilityMode.sourceCoords || { row: 0, col: 0 }
        advanceToNextStepWithCoords(modeProps as ModeHandlersProps, sourceCoords, nextStepIndex)
      }

      handleLineSelectionModule(boardCoords, {
        gameState,
        localPlayerId,
        abilityMode,
        interactionLock,
        setAbilityMode,
        markAbilityUsed,
        updatePlayerScore,
        triggerFloatingText,
        nextPhase: nextPhase || (() => {}),
        modifyBoardCardPower: modifyBoardPower || (() => {}),
        scoreLine: scoreLine || (() => {}),
        scoreDiagonal: scoreDiagonal || (() => {}),
        commandContext,
        isWebRTCMode: props.isWebRTCMode,
        continueAutoSteps,
      })
    } else {
      // Silently ignore clicks from non-active players

    }
    return true
  }

  // === PLAY MODE ===
  if (playMode?.card && playMode.sourceCoords) {
    // Drop the card from hand to board
    handleDrop({
      card: playMode.card,
      source: 'hand',
      playerId: playMode.playerId,
      cardIndex: playMode.cardIndex,
    }, { location: 'board', row: boardCoords.row, col: boardCoords.col } as any)
    return true
  }

  return false
}

/**
 * Handle right-click context menu on empty cell
 */
export function handleEmptyCellContextMenu(
  e: React.MouseEvent,
  boardCoords: { row: number; col: number },
  props: EmptyCellClickProps
): void {
  const { gameState, abilityMode, openContextMenu } = props

  // Don't show context menu if in targeting mode
  if (abilityMode) {
    return
  }

  // Check if there's a card at this location (shouldn't happen for empty cell, but just in case)
  const cell = gameState.board[boardCoords.row]?.[boardCoords.col]
  if (cell?.card) {
    // There's a card here - let the card's context menu handle it
    openContextMenu(e, 'boardItem', { card: cell.card, coords: boardCoords })
    return
  }

  // Empty cell context menu (could have future features)
  openContextMenu(e, 'emptyBoardCell', { coords: boardCoords })
}
