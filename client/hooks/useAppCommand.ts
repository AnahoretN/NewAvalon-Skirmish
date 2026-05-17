import { useCallback } from 'react'
import type { Card, GameState, AbilityAction, CommandContext, DragItem, CounterSelectionData } from '@/types'
import { getCommandActionByOption, getCommandOptions, isCommandCard } from '@/utils/autoAbilities'
import { logger } from '@/utils/logger'

interface UseAppCommandProps {
    gameState: GameState;
    localPlayerId: number | null;
    setActionQueue: React.Dispatch<React.SetStateAction<AbilityAction[]>>;
    setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>;
    setCommandModalCard: React.Dispatch<React.SetStateAction<Card | null>>;
    setCounterSelectionData: React.Dispatch<React.SetStateAction<CounterSelectionData | null>>;
    moveItem: (item: DragItem, target: any) => void;
    drawCard: (playerId: number) => void;
    drawCardsBatch: (playerId: number, count: number) => void;
    updatePlayerScore: (playerId: number, delta: number) => void;
    removeBoardCardStatus: (coords: any, status: string) => void;
    sendAction: (action: string, data?: any) => void;
}

export const useAppCommand = ({
  gameState,
  localPlayerId,
  setActionQueue,
  setCommandContext,
  setCommandModalCard,
  setCounterSelectionData,
  moveItem,
  // drawCard,
  // drawCardsBatch,
  updatePlayerScore,
  // removeBoardCardStatus,
  sendAction,
}: UseAppCommandProps) => {

  const playCommandCard = useCallback((card: Card, source: DragItem) => {
    if (localPlayerId === null) {
      return
    }
    const owner = gameState.players.find(p => p.id === source.playerId)
    const canControl = source.playerId === localPlayerId || (owner?.isDummy)

    if (!canControl) {
      return
    }

    // 1. Move to Showcase (Announced)
    moveItem(source, { target: 'announced', playerId: source.playerId! })

    // Reset context
    setCommandContext({})

    const baseId = card.baseId || card.id.split('_')[1] || card.id

    // 2. Check if this is a command card using the new system
    // Note: baseId is already camelCase from database, don't convert to lowercase
    if (isCommandCard(baseId)) {
      // Command card with options - open modal
      setCommandModalCard({ ...card, ownerId: source.playerId! })
    } else {
      // Simple Command (e.g. Mobilization without options)
      // For now, treat as single-option command
      const options = getCommandOptions(baseId)
      if (options.length === 1) {
        // Single option - execute directly
        const action = getCommandActionByOption(
          baseId,
          options[0].optionIndex,
          { ...card, ownerId: source.playerId! },
          gameState,
          source.playerId!,
          { row: -1, col: -1 }
        )

        // NOTE: Cleanup is now handled automatically as the final step in contentAbilities.ts
        if (action) {
          setActionQueue([action])
        }
      } else {
        // No options found - fallback to old behavior or show modal anyway
        setCommandModalCard({ ...card, ownerId: source.playerId! })
      }
    }
  }, [gameState, localPlayerId, moveItem, setActionQueue, setCommandContext, setCommandModalCard])

  const handleCommandConfirm = useCallback((optionIndex: number, commandModalCard: Card) => {
    if (!commandModalCard || localPlayerId === null) {
      return
    }

    const ownerId = commandModalCard.ownerId || localPlayerId
    const baseId = commandModalCard.baseId || commandModalCard.id.split('_')[1] || commandModalCard.id

    // Get the action for the selected option using the new system
    // Note: baseId is already camelCase from database, don't convert to lowercase
    const action = getCommandActionByOption(
      baseId,
      optionIndex + 1, // Convert 0-based to 1-based
      { ...commandModalCard, selectedOption: optionIndex + 1 },
      gameState,
      ownerId,
      { row: -1, col: -1 }
    )

    // NOTE: Cleanup is now handled automatically as the final step in contentAbilities.ts
    // No need to add cleanup action here anymore

    const queue: AbilityAction[] = []

    if (action) {
      queue.push(action)
    }

    setActionQueue(queue)
    setCommandModalCard(null)
  }, [gameState, localPlayerId, setActionQueue, setCommandModalCard])

  const handleCounterSelectionConfirm = useCallback((countsToRemove: Record<string, number>, data: CounterSelectionData) => {
    if (localPlayerId === null) {
      return
    }
    const ownerId = data.card.ownerId || localPlayerId

    // 1. Identify Board Coords of the card
    let boardCoords: { row: number, col: number } | null = null
    for (let r = 0; r < gameState.board.length; r++) {
      for (let c = 0; c < gameState.board[r].length; c++) {
        if (gameState.board[r][c].card?.id === data.card.id) {
          boardCoords = { row: r, col: c }
          break
        }
      }
      if (boardCoords) {
        break
      }
    }

    // If card was not found on board, log and cleanup only
    if (!boardCoords) {
      setCounterSelectionData(null)
      return
    }

    // Send action to remove counters with reward (works for both WebSocket and WebRTC)
    sendAction('REMOVE_COUNTERS_WITH_REWARD', {
      coords: boardCoords,
      countsToRemove,
      callbackAction: data.callbackAction,
    })

    // Apply score reward separately (it's not in gameState.board, so can be done separately)
    if (data.callbackAction === 'SCORE_REMOVED') {
      const totalRemoved = Object.values(countsToRemove).reduce((sum, count) => sum + count, 0)
      if (totalRemoved > 0) {
        updatePlayerScore(ownerId, totalRemoved)
      }
    }

    // CRITICAL: Continue to AUTO_STEPS cleanup step if context exists
    // This ensures the final cleanup step is executed for Inspiration command
    if (data.autoStepsContext) {
      const { steps, currentStepIndex, abilityAction } = data.autoStepsContext
      const nextStepIndex = currentStepIndex + 1

      if (nextStepIndex < steps.length) {
        // Continue to next step (cleanup step)
        const nextStep = steps[nextStepIndex]

        // CRITICAL: Handle CLEANUP_COMMAND step directly instead of adding to queue
        // This prevents the action from being routed through executeAction which causes errors
        if (nextStep.action === 'GLOBAL_AUTO_APPLY' && nextStep.details?.customAction === 'CLEANUP_COMMAND') {
          // The cleanup will be handled by the normal App.tsx flow
          // App.tsx will automatically re-queue if abilityMode is still active
          const cleanupAction = {
            type: 'GLOBAL_AUTO_APPLY',
            payload: { cleanupCommand: true, ownerId },
            sourceCard: abilityAction.sourceCard,
            sourceCoords: abilityAction.sourceCoords,
          }
          setActionQueue([cleanupAction])
          // CRITICAL: Close the modal before returning
          setCounterSelectionData(null)
          return
        } else {
          // Add the next step to the action queue
          const newAction = {
            type: 'ENTER_MODE',
            mode: 'AUTO_STEPS',
            sourceCard: abilityAction.sourceCard,
            sourceCoords: abilityAction.sourceCoords,
            readyStatusToRemove: abilityAction.readyStatusToRemove,
            payload: {
              steps: steps,
              currentStepIndex: nextStepIndex,
              _autoStepsContext: {
                steps: steps,
                currentStepIndex: nextStepIndex,
                originalType: abilityAction.payload?.originalType,
                supportRequired: abilityAction.payload?.supportRequired,
                readyStatusToRemove: abilityAction.readyStatusToRemove,
                // CRITICAL: Include sourceCard and sourceCoords for CLEANUP_COMMAND step
                // This fixes Inspiration command not discarding after execution
                sourceCard: abilityAction.sourceCard,
                sourceCoords: abilityAction.sourceCoords,
              }
            }
          }
          setActionQueue([newAction])
        }
      } else {
        // Fallback: Add cleanup action if no cleanup step was found
        const cleanupAction = {
          type: 'GLOBAL_AUTO_APPLY',
          payload: { cleanupCommand: true, ownerId },
          sourceCard: abilityAction.sourceCard,
          sourceCoords: abilityAction.sourceCoords,
        }
        setActionQueue([cleanupAction])
      }
    }

    setCounterSelectionData(null)
  }, [localPlayerId, updatePlayerScore, setActionQueue, setCounterSelectionData, gameState, sendAction])

  const handleCounterSelectionCancel = useCallback((data: CounterSelectionData) => {
    // CRITICAL: Continue to AUTO_STEPS cleanup step even when user cancels
    // This ensures command cards like Inspiration are discarded to discard pile
    if (data.autoStepsContext) {
      const { steps, currentStepIndex, abilityAction } = data.autoStepsContext
      const nextStepIndex = currentStepIndex + 1

      if (nextStepIndex < steps.length) {
        const nextStep = steps[nextStepIndex]

        // CRITICAL: Handle CLEANUP_COMMAND step directly instead of adding to queue
        if (nextStep.action === 'GLOBAL_AUTO_APPLY' && nextStep.details?.customAction === 'CLEANUP_COMMAND') {
          const ownerId = data.card.ownerId || localPlayerId || 0
          const cleanupAction = {
            type: 'GLOBAL_AUTO_APPLY',
            payload: { cleanupCommand: true, ownerId },
            sourceCard: abilityAction.sourceCard,
            sourceCoords: abilityAction.sourceCoords,
          }
          setActionQueue([cleanupAction])
        }
      }
    }

    setCounterSelectionData(null)
  }, [localPlayerId, setActionQueue, setCounterSelectionData])

  return {
    playCommandCard,
    handleCommandConfirm,
    handleCounterSelectionConfirm,
    handleCounterSelectionCancel,
  }
}
