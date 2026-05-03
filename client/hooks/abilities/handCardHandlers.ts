/**
 * Hand Card Click Handlers
 *
 * Handles clicks on cards in players' hands
 */

import type { Card, Player, AbilityAction, CursorStackState } from '@/types'
import { TIMING } from '@/utils/common'
import { validateTarget } from '@shared/utils/targeting'
import { READY_STATUS } from '@shared/abilities/readySystem.js'
import { hasReadyStatus } from '@shared/abilities/readySystem.js'
import { flushSync } from 'react-dom'

 

export interface HandCardClickProps {
  gameState: any
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  cursorStack: CursorStackState | null
  setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>
  setCommandContext: React.Dispatch<React.SetStateAction<any>>
  interactionLock: React.MutableRefObject<boolean>
  moveItem: (item: any, target: any) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  triggerHandCardSelection: (playerId: number, cardIndex: number, actorId: number) => void
  activateAbility: (card: Card, coords: { row: number; col: number }) => void
  clearTargetingMode: () => void
  clearValidTargets?: () => void
  setPlayMode?: React.Dispatch<React.SetStateAction<{ card: Card; sourceItem: any; faceDown?: boolean } | null>>
  setActionQueue?: React.Dispatch<React.SetStateAction<AbilityAction[]>>
  onAction?: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
}

/**
 * Handle click on a card in hand
 */
export function handleHandCardClick(
  player: Player,
  card: Card,
  cardIndex: number,
  props: HandCardClickProps
): void {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    cursorStack,
    interactionLock,
    setCommandContext,
    setAbilityMode,
    moveItem,
    markAbilityUsed,
    handleActionExecution,
    triggerHandCardSelection,
    setCursorStack,
    clearTargetingMode,
    clearValidTargets,
    setPlayMode,
    setActionQueue,
    onAction,
  } = props

  console.log('[HAND_CARD_CLICK] Clicked:', {
    cardName: card.name,
    cardIndex,
    playerId: player.id,
    interactionLock: interactionLock.current,
    hasCursorStack: !!cursorStack,
    cursorStackType: cursorStack?.type,
    hasAbilityMode: !!abilityMode,
    abilityModeType: abilityMode?.type,
    abilityModeMode: abilityMode?.mode,
    actionType: abilityMode?.payload?.actionType,
  })

  if (interactionLock.current) {
    console.log('[HAND_CARD_CLICK] BLOCKED by interactionLock')
    return
  }

  // Handle cursorStack for hand cards (e.g., Revealed tokens from Threat Analyst)
  if (cursorStack) {
    // RULE: Targeting tokens (Aim, Exploit, Stun, Shield) cannot be placed on cards in hand
    // Only Rule tokens (and Revealed status) can be placed on hand cards
    const targetingTokens = ['Aim', 'Exploit', 'Stun', 'Shield']
    if (targetingTokens.includes(cursorStack.type)) {
      // Silently ignore - do not allow targeting tokens on hand cards
      return
    }

    // Check if this card is a valid target for the cursorStack
    const constraints = {
      targetOwnerId: cursorStack.targetOwnerId,
      excludeOwnerId: cursorStack.excludeOwnerId,
      onlyOpponents: cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1),
      onlyFaceDown: cursorStack.onlyFaceDown,
      targetType: cursorStack.targetType,
      requiredTargetStatus: cursorStack.requiredTargetStatus,
      tokenType: cursorStack.type,
    }

    const isValid = validateTarget(
      { card, ownerId: player.id, location: 'hand' },
      constraints,
      gameState.activePlayerId,
      gameState.players,
      cursorStack.originalOwnerId // CRITICAL: Pass token owner ID for command cards
    )

      // Apply the token/status to the card
      if (cursorStack.type === 'Revealed') {
        // For Revealed, we need to request reveal or add status
        const effectiveActorId = cursorStack.sourceCard?.ownerId ?? gameState.activePlayerId ?? localPlayerId ?? 1
        if (!card.statuses) {
          card.statuses = []
        }
        // Check if already has Revealed from this player
        const hasRevealed = card.statuses.some(s => s.type === 'Revealed' && s.addedByPlayerId === effectiveActorId)
        if (!hasRevealed) {
          card.statuses.push({ type: 'Revealed', addedByPlayerId: effectiveActorId })
          // Update state via moveItem to properly sync
          moveItem({
            card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', types: [] },
            source: 'counter_panel',
            statusType: 'Revealed',
            count: 1,
          }, { target: 'hand', playerId: player.id, cardIndex })

          // CRITICAL: Mark ability as used with proper readyStatusToRemove
          if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
            const readyStatusToRemove = cursorStack.readyStatusToRemove || (cursorStack as any)._originalReadyStatusToRemove
            markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility, false, readyStatusToRemove)
          }
        } else {
        }

        // CRITICAL: Always clear targeting mode when clicking on a valid hand card
        // Even if the status was already present, the click should complete the ability
        if (cursorStack.count > 1) {
          setCursorStack(prev => prev ? ({ ...prev, count: prev.count - 1 }) : null)
        } else {
          // CRITICAL: Clear abilityMode AND cursorStack FIRST and SYNCHRONOUSLY to prevent
          // useEffect in App.tsx from restoring targetingMode
          // The useEffect checks if abilityMode or cursorStack is active and may restore targetingMode
          flushSync(() => {
            setAbilityMode(null)
            setCursorStack(null)
          })

          // NOW clear targeting mode - it won't be restored because both abilityMode and cursorStack are null
          clearTargetingMode()
          clearValidTargets?.()

          // CRITICAL: Execute chainedAction after all Revealed tokens are placed
          // This fixes Data Interception option 0 where chainedAction needs to execute
          // after placing all Revealed tokens
          const chained = cursorStack.chainedAction
          if (chained) {

            // Use actionQueue if available (preferred path)
            if (setActionQueue) {
              setTimeout(() => {
                setActionQueue(prev => [...prev, chained])
              }, 0)
            } else if (onAction) {
              // Fallback: execute directly if setActionQueue not available
              const sourceCoords = cursorStack.sourceCoords || { row: -1, col: -1 }
              setTimeout(() => {
                onAction(chained, sourceCoords)
              }, 0)
            }
          }

          // CRITICAL: Continue AUTO_STEPS if this CREATE_STACK was part of a multi-step command
          // This fixes Data Interception where after placing Revealed tokens, we need to continue to CLEANUP_COMMAND
          const autoStepsContext = (cursorStack as any)._autoStepsContext
          if (autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined) {
            console.log('[HAND_CARD_CLICK] Continuing AUTO_STEPS after CREATE_STACK completion:', {
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
              sourceCard: cursorStack.sourceCard,
              sourceCoords: cursorStack.sourceCoords,
            }
            if (setActionQueue) {
              setTimeout(() => {
                setActionQueue(prev => [...prev, continueAction])
              }, 0)
            } else if (onAction) {
              const sourceCoords = cursorStack.sourceCoords || { row: -1, col: -1 }
              setTimeout(() => {
                onAction(continueAction, sourceCoords)
              }, 0)
            }
          }
        }
      }
    }
    // REMOVED: return statement that was blocking abilityMode processing
    // This return was incorrectly placed outside the if (cursorStack) block

  // Add visual selection effect when card is clicked during selection mode
  if (abilityMode?.type === 'ENTER_MODE' && abilityMode.mode === 'SELECT_TARGET') {
    const { payload, sourceCoords, isDeployAbility, sourceCard, readyStatusToRemove } = abilityMode

    console.log('[HAND_CARD_CLICK] Inside SELECT_TARGET block, actionType:', payload.actionType)

    // Trigger hand card selection effect visible to all players via WebSocket (before any filtering)
    triggerHandCardSelection(player.id, cardIndex, gameState.activePlayerId ?? localPlayerId ?? 1)

    // SELECT_HAND_FOR_DEPLOY (Quick Response Team)
    if (payload.actionType === 'SELECT_HAND_FOR_DEPLOY') {
      if (payload.filter && !payload.filter(card)) {
        return
      }

      // Store command card info to mark as used when play completes
      // Store selected card info for reference
      setCommandContext((prev: any) => ({
        ...prev,
        pendingCommandCard: {
          sourceCoords: abilityMode.sourceCoords,
          isDeployAbility: abilityMode.isDeployAbility,
          readyStatusToRemove: abilityMode.readyStatusToRemove,
        },
        selectedHandCard: { playerId: player.id, cardIndex, card }
      }))

      // CRITICAL: Clear ability mode SYNCHRONOUSLY before setting playMode
      // This ensures that when the user clicks an empty cell, the playMode check
      // in GameBoard handleClick happens before any abilityMode check
      flushSync(() => {
        setAbilityMode(null)
      })

      // Clear targeting mode and valid targets
      clearTargetingMode()
      clearValidTargets?.()

      // Start normal play mode for the selected Unit card
      const sourceItem: any = { card, source: 'hand', playerId: player.id, cardIndex }
      if (setPlayMode) {
        setPlayMode({ card, sourceItem, faceDown: false })
      }
      return
    }

    // SELECT_HAND_FOR_DISCARD_THEN_SPAWN (Faber)
    if (payload.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN') {
      // Apply filter to validate the card
      if (payload.filter && !payload.filter(card)) {
        return
      }
      // CRITICAL: Use fallback to localPlayerId like handleEnterMode does
      const sourceOwnerId = sourceCard?.ownerId ?? localPlayerId ?? player.id
      if (player.id !== sourceOwnerId) {
        return
      } // Only discard own cards

      // 1. Discard the selected card
      moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })

      // 2. Clear old targeting mode (SELECT_TARGET) and valid targets (hand cards)
      clearTargetingMode()
      clearValidTargets?.()

      // 3. Chain to SPAWN_TOKEN mode
      const spawnTokenAction: AbilityAction = {
        type: 'ENTER_MODE',
        mode: 'SPAWN_TOKEN',
        sourceCard: sourceCard,
        sourceCoords: sourceCoords,
        isDeployAbility: isDeployAbility,
        payload: { tokenName: payload.tokenName },
      }

      setAbilityMode(spawnTokenAction)

      // 4. Set new targeting mode for SPAWN_TOKEN to show valid empty cells
      // This uses the same mechanism as other ENTER_MODE actions
      if (sourceCoords && sourceCoords.row >= 0) {
        // Call handleActionExecution to properly set targetingMode for SPAWN_TOKEN
        setTimeout(() => {
          handleActionExecution(spawnTokenAction, sourceCoords)
        }, 0)
      }
      return
    }

    // SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN (Faber - CREATE_TOKEN with cost)
    if (payload.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN') {
      console.log('[HAND_CARD_CLICK] SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN matched!')

      // Apply filter to validate the card
      if (payload.filter && !payload.filter(card)) {
        console.log('[HAND_CARD_CLICK] Filter failed, card:', card.name)
        return
      }
      // CRITICAL: Use fallback to localPlayerId like handleEnterMode does
      // This fixes the issue where sourceCard?.ownerId might be undefined
      const sourceOwnerId = sourceCard?.ownerId ?? localPlayerId ?? player.id
      console.log('[HAND_CARD_CLICK] Owner check:', {
        playerId: player.id,
        sourceOwnerId,
        sourceCardName: sourceCard?.name,
        localPlayerId,
      })
      if (player.id !== sourceOwnerId) {
        console.log('[HAND_CARD_CLICK] Owner check FAILED')
        return
      } // Only discard own cards
      console.log('[HAND_CARD_CLICK] All checks passed, discarding...')

      // 1. Discard the selected card
      moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })

      // 2. Clear old targeting mode (SELECT_TARGET) and valid targets (hand cards)
      clearTargetingMode()
      clearValidTargets?.()

      // 3. Chain to PLACE_TOKEN mode for token creation
      const placeTokenAction: AbilityAction = {
        type: 'OPEN_MODAL',
        mode: 'PLACE_TOKEN',
        sourceCard: sourceCard,
        sourceCoords: sourceCoords,
        isDeployAbility: isDeployAbility,
        payload: {
          tokenId: payload.tokenId,
          range: payload.range || 'adjacent'
        }
      }

      setAbilityMode(placeTokenAction)

      // 4. Set new targeting mode for PLACE_TOKEN to show valid empty cells
      if (sourceCoords && sourceCoords.row >= 0) {
        setTimeout(() => {
          handleActionExecution(placeTokenAction, sourceCoords)
        }, 0)
      }
      return
    }

    // LUCIUS SETUP: Discard 1 -> Search Command
    if (payload.actionType === 'LUCIUS_SETUP') {
      // CRITICAL: Use fallback to localPlayerId like handleEnterMode does
      const sourceOwnerId = sourceCard?.ownerId ?? localPlayerId ?? player.id
      if (player.id !== sourceOwnerId) {
        return
      } // Only discard own cards

      // 1. Discard the selected card
      moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })

      // 2. Open Search Modal via Execution
      const openModalAction: AbilityAction = {
        type: 'OPEN_MODAL',
        mode: 'SEARCH_DECK',
        sourceCard: sourceCard,
        sourceCoords: sourceCoords, // This ensures ability gets marked used when modal closes
        isDeployAbility: isDeployAbility,
        payload: { filterType: 'Command' },
      }

      handleActionExecution(openModalAction, sourceCoords || { row: -1, col: -1 })
      setAbilityMode(null)
      return
    }

    // DESTROY Hand Card
    if (payload.actionType === 'DESTROY') {
      if (payload.filter && !payload.filter(card)) {
        return
      }
      moveItem({ card, source: 'hand', playerId: player.id, cardIndex, bypassOwnershipCheck: true }, { target: 'discard', playerId: player.id })
      if (sourceCoords && sourceCoords.row >= 0) {
        markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      }
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    }
  }
}

/**
 * Handle double click on an announced card (visible to all players)
 */
export function handleAnnouncedCardDoubleClick(
  player: Player,
  card: Card,
  props: HandCardClickProps
): void {
  const {
    abilityMode,
    cursorStack,
    interactionLock,
    gameState,
    activateAbility,
  } = props

  if (abilityMode || cursorStack) {
    return
  }
  if (interactionLock.current) {
    return
  }

  if (!gameState.isGameStarted) {
    return
  }
  if (gameState.activePlayerId !== player.id) {
    return
  }
  // Check if card can use Setup ability (phase 1 only)
  if (gameState.currentPhase !== 1 || !hasReadyStatus(card as any, READY_STATUS.SETUP)) {
    return
  }
  activateAbility(card, { row: -1, col: -1 })
}
