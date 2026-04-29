/**
 * Ability Activation Handlers
 *
 * Handles activation of abilities from cards
 */

import type { Card, GameState, AbilityAction } from '@/types'
import { getCardAbilityAction, getAbilitiesForCard, canActivateAbility } from '@/utils/autoAbilities'
import { hasReadyAbilityInCurrentPhase } from '@/utils/autoAbilities'
import { hasStatus } from '@shared/abilities/readySystem'

export interface AbilityActivationProps {
  gameState: GameState
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  cursorStack: any
  handleActionExecution: (action: AbilityAction, sourceCoords: { row: number; col: number }) => void
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  addBoardCardStatus?: (coords: {row: number, col: number}, status: string, pid: number, count?: number) => void
  setAbilityMode?: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  addLogEntry?: (type: string, details: any, playerId?: number) => void
}

/**
 * Activate a card's ability
 * Returns the action that should be executed, or null if activation failed
 */
export function activateAbility(
  card: Card,
  boardCoords: { row: number; col: number },
  props: AbilityActivationProps
): AbilityAction | null {
  const {
    gameState,
    localPlayerId,
    abilityMode,
    cursorStack,
    handleActionExecution,
    markAbilityUsed,
    setAbilityMode,
  } = props

  if (abilityMode || cursorStack) {
    return null
  }
  if (!gameState.isGameStarted || localPlayerId === null) {
    return null
  }

  const owner = gameState.players.find(p => p.id === card.ownerId)
  // Any player can control dummy players' cards
  const canControl = localPlayerId === card.ownerId || owner?.isDummy

  // For dummy players, any player can activate abilities regardless of turn
  // For real players, only activate when it's their turn
  if (!owner?.isDummy && gameState.activePlayerId !== card.ownerId) {
    return null
  }
  if (!canControl) {
    return null
  }

  // Only activate if card has visual ready effect
  // This ensures abilities only activate when the player can see the visual indicator
  if (!hasReadyAbilityInCurrentPhase(card, gameState)) {
    return null
  }

  // Check if card can activate (includes Support requirement check)
  const canActivate = canActivateAbility(card as any, gameState.currentPhase, gameState.activePlayerId ?? undefined, gameState as any)
  if (!canActivate) {
    // Check if it's specifically because of missing Support
    // Need to check the ability for the CURRENT phase, not just deploy
    const abilities = getAbilitiesForCard(card as any)
    const phaseIndex = gameState.currentPhase

    // Determine which ability type to check based on phase
    let abilityToCheck: any
    if (phaseIndex === 1) {
      abilityToCheck = abilities?.find((a: any) => a.activationType === 'setup')
    } else if (phaseIndex === 3) {
      abilityToCheck = abilities?.find((a: any) => a.activationType === 'commit')
    }
    // If no phase-specific ability, check deploy
    if (!abilityToCheck) {
      abilityToCheck = abilities?.find((a: any) => a.activationType === 'deploy')
    }

    if (abilityToCheck?.supportRequired && !hasStatus(card, 'Support', card.ownerId!)) {
      // Show "No Target" effect to indicate missing Support
      const { triggerNoTarget } = props as any
      triggerNoTarget?.(boardCoords)
    }
    return null
  }

  const action = getCardAbilityAction(card as any, gameState as any, card.ownerId!, boardCoords)
  if (action) {
    // Log ability activation
    if (props.addLogEntry) {
      props.addLogEntry('ACTIVATE_ABILITY', {
        cardName: card.name,
        abilityText: action.mode || action.type || 'ability',
        targetLocation: action.payload?.targetLocation,
      }, card.ownerId!)
    }
    // Check for DISCARD_FROM_HAND cost (Faber, Lucius, etc.)
    if (action.payload?.cost?.type === 'DISCARD_FROM_HAND' && setAbilityMode) {
      // Determine the correct actionType based on the main ability action
      // - SEARCH_DECK (Lucius): LUCIUS_SETUP - discard any card then search deck
      // - CREATE_TOKEN (Faber): SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN - discard then place token
      const isSearchDeckAbility = action.mode === 'SEARCH_DECK' || action.payload?.actionType === 'SEARCH_DECK'

      const discardMode: AbilityAction = {
        type: 'ENTER_MODE',
        mode: 'SELECT_TARGET',
        sourceCard: card,
        sourceCoords: boardCoords,
        isDeployAbility: action.isDeployAbility,
        readyStatusToRemove: action.readyStatusToRemove,
        payload: {
          actionType: isSearchDeckAbility ? 'LUCIUS_SETUP' : 'SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN',
          tokenId: action.payload.tokenId,
          range: action.payload.range || 'adjacent',
          // Only apply filter to discard for non-SEARCH_DECK abilities
          // For Lucius (SEARCH_DECK), discard ANY card, filter applies to search only
          filter: isSearchDeckAbility ? undefined : (action.payload.filter || ((targetCard: Card) => targetCard.ownerId === card.ownerId))
        }
      }

      // Remove ready status (but not for AUTO_STEPS - they handle it themselves)
      if (action.readyStatusToRemove && action.mode !== 'AUTO_STEPS') {
        markAbilityUsed(boardCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
      }
      // Execute the action via handleActionExecution - this will call handleEnterMode
      // which will set targeting mode with hand targets
      handleActionExecution(discardMode, boardCoords)
      return discardMode
    }

    // NEW FLOW: Remove ready status FIRST, then execute
    // This ensures the visual highlight disappears immediately on click
    // EXCEPT for AUTO_STEPS - they will mark ability used when all steps complete
    // EXCEPT for PUSH and CREATE_STACK with requiredTargetStatus - they validate targets at execution time and remove ready status there
    const shouldSkipReadyRemoval = action.mode === 'AUTO_STEPS' ||
                                   action.mode === 'PUSH' ||
                                   (action.type === 'CREATE_STACK' && action.requiredTargetStatus)

    if (action.readyStatusToRemove && !shouldSkipReadyRemoval) {
      markAbilityUsed(boardCoords, !!action.isDeployAbility, false, action.readyStatusToRemove)
    }

    // Execute the action WITHOUT modifying chainedAction type
    // The ABILITY_COMPLETE replacement was breaking REVEAL_ENEMY_CHAINED and other chained actions
    // Readiness recheck is now handled by individual handlers
    handleActionExecution(action, boardCoords)
    return action
  }

  return null
}
