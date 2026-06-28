/**
 * Mode Handlers
 *
 * Handles all ability modes during targeting
 * Extracted from useAppAbilities.ts
 */

// @ts-ignore - Suppress unused variable warnings for destructured variables that may be used in future
import type { Card, AbilityAction, CommandContext, DragItem, CursorStackState, CounterSelectionData, GameState, FloatingTextData, DropTarget } from '@/types'
import { TIMING } from '@/utils/common'
import { createTokenCursorStack } from '@/utils/tokenTargeting'
import { handleLineSelection as handleLineSelectionModule } from './lineSelectionHandlers.js'
import { buildDetailsFromContent, buildFilterFromString } from '@shared/abilities/contentAbilities.js'
import { flushSync } from 'react-dom'

/**
 * CRITICAL: Convert chainedAction from JSON format (action/details) to AbilityAction format (type/payload)
 * In contentDatabase.json, chainedAction has: {action: "GLOBAL_AUTO_APPLY", details: {contextReward: "..."}}
 * But AbilityAction expects: {type: "GLOBAL_AUTO_APPLY", payload: {contextReward: "..."}}
 */
function normalizeChainedAction(chainedAction: any): any {
  if (!chainedAction) return undefined
  if (chainedAction.action && !chainedAction.type) {
    return {
      type: chainedAction.action,
      payload: chainedAction.details || {}
    }
  }
  return chainedAction
}

// Track cards that are transitioning from AUTO_STEPS to actual mode
// Prevents infinite re-processing due to asynchronous React state updates
const transitioningCards = new Set<string>()

/**
 * Clear a card from transitioning set (call after state updates)
 */
function clearTransitioning(cardId: string, delay: number = 50) {
  setTimeout(() => {
    transitioningCards.delete(cardId)
  }, delay)
}

/**
 * Step definition from contentDatabase.json AUTO_STEPS abilities
 */
export interface AutoStep {
  action: string
  mode: string | null
  details: Record<string, any>
}

/**
 * Result of executing an instant step
 */
export interface InstantStepResult {
  success: boolean
  shouldAdvance: boolean
  message?: string
  needsExecution?: boolean  // If true, the step needs to be executed via handleActionExecution
}

/**
 * Minimal props required for instant step execution
 * Shared between actionExecutionHandler and modeHandlers
 */
export interface InstantStepProps {
  gameState: GameState
  localPlayerId: number | null
  commandContext: CommandContext
  addBoardCardStatus: (coords: {row: number, col: number}, status: string, pid: number, count?: number) => void
  modifyBoardCardPower: (coords: {row: number, col: number}, delta: number) => void
}

/**
 * Execute an instant AUTO_STEPS action (mode: null)
 * This is the universal handler for all instant step types.
 *
 * @param step - The step to execute
 * @param sourceCoords - Coordinates of the source card
 * @param ownerId - Owner ID of the source card
 * @param props - Props needed for execution
 * @returns Result indicating success and whether to advance to next step
 */
export function executeInstantAutoStep(
  step: AutoStep,
  sourceCoords: { row: number; col: number } | undefined,
  ownerId: number,
  props: InstantStepProps,
  stepContext?: { lastMovedCardCoords?: { row: number; col: number }; sourceOwnerId?: number; lastMovedCardId?: string }
): InstantStepResult {
  const { gameState, commandContext, addBoardCardStatus, modifyBoardCardPower } = props

  // Use stepContext if provided (from AUTO_STEPS), otherwise fall back to commandContext
  const context = stepContext || commandContext

  switch (step.action) {
    case 'CREATE_STACK_SELF': {
      // Add token to self
      const tokenType = step.details?.tokenType
      const count = step.details?.count || 1
      if (!tokenType) {
        return { success: false, shouldAdvance: true }
      }
      if (!sourceCoords) {
        return { success: false, shouldAdvance: true }
      }
      for (let i = 0; i < count; i++) {
        addBoardCardStatus(sourceCoords, tokenType, ownerId)
      }
      return { success: true, shouldAdvance: true }
    }

    case 'BUFF_LINES_FROM_CONTEXT': {
      // Buff all allies in Centurion's lines (vertical and horizontal intersection)
      // Centurion Commit: Sacrifice an allied unit ⇒ All allied cards in Centurion's lines get +1 power
      const amount = step.details?.amount || 1

      // Use sourceCoords (Centurion's position), NOT lastMovedCardCoords (sacrificed card)
      if (!sourceCoords) {
        return { success: false, shouldAdvance: true }
      }

      // Use sourceOwnerId (Centurion's owner) - this determines whose allies get buffed
      const buffOwnerId = context?.sourceOwnerId ?? ownerId
      const gridSize = gameState.board.length
      const { row: r1, col: c1 } = sourceCoords

      // Buff all cards in the same row (horizontal line through Centurion)
      for (let c = 0; c < gridSize; c++) {
        const cell = gameState.board[r1]?.[c]
        const targetCard = cell?.card
        if (targetCard && targetCard.ownerId === buffOwnerId) {
          modifyBoardCardPower({ row: r1, col: c }, amount)
        }
      }

      // Buff all cards in the same column (vertical line through Centurion, excluding intersection)
      for (let r = 0; r < gridSize; r++) {
        if (r === r1) { continue } // Skip intersection (already processed in row loop)
        const cell = gameState.board[r]?.[c1]
        const targetCard = cell?.card
        if (targetCard && targetCard.ownerId === buffOwnerId) {
          modifyBoardCardPower({ row: r, col: c1 }, amount)
        }
      }

      return { success: true, shouldAdvance: true }
    }

    case 'GLOBAL_AUTO_APPLY': {
      // Handle instant GLOBAL_AUTO_APPLY actions (e.g., CLEANUP_COMMAND, draw cards)
      const customAction = step.details?.customAction
      const dynamicResource = step.details?.dynamicResource
      // CRITICAL: All GLOBAL_AUTO_APPLY actions need execution through handleActionExecution
      // This includes CLEANUP_COMMAND and dynamicResource actions (e.g., draw cards)
      // executeInstantAutoStep doesn't have access to drawCards, updatePlayerScore, etc.
      return { success: true, shouldAdvance: true, needsExecution: true }
    }

    default:
      // Unknown actions still advance to avoid getting stuck
      return { success: false, shouldAdvance: true, message: 'Unknown action: ' + step.action }
  }
}

/**
 * Minimal props for AUTO_STEPS continuation (used by CONTINUE_AUTO_STEPS action)
 * Only includes the props actually used by advanceToNextStepWithCoords
 */
export interface ContinueAutoStepsProps {
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  gameState: GameState
  commandContext: CommandContext
  setTargetingMode: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: CommandContext, preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]) => void
  calculateValidTargets?: (action: AbilityAction, gameState: GameState, ownerId: number, commandContext?: CommandContext) => {row: number, col: number}[]
  localPlayerId: number | null
  addBoardCardStatus: (coords: {row: number, col: number}, status: string, pid: number, count?: number) => void
  modifyBoardCardPower: (coords: {row: number, col: number}, delta: number) => void
}

export interface ModeHandlersProps {
  gameState: GameState
  getFreshGameState: () => GameState // Функция для получения свежего состояния
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  cursorStack: CursorStackState | null
  setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>
  commandContext: CommandContext
  setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>
  playMode: { card: Card; sourceItem: DragItem; faceDown?: boolean } | null
  setPlayMode: React.Dispatch<React.SetStateAction<{ card: Card; sourceItem: DragItem; faceDown?: boolean } | null>>
  draggedItem: DragItem | null
  setDraggedItem: React.Dispatch<React.SetStateAction<DragItem | null>>
  openContextMenu: (e: React.MouseEvent, type: string, data: unknown) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  triggerNoTarget: (coords: { row: number; col: number }) => void
  triggerClickWave: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number; cardIndex: number }, effectOwnerId?: number) => void
  triggerDeckSelection: (playerId: number, selectedByPlayerId: number) => void
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  interactionLock: React.MutableRefObject<boolean>
  moveItem: (item: DragItem, target: DropTarget) => void
  swapCards: (coords1: {row: number, col: number}, coords2: {row: number, col: number}) => void
  transferStatus: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}, statusType: string) => void
  transferAllCounters: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  transferAllStatusesWithoutException: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  destroyCard: (card: Card, boardCoords: { row: number; col: number }) => void
  spawnToken: (coords: {row: number, col: number}, name: string, ownerId: number) => void
  modifyBoardCardPower: (coords: {row: number; col: number}, delta: number) => void
  addBoardCardStatus: (coords: {row: number; col: number}, status: string, pid: number, count?: number) => void
  removeBoardCardStatus: (coords: {row: number; col: number }, status: string) => void
  removeBoardCardStatusByOwner: (coords: {row: number; col: number}, status: string, pid: number) => void
  removeStatusByType: (coords: {row: number; col: number}, type: string) => void
  resetDeployStatus: (coords: {row: number; col: number }) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void
  setCounterSelectionData: React.Dispatch<React.SetStateAction<CounterSelectionData | null>>
  setViewingDiscard: React.Dispatch<React.SetStateAction<boolean>>
  clearValidTargets: () => void
  validTargets?: {row: number, col: number}[]
  handleLineSelection: (coords: {row: number; col: number }) => void
  setTargetingMode: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: CommandContext, preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]) => void
  clearTargetingMode: () => void
  calculateValidTargets?: (action: AbilityAction, gameState: GameState, ownerId: number, commandContext?: CommandContext) => {row: number, col: number}[]
  updateState?: (stateOrFn: any) => void
  nextPhase?: (forceTurnPass?: boolean) => void
  scoreLine?: (r1: number, c1: number, r2: number, c2: number, pid: number) => void
  scoreDiagonal?: (r1: number, c1: number, r2: number, c2: number, pid: number, bonusType?: 'point_per_support' | 'draw_per_support') => void
  isWebRTCMode?: boolean
  setActionQueue?: React.Dispatch<React.SetStateAction<AbilityAction[]>>
}

/**
 * Handle click on board card during ability mode
 * Returns true if handled, false otherwise
 */
export function handleModeCardClick(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const {
    gameState,
    localPlayerId: _localPlayerId,
    abilityMode,
    cursorStack,
    interactionLock,
    handleLineSelection: _handleLineSelection,
  } = props

  if (!abilityMode || abilityMode.type !== 'ENTER_MODE') {
    return false
  }

  if (interactionLock.current) {
    return false
  }

  // CRITICAL: If cursorStack is active, do NOT process abilityMode handlers
  // The cursorStack handler in handleBoardCardClick already validated if this card is a valid target
  // If we're here, it means the card is NOT a valid target for the token, so ignore the click
  // This prevents REVEAL_ENEMY_CHAINED from being re-triggered when clicking invalid board cards
  if (cursorStack) {
    return false
  }

  // Prevent clicking self unless specific modes allow it
  if (abilityMode.sourceCard && abilityMode.sourceCard.id === card.id &&
      abilityMode.mode !== 'SELECT_LINE_START' &&
      abilityMode.mode !== 'ZIUS_LINE_SELECT' &&
      abilityMode.mode !== 'IP_AGENT_THREAT_SCORING' &&
      abilityMode.mode !== 'SELECT_LINE_FOR_EXPLOIT_SCORING' &&
      abilityMode.mode !== 'SELECT_UNIT_FOR_MOVE' &&
      abilityMode.mode !== 'SELECT_TARGET' &&
      abilityMode.mode !== 'PUSH' &&
      abilityMode.mode !== 'PUSH_MOVE' &&
      abilityMode.mode !== 'REVEREND_DOUBLE_EXPLOIT' &&
      abilityMode.mode !== 'SHIELD_SELF_THEN_PUSH' &&
      abilityMode.mode !== 'SELECT_LINE_FOR_SUPPORT_COUNTERS' &&
      abilityMode.mode !== 'SELECT_LINE_FOR_THREAT_COUNTERS' &&
      abilityMode.mode !== 'SELECT_DIAGONAL'  // Allow clicking any card for diagonal selection
  ) {
    return false
  }

  const { mode, payload, sourceCard: _sourceCard } = abilityMode

  // Line selection modes
  if (mode === 'SELECT_LINE_START' || mode === 'SELECT_LINE_END') {
    const {
      gameState,
      localPlayerId,
      abilityMode,
      interactionLock,
      setAbilityMode,
      markAbilityUsed,
      updatePlayerScore,
      triggerFloatingText,
      nextPhase,
      modifyBoardCardPower,
      scoreLine,
      scoreDiagonal,
      commandContext,
      isWebRTCMode,
    } = props

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
      modifyBoardCardPower: modifyBoardCardPower || (() => {}),
      scoreLine: scoreLine || (() => {}),
      scoreDiagonal: scoreDiagonal || (() => {}),
      commandContext,
      isWebRTCMode,
    })
    return true
  }

  // SELECT_TARGET with tokenType (CREATE_STACK)
  if (mode === 'SELECT_TARGET' && payload.tokenType) {
    return handleSelectTargetWithToken(card, boardCoords, props)
  }

  // Other SELECT_TARGET actionTypes
  if (mode === 'SELECT_TARGET') {
    return handleSelectTargetActionType(card, boardCoords, props)
  }

  // PUSH
  if (mode === 'PUSH') {
    return handlePush(card, boardCoords, props)
  }

  // SHIELD_SELF_THEN_PUSH (Reclaimed Gawain Deploy)
  if (mode === 'SHIELD_SELF_THEN_PUSH') {
    return handleShieldSelfThenPush(card, boardCoords, props)
  }

  // PUSH_MOVE
  if (mode === 'PUSH_MOVE') {
    return handlePushMove(card, boardCoords, props)
  }

  // SWAP_POSITIONS
  if (mode === 'SWAP_POSITIONS') {
    return handleSwapPositions(card, boardCoords, props)
  }

  // SWAP_ADJACENT (Swap with adjacent card)
  if (mode === 'SWAP_ADJACENT') {
    return handleSwapAdjacent(card, boardCoords, props)
  }

  // TRANSFER_STATUS_SELECT and TRANSFER_ALL_STATUSES (Reckless Provocateur Commit)
  if (mode === 'TRANSFER_STATUS_SELECT' || mode === 'TRANSFER_ALL_STATUSES') {
    return handleTransferStatus(card, boardCoords, props)
  }

  // ZEALOUS_WEAKEN
  if (mode === 'ZEALOUS_WEAKEN') {
    return handleZealousWeaken(card, boardCoords, props)
  }

  // REVEREND_DOUBLE_EXPLOIT
  if (mode === 'REVEREND_DOUBLE_EXPLOIT') {
    return handleReverendDoubleExploit(card, boardCoords, props)
  }

  // SELECT_UNIT_FOR_MOVE
  if (mode === 'SELECT_UNIT_FOR_MOVE') {
    return handleSelectUnitForMove(card, boardCoords, props)
  }

  // PATROL_MOVE
  if (mode === 'PATROL_MOVE') {
    return handlePatrolMove(card, boardCoords, props)
  }

  // SPAWN_TOKEN
  if (mode === 'SPAWN_TOKEN') {
    return handleSpawnToken(card, boardCoords, props)
  }

  // PLACE_TOKEN
  if (mode === 'PLACE_TOKEN') {
    return handlePlaceToken(card, boardCoords, props)
  }

  // REVEAL_ENEMY
  if (mode === 'REVEAL_ENEMY') {
    return handleRevealEnemy(card, boardCoords, props)
  }

  // SELECT_CELL
  if (mode === 'SELECT_CELL') {
    return handleSelectCell(card, boardCoords, props)
  }

  // IMMUNIS_RETRIEVE
  if (mode === 'IMMUNIS_RETRIEVE') {
    return handleImmunisRetrieve(card, boardCoords, props)
  }

  // IP_AGENT_THREAT_SCORING
  if (mode === 'IP_AGENT_THREAT_SCORING') {
    return handleIpAgentThreatScoring(card, boardCoords, props)
  }

  // SELECT_LINE_FOR_EXPLOIT_SCORING
  if (mode === 'SELECT_LINE_FOR_EXPLOIT_SCORING') {
    return handleSelectLineForExploitScoring(card, boardCoords, props)
  }

  // ZIUS_LINE_SELECT
  if (mode === 'ZIUS_LINE_SELECT') {
    return handleZiusLineSelect(card, boardCoords, props)
  }

  // SELECT_DIAGONAL
  if (mode === 'SELECT_DIAGONAL') {
    return handleSelectDiagonal(card, boardCoords, props)
  }

  // SCORE_LAST_PLAYED_LINE
  if (mode === 'SCORE_LAST_PLAYED_LINE') {
    return handleScoreLastPlayedLine(card, boardCoords, props)
  }

  // SEARCH_DECK
  if (mode === 'SEARCH_DECK') {
    return handleSearchDeck(card, boardCoords, props)
  }

  // LINES_WITH_THREAT (Signal Prophet)
  if (mode === 'LINES_WITH_THREAT') {
    return handleLinesWithThreat(card, boardCoords, props)
  }

  // SELECT_LINE_FOR_SUPPORT_COUNTERS (Signal Prophet Deploy)
  if (mode === 'SELECT_LINE_FOR_SUPPORT_COUNTERS') {
    return handleSelectLineForSupportTokens(card, boardCoords, props)
  }

  // SELECT_LINE_FOR_THREAT_COUNTERS (Code Keeper Deploy)
  if (mode === 'SELECT_LINE_FOR_THREAT_COUNTERS') {
    return handleSelectLineForThreatCounters(card, boardCoords, props)
  }

  // LINES_WITH_SUPPORT (Signal Prophet - legacy)
  if (mode === 'LINES_WITH_SUPPORT') {
    return handleLinesWithSupport(card, boardCoords, props)
  }

  // RETRIEVE_DEVICE
  if (mode === 'RETRIEVE_DEVICE') {
    return handleRetrieveDevice(card, boardCoords, props)
  }

  // SELECT_DECK
  if (mode === 'SELECT_DECK') {
    return handleSelectDeck(card, boardCoords, props)
  }

  // RECON_DRONE_COMMIT (2-step: select adjacent opponent card, then reveal their hand card)
  if (mode === 'RECON_DRONE_COMMIT') {
    return handleReconDroneCommit(card, boardCoords, props)
  }

  // AUTO_STEPS (Generic multi-step ability system)
  if (mode === 'AUTO_STEPS') {
    // Check if this ability is transitioning to a new mode
    const transitionKey = `${abilityMode?.sourceCard?.id}-${abilityMode?.sourceCoords?.row}-${abilityMode?.sourceCoords?.col}`
    if (transitioningCards.has(transitionKey)) {
      // Skip AUTO_STEPS processing, but check if there's a targeting mode to use instead
      const targetingMode = gameState.targetingMode
      if (targetingMode && targetingMode.action.mode !== 'AUTO_STEPS') {
        // Use the targeting mode action to process this click
        const mode = targetingMode.action.mode
        const payload = targetingMode.action.payload

        // CRITICAL: Create a modified props with the targeting mode's action
        // The handlers expect abilityMode to match the current mode, not AUTO_STEPS
        const modifiedProps = {
          ...props,
          abilityMode: targetingMode.action
        }

        // Handle SELECT_TARGET with tokenType
        if (mode === 'SELECT_TARGET' && payload.tokenType) {
          return handleSelectTargetWithToken(card, boardCoords, modifiedProps)
        }
        // Handle other SELECT_TARGET actionTypes
        if (mode === 'SELECT_TARGET') {
          return handleSelectTargetActionType(card, boardCoords, modifiedProps)
        }
      }
      // If no targeting mode or can't handle, return false
      return false
    } else {
      return handleAutoSteps(card, boardCoords, props)
    }
  }

  return false
}

/**
 * Handle SELECT_TARGET with tokenType (CREATE_STACK)
 */
function handleSelectTargetWithToken(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, triggerClickWave, moveItem, markAbilityUsed, setAbilityMode, setCommandContext, handleActionExecution, clearValidTargets, addBoardCardStatus } = props
  const { payload, sourceCoords, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode!

  if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
    return false
  }

  // Handle DOUBLE_TOKEN (Reverend of The Choir Deploy) - double existing tokens
  if (payload.actionType === 'DOUBLE_TOKEN') {
    const tokenType = payload.tokenType || 'Exploit'
    const ownerId = sourceCard?.ownerId || 0

    // Count existing tokens from the owner on target card
    const currentCount = card.statuses?.filter((s: any) =>
      s.type === tokenType && s.addedByPlayerId === ownerId
    ).length || 0

    if (currentCount > 0) {
      // CRITICAL FIX: Use single call with count parameter instead of loop
      // This prevents race conditions for guest players
      addBoardCardStatus(boardCoords, tokenType, ownerId, currentCount)

      // Mark ability as used
      markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    }

    setTimeout(() => {
      setAbilityMode(null)
      clearValidTargets()
    }, TIMING.MODE_CLEAR_DELAY)

    return true
  }

  // Normal CREATE_STACK handling
  moveItem({
    card: { id: 'dummy', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', types: [] },
    source: 'counter_panel',
    statusType: payload.tokenType,
    count: payload.count || 1,
  }, { target: 'board', boardCoords })

  triggerClickWave('board', boardCoords)

  if (payload.recordContext) {
    setCommandContext({ lastMovedCardCoords: boardCoords, lastMovedCardId: card.id })
  }

  // CRITICAL: Check AUTO_STEPS BEFORE chainedAction
  // If we're in AUTO_STEPS, continue to next step and preserve chainedAction for later
  const autoStepsContext = payload._autoStepsContext
  if (autoStepsContext && autoStepsContext.steps) {
    // Update commandContext with last moved card coords for AUTO_STEPS continuation
    // Continue to next step instead of clearing mode
    // Pass stepContext with the card that just received the token
    advanceToNextStepWithCoords(
      props,
      boardCoords,
      autoStepsContext.currentStepIndex,
      { lastMovedCardCoords: boardCoords, sourceOwnerId: card.ownerId },
      payload.chainedAction  // Pass chainedAction to execute after AUTO_STEPS complete
    )
  } else if (payload.chainedAction) {
    // Execute chained action if not in AUTO_STEPS
    const nextAction: AbilityAction = {
      ...payload.chainedAction,
      sourceCard: payload.chainedAction.sourceCard ?? card,
      sourceCoords: payload.chainedAction.sourceCoords ?? boardCoords,
      isDeployAbility,
      recordContext: true,
      // CRITICAL: Set originalOwnerId to ability mode source card owner for correct targeting
      // This fixes cases where chained actions need to use the original card's owner, not the target card's owner
      originalOwnerId: abilityMode.sourceCard?.ownerId ?? sourceCoords ? gameState.board[sourceCoords.row]?.[sourceCoords.col]?.card?.ownerId : undefined,
    }
    handleActionExecution(nextAction, boardCoords)
    // Immediate wave for chained action - no delay needed
    triggerClickWave('board', boardCoords)
    if (nextAction.type !== 'ENTER_MODE') {
      setAbilityMode(null)
      clearValidTargets()
    }
  } else {
    // Normal completion
    if (sourceCoords && sourceCoords.row >= 0) {
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    }
    setTimeout(() => {
      setAbilityMode(null)
      clearValidTargets()
    }, TIMING.MODE_CLEAR_DELAY)
  }

  return true
}

/**
 * Continue AUTO_STEPS after a mode completes
 * @param stepContext - Optional context data from previous step (e.g., lastMovedCardCoords, targetCoords, sourceOwnerId)
 * @param chainedActionFromStep - Optional chained action to execute after all AUTO_STEPS complete
 */
export function advanceToNextStepWithCoords(
  props: ModeHandlersProps,
  _completedCoords: { row: number; col: number },
  nextStepIndex: number,
  stepContext?: { lastMovedCardCoords?: { row: number; col: number }; targetCoords?: { row: number; col: number }; sourceOwnerId?: number; lastPlacedToken?: { cardId: string; tokenType: string; addedByPlayerId: number; boardCoords: { row: number; col: number } }; placedTokens?: Array<{ boardCoords: { row: number; col: number }; cardId: string; tokenType: string; addedByPlayerId: number }> },
  chainedActionFromStep?: AbilityAction
): void {
  const { abilityMode, setAbilityMode, markAbilityUsed, gameState, getFreshGameState, commandContext, setTargetingMode, calculateValidTargets, handleActionExecution } = props

  if (!abilityMode) { return }

  const payload = abilityMode.payload
  if (!payload || !payload._autoStepsContext) { return }

  const autoStepsContext = payload._autoStepsContext
  const steps = autoStepsContext.steps
  // CRITICAL: Use abilityMode.sourceCard, but fall back to finding command card by ID if undefined
  // This fixes False Orders where abilityMode.sourceCard might not be the command card
  let sourceCard = abilityMode.sourceCard
  if (!sourceCard && autoStepsContext.commandCardId) {
    // Find the command card in the announced cards
    sourceCard = gameState.players
      .flatMap(p => p.announced || [])
      .find(c => c.id === autoStepsContext.commandCardId)
  }
  // CRITICAL: Always use abilityMode.sourceCoords (original card position), NOT completedCoords
  // completedCoords is where the action completed (e.g., destroyed card location), not the source card
  const sourceCoords = abilityMode.sourceCoords

  // CRITICAL: Clear commandContext.sourceOwnerId at the start of each AUTO_STEPS chain
  // This prevents stale values from previous ability uses (e.g., False Orders targeting wrong player)
  // Only clear at the first step (index 0) to not interfere with ongoing multi-step abilities
  if (nextStepIndex === 0 && commandContext?.sourceOwnerId && !stepContext?.sourceOwnerId) {
    props.setCommandContext?.(prev => {
      const { sourceOwnerId, ...rest } = prev
      return rest
    })
  }

  // Use readyStatusToRemove from autoStepsContext if not set at action level
  const readyStatusToRemove = abilityMode.readyStatusToRemove ?? autoStepsContext.readyStatusToRemove

  // Check if there are more steps
  if (nextStepIndex >= steps.length) {
    // All steps complete!
    // CRITICAL: Execute chainedAction if present (e.g., False Orders Revealed tokens)
    if (chainedActionFromStep) {
      // CRITICAL: Resolve targetOwnerId -2 (TARGET_MOVED_OWNER) to actual owner ID
      // This fixes False Orders Option 1 where chained action targets the moved card's owner's hand
      // Priority: stepContext.sourceOwnerId > chainedAction._sourceOwnerId (from useAppCounters) > commandContext.sourceOwnerId
      const contextOwnerId = stepContext?.sourceOwnerId ?? (chainedActionFromStep as any)._sourceOwnerId ?? commandContext?.sourceOwnerId

      // CRITICAL: Always resolve targetOwnerId if stepContext.sourceOwnerId is set
      // This prevents stale values from previous chainedAction uses (e.g., False Orders repeated)
      // If details.targetOwnerId or payload.targetOwnerId is -2, resolve to contextOwnerId
      // If stepContext.sourceOwnerId is set, use it regardless of current targetOwnerId value
      const needsResolution = (chainedActionFromStep as any).details?.targetOwnerId === -2 ||
                             (chainedActionFromStep as any).payload?.targetOwnerId === -2 ||
                             stepContext?.sourceOwnerId !== undefined

      const resolvedTargetOwnerId = needsResolution ? contextOwnerId : undefined

      const nextAction: AbilityAction = {
        ...chainedActionFromStep,
        sourceCard: chainedActionFromStep.sourceCard ?? sourceCard,
        sourceCoords: chainedActionFromStep.sourceCoords ?? _completedCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        recordContext: true,
        // CRITICAL: Set originalOwnerId to command card owner for correct targeting in chained actions
        // This fixes False Orders Option 1 where Revealed tokens should use command card owner, not moved card owner
        originalOwnerId: sourceCard?.ownerId ?? abilityMode.sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0,
        // CRITICAL: Add _sourceOwnerId to prevent stale commandContext.sourceOwnerId from being used
        // This fixes False Orders Option 1 where repeated uses would target wrong player's hand
        ...(contextOwnerId !== undefined ? { _sourceOwnerId: contextOwnerId } : {}),
        // CRITICAL: Override targetOwnerId with resolved value if it was -2
        ...(resolvedTargetOwnerId !== undefined ? {
          details: { ...(chainedActionFromStep as any).details, targetOwnerId: resolvedTargetOwnerId },
          payload: { ...(chainedActionFromStep as any).payload, targetOwnerId: resolvedTargetOwnerId }
        } : {})
      }

      handleActionExecution(nextAction, _completedCoords)
    }

    // CRITICAL: Execute CLEANUP_COMMAND step if it's the last step and wasn't executed yet
    // This fixes Logistics Chain not discarding after diagonal selection
    // Check if the last step is CLEANUP_COMMAND
    const lastStep = steps[steps.length - 1]
    if (lastStep && lastStep.action === 'GLOBAL_AUTO_APPLY' && lastStep.details?.customAction === 'CLEANUP_COMMAND') {
      // CRITICAL: For command cards, ensure we use the original command card as sourceCard
      // This fixes Enhanced Interrogation option 2 where moving an opponent's card
      // causes sourceCard to become the opponent's card instead of the command card
      let cleanupSourceCard = abilityMode.sourceCard
      let cleanupSourceCoords = abilityMode.sourceCoords

      // If _autoStepsContext has commandCardId, find the actual command card
      if (autoStepsContext?.commandCardId) {
        // Try to find the command card in announced cards
        for (const p of gameState.players) {
          if (p.announcedCard && p.announcedCard.id === autoStepsContext.commandCardId) {
            cleanupSourceCard = p.announcedCard
            // Command cards are in showcase, use default coords
            cleanupSourceCoords = { row: -1, col: -1 }
            break
          }
        }
      }

      const cleanupAction: AbilityAction = {
        type: 'GLOBAL_AUTO_APPLY',
        mode: null,
        sourceCard: cleanupSourceCard,
        sourceCoords: cleanupSourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: abilityMode.readyStatusToRemove,
        payload: {
          ...lastStep.details,
          _autoStepsContext: autoStepsContext
        }
      }
      handleActionExecution(cleanupAction, sourceCoords || { row: 0, col: 0 })
    } else {
      // No CLEANUP_COMMAND step, just mark ability as used
      markAbilityUsed(sourceCoords || { row: 0, col: 0 }, abilityMode.isDeployAbility, false, readyStatusToRemove)
    }
    setAbilityMode(null)
    return
  }

  const nextStep = steps[nextStepIndex]

  // CRITICAL: Execute chainedAction from previous step BEFORE processing the next step
  // This fixes False Orders Option 2 where Stun x2 (chainedAction of step 1) should be placed
  // before advancing to step 2 (CLEANUP_COMMAND)
  if (chainedActionFromStep) {
    // Resolve targetOwnerId if needed
    const contextOwnerId = stepContext?.sourceOwnerId ?? (chainedActionFromStep as any)._sourceOwnerId ?? commandContext?.sourceOwnerId
    const needsResolution = (chainedActionFromStep as any).details?.targetOwnerId === -2 ||
                           (chainedActionFromStep as any).payload?.targetOwnerId === -2 ||
                           stepContext?.sourceOwnerId !== undefined

    // CRITICAL: Use _completedCoords as the target location for token placement
    // This fixes False Orders Option 2 where Stun x2 should be placed on the moved card
    // _completedCoords contains the location where the card was moved to
    const targetCoords = _completedCoords

    const resolvedChainedAction: AbilityAction = needsResolution && contextOwnerId !== undefined
      ? {
          ...chainedActionFromStep,
          details: { ...(chainedActionFromStep as any).details, targetOwnerId: contextOwnerId },
          payload: {
            ...(chainedActionFromStep as any).payload,
            targetOwnerId: contextOwnerId,
            // CRITICAL: Add contextCardId or lastMovedCardCoords for token placement
            // This fixes False Orders Option 2 where Stun x2 needs to find the moved card
            ...(targetCoords && targetCoords.row >= 0 ? { lastMovedCardCoords: targetCoords } : {}),
            // CRITICAL: Pass commandContext so handleGlobalAutoApply can access lastMovedCardCoords
            _commandContext: commandContext,
            // CRITICAL FIX: Preserve stepContext to maintain placedTokens across AUTO_STEPS
            // This fixes guest Overwatch where tokens placed in earlier steps need to be counted in dynamicCount
            stepContext: stepContext,
          },
          _sourceOwnerId: contextOwnerId,
          sourceCard: chainedActionFromStep.sourceCard ?? sourceCard,
          sourceCoords: targetCoords || chainedActionFromStep.sourceCoords || _completedCoords,
          isDeployAbility: abilityMode.isDeployAbility,
        }
      : {
          ...chainedActionFromStep,
          payload: {
            ...(chainedActionFromStep as any).payload,
            // CRITICAL: Add contextCardId or lastMovedCardCoords for token placement
            ...(targetCoords && targetCoords.row >= 0 ? { lastMovedCardCoords: targetCoords } : {}),
            // CRITICAL: Pass commandContext so handleGlobalAutoApply can access lastMovedCardCoords
            _commandContext: commandContext,
            // CRITICAL FIX: Preserve stepContext to maintain placedTokens across AUTO_STEPS
            // This fixes guest Overwatch where tokens placed in earlier steps need to be counted in dynamicCount
            stepContext: stepContext,
          },
          sourceCard: chainedActionFromStep.sourceCard ?? sourceCard,
          sourceCoords: targetCoords || chainedActionFromStep.sourceCoords || _completedCoords,
          isDeployAbility: abilityMode.isDeployAbility,
        }

    // Execute the chainedAction
    props.handleActionExecution(resolvedChainedAction, resolvedChainedAction.sourceCoords)

    // CRITICAL: After executing chainedAction, continue to next step
    // The chainedAction is consumed, so don't pass it again
    chainedActionFromStep = undefined
  }

  // If next step has no mode, execute instantly
  // CRITICAL: CREATE_STACK always requires player interaction (placing tokens via cursorStack)
  // even when mode is null, it should NOT be treated as instant
  if (!nextStep.mode && nextStep.action !== 'CREATE_STACK') {
    // CRITICAL: Clear targetingMode AND abilityMode BEFORE executing instant step
    // This fixes Overwatch Option 2 where CREATE_STACK sets targetingMode,
    // but the next step (GLOBAL_AUTO_APPLY) is instant and doesn't need targeting
    // Without clearing abilityMode, visual highlights on cards would persist
    if (props.clearTargetingMode) {
      props.clearTargetingMode()
    }
    // CRITICAL: Also clear abilityMode to remove visual highlights
    // The abilityMode remains set during AUTO_STEPS, but visual effects should be cleared
    // for instant steps that don't require targeting
    setAbilityMode(null)

    // Execute instant step directly
    const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0
    const result = executeInstantAutoStep(
      nextStep,
      sourceCoords,
      ownerId,
      {
        gameState,
        localPlayerId: props.localPlayerId,
        commandContext: props.commandContext,
        addBoardCardStatus: props.addBoardCardStatus,
        modifyBoardCardPower: props.modifyBoardCardPower,
      },
      stepContext  // Pass stepContext to instant step (for BUFF_LINES_FROM_CONTEXT)
    )

    if (!result.success) {
    }

    // CRITICAL: If step needs execution (e.g., CLEANUP_COMMAND, draw cards), execute it via handleActionExecution
    if (result.needsExecution) {
      const stepCustomAction = nextStep.details?.customAction
      const stepDynamicResource = nextStep.details?.dynamicResource
      // CRITICAL: Clear targetingMode before executing GLOBAL_AUTO_APPLY
      // This fixes Overwatch Option 2 where targetingMode from CREATE_STACK step
      // should be cleared before the draw step executes
      if (props.clearTargetingMode) {
        props.clearTargetingMode()
      }
      // CRITICAL: Resolve targetOwnerId -2 (TARGET_MOVED_OWNER) for chainedAction
      // This fixes False Orders Option 1 where Revealed tokens need to target the moved card's owner's hand
      let resolvedChainedAction: AbilityAction | undefined = chainedActionFromStep
      if (chainedActionFromStep) {
        // Resolve targetOwnerId if it's -2 or if stepContext.sourceOwnerId is set
        const contextOwnerId = stepContext?.sourceOwnerId ?? (chainedActionFromStep as any)._sourceOwnerId ?? commandContext?.sourceOwnerId
        const needsResolution = (chainedActionFromStep as any).details?.targetOwnerId === -2 ||
                               (chainedActionFromStep as any).payload?.targetOwnerId === -2 ||
                               stepContext?.sourceOwnerId !== undefined

        if (needsResolution && contextOwnerId !== undefined) {
          // Create a new action with resolved targetOwnerId
          resolvedChainedAction = {
            ...chainedActionFromStep,
            ...(contextOwnerId !== undefined ? {
              details: { ...(chainedActionFromStep as any).details, targetOwnerId: contextOwnerId },
              payload: {
                ...(chainedActionFromStep as any).payload,
                targetOwnerId: contextOwnerId,
                // CRITICAL FIX: Preserve stepContext to maintain placedTokens across AUTO_STEPS
                // This fixes guest Overwatch where tokens placed in earlier steps need to be counted in dynamicCount
                stepContext: stepContext,
              },
              _sourceOwnerId: contextOwnerId,
            } : {}),
          }
        } else if (chainedActionFromStep && stepContext) {
          // CRITICAL FIX: Even without resolution, preserve stepContext in chainedAction
          // This fixes guest Overwatch where stepContext needs to be passed through
          resolvedChainedAction = {
            ...chainedActionFromStep,
            payload: {
              ...(chainedActionFromStep as any).payload,
              stepContext: stepContext,
            },
          }
        }
      }

      // Create action for handleActionExecution
      // CRITICAL: Cast to AbilityAction because nextStep.action is 'GLOBAL_AUTO_APPLY'
      const actionToExecute: AbilityAction = {
        type: 'GLOBAL_AUTO_APPLY',  // Explicitly set the type
        sourceCard: sourceCard,
        sourceCoords: sourceCoords || { row: 0, col: 0 },
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        payload: {
          ...nextStep.details,
          // CRITICAL: Pass commandContext through payload so handleGlobalAutoApply can access lastPlacedToken
          // This fixes Overwatch Option 2 where the Aim token placed in step 1 needs to be counted in step 2
          _commandContext: props.commandContext,
          // CRITICAL: Pass _lastPlacedToken directly from stepContext (synchronous, no async React state)
          // This fixes Overwatch Option 2 where the Aim token placed in step 1 needs to be counted in step 2
          _lastPlacedToken: stepContext?.lastPlacedToken,
          // CRITICAL FIX: Pass _placedTokens from stepContext to track ALL tokens placed in current step
          // This fixes Overwatch where multiple tokens placed in the same step need to be counted
          _placedTokens: stepContext?.placedTokens,
          _sourceOwnerIdFromStep: stepContext?.sourceOwnerId,
          // CRITICAL FIX: Pass stepContext to preserve it across AUTO_STEPS
          // This fixes Overwatch where stepContext.placedTokens needs to be passed to next step
          stepContext: stepContext,
          // CRITICAL: Pass _autoStepsContext so CLEANUP_COMMAND can find commandCardId
          _autoStepsContext: {
            steps: steps,
            currentStepIndex: nextStepIndex,
            originalType: autoStepsContext.originalType,
            supportRequired: autoStepsContext.supportRequired,
            readyStatusToRemove: autoStepsContext.readyStatusToRemove,
            commandCardId: autoStepsContext.commandCardId || sourceCard?.id,
          },
        },
        // CRITICAL: Include chainedAction so handleGlobalAutoApply can execute it after GLOBAL_AUTO_APPLY
        // This fixes False Orders Option 1 where Revealed tokens need to be placed after step 2 completes
        ...(resolvedChainedAction ? { chainedAction: resolvedChainedAction } : {}),
      }

      handleActionExecution(actionToExecute, sourceCoords || { row: 0, col: 0 })

      // After execution, check if there are more steps
      const followingStepIndex = nextStepIndex + 1
      if (followingStepIndex >= steps.length) {
        // All steps complete!
        markAbilityUsed(sourceCoords || { row: 0, col: 0 }, abilityMode.isDeployAbility, false, readyStatusToRemove)
        setAbilityMode(null)
        return
      }

      // Continue to the step after this one
      advanceToNextStepWithCoords(props, sourceCoords || { row: 0, col: 0 }, followingStepIndex, stepContext, chainedActionFromStep)
      return
    }

    // Check if there are more steps after this instant step
    const followingStepIndex = nextStepIndex + 1
    if (followingStepIndex >= steps.length) {
      // All steps complete!
      // CRITICAL: Execute chainedAction if present (e.g., False Orders Revealed tokens)
      if (chainedActionFromStep) {
        // CRITICAL: Resolve targetOwnerId -2 (TARGET_MOVED_OWNER) to actual owner ID
        // Priority: stepContext.sourceOwnerId > chainedAction._sourceOwnerId (from useAppCounters) > commandContext.sourceOwnerId
        const contextOwnerId = stepContext?.sourceOwnerId ?? (chainedActionFromStep as any)._sourceOwnerId ?? commandContext?.sourceOwnerId

        // CRITICAL: Always resolve targetOwnerId if stepContext.sourceOwnerId is set
        // This prevents stale values from previous chainedAction uses (e.g., False Orders repeated)
        // If details.targetOwnerId or payload.targetOwnerId is -2, resolve to contextOwnerId
        // If stepContext.sourceOwnerId is set, use it regardless of current targetOwnerId value
        const needsResolution = (chainedActionFromStep as any).details?.targetOwnerId === -2 ||
                               (chainedActionFromStep as any).payload?.targetOwnerId === -2 ||
                               stepContext?.sourceOwnerId !== undefined

        const resolvedTargetOwnerId = needsResolution ? contextOwnerId : undefined

        const nextAction: AbilityAction = {
          ...chainedActionFromStep,
          sourceCard: chainedActionFromStep.sourceCard ?? sourceCard,
          sourceCoords: chainedActionFromStep.sourceCoords ?? (sourceCoords || { row: 0, col: 0 }),
          isDeployAbility: abilityMode.isDeployAbility,
          recordContext: true,
          // CRITICAL: Set originalOwnerId to command card owner for correct targeting in chained actions
          // This fixes False Orders Option 1 where Revealed tokens should use command card owner, not moved card owner
          originalOwnerId: sourceCard?.ownerId ?? abilityMode.sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0,
          // CRITICAL: Add _sourceOwnerId to prevent stale commandContext.sourceOwnerId from being used
          // This fixes False Orders Option 1 where repeated uses would target wrong player's hand
          ...(contextOwnerId !== undefined ? { _sourceOwnerId: contextOwnerId } : {}),
          // CRITICAL: Override targetOwnerId with resolved value if it was -2
          ...(resolvedTargetOwnerId !== undefined ? {
            details: { ...(chainedActionFromStep as any).details, targetOwnerId: resolvedTargetOwnerId },
            payload: { ...(chainedActionFromStep as any).payload, targetOwnerId: resolvedTargetOwnerId }
          } : {})
        }
        handleActionExecution(nextAction, sourceCoords || { row: 0, col: 0 })
      }
      markAbilityUsed(sourceCoords || { row: 0, col: 0 }, abilityMode.isDeployAbility, false, readyStatusToRemove)
      setAbilityMode(null)
      return
    }

    // Continue to the step after this instant step
    advanceToNextStepWithCoords(props, sourceCoords || { row: 0, col: 0 }, followingStepIndex, stepContext, chainedActionFromStep)
    return
  } else {
    // Enter next interactive mode
    // CRITICAL: Use abilityMode.sourceCard as fallback for correct highlighting color
    // This fixes False Orders Option 1 where sourceCard becomes the target card after first step
    // and highlights would use the target card's owner color instead of the command card owner's color
    const ownerId = sourceCard?.ownerId ?? abilityMode.sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0

    // Handle special action types
    let stepAction: AbilityAction

    // Handle CREATE_STACK - keep as CREATE_STACK to trigger handleCreateStack (cursor stack)
    if (nextStep.action === "CREATE_STACK") {
      // CRITICAL: Get chainedAction from the PREVIOUS step (the one being completed)
      // This fixes Temporary Shelter where step 0's chainedAction must execute after step 0 completes
      const previousStep = nextStepIndex > 0 ? steps[nextStepIndex - 1] : null
      const previousStepChainedAction = previousStep?.chainedAction

      const details = nextStep.details || {}

      // CRITICAL: Convert "source" string to actual owner ID in dynamicCount
      // This fixes Data Interception option 0 where dynamicCount.ownerId is "source"
      const dynamicCount = details.dynamicCount
      const resolvedDynamicCount = dynamicCount ? {
        ...dynamicCount,
        ownerId: dynamicCount.ownerId === 'source' ? (sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0) : dynamicCount.ownerId
      } : undefined

      // CRITICAL: Resolve targetOwnerId -2 (TARGET_MOVED_OWNER)
      // CRITICAL: Initialize as undefined, not details.targetOwnerId, to prevent string "source" from being assigned
      let resolvedTargetOwnerId: number | undefined = undefined
      if (details.targetOwnerId === 'source') {
        resolvedTargetOwnerId = sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0
      } else if (details.targetOwnerId === -2) {
        const contextOwnerId = stepContext?.sourceOwnerId ?? commandContext?.sourceOwnerId
        resolvedTargetOwnerId = contextOwnerId ?? details.targetOwnerId
      } else if (typeof details.targetOwnerId === 'number') {
        // Use the number value directly (specific player ID)
        resolvedTargetOwnerId = details.targetOwnerId
      }

      stepAction = {
        type: "CREATE_STACK",
        mode: "SELECT_TARGET",
        sourceCard,
        sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        tokenType: details.tokenType,
        count: details.count || 1,
        // CRITICAL: Copy all targeting properties
        // CRITICAL: Resolve "source" and -2 (TARGET_MOVED_OWNER) to actual owner ID
        // CRITICAL: Fall back to commandContext.sourceOwnerId if stepContext doesn't have it
        targetOwnerId: resolvedTargetOwnerId,
        excludeOwnerId: details.excludeOwnerId === 'source' ? (sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0) : details.excludeOwnerId,
        onlyOpponents: details.onlyOpponents,
        onlyFaceDown: details.onlyFaceDown,
        targetType: details.targetType,
        requiredTargetStatus: details.requiredTargetStatus,
        requireTokenFromSourceOwner: details.requireTokenFromSourceOwner,
        mustBeInLineWithSource: nextStep.mode === "LINE_TARGET" ? true : undefined,
        mustBeAdjacentToSource: nextStep.mode === "ADJACENT_TARGET" ? true : undefined,
        maxDistanceFromSource: details.maxDistanceFromSource,
        maxOrthogonalDistance: details.maxOrthogonalDistance,
        placeAllAtOnce: details.placeAllAtOnce,
        replaceStatus: details.replaceStatus,
        recordContext: details.recordContext,
        dynamicCount: resolvedDynamicCount,
        // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
        // CRITICAL: For AUTO_STEPS, chainedAction can be in the CURRENT step (to execute after it completes)
        // or in the NEXT step (to execute after the next step completes)
        // This fixes Temporary Shelter where chainedAction is in step 0 (the CREATE_STACK step itself)
        // Priority: nextStep.chainedAction (for False Orders) > previousStep.chainedAction (for Temporary Shelter)
        ...(nextStep.chainedAction ? {
          chainedAction: JSON.parse(JSON.stringify(nextStep.chainedAction))
        } : previousStepChainedAction ? {
          chainedAction: JSON.parse(JSON.stringify(previousStepChainedAction))
        } : {}),
        // CRITICAL: Add originalOwnerId so handleSelectUnitForMove can use it for highlight color
        // This fixes Data Interception option 1 where cell selection highlight used wrong color when playing as dummy
        originalOwnerId: ownerId,
        payload: {
          // CRITICAL: Deep copy details to prevent mutation of original steps (False Orders issue)
          ...JSON.parse(JSON.stringify(nextStep.details)),
          // CRITICAL: Override targetOwnerId with resolved value (for False Orders Option 1)
          // This ensures payload.targetOwnerId is also resolved from -2 to actual owner ID
          targetOwnerId: resolvedTargetOwnerId,
          // CRITICAL: Override dynamicCount with resolved value (Enhanced Interrogation, Data Interception)
          // This ensures payload.dynamicCount is also resolved from "source" to actual owner ID
          dynamicCount: resolvedDynamicCount,
          // CRITICAL: Convert string filters to functions for command cards
          // This fixes Enhanced Interrogation option 2 where filter "hasCounterOwner_Aim" needs to be a function
          ...(details.filter && typeof details.filter === 'string' ? {
            filter: buildFilterFromString(details.filter, ownerId, sourceCoords || { row: 0, col: 0 }),
            filterString: details.filter  // Keep original string for serialization
          } : {}),
          // CRITICAL FIX: Pass stepContext to preserve it across AUTO_STEPS
          // This fixes Overwatch option 1 (Reveal cards) where Aim token placed in step 0
          // needs to be counted in step 1's dynamicCount calculation
          // Without this, guests get incorrect token counts because freshState is stale
          stepContext: stepContext,
          _autoStepsContext: {
            steps: steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: autoStepsContext.originalType,
            supportRequired: autoStepsContext.supportRequired,
            readyStatusToRemove: readyStatusToRemove,
            // CRITICAL: Pass commandCardId for CLEANUP_COMMAND to find the correct command card
            commandCardId: autoStepsContext.commandCardId || (abilityMode.payload as any)?.commandCardId || sourceCard?.id
          }
        }
      }
    } else if (nextStep.action === "CREATE_TOKEN") {
      // CREATE_TOKEN needs to be converted to OPEN_MODAL with PLACE_TOKEN mode
      stepAction = {
        type: "OPEN_MODAL",
        mode: "PLACE_TOKEN",
        sourceCard,
        sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
        ...(nextStep.chainedAction ? { chainedAction: nextStep.chainedAction } : {}),
        // CRITICAL: Add originalOwnerId so handleSelectUnitForMove can use it for highlight color
        originalOwnerId: ownerId,
        payload: {
          ...nextStep.details,
          tokenId: nextStep.details?.tokenId,
          range: nextStep.mode === "ADJACENT_EMPTY" ? "adjacent" : "global",
          // CRITICAL: Convert string filters to functions for command cards
          ...(nextStep.details?.filter && typeof nextStep.details.filter === 'string' ? {
            filter: buildFilterFromString(nextStep.details.filter, ownerId, sourceCoords || { row: 0, col: 0 }),
            filterString: nextStep.details.filter
          } : {}),
          _autoStepsContext: {
            steps: steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: autoStepsContext.originalType,
            supportRequired: autoStepsContext.supportRequired,
            readyStatusToRemove: readyStatusToRemove,
            // CRITICAL: Pass commandCardId for CLEANUP_COMMAND to find the correct command card
            commandCardId: autoStepsContext.commandCardId || (abilityMode.payload as any)?.commandCardId || sourceCard?.id
          }
        }
      }
    } else if (nextStep.action === "SCORE_POINTS") {
      // SCORE_POINTS - use the mode directly (SELECT_LINE_FOR_EXPLOIT_SCORING, etc.)
      // These modes have their own handlers in handleModeCardClick
      // Include targetCoords from stepContext if available (for line selection modes)
      // Note: useAppCounters uses 'targetCoords', handleSelectTargetWithToken uses 'lastMovedCardCoords'
      const contextCoords = stepContext?.lastMovedCardCoords || stepContext?.targetCoords
      stepAction = {
        type: 'ENTER_MODE',
        mode: nextStep.mode || 'SELECT_TARGET',  // Use the mode from database
        sourceCard,
        sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
        ...(nextStep.chainedAction ? { chainedAction: nextStep.chainedAction } : {}),
        // CRITICAL: Add originalOwnerId so handleSelectUnitForMove can use it for highlight color
        originalOwnerId: ownerId,
        payload: {
          ...nextStep.details,
          // Pass targetCoords directly in payload for immediate access (synchronous)
          targetCoords: contextCoords,
          _autoStepsContext: {
            steps: steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: autoStepsContext.originalType,
            supportRequired: autoStepsContext.supportRequired,
            readyStatusToRemove: readyStatusToRemove
          }
        }
      }
    } else {
      // Default interactive step handling (SACRIFICE_TARGET, PUSH, SELECT_CELL, etc.)
      // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
      // These are targeting constraints, not separate modes. The constraint is stored in payload.
      const normalizedMode = (nextStep.mode === "LINE_TARGET" || nextStep.mode === "ADJACENT_TARGET")
        ? "SELECT_TARGET"
        : (nextStep.mode || "SELECT_TARGET")

      // CRITICAL: For SELECT_CELL with useContextCard: true (False Orders), use contextCard coords as sourceCoords
      // This allows calculateValidTargets to find valid empty cells within range of the context card
      let effectiveSourceCoords = sourceCoords
      let effectiveSourceCard = sourceCard
      if (nextStep.mode === 'SELECT_CELL' && nextStep.details?.useContextCard) {
        // Try to get coords from stepContext (where the previous action completed)
        const contextCoords = stepContext?.lastMovedCardCoords || stepContext?.targetCoords || commandContext?.lastMovedCardCoords
        if (contextCoords && contextCoords.row >= 0 && contextCoords.col >= 0) {
          effectiveSourceCoords = contextCoords
          // Also get the context card (the unit with Exploit token)
          const freshGameState = getFreshGameState ? getFreshGameState() : gameState
          const contextCard = freshGameState.board[effectiveSourceCoords.row]?.[effectiveSourceCoords]?.card
          if (contextCard) {
            effectiveSourceCard = contextCard
          }
        }
      }

      stepAction = {
        type: 'ENTER_MODE',
        mode: normalizedMode,
        sourceCard: effectiveSourceCard,
        sourceCoords: effectiveSourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        // CRITICAL: Preserve chainedAction from step level (for False Orders, Temporary Shelter, etc.)
        ...(nextStep.chainedAction ? { chainedAction: nextStep.chainedAction } : {}),
        // CRITICAL: Add originalOwnerId so handleSelectUnitForMove can use it for highlight color
        // This fixes Data Interception option 1 where cell selection highlight used wrong color when playing as dummy
        originalOwnerId: ownerId,
        payload: {
          ...nextStep.details,
          actionType: nextStep.action,  // Set actionType so handleSelectTargetActionType knows how to handle this
          tokenType: nextStep.details?.tokenType,
          count: nextStep.details?.count,
          mustBeInLineWithSource: nextStep.mode === 'LINE_TARGET' ? true : undefined,
          mustBeAdjacentToSource: nextStep.mode === 'ADJACENT_TARGET' ? true : undefined,
          // CRITICAL: Preserve commandCard (original sourceCard) for chained actions
          // This fixes False Orders Option 1 where chained action needs command card owner, not unit card owner
          // When useContextCard is true, effectiveSourceCard is the unit with Exploit, but commandCard is the False Orders card
          _commandCard: (effectiveSourceCard !== sourceCard) ? sourceCard : undefined,
          // CRITICAL: Convert string filters to functions for command cards
          // This fixes Enhanced Interrogation option 2 where filter "hasCounterOwner_Aim" needs to be a function
          ...(nextStep.details?.filter && typeof nextStep.details.filter === 'string' ? {
            filter: buildFilterFromString(nextStep.details.filter, ownerId, effectiveSourceCoords),
            filterString: nextStep.details.filter  // Keep original string for serialization
          } : {}),
          // CRITICAL: Pass lastPlacedToken from stepContext directly in payload
          // This ensures it's immediately available without relying on async React state updates
          // This fixes Overwatch Option 2 where the Aim token placed in step 1 needs to be counted in step 2
          _lastPlacedToken: stepContext?.lastPlacedToken,
          _sourceOwnerIdFromStep: stepContext?.sourceOwnerId,
          _autoStepsContext: {
            steps: steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: autoStepsContext.originalType,
            supportRequired: autoStepsContext.supportRequired,
            readyStatusToRemove: readyStatusToRemove,
            // CRITICAL: Pass commandCardId for CLEANUP_COMMAND to find the correct command card
            // Priority: autoStepsContext.commandCardId > abilityMode.payload.commandCardId > sourceCard.id
            commandCardId: autoStepsContext.commandCardId || (abilityMode.payload as any)?.commandCardId || sourceCard?.id
          }
        }
      }
    }

    setAbilityMode(stepAction)

    // Mark source card as transitioning to prevent infinite re-processing
    if (sourceCard && sourceCoords) {
      const transitionKey = `${sourceCard.id}-${sourceCoords.row}-${sourceCoords.col}`
      transitioningCards.add(transitionKey)
      clearTransitioning(transitionKey, 200)
    }

    // Update targeting mode to show valid targets for the new mode
    // CRITICAL: Check if there are valid targets - if not, skip this step
    // EXCEPTION: Line selection modes always have targets (lines on board), don't check validTargets
    const lineSelectionModes = ['SELECT_LINE_START', 'SELECT_LINE_END', 'SELECT_LINE_FOR_EXPLOIT_SCORING', 'SELECT_LINE_FOR_SUPPORT_COUNTERS', 'SELECT_LINE_FOR_THREAT_COUNTERS', 'SELECT_DIAGONAL']
    const isLineSelectionMode = stepAction.mode && lineSelectionModes.includes(stepAction.mode)

    // EXCEPTION: CREATE_STACK with hand-only targets (Revealed status on opponent's face-down hand cards)
    // These actions don't have board targets, so we should NOT skip the step even if validTargets is empty
    const isHandTargetingCreateStack = stepAction.type === 'CREATE_STACK' &&
      stepAction.tokenType === 'Revealed' &&
      (stepAction.onlyOpponents || stepAction.payload?.onlyOpponents) &&
      (stepAction.onlyFaceDown || stepAction.payload?.onlyFaceDown)

    if (setTargetingMode && calculateValidTargets && !isLineSelectionMode && !isHandTargetingCreateStack) {
      // CRITICAL: Use getFreshGameState() to get the latest state including tokens just placed
      // This fixes Data Interception option 1 where SELECT_UNIT_FOR_MOVE needs to see
      // the Exploit counter placed in the previous CREATE_STACK step
      const freshGameState = getFreshGameState ? getFreshGameState() : gameState
      const validTargets = calculateValidTargets(stepAction, freshGameState, ownerId, commandContext)


      if (validTargets.length === 0) {
        // Clear targeting mode and skip to next step
        if (props.clearTargetingMode) {
          props.clearTargetingMode()
        }
        // CRITICAL: Pass nextStepIndex + 1 to avoid infinite loop!
        advanceToNextStepWithCoords(props, sourceCoords || { row: 0, col: 0 }, nextStepIndex + 1)
        return
      }

      // CRITICAL: Update commandContext with lastPlacedToken from stepContext BEFORE executing any action
      // This ensures Enhanced Interrogation and Overwatch Option 2 can count tokens just placed
      if (stepContext?.lastPlacedToken && props.setCommandContext) {
        props.setCommandContext(prev => {
          const updated = {
            ...prev,
            lastPlacedToken: stepContext.lastPlacedToken,
            sourceOwnerId: stepContext.sourceOwnerId,
          }
          return updated
        })
      }

      // CRITICAL: For CREATE_STACK actions, handleActionExecution will set targeting mode
      // This fixes False Orders Option 1 where setTargetingMode was called with wrong ownerId
      if (nextStep.action === "CREATE_STACK" && props.handleActionExecution) {
        // CRITICAL: Set abilityMode BEFORE handleActionExecution to prevent race condition
        setAbilityMode(stepAction)
        // Call handleActionExecution synchronously to ensure cursorStack is set before any useEffect runs
        props.handleActionExecution(stepAction, sourceCoords || { row: 0, col: 0 })
      } else if (nextStep.action === "GLOBAL_AUTO_APPLY" && props.handleActionExecution) {
        // CRITICAL: For GLOBAL_AUTO_APPLY actions (Overwatch Option 2), execute directly
        // These are auto-executed actions that don't require targeting mode
        setAbilityMode(stepAction)
        props.handleActionExecution(stepAction, sourceCoords || { row: 0, col: 0 })
      } else {
        // For non-CREATE_STACK actions, set targeting mode normally
        setTargetingMode(stepAction, ownerId, sourceCoords, validTargets, commandContext)
        // CRITICAL: Also set abilityMode so click handlers recognize the interaction
        // This fixes SELECT_UNIT_FOR_MOVE not working in AUTO_STEPS (Data Interception option 1)
        setAbilityMode(stepAction)
      }
    } else if (isLineSelectionMode || isHandTargetingCreateStack) {
      // CRITICAL: Line selection modes use abilityMode directly, NOT targetingMode!
      // GameBoard handles visual highlighting via isLineSelectionMode() check and abilityMode.payload.targetCoords
      // Use stepContext.lastMovedCardCoords or stepContext.targetCoords (synchronous), fallback to commandContext (async)
      void (stepContext?.lastMovedCardCoords || stepContext?.targetCoords || commandContext?.lastMovedCardCoords)

      // CRITICAL: For CREATE_STACK with hand targets, call handleActionExecution to create cursorStack
      // This ensures handleCreateStack is called which creates the cursorStack for hand card targeting
      if (isHandTargetingCreateStack && props.handleActionExecution) {
        // CRITICAL: Update commandContext with lastPlacedToken from stepContext
        // This ensures Enhanced Interrogation can count Aim tokens just placed in previous step
        if (stepContext?.lastPlacedToken && props.setCommandContext) {
          props.setCommandContext(prev => {
            const updated = {
              ...prev,
              lastPlacedToken: stepContext.lastPlacedToken,
              sourceOwnerId: stepContext.sourceOwnerId,
            }
            return updated
          })
        }
        // CRITICAL: Set abilityMode BEFORE handleActionExecution to prevent race condition
        setAbilityMode(stepAction)
        // Call handleActionExecution synchronously to ensure cursorStack is set before any useEffect runs
        props.handleActionExecution(stepAction, sourceCoords || { row: 0, col: 0 })
      }
    }
  }
}

/**
 * Handle SELECT_TARGET with various actionTypes
 */
function handleSelectTargetActionType(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, markAbilityUsed, setAbilityMode, moveItem, modifyBoardCardPower, addBoardCardStatus, removeBoardCardStatus, removeBoardCardStatusByOwner, removeStatusByType, resetDeployStatus, setCounterSelectionData, handleActionExecution, gameState, destroyCard, setCommandContext, updatePlayerScore, triggerFloatingText, clearTargetingMode, setActionQueue } = props
  const { payload, sourceCoords, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode!

  const actorId = abilityMode!.sourceCard?.ownerId ?? (gameState.players.find(p => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : props.localPlayerId || gameState.activePlayerId)

  // OPEN_COUNTER_MODAL
  if (payload.actionType === 'OPEN_COUNTER_MODAL') {
    // CRITICAL: payload.filter may be a string (e.g., "isOwner") instead of a function
    // Skip local filter check if filter is not a function - calculateValidTargets will handle it
    if (payload.filter && typeof payload.filter === 'function' && !payload.filter(card)) {
      return false
    }
    // CRITICAL: Pass AUTO_STEPS context so cleanup step can continue after modal confirmation
    // CRITICAL: currentStepIndex in payload points to the NEXT step, so we use currentStepIndex - 1
    // to get the CURRENT step that's being processed (OPEN_COUNTER_MODAL)
    const actualCurrentStepIndex = (payload._autoStepsContext?.currentStepIndex ?? 1) - 1
    setCounterSelectionData({
      card: card,
      callbackAction: payload.rewardType,
      autoStepsContext: payload._autoStepsContext ? {
        steps: payload._autoStepsContext.steps,
        currentStepIndex: actualCurrentStepIndex,
        abilityAction: abilityMode,
      } : undefined,
    })
    setAbilityMode(null)
    return true
  }

  // SACRIFICE_TARGET (Step 1 of Centurion's multi-step ability)
  // Sacrifices a card and stores its coordinates for the next step
  if (payload.actionType === 'SACRIFICE_TARGET') {
    // CRITICAL: payload.filter may be a string (e.g., "isOwner") instead of a function
    // Skip local filter check if filter is not a function - calculateValidTargets will handle it
    if (payload.filter && typeof payload.filter === 'function' && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Get the owner of the card being sacrificed
    const sacrificedOwnerId = card.ownerId
    // Get the source card owner (Centurion's owner) - this is whose allies get buffed
    const sourceOwnerId = abilityMode!.sourceCard?.ownerId ?? actorId ?? 0

    // Check for Shield - protect from sacrifice
    const hasShield = card.statuses?.some(s => s.type === 'Shield')
    if (hasShield) {
      // Remove Shield and stop - card is not sacrificed
      removeBoardCardStatus(boardCoords, 'Shield')
      // Mark ability as used since we consumed it
      markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    // Store the sacrificed card's coordinates AND the source owner BEFORE destroying
    // This will be used to buff lines in the BUFF_LINES_FROM_CONTEXT step
    const stepContext = {
      lastMovedCardCoords: boardCoords,
      sourceOwnerId: sourceOwnerId  // Owner of Centurion (whose allies get buffed)
    }
    setCommandContext({
      lastMovedCardCoords: boardCoords,
      lastMovedCardId: (sacrificedOwnerId ?? 0).toString(),
      sourceOwnerId: sourceOwnerId ?? undefined
    })

    // Destroy the card - sends to owner's discard and handles cleanup
    destroyCard(card, boardCoords)

    // Continue to next step in AUTO_STEPS
    const autoStepsContext = payload._autoStepsContext
    if (autoStepsContext && autoStepsContext.steps) {
      advanceToNextStepWithCoords(props, boardCoords, autoStepsContext.currentStepIndex, stepContext)
      return true
    }

    // Fallback: if not part of AUTO_STEPS, end the ability
    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // SCORE_POINTS (Unwavering Integrator Setup, etc.) - Score points for counters in a line
  if (payload.actionType === 'SCORE_POINTS') {
    if (payload.filter && typeof payload.filter === 'function' && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    const ownerId = sourceCard?.ownerId ?? actorId

    // Determine which line to score based on mode
    let selectedRow: number | null = null
    let selectedCol: number | null = null

    // LINE_TARGET: any card in the same row or column as source
    if (payload.mustBeInLineWithSource && sourceCoords) {
      if (boardCoords.row === sourceCoords.row || boardCoords.col === sourceCoords.col) {
        // Player clicked a card in the same row or column
        // Use the line that was clicked
        selectedRow = boardCoords.row
        selectedCol = boardCoords.col
      } else {
        // Invalid target - not in same row or column
        return false
      }
    } else {
      // Default: use the row of the clicked card
      selectedRow = boardCoords.row
    }

    // Count counters in the selected line
    let counterCount = 0
    const gridSize = gameState.board.length

    if (selectedRow !== null) {
      // Score entire row
      for (let c = 0; c < gridSize; c++) {
        const cell = gameState.board[selectedRow][c]
        if (cell.card && cell.card.statuses) {
          counterCount += cell.card.statuses.filter((s: any) =>
            s.type === payload.counterType || s.type === 'Exploit' && s.addedByPlayerId === ownerId
          ).length
        }
      }
    } else if (selectedCol !== null) {
      // Score entire column
      for (let r = 0; r < gridSize; r++) {
        const cell = gameState.board[r][selectedCol]
        if (cell.card && cell.card.statuses) {
          counterCount += cell.card.statuses.filter((s: any) =>
            s.type === payload.counterType || s.type === 'Exploit' && s.addedByPlayerId === ownerId
          ).length
        }
      }
    }

    // Calculate points (amount per counter)
    const points = counterCount * (payload.amount || 1)

    // Award points
    if (points > 0 && ownerId) {
      updatePlayerScore(ownerId, points)
      // Show floating text at the source card or clicked card
      triggerFloatingText({
        row: sourceCoords?.row || boardCoords.row,
        col: sourceCoords?.col || boardCoords.col,
        text: `+${points}`,
        playerId: ownerId,
      })
    }

    // Mark ability as used
    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // SACRIFICE_AND_BUFF_LINES (Centurion) - Legacy single-step version
  if (payload.actionType === 'SACRIFICE_AND_BUFF_LINES') {

    if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Get the owner of Centurion (the card performing the ability)
    const centurionOwnerId = abilityMode!.sourceCard?.ownerId ?? actorId

    // Sacrifice - send selected card to its owner's discard
    // IMPORTANT: playerId must be in item (first param) for MOVE_CARD_TO_DISCARD action
    moveItem({
      card,
      source: 'board',
      boardCoords,
      bypassOwnershipCheck: true,
      playerId: card.ownerId,
    }, {
      target: 'discard',
      playerId: card.ownerId,
    })

    // Buff allies in Centurion's row and column (not the sacrificed card's position)
    // "Allied" here means cards owned by the same player as Centurion
    const gridSize = gameState.board.length
    // Use Centurion's coordinates (sourceCoords), not the sacrificed card's coordinates
    const { row: r1, col: c1 } = sourceCoords || boardCoords

    let buffedCount = 0

    // Buff all cards in the same row (except Centurion itself)
    for (let c = 0; c < gridSize; c++) {
      const cell = gameState.board[r1][c]
      const targetCard = cell.card
      if (targetCard) {
        if (targetCard.ownerId === centurionOwnerId) {
          modifyBoardCardPower({ row: r1, col: c }, 1)
          buffedCount++
        }
      }
    }

    // Buff all cards in the same column (except Centurion itself which was already buffed)
    for (let r = 0; r < gridSize; r++) {
      if (r === r1) {continue} // Skip the row we already processed
      const cell = gameState.board[r][c1]
      const targetCard = cell.card
      if (targetCard) {
        if (targetCard.ownerId === centurionOwnerId) {
          modifyBoardCardPower({ row: r, col: c1 }, 1)
          buffedCount++
        }
      }
    }


    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // SHIELD_AND_REMOVE_AIM (Temporary Shelter)
  if (payload.actionType === 'SHIELD_AND_REMOVE_AIM') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }
    addBoardCardStatus(boardCoords, 'Shield', actorId!)
    removeStatusByType(boardCoords, 'Aim')
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // RESET_DEPLOY (Experimental Stimulants)
  if (payload.actionType === 'RESET_DEPLOY') {
    // CRITICAL: payload.filter may be a string (e.g., "hasType_Unit_and_not_Device") instead of a function
    // Skip local filter check if filter is not a function - calculateValidTargets will handle it
    if (payload.filter && typeof payload.filter === 'function' && !payload.filter(card)) {
      return false
    }
    resetDeployStatus(boardCoords)

    // CRITICAL: If in AUTO_STEPS context, continue to CLEANUP_COMMAND
    // This ensures the command card is discarded after the action completes
    if (payload?._autoStepsContext && setActionQueue) {
      const autoStepsContext = { ...payload._autoStepsContext }
      const continueAction: any = {
        type: 'CONTINUE_AUTO_STEPS',
        sourceCard: abilityMode.sourceCard,
        sourceCoords: abilityMode.sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: abilityMode.readyStatusToRemove,
        payload: {
          _autoStepsContext: autoStepsContext,
          stepContext: {
            targetCoords: boardCoords,
            targetCardId: card.id
          }
        }
      }

      setActionQueue(prev => {
        const cleanupActions = prev.filter(a => a.payload?.cleanupCommand)
        const otherActions = prev.filter(a => !a.payload?.cleanupCommand)
        return [...otherActions, continueAction, ...cleanupActions]
      })
    }

    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // DESTROY
  if (payload.actionType === 'DESTROY') {
    // Check filter - may be a string (e.g., "isOwner") or function
    if (payload.filter && typeof payload.filter === 'function' && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Check for Shield - unless ignored by ability (e.g., Centurion Commit)
    if (!payload.ignoreShield) {
      const hasShield = card.statuses?.some(s => s.type === 'Shield')
      if (hasShield) {
        // Shield protects the card - remove Shield and stop
        removeBoardCardStatus(boardCoords, 'Shield')
        markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
        setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
        return true
      }
    }

    // Store coordinates for potential AUTO_STEPS continuation (Centurion Commit)
    let stepContext: { lastMovedCardCoords: { row: number; col: number }; sourceOwnerId: number } | undefined
    if (payload.recordContext) {
      const sourceOwnerId = abilityMode!.sourceCard?.ownerId ?? actorId ?? 0
      stepContext = {
        lastMovedCardCoords: boardCoords,
        sourceOwnerId: sourceOwnerId
      }
      setCommandContext({
        lastMovedCardCoords: boardCoords,
        lastMovedCardId: (card.ownerId ?? 0).toString(),
        sourceOwnerId: sourceOwnerId ?? undefined
      })
    }

    // No Shield - destroy the card (send to discard)
    // destroyCard removes Aim token (consumed by ability) and sends card to owner's discard in one atomic operation
    destroyCard(card, boardCoords)

    // Check for AUTO_STEPS continuation
    const autoStepsContext = payload._autoStepsContext
    if (autoStepsContext && autoStepsContext.steps) {
      advanceToNextStepWithCoords(props, boardCoords, autoStepsContext.currentStepIndex, stepContext)
      return true
    }

    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // MODIFY_POWER (Walking Turret Setup, etc.)
  if (payload.actionType === 'MODIFY_POWER') {
    if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Apply power modification
    modifyBoardCardPower(boardCoords, payload.amount || 0)

    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // LUCIUS_SETUP
  if (payload.actionType === 'LUCIUS_SETUP') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }
    moveItem({
      card,
      source: 'board',
      boardCoords,
    }, {
      target: 'discard',
      playerId: card.ownerId,
    })
    if (payload.chainedAction) {
      handleActionExecution(payload.chainedAction, boardCoords)
    }
    return true
  }

  // CENSOR_SWAP (Censor Commit)
  if (payload.actionType === 'CENSOR_SWAP') {
    if (payload.filter && !payload.filter(card)) {
      return false
    }

    // Remove 1 Exploit, add 2 Stun
    const exploitCount = card.statuses?.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
    if (exploitCount > 0) {
      // Remove exactly 1 Exploit token
      removeBoardCardStatusByOwner(boardCoords, 'Exploit', actorId!)
      // Add exactly 2 Stun tokens
      addBoardCardStatus(boardCoords, 'Stun', actorId!)
      addBoardCardStatus(boardCoords, 'Stun', actorId!)
    }

    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // REVEAL_ENEMY_CHAINED (Recon Drone Commit)
  if (payload.actionType === 'REVEAL_ENEMY_CHAINED') {
    if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
      return false
    }

    // Get the target opponent's ID from the selected card
    const targetOpponentId = card.ownerId

    // Execute the chained action (CREATE_STACK for Revealed token)
    // with targetOwnerId set to the selected card's owner
    // IMPORTANT: Pass sourceCard to ensure correct token ownership
    if (abilityMode?.chainedAction) {
      const chainedAction: AbilityAction = {
        type: abilityMode.chainedAction.type || 'CREATE_STACK',
        tokenType: abilityMode.chainedAction.tokenType || 'Revealed',
        count: abilityMode.chainedAction.count || 1,
        targetOwnerId: targetOpponentId,
        sourceCoords: sourceCoords || boardCoords,
        sourceCard: abilityMode.sourceCard, // Pass the source card (Recon Drone) for token ownership
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        // CRITICAL: Revealed token should only apply to face-down cards on the battlefield
        // Face-up cards are already revealed, so they shouldn't be valid targets
        onlyFaceDown: true,
      }
      // CRITICAL: Clear board targeting mode BEFORE handleActionExecution
      // This clears the board card highlights, then handleCreateStack will set hand card highlights
      // Order is important: we don't want to clear the hand targeting that handleCreateStack sets
      clearTargetingMode()
      handleActionExecution(chainedAction, boardCoords)
      // CRITICAL: Mark ability as used immediately after chained action executes
      // This removes the readyCommit status so the card can't be activated again
      markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
      // CRITICAL: Clear abilityMode immediately after chained action
      // The cursorStack will handle the hand targeting phase
      // Keeping abilityMode active was causing the board targeting to re-appear after token placement
      setAbilityMode(null)
      return true
    }

    // No chained action - mark ability as used and clear mode
    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // PUSH (Reclaimed Gawain Deploy - step 2 of AUTO_STEPS)
  // Push an adjacent opponent card 1 cell away, then optionally move into its former cell
  if (payload.actionType === 'PUSH') {
    const { sourceCard } = abilityMode!
    const ownerId = sourceCard?.ownerId ?? actorId ?? 0

    // Validate target: must be adjacent opponent
    const isAdj = Math.abs(boardCoords.row - (sourceCoords?.row ?? 0)) + Math.abs(boardCoords.col - (sourceCoords?.col ?? 0)) === 1
    const targetPlayer = gameState.players.find(p => p.id === card.ownerId)
    const actorPlayer = gameState.players.find(p => p.id === ownerId)
    // CRITICAL: Check for both undefined AND null
    const isTeammate = (targetPlayer?.teamId !== null && targetPlayer?.teamId !== undefined) && (actorPlayer?.teamId !== null && actorPlayer?.teamId !== undefined) && targetPlayer.teamId === actorPlayer.teamId

    if (!isAdj || card.ownerId === ownerId || isTeammate) {
      return false
    }

    // Calculate push direction and target cell
    const dRow = boardCoords.row - (sourceCoords?.row ?? 0)
    const dCol = boardCoords.col - (sourceCoords?.col ?? 0)
    const targetRow = boardCoords.row + dRow
    const targetCol = boardCoords.col + dCol

    // Check boundaries
    const gridSize = gameState.board.length
    const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
    const minBound = offset
    const maxBound = offset + gameState.activeGridSize - 1

    if (targetRow < minBound || targetRow > maxBound || targetCol < minBound || targetCol > maxBound) {
      return false
    }

    // Check if target cell is empty
    if (gameState.board[targetRow][targetCol].card !== null) {
      return false
    }

    // Perform the push
    const vacatedCoords = boardCoords

    // Continue to next step or finish ability
    const autoStepsContext = payload._autoStepsContext
    if (autoStepsContext && autoStepsContext.steps) {
      // For auto-steps, set ability mode to null BEFORE moveItem
      advanceToNextStepWithCoords(props, boardCoords, autoStepsContext.currentStepIndex)
      moveItem({ card, source: 'board', boardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords: { row: targetRow, col: targetCol } })
      return true
    }

    // No more steps - finish ability with PUSH_MOVE mode (may move into vacated cell)
    const safeSourceCoords = sourceCoords || { row: 0, col: 0 }
    const pushMoveTargets: {row: number, col: number}[] = [
      safeSourceCoords,  // Stay in place
      vacatedCoords  // Move into vacated cell
    ]

    const pushMoveAction: AbilityAction = {
      type: 'ENTER_MODE',
      mode: 'PUSH_MOVE',
      sourceCard,
      sourceCoords: safeSourceCoords,
      isDeployAbility,
      readyStatusToRemove,
      payload: { vacatedCoords }
    }

    // CRITICAL: Set ability mode BEFORE calling moveItem
    // This prevents useEffect in App.tsx from clearing targeting mode prematurely
    setAbilityMode(pushMoveAction)

    // Set up targeting mode for PUSH_MOVE
    if (props.setTargetingMode) {
      props.setTargetingMode(pushMoveAction, ownerId, safeSourceCoords, pushMoveTargets)
    }

    // Perform the push AFTER setting ability mode
    moveItem({ card, source: 'board', boardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords: { row: targetRow, col: targetCol } })

    return true
  }

  return false
}

/**
 * Handle PUSH mode
 */
function handlePush(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, setAbilityMode, moveItem, markAbilityUsed, interactionLock, setTargetingMode } = props

  if (interactionLock.current) {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode!

  if (!sourceCoords || sourceCoords.row < 0) {
    return false
  }

  // Allow self-click to skip/finish
  if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  const targetPlayer = gameState.players.find(p => p.id === card.ownerId)
  const actorPlayer = gameState.players.find(p => p.id === sourceCard?.ownerId)
  // CRITICAL: Check for both undefined AND null
  // If teamId is not set (undefined/null), player is in FFA mode - no teammates
  const isTeammate = (targetPlayer?.teamId !== null && targetPlayer?.teamId !== undefined) && (actorPlayer?.teamId !== null && actorPlayer?.teamId !== undefined) && targetPlayer.teamId === actorPlayer.teamId

  if (!isAdj || card.ownerId === sourceCard?.ownerId || isTeammate) {
    return false
  }

  const dRow = boardCoords.row - sourceCoords.row
  const dCol = boardCoords.col - sourceCoords.col
  const targetRow = boardCoords.row + dRow
  const targetCol = boardCoords.col + dCol

  // Calculate visible grid boundaries
  const gridSize = gameState.board.length
  const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
  const minBound = offset
  const maxBound = offset + gameState.activeGridSize - 1

  if (targetRow < minBound || targetRow > maxBound || targetCol < minBound || targetCol > maxBound) {
    return false
  }

  if (gameState.board[targetRow][targetCol].card !== null) {
    return false
  }

  // vacatedCoords is the cell where the pushed card was (before being pushed)
  const vacatedCoords = boardCoords

  // Calculate valid targets for PUSH_MOVE
  // Valid targets: sourceCoords (stay in place), vacatedCoords, and cells between them
  const pushMoveTargets: {row: number, col: number}[] = []

  // 1. Source coords (stay in place)
  pushMoveTargets.push(sourceCoords)

  // 2. Vacated coords
  pushMoveTargets.push(vacatedCoords)

  // 3. Intermediate cells (if source and vacated are more than 1 cell apart)
  if (sourceCoords.row === vacatedCoords.row) {
    // Same row - add intermediate columns
    const minCol = Math.min(sourceCoords.col, vacatedCoords.col)
    const maxCol = Math.max(sourceCoords.col, vacatedCoords.col)
    for (let c = minCol + 1; c < maxCol; c++) {
      // Only add if cell is empty
      if (gameState.board[sourceCoords.row][c].card === null) {
        pushMoveTargets.push({ row: sourceCoords.row, col: c })
      }
    }
  } else if (sourceCoords.col === vacatedCoords.col) {
    // Same column - add intermediate rows
    const minRow = Math.min(sourceCoords.row, vacatedCoords.row)
    const maxRow = Math.max(sourceCoords.row, vacatedCoords.row)
    for (let r = minRow + 1; r < maxRow; r++) {
      // Only add if cell is empty
      if (gameState.board[r][sourceCoords.col].card === null) {
        pushMoveTargets.push({ row: r, col: sourceCoords.col })
      }
    }
  }

  const pushMoveAction: AbilityAction = {
    type: 'ENTER_MODE',
    mode: 'PUSH_MOVE',
    sourceCard,
    sourceCoords,
    isDeployAbility,
    payload: { vacatedCoords }
  }

  // CRITICAL: Set ability mode BEFORE calling moveItem
  // This prevents useEffect in App.tsx from clearing targeting mode prematurely
  setAbilityMode(pushMoveAction)

  // Set up targeting mode for PUSH_MOVE
  const ownerId = sourceCard?.ownerId ?? 0
  if (setTargetingMode) {
    setTargetingMode(pushMoveAction, ownerId, sourceCoords, pushMoveTargets)
  }

  // Perform the push AFTER setting ability mode
  moveItem({ card, source: 'board', boardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords: { row: targetRow, col: targetCol } })

  return true
}

/**
 * Handle PUSH_MOVE mode (after push)
 * Options:
 * 1. Click on sourceCoords (pusher's cell) → stay in place
 * 2. Click on vacated cell (where pushed card was) → move there
 * 3. Click on intermediate cells (between source and vacated) → move there
 * 4. Click elsewhere → cancel (finish ability)
 */
function handlePushMove(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, moveItem, markAbilityUsed, setAbilityMode, clearTargetingMode } = props

  if (!abilityMode || abilityMode.mode !== 'PUSH_MOVE') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

  if (!sourceCoords || !sourceCard || !payload?.vacatedCoords) {
    return false
  }

  // Option 1: Stay in place (click on sourceCoords)
  if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
    // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
    // This prevents useEffect in App.tsx from re-setting targeting mode
    setAbilityMode(null)
    clearTargetingMode()
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    return true
  }

  // Option 2: Move to vacated cell (where the pushed card was)
  if (boardCoords.row === payload.vacatedCoords.row && boardCoords.col === payload.vacatedCoords.col) {
    // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
    // This prevents useEffect in App.tsx from re-setting targeting mode
    setAbilityMode(null)
    clearTargetingMode()
    moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
    markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
    return true
  }

  // Option 3: Move to intermediate cells (between source and vacated)
  // Check if source, vacated, and clicked are in a line (row or column)
  const sameRow = sourceCoords.row === payload.vacatedCoords.row && payload.vacatedCoords.row === boardCoords.row
  const sameCol = sourceCoords.col === payload.vacatedCoords.col && payload.vacatedCoords.col === boardCoords.col

  if (sameRow) {
    const minCol = Math.min(sourceCoords.col, payload.vacatedCoords.col)
    const maxCol = Math.max(sourceCoords.col, payload.vacatedCoords.col)
    if (boardCoords.col > minCol && boardCoords.col < maxCol) {
      // Intermediate cell in the same row
      // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
      // This prevents useEffect in App.tsx from re-setting targeting mode
      setAbilityMode(null)
      clearTargetingMode()
      moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
      markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
      return true
    }
  } else if (sameCol) {
    const minRow = Math.min(sourceCoords.row, payload.vacatedCoords.row)
    const maxRow = Math.max(sourceCoords.row, payload.vacatedCoords.row)
    if (boardCoords.row > minRow && boardCoords.row < maxRow) {
      // Intermediate cell in the same column
      // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
      // This prevents useEffect in App.tsx from re-setting targeting mode
      setAbilityMode(null)
      clearTargetingMode()
      moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
      markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
      return true
    }
  }

  // Option 4: If clicked elsewhere, cancel (finish ability)
  clearTargetingMode()
  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
  setAbilityMode(null)
  return true
}

/**
 * Handle SHIELD_SELF_THEN_PUSH (Reclaimed Gawain Deploy)
 * 1. Add Shield status to self (if not already added)
 * 2. Transition to PUSH mode or perform push directly
 *
 * IMPORTANT: If shieldApplied is true in payload, Shield was already added.
 * In that case:
 * - Self-click → cancel mode and mark ability as used (skip push)
 * - Adjacent opponent click → do push directly
 */
function handleShieldSelfThenPush(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, setAbilityMode, addBoardCardStatus, markAbilityUsed, interactionLock, setTargetingMode, commandContext, moveItem, updateState } = props

  if (interactionLock.current) {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove, sourceCard, payload } = abilityMode!

  if (!sourceCoords || sourceCoords.row < 0 || !sourceCard) {
    return false
  }

  const ownerId = sourceCard.ownerId!
  const shieldAlreadyApplied = payload?.shieldApplied === true

  // CRITICAL: Shield is already added in actionExecutionHandler.ts
  // Gawain is NOT a valid target for this ability - only adjacent opponents are valid
  // This function should only handle push logic for adjacent opponent cards

  // Handle push logic for adjacent opponent cards
  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  const targetPlayer = gameState.players.find(p => p.id === card.ownerId)
  const actorPlayer = gameState.players.find(p => p.id === ownerId)
  // CRITICAL: Check for both undefined AND null
  const isTeammate = (targetPlayer?.teamId !== null && targetPlayer?.teamId !== undefined) && (actorPlayer?.teamId !== null && actorPlayer?.teamId !== undefined) && targetPlayer.teamId === actorPlayer.teamId

  if (isAdj && card.ownerId !== ownerId && !isTeammate) {
    const dRow = boardCoords.row - sourceCoords.row
    const dCol = boardCoords.col - sourceCoords.col
    const targetRow = boardCoords.row + dRow
    const targetCol = boardCoords.col + dCol

    // Calculate visible grid boundaries
    const gridSize = gameState.board.length
    const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
    const minBound = offset
    const maxBound = offset + gameState.activeGridSize - 1

    if (targetRow < minBound || targetRow > maxBound || targetCol < minBound || targetCol > maxBound) {
      return false
    }

    if (gameState.board[targetRow][targetCol].card !== null) {
      return false
    }

    // Calculate valid targets for PUSH_MOVE (like handlePush does)
    // Valid targets: sourceCoords (stay in place), vacatedCoords, and cells between them
    const vacatedCoords = boardCoords
    const pushMoveTargets: {row: number, col: number}[] = []

    // 1. Source coords (stay in place)
    pushMoveTargets.push(sourceCoords)

    // 2. Vacated coords
    pushMoveTargets.push(vacatedCoords)

    // 3. Intermediate cells (if source and vacated are more than 1 cell apart)
    if (sourceCoords.row === vacatedCoords.row) {
      // Same row - add intermediate columns
      const minCol = Math.min(sourceCoords.col, vacatedCoords.col)
      const maxCol = Math.max(sourceCoords.col, vacatedCoords.col)
      for (let c = minCol + 1; c < maxCol; c++) {
        if (gameState.board[sourceCoords.row][c].card === null) {
          pushMoveTargets.push({ row: sourceCoords.row, col: c })
        }
      }
    } else if (sourceCoords.col === vacatedCoords.col) {
      // Same column - add intermediate rows
      const minRow = Math.min(sourceCoords.row, vacatedCoords.row)
      const maxRow = Math.max(sourceCoords.row, vacatedCoords.row)
      for (let r = minRow + 1; r < maxRow; r++) {
        if (gameState.board[r][sourceCoords.col].card === null) {
          pushMoveTargets.push({ row: r, col: sourceCoords.col })
        }
      }
    }

    const pushMoveAction: AbilityAction = {
      type: 'ENTER_MODE',
      mode: 'PUSH_MOVE',
      sourceCard,
      sourceCoords,
      isDeployAbility,
      readyStatusToRemove,
      payload: { vacatedCoords }
    }

    // CRITICAL: Use flushSync to ensure all state updates happen synchronously
    // This prevents useEffect in App.tsx from clearing targeting mode prematurely
    flushSync(() => {
      // Set ability mode to PUSH_MOVE first
      setAbilityMode(pushMoveAction)

      // Set up targeting mode for PUSH_MOVE with valid targets
      if (setTargetingMode) {
        setTargetingMode(pushMoveAction, ownerId, sourceCoords, pushMoveTargets)
      }
    })

    // Perform the push AFTER setting ability mode and targeting mode
    moveItem({ card, source: 'board', boardCoords, bypassOwnershipCheck: true }, { target: 'board', boardCoords: { row: targetRow, col: targetCol } })
    return true
  }

  return false
}

/**
 * Handle SWAP_POSITIONS (Reckless Provocateur Deploy)
 */
function handleSwapPositions(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, swapCards, markAbilityUsed, setAbilityMode, validTargets } = props

  if (!abilityMode || abilityMode.mode !== 'SWAP_POSITIONS') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

  if (!sourceCoords || sourceCoords.row < 0) {
    return false
  }

  const actualSourceCard = gameState.board[sourceCoords.row][sourceCoords.col].card
  if (!actualSourceCard || actualSourceCard.id !== sourceCard?.id) {
    setAbilityMode(null)
    return false
  }

  if (sourceCard && sourceCard.id === card.id) {
    return false
  }

  if (payload.filter && !payload.filter(card, boardCoords.row, boardCoords.col)) {
    return false
  }

  if (!payload.filter && validTargets) {
    const isValidTarget = validTargets.some(t => t.row === boardCoords.row && t.col === boardCoords.col)
    if (!isValidTarget) {
      return false
    }
  }

  // IMPORTANT: Mark the SOURCE card's ability as used BEFORE swapping
  // boardCoords is the target, sourceCoords is where Reckless Provocateur (or whichever card has the ability) is
  // We MUST do this BEFORE swapCards because after the swap, sourceCoords will point to a different card!
  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)

  // Swap positions using the dedicated swap function
  swapCards(sourceCoords, boardCoords)

  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle TRANSFER_STATUS_SELECT (Reckless Provocateur Commit)
 */
function handleTransferStatus(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, transferAllStatusesWithoutException, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || (abilityMode.mode !== 'TRANSFER_STATUS_SELECT' && abilityMode.mode !== 'TRANSFER_ALL_STATUSES')) {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

  if (!sourceCoords || sourceCoords.row < 0) {
    return false
  }

  if (sourceCard && sourceCard.id === card.id) {
    return false
  }

  // Check filter if provided (for TRANSFER_ALL_STATUSES - only owner's cards with specific tokens)
  if (payload?.filter && !payload.filter(card)) {
    return false
  }

  // For TRANSFER_ALL_STATUSES, card must have at least one of the specific tokens
  if (abilityMode.mode === 'TRANSFER_ALL_STATUSES') {
    if (!card.statuses || card.statuses.length === 0) {
      return false
    }
    const validTokens = ['Aim', 'Exploit', 'Rule', 'Shield', 'Stun', 'Revealed']
    if (!card.statuses.some(s => validTokens.includes(s.type))) {
      return false
    }
  }

  // Transfer ALL statuses from source card to target card (for TRANSFER_ALL_STATUSES)
  // Reckless Provocateur Commit: Move tokens FROM chosen allied card TO Reckless Provocateur
  // Note: transferAllStatusesWithoutException(fromCoords, toCoords) - from source to target
  if (abilityMode.mode === 'TRANSFER_ALL_STATUSES') {
    // boardCoords = chosen allied card (source of tokens), sourceCoords = Reckless Provocateur (destination)
    transferAllStatusesWithoutException(boardCoords, sourceCoords)
  } else {
    // For TRANSFER_STATUS_SELECT, legacy behavior - transfer one status
    // This is handled elsewhere
  }

  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle ZEALOUS_WEAKEN (Zealous Missionary Commit)
 */
function handleZealousWeaken(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, modifyBoardCardPower, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'ZEALOUS_WEAKEN') {
    return false
  }

  const { payload, sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  if (payload.filter && !payload.filter(card)) {
    return false
  }

  modifyBoardCardPower(boardCoords, -1)
  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle REVEREND_DOUBLE_EXPLOIT
 */
function handleReverendDoubleExploit(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, addBoardCardStatus, markAbilityUsed, triggerFloatingText, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'REVEREND_DOUBLE_EXPLOIT') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode
  const ownerId = sourceCard?.ownerId || 0
  const exploitCount = (card.statuses || []).filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length

  if (exploitCount > 0) {
    // CRITICAL FIX: Use single call with count parameter instead of loop
    // This prevents race conditions for guest players where each addBoardCardStatus
    // call sends a separate message that may be processed out of order
    addBoardCardStatus(boardCoords, 'Exploit', ownerId, exploitCount)

    triggerFloatingText({
      row: boardCoords.row,
      col: boardCoords.col,
      text: `+${exploitCount}`,
      playerId: ownerId,
    })
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SELECT_UNIT_FOR_MOVE (Code Keeper/Signal Prophet Commit, Finn Setup, Data Interception Option 1)
 *
 * CRITICAL FIX: Uses getFreshGameState() to get the latest card state including tokens
 * added in previous steps of multi-step commands (e.g., Exploit from Data Interception main action)
 */
function handleSelectUnitForMove(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, setAbilityMode, setTargetingMode, clearTargetingMode, gameState, getFreshGameState, localPlayerId, commandContext, calculateValidTargets, triggerNoTarget, handleActionExecution, setActionQueue } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_UNIT_FOR_MOVE') {
    return false
  }

  const { sourceCard, payload, isDeployAbility, readyStatusToRemove, originalOwnerId, chainedAction: directChainedAction } = abilityMode

  // CRITICAL: For command cards like Tactical Maneuver, chainedAction is in payload.chainedAction
  // For other abilities, it might be at the top level. Check both.
  const actualChainedAction = directChainedAction || payload?.chainedAction

  if (sourceCard && sourceCard.id === card.id) {
    return false
  }

  // CRITICAL FIX: Use getFreshGameState() to get the latest card state
  // This fixes Data Interception Option 1 where filter checks for Exploit tokens
  // added in the previous step (CREATE_STACK) which may not be in React state yet
  const freshState = getFreshGameState ? getFreshGameState() : gameState
  const freshCard = freshState.board[boardCoords.row][boardCoords.col].card

  // CRITICAL: Check if payload.filter is actually a function before calling it
  // It might be an array or other type after serialization
  if (payload.filter && typeof payload.filter === 'function') {
    if (!payload.filter(freshCard || card, boardCoords.row, boardCoords.col)) {
      return false
    }
  }


  // Use freshCard if available, otherwise fall back to card parameter
  const cardToUse = freshCard || card

  // CRITICAL: Remember the selected card's power at selection time for context rewards
  // This is more reliable than searching for the card later (Tactical Maneuver draw/score)
  const selectedCardPower = Math.max(0, cardToUse.power + (cardToUse.powerModifier || 0) + (cardToUse.bonusPower || 0))

  // CRITICAL: Clear targeting mode before setting new one to prevent stale highlights
  // This fixes the issue where targeting mode from SELECT_UNIT_FOR_MOVE persisted
  clearTargetingMode()

  // CRITICAL: Check if there are valid move targets for the selected card BEFORE transitioning to SELECT_CELL
  // This fixes Enhanced Interrogation option 2 where selecting a card that can't move should show "no target"
  // and complete the command card instead of getting stuck in SELECT_CELL mode with no valid targets
  if (calculateValidTargets) {
    // Build a temporary SELECT_CELL action to check valid targets
    const tempSelectCellAction: AbilityAction = {
      type: 'ENTER_MODE',
      mode: 'SELECT_CELL',
      sourceCard: cardToUse,
      sourceCoords: boardCoords,
      payload: {
        range: payload.range || 2,
        moveFromHand: payload.moveFromHand || false,
        selectedCard: cardToUse,
        allowSelf: false,
      }
    }

    const actorId = originalOwnerId ?? localPlayerId ?? 0
    const moveTargets = calculateValidTargets(tempSelectCellAction, freshState, actorId, commandContext)

    if (moveTargets.length === 0) {
      // No valid move targets - show "no target" effect and complete the command
      triggerNoTarget(boardCoords)

      // If in AUTO_STEPS context, continue to CLEANUP_COMMAND
      const autoStepsContext = abilityMode.payload?._autoStepsContext
      if (autoStepsContext && setActionQueue) {
        const continueAction: AbilityAction = {
          type: 'CONTINUE_AUTO_STEPS',
          sourceCard: abilityMode.sourceCard,
          sourceCoords: abilityMode.sourceCoords,
          isDeployAbility: abilityMode.isDeployAbility,
          readyStatusToRemove: abilityMode.readyStatusToRemove,
          payload: {
            _autoStepsContext: { ...autoStepsContext },
            stepContext: {
              targetCoords: boardCoords,
              targetCardId: card.id
            }
          }
        }
        setActionQueue(prev => [...prev, continueAction])
      }

      // Clear ability mode
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }
  }

  // Transition to SELECT_CELL mode
  // CRITICAL: Preserve chainedAction and originalOwnerId for reward (draw/score) after move
  // CRITICAL FIX: Normalize chainedAction from JSON format (action/details) to AbilityAction format (type/payload)
  const normalizedChainedAction = normalizeChainedAction(actualChainedAction)

  // CRITICAL: Store the selected card's power in chainedAction payload for context rewards
  // This ensures we use the correct power value even if the card moves or state changes
  // CRITICAL FIX: Handle case where normalizedChainedAction is undefined (Data Interception option 2 has no chainedAction)
  const baseChainedAction = normalizedChainedAction || {}
  const enrichedChainedAction = normalizedChainedAction ? {
    ...baseChainedAction,
    sourceCard: abilityMode.sourceCard, // CRITICAL: Pass command card sourceCard for cleanup
    sourceCoords: abilityMode.sourceCoords, // CRITICAL: Pass command card sourceCoords for cleanup
    originalOwnerId, // CRITICAL: Pass command card owner for reward attribution
    isDeployAbility: abilityMode.isDeployAbility,
    readyStatusToRemove: abilityMode.readyStatusToRemove,
    payload: {
      ...(baseChainedAction.payload || {}),
      contextCardPower: selectedCardPower,
      // CRITICAL: Pass _autoStepsContext so handleContextReward can continue to CLEANUP_COMMAND
      _autoStepsContext: abilityMode.payload?._autoStepsContext,
    }
  } : undefined

  // CRITICAL: Build newMode with conditional chainedAction (only if it exists)
  const newMode: any = {
    type: 'ENTER_MODE',
    mode: 'SELECT_CELL',
    sourceCard: cardToUse,
    sourceCoords: boardCoords,
    isDeployAbility,
    readyStatusToRemove,
    originalOwnerId, // Preserve command card owner for proper reward attribution
    ...(enrichedChainedAction ? { chainedAction: enrichedChainedAction } : {}), // CRITICAL: Only add chainedAction if it exists
    payload: {
      range: payload.range || 2,
      moveFromHand: payload.moveFromHand || false,
      selectedCard: cardToUse,
      allowSelf: false,
      useContextCard: !!enrichedChainedAction, // Only use context card if we have a chained action
      recordContext: !!enrichedChainedAction, // Only record context if we have a chained action (Tactical Maneuver)
      // CRITICAL: Pass _autoStepsContext so it's available in handleSelectCell for cleanup
      _autoStepsContext: abilityMode.payload?._autoStepsContext,
    },
  }

  setAbilityMode(newMode)

  // Calculate valid targets and set targeting mode for visual highlights
  // CRITICAL: Use freshState for calculateValidTargets to get accurate targets
  // CRITICAL: Use originalOwnerId (command card owner) for BOTH target calculation AND highlight color
  // This fixes Data Interception option 1 where highlight color changed to selected card's owner
  const actorId = originalOwnerId ?? localPlayerId ?? 0
  if (calculateValidTargets) {
    const targets = calculateValidTargets(newMode, freshState, actorId, commandContext)
    setTargetingMode(newMode, actorId, boardCoords, targets, commandContext)
  } else {
    setTargetingMode(newMode, actorId, boardCoords, undefined, commandContext)
  }

  return true
}

/**
 * Handle PATROL_MOVE (Patrol Agent Setup, Edith Byron Setup)
 */
function handlePatrolMove(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, moveItem, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'PATROL_MOVE') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

  if (!sourceCoords || !sourceCard) {
    return false
  }

  // Same cell = cancel
  if (boardCoords.row === sourceCoords.row && boardCoords.col === sourceCoords.col) {
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // Check if in same row or column
  const sameRow = boardCoords.row === sourceCoords.row
  const sameCol = boardCoords.col === sourceCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Check if cell is empty
  if (gameState.board[boardCoords.row][boardCoords.col].card !== null) {
    return false
  }

  moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords }, { target: 'board', boardCoords })
  markAbilityUsed(boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SPAWN_TOKEN (Inventive Maker Deploy, Edith Byron Deploy)
 */
function handleSpawnToken(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, spawnToken, markAbilityUsed, setAbilityMode, clearTargetingMode } = props

  if (!abilityMode || abilityMode.mode !== 'SPAWN_TOKEN') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode

  if (!sourceCoords || !payload?.tokenName) {
    return false
  }

  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  if (!isAdj) {
    return false
  }

  const tokenOwnerId = sourceCard?.ownerId ?? abilityMode.sourceCard?.ownerId
  spawnToken(boardCoords, payload.tokenName, tokenOwnerId!)
  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
  // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
  // This prevents useEffect in App.tsx from re-setting targeting mode
  setAbilityMode(null)
  clearTargetingMode()
  return true
}

/**
 * Handle SWAP_ADJACENT (Swap positions with adjacent card)
 */
function handleSwapAdjacent(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, swapCards, setAbilityMode } = props


  if (!abilityMode || abilityMode.mode !== 'SWAP_ADJACENT') {
    return false
  }

  const { sourceCoords, sourceCard } = abilityMode

  if (!sourceCoords || sourceCoords.row < 0) {
    return false
  }

  const actualSourceCard = gameState.board[sourceCoords.row][sourceCoords.col].card
  if (!actualSourceCard || actualSourceCard.id !== sourceCard?.id) {
    setAbilityMode(null)
    return false
  }

  // Don't swap with self
  if (sourceCard && sourceCard.id === card.id) {
    return false
  }

  // Check if target is adjacent
  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  if (!isAdj) {
    return false
  }

  // Check if target is valid (has a card)
  if (!card || !gameState.board[boardCoords.row][boardCoords.col].card) {
    return false
  }

  // Use gameState.targetingMode.boardTargets for validation (not validTargets prop)
  const targetingModeTargets = gameState.targetingMode?.boardTargets
  if (targetingModeTargets && targetingModeTargets.length > 0) {
    const isValidTarget = targetingModeTargets.some(t => t.row === boardCoords.row && t.col === boardCoords.col)
    if (!isValidTarget) {
      return false
    }
  }


  // Swap positions
  swapCards(sourceCoords, boardCoords)

  // NOTE: markAbilityUsed is already called in activateAbility when entering this mode
  // We don't call it again here because after swapCards, sourceCoords points to a different card!
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle PLACE_TOKEN (Modal token placement from CREATE_TOKEN action)
 */
function handlePlaceToken(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, spawnToken, markAbilityUsed, setAbilityMode, clearTargetingMode } = props

  if (!abilityMode || abilityMode.mode !== 'PLACE_TOKEN') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode

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

  // Check if this is part of AUTO_STEPS
  const autoStepsContext = payload._autoStepsContext
  if (autoStepsContext && autoStepsContext.steps) {
    // Continue to next step instead of marking ability as used
    advanceToNextStepWithCoords(props, boardCoords, autoStepsContext.currentStepIndex)
  } else {
    // Normal completion
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
    // This prevents useEffect in App.tsx from re-setting targeting mode
    // after clearTargetingMode() is called but before abilityMode is cleared
    setAbilityMode(null)
    clearTargetingMode()
  }
  return true
}

/**
 * Handle REVEAL_ENEMY (Recon Drone Commit)
 */
function handleRevealEnemy(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, setAbilityMode, setCursorStack, markAbilityUsed, gameState, localPlayerId, setTargetingMode } = props

  if (!abilityMode || abilityMode.mode !== 'REVEAL_ENEMY') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode

  if (!sourceCoords || !sourceCard) {
    return false
  }

  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  if (!isAdj) {
    return false
  }

  // RECON DRONE FIX: Check if target is a token (tokens cannot be targeted by Recon Drone)
  // Tokens have deck === 'Tokens' or types include 'Token'
  const isToken = card.deck === 'Tokens' || card.types?.includes('Token')
  if (isToken) {
    return false
  }

  const ownerId = card.ownerId

  // Validate ownerId - card must have an owner
  if (ownerId === undefined || ownerId === null) {
    return false
  }

  // Use universal token targeting system to create cursorStack
  // Modifications: targetOwnerId restricts to selected card's owner's hand
  // onlyFaceDown: only target unrevealed cards
  // onlyOpponents: implicit (targetOwnerId is opponent)
  // tokenOwnerId: the player who activated Recon Drone (will own the Revealed status)
  const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
  const tokenOwnerId = (activePlayer?.isDummy && gameState.activePlayerId !== null)
    ? gameState.activePlayerId
    : (localPlayerId ?? 0)

  const modifications: Partial<CursorStackState> = {
    targetOwnerId: ownerId,  // Only reveal cards from the targeted opponent's hand
    onlyFaceDown: true,       // Only unrevealed cards
    sourceCoords: boardCoords,
    sourceCard: card,
    isDeployAbility,
    readyStatusToRemove,
  }

  setCursorStack(createTokenCursorStack('Revealed', tokenOwnerId, null, modifications))

  // Calculate hand targets for the targeted opponent's hand
  // Revealed can be placed on cards that don't already have Revealed from this player
  const handTargets: {playerId: number, cardIndex: number}[] = []
  const targetPlayer = gameState.players.find(p => p.id === ownerId)
  if (targetPlayer?.hand) {
    targetPlayer.hand.forEach((handCard, index) => {
      // Card is valid if it doesn't already have Revealed from this player
      const alreadyHasRevealed = handCard.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId)
      if (!alreadyHasRevealed) {
        handTargets.push({ playerId: ownerId, cardIndex: index })
      }
    })
  }

  // Create a dummy action for setTargetingMode (required parameter)
  const dummyAction: AbilityAction = {
    type: 'CREATE_STACK',
    mode: 'SELECT_TARGET',
    payload: {
      tokenType: 'Revealed',
      filter: () => true,
    },
    sourceCoords: boardCoords,
    sourceCard,
  }

  // Activate targeting mode so all players see the valid hand targets highlighted
  setTargetingMode(dummyAction, tokenOwnerId, boardCoords, undefined, undefined, handTargets)

  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)

  // CRITICAL FIX: Clear abilityMode after creating cursorStack
  // This prevents the targeting mode from persisting and allows the token placement to complete
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)

  return true
}

/**
 * Handle SELECT_CELL (Recon Drone Setup, Finn Setup, etc.)
 */
function handleSelectCell(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, moveItem, markAbilityUsed, setAbilityMode, triggerClickWave, handleActionExecution, setCommandContext, clearTargetingMode, setActionQueue } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_CELL') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload, originalOwnerId, chainedAction: directChainedAction } = abilityMode

  // CRITICAL: For command cards like False Orders, chainedAction is in payload.chainedAction
  // For other abilities, it might be at the top level. Check both.
  const actualChainedAction = directChainedAction || payload?.chainedAction

  if (payload?.filter && !payload.filter(null, boardCoords.row, boardCoords.col)) {
    return false
  }

  // Determine which card is being moved
  const movedCard = payload?.selectedCard || sourceCard
  const movedCardId = movedCard?.id

  if (payload?.moveFromHand && payload?.selectedCard) {
    moveItem({
      card: payload.selectedCard,
      source: 'hand',
      playerId: payload.selectedPlayerId,
      cardIndex: payload.selectedCardIndex,
      bypassOwnershipCheck: true,
    }, { target: 'board', boardCoords })
  } else if (sourceCoords && sourceCoords.row >= 0 && sourceCard) {
    // CRITICAL: For False Orders Stun x2, pass enriched chainedAction via target
    // This ensures contextCardId is included in the MOVE_CARD_ON_BOARD action sent to host
    const target: DropTarget = { target: 'board', boardCoords }
    if (actualChainedAction) {
      target.chainedAction = {
        ...actualChainedAction,
        payload: {
          ...actualChainedAction.payload,
          contextCardId: movedCardId, // Add moved card ID for token placement
        }
      }
    }

    // CRITICAL: Use bypassOwnershipCheck for dummy player command execution
    // When local player activates dummy's command (like Data Interception), they need to move dummy's cards
    moveItem({ card: sourceCard, source: 'board', boardCoords: sourceCoords, bypassOwnershipCheck: true }, target)
  }

  // CRITICAL: Record moved card context for rewards like Tactical Maneuver
  // This allows handleContextReward to find the moved card and apply draw/score rewards
  if (payload?.recordContext && movedCardId) {
    const context = {
      lastMovedCardCoords: boardCoords,  // Destination where card WILL be
      lastMovedCardId: movedCardId,
      // Also track source location (where card IS now) for finding it before move completes
      _sourceCoordsBeforeMove: sourceCoords
    }
    setCommandContext(context)
  }

  // Trigger click wave with originalOwnerId (command card owner) if available
  // This ensures visual effects use the correct color for command cards like False Orders
  triggerClickWave('board', boardCoords, undefined, originalOwnerId)

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)

  // CRITICAL: Add chained action to actionQueue if present (e.g., Tactical Maneuver draw/score, False Orders Reveal x2/Stun x2)
  // This ensures the action is processed sequentially after abilityMode is cleared, allowing cleanupCommand to execute
  // The chained action is added to the queue AFTER the card is moved
  if (actualChainedAction) {
    // CRITICAL FIX: Convert chainedAction from JSON format (action/details) to AbilityAction format (type/payload)
    // In contentDatabase.json, chainedAction has: {action: "GLOBAL_AUTO_APPLY", details: {contextReward: "..."}}
    // But AbilityAction expects: {type: "GLOBAL_AUTO_APPLY", payload: {contextReward: "..."}}
    const originalFormat = (actualChainedAction as any).action && !(actualChainedAction as any).type

    const normalizedAction: any = originalFormat
      ? {
          type: (actualChainedAction as any).action,
          // CRITICAL: Merge details with existing payload to preserve contextCardPower and _autoStepsContext
          payload: {
            ...((actualChainedAction as any).details || {}),
            ...((actualChainedAction as any).payload || {})
          }
        }
      : actualChainedAction

    // CRITICAL: Convert ownerId: "source" to actual command owner ID BEFORE creating enrichedChainedAction
    // This ensures Stun tokens belong to the player who played the command
    if (normalizedAction.type === 'GLOBAL_AUTO_APPLY' && normalizedAction.payload?.ownerId === 'source') {
      normalizedAction.payload = {
        ...(normalizedAction.payload || {}),
        ownerId: originalOwnerId,
      }
    }

    // CRITICAL: For False Orders Option 1 (Revealed tokens), resolve targetOwnerId before creating enrichedChainedAction
    // This ensures the resolved value is preserved and not overwritten by payload spreading
    let resolvedTargetOwnerId: number | undefined
    const isRevealedTokens = normalizedAction.type === 'CREATE_STACK' && normalizedAction.tokenType === 'Revealed' && movedCard
    if (isRevealedTokens && movedCard.ownerId !== undefined) {
      resolvedTargetOwnerId = movedCard.ownerId
    }

    // Add _tempContextId to help find the moved card in case state hasn't updated yet
    // Also add contextCardId for False Orders Option 1 (Stun x2 on moved card)
    const enrichedChainedAction: AbilityAction = {
      ...normalizedAction,
      // CRITICAL: Preserve sourceCard from actualChainedAction (command card) if available
      // Otherwise fall back to abilityMode.sourceCard (which might be the selected unit)
      sourceCard: (actualChainedAction as any).sourceCard || abilityMode.sourceCard,
      // CRITICAL: For CREATE_STACK with Revealed (hand targeting), use default sourceCoords {-1, -1}
      // For GLOBAL_AUTO_APPLY with Stun (board targeting), use boardCoords
      sourceCoords: normalizedAction.type === 'CREATE_STACK' && normalizedAction.tokenType === 'Revealed'
        ? { row: -1, col: -1 }
        : boardCoords,
      originalOwnerId, // CRITICAL: Preserve command card owner for reward attribution (Tactical Maneuver)
      isDeployAbility: abilityMode.isDeployAbility,
      readyStatusToRemove: abilityMode.readyStatusToRemove,
      // CRITICAL: Set targetOwnerId at top level for Revealed tokens
      ...(resolvedTargetOwnerId !== undefined ? { targetOwnerId: resolvedTargetOwnerId } : {}),
      payload: {
        // CRITICAL: Spread payload FIRST, then override specific values
        // This prevents payload.targetOwnerId = -2 from overwriting resolvedTargetOwnerId
        ...(normalizedAction.payload || {}),
        _tempContextId: movedCardId,  // Pass the moved card ID so handleContextReward can find it
        // Also pass the source coords BEFORE the move (for finding the card before it moves)
        _sourceCoordsBeforeMove: sourceCoords,
        // CRITICAL: Pass contextCardId for token placement on moved card (False Orders Option 1)
        contextCardId: movedCardId,
        // CRITICAL: Pass _autoStepsContext so handleContextReward can continue to next steps (e.g., CLEANUP_COMMAND)
        _autoStepsContext: payload?._autoStepsContext,
        // CRITICAL: Pass _sourceOwnerId so handleCreateStack can resolve targetOwnerId correctly
        // This fixes False Orders Option 1 where repeated uses would target wrong player's hand
        ...(resolvedTargetOwnerId !== undefined ? { _sourceOwnerId: resolvedTargetOwnerId } : {}),
        // CRITICAL: Override targetOwnerId in payload for Revealed tokens (must come after payload spread)
        ...(resolvedTargetOwnerId !== undefined ? { targetOwnerId: resolvedTargetOwnerId } : {}),
      }
    }

    // Clear excludeOwnerId if we're using targetOwnerId instead
    if (resolvedTargetOwnerId !== undefined) {
      delete (enrichedChainedAction.payload as any).excludeOwnerId
    }

    // CRITICAL: Execute chainedAction with proper handling based on type
    // For CREATE_STACK (Revealed), execute through handleActionExecution to create cursorStack
    // For GLOBAL_AUTO_APPLY (Stun, etc.), execute directly to ensure it runs before CONTINUE_AUTO_STEPS
    // This fixes False Orders Option 2 where Stun tokens weren't being placed
    if (normalizedAction.type === 'CREATE_STACK' && normalizedAction.tokenType === 'Revealed') {
      // For Revealed tokens, execute through handleActionExecution to create cursorStack
      if (props.handleActionExecution) {
        setTimeout(() => {
          props.handleActionExecution(enrichedChainedAction, { row: -1, col: -1 })
        }, 50)
      }

      // Also add CONTINUE_AUTO_STEPS after cursorStack completes
      if (payload?._autoStepsContext && setActionQueue) {
        const autoStepsContext = { ...payload._autoStepsContext }
        const continueAction: any = {
          type: 'CONTINUE_AUTO_STEPS',
          sourceCard: abilityMode.sourceCard,
          sourceCoords: boardCoords,
          isDeployAbility: abilityMode.isDeployAbility,
          readyStatusToRemove: abilityMode.readyStatusToRemove,
          payload: {
            _autoStepsContext: autoStepsContext,
            stepContext: {
              targetCoords: boardCoords,
              targetCardId: movedCardId,
              // CRITICAL: Pass sourceOwnerId for resolving targetOwnerId in chained actions
              // This fixes False Orders Option 1 where Revealed tokens need to target the moved card's owner
              ...(movedCard?.ownerId !== undefined ? { sourceOwnerId: movedCard.ownerId } : {})
            }
          }
        }
        setTimeout(() => {
          setActionQueue(prev => {
            const cleanupActions = prev.filter(a => a.payload?.cleanupCommand)
            const otherActions = prev.filter(a => !a.payload?.cleanupCommand)
            return [...otherActions, continueAction, ...cleanupActions]
          })
        }, 100)
      }
    } else if (normalizedAction.type === 'GLOBAL_AUTO_APPLY') {
      // CRITICAL FIX: For GLOBAL_AUTO_APPLY (Stun, etc.), execute directly through handleActionExecution
      // This ensures the action runs immediately instead of being added to actionQueue
      // This fixes False Orders Option 2 where Stun tokens weren't being placed because
      // actionQueue processing was delayed and CONTINUE_AUTO_STEPS ran first
      if (props.handleActionExecution) {
        // Small delay to allow move animation to complete
        setTimeout(() => {
          props.handleActionExecution(enrichedChainedAction, boardCoords)
        }, 50)
      }

      // Also add CONTINUE_AUTO_STEPS after GLOBAL_AUTO_APPLY completes
      if (payload?._autoStepsContext && setActionQueue) {
        const autoStepsContext = { ...payload._autoStepsContext }
        const continueAction: any = {
          type: 'CONTINUE_AUTO_STEPS',
          sourceCard: abilityMode.sourceCard,
          sourceCoords: boardCoords,
          isDeployAbility: abilityMode.isDeployAbility,
          readyStatusToRemove: abilityMode.readyStatusToRemove,
          payload: {
            _autoStepsContext: autoStepsContext,
            stepContext: {
              targetCoords: boardCoords,
              targetCardId: movedCardId,
              // CRITICAL: Pass sourceOwnerId for resolving targetOwnerId in chained actions
              ...(movedCard?.ownerId !== undefined ? { sourceOwnerId: movedCard.ownerId } : {})
            }
          }
        }
        setTimeout(() => {
          setActionQueue(prev => {
            const cleanupActions = prev.filter(a => a.payload?.cleanupCommand)
            const otherActions = prev.filter(a => !a.payload?.cleanupCommand)
            return [...otherActions, continueAction, ...cleanupActions]
          })
        }, 100) // Slightly longer delay to ensure GLOBAL_AUTO_APPLY completes first
      }
    } else {
      // For other actions (GLOBAL_AUTO_APPLY, etc.), add to actionQueue
      if (setActionQueue) {
        // Add chainedAction to actionQueue, but ensure cleanupCommand stays at the end
        setActionQueue(prev => {
          const cleanupActions = prev.filter(a => a.payload?.cleanupCommand)
          const otherActions = prev.filter(a => !a.payload?.cleanupCommand)

          // CRITICAL: If this is part of AUTO_STEPS, also add CONTINUE_AUTO_STEPS after chainedAction
          // This ensures command cards are discarded after all steps complete
          const actionsToQueue: any[] = [enrichedChainedAction]
          if (payload?._autoStepsContext) {
            // CRITICAL: currentStepIndex already points to the next step, use as-is
            const autoStepsContext = { ...payload._autoStepsContext }
            const continueAction: any = {
              type: 'CONTINUE_AUTO_STEPS',
              sourceCard: abilityMode.sourceCard,
              sourceCoords: boardCoords, // Use new coords as source
              isDeployAbility: abilityMode.isDeployAbility,
              readyStatusToRemove: abilityMode.readyStatusToRemove,
              payload: {
                _autoStepsContext: autoStepsContext,
                stepContext: {
                  targetCoords: boardCoords,
                  targetCardId: movedCardId,
                  // CRITICAL: Pass sourceOwnerId for resolving targetOwnerId in chained actions
                  // This fixes False Orders Option 1 where Revealed tokens need to target the moved card's owner
                  ...(movedCard?.ownerId !== undefined ? { sourceOwnerId: movedCard.ownerId } : {})
                }
              }
            }
            actionsToQueue.push(continueAction)
          }

          // Insert chainedAction before cleanupCommand(s)
          return [...otherActions, ...actionsToQueue, ...cleanupActions]
        })
      }
    }
  }

  // CRITICAL FIX: Handle case where there's NO chainedAction but we're in AUTO_STEPS context
  // This is for Data Interception option 2: CREATE_STACK → SELECT_UNIT_FOR_MOVE → SELECT_CELL → CLEANUP_COMMAND
  // After the move completes, we need to continue AUTO_STEPS to trigger CLEANUP_COMMAND
  if (!actualChainedAction && payload?._autoStepsContext && setActionQueue) {
    const autoStepsContext = { ...payload._autoStepsContext }
    const continueAction: any = {
      type: 'CONTINUE_AUTO_STEPS',
      sourceCard: abilityMode.sourceCard,
      sourceCoords: boardCoords, // Use new coords as source
      isDeployAbility: abilityMode.isDeployAbility,
      readyStatusToRemove: abilityMode.readyStatusToRemove,
      payload: {
        _autoStepsContext: autoStepsContext,
        stepContext: {
          targetCoords: boardCoords,
          targetCardId: movedCardId
        }
      }
    }

    setActionQueue(prev => {
      const cleanupActions = prev.filter(a => a.payload?.cleanupCommand)
      const otherActions = prev.filter(a => !a.payload?.cleanupCommand)
      const newQueue = [...otherActions, continueAction, ...cleanupActions]
      return newQueue
    })
  }

  // CRITICAL: Clear targeting mode when move is complete
  // This was missing for Data Interception option 1 and similar abilities without chainedAction
  // If there's a chainedAction, delay clearTargetingMode to avoid race condition
  if (actualChainedAction) {
    // chainedAction might set targetingMode, so clear after it executes
    setTimeout(() => {
      clearTargetingMode()
    }, TIMING.MODE_CLEAR_DELAY + 50)
  } else {
    // No chainedAction, clear immediately
    clearTargetingMode()
  }

  // CRITICAL: Do NOT clear abilityMode when there's a chainedAction
  // The mode will be cleared after the chained action executes (in actionExecutionHandler)
  // This fixes False Orders Option 2 where the mode was cleared before the chained action could execute
  if (!actualChainedAction) {
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  }
  // For chainedAction case, mode is cleared in handleGlobalAutoApply when the action completes
  return true
}

/**
 * Handle IMMUNIS_RETRIEVE (Immunis Deploy)
 */
function handleImmunisRetrieve(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, moveItem, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'IMMUNIS_RETRIEVE') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove } = abilityMode

  if (!sourceCoords) {
    return false
  }

  const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
  if (!isAdj) {
    return false
  }

  if (payload?.selectedCard) {
    moveItem({
      card: payload.selectedCard,
      source: 'discard',
    }, { target: 'board', boardCoords })
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  return false
}

/**
 * Handle RECON_DRONE_COMMIT (2-step: select adjacent opponent card, then reveal their hand card)
 */
function handleReconDroneCommit(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, setAbilityMode, setCursorStack, triggerClickWave, triggerNoTarget, setTargetingMode, markAbilityUsed } = props

  if (!abilityMode || abilityMode.mode !== 'RECON_DRONE_COMMIT') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode

  if (!sourceCoords) {
    return false
  }

  // Step 1: Select adjacent opponent card
  if (!payload._step2TargetOwnerId) {
    // Check if target is adjacent
    const isAdj = Math.abs(boardCoords.row - sourceCoords.row) + Math.abs(boardCoords.col - sourceCoords.col) === 1
    if (!isAdj) {
      return false
    }

    // Check if target is opponent
    const ownerId = sourceCard?.ownerId || 0
    if (card.ownerId === ownerId) {
      return false // Can't select own cards
    }

    // Step 1 complete - transition to step 2
    triggerClickWave('board', boardCoords)

    // Get token owner ID (the player who owns Recon Drone)
    const tokenOwnerId = sourceCard?.ownerId || gameState.activePlayerId || props.localPlayerId || 1
    const targetOwnerId = card.ownerId ?? 1 // Ensure targetOwnerId is defined

    // Calculate hand targets for the targeted opponent's hand
    // Revealed can be placed on cards that don't already have Revealed from this player
    const handTargets: {playerId: number, cardIndex: number}[] = []
    const targetPlayer = gameState.players.find(p => p.id === targetOwnerId)
    if (targetPlayer?.hand) {
      targetPlayer.hand.forEach((handCard, index) => {
        // Card is valid if it doesn't already have Revealed from this player
        const alreadyHasRevealed = handCard.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId)
        if (!alreadyHasRevealed) {
          handTargets.push({ playerId: targetOwnerId, cardIndex: index })
        }
      })
    }

    // Check if there are any valid hand targets
    if (handTargets.length === 0) {
      // No valid targets - show "no target" effect and don't proceed
      triggerNoTarget(boardCoords)
      // Clear ability mode and preserve ready status
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
      return true
    }

    // Update ability mode to step 2
    setAbilityMode({
      ...abilityMode,
      payload: {
        ...payload,
        _step2TargetOwnerId: targetOwnerId, // Save for step 2
        _step1TargetCardId: card.id
      }
    })

    // Create cursor stack for Revealed tokens
    // Set targetOwnerId to the selected opponent's ID so only their hand cards can be targeted
    // NOTE: We do NOT pass chainedAction here - the ability is completed by clicking a hand card
    // The chainedAction from payload would cause unwanted "no target" effects after completion
    setCursorStack({
      type: 'Revealed',
      count: payload.count || 1,
      targetOwnerId,
      isDragging: false,
      sourceCoords,
      sourceCard,
      isDeployAbility,
      readyStatusToRemove
      // No chainedAction - ability completes when hand card is clicked
    })

    // Create a dummy action for setTargetingMode (required parameter)
    const dummyAction: AbilityAction = {
      type: 'CREATE_STACK',
      mode: 'SELECT_TARGET',
      payload: {
        tokenType: 'Revealed',
        filter: () => true,
      },
      sourceCoords,
      sourceCard,
    }

    // Activate targeting mode so all players see the valid hand targets highlighted
    setTargetingMode(dummyAction, tokenOwnerId, sourceCoords, undefined, undefined, handTargets)

    // Mark ability as used after creating cursorStack (Recon Drone ability is now complete)
    markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)

    // Clear abilityMode after creating cursorStack
    // This allows the token placement to complete without interference
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)

    return true
  }

  // Step 2: Target should be hand card (handled elsewhere via handCardHandlers)
  // This handler is only for board card selection (step 1)
  return false
}

/**
 * Handle IP_AGENT_THREAT_SCORING (IP Dept Agent Setup)
 */
function handleIpAgentThreatScoring(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, updatePlayerScore, triggerFloatingText, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'IP_AGENT_THREAT_SCORING') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode
  const ownerId = sourceCard?.ownerId || 0

  if (!sourceCoords) {
    return false
  }

  // Check if selected same row or column
  const sameRow = boardCoords.row === sourceCoords.row
  const sameCol = boardCoords.col === sourceCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Count Threat in selected line
  let threatCount = 0

  if (sameRow) {
    for (let c = 0; c < gameState.board.length; c++) {
      const card = gameState.board[boardCoords.row][c].card
      if (card?.statuses) {
        threatCount += card.statuses.filter((s: any) => s.type === 'Threat' && s.addedByPlayerId === ownerId).length
      }
    }
  } else {
    for (let r = 0; r < gameState.board.length; r++) {
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

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SELECT_LINE_FOR_EXPLOIT_SCORING
 * Select a line that passes through the target card (where Exploit was placed)
 * Gain 1 point for each of your Exploit counters in that line
 */
function handleSelectLineForExploitScoring(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, commandContext, updatePlayerScore, triggerFloatingText, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_LINE_FOR_EXPLOIT_SCORING') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode
  const ownerId = sourceCard?.ownerId || 0

  // Use payload.targetCoords (synchronous) as priority, fallback to commandContext.lastMovedCardCoords (async)
  // For Unwavering Integrator, targetCoords will be undefined - use sourceCoords instead
  const contextCoords = payload?.targetCoords || commandContext?.lastMovedCardCoords || sourceCoords

  if (!contextCoords) {
    return false
  }

  // Check if selected same row or column as the reference card
  // For Zius: reference is the target card (where Exploit was placed)
  // For Unwavering Integrator: reference is sourceCoords (Unwavering Integrator itself)
  const sameRow = boardCoords.row === contextCoords.row
  const sameCol = boardCoords.col === contextCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Count Exploit counters in selected line
  let exploitCount = 0
  const cardsWithExploit: { row: number; col: number }[] = []

  if (sameRow) {
    for (let c = 0; c < gameState.board.length; c++) {
      const card = gameState.board[boardCoords.row][c].card
      if (card?.statuses) {
        const exploits = card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
        if (exploits > 0) {
          exploitCount += exploits
          cardsWithExploit.push({ row: boardCoords.row, col: c })
        }
      }
    }
  } else {
    for (let r = 0; r < gameState.board.length; r++) {
      const card = gameState.board[r][boardCoords.col].card
      if (card?.statuses) {
        const exploits = card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
        if (exploits > 0) {
          exploitCount += exploits
          cardsWithExploit.push({ row: r, col: boardCoords.col })
        }
      }
    }
  }

  const points = exploitCount  // 1 point per Exploit counter
  if (points > 0) {
    updatePlayerScore(ownerId, points)

    // Show only ONE total floating text over the card that performed the ability
    triggerFloatingText({
      row: sourceCoords?.row || contextCoords.row,
      col: sourceCoords?.col || contextCoords.col,
      text: `+${points}`,
      playerId: ownerId,
    })
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle ZIUS_LINE_SELECT (Zius Setup - after placing Exploit)
 */
function handleZiusLineSelect(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, commandContext, updatePlayerScore, triggerFloatingText, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'ZIUS_LINE_SELECT') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove } = abilityMode
  const ownerId = sourceCard?.ownerId || 0

  // Use the card that just got Exploit from commandContext
  const contextCoords = commandContext.lastMovedCardCoords || sourceCoords

  if (!contextCoords) {
    return false
  }

  // Check if selected same row or column as context card
  const sameRow = boardCoords.row === contextCoords.row
  const sameCol = boardCoords.col === contextCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Count Exploit in selected line
  let exploitCount = 0

  if (sameRow) {
    for (let c = 0; c < gameState.board.length; c++) {
      const card = gameState.board[boardCoords.row][c].card
      if (card?.statuses) {
        exploitCount += card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
      }
    }
  } else {
    for (let r = 0; r < gameState.board.length; r++) {
      const card = gameState.board[r][boardCoords.col].card
      if (r === contextCoords.row) {continue}
      if (card?.statuses) {
        exploitCount += card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
      }
    }
  }

  if (exploitCount > 0) {
    updatePlayerScore(ownerId, exploitCount)

    // Show only ONE total floating text over the card where Exploit was placed
    triggerFloatingText({
      row: contextCoords.row,
      col: contextCoords.col,
      text: `+${exploitCount}`,
      playerId: ownerId,
    })
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SELECT_DIAGONAL (Logistics Chain)
 *
 * Two-step selection:
 * 1. First click: select center cell (any cell in active grid)
 * 2. Second click: select any cell on either diagonal through the center
 *
 * CRITICAL: After scoring, must continue AUTO_STEPS to execute CLEANUP_COMMAND
 * which sends the command card to discard. This fixes Logistics Chain not discarding.
 */
function handleSelectDiagonal(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode: currentAbilityMode, scoreDiagonal, nextPhase, setAbilityMode } = props

  if (!currentAbilityMode || currentAbilityMode.mode !== 'SELECT_DIAGONAL') {
    return false
  }

  const { payload, sourceCard } = currentAbilityMode
  // CRITICAL: Use sourceCard.ownerId for command cards (the player who owns the command card)
  // This fixes dummy player control in P2P mode - the dummy player should get points/draws
  const autoStepsContext = (payload as any)?._autoStepsContext
  const isCommandCard = !!(autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined)
  const ownerId = payload?.playerId ?? sourceCard?.ownerId ?? 0
  const bonusType = payload?.bonusType || 'point_per_support'

  // Step 1: First click - select center point
  // Use functional state update to avoid stale closure issues
  if (!payload?.firstCoords) {
    setAbilityMode(prev => {
      if (!prev || prev.mode !== 'SELECT_DIAGONAL') {
        return prev
      }
      return { ...prev, payload: { ...(prev.payload || {}), firstCoords: boardCoords } }
    })
    return true
  }

  // Step 2: Second click - validate and execute diagonal scoring
  const { row: r1, col: c1 } = payload.firstCoords
  const { row: r2, col: c2 } = boardCoords

  // Check if second point is on either diagonal through first point
  const onMainDiagonal = (r1 - c1) === (r2 - c2)
  const onAntiDiagonal = (r1 + c1) === (r2 + c2)

  if (!onMainDiagonal && !onAntiDiagonal) {
    // Invalid selection - clicked cell not on diagonal through center
    // Don't reset firstCoords, let player try again
    return true
  }

  // Execute diagonal scoring via scoreDiagonal action
  // This handles both WebSocket and WebRTC modes
  if (scoreDiagonal) {
    scoreDiagonal(r1, c1, r2, c2, ownerId, bonusType)
  }

  // CRITICAL: Do NOT advance phase for command cards (AUTO_STEPS)
  // Command cards should stay in the same phase after execution
  // Only advance phase for non-command abilities with explicit skipNextPhase: false
  if (!isCommandCard && !payload.skipNextPhase && nextPhase) {
    nextPhase()
  }

  // CRITICAL: Check if this is part of AUTO_STEPS (command cards like Logistics Chain)
  // If so, continue to next step (CLEANUP_COMMAND) to discard the command card
  if (isCommandCard) {
    // Use currentAbilityMode.sourceCoords for sourceCoords (command card location)
    const sourceCoords = currentAbilityMode.sourceCoords || { row: 0, col: 0 }
    advanceToNextStepWithCoords(props, sourceCoords, autoStepsContext.currentStepIndex + 1)
  } else {
    // Not part of AUTO_STEPS, just clear ability mode
    setAbilityMode(null)
  }
  return true
}

/**
 * Handle SCORE_LAST_PLAYED_LINE
 */
function handleScoreLastPlayedLine(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, commandContext, markAbilityUsed, updatePlayerScore, triggerFloatingText, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SCORE_LAST_PLAYED_LINE') {
    return false
  }

  const { sourceCoords, sourceCard, isDeployAbility, readyStatusToRemove, payload } = abilityMode
  const ownerId = sourceCard?.ownerId || 0

  // Get the last played card coords from commandContext
  const lastPlayedCoords = commandContext.lastMovedCardCoords
  if (!lastPlayedCoords) {
    return false
  }

  const lastPlayedCard = gameState.board[lastPlayedCoords.row][lastPlayedCoords.col].card
  if (!lastPlayedCard) {
    return false
  }

  // Check if same row or column
  const sameRow = boardCoords.row === lastPlayedCoords.row
  const sameCol = boardCoords.col === lastPlayedCoords.col

  if (!sameRow && !sameCol) {
    return false
  }

  // Calculate power
  const power = Math.max(0, lastPlayedCard.power + (lastPlayedCard.powerModifier || 0))

  // Handle different reward types
  if (payload?.rewardType === 'SCORE') {
    updatePlayerScore(ownerId, power)
    triggerFloatingText({
      row: lastPlayedCoords.row,
      col: lastPlayedCoords.col,
      text: `+${power}`,
      playerId: ownerId,
    })
  } else if (payload?.rewardType === 'DRAW') {
    // Draw cards equal to power
    // This would need drawCard function
  }

  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
  return true
}

/**
 * Handle SEARCH_DECK (Mr. Pearl, Falk PD)
 */
function handleSearchDeck(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, setViewingDiscard, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'SEARCH_DECK') {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  // Open deck search modal
  setViewingDiscard(true)
  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setAbilityMode(null)
  return true
}

/**
 * Handle RETRIEVE_DEVICE (Inventive Maker Setup)
 */
function handleRetrieveDevice(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, setViewingDiscard, markAbilityUsed, setAbilityMode } = props

  if (!abilityMode || abilityMode.mode !== 'RETRIEVE_DEVICE') {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  // Open discard retrieve modal
  setViewingDiscard(true)
  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  setAbilityMode(null)
  return true
}

/**
 * Handle SELECT_DECK (Secret Informant)
 */
function handleSelectDeck(
  card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, triggerDeckSelection, markAbilityUsed, setAbilityMode, clearTargetingMode, localPlayerId } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_DECK') {
    return false
  }

  const { sourceCoords, isDeployAbility, readyStatusToRemove } = abilityMode

  triggerDeckSelection(card.ownerId ?? 0, localPlayerId ?? 0)
  markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
  // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
  // This prevents useEffect in App.tsx from re-setting targeting mode
  setAbilityMode(null)
  clearTargetingMode() // Clear targeting mode immediately after selection
  return true
}

/**
 * Handle LINES_WITH_SUPPORT (Signal Prophet Deploy)
 * Places 1 Exploit token on each of your cards with Support in lines
 */
function handleLinesWithSupport(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, markAbilityUsed, setAbilityMode, setTargetingMode, commandContext } = props

  if (!abilityMode || abilityMode.mode !== 'LINES_WITH_SUPPORT') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode
  const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId

  // Find all cards with Support in lines (horizontal and vertical) from source card
  const { row, col } = sourceCoords || { row: boardCoords.row, col: boardCoords.col }
  const gridSize = gameState.board.length
  const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
  const minBound = offset
  const maxBound = offset + gameState.activeGridSize - 1
  const validTargets: { row: number; col: number }[] = []

  // Check horizontal line (same row)
  // CRITICAL: Only iterate through ACTIVE grid bounds, not entire board
  for (let c = minBound; c <= maxBound; c++) {
    if (c === col) { continue } // Skip source card itself
    const cell = gameState.board[row][c]
    if (cell.card?.ownerId === ownerId && cell.card.statuses?.some((s: any) => s.type === 'Support')) {
      validTargets.push({ row, col: c })
    }
  }

  // Check vertical line (same column)
  // CRITICAL: Only iterate through ACTIVE grid bounds, not entire board
  for (let r = minBound; r <= maxBound; r++) {
    if (r === row) { continue } // Skip source card itself
    const cell = gameState.board[r][col]
    if (cell.card?.ownerId === ownerId && cell.card.statuses?.some((s: any) => s.type === 'Support')) {
      validTargets.push({ row: r, col })
    }
  }

  if (validTargets.length === 0) {
    // No valid targets - mark as used and clear mode
    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // Set targeting mode with pre-calculated targets
  setTargetingMode(abilityMode, ownerId ?? 0, sourceCoords, validTargets, commandContext)

  // Enter CREATE_STACK mode for placing tokens
  setAbilityMode({
    type: 'ENTER_MODE',
    mode: 'CREATE_STACK',
    sourceCard,
    sourceCoords,
    isDeployAbility,
    readyStatusToRemove,
    payload: {
      tokenType: payload?.tokenType || 'Exploit',
      count: 1,
      remainingTargets: validTargets.length,
      targets: validTargets,
      targetIndex: 0
    }
  })

  return true
}

/**
 * Handle SELECT_LINE_FOR_SUPPORT_COUNTERS (Signal Prophet Deploy)
 * Player selects a line (horizontal or vertical through source card),
 * then Exploit counters are placed on all ally cards with Support in that line
 */
function handleSelectLineForSupportTokens(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, markAbilityUsed, setAbilityMode, addBoardCardStatus, clearTargetingMode } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_LINE_FOR_SUPPORT_COUNTERS') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode
  const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId

  if (!sourceCoords) {
    return false
  }

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

  // Determine which line was selected
  const targets: { row: number; col: number }[] = []
  const gridSize = gameState.board.length
  const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
  const minBound = offset
  const maxBound = offset + gameState.activeGridSize - 1

  if (sameRow) {
    // Horizontal line selected - find all ally cards, then check for Support
    // CRITICAL: Only iterate through ACTIVE grid bounds, not entire board
    for (let c = minBound; c <= maxBound; c++) {
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
    // CRITICAL: Only iterate through ACTIVE grid bounds, not entire board
    for (let r = minBound; r <= maxBound; r++) {
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

  // Apply Exploit counter to all targets
  const counterType = payload?.tokenType || 'Exploit'
  const counterOwnerId = ownerId ?? 0
  const counterCount = payload?.count || 1

  for (const target of targets) {
    addBoardCardStatus(target, counterType, counterOwnerId, counterCount)
  }

  // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
  // This prevents useEffect in App.tsx from re-setting targeting mode
  setAbilityMode(null)
  clearTargetingMode()
  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)

  return true
}

/**
 * Handle SELECT_LINE_FOR_THREAT_COUNTERS (Code Keeper Deploy)
 * Select a line, then place Exploit counters on opponent cards with owner's Threat in that line
 */
function handleSelectLineForThreatCounters(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, markAbilityUsed, setAbilityMode, addBoardCardStatus, clearTargetingMode } = props

  if (!abilityMode || abilityMode.mode !== 'SELECT_LINE_FOR_THREAT_COUNTERS') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode
  const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId

  if (!sourceCoords) {
    return false
  }

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

  // Determine which line was selected
  const targets: { row: number; col: number }[] = []
  const gridSize = gameState.board.length
  const offset = Math.floor((gridSize - gameState.activeGridSize) / 2)
  const minBound = offset
  const maxBound = offset + gameState.activeGridSize - 1

  if (sameRow) {
    // Horizontal line selected - find all opponent cards, then check for Threat from owner
    // CRITICAL: Only iterate through ACTIVE grid bounds, not entire board
    for (let c = minBound; c <= maxBound; c++) {
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
    // CRITICAL: Only iterate through ACTIVE grid bounds, not entire board
    for (let r = minBound; r <= maxBound; r++) {
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

  // Apply Exploit counter to all targets
  const counterType = payload?.tokenType || 'Exploit'
  const counterOwnerId = ownerId ?? 0
  const counterCount = payload?.count || 1

  for (const target of targets) {
    addBoardCardStatus(target, counterType, counterOwnerId, counterCount)
  }

  // CRITICAL: Set abilityMode to null BEFORE clearing targetingMode
  // This prevents useEffect in App.tsx from re-setting targeting mode
  setAbilityMode(null)
  clearTargetingMode()
  markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)

  return true
}

/**
 * Handle LINES_WITH_THREAT
 * Places tokens on each of your cards with Threat in lines
 */
function handleLinesWithThreat(
  _card: Card,
  boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, markAbilityUsed, setAbilityMode, setTargetingMode, commandContext } = props

  if (!abilityMode || abilityMode.mode !== 'LINES_WITH_THREAT') {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode
  const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId

  // Find all cards with Threat in lines (horizontal and vertical) from source card
  const { row, col } = sourceCoords || { row: boardCoords.row, col: boardCoords.col }
  const gridSize = gameState.board.length
  const validTargets: { row: number; col: number }[] = []

  // Check horizontal line (same row)
  for (let c = 0; c < gridSize; c++) {
    if (c === col) { continue }
    const cell = gameState.board[row][c]
    if (cell.card?.ownerId === ownerId && cell.card?.statuses?.some((s: any) => s.type === 'Threat')) {
      validTargets.push({ row, col: c })
    }
  }

  // Check vertical line (same column)
  for (let r = 0; r < gridSize; r++) {
    if (r === row) { continue }
    const cell = gameState.board[r][col]
    if (cell.card?.ownerId === ownerId && cell.card?.statuses?.some((s: any) => s.type === 'Threat')) {
      validTargets.push({ row: r, col })
    }
  }

  if (validTargets.length === 0) {
    markAbilityUsed(sourceCoords || boardCoords, isDeployAbility, false, readyStatusToRemove)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // Set targeting mode with pre-calculated targets
  setTargetingMode(abilityMode, ownerId ?? 0, sourceCoords, validTargets, commandContext)

  // Enter CREATE_STACK mode for placing tokens
  setAbilityMode({
    type: 'ENTER_MODE',
    mode: 'CREATE_STACK',
    sourceCard,
    sourceCoords,
    isDeployAbility,
    readyStatusToRemove,
    payload: {
      tokenType: payload?.tokenType || 'Exploit',
      count: 1,
      remainingTargets: validTargets.length,
      targets: validTargets,
      targetIndex: 0
    }
  })

  return true
}

/**
 * Handle AUTO_STEPS (Generic multi-step ability system)
 * Processes steps dynamically from database - no more hardcoded patterns!
 */
function handleAutoSteps(
  _card: Card,
  _boardCoords: { row: number; col: number },
  props: ModeHandlersProps
): boolean {
  const { abilityMode, gameState, addBoardCardStatus, setAbilityMode, commandContext, modifyBoardCardPower, setTargetingMode, calculateValidTargets } = props

  if (!abilityMode || abilityMode.mode !== "AUTO_STEPS") {
    return false
  }

  const { sourceCoords, payload, isDeployAbility, readyStatusToRemove, sourceCard } = abilityMode
  if (!payload || !payload.steps || payload.steps.length === 0) {
    return false
  }

  const currentStepIndex = payload.currentStepIndex || 0
  const currentStep = payload.steps[currentStepIndex]


  // Get the owner ID for this ability
  const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0

  // CRITICAL: CREATE_STACK with mode: null is NOT an instant action - it requires targeting
  // Commands like Data Interception, Temporary Shelter use CREATE_STACK with mode: null
  // We need to treat them as targeting actions, not instant steps
  const isTargetingCreateStack = currentStep.action === "CREATE_STACK" && !currentStep.mode

  // INSTANT STEPS (no mode) - execute automatically and move to next step
  if (!currentStep.mode && !isTargetingCreateStack) {

    // Use the universal instant step handler
    const instantStepProps: InstantStepProps = {
      gameState,
      localPlayerId: props.localPlayerId,
      commandContext,
      addBoardCardStatus,
      modifyBoardCardPower,
    }

    const result = executeInstantAutoStep(currentStep, sourceCoords, ownerId, instantStepProps)

    if (result.shouldAdvance) {
      advanceToNextStep(props, currentStepIndex)
    }
    return result.success
  }

  // INTERACTIVE STEPS (with mode) - enter the mode and wait for player input
  // OR CREATE_STACK with mode: null - treat as targeting action
  // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
  // These are targeting constraints, not separate modes. The constraint is stored in payload.
  const normalizedMode = (currentStep.mode === "LINE_TARGET" || currentStep.mode === "ADJACENT_TARGET")
    ? "SELECT_TARGET"
    : (currentStep.mode || "SELECT_TARGET")

  // CRITICAL: Use buildDetailsFromContent to convert filter strings to functions
  // This ensures filters like "isOwner" or "hasCounterOwner_Exploit" work correctly
  const processedDetails = buildDetailsFromContent(
    { details: currentStep.details, action: currentStep.action, mode: currentStep.mode } as any,
    ownerId,
    sourceCoords || { row: -1, col: -1 },
    gameState
  )

  // Build stepAction to check for valid targets
  const stepAction: AbilityAction = {
    type: "ENTER_MODE",
    mode: normalizedMode,
    sourceCard,
    sourceCoords,
    isDeployAbility,
    readyStatusToRemove,
    // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
    ...(currentStep.chainedAction ? { chainedAction: currentStep.chainedAction } : {}),
    payload: {
      ...processedDetails,
      actionType: currentStep.action,  // Set actionType so handleSelectTargetActionType knows how to handle this
      _autoStepsContext: {
        steps: payload.steps,
        currentStepIndex: currentStepIndex + 1,
        originalType: abilityMode.payload?.originalType,
        supportRequired: abilityMode.payload?.supportRequired,
        readyStatusToRemove: readyStatusToRemove,
        // CRITICAL: Pass commandCardId for CLEANUP_COMMAND to find the correct card (Logistics Chain, etc.)
        commandCardId: abilityMode.payload?.commandCardId || sourceCard?.id
      }
    }
  }

  // Handle CREATE_STACK - keep as CREATE_STACK, add targeting constraints
  // This will trigger handleCreateStack which creates the cursor stack
  // CRITICAL: Also handle CREATE_STACK with mode: null (e.g., Data Interception, Temporary Shelter)
  if (currentStep.action === "CREATE_STACK") {
    const details = processedDetails  // Use processedDetails with converted filters
    // Change type to CREATE_STACK (not OPEN_MODAL) so handleCreateStack is called
    stepAction.type = "CREATE_STACK"
    stepAction.count = details.count || 1  // handleCreateStack reads action.count
    stepAction.tokenType = details.tokenType  // handleCreateStack reads action.tokenType
    stepAction.sourceCard = sourceCard  // handleCreateStack needs this
    stepAction.sourceCoords = sourceCoords  // handleCreateStack needs this
    stepAction.isDeployAbility = isDeployAbility
    stepAction.readyStatusToRemove = readyStatusToRemove

    // CRITICAL: Copy all targeting properties to action level (not just payload)
    // handleCreateStack reads these from action, not from action.payload
    const targetingProps = [
      'targetOwnerId', 'excludeOwnerId', 'onlyOpponents', 'onlyFaceDown',
      'targetType', 'requiredTargetStatus', 'requireStatusFromSourceOwner',
      'mustBeAdjacentToSource', 'mustBeInLineWithSource',
      'maxDistanceFromSource', 'maxOrthogonalDistance',
      'placeAllAtOnce', 'replaceStatus', 'recordContext',
      'dynamicCount'
    ]
    for (const prop of targetingProps) {
      if (details[prop] !== undefined) {
        (stepAction as any)[prop] = details[prop]
      }
    }

    // Preserve all details in payload for handleCreateStack
    stepAction.payload = {
      ...details,
      _autoStepsContext: stepAction.payload._autoStepsContext
    }
    // CRITICAL: Preserve chainedAction from step level (not details level)
    // Temporary Shelter and other commands use this structure
    if (currentStep.chainedAction) {
      (stepAction as any).chainedAction = currentStep.chainedAction
    }
    if (currentStep.mode === "LINE_TARGET") {
      stepAction.mustBeInLineWithSource = true
    } else if (currentStep.mode === "ADJACENT_TARGET") {
      stepAction.mustBeAdjacentToSource = true
    }
  }

  // Handle CREATE_TOKEN - also transform to OPEN_MODAL/PLACE_TOKEN
  if (currentStep.action === "CREATE_TOKEN") {
    stepAction.type = "OPEN_MODAL"
    stepAction.mode = "PLACE_TOKEN"
    // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
    if (currentStep.chainedAction) {
      (stepAction as any).chainedAction = currentStep.chainedAction
    }
    // Preserve _autoStepsContext for continuation after token placement
    stepAction.payload = {
      ...currentStep.details,
      tokenId: currentStep.details?.tokenId,
      range: currentStep.mode === "ADJACENT_EMPTY" ? "adjacent" : "global",
      _autoStepsContext: {
        steps: payload.steps,
        currentStepIndex: currentStepIndex + 1,
        originalType: abilityMode.payload?.originalType,
        supportRequired: abilityMode.payload?.supportRequired,
        readyStatusToRemove: readyStatusToRemove
      }
    }
  }

  // Check if this interactive step has valid targets
  // If no targets, skip this step and advance to the next one
  if (calculateValidTargets) {
    const validTargets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)

    if (validTargets.length === 0) {
      // Clear targeting mode since we're skipping this step
      if (props.clearTargetingMode) {
        props.clearTargetingMode()
      }
      // Skip this step and advance to next
      advanceToNextStep(props, currentStepIndex)
      return true
    }
  }

  // Set abilityMode for interactive step with valid targets
  setAbilityMode(stepAction)

  // Mark source card as transitioning to prevent infinite re-processing
  // CRITICAL: Add this BEFORE setTargetingMode so it's active immediately
  if (sourceCard && sourceCoords) {
    const transitionKey = `${sourceCard.id}-${sourceCoords.row}-${sourceCoords.col}`
    transitioningCards.add(transitionKey)
    clearTransitioning(transitionKey, 200)
  }

  // Update targeting mode to show valid targets for the new mode
  if (setTargetingMode && calculateValidTargets) {
    const validTargets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)
    setTargetingMode(stepAction, ownerId, sourceCoords, validTargets, commandContext)
  }

  // CRITICAL: Return false for interactive steps!
  // This allows the click to be processed by the actual mode handler (e.g., handleSelectTargetActionType)
  // The targeting mode and abilityMode will be updated by the next click
  return false
}

/**
 * Advance to the next step in AUTO_STEPS
 */
function advanceToNextStep(
  props: ModeHandlersProps,
  completedStepIndex: number
): void {
  const { abilityMode, setAbilityMode, markAbilityUsed, gameState, commandContext, setTargetingMode, calculateValidTargets } = props

  if (!abilityMode || abilityMode.mode !== "AUTO_STEPS") {
    return
  }

  const payload = abilityMode.payload
  const autoStepsContext = payload?._autoStepsContext

  // Use steps from _autoStepsContext if available (for continuation after mode completion)
  const steps = autoStepsContext?.steps || payload?.steps

  if (!steps) {
    return
  }

  // Use readyStatusToRemove from _autoStepsContext if not set at action level
  const readyStatusToRemove = abilityMode.readyStatusToRemove ?? autoStepsContext?.readyStatusToRemove

  const nextStepIndex = completedStepIndex + 1

  if (nextStepIndex >= steps.length) {
    // All steps complete!
    const { sourceCoords, isDeployAbility } = abilityMode
    markAbilityUsed(sourceCoords || { row: 0, col: 0 }, isDeployAbility, false, readyStatusToRemove)
    setAbilityMode(null)
    // Also clear targeting mode if available
    if ((props as any).clearTargetingMode) {
      (props as any).clearTargetingMode()
    }
    return
  }

  const nextStep = steps[nextStepIndex]

  // If next step has no mode, execute it instantly
  if (!nextStep.mode) {
    // Execute instant step immediately without setTimeout
    const sourceCard = abilityMode.sourceCard
    const sourceCoords = abilityMode.sourceCoords
    const ownerId = sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0

    const instantStepProps = {
      gameState,
      localPlayerId: props.localPlayerId,
      commandContext,
      addBoardCardStatus: props.addBoardCardStatus,
      modifyBoardCardPower: props.modifyBoardCardPower,
    }

    const result = executeInstantAutoStep(nextStep, sourceCoords, ownerId, instantStepProps)

    if (result.shouldAdvance) {
      // Recursively advance to next step (might be another instant step or an interactive step)
      advanceToNextStep(props, nextStepIndex)
    }
    return
  } else {
    // Next step requires player interaction

    // Handle special action types
    let stepAction: AbilityAction

    // Handle CREATE_STACK - keep as CREATE_STACK to trigger handleCreateStack (cursor stack)
    if (nextStep.action === "CREATE_STACK") {
      const details = nextStep.details || {}
      stepAction = {
        type: "CREATE_STACK",
        mode: "SELECT_TARGET",
        sourceCard: abilityMode.sourceCard,
        sourceCoords: abilityMode.sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        tokenType: details.tokenType,
        count: details.count || 1,
        targetOwnerId: abilityMode.sourceCard?.ownerId,
        mustBeInLineWithSource: nextStep.mode === "LINE_TARGET" ? true : undefined,
        mustBeAdjacentToSource: nextStep.mode === "ADJACENT_TARGET" ? true : undefined,
        // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
        ...(nextStep.chainedAction ? { chainedAction: nextStep.chainedAction } : {}),
        payload: {
          ...nextStep.details,
          _autoStepsContext: {
            steps: steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: payload?.originalType || autoStepsContext?.originalType,
            supportRequired: payload?.supportRequired || autoStepsContext?.supportRequired,
            readyStatusToRemove: readyStatusToRemove
          }
        }
      }
    } else if (nextStep.action === "CREATE_TOKEN") {
      // CREATE_TOKEN needs to be converted to OPEN_MODAL with PLACE_TOKEN mode
      stepAction = {
        type: "OPEN_MODAL",
        mode: "PLACE_TOKEN",
        sourceCard: abilityMode.sourceCard,
        sourceCoords: abilityMode.sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
        ...(nextStep.chainedAction ? { chainedAction: nextStep.chainedAction } : {}),
        payload: {
          ...nextStep.details,
          tokenId: nextStep.details?.tokenId,
          range: nextStep.mode === "ADJACENT_EMPTY" ? "adjacent" : "global",
          _autoStepsContext: {
            steps: payload.steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: payload.originalType,
            supportRequired: payload.supportRequired
          }
        }
      }
    } else if (nextStep.action === "SCORE_POINTS") {
      // SCORE_POINTS - use the mode directly (SELECT_LINE_FOR_EXPLOIT_SCORING, etc.)
      // These modes have their own handlers in handleModeCardClick
      stepAction = {
        type: 'ENTER_MODE',
        mode: nextStep.mode || 'SELECT_TARGET',  // Use the mode from database
        sourceCard: abilityMode.sourceCard,
        sourceCoords: abilityMode.sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
        ...(nextStep.chainedAction ? { chainedAction: nextStep.chainedAction } : {}),
        payload: {
          ...nextStep.details,
          _autoStepsContext: {
            steps: payload.steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: payload.originalType,
            supportRequired: payload.supportRequired,
            readyStatusToRemove: readyStatusToRemove
          }
        }
      }
      // For LINE_TARGET mode (Unwavering Integrator), also set targetCoords if commandContext has it
      if (nextStep.mode === 'LINE_TARGET' && commandContext?.lastMovedCardCoords) {
        stepAction.payload.targetCoords = commandContext.lastMovedCardCoords
      }
    } else {
      // Default interactive step handling
      // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
      const normalizedMode = (nextStep.mode === "LINE_TARGET" || nextStep.mode === "ADJACENT_TARGET")
        ? "SELECT_TARGET"
        : (nextStep.mode || "SELECT_TARGET")

      stepAction = {
        type: "ENTER_MODE",
        mode: normalizedMode,
        sourceCard: abilityMode.sourceCard,
        sourceCoords: abilityMode.sourceCoords,
        isDeployAbility: abilityMode.isDeployAbility,
        readyStatusToRemove: readyStatusToRemove,
        // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
        ...(nextStep.chainedAction ? { chainedAction: nextStep.chainedAction } : {}),
        payload: {
          ...nextStep.details,
          actionType: nextStep.action,  // Set actionType so handleSelectTargetActionType knows how to handle this
          tokenType: nextStep.details?.tokenType,
          count: nextStep.details?.count,
          mustBeInLineWithSource: nextStep.mode === "LINE_TARGET" ? true : undefined,
          mustBeAdjacentToSource: nextStep.mode === "ADJACENT_TARGET" ? true : undefined,
          _autoStepsContext: {
            steps: payload.steps,
            currentStepIndex: nextStepIndex + 1,
            originalType: payload.originalType,
            supportRequired: payload.supportRequired
          }
        }
      }
    }

    setAbilityMode(stepAction)

    // Mark source card as transitioning to prevent infinite re-processing
    if (abilityMode.sourceCard && abilityMode.sourceCoords) {
      const transitionKey = `${abilityMode.sourceCard.id}-${abilityMode.sourceCoords.row}-${abilityMode.sourceCoords.col}`
      transitioningCards.add(transitionKey)
      clearTransitioning(transitionKey, 200)
    }

    // Update targeting mode to show valid targets for the new mode
    // CRITICAL: Check if there are valid targets - if not, skip this step
    // EXCEPTION: Line selection modes always have targets (lines on board), don't check validTargets
    const lineSelectionModes = ['SELECT_LINE_START', 'SELECT_LINE_END', 'SELECT_LINE_FOR_EXPLOIT_SCORING', 'SELECT_LINE_FOR_SUPPORT_COUNTERS', 'SELECT_LINE_FOR_THREAT_COUNTERS', 'SELECT_DIAGONAL']
    const isLineSelectionMode = stepAction.mode && lineSelectionModes.includes(stepAction.mode)

    const ownerId = abilityMode.sourceCard?.ownerId ?? gameState.activePlayerId ?? props.localPlayerId ?? 0
    const sourceCoords = abilityMode.sourceCoords
    const stepPayload = stepAction.payload  // Use stepPayload to avoid shadowing the outer payload variable

    if (setTargetingMode && calculateValidTargets && !isLineSelectionMode) {
      const validTargets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)

      if (validTargets.length === 0) {
        // Clear targeting mode and skip to next step
        if (props.clearTargetingMode) {
          props.clearTargetingMode()
        }
        // CRITICAL: Pass nextStepIndex + 1 to avoid infinite loop!
        advanceToNextStep(props, nextStepIndex + 1)
        return
      }

      setTargetingMode(stepAction, ownerId, sourceCoords, validTargets, commandContext)
    } else if (isLineSelectionMode) {
      // CRITICAL: Line selection modes use abilityMode directly, NOT targetingMode!
      // GameBoard handles visual highlighting via isLineSelectionMode() check and abilityMode.payload.targetCoords
      void (commandContext?.lastMovedCardCoords || stepPayload?.targetCoords)
    }
  }
}




