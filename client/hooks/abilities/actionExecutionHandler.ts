/**
 * Action Execution Handler
 *
 * Centralized execution of all ability actions
 * Extracted from useAppAbilities.ts
 */

import type { AbilityAction, GameState, CommandContext, DragItem } from '@/types'
import { checkActionHasTargets, calculateValidTargets, calculateHandTargets } from '@shared/utils/targeting'
import { buildFilterFromString } from '@shared/abilities/contentAbilities.js'
import { TIMING } from '@/utils/common'
import { createTokenCursorStack } from '@/utils/tokenTargeting'
import { executeInstantAutoStep, advanceToNextStepWithCoords, type AutoStep } from './modeHandlers.js'

export interface ActionHandlerProps {
  gameState: GameState
  getFreshGameState: () => GameState // Функция для получения свежего состояния
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  cursorStack: any
  setCursorStack: React.Dispatch<React.SetStateAction<any>>
  commandContext: CommandContext
  setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>
  playMode: any
  setPlayMode: React.Dispatch<React.SetStateAction<any>>
  draggedItem: DragItem | null
  setDraggedItem: React.Dispatch<React.SetStateAction<DragItem | null>>
  openContextMenu: (e: React.MouseEvent, type: string, data: any) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  triggerNoTarget: (coords: { row: number; col: number }) => void
  triggerClickWave: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number; cardIndex: number }) => void
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  interactionLock: React.MutableRefObject<boolean>
  moveItem: (item: DragItem, target: any) => void
  swapCards: (coords1: {row: number, col: number}, coords2: {row: number, col: number}) => void
  transferStatus: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}, statusType: string) => void
  transferAllCounters: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  transferAllStatusesWithoutException: (fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => void
  destroyCard: (card: any, boardCoords: { row: number; col: number }) => void
  spawnToken: (coords: {row: number, col: number}, name: string, ownerId: number) => void
  modifyBoardCardPower: (coords: {row: number, col: number}, delta: number) => void
  addBoardCardStatus: (coords: {row: number, col: number}, status: string, pid: number, count?: number) => void
  removeBoardCardStatus: (coords: {row: number, col: number}, status: string) => void
  removeBoardCardStatusByOwner: (coords: {row: number, col: number}, status: string, pid: number) => void
  removeStatusByType: (coords: {row: number; col: number}, type: string) => void
  resetDeployStatus: (coords: {row: number; col: number}) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: any) => void
  triggerDeckSelection: (playerId: number, selectedByPlayerId: number) => void
  setCounterSelectionData: React.Dispatch<React.SetStateAction<any>>
  setViewingDiscard: React.Dispatch<React.SetStateAction<any>>
  validTargets?: {row: number, col: number}[]
  handleLineSelection: (coords: {row: number, col: number}) => void
  onAbilityComplete?: () => void
  applyGlobalEffect: (source: any, targets: any[], type: string, pid: number, isDeploy: boolean) => void
  drawCardsBatch: (playerId: number, count: number) => void
  setTargetingMode: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: CommandContext, preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]) => void
  clearTargetingMode?: () => void
  // P2P: sendAction for GLOBAL_AUTO_APPLY with contextCardId (False Orders Stun x2)
  sendAction?: (action: string, data?: any) => void
  pendingChainedActionRef?: React.MutableRefObject<boolean>
  setActionQueue?: React.Dispatch<React.SetStateAction<any[]>>
}

/**
 * Safely extract playerId from action, with fallbacks
 * Ensures we always return a number
 */
function getSafePlayerId(
  action: AbilityAction,
  localPlayerId: number | null
): number {
  const sourceCardOwnerId = action.sourceCard?.ownerId
  if (typeof sourceCardOwnerId === 'number') {
    return sourceCardOwnerId
  }
  if (typeof localPlayerId === 'number') {
    return localPlayerId
  }
  return 0
}

/**
 * Main action execution handler
 */
export function handleActionExecution(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const {
    gameState,
    getFreshGameState, // Функция для получения свежего состояния
    localPlayerId,
    commandContext,
    triggerNoTarget,
    onAbilityComplete,
    handleActionExecution: execAction,
  } = props

  // Handle ABILITY_COMPLETE
  if (action.type === 'ABILITY_COMPLETE') {
    onAbilityComplete?.()
    return
  }

  // Handle REVEREND_SETUP_SCORE
  if (action.type === 'REVEREND_SETUP_SCORE') {
    handleReverendSetupScore(action, sourceCoords, props)
    return
  }

  // Handle CONTINUE_AUTO_STEPS - Continues AUTO_STEPS after cursorStack completion
  if (action.type === 'CONTINUE_AUTO_STEPS') {
    handleContinueAutoSteps(action, sourceCoords, props)
    return
  }

  // 1. GLOBAL_AUTO_APPLY
  if (action.type === 'GLOBAL_AUTO_APPLY') {
    handleGlobalAutoApply(action, sourceCoords, props)
    return
  }

  // 2. Check Valid Targets (before CREATE_STACK)
  // Skip check for line selection modes - they always have valid targets (the lines through source card)
  const shouldSkipTargetCheck = action.type === 'ENTER_MODE' && (
    action.mode === 'SELECT_LINE_FOR_SUPPORT_COUNTERS' ||
    action.mode === 'SELECT_LINE_FOR_THREAT_COUNTERS' ||
    action.mode === 'SELECT_LINE_FOR_EXPLOIT_SCORING'
  )

  if (!shouldSkipTargetCheck) {
    // CRITICAL: Use getFreshGameState() for target check to include tokens just placed
    // This fixes Data Interception option 1 where SELECT_UNIT_FOR_MOVE needs to see
    // the Exploit token placed in the previous step
    const freshGameStateForCheck = getFreshGameState ? getFreshGameState() : gameState
    const hasTargets = checkActionHasTargets(action, freshGameStateForCheck, action.sourceCard?.ownerId || localPlayerId, commandContext)

    if (!hasTargets) {
      triggerNoTarget(sourceCoords)
      // Only execute chained action if skipChainedActionOnNoTargets is not set
      // This prevents abilities like Recon Drone Commit from creating token stacks when no valid targets exist
      if (action.chainedAction && !action.skipChainedActionOnNoTargets) {
        setTimeout(() => {
          if (props.pendingChainedActionRef) {
            props.pendingChainedActionRef.current = true
          }
          execAction(action.chainedAction!, sourceCoords)
          // Clear the flag after React has processed state updates
          setTimeout(() => {
            if (props.pendingChainedActionRef) {
              props.pendingChainedActionRef.current = false
            }
          }, 50)
        }, 1000)
      }
      return
    }
  }

  // 3. CREATE_STACK
  if (action.type === 'CREATE_STACK') {
    handleCreateStack(action, sourceCoords, props)
    return
  }

  // 4. OPEN_MODAL
  if (action.type === 'OPEN_MODAL') {
    handleOpenModal(action, sourceCoords, props)
    return
  }

  // 5. ENTER_MODE
  if (action.type === 'ENTER_MODE') {
    handleEnterMode(action, sourceCoords, props)
    return
  }
}

/**
 * Handle REVEREND_SETUP_SCORE action
 */
function handleReverendSetupScore(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, updatePlayerScore, triggerFloatingText, markAbilityUsed } = props
  // CRITICAL: Use getFreshGameState() to get the latest state from host/guest
  // This ensures we count Exploit tokens added in previous steps of multi-step commands
  const freshState = getFreshGameState()

  // CRITICAL: Get ownerId from the actual card at sourceCoords, not from action.sourceCard
  // This fixes the bug where two dummy players have cards with the same name
  const actualCard = freshState.board[sourceCoords.row]?.[sourceCoords.col]?.card
  const ownerId = actualCard?.ownerId ?? action.sourceCard?.ownerId ?? 0

  let exploitCount = 0

  for (let r = 0; r < freshState.board.length; r++) {
    for (let c = 0; c < freshState.board[r].length; c++) {
      const card = freshState.board[r][c]?.card
      if (card?.statuses) {
        const exploitCounters = card.statuses.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === ownerId)
        exploitCount += exploitCounters.length
      }
    }
  }

  if (exploitCount > 0) {
    updatePlayerScore(ownerId, exploitCount)
  }

  triggerFloatingText([{
    row: sourceCoords.row,
    col: sourceCoords.col,
    text: `+${exploitCount}`,
    playerId: ownerId,
  }])

  markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
}

/**
 * Handle CONTINUE_AUTO_STEPS action
 * Continues AUTO_STEPS sequence after cursorStack completion
 * This enables abilities like Centurion Commit to continue after CREATE_STACK step
 */
function handleContinueAutoSteps(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, setAbilityMode, setTargetingMode, clearTargetingMode, commandContext, localPlayerId, markAbilityUsed, addBoardCardStatus, modifyBoardCardPower, handleActionExecution, calculateValidTargets } = props

  const autoStepsContext = action.payload?._autoStepsContext
  if (!autoStepsContext || !autoStepsContext.steps) {
    markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    return
  }

  const steps = autoStepsContext.steps
  const currentStepIndex = autoStepsContext.currentStepIndex
  const stepContext = action.payload?.stepContext
  // CRITICAL: Extract chainedAction from payload for execution after step completes
  // This fixes False Orders Option 2 where Stun x2 needs to be placed after move
  const chainedActionFromStep = action.payload?.chainedAction

  console.log('[handleContinueAutoSteps] Processing:', {
    currentStepIndex,
    stepsLength: steps.length,
    steps: steps.map((s, i) => `${i}: ${s.action}`),
    nextStep: steps[currentStepIndex] ? `${steps[currentStepIndex].action} (mode: ${steps[currentStepIndex].mode})` : 'undefined',
    sourceCardId: action.sourceCard?.id,
    stepContextSourceOwnerId: stepContext?.sourceOwnerId,
    stepContextTargetOwnerId: (stepContext as any)?._sourceOwnerId,
    hasChainedAction: !!chainedActionFromStep,
    chainedActionType: chainedActionFromStep?.type,
    stepContextLastPlacedToken: stepContext?.lastPlacedToken,
    commandContextLastPlacedToken: commandContext?.lastPlacedToken,
  })

  // CRITICAL: currentStepIndex is the COMPLETED step index from autoStepsContext
  // advanceToNextStepWithCoords expects the COMPLETED step index and will calculate nextStepIndex itself
  const completedStepIndex = currentStepIndex

  // Check if there are more steps
  if (completedStepIndex >= steps.length) {
    // All steps complete!
    console.log('[handleContinueAutoSteps] All steps complete, no more steps to execute')
    markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    setAbilityMode(null)
    return
  }

  console.log('[handleContinueAutoSteps] Advancing from completed step:', {
    completedStepIndex,
    nextStepIndex: completedStepIndex + 1,
    nextStepAction: steps[completedStepIndex + 1]?.action,
    nextStepMode: steps[completedStepIndex + 1]?.mode,
  })

  // Create a temporary abilityMode for advanceToNextStepWithCoords
  const tempAbilityMode: AbilityAction = {
    type: 'ENTER_MODE',
    mode: 'AUTO_STEPS',
    sourceCard: action.sourceCard,
    sourceCoords: action.sourceCoords,
    isDeployAbility: action.isDeployAbility,
    readyStatusToRemove: action.readyStatusToRemove,
    payload: {
      steps: steps,
      currentStepIndex: completedStepIndex,
      _autoStepsContext: autoStepsContext,
    },
  }

  // Call advanceToNextStepWithCoords with the necessary props
  // CRITICAL: Pass completedStepIndex + 1 because advanceToNextStepWithCoords uses the index directly
  // Type assertion: we pass a subset of ModeHandlersProps
  advanceToNextStepWithCoords(
    {
      abilityMode: tempAbilityMode,
      setAbilityMode,
      markAbilityUsed,
      gameState,
      getFreshGameState,
      commandContext,
      setTargetingMode,
      clearTargetingMode,
      calculateValidTargets,
      localPlayerId,
      addBoardCardStatus,
      modifyBoardCardPower,
      handleActionExecution,
    } as any,
    sourceCoords,
    completedStepIndex + 1,
    stepContext,
    chainedActionFromStep
  )
}

/**
 * Handle GLOBAL_AUTO_APPLY action
 */
function handleGlobalAutoApply(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, localPlayerId, commandContext, markAbilityUsed, triggerNoTarget, triggerFloatingText, updatePlayerScore, applyGlobalEffect, addBoardCardStatus, removeStatusByType, handleActionExecution: execAction, sendAction } = props

  // CRITICAL: Use _commandContext from payload if available (from AUTO_STEPS)
  // This ensures that lastPlacedToken from stepContext is available
  const effectiveCommandContext = (action.payload as any)?._commandContext || commandContext

  // P2P: Token placement on moved card (False Orders option 2: Stun x2)
  // Send to host for processing since client can't directly modify shared state
  // CRITICAL: Handle both contextCardId and _tempContextId (for finding moved card)
  if (action.payload?.tokenType && (action.payload?.count || action.payload?.count === 0)) {
    const hasContextCardId = !!action.payload?.contextCardId
    const hasTempContextId = !!action.payload?._tempContextId
    const hasContextCoords = !!action.payload?.lastMovedCardCoords

    if (sendAction && (hasContextCardId || hasTempContextId || hasContextCoords)) {
      // Send action to host with full payload
      sendAction('GLOBAL_AUTO_APPLY', {
        payload: action.payload,
        sourceCard: action.sourceCard,
      })
      markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      return
    }
    // CRITICAL: If no sendAction (local mode) or no context, try to handle locally
    console.log('[handleGlobalAutoApply] Token placement without sendAction or context:', {
      tokenType: action.payload.tokenType,
      count: action.payload.count,
      contextCardId: action.payload.contextCardId,
      _tempContextId: action.payload._tempContextId,
      lastMovedCardCoords: action.payload.lastMovedCardCoords,
      hasSendAction: !!sendAction,
    })
  }

  // FINN_SCORING
  if (action.payload?.customAction === 'FINN_SCORING') {
    const finnOwnerId = action.sourceCard?.ownerId
    if (finnOwnerId === undefined) {
      markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      return
    }

    let revealedCount = 0

    // CRITICAL: Use getFreshGameState() to get the latest state from host/guest
    // This ensures we count tokens added in previous steps of multi-step commands
    const freshState = getFreshGameState()

    // Count in opponents' hands
    freshState.players.forEach((p: any) => {
      if (p.id !== finnOwnerId) {
        p.hand.forEach((c: any) => {
          if (c.statuses?.some((s: any) => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId)) {
            revealedCount++
          }
        })
      }
    })

    // Count on battlefield
    freshState.board.forEach((row: any[]) => {
      row.forEach((cell: any) => {
        const card = cell.card
        if (card && card.ownerId !== finnOwnerId) {
          const revealedByFinn = card.statuses?.filter((s: any) => s.type === 'Revealed' && s.addedByPlayerId === finnOwnerId).length || 0
          revealedCount += revealedByFinn
        }
      })
    })

    if (revealedCount > 0) {
      const coords = action.sourceCoords || sourceCoords
      triggerFloatingText({
        row: coords.row,
        col: coords.col,
        text: `+${revealedCount}`,
        playerId: finnOwnerId,
      })
      updatePlayerScore(finnOwnerId, revealedCount)
    }

    markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    return
  }

  // REMOVE_ALL_AIM_FROM_CONTEXT
  if (action.payload?.customAction === 'REMOVE_ALL_AIM_FROM_CONTEXT') {
    if (action.sourceCoords && action.sourceCoords.row >= 0) {
      removeStatusByType(action.sourceCoords, 'Aim')
    } else if (effectiveCommandContext.lastMovedCardCoords) {
      removeStatusByType(effectiveCommandContext.lastMovedCardCoords, 'Aim')
    }
    return
  }

  // Token filtering with filter function
  if (action.payload?.tokenType && action.payload.filter) {
    const { tokenType, filter } = action.payload
    const targets: { row: number; col: number }[] = []

    // CRITICAL: Use getFreshGameState() to get the latest state from host/guest
    // This ensures filters that check for tokens added in previous steps work correctly
    const freshState = getFreshGameState()
    const gridSize = freshState.board.length

    // DIAGNOSTIC: Log filter execution start

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const card = freshState.board[r][c].card
        if (card && filter(card, r, c)) {
          targets.push({ row: r, col: c })
        }
      }
    }


    if (targets.length === 0) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      if (action.chainedAction) {
        setTimeout(() => {
          if (props.pendingChainedActionRef) {
            props.pendingChainedActionRef.current = true
          }
          execAction(action.chainedAction!, sourceCoords)
          setTimeout(() => {
            if (props.pendingChainedActionRef) {
              props.pendingChainedActionRef.current = false
            }
          }, 50)
        }, 1000)
      }
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }

    // Apply to all targets
    targets.forEach(target => {
      addBoardCardStatus(target, tokenType, action.sourceCard?.ownerId || 0)
    })

    markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)

    if (action.chainedAction) {
      // DIAGNOSTIC: Log chainedAction execution

      // CRITICAL: Use longer delay to ensure gameState updates before chainedAction executes
      // This fixes commands like Data Interception where dynamicCount needs to see tokens
      // added in the current step before calculating counts for the next step
      setTimeout(() => {
        if (props.pendingChainedActionRef) {
          props.pendingChainedActionRef.current = true
        }
        execAction(action.chainedAction!, sourceCoords)
        setTimeout(() => {
          if (props.pendingChainedActionRef) {
            props.pendingChainedActionRef.current = false
          }
        }, 50)
      }, 1000)
    }
    return
  }

  // Context reward (DRAW_MOVED_POWER, SCORE_MOVED_POWER)
  if (action.payload?.contextReward) {
    handleContextReward(action, sourceCoords, props)

    // CRITICAL: Continue AUTO_STEPS if this was part of a multi-step command
    // This ensures CLEANUP_COMMAND is executed after contextReward step (Tactical Maneuver)
    const autoStepsContext = (action.payload as any)?._autoStepsContext
    if (autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined) {
      console.log('[contextReward] Continuing AUTO_STEPS after reward:', {
        rewardType: action.payload.contextReward,
        currentStepIndex: autoStepsContext.currentStepIndex,
        totalSteps: autoStepsContext.steps.length,
      })
      // CRITICAL: Do NOT increment currentStepIndex here!
      // handleContinueAutoSteps will pass it to advanceToNextStepWithCoords as the COMPLETED step index,
      // and advanceToNextStepWithCoords will correctly calculate the next step index.
      // This fixes the bug where currentStepIndex: 2 exceeded stepsLength: 2
      const continueAction: AbilityAction = {
        type: 'CONTINUE_AUTO_STEPS',
        mode: 'AUTO_STEPS',
        payload: {
          _autoStepsContext: {
            ...autoStepsContext,
            // Keep currentStepIndex as-is - it represents the step that just completed
            currentStepIndex: autoStepsContext.currentStepIndex,
          },
        },
        sourceCard: action.sourceCard,
        sourceCoords: action.sourceCoords || sourceCoords,
      }
      if (props.setActionQueue) {
        setTimeout(() => {
          props.setActionQueue((prev: any[]) => [...prev, continueAction])
        }, 0)
      } else {
        setTimeout(() => {
          execAction(continueAction, sourceCoords)
        }, 100)
      }
    }
    return
  }

  // Handle dynamicResource (Overwatch Option 2: draw cards for each token)
  if (action.payload?.dynamicResource) {
    const { type, factor, baseCount = 0 } = action.payload.dynamicResource
    if (type === 'draw') {
      const ownerId = action.sourceCard?.ownerId ?? localPlayerId ?? 0
      const freshState = getFreshGameState()
      let tokenCount = 0

      // Count tokens of specified type owned by this player on battlefield
      freshState.board.forEach((row: any[]) => {
        row.forEach((cell: any) => {
          if (cell.card?.statuses) {
            const matchingTokens = cell.card.statuses.filter((s: any) =>
              s.type === factor && s.addedByPlayerId === ownerId
            )
            tokenCount += matchingTokens.length
          }
        })
      })

      const totalToDraw = baseCount + tokenCount

      console.log('dynamicResource draw:', { factor, baseCount, tokenCount, totalToDraw, ownerId })

      if (totalToDraw > 0 && props.drawCardsBatch) {
        // Draw cards using batch method
        props.drawCardsBatch(ownerId, totalToDraw)

        // Show floating text
        triggerFloatingText([{
          row: sourceCoords.row,
          col: sourceCoords.col,
          text: `+${totalToDraw}`,
          playerId: ownerId,
        }])
      }

      markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)

      // CRITICAL: Continue AUTO_STEPS if this was part of a multi-step command
      // This ensures CLEANUP_COMMAND is executed after dynamicResource step
      const autoStepsContext = (action.payload as any)?._autoStepsContext
      if (autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined) {
        console.log('[dynamicResource] Continuing AUTO_STEPS after draw:', {
          currentStepIndex: autoStepsContext.currentStepIndex,
          totalSteps: autoStepsContext.steps.length,
        })
        // Create CONTINUE_AUTO_STEPS action to advance to the next step
        const continueAction: AbilityAction = {
          type: 'CONTINUE_AUTO_STEPS',
          mode: 'AUTO_STEPS',
          payload: {
            _autoStepsContext: {
              ...autoStepsContext,
              currentStepIndex: autoStepsContext.currentStepIndex + 1,
            },
          },
          sourceCard: action.sourceCard,
          sourceCoords: action.sourceCoords || sourceCoords,
        }
        if (props.setActionQueue) {
          setTimeout(() => {
            props.setActionQueue((prev: any[]) => [...prev, continueAction])
          }, 0)
        } else {
          setTimeout(() => {
            execAction(continueAction, sourceCoords)
          }, 100)
        }
      }

      // Execute chained action if present (for non-AUTO_STEPS commands)
      if (action.chainedAction && !autoStepsContext) {
        setTimeout(() => {
          if (props.pendingChainedActionRef) {
            props.pendingChainedActionRef.current = true
          }
          execAction(action.chainedAction!, sourceCoords)
          setTimeout(() => {
            if (props.pendingChainedActionRef) {
              props.pendingChainedActionRef.current = false
            }
          }, 50)
        }, 500)
      }
      return
    }
  }

  // Note: SACRIFICE_AND_BUFF_LINES (Centurion Commit) and CENSOR_SWAP (Censor Commit)
  // are now handled in modeHandlers.ts, not here

  // CRITICAL: Handle chainedAction for GLOBAL_AUTO_APPLY in AUTO_STEPS (e.g., False Orders Option 1)
  // This executes the chainedAction (e.g., CREATE_STACK for Revealed tokens) after the GLOBAL_AUTO_APPLY step
  // The chainedAction is included in the action by advanceToNextStepWithCoords
  if (action.chainedAction) {
    console.log('[handleGlobalAutoApply] Executing chainedAction for GLOBAL_AUTO_APPLY:', {
      chainedActionType: action.chainedAction.type,
      chainedActionToken: (action.chainedAction as any).tokenType || (action.chainedAction as any).payload?.tokenType,
    })
    // CRITICAL: Use shorter delay for AUTO_STEPS chainedAction to maintain flow
    setTimeout(() => {
      if (props.pendingChainedActionRef) {
        props.pendingChainedActionRef.current = true
      }
      execAction(action.chainedAction, sourceCoords)
      setTimeout(() => {
        if (props.pendingChainedActionRef) {
          props.pendingChainedActionRef.current = false
        }
      }, 50)
    }, 100)
    return
  }

  // Handle CLEANUP_COMMAND customAction - send command card to discard after all steps complete
  // This is added automatically by contentAbilities.ts for all command cards
  if (action.payload?.customAction === 'CLEANUP_COMMAND') {
    console.log('[handleGlobalAutoApply] CLEANUP_COMMAND triggered, discarding command card')
    markAbilityUsed(action.sourceCoords || sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)

    // CRITICAL: Use commandCardId and commandCardOwnerId from _autoStepsContext if available
    // This ensures we discard the correct command card even after sourceCard was replaced
    // (e.g., Data Interception Option 2, Enhanced Interrogation Option 2)
    const autoStepsContext = (action.payload as any)?._autoStepsContext
    const commandCardId = autoStepsContext?.commandCardId || action.sourceCard?.id

    // CRITICAL: Use stored commandCardOwnerId to find the correct player's announced card
    // This fixes issues where sourceCard.ownerId is the moved card's owner, not command owner
    const ownerId = autoStepsContext?.commandCardOwnerId ?? action.sourceCard?.ownerId ?? localPlayerId ?? 0

    // CRITICAL: Verify the card is actually a command card (starts with CMD_)
    // If sourceCard is not a command card, don't use it for cleanup
    let finalCardId = commandCardId
    if (action.sourceCard && !action.sourceCard.id.startsWith('CMD_')) {
      // sourceCard is not a command card, use commandCardId from context
      finalCardId = commandCardId
    }

    console.log('[handleGlobalAutoApply] Sending CLEANUP_COMMAND:', {
      ownerId,
      cardId: finalCardId,
      sourceCard: action.sourceCard,
      hasAutoStepsContext: !!autoStepsContext,
      commandCardId: autoStepsContext?.commandCardId,
      commandCardOwnerId: autoStepsContext?.commandCardOwnerId,
      sourceCardIsCommand: action.sourceCard?.id?.startsWith('CMD_')
    })

    if (props.sendAction && finalCardId) {
      // Use CLEANUP_COMMAND action for P2P mode (requires cardId)
      props.sendAction('CLEANUP_COMMAND', { playerId: ownerId, cardId: finalCardId })
    } else if (props.moveAnnouncedToDiscard) {
      props.moveAnnouncedToDiscard(ownerId)
    }
    return
  }

  // Handle cleanupCommand - send command card to discard after all steps complete
  if (action.payload?.cleanupCommand && action.payload.card && props.sendAction) {
    const commandCard = action.payload.card as Card
    const ownerId = action.payload.ownerId as number
    props.sendAction('MOVE_ANNOUNCED_TO_DISCARD', { playerId: ownerId })
    return
  }

  // Standard global apply with targets
  if (action.payload && !action.payload.cleanupCommand) {
    const { tokenType, filter } = action.payload
    const targets: { row: number; col: number }[] = []

    // CRITICAL: Use getFreshGameState() to get the latest state from host/guest
    // This ensures filters that check for tokens added in previous steps work correctly
    const freshState = getFreshGameState()
    const gridSize = freshState.board.length

    // NOTE: Context rewards (DRAW_MOVED_POWER, SCORE_MOVED_POWER) are handled earlier in this function
    // at line 454-456 to ensure proper AUTO_STEPS continuation

    if (filter) {
      for (let r = 0; r < gridSize; r++) {
        for (let c = 0; c < gridSize; c++) {
          const targetCard = freshState.board[r][c].card
          if (targetCard && filter(targetCard)) {
            targets.push({ row: r, col: c })
          }
        }
      }
    } else {
      if (action.sourceCoords && action.sourceCoords.row >= 0) {
        targets.push(action.sourceCoords)
      } else if (sourceCoords && sourceCoords.row >= 0) {
        targets.push(sourceCoords)
      } else if (effectiveCommandContext.lastMovedCardCoords) {
        targets.push(effectiveCommandContext.lastMovedCardCoords)
      }
    }

    if (targets.length > 0) {
      if (tokenType) {
        const count = action.payload.count || 1
        const addedBy = action.payload.ownerId !== undefined
          ? action.payload.ownerId
          : (action.sourceCard?.ownerId ?? localPlayerId ?? 0)

        for (let i = 0; i < count; i++) {
          applyGlobalEffect(sourceCoords, targets, tokenType, addedBy, !!action.isDeployAbility)
        }
      }
    } else {
      triggerNoTarget(sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
    }
    return
  }
}

/**
 * Handle CREATE_STACK action
 * Uses universal token targeting system via createTokenCursorStack
 */
function handleCreateStack(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  // CRITICAL: Extract commandContext first before logging
  const { gameState, getFreshGameState, setAbilityMode, setCursorStack, triggerNoTarget, localPlayerId, setTargetingMode, addBoardCardStatus, markAbilityUsed, handleActionExecution: execAction, commandContext } = props

  const callStack = new Error().stack?.split('\n').slice(2, 5).map(line => line.trim())
  console.log('CREATE_STACK action:', {
    tokenType: action.tokenType,
    payloadTokenType: action.payload?.tokenType,
    count: action.count,
    payloadCount: action.payload?.count,
    sourceCard: action.sourceCard?.name,
    sourceCardOwnerId: action.sourceCard?.ownerId,
    hasChainedAction: !!action.chainedAction,
    chainedActionType: action.chainedAction?.type,
    chainedActionMode: action.chainedAction?.mode,
    chainedActionPayloadCustomAction: action.chainedAction?.payload?.customAction,
    onlyOpponents: action.onlyOpponents,
    payloadOnlyOpponents: action.payload?.onlyOpponents,
    excludeOwnerId: action.excludeOwnerId,
    targetOwnerId: action.targetOwnerId,
    payloadTargetOwnerId: action.payload?.targetOwnerId,
    detailsTargetOwnerId: (action as any).details?.targetOwnerId,
    actionSourceOwnerId: (action as any)._sourceOwnerId,
    commandContextSourceOwnerId: commandContext?.sourceOwnerId,
    targetLocation: action.payload?.targetLocation,
    localPlayerId: props.localPlayerId,
    maxDistanceFromSource: action.maxDistanceFromSource ?? action.payload?.maxDistanceFromSource,
    maxOrthogonalDistance: action.maxOrthogonalDistance ?? action.payload?.maxOrthogonalDistance,
    callStack,
  })

  // CRITICAL: Resolve targetOwnerId -2 (TARGET_MOVED_OWNER) before processing CREATE_STACK
  // This fixes False Orders Option 1 where chainedAction is executed directly from useAppCounters
  // bypassing advanceToNextStepWithCoords where the resolution normally happens
  const actionSourceOwnerId = (action as any)._sourceOwnerId ?? commandContext?.sourceOwnerId
  if (actionSourceOwnerId !== undefined) {
    // CRITICAL: Check ALL locations where targetOwnerId might be stored
    // contentDatabase.json uses details.targetOwnerId, modeHandlers copies to both details and payload
    const needsResolution =
      (action.targetOwnerId === -2) ||
      (action.payload?.targetOwnerId === -2) ||
      ((action as any).details?.targetOwnerId === -2)

    if (needsResolution) {
      console.log('[handleCreateStack] Resolving targetOwnerId -2:', {
        actionTargetOwnerId: action.targetOwnerId,
        payloadTargetOwnerId: action.payload?.targetOwnerId,
        detailsTargetOwnerId: (action as any).details?.targetOwnerId,
        actionSourceOwnerId,
        resolvedTargetOwnerId: actionSourceOwnerId,
      })

      // Update ALL locations with resolved value
      if (action.targetOwnerId === -2) {
        action.targetOwnerId = actionSourceOwnerId
      }
      if (action.payload?.targetOwnerId === -2) {
        action.payload.targetOwnerId = actionSourceOwnerId
      }
      if ((action as any).details?.targetOwnerId === -2) {
        (action as any).details.targetOwnerId = actionSourceOwnerId
      }
    }
  }

  // CRITICAL: Resolve "source" string to actual owner ID
  // This fixes Temporary Shelter and other commands where "source" placeholder is not resolved
  // Get the source owner ID (command card owner for commands, unit owner for abilities)
  const sourceOwnerIdForResolution = action.sourceCard?.ownerId ?? actionSourceOwnerId ?? localPlayerId ?? 0

  // CRITICAL: Check ALL locations where targetOwnerId might be stored
  // contentDatabase.json uses details.targetOwnerId, modeHandlers copies to both details and payload
  const actionTargetOwnerId = action.targetOwnerId
  const payloadTargetOwnerId = action.payload?.targetOwnerId
  const detailsTargetOwnerId = (action as any).details?.targetOwnerId

  const needsSourceResolution =
    (actionTargetOwnerId === 'source') ||
    (payloadTargetOwnerId === 'source') ||
    (detailsTargetOwnerId === 'source')

  // DIAGNOSTIC: Log targetOwnerId values to debug Temporary Shelter
  console.log('[handleCreateStack] Checking targetOwnerId for "source":', {
    actionTargetOwnerId,
    payloadTargetOwnerId,
    detailsTargetOwnerId,
    needsSourceResolution,
    sourceOwnerIdForResolution,
  })

  if (needsSourceResolution) {
    console.log('[handleCreateStack] Resolving targetOwnerId "source":', {
      actionTargetOwnerId,
      payloadTargetOwnerId,
      detailsTargetOwnerId,
      resolvedOwnerId: sourceOwnerIdForResolution,
    })

    // Update ALL locations with resolved value
    if (actionTargetOwnerId === 'source') {
      action.targetOwnerId = sourceOwnerIdForResolution
    }
    if (action.payload?.targetOwnerId === 'source') {
      action.payload.targetOwnerId = sourceOwnerIdForResolution
    }
    if ((action as any).details?.targetOwnerId === 'source') {
      (action as any).details.targetOwnerId = sourceOwnerIdForResolution
    }
  }

  // CRITICAL: Read count from both action and payload (chained actions use payload format)
  // This fixes False Orders option 1 where chainedAction has count in payload
  let count = action.count || action.payload?.count || 0

  // Special Case: Abilities with requiredTargetStatus (Riot Agent Commit, etc.) - check valid targets at application time
  // CRITICAL: Mark ability as used FIRST (remove ready status, add "used this turn")
  // This happens regardless of whether there are valid targets or not
  if (action.requiredTargetStatus) {
    if (action.readyStatusToRemove) {
      markAbilityUsed(action.sourceCoords || sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)
    }

    // CRITICAL: Use getFreshGameState() to get the latest state from host/guest
    const freshGameState = getFreshGameState ? getFreshGameState() : gameState
    const validTargets = calculateValidTargets(action, freshGameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (validTargets.length === 0) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // Ready status already removed, ability marked as used
      return
    }
    // Continue to create cursorStack...
  }

  // Handle Dynamic Count
  if (action.dynamicCount) {
    const { factor, ownerId: rawOwnerId } = action.dynamicCount
    let dynamic = 0
    const tokenLocations: {row: number, col: number, cardName: string}[] = []

    // CRITICAL: Resolve "source" string to actual owner ID for dynamicCount
    // This fixes Enhanced Interrogation where dynamicCount.ownerId is "source" string
    const sourceOwnerIdForResolution = action.sourceCard?.ownerId ?? actionSourceOwnerId ?? localPlayerId ?? 0
    const ownerId = rawOwnerId === 'source' ? sourceOwnerIdForResolution : rawOwnerId

    // CRITICAL: Use getFreshGameState() instead of gameState to get the most up-to-date state
    // This fixes commands like Data Interception where dynamicCount needs to see tokens
    // added in previous steps (e.g., Exploit counters placed in the same command)
    const freshState = getFreshGameState()

    // Also check commandContext.lastPlacedToken for tokens just placed in current step
    const justPlaced = commandContext?.lastPlacedToken
    let justPlacedCounted = false

    freshState.board.forEach((r: any[], rowIdx: number) => {
      r.forEach((c: any, colIdx: number) => {
        if (c.card?.statuses) {
          const matchingTokens = c.card.statuses.filter((s: any) => s.type === factor && s.addedByPlayerId === ownerId)
          if (matchingTokens.length > 0) {
            dynamic += matchingTokens.length
            tokenLocations.push({ row: rowIdx, col: colIdx, cardName: c.card.name })
          }
        }
      })
    })

    // DIAGNOSTIC: Check if token was just placed but not yet in freshState
    if (justPlaced && justPlaced.tokenType === factor && justPlaced.addedByPlayerId === ownerId) {
      if (!tokenLocations.some(t => t.row === justPlaced.boardCoords?.row && t.col === justPlaced.boardCoords?.col)) {
        dynamic += 1
        tokenLocations.push({
          row: justPlaced.boardCoords?.row ?? -1,
          col: justPlaced.boardCoords?.col ?? -1,
          cardName: '(just placed via commandContext)'
        })
        justPlacedCounted = true
      }
    }

    // DIAGNOSTIC: Log dynamic count calculation with detailed info
    console.log('[CREATE_STACK] Dynamic count calculation:', {
      factor,
      ownerId,
      dynamic,
      tokenLocations,
      tokenLocationsCount: tokenLocations.length,
      justPlacedCounted,
      finalCount: dynamic,
      tokenType: action.tokenType || action.payload?.tokenType,
    })

    count = dynamic
  }

  // CREATE_STACK_SELF: Add token directly to source card, then continue AUTO_STEPS
  if ((action as any).onlySelf && action.sourceCoords) {
    if (count > 0) {
      // CRITICAL: Read tokenType from both action and payload (chained actions use payload format)
      // This fixes False Orders option 1 where chainedAction has tokenType in payload
      const tokenType = action.tokenType || action.payload?.tokenType || 'Aim'
      // CRITICAL: Use originalOwnerId first (for command cards like False Orders where sourceCard changes during steps)
      let tokenOwnerId = action.originalOwnerId ?? action.sourceCard?.ownerId ?? localPlayerId ?? 0
      if (!action.sourceCard?.ownerId && localPlayerId !== null) {
        tokenOwnerId = localPlayerId
      }

      // Add token directly to source card
      addBoardCardStatus(action.sourceCoords, tokenType, tokenOwnerId)
      setAbilityMode(null)

      // Mark ability as used (first step of AUTO_STEPS)
      markAbilityUsed(action.sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)

      // Continue to next AUTO_STEPS step
      const autoStepsContext = action.payload?._autoStepsContext
      if (autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined) {
        const nextStepIndex = autoStepsContext.currentStepIndex + 1
        if (nextStepIndex < autoStepsContext.steps.length) {
          // Execute next step
          const nextStep = autoStepsContext.steps[nextStepIndex]
          setTimeout(() => {
            execAction({
              type: 'ENTER_MODE',
              mode: 'AUTO_STEPS',
              payload: {
                ...nextStep,
                _autoStepsContext: {
                  steps: autoStepsContext.steps,
                  currentStepIndex: nextStepIndex,
                  sourceCard: action.sourceCard,
                  commandCardId: autoStepsContext.commandCardId || action.sourceCard?.id,
                }
              },
              sourceCard: action.sourceCard,
              sourceCoords: action.sourceCoords,
              isDeployAbility: action.isDeployAbility,
            }, action.sourceCoords || { row: -1, col: -1 })
          }, 100)
        }
      }
    } else {
      triggerNoTarget(sourceCoords)
    }
    return
  }

  if (count > 0) {
    // Determine token owner: tokens always belong to the card owner (even if it's a dummy player)
    // This ensures dummy player's tokens belong to the dummy, not the controlling player
    // CRITICAL: Use originalOwnerId first (for command cards like False Orders where sourceCard changes during steps)
    // This fixes False Orders Option 1 where Revealed tokens should use command card owner, not moved card owner
    let tokenOwnerId = action.originalOwnerId ?? action.sourceCard?.ownerId ?? localPlayerId ?? 0

    // Only fall back to localPlayerId if sourceCard.ownerId is not defined
    // DO NOT override tokenOwnerId when sourceCard belongs to a dummy player
    if (!action.sourceCard?.ownerId && localPlayerId !== null) {
      tokenOwnerId = localPlayerId
    }

    // DIAGNOSTIC: Log token owner determination
    console.log('[CREATE_STACK] Token owner determination:', {
      tokenType: action.tokenType || action.payload?.tokenType,
      sourceCardId: action.sourceCard?.id,
      sourceCardBaseId: action.sourceCard?.baseId,
      sourceCardOwnerId: action.sourceCard?.ownerId,
      tokenOwnerId,
      localPlayerId,
      actionTargetOwnerId: action.targetOwnerId,
      actionPayloadTargetOwnerId: action.payload?.targetOwnerId,
    })

    // Use universal token targeting system to create cursorStack
    // CRITICAL: Merge payload properties for chained actions (which use payload format)
    // This fixes False Orders option 1 where chainedAction has properties in payload
    const payloadProps = action.payload || {}
    const detailsProps = (action as any).details || {}
    // CRITICAL: Read from action, then payload, then details (contentDatabase.json uses details)
    // This fixes Temporary Shelter where targetOwnerId="source" is in details
    const modifications: Partial<any> = {
      count: count,
      sourceCoords: action.sourceCoords || sourceCoords,
      sourceCard: action.sourceCard,
      isDeployAbility: action.isDeployAbility,
      readyStatusToRemove: action.readyStatusToRemove,
      targetOwnerId: action.targetOwnerId ?? payloadProps.targetOwnerId ?? detailsProps.targetOwnerId,
      excludeOwnerId: action.excludeOwnerId ?? payloadProps.excludeOwnerId ?? detailsProps.excludeOwnerId,
      onlyOpponents: action.onlyOpponents ?? payloadProps.onlyOpponents ?? detailsProps.onlyOpponents,
      onlyFaceDown: action.onlyFaceDown ?? payloadProps.onlyFaceDown ?? detailsProps.onlyFaceDown,
      targetType: action.targetType ?? payloadProps.targetType ?? detailsProps.targetType,
      requiredTargetStatus: action.requiredTargetStatus ?? payloadProps.requiredTargetStatus ?? detailsProps.requiredTargetStatus,
      requireStatusFromSourceOwner: action.requireStatusFromSourceOwner ?? payloadProps.requireStatusFromSourceOwner ?? detailsProps.requireStatusFromSourceOwner,
      mustBeAdjacentToSource: action.mustBeAdjacentToSource ?? payloadProps.mustBeAdjacentToSource ?? detailsProps.mustBeAdjacentToSource,
      mustBeInLineWithSource: action.mustBeInLineWithSource ?? payloadProps.mustBeInLineWithSource ?? detailsProps.mustBeInLineWithSource,
      maxDistanceFromSource: action.maxDistanceFromSource ?? payloadProps.maxDistanceFromSource ?? detailsProps.maxDistanceFromSource,
      maxOrthogonalDistance: action.maxOrthogonalDistance ?? payloadProps.maxOrthogonalDistance ?? detailsProps.maxOrthogonalDistance,
      placeAllAtOnce: action.placeAllAtOnce ?? payloadProps.placeAllAtOnce ?? detailsProps.placeAllAtOnce,
      replaceStatus: action.replaceStatus ?? payloadProps.replaceStatus ?? detailsProps.replaceStatus,
      // CRITICAL: Read chainedAction from action, payload, or details (contentDatabase.json uses details)
      // This fixes Temporary Shelter where chainedAction is in step.chainedAction
      chainedAction: action.chainedAction ?? payloadProps.chainedAction ?? detailsProps.chainedAction,
      recordContext: action.recordContext ?? payloadProps.recordContext ?? detailsProps.recordContext,
      // CRITICAL: Pass _autoStepsContext for AUTO_STEPS continuation after cursorStack completes
      // This enables abilities like Centurion Commit to continue after CREATE_STACK step
      _autoStepsContext: action.payload?._autoStepsContext,
      // CRITICAL: Store the original readyStatusToRemove explicitly for token placement completion
      _originalReadyStatusToRemove: action.readyStatusToRemove,
    }

    // DIAGNOSTIC: Log modifications to verify onlyOpponents and onlyFaceDown are set
    console.log('[CREATE_STACK] modifications created:', {
      tokenType: action.tokenType || action.payload?.tokenType,
      modificationsTargetOwnerId: modifications.targetOwnerId,
      modificationsOnlyOpponents: modifications.onlyOpponents,
      modificationsOnlyFaceDown: modifications.onlyFaceDown,
      actionOnlyOpponents: action.onlyOpponents,
      actionOnlyFaceDown: action.onlyFaceDown,
      payloadPropsOnlyOpponents: payloadProps.onlyOpponents,
      payloadPropsOnlyFaceDown: payloadProps.onlyFaceDown,
      detailsPropsOnlyOpponents: detailsProps.onlyOpponents,
      detailsPropsOnlyFaceDown: detailsProps.onlyFaceDown,
    })

    // CRITICAL: Read tokenType from both action and payload (chained actions use payload format)
    // This fixes False Orders option 1 where chainedAction has tokenType in payload
    const tokenType = action.tokenType || action.payload?.tokenType || 'Aim'
    // CRITICAL: Read targetOwnerId from action, payload, or details (chained actions use details format)
    const targetOwnerId = action.targetOwnerId ?? action.payload?.targetOwnerId ?? (action as any).details?.targetOwnerId
    // CRITICAL: Read allowHandTargets from action or payload (chained actions from JSON use payload format)
    // This fixes False Orders Option 1 where allowHandTargets is in payload after normalization
    const allowHandTargets = action.allowHandTargets ?? action.payload?.allowHandTargets ?? (action as any).details?.allowHandTargets
    // Special handling for tokens with allowHandTargets - include hand targets from contentDatabase.json
    // This fixes False Orders Option 1 which should reveal BOTH hand cards AND face-down board cards
    // Case 1: allowHandTargets is set (from contentDatabase.json)
    if (allowHandTargets && targetOwnerId && targetOwnerId > 0) {
      // CRITICAL: Use calculateHandTargets to get hand targets from contentDatabase.json logic
      const handTargets = calculateHandTargets(action, gameState, tokenOwnerId, commandContext)

      // CRITICAL: Also collect board targets (face-down cards on battlefield)
      // This fixes False Orders Option 1 which should reveal BOTH hand cards AND face-down board cards
      const boardTargets = calculateValidTargets(action, gameState, tokenOwnerId, commandContext)

      // DIAGNOSTIC: Log Revealed token targeting setup
      console.log('[CREATE_STACK] Revealed token targets:', {
        tokenOwnerId,
        targetOwnerId,
        handTargetsCount: handTargets.length,
        boardTargetsCount: boardTargets.length,
        handTargets,
        boardTargets,
      })

      // CRITICAL: If no hand targets AND no board targets, skip Revealed placement
      // For command cards with chainedAction (e.g., Enhanced Interrogation, Data Interception),
      // the chainedAction will be added to actionQueue directly
      if (handTargets.length === 0 && boardTargets.length === 0) {
        // CRITICAL: If this action has a chainedAction, add it to actionQueue directly
        // This ensures chainedAction is processed after the current action completes
        if (action.chainedAction) {
          if (props.setActionQueue) {
            props.setActionQueue((prev: any[]) => [...prev, action.chainedAction!])
          } else {
            // Fallback: execute directly if setActionQueue not available
            if (props.pendingChainedActionRef) {
              props.pendingChainedActionRef.current = true
            }
            execAction(action.chainedAction!, sourceCoords)
            setTimeout(() => {
              if (props.pendingChainedActionRef) {
                props.pendingChainedActionRef.current = false
              }
            }, 50)
          }
        }

        // CRITICAL: Continue AUTO_STEPS even when no hand targets found
        // This ensures CLEANUP_COMMAND is executed after the step completes
        const autoStepsContext = (action.payload as any)?._autoStepsContext
        if (autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined) {
          console.log('[No hand targets specific] Continuing AUTO_STEPS to CLEANUP_COMMAND:', {
            currentStepIndex: autoStepsContext.currentStepIndex,
            totalSteps: autoStepsContext.steps.length,
          })
          // Create CONTINUE_AUTO_STEPS action to advance to the next step
          const continueAction: AbilityAction = {
            type: 'CONTINUE_AUTO_STEPS',
            mode: 'AUTO_STEPS',
            payload: {
              _autoStepsContext: {
                ...autoStepsContext,
                currentStepIndex: autoStepsContext.currentStepIndex + 1,
              },
            },
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords || sourceCoords,
          }
          if (props.setActionQueue) {
            setTimeout(() => {
              props.setActionQueue((prev: any[]) => [...prev, continueAction])
            }, 100)
          } else if (execAction) {
            setTimeout(() => {
              execAction(continueAction, sourceCoords)
            }, 100)
          }
        } else if (action.readyStatusToRemove) {
          markAbilityUsed(action.sourceCoords || sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)
        }
        return
      }

      // Create a dummy action for setTargetingMode (required parameter)
      const dummyAction: AbilityAction = {
        type: 'CREATE_STACK',
        mode: 'SELECT_TARGET',
        payload: {
          tokenType,
          filter: () => true,
          // CRITICAL: Use targetOwnerId variable (includes both action.targetOwnerId and action.payload.targetOwnerId)
          targetOwnerId: targetOwnerId,
        },
        sourceCoords: action.sourceCoords || sourceCoords,
        sourceCard: action.sourceCard,
        // CRITICAL: Set originalOwnerId to tokenOwnerId (command card owner) for correct highlight color
        // This fixes False Orders where highlight should use command card owner's color, not target player's color
        originalOwnerId: tokenOwnerId,
      }

      // CRITICAL: Set abilityMode BEFORE targeting mode to prevent race condition
      // This fixes False Orders Option 1 where useEffect would call setTargetingMode with stale action
      setAbilityMode(dummyAction)

      // CRITICAL: Create cursorStack BEFORE setTargetingMode to prevent race condition
      // This ensures cursorStack is set before any useEffect can run with stale abilityMode
      console.log('[CREATE_CURSOR_STACK] Specific target branch:', {
        tokenType,
        tokenOwnerId,
        count,
        targetOwnerId,
        modificationsTargetOwnerId: modifications.targetOwnerId,
        modificationsExcludeOwnerId: modifications.excludeOwnerId,
      })
      const newCursorStack = createTokenCursorStack(tokenType, tokenOwnerId, null, modifications)
      setCursorStack(newCursorStack)

      // CRITICAL: Set targeting mode LAST to ensure it's not overwritten by useEffect
      setTargetingMode(dummyAction, tokenOwnerId, sourceCoords, boardTargets, undefined, handTargets)

      // The ability will complete when the player clicks on a hand card (in handCardHandlers.ts)
    }
    // Case 2: Revealed with onlyOpponents OR specific targetOwnerId (e.g., False Orders Option 1 - reveal specific opponent's cards)
    // CRITICAL: Check both action.onlyOpponents, action.excludeOwnerId, and action.targetOwnerId (including payload)
    // Some abilities might have these properties in payload instead of directly on action
    else if (tokenType === 'Revealed' && (action.onlyOpponents || action.payload?.onlyOpponents || action.excludeOwnerId || action.payload?.excludeOwnerId || action.targetOwnerId || action.payload?.targetOwnerId || (action as any).details?.targetOwnerId)) {
      // CRITICAL: Get fresh state for accurate targeting
      const freshState = getFreshGameState()

      // CRITICAL: Determine which player's hand to target
      // If targetOwnerId is set (after replacing -2 with actual ID), only target that player's hand
      // Otherwise, use excludedId logic (all opponents except one)
      // CRITICAL: Check ALL locations where targetOwnerId might be stored (action, payload, details)
      // CRITICAL: Use _sourceOwnerId from payload if available (for False Orders Option 1)
      // This fixes repeated uses where action.payload.targetOwnerId contains stale value
      const payloadSourceOwnerId = (action.payload as any)?._sourceOwnerId
      const commandContextSourceOwnerId = commandContext?.sourceOwnerId
      const sourceOwnerId = payloadSourceOwnerId ?? commandContextSourceOwnerId
      const specificTargetId = sourceOwnerId ?? action.targetOwnerId ?? action.payload?.targetOwnerId ?? (action as any).details?.targetOwnerId

      console.log('[Revealed token] Source owner resolution:', {
        payloadSourceOwnerId,
        commandContextSourceOwnerId,
        resolvedSourceOwnerId: sourceOwnerId,
        actionTargetOwnerId: action.targetOwnerId,
        payloadTargetOwnerId: action.payload?.targetOwnerId,
        detailsTargetOwnerId: (action as any).details?.targetOwnerId,
        finalSpecificTargetId: specificTargetId,
      })
      const handTargets: {playerId: number, cardIndex: number}[] = []
      // CRITICAL: Also collect board targets (face-down cards on battlefield)
      // This fixes abilities that should reveal BOTH hand cards AND face-down board cards
      const boardTargets = calculateValidTargets(action, freshState, tokenOwnerId, commandContext)

      console.log('[Revealed token] Board targets calculated:', {
        tokenOwnerId,
        actionTargetOwnerId: action.targetOwnerId,
        payloadTargetOwnerId: action.payload?.targetOwnerId,
        detailsTargetOwnerId: (action as any).details?.targetOwnerId,
        specificTargetId,
        boardTargetsCount: boardTargets.length,
        boardTargets,
      })

      // CRITICAL: Only use specificTargetId branch if ID is positive (valid player ID)
      // Exclude -1 (all opponents) and -2 (TARGET_MOVED_OWNER placeholder not yet replaced)
      if (specificTargetId && specificTargetId > 0) {
        // False Orders Option 1: Only target specific player's hand (the player whose card was moved)
        const targetPlayer = freshState.players.find(p => p.id === specificTargetId)
        if (targetPlayer && targetPlayer.hand) {
          for (let i = 0; i < targetPlayer.hand.length; i++) {
            const card = targetPlayer.hand[i]
            const hasOurRevealed = card.statuses?.some(s =>
              s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId
            )
            // CRITICAL: onlyFaceDown filter does NOT apply to hand cards
            // Hand cards are always hidden from opponents (effectively face-down)
            if (!hasOurRevealed) {
              handTargets.push({ playerId: targetPlayer.id, cardIndex: i })
            }
          }
        }

        console.log('[Revealed token] Hand targets collected:', {
          specificTargetId,
          targetPlayerName: targetPlayer?.name,
          targetPlayerHandSize: targetPlayer?.hand?.length,
          handTargetsCount: handTargets.length,
          handTargets,
          allPlayers: freshState.players.map(p => ({ id: p.id, name: p.name, handSize: p.hand?.length || 0 })),
        })

        // CRITICAL: If no hand targets AND no board targets, skip Revealed placement and execute chainedAction directly
        if (handTargets.length === 0 && boardTargets.length === 0) {
          console.log('[Specific target] No hand/board targets found, skipping Revealed placement:', {
            tokenOwnerId,
            specificTargetId,
            handTargetsCount: handTargets.length,
            boardTargetsCount: boardTargets.length,
          })

          // CRITICAL: If this action has a chainedAction, add it to actionQueue directly
          if (action.chainedAction) {
            if (props.setActionQueue) {
              props.setActionQueue((prev: any[]) => [...prev, action.chainedAction!])
            } else {
              if (props.pendingChainedActionRef) {
                props.pendingChainedActionRef.current = true
              }
              execAction(action.chainedAction!, sourceCoords)
              setTimeout(() => {
                if (props.pendingChainedActionRef) {
                  props.pendingChainedActionRef.current = false
                }
              }, 50)
            }
          }

          // CRITICAL: Continue AUTO_STEPS even when no hand targets found
          const autoStepsContext = (action.payload as any)?._autoStepsContext
          if (autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined) {
            const continueAction: AbilityAction = {
              type: 'CONTINUE_AUTO_STEPS',
              mode: 'AUTO_STEPS',
              payload: {
                _autoStepsContext: {
                  ...autoStepsContext,
                  currentStepIndex: autoStepsContext.currentStepIndex + 1,
                },
              },
              sourceCard: action.sourceCard,
              sourceCoords: action.sourceCoords || sourceCoords,
            }
            if (props.setActionQueue) {
              setTimeout(() => {
                props.setActionQueue((prev: any[]) => [...prev, continueAction])
              }, 100)
            } else if (execAction) {
              setTimeout(() => {
                execAction(continueAction, sourceCoords)
              }, 100)
            }
          } else if (action.readyStatusToRemove) {
            markAbilityUsed(action.sourceCoords || sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)
          }
          return
        }

        // Create a dummy action for setTargetingMode (required parameter)
        const dummyAction: AbilityAction = {
          type: 'CREATE_STACK',
          mode: 'SELECT_TARGET',
          payload: {
            tokenType,
            filter: () => true,
            targetOwnerId: specificTargetId,
          },
          sourceCoords: action.sourceCoords || sourceCoords,
          sourceCard: action.sourceCard,
          originalOwnerId: tokenOwnerId,
        }

        // CRITICAL: Set abilityMode BEFORE targeting mode to prevent race condition
        // This fixes False Orders Option 1 where useEffect would call setTargetingMode with stale action
        setAbilityMode(dummyAction)

        // CRITICAL: Create cursorStack BEFORE setTargetingMode to prevent race condition
        // This ensures cursorStack is set before any useEffect can run with stale abilityMode
        const newCursorStack = createTokenCursorStack(tokenType, tokenOwnerId, null, modifications)
        setCursorStack(newCursorStack)

        // CRITICAL: Set targeting mode LAST to ensure it's not overwritten by useEffect
        setTargetingMode(dummyAction, tokenOwnerId, sourceCoords, boardTargets, undefined, handTargets)

        // The ability will complete when the player clicks on a hand card or board card
      } else {
        // Original logic: ALL opponents (excluding excluded owner)
        const excludedId = action.excludeOwnerId ?? tokenOwnerId

      for (const player of freshState.players) {
        // Skip excluded player (token owner's own hand)
        if (player.id === excludedId) {
          continue
        }
        // Skip teammates if onlyOpponents is set
        const onlyOpponents = action.onlyOpponents || action.payload?.onlyOpponents
        if (onlyOpponents) {
          const tokenOwner = freshState.players.find(p => p.id === tokenOwnerId)
          // CRITICAL FIX: In FFA mode, teamId is undefined/null for everyone
          // Only skip as teammates if both have the same explicitly defined teamId (not null/undefined)
          if (tokenOwner && tokenOwner.teamId !== null && tokenOwner.teamId !== undefined && tokenOwner.teamId === player.teamId) {
            continue
          }
          // Also skip if both have undefined teamId AND it's actually team mode (not FFA)
          // We can detect team mode by checking if gameMode is not 'FFA'
          const gameMode = freshState.gameMode
          if (tokenOwner && (tokenOwner.teamId === null || tokenOwner.teamId === undefined) && (player.teamId === null || player.teamId === undefined) && gameMode !== 'FFA' && gameMode !== 'FreeForAll') {
            continue
          }
        }
        // Add this player's hand cards
        if (player.hand) {
          console.log('Processing player hand:', {
            playerId: player.id,
            playerName: player.name,
            isLocal: player.id === props.localPlayerId,
            isExcluded: player.id === excludedId,
            firstCard: player.hand[0] ? { id: player.hand[0].id, baseId: player.hand[0].baseId, hasStatuses: !!player.hand[0].statuses, statuses: player.hand[0].statuses } : null
          })
          for (let i = 0; i < player.hand.length; i++) {
            const card = player.hand[i]
            // Check if card doesn't already have our Revealed token
            const hasOurRevealed = card.statuses?.some(s =>
              s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId
            )
            // CRITICAL: onlyFaceDown filter does NOT apply to hand cards
            // Hand cards are always hidden from opponents (effectively face-down)
            // The onlyFaceDown filter is meant for board cards only
            // So we skip the face-down check entirely for hand targets
            const passesFaceDownCheck = true // Always true for hand cards

            // DIAGNOSTIC: Log why each card is or isn't added
            if (hasOurRevealed) {
            } else if (!passesFaceDownCheck) {
            } else {
              handTargets.push({ playerId: player.id, cardIndex: i })
            }
          }
        }
      }

      // DIAGNOSTIC: Log Revealed token targeting setup (all opponents)
      console.log('Revealed token targeting setup:', {
        tokenOwnerId,
        excludedId,
        onlyOpponents: action.onlyOpponents || action.payload?.onlyOpponents,
        totalPlayers: freshState.players.length,
        playersWithHand: freshState.players.filter(p => p.hand && p.hand.length > 0).length,
        handTargets: handTargets.map(t => ({ playerId: t.playerId, cardIndex: t.cardIndex }))
      })

      // CRITICAL: If no hand targets AND no board targets, skip Revealed placement and execute chainedAction directly
      if (handTargets.length === 0 && boardTargets.length === 0) {
        console.log('No hand targets found, skipping Revealed placement:', {
          tokenOwnerId,
          excludedId,
          onlyOpponents: action.onlyOpponents || action.payload?.onlyOpponents,
          players: freshState.players.map(p => ({ id: p.id, name: p.name, handLength: p.hand?.length || 0, isDummy: p.isDummy })),
          // DIAGNOSTIC: Check if this is a guest without fresh opponent hand data
          localPlayerId: props.localPlayerId,
          isGuest: props.localPlayerId !== 1 && props.localPlayerId !== tokenOwnerId,
          hasSendAction: !!props.sendAction,
        })

        // CRITICAL FIX: For guests in WebRTC mode, send the full CREATE_STACK action to host
        // The host has complete game state and can properly calculate targets for opponent hands
        const isGuestInWebRTCMode = props.localPlayerId !== 1 && props.sendAction
        const isTargetingOpponentHands = action.onlyOpponents || action.payload?.onlyOpponents

        if (isGuestInWebRTCMode && isTargetingOpponentHands && action.chainedAction) {

          // Send the ability action to host so it can execute with full game state
          // This ensures DRAW_CARD and other chained actions work correctly
          props.sendAction('EXECUTE_ABILITY_CHAINED', {
            sourceCoords: action.sourceCoords || sourceCoords,
            chainedAction: action.chainedAction,
            tokenOwnerId,
            onlyOpponents: action.onlyOpponents || action.payload?.onlyOpponents,
          })

          // Mark ability as used locally (removes ready status)
          if (action.readyStatusToRemove) {
            markAbilityUsed(action.sourceCoords || sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)
          }
          return
        }

        // CRITICAL: For guests without opponent hand data, show a message to the user
        // This can happen if the guest hasn't received the latest state from the host yet
        if (props.localPlayerId !== 1 && props.localPlayerId !== tokenOwnerId) {
          // Try to get fresh state one more time after a short delay
          setTimeout(() => {
            const retryState = getFreshGameState()
            console.log('Retry state check:', {
              players: retryState.players.map(p => ({
                id: p.id,
                handLength: p.hand?.length || 0
              }))
            })
          }, 100)
        }
        if (action.chainedAction) {
          // CRITICAL: Set pending flag before executing chained action
          if (props.pendingChainedActionRef) {
            props.pendingChainedActionRef.current = true
          }
          // CRITICAL: Execute synchronously so abilityMode is set before action queue continues
          execAction(action.chainedAction!, sourceCoords)
          // Clear the flag after React has processed state updates
          setTimeout(() => {
            if (props.pendingChainedActionRef) {
              props.pendingChainedActionRef.current = false
            }
          }, 50)
        }

        // CRITICAL: Continue AUTO_STEPS even when no hand targets found
        // This ensures CLEANUP_COMMAND is executed after the step completes
        const autoStepsContext = (action.payload as any)?._autoStepsContext
        if (autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined) {
          console.log('[No hand targets] Continuing AUTO_STEPS to CLEANUP_COMMAND:', {
            currentStepIndex: autoStepsContext.currentStepIndex,
            totalSteps: autoStepsContext.steps.length,
          })
          // Create CONTINUE_AUTO_STEPS action to advance to the next step
          const continueAction: AbilityAction = {
            type: 'CONTINUE_AUTO_STEPS',
            mode: 'AUTO_STEPS',
            payload: {
              _autoStepsContext: {
                ...autoStepsContext,
                currentStepIndex: autoStepsContext.currentStepIndex + 1,
              },
            },
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords || sourceCoords,
          }
          if (props.setActionQueue) {
            setTimeout(() => {
              props.setActionQueue((prev: any[]) => [...prev, continueAction])
            }, 100)
          } else if (execAction) {
            setTimeout(() => {
              execAction(continueAction, sourceCoords)
            }, 100)
          }
        } else if (action.readyStatusToRemove) {
          markAbilityUsed(action.sourceCoords || sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)
        }
        return
      }

      // Create a dummy action for setTargetingMode (required parameter)
      const dummyAction: AbilityAction = {
        type: 'CREATE_STACK',
        mode: 'SELECT_TARGET',
        payload: {
          tokenType,
          filter: () => true,
          excludeOwnerId: action.excludeOwnerId,
          onlyOpponents: action.onlyOpponents || action.payload?.onlyOpponents,
          // CRITICAL: Include targetOwnerId so App.tsx knows which player's hand to highlight
          // This fixes False Orders Option 1 where only specific player's hand should be targeted
          // CRITICAL: Check all locations: action, payload, details
          targetOwnerId: action.targetOwnerId ?? action.payload?.targetOwnerId ?? (action as any).details?.targetOwnerId,
        },
        sourceCoords: action.sourceCoords || sourceCoords,
        sourceCard: action.sourceCard,
        // CRITICAL: Set originalOwnerId to tokenOwnerId (command card owner) for correct highlight color
        // This fixes False Orders where highlight should use command card owner's color, not target player's color
        originalOwnerId: tokenOwnerId,
      }

      // CRITICAL: Set abilityMode BEFORE targeting mode to prevent race condition
      // This fixes False Orders Option 1 where useEffect would call setTargetingMode with stale action
      setAbilityMode(dummyAction)

      // CRITICAL: Create cursorStack BEFORE setTargetingMode to prevent race condition
      // This ensures cursorStack is set before any useEffect can run with stale abilityMode
      console.log('[CREATE_CURSOR_STACK] Before creating cursorStack:', {
        tokenType,
        tokenOwnerId,
        count,
        modificationsTargetOwnerId: modifications.targetOwnerId,
        modificationsExcludeOwnerId: modifications.excludeOwnerId,
        actionTargetOwnerId: action.targetOwnerId,
        actionPayloadTargetOwnerId: action.payload?.targetOwnerId,
      })
      setCursorStack(createTokenCursorStack(tokenType, tokenOwnerId, null, modifications))

      // CRITICAL: Set targeting mode LAST to ensure it's not overwritten by useEffect
      setTargetingMode(dummyAction, tokenOwnerId, sourceCoords, boardTargets, undefined, handTargets)
      // The ability will complete when the player clicks on a hand card (in handCardHandlers.ts)
    }
  } else {
      // Normal token placement (board only)
      console.log('[CREATE_CURSOR_STACK] Board token placement:', {
        tokenType,
        tokenOwnerId,
        count,
        modificationsTargetOwnerId: modifications.targetOwnerId,
        modificationsExcludeOwnerId: modifications.excludeOwnerId,
      })
      setCursorStack(createTokenCursorStack(tokenType, tokenOwnerId, null, modifications))
      // Don't clear abilityMode here - it will be cleared when cursorStack is depleted (in useAppAbilities.ts)
    }
  } else {
    triggerNoTarget(sourceCoords)

    // CRITICAL: Still execute chainedAction even when count is 0
    // This fixes Data Interception option 1 where chainedAction (SELECT_UNIT_FOR_MOVE)
    // should execute even when there are no opponent cards to reveal
    if (action.chainedAction) {
      // CRITICAL: Set pending flag before executing chained action
      if (props.pendingChainedActionRef) {
        props.pendingChainedActionRef.current = true
      }
      // CRITICAL: Execute synchronously so abilityMode is set before action queue continues
      execAction(action.chainedAction!, sourceCoords)
      // Clear the flag after React has processed state updates
      setTimeout(() => {
        if (props.pendingChainedActionRef) {
          props.pendingChainedActionRef.current = false
        }
      }, 50)
    }
  }
}

/**
 * Handle OPEN_MODAL action
 */
function handleOpenModal(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, localPlayerId, commandContext, setViewingDiscard, markAbilityUsed, triggerNoTarget, setAbilityMode, setTargetingMode } = props

  // CRITICAL: Use getFreshGameState() for target check to include tokens just placed
  const freshGameState = getFreshGameState ? getFreshGameState() : gameState
  const hasTargets = checkActionHasTargets(action, freshGameState, action.sourceCard?.ownerId || localPlayerId, commandContext)

  if (!hasTargets) {
    triggerNoTarget(action.sourceCoords || sourceCoords)
    // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
    return
  }

  // PLACE_TOKEN - Token placement on board (from CREATE_TOKEN action)
  if (action.mode === 'PLACE_TOKEN') {
    const targets = calculateValidTargets(action, freshGameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, targets, commandContext)
    return
  }

  if (action.mode === 'RETRIEVE_DEVICE') {
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      setViewingDiscard({
        player,
        pickConfig: { filterType: 'Device', action: 'recover' },
      })
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    }
  } else if (action.mode === 'IMMUNIS_RETRIEVE') {
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      setViewingDiscard({
        player,
        pickConfig: { filterType: 'Optimates', action: 'resurrect' },
      })
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    }
  } else if (action.mode === 'SEARCH_DECK') {
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      setViewingDiscard({
        player,
        pickConfig: {
          filterType: action.payload?.filterType || 'Unit',
          action: 'recover',
          isDeck: true,
        },
        // Pass ability-related fields for modal close handling
        sourceCard: action.sourceCard,
        isDeployAbility: action.isDeployAbility,
        sourceCoords,
        shuffleOnClose: action.payload?.shuffleOnClose,
      })
      // Don't mark ability used here - it will be marked when modal closes
    }
  } else if (action.mode === 'RETURN_FROM_DISCARD_TO_HAND') {
    // Return card from discard to hand (e.g., Finn EG Setup)
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      // Extract filter type from filter string (e.g., "hasType_Device" → "Device")
      let filterType = 'Unit'
      const filterString = action.payload?.filter
      if (filterString) {
        if (typeof filterString === 'string') {
          if (filterString.startsWith('hasType_')) {
            filterType = filterString.replace('hasType_', '')
          } else if (filterString.startsWith('hasFaction_')) {
            filterType = filterString.replace('hasFaction_', '')
          }
        } else if (typeof filterString === 'function') {
          // Filter is a function - can't extract type, use default
        }
      }

      setViewingDiscard({
        player,
        pickConfig: { filterType, action: 'recover' },
      })
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    }
  } else if (action.mode === 'RETURN_FROM_DISCARD_TO_BOARD') {
    // Return card from discard to adjacent empty cell with token (e.g., Finn MW Deploy, Immunis Deploy)
    const player = gameState.players.find(p => p.id === action.sourceCard?.ownerId)
    if (player) {
      // Extract filter type from filter string or function
      let filterType = 'Unit'
      const filterString = action.payload?.filter
      if (filterString) {
        if (typeof filterString === 'string') {
          if (filterString.startsWith('hasType_')) {
            filterType = filterString.replace('hasType_', '')
          } else if (filterString.startsWith('hasFaction_')) {
            filterType = filterString.replace('hasFaction_', '')
          }
        } else if (typeof filterString === 'function') {
          // Filter is a function - can't extract type, use default
        }
      }

      // Set ability mode for the second step (placing the card)
      const resurrectAction: AbilityAction = {
        type: 'ENTER_MODE',
        mode: 'RESURRECT_FROM_DISCARD',
        sourceCard: action.sourceCard,
        sourceCoords: action.sourceCoords,
        payload: {
          withToken: action.payload?.withToken || 'Resurrection',
          selectedCardIndex: -1, // Will be set after card selection
        },
        isDeployAbility: action.isDeployAbility,
      }

      setAbilityMode(resurrectAction)

      setViewingDiscard({
        player,
        pickConfig: {
          filterType,
          action: 'resurrect',
          targetCoords: action.sourceCoords,
        },
      })
      // Don't mark ability as used yet - will mark after card is placed
    }
  }
}

/**
 * Handle ENTER_MODE action
 */
function handleEnterMode(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { gameState, getFreshGameState, localPlayerId, commandContext, triggerNoTarget, setAbilityMode, addBoardCardStatus, setTargetingMode, clearTargetingMode, handleActionExecution: execAction, markAbilityUsed } = props

  const mode = action.mode
  const payload = action.payload || {}

  // SHIELD_SELF_THEN_PUSH (Reclaimed Gawain)
  // Add Shield immediately, then let user select adjacent opponent to push
  if (mode === 'SHIELD_SELF_THEN_PUSH') {
    // CRITICAL: Get ownerId from the actual card at sourceCoords, not from action.sourceCard
    // This fixes the bug where two dummy players have cards with the same name
    const freshState = getFreshGameState()
    const actualCard = freshState.board[sourceCoords.row]?.[sourceCoords.col]?.card
    const actorId = actualCard?.ownerId ?? getSafePlayerId(action, localPlayerId)
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const pushAction: AbilityAction = {
      ...action,
      sourceCard: actualCard || action.sourceCard,
      payload: { ...action.payload, shieldApplied: true }
    }
    const targets = calculateValidTargets(pushAction, gameState, actorId, commandContext)

    setAbilityMode(pushAction)
    setTargetingMode(pushAction, actorId, sourceCoords, targets, commandContext)
    return
  }

  // SHIELD_SELF_THEN_SPAWN (Edith Byron)
  if (mode === 'SHIELD_SELF_THEN_SPAWN') {
    // CRITICAL: Get ownerId from the actual card at sourceCoords, not from action.sourceCard
    // This fixes the bug where two dummy players have cards with the same name
    const freshState = getFreshGameState()
    const actualCard = freshState.board[sourceCoords.row]?.[sourceCoords.col]?.card
    const actorId = actualCard?.ownerId ?? getSafePlayerId(action, localPlayerId)
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const spawnAction: AbilityAction = {
      ...action,
      sourceCard: actualCard || action.sourceCard,
      payload: { ...action.payload, shieldApplied: true }
    }
    const targets = calculateValidTargets(spawnAction, gameState, actorId, commandContext)

    setAbilityMode(spawnAction)
    setTargetingMode(spawnAction, actorId, sourceCoords, targets, commandContext)
    return
  }

  // PUSH within AUTO_STEPS (Reclaimed Gawain Deploy - step 2)
  // Only use this handler when PUSH is part of AUTO_STEPS
  // Direct PUSH abilities (Riot Agent) use the handler below which preserves ready status
  if (mode === 'PUSH' && action.payload?._autoStepsContext) {
    const actorId = getSafePlayerId(action, localPlayerId)
    const targets = calculateValidTargets(action, gameState, actorId, commandContext)

    // If no valid targets, complete the AUTO_STEPS ability
    if (targets.length === 0) {
      triggerNoTarget(sourceCoords)
      markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      setAbilityMode(null)
      return
    }

    setAbilityMode(action)
    setTargetingMode(action, actorId, sourceCoords, targets, commandContext)
    return
  }

  // PRINCEPS_SHIELD_THEN_AIM
  if (mode === 'PRINCEPS_SHIELD_THEN_AIM') {
    // CRITICAL: Get ownerId from the actual card at sourceCoords, not from action.sourceCard
    // This fixes the bug where two dummy players have cards with the same name
    const freshState = getFreshGameState()
    const actualCard = freshState.board[sourceCoords.row]?.[sourceCoords.col]?.card
    const actorId = actualCard?.ownerId ?? getSafePlayerId(action, localPlayerId)
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const aimStackAction: AbilityAction = {
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1,
      mustBeInLineWithSource: true,
      sourceCard: actualCard || action.sourceCard,
      sourceCoords,
      isDeployAbility: action.isDeployAbility,
    }

    execAction(aimStackAction, sourceCoords)
    return
  }

  // GAWAIN_DEPLOY_SHIELD_AIM
  if (mode === 'GAWAIN_DEPLOY_SHIELD_AIM') {
    // CRITICAL: Get ownerId from the actual card at sourceCoords, not from action.sourceCard
    // This fixes the bug where two dummy players have cards with the same name
    const freshState = getFreshGameState()
    const actualCard = freshState.board[sourceCoords.row]?.[sourceCoords.col]?.card
    const actorId = actualCard?.ownerId ?? action.sourceCard!.ownerId!
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const aimStackAction: AbilityAction = {
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1,
      mustBeInLineWithSource: true,
      sourceCard: actualCard || action.sourceCard,
      sourceCoords,
      isDeployAbility: action.isDeployAbility,
    }

    execAction(aimStackAction, sourceCoords)
    return
  }

  // ABR_DEPLOY_SHIELD_AIM
  if (mode === 'ABR_DEPLOY_SHIELD_AIM') {
    const actorId = action.sourceCard!.ownerId!
    addBoardCardStatus(sourceCoords, 'Shield', actorId)

    const aimStackAction: AbilityAction = {
      type: 'CREATE_STACK',
      tokenType: 'Aim',
      count: 1,
      requiredTargetStatus: 'Threat',
      requireStatusFromSourceOwner: true,
      sourceCard: action.sourceCard,
      sourceCoords,
      isDeployAbility: action.isDeployAbility,
    }

    execAction(aimStackAction, sourceCoords)
    return
  }

  // PUSH
  if (mode === 'PUSH') {
    // CRITICAL: Mark ability as used FIRST (remove ready status, add "used this turn")
    // This happens regardless of whether there are valid targets or not
    if (action.readyStatusToRemove) {
      markAbilityUsed(sourceCoords, action.isDeployAbility, false, action.readyStatusToRemove)
    }

    // Calculate valid targets - checked at application time
    // CRITICAL: Use getFreshGameState() to get the latest state from host/guest
    // This fixes the issue where React state hasn't updated yet after card movement
    const freshGameState = getFreshGameState ? getFreshGameState() : gameState
    const actorId = action.sourceCard?.ownerId || localPlayerId

    // Log board around sourceCoords
    if (action.sourceCoords) {
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const r = action.sourceCoords.row + dr
          const c = action.sourceCoords.col + dc
          if (r >= 0 && r < freshGameState.board.length && c >= 0 && c < freshGameState.board[0].length) {
            const cell = freshGameState.board[r][c]
          }
        }
      }
    }

    const pushTargets = calculateValidTargets(action, freshGameState, actorId, commandContext)

    if (pushTargets.length === 0) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // Ready status already removed, ability marked as used
      return
    }
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, pushTargets)
    return
  }

  // SWAP_POSITIONS (Reckless Provocateur Deploy)
  if (mode === 'SWAP_POSITIONS') {
    // Check targets BEFORE activating targeting mode
    const hasSwapTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasSwapTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    const swapTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, swapTargets)
    return
  }

  // SWAP_ADJACENT (Swap with adjacent card)
  if (mode === 'SWAP_ADJACENT') {
    // Check targets BEFORE activating targeting mode
    const hasSwapTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasSwapTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    const swapTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, swapTargets)
    return
  }

  // PATROL_MOVE
  if (mode === 'PATROL_MOVE') {
    // Check targets BEFORE activating targeting mode
    const hasPatrolTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasPatrolTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    // Calculate valid targets for highlighting
    const patrolTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, patrolTargets)
    return
  }

  // SPAWN_TOKEN (Inventive Maker Deploy, Recon Drone Deploy, etc.)
  if (mode === 'SPAWN_TOKEN') {
    // Check targets BEFORE activating targeting mode
    const hasSpawnTargets = checkActionHasTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    if (!hasSpawnTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    // Calculate valid targets for highlighting
    const spawnTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, spawnTargets)
    return
  }

  // SELECT_UNIT_FOR_MOVE (Finn Setup, Data Interception option 1)
  if (mode === 'SELECT_UNIT_FOR_MOVE') {
    // CRITICAL: Use getFreshGameState() to get the latest state after CREATE_STACK
    // This fixes Data Interception option 1 where Exploit counter is placed just before SELECT_UNIT_FOR_MOVE
    const freshGameState = getFreshGameState ? getFreshGameState() : gameState
    const actorId = getSafePlayerId(action, localPlayerId)

    // Check if there are valid targets (allied cards on board)
    const hasTargets = checkActionHasTargets(action, freshGameState, actorId, commandContext)
    if (!hasTargets) {
      triggerNoTarget(action.sourceCoords || sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when targets appear
      return
    }
    const targets = calculateValidTargets(action, freshGameState, actorId, commandContext)
    // CRITICAL: Clear any existing targeting mode before setting new one
    clearTargetingMode()
    // CRITICAL: Add originalOwnerId to abilityMode so handleSelectUnitForMove can use it for highlight color
    // This fixes Data Interception option 1 where cell selection highlight used wrong color
    const actionWithOwnerId = { ...action, originalOwnerId: actorId }
    setAbilityMode(actionWithOwnerId)
    setTargetingMode(actionWithOwnerId, actorId, sourceCoords, targets, commandContext)
    return
  }

  // SELECT_TARGET with hand-only actionTypes (discard abilities)
  if (mode === 'SELECT_TARGET' && payload.actionType) {
    const actionType = payload.actionType

    // Hand-only discard actions
    if (actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN' ||
        actionType === 'SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN' ||
        actionType === 'LUCIUS_SETUP' ||
        actionType === 'SELECT_HAND_FOR_DEPLOY') {

      const ownerId = action.sourceCard?.ownerId || localPlayerId
      const player = gameState.players.find(p => p.id === ownerId)

      if (!player || player.hand.length === 0) {
        triggerNoTarget(action.sourceCoords || sourceCoords)
        return
      }

      // Calculate hand targets - all cards in owner's hand are valid
      const handTargets: {playerId: number, cardIndex: number}[] = []
      for (let i = 0; i < player.hand.length; i++) {
        // Apply filter if present (e.g., Faber only discards SynchroTech cards)
        if (payload.filter && !payload.filter(player.hand[i])) {
          continue
        }
        handTargets.push({ playerId: player.id, cardIndex: i })
      }

      if (handTargets.length === 0) {
        triggerNoTarget(action.sourceCoords || sourceCoords)
        return
      }

      setAbilityMode(action)
      setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, [], commandContext, handTargets)
      return
    }
  }

  // SELECT_TARGET
  if (mode === 'SELECT_TARGET') {
    // NOTE: Target check is already done in handleActionExecution (line 147)
    // No need to check again here - just calculate targets and set modes
    // This reduces calculateValidTargets calls from 3 to 2, then to 1 after batching

    // CRITICAL: Use freshGameState for calculateValidTargets to see tokens just placed
    // This ensures consistency with checkActionHasTargets which also uses freshGameState
    const freshGameState = getFreshGameState ? getFreshGameState() : gameState

    // For Deploy abilities, let player activate anytime (targets may appear later)
    if (action.isDeployAbility) {
      const targets = calculateValidTargets(action, freshGameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
      setAbilityMode(action)
      setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, targets, commandContext)
      return
    }

    // For Setup/Commit abilities - calculate targets directly
    // handleActionExecution already verified targets exist before calling handleEnterMode
    const targets = calculateValidTargets(action, freshGameState, action.sourceCard?.ownerId || localPlayerId, commandContext)

    // CRITICAL: Batch state updates to reduce re-renders
    // Use React's automatic batching - both updates in same tick will batch
    setAbilityMode(action)
    setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, targets, commandContext)
    return
  }

  // IP_AGENT_THREAT_SCORING - IP Dept Agent Setup
  // Select a line (row or column) to score Threats
  if (mode === 'IP_AGENT_THREAT_SCORING') {
    const { row, col } = sourceCoords

    // CRITICAL: Use getFreshGameState() to get the latest state from host/guest
    const freshState = getFreshGameState()
    const gridSize = freshState.activeGridSize

    // CRITICAL: Get the actual card from sourceCoords to determine correct ownerId
    // This fixes the bug where two dummy players have cards with the same name
    const sourceCell = freshState.board[row]?.[col]
    const actualCard = sourceCell?.card
    if (!actualCard) {
      triggerNoTarget(sourceCoords)
      return
    }
    const ownerId = actualCard.ownerId ?? 0

    // Check for adjacent Support
    const hasSupport = (r: number, c: number): boolean => {
      if (r < 0 || r >= gridSize || c < 0 || c >= gridSize) { return false }
      const cell = freshState.board[r]?.[c]
      if (!cell?.card) { return false }
      return cell.card.statuses?.some((s: any) => s.type === 'Support' && s.addedByPlayerId === ownerId) ?? false
    }

    const hasAdjacentSupport =
      hasSupport(row - 1, col) ||
      hasSupport(row + 1, col) ||
      hasSupport(row, col - 1) ||
      hasSupport(row, col + 1)

    if (!hasAdjacentSupport) {
      triggerNoTarget(sourceCoords)
      // DON'T mark ability as used - preserve ready status so ability can be used when Support appears
      return
    }

    // Generate valid targets: all cells in the same row or column
    const boardTargets: { row: number; col: number }[] = []
    for (let i = 0; i < gridSize; i++) {
      boardTargets.push({ row: row, col: i }) // Entire row
      boardTargets.push({ row: i, col: col }) // Entire column
    }

    // Set up targeting mode with custom payload for line selection
    // CRITICAL: Update sourceCard to point to the actual card at sourceCoords
    const targetingAction: AbilityAction = {
      ...action,
      sourceCard: actualCard,
      sourceCoords,
      payload: {
        ...action.payload,
        sourceRow: row,
        sourceCol: col,
        boardTargets
      }
    }

    setAbilityMode(targetingAction)
    // CRITICAL: Use ownerId from actualCard, not from action.sourceCard
    setTargetingMode(targetingAction, ownerId, sourceCoords, boardTargets, commandContext)
    return
  }

  // AUTO_STEPS (Generic multi-step ability system)
  // Handles Edith Byron Deploy, Centurion Commit, Princeps Deploy, and other multi-step abilities
  if (mode === 'AUTO_STEPS') {

    const steps = action.payload?.steps as AutoStep[] | undefined
    if (steps && steps.length > 0) {
      const firstStep = steps[0]

      // CRITICAL: CREATE_STACK always requires user interaction, even with mode: null
      // Set up token cursor stack and targeting mode for CREATE_STACK as first step
      if (firstStep.action === 'CREATE_STACK') {
        const ownerId = getSafePlayerId(action, localPlayerId)
        const mustBeInLineWithSource = firstStep.mode === 'LINE_TARGET' ? true : undefined
        const mustBeAdjacentToSource = firstStep.mode === 'ADJACENT_TARGET' ? true : undefined

        const stackAction: AbilityAction = {
          type: 'CREATE_STACK',
          tokenType: firstStep.details?.tokenType,
          count: firstStep.details?.count || 1,
          mustBeInLineWithSource,
          mustBeAdjacentToSource,
          onlyOpponents: firstStep.details?.onlyOpponents,
          onlyFaceDown: firstStep.details?.onlyFaceDown,
          targetOwnerId: firstStep.details?.targetOwnerId,
          excludeOwnerId: firstStep.details?.excludeOwnerId,
          sourceCard: action.sourceCard,
          sourceCoords: action.sourceCoords,
          isDeployAbility: action.isDeployAbility,
          readyStatusToRemove: action.readyStatusToRemove,
          // CRITICAL: Preserve chainedAction from step level (for multi-step commands like Temporary Shelter)
          // This fixes Temporary Shelter where REMOVE_ALL_AIM_FROM_CONTEXT must execute after Shield placement
          ...(firstStep.chainedAction ? { chainedAction: firstStep.chainedAction } : {}),
          payload: {
            ...firstStep.details,
            _autoStepsContext: {
              steps: steps,
              currentStepIndex: 1,
              originalType: action.payload?.originalType,
              supportRequired: action.payload?.supportRequired,
              readyStatusToRemove: action.readyStatusToRemove,
              commandCardId: action.payload?.commandCardId || action.sourceCard?.id
            }
          }
        }
        handleCreateStack(stackAction, sourceCoords, props)

        // Also set abilityMode to SELECT_TARGET so handleSelectTargetWithToken
        // is called when target is clicked, which handles AUTO_STEPS continuation
        const selectTargetAction: AbilityAction = {
          type: 'ENTER_MODE',
          mode: 'SELECT_TARGET',
          sourceCard: action.sourceCard,
          sourceCoords: action.sourceCoords,
          isDeployAbility: action.isDeployAbility,
          readyStatusToRemove: action.readyStatusToRemove,
          // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
          ...(firstStep.chainedAction ? { chainedAction: firstStep.chainedAction } : {}),
          payload: {
            ...firstStep.details,
            actionType: firstStep.action,
            tokenType: firstStep.details?.tokenType,
            count: firstStep.details?.count || 1,
            mustBeInLineWithSource,
            mustBeAdjacentToSource,
            filter: firstStep.details?.filter,
            _autoStepsContext: {
              steps: steps,
              currentStepIndex: 1,
              originalType: action.payload?.originalType,
              supportRequired: action.payload?.supportRequired,
              readyStatusToRemove: action.readyStatusToRemove,
              commandCardId: action.payload?.commandCardId || action.sourceCard?.id
            }
          }
        }
        const targets = calculateValidTargets(selectTargetAction, gameState, ownerId, commandContext)

        // If no valid targets for CREATE_STACK, skip this step
        if (targets.length === 0) {
          props.clearTargetingMode?.()
          // If this was the only step, mark ability as used and clear ability mode
          if (steps.length === 1) {
            markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
            setAbilityMode(null)
          } else {
            // Continue to next step
            const updatedAction = {
              ...action,
              payload: {
                ...action.payload,
                currentStepIndex: 1
              }
            }
            setTimeout(() => {
              handleEnterMode(updatedAction, sourceCoords, props)
            }, 50)
          }
          return
        }

        setTargetingMode(selectTargetAction, ownerId, sourceCoords, targets, commandContext)
        return
      }

      // If first step is instant (no mode), execute it immediately
      if (!firstStep.mode) {
        // Use the universal instant step handler
        const ownerId = getSafePlayerId(action, localPlayerId)
        const result = executeInstantAutoStep(
          firstStep,
          action.sourceCoords,
          ownerId,
          {
            gameState,
            localPlayerId,
            commandContext,
            addBoardCardStatus,
            modifyBoardCardPower: props.modifyBoardCardPower,
          }
        )

        if (!result.success) {
        }

        // Now process the next step
        const nextStepIndex = 1

        // If there are no more steps, mark ability as used
        if (nextStepIndex >= steps.length) {
          markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
          return
        }

        const nextStep = steps[nextStepIndex]

        // CRITICAL: CREATE_STACK always requires user interaction, even with mode: null
        // Set up token cursor stack and targeting mode for CREATE_STACK as next step
        if (nextStep.action === 'CREATE_STACK') {
          const mustBeInLineWithSource = nextStep.mode === 'LINE_TARGET' ? true : undefined
          const mustBeAdjacentToSource = nextStep.mode === 'ADJACENT_TARGET' ? true : undefined

          const stackAction: AbilityAction = {
            type: 'CREATE_STACK',
            tokenType: nextStep.details?.tokenType,
            count: nextStep.details?.count || 1,
            mustBeInLineWithSource,
            mustBeAdjacentToSource,
            onlyOpponents: nextStep.details?.onlyOpponents,
            onlyFaceDown: nextStep.details?.onlyFaceDown,
            targetOwnerId: nextStep.details?.targetOwnerId,
            excludeOwnerId: nextStep.details?.excludeOwnerId,
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
            ...(nextStep.chainedAction ? { chainedAction: nextStep.chainedAction } : {}),
            payload: {
              ...nextStep.details,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          handleCreateStack(stackAction, sourceCoords, props)

          // Also set abilityMode to SELECT_TARGET so handleSelectTargetWithToken
          // is called when target is clicked, which handles AUTO_STEPS continuation
          const selectTargetAction: AbilityAction = {
            type: 'ENTER_MODE',
            mode: 'SELECT_TARGET',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...nextStep.details,
              actionType: nextStep.action,
              tokenType: nextStep.details?.tokenType,
              count: nextStep.details?.count || 1,
              mustBeInLineWithSource,
              mustBeAdjacentToSource,
              filter: nextStep.details?.filter,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          const targets = calculateValidTargets(selectTargetAction, gameState, ownerId, commandContext)

          // If no valid targets for CREATE_STACK, skip this step
          if (targets.length === 0) {
            props.clearTargetingMode?.()
            // If this was the last step, mark ability as used and clear ability mode
            if (nextStepIndex + 1 >= steps.length) {
              markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
              setAbilityMode(null)
            } else {
              // Continue to next step
              const updatedAction = {
                ...action,
                payload: {
                  ...action.payload,
                  currentStepIndex: nextStepIndex + 1
                }
              }
              setTimeout(() => {
                handleEnterMode(updatedAction, sourceCoords, props)
              }, 50)
            }
            return
          }

          setTargetingMode(selectTargetAction, ownerId, sourceCoords, targets, commandContext)
          return
        }

        // If next step is also instant (no mode), execute it recursively
        if (!nextStep.mode) {
          const updatedAction = {
            ...action,
            payload: {
              ...action.payload,
              currentStepIndex: nextStepIndex
            }
          }
          setTimeout(() => {
            handleEnterMode(updatedAction, sourceCoords, props)
          }, 50)
          return
        }

        // Next step requires interaction - set up ability mode with context
        const updatedAction = {
          ...action,
          payload: {
            ...action.payload,
            currentStepIndex: nextStepIndex
          }
        }
        setAbilityMode(updatedAction)

        // Enter the appropriate mode for the next step
        if (nextStep.action === 'CREATE_TOKEN') {
          // CREATE_TOKEN needs to be converted to OPEN_MODAL with PLACE_TOKEN mode
          const tokenAction: AbilityAction = {
            type: 'OPEN_MODAL',
            mode: 'PLACE_TOKEN',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...nextStep.details,
              tokenId: nextStep.details?.tokenId,
              range: nextStep.mode === 'ADJACENT_EMPTY' ? 'adjacent' : 'global',
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          handleOpenModal(tokenAction, sourceCoords, props)
          return
        }

        if (nextStep.action === 'CREATE_STACK') {
          // CREATE_STACK needs special handling to create token cursor stack
          // Properties must be at action level (not in payload) for handleCreateStack to read them
          const mustBeInLineWithSource = nextStep.mode === 'LINE_TARGET' ? true : undefined
          const mustBeAdjacentToSource = nextStep.mode === 'ADJACENT_TARGET' ? true : undefined

          const stackAction: AbilityAction = {
            type: 'CREATE_STACK',
            tokenType: nextStep.details?.tokenType,
            count: nextStep.details?.count || 1,
            mustBeInLineWithSource,
            mustBeAdjacentToSource,
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...nextStep.details,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          handleCreateStack(stackAction, sourceCoords, props)

          // Also set abilityMode to SELECT_TARGET so handleSelectTargetWithToken
          // is called when target is clicked, which handles AUTO_STEPS continuation
          const selectTargetAction: AbilityAction = {
            type: 'ENTER_MODE',
            mode: 'SELECT_TARGET',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...nextStep.details,
              actionType: nextStep.action,  // Set actionType so handlers know how to process this
              tokenType: nextStep.details?.tokenType,
              count: nextStep.details?.count || 1,
              mustBeInLineWithSource,
              mustBeAdjacentToSource,
              filter: nextStep.details?.filter,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          const targets = calculateValidTargets(selectTargetAction, gameState, ownerId, commandContext)

          // If no valid targets for CREATE_STACK, skip this step
          if (targets.length === 0) {
            props.clearTargetingMode?.()
            // If this was the last step, mark ability as used and clear ability mode
            if (nextStepIndex + 1 >= steps.length) {
              markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
              setAbilityMode(null)  // CRITICAL: Clear ability mode
            }
            return
          }

          setTargetingMode(selectTargetAction, ownerId, sourceCoords, targets, commandContext)
          return
        }

        // PUSH action
        if (nextStep.action === 'PUSH') {
          // Create SELECT_TARGET mode with actionType PUSH to check for valid targets
          // CRITICAL: Use SELECT_TARGET mode (not PUSH mode) so payload.actionType === 'PUSH'
          // handler in handleSelectTargetActionType is called, which properly handles _autoStepsContext
          const pushAction: AbilityAction = {
            type: 'ENTER_MODE',
            mode: 'SELECT_TARGET',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...nextStep.details,
              actionType: 'PUSH',  // CRITICAL: Tells handleSelectTargetActionType to use PUSH logic
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex + 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }

          // Calculate valid targets for PUSH
          const targets = calculateValidTargets(pushAction, gameState, ownerId, commandContext)

          // If no valid targets, skip this step and complete the ability
          if (targets.length === 0) {
            props.clearTargetingMode?.()
            // This was the last step, mark ability as used and clear ability mode
            markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
            setAbilityMode(null)  // CRITICAL: Clear ability mode so App.tsx doesn't try to calculate targets
            return
          }

          // Set ability mode and targeting mode for PUSH
          setAbilityMode(pushAction)
          setTargetingMode(pushAction, ownerId, sourceCoords, targets, commandContext)
          return
        }

        // Default interactive step handling
        // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
        // These are targeting constraints, not separate modes. The constraint is stored in payload.
        const normalizedMode = (nextStep.mode === "LINE_TARGET" || nextStep.mode === "ADJACENT_TARGET")
          ? "SELECT_TARGET"
          : (nextStep.mode || "SELECT_TARGET")

        const stepAction: AbilityAction = {
          type: 'ENTER_MODE',
          mode: normalizedMode,
          sourceCard: action.sourceCard,
          sourceCoords: action.sourceCoords,
          isDeployAbility: action.isDeployAbility,
          readyStatusToRemove: action.readyStatusToRemove,
          // CRITICAL: Preserve chainedAction from step level (for multi-step commands)
          ...(nextStep.chainedAction ? { chainedAction: nextStep.chainedAction } : {}),
          payload: {
            ...nextStep.details,
            // Only set actionType from nextStep.action if not already in details
            // This preserves actionType: 'DESTROY' from details for multi-step abilities
            ...(nextStep.details?.actionType ? {} : { actionType: nextStep.action }),
            tokenType: nextStep.details?.tokenType,
            count: nextStep.details?.count,
            mustBeInLineWithSource: nextStep.mode === 'LINE_TARGET' ? true : undefined,
            mustBeAdjacentToSource: nextStep.mode === 'ADJACENT_TARGET' ? true : undefined,
            _autoStepsContext: {
              steps: steps,
              currentStepIndex: nextStepIndex + 1,
              originalType: action.payload?.originalType,
              supportRequired: action.payload?.supportRequired,
              readyStatusToRemove: action.readyStatusToRemove
            }
          }
        }

        // Calculate targets for the interactive mode
        const targets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)

        // If no valid targets, skip this step and continue to the next one
        if (targets.length === 0) {
          // Clear targeting mode if set
          props.clearTargetingMode?.()

          // Check if there are more steps after this one
          const followingStepIndex = nextStepIndex + 1
          if (followingStepIndex >= steps.length) {
            // No more steps - mark ability as used and clear ability mode
            markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
            setAbilityMode(null)  // CRITICAL: Clear ability mode so App.tsx doesn't try to calculate targets
            return
          }

          // Continue to the following step
          const updatedAction = {
            ...action,
            payload: {
              ...action.payload,
              currentStepIndex: followingStepIndex
            }
          }
          setTimeout(() => {
            handleEnterMode(updatedAction, sourceCoords, props)
          }, 50)
          return
        }

        setTargetingMode(stepAction, ownerId, sourceCoords, targets, commandContext)
        return
      } else {
        // First step is interactive - create proper action with the step's mode
        const ownerId = getSafePlayerId(action, localPlayerId)

        // Special handling for CREATE_STACK as first step
        if (firstStep.action === 'CREATE_STACK' && firstStep.mode) {
          const mustBeInLineWithSource = firstStep.mode === 'LINE_TARGET' ? true : undefined
          const mustBeAdjacentToSource = firstStep.mode === 'ADJACENT_TARGET' ? true : undefined

          const stackAction: AbilityAction = {
            type: 'CREATE_STACK',
            tokenType: firstStep.details?.tokenType,
            count: firstStep.details?.count || 1,
            mustBeInLineWithSource,
            mustBeAdjacentToSource,
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...firstStep.details,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }

          // Call handleCreateStack to create cursor stack
          handleCreateStack(stackAction, sourceCoords, props)

          // Also set abilityMode to SELECT_TARGET for AUTO_STEPS continuation
          const selectTargetAction: AbilityAction = {
            type: 'ENTER_MODE',
            mode: 'SELECT_TARGET',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...firstStep.details,
              actionType: firstStep.action,  // Set actionType so handlers know how to process this
              tokenType: firstStep.details?.tokenType,
              count: firstStep.details?.count || 1,
              mustBeInLineWithSource,
              mustBeAdjacentToSource,
              filter: firstStep.details?.filter,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove
              }
            }
          }
          const targets = calculateValidTargets(selectTargetAction, gameState, ownerId, commandContext)

          // If no valid targets for CREATE_STACK, skip this step
          if (targets.length === 0) {
            props.clearTargetingMode?.()
            // If this was the only step, mark ability as used and clear ability mode
            if (steps.length === 1) {
              markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
              setAbilityMode(null)  // CRITICAL: Clear ability mode
            }
            return
          }

          setTargetingMode(selectTargetAction, ownerId, sourceCoords, targets, commandContext)
          return
        }

        // Special handling for OPEN_MODAL as first step (Quick Response Team option 2, etc.)
        if (firstStep.action === 'OPEN_MODAL' && firstStep.mode === 'SEARCH_DECK') {
          console.log('[handleEnterMode] OPEN_MODAL SEARCH_DECK step:', {
            filterType: firstStep.details?.filterType,
            shuffleOnClose: firstStep.details?.shuffleOnClose,
          })

          // Set abilityMode with AUTO_STEPS context for continuation after modal closes
          const modalAction: AbilityAction = {
            type: 'ENTER_MODE',
            mode: 'SEARCH_DECK',
            sourceCard: action.sourceCard,
            sourceCoords: action.sourceCoords,
            isDeployAbility: action.isDeployAbility,
            readyStatusToRemove: action.readyStatusToRemove,
            payload: {
              ...firstStep.details,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: 1,
                originalType: action.payload?.originalType,
                supportRequired: action.payload?.supportRequired,
                readyStatusToRemove: action.readyStatusToRemove,
                commandCardId: action.payload?.commandCardId || action.sourceCard?.id
              }
            }
          }
          setAbilityMode(modalAction)

          // Open the deck view modal with pickConfig
          const sourceOwnerId = action.sourceCard?.ownerId ?? ownerId
          const player = gameState.players.find(p => p.id === sourceOwnerId)
          if (player && props.setViewingDiscard) {
            const autoStepsContext = {
              steps: steps,
              currentStepIndex: 1,
              originalType: action.payload?.originalType,
              supportRequired: action.payload?.supportRequired,
              readyStatusToRemove: action.readyStatusToRemove,
              commandCardId: action.payload?.commandCardId || action.sourceCard?.id,
              // Store additional info for AUTO_STEPS continuation
              sourceCoords: action.sourceCoords,
              isDeployAbility: action.isDeployAbility,
            }
            props.setViewingDiscard({
              player,
              isDeckView: true,
              pickConfig: {
                filterType: firstStep.details?.filterType || 'Unit',
                action: 'recover', // Default action for deck search
                isDeck: true
              },
              shuffleOnClose: firstStep.details?.shuffleOnClose,
              // Store AUTO_STEPS context for continuation after card selection
              _autoStepsContext: autoStepsContext,
              sourceCard: action.sourceCard,
              sourceCoords: action.sourceCoords,
              isDeployAbility: action.isDeployAbility,
              readyStatusToRemove: action.readyStatusToRemove
            })
            // Trigger deck selection effect
            if (props.triggerDeckSelection) {
              props.triggerDeckSelection(player.id, gameState.activePlayerId ?? ownerId)
            }
          }
          return
        }

        // Default handling for other interactive first steps
        // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
        const normalizedMode = (firstStep.mode === "LINE_TARGET" || firstStep.mode === "ADJACENT_TARGET")
          ? "SELECT_TARGET"
          : (firstStep.mode || "SELECT_TARGET")

        // DIAGNOSTIC: Log firstStep details for debugging chainedAction
        console.log('[handleEnterMode] First interactive step (SELECT_UNIT_FOR_MOVE etc):', {
          stepAction: firstStep.action,
          stepMode: firstStep.mode,
          hasChainedAction: !!firstStep.chainedAction,
          chainedActionKeys: firstStep.chainedAction ? Object.keys(firstStep.chainedAction) : [],
          chainedActionType: firstStep.chainedAction?.type,
          chainedActionAction: (firstStep.chainedAction as any)?.action,
          chainedActionPayload: firstStep.chainedAction?.payload,
          chainedActionDetails: (firstStep.chainedAction as any)?.details,
        })

        const stepAction: AbilityAction = {
          type: 'ENTER_MODE',
          mode: normalizedMode,
          sourceCard: action.sourceCard,
          sourceCoords: action.sourceCoords,
          isDeployAbility: action.isDeployAbility,
          readyStatusToRemove: action.readyStatusToRemove,
          // CRITICAL: Preserve chainedAction from step level (for Tactical Maneuver draw/score)
          ...(firstStep.chainedAction ? { chainedAction: firstStep.chainedAction } : {}),
          // CRITICAL: Add originalOwnerId so handleSelectUnitForMove can use it for highlight color
          // This fixes Data Interception option 1 where cell selection highlight used wrong color
          originalOwnerId: ownerId,
          payload: {
            ...firstStep.details,
            // Only set actionType from firstStep.action if not already in details
            // This preserves actionType: 'DESTROY' from details for Centurion Commit
            ...(firstStep.details?.actionType ? {} : { actionType: firstStep.action }),
            tokenType: firstStep.details?.tokenType,
            count: firstStep.details?.count,
            mustBeInLineWithSource: firstStep.mode === 'LINE_TARGET' ? true : undefined,
            mustBeAdjacentToSource: firstStep.mode === 'ADJACENT_TARGET' ? true : undefined,
            _autoStepsContext: {
              steps: steps,
              currentStepIndex: 1,
              originalType: action.payload?.originalType,
              supportRequired: action.payload?.supportRequired,
              readyStatusToRemove: action.readyStatusToRemove,
              // CRITICAL: Pass commandCardId for CLEANUP_COMMAND to find the correct card
              commandCardId: action.payload?.commandCardId || action.sourceCard?.id
            }
          }
        }

        console.log('[handleEnterMode] Created stepAction:', {
          stepActionType: stepAction.type,
          stepActionMode: stepAction.mode,
          hasStepActionChainedAction: !!stepAction.chainedAction,
          stepActionChainedActionType: stepAction.chainedAction?.type,
          stepActionChainedActionPayload: stepAction.chainedAction?.payload,
        })
        setAbilityMode(stepAction)

        // Calculate targets for the interactive mode
        const targets = calculateValidTargets(stepAction, gameState, ownerId, commandContext)

        // CRITICAL: Handle hand-only actions (SELECT_HAND_FOR_DEPLOY, etc.)
        // These return empty board targets but need hand targets calculated
        const isHandOnlyAction = stepAction.payload?.actionType === 'SELECT_HAND_FOR_DEPLOY' ||
                                stepAction.payload?.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN' ||
                                stepAction.payload?.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN' ||
                                stepAction.payload?.actionType === 'LUCIUS_SETUP' ||
                                stepAction.payload?.handOnly

        let handTargets: {playerId: number, cardIndex: number}[] = []

        if (isHandOnlyAction) {
          // Calculate valid hand targets for this action
          const sourceOwnerId = stepAction.sourceCard?.ownerId ?? ownerId
          const player = gameState.players.find(p => p.id === sourceOwnerId)

          if (player && player.hand) {
            // Build filter function from string if needed
            let filterFn = stepAction.payload.filter
            if (typeof filterFn !== 'function' && typeof filterFn === 'string') {
              filterFn = buildFilterFromString(filterFn, sourceOwnerId, sourceCoords || { row: 0, col: 0 })
            }

            // Find all cards in hand that pass the filter
            for (let i = 0; i < player.hand.length; i++) {
              const card = player.hand[i]
              if (filterFn) {
                if (filterFn(card)) {
                  handTargets.push({ playerId: player.id, cardIndex: i })
                }
              } else {
                // No filter means all cards are valid
                handTargets.push({ playerId: player.id, cardIndex: i })
              }
            }
          }
        }

        // If no valid targets (board or hand), skip this step
        if (targets.length === 0 && handTargets.length === 0) {
          props.clearTargetingMode?.()
          // If this was the only step, mark ability as used and clear ability mode
          if (steps.length === 1) {
            markAbilityUsed(sourceCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
            setAbilityMode(null)  // CRITICAL: Clear ability mode
          }
          return
        }

        setTargetingMode(stepAction, ownerId, sourceCoords, targets, commandContext, handTargets)
      }
    } else {
      setAbilityMode(action)
    }
    return
  }

  // SELECT_LINE_FOR_SUPPORT_COUNTERS (Signal Prophet Deploy)
  // CRITICAL: Do NOT call setTargetingMode - line selection modes use abilityMode only!
  if (mode === 'SELECT_LINE_FOR_SUPPORT_COUNTERS') {
    setAbilityMode(action)
    return
  }

  // SELECT_LINE_FOR_THREAT_COUNTERS (Code Keeper Deploy)
  // CRITICAL: Do NOT call setTargetingMode - line selection modes use abilityMode only!
  if (mode === 'SELECT_LINE_FOR_THREAT_COUNTERS') {
    setAbilityMode(action)
    return
  }

  // SELECT_LINE_FOR_EXPLOIT_SCORING (Zius Setup, Unwavering Integrator Setup)
  // CRITICAL: Do NOT call setTargetingMode - line selection modes use abilityMode only!
  if (mode === 'SELECT_LINE_FOR_EXPLOIT_SCORING') {
    // CRITICAL: Add sourceRow and sourceCol to payload for line selection handler
    // This fixes Unwavering Integrator line selection not working when clicking empty cells
    const targetingAction: AbilityAction = {
      ...action,
      payload: {
        ...action.payload,
        sourceRow: sourceCoords.row,
        sourceCol: sourceCoords.col,
      }
    }
    setAbilityMode(targetingAction)
    return
  }

  // SELECT_CELL (False Orders, Data Interception, etc.)
  // CRITICAL: Only board targets (empty cells), NO hand targets
  if (mode === 'SELECT_CELL') {
    setAbilityMode(action)
    // SELECT_CELL is for selecting empty cells on the board, not cards in hand
    // Do NOT set targeting mode with hand targets
    // Empty cell highlighting is handled by GameBoard based on abilityMode
    return
  }

  // Default mode activation
  // Calculate valid targets if mode supports targeting
  const defaultTargets = calculateValidTargets(action, gameState, action.sourceCard?.ownerId || localPlayerId, commandContext)
  setAbilityMode(action)
  setTargetingMode(action, getSafePlayerId(action, localPlayerId), sourceCoords, defaultTargets, commandContext)
}

/**
 * Handle context reward actions
 * NOTE: This function prepares data and sends GLOBAL_AUTO_APPLY to the host.
 * The actual reward logic (draw/score/stun/etc.) is executed by the host in SimpleGameLogic.ts
 * This ensures single source of truth for all ability effects.
 */
function handleContextReward(
  action: AbilityAction,
  sourceCoords: { row: number; col: number },
  props: ActionHandlerProps
): void {
  const { sendAction, localPlayerId, commandContext, triggerFloatingText, getFreshGameState } = props

  const rewardType = action.payload?.contextReward
  if (!rewardType) {
    return
  }

  // CRITICAL: Use pre-calculated card power from contextCardPower (set in handleSelectUnitForMove)
  // This is more reliable than searching for the card after it has moved
  let cardPower = action.payload?.contextCardPower || action.payload?._cardPower || 0
  let displayCoords = sourceCoords

  // Fallback: search for card if power not provided
  if (cardPower === 0) {
    const freshState = getFreshGameState()
    const searchId = action.payload?._tempContextId || commandContext.lastMovedCardId

    // Search by card ID across entire board
    if (searchId) {
      for (let r = 0; r < freshState.board.length; r++) {
        for (let c = 0; c < freshState.board[r].length; c++) {
          const card = freshState.board[r][c].card
          if (card && card.id === searchId) {
            cardPower = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
            displayCoords = { row: r, col: c }
            break
          }
        }
        if (cardPower > 0) break
      }
    }
  }

  // Send GLOBAL_AUTO_APPLY with contextReward data to the host
  // The host will execute the actual reward logic (draw cards, add score, etc.)
  const globalAutoApplyData = {
    payload: {
      ...action.payload,
      contextReward: rewardType,
      _tempContextId: action.payload?._tempContextId || commandContext.lastMovedCardId,
      lastMovedCardCoords: displayCoords,
      // Pass card power so host can use it immediately without searching
      _cardPower: cardPower,
      contextCardPower: cardPower, // Also pass as contextCardPower for clarity
    },
    sourceCard: action.sourceCard,
    sourceCoords: displayCoords,
    originalOwnerId: action.originalOwnerId,
    isDeployAbility: action.isDeployAbility,
    readyStatusToRemove: action.readyStatusToRemove,
  }

  console.log('[handleContextReward] Sending GLOBAL_AUTO_APPLY to host:', {
    rewardType,
    cardPower,
    coords: displayCoords,
    sourceCardId: action.sourceCard?.id,
  })

  sendAction('GLOBAL_AUTO_APPLY', globalAutoApplyData)

  // Show floating text immediately for better UX (host will also apply the actual effect)
  if (rewardType === 'SCORE_MOVED_POWER' && cardPower > 0) {
    triggerFloatingText([{
      row: displayCoords.row,
      col: displayCoords.col,
      text: `+${cardPower}`,
      playerId: action.sourceCard?.ownerId || localPlayerId || 0,
    }])
  }
}
