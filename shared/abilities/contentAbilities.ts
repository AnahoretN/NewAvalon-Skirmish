/**
 * Shared Ability Building Logic
 *
 * This module contains the logic for converting ContentAbility (from contentDatabase.json)
 * into CardAbilityDefinition format. It doesn't import from server or client,
 * making it safe to use in both environments.
 */

import { checkAdj } from './abilityUtils.js'
import { hasStatus } from './index.js'
import { READY_STATUS } from './readySystem.js'

// Use 'any' for Card type to avoid conflicts between client/server Card types
type Card = any
type GameState = any
type AbilityAction = any

/**
 * Supported event types for TRIGGER_ON_EVENT abilities
 */
export type TriggerEventType =
  | 'OPPONENT_PLAYS_REVEALED_CARD'
  | 'OPPONENT_PLAYS_CARD_WITH_STATUS'
  | 'CARD_ENTERS_BATTLEFIELD'
  | 'CARD_DESTROYED'

/**
 * Effect types for trigger responses
 */
export interface TriggerEffect {
  type: 'MODIFY_SCORE' | 'DRAW_CARD' | 'CREATE_TOKEN' | 'MODIFY_POWER'
  points?: number
  target?: 'self' | 'opponent' | 'all'
  tokenType?: string
  powerModifier?: number
}

/**
 * Raw ability structure from contentDatabase.json
 */
export interface ContentAbility {
  type: 'deploy' | 'setup' | 'commit' | 'pass' | 'command'
  supportRequired?: boolean
  action?: string
  mode?: string | null
  actionType?: string
  details?: Record<string, any>
  steps?: Array<{
    action: string
    mode?: string | null
    details: Record<string, any>
  }>
  // For command cards: option index (1-based)
  optionIndex?: number
  // For command cards: the text shown in the modal for this option
  optionText?: string
}

/**
 * Build a filter function from a filter string in contentDatabase.json
 */
/* eslint-disable no-unused-vars */
export function buildFilterFromString(
  filter: string | Function,
  ownerId: number,
  _coords: { row: number; col: number }
): ((_target: Card, _r?: number, _c?: number) => boolean) | undefined {
  /* eslint-enable no-unused-vars */
  // If filter is already a function, return it as-is
  if (typeof filter === 'function') {
    return filter as any
  }

  // If not a string, can't process
  if (typeof filter !== 'string') {
    return undefined
  }

  // hasStatus_StatusName1_or_StatusName2 (must check BEFORE single status)
  if (filter.startsWith('hasStatus_') && filter.includes('_or_')) {
    const statuses = filter.replace('hasStatus_', '').split('_or_')
    return (_target: Card) => statuses.some(s => hasStatus(_target, s, ownerId))
  }

  // hasStatus_StatusName
  if (filter.startsWith('hasStatus_')) {
    const statusType = filter.replace('hasStatus_', '')
    return (_target: Card) => hasStatus(_target, statusType, ownerId)
  }

  // hasToken_TokenName (alias for hasStatus_ - tokens are stored as statuses)
  if (filter.startsWith('hasToken_')) {
    const tokenType = filter.replace('hasToken_', '')
    return (_target: Card) => hasStatus(_target, tokenType, ownerId)
  }

  // hasCounter_CounterName (alias for hasStatus_ - counters are stored as statuses)
  if (filter.startsWith('hasCounter_')) {
    const counterType = filter.replace('hasCounter_', '')
    return (_target: Card) => hasStatus(_target, counterType, ownerId)
  }

  // hasCounterOwner_CounterName - checks if card has counter added by specific owner
  // Used by Code Keeper Commit to find cards with YOUR Exploit counters
  if (filter.startsWith('hasCounterOwner_')) {
    const counterType = filter.replace('hasCounterOwner_', '')
    return (_target: Card) => {
      if (!_target.statuses) return false
      return _target.statuses.some((s: any) => s.type === counterType && s.addedByPlayerId === ownerId)
    }
  }

  // isAdjacent
  if (filter === 'isAdjacent') {
    return (_target: Card, r?: number, c?: number) =>
      r !== undefined && c !== undefined && checkAdj(r, c, _coords.row, _coords.col)
  }

  // isAdjacentOpponent - adjacent AND opponent
  if (filter === 'isAdjacentOpponent') {
    return (_target: Card, r?: number, c?: number) => {
      const isAdj = r !== undefined && c !== undefined && checkAdj(r, c, _coords.row, _coords.col)
      const isOpponent = _target.ownerId !== ownerId
      return isAdj && isOpponent
    }
  }

  // isOpponent
  if (filter === 'isOpponent') {
    return (_target: Card) => _target.ownerId !== ownerId
  }

  // isOwner
  if (filter === 'isOwner') {
    return (_target: Card) => _target.ownerId === ownerId
  }

  // hasFaction_FactionName
  if (filter.startsWith('hasFaction_')) {
    const faction = filter.replace('hasFaction_', '')
    return (_target: Card) => _target.faction === faction
  }

  // hasType_TypeName
  if (filter.startsWith('hasType_')) {
    const typeName = filter.replace('hasType_', '')
    return (_target: Card) => _target.types?.includes(typeName) === true
  }

  // hasType_Type1_and_not_Type2 - composite filter
  if (filter.startsWith('hasType_') && filter.includes('_and_not_')) {
    const parts = filter.replace('hasType_', '').split('_and_not_')
    const hasType = parts[0]
    const notType = parts[1]
    return (_target: Card) =>
      _target.types?.includes(hasType) === true && !_target.types?.includes(notType)
  }

  return undefined
}

/**
 * Build details object from ContentAbility details
 */
export function buildDetailsFromContent(
  ability: ContentAbility,
  ownerId: number,
  coords: { row: number; col: number },
  _gameState?: GameState
): Record<string, any> {
  const details: Record<string, any> = { ...ability.details }

  // Convert filter string to function if present
  // eslint-disable-next-line no-unused-vars
  let mainFilter: ((card: Card, r?: number, c?: number) => boolean) | undefined = undefined
  if (details.filter && typeof details.filter === 'string') {
    const filterFn = buildFilterFromString(details.filter, ownerId, coords)
    if (filterFn) {
      mainFilter = filterFn
    }
  } else if (details.filter && typeof details.filter === 'function') {
    mainFilter = details.filter
  }

  // Convert additionalFilter string to function if present
  // eslint-disable-next-line no-unused-vars
  let additionalFilter: ((card: Card) => boolean) | undefined = undefined
  if (details.additionalFilter && typeof details.additionalFilter === 'string') {
    const filterFn = buildFilterFromString(details.additionalFilter, ownerId, coords)
    if (filterFn) {
      additionalFilter = filterFn
    }
  } else if (details.additionalFilter && typeof details.additionalFilter === 'function') {
    additionalFilter = details.additionalFilter
  }

  // Combine both filters into a single filter function
  if (mainFilter || additionalFilter) {
    if (mainFilter && additionalFilter) {
      // Both filters present - target must pass both checks
      details.filter = (card: Card, r?: number, c?: number) => {
        return mainFilter!(card, r, c) && additionalFilter!(card)
      }
    } else if (mainFilter) {
      details.filter = mainFilter
    } else if (additionalFilter) {
      details.filter = additionalFilter
    }
  }

  // Handle excludeSelf property - if true, wrap filter to exclude source card
  if (details.excludeSelf && details.filter && _gameState) {
    const originalFilter = details.filter
    const sourceCard = _gameState.board[coords.row]?.[coords.col]?.card
    details.filter = (card: Card, r?: number, c?: number) => {
      // Exclude the source card itself from valid targets
      if (sourceCard && card.id === sourceCard.id) {
        return false
      }
      return originalFilter(card, r, c)
    }
  }

  // Handle dynamicCount with ownerId: "source" - replace with actual ownerId
  if (details.dynamicCount && details.dynamicCount.ownerId === 'source') {
    details.dynamicCount = {
      ...details.dynamicCount,
      ownerId: ownerId
    }
  }

  // Handle dynamicResource with factor using "source" - replace with actual ownerId
  if (details.dynamicResource && details.dynamicResource.factor) {
    // For command cards, the factor references token type, and we need to ensure
    // the ownerId is properly set
    if (details.dynamicCount && details.dynamicCount.ownerId === 'source') {
      details.dynamicCount.ownerId = ownerId
    }
  }

  return details
}

/**
 * Build an AbilityAction from a ContentAbility
 */
export function buildActionFromContentAbility(
  ability: ContentAbility,
  card: Card,
  _gameState: GameState,
  ownerId: number,
  coords: { row: number; col: number }
): AbilityAction | null {
  // Handle multi-step abilities - use generic AUTO_STEPS system
  if (ability.steps && ability.steps.length > 0) {
    // NEW: Generic AUTO_STEPS system - processes steps dynamically from database
    // No more hardcoded pattern detection!

    // Determine which ready status to remove based on ability type
    let readyStatusToRemove: string | undefined
    let isDeployAbility = false
    if (ability.type === 'deploy') {
      readyStatusToRemove = READY_STATUS.DEPLOY
      isDeployAbility = true
    } else if (ability.type === 'setup') {
      readyStatusToRemove = READY_STATUS.SETUP
    } else if (ability.type === 'commit') {
      readyStatusToRemove = READY_STATUS.COMMIT
    } else if (ability.type === 'command') {
      // Command cards don't use ready statuses
      readyStatusToRemove = undefined
      isDeployAbility = false
    }

    // CRITICAL: For command cards, add a final cleanup step to discard the card
    // This ensures all command cards are discarded after their steps complete
    let stepsWithCleanup = ability.steps
    if (ability.type === 'command') {
      stepsWithCleanup = [
        ...ability.steps,
        {
          action: 'GLOBAL_AUTO_APPLY',
          mode: null,
          details: {
            customAction: 'CLEANUP_COMMAND',
            isFinalStep: true
          }
        }
      ]
    }

    const action: AbilityAction = {
      type: 'ENTER_MODE',
      mode: 'AUTO_STEPS',
      sourceCard: card,
      sourceCoords: coords,
      readyStatusToRemove,
      isDeployAbility,
      payload: {
        steps: stepsWithCleanup,
        currentStepIndex: 0,
        // Store original ability type for ready status tracking
        originalType: ability.type,
        // Copy supportRequired from ability level
        supportRequired: ability.supportRequired
      }
    } as AbilityAction

    // For command cards, add optionIndex and mark as command
    if (ability.type === 'command' && ability.optionIndex !== undefined) {
      ;(action.payload as any).optionIndex = ability.optionIndex
      ;(action.payload as any).isCommand = true
    }

    return action
  }

  // Handle single action abilities
  const actionType = ability.action
  const details = buildDetailsFromContent(ability, ownerId, coords, _gameState)

  // Build action based on type
  switch (actionType) {
    case 'CREATE_STACK': {
      // Convert mode to constraints
      // LINE_TARGET -> mustBeInLineWithSource
      // ADJACENT_TARGET -> mustBeAdjacentToSource
      let mustBeInLineWithSource = details.mustBeInLineWithSource
      let mustBeAdjacentToSource = details.mustBeAdjacentToSource

      if (ability.mode === 'LINE_TARGET') {
        mustBeInLineWithSource = true
      } else if (ability.mode === 'ADJACENT_TARGET') {
        mustBeAdjacentToSource = true
      }

      // CRITICAL: Convert "source" string to actual owner ID for targetOwnerId and excludeOwnerId
      // This fixes Temporary Shelter and other commands that use "source" placeholder
      const targetOwnerId = details.targetOwnerId === 'source' ? ownerId : details.targetOwnerId
      const excludeOwnerId = details.excludeOwnerId === 'source' ? ownerId : details.excludeOwnerId

      return {
        type: 'CREATE_STACK',
        tokenType: details.tokenType,
        count: details.count,
        requiredTargetStatus: details.requiredTargetStatus,
        requireStatusFromSourceOwner: details.requireStatusFromSourceOwner,
        onlyOpponents: details.onlyOpponents,
        mustBeAdjacentToSource,
        mustBeInLineWithSource,
        maxDistanceFromSource: details.maxDistanceFromSource,
        maxOrthogonalDistance: details.maxOrthogonalDistance,
        sourceCoords: coords,
        sourceCard: card,
        placeAllAtOnce: details.placeAllAtOnce,
        onlyFaceDown: details.onlyFaceDown,
        // CRITICAL: Include targetOwnerId and convert "source" to actual ID
        targetOwnerId,
        excludeOwnerId,
        targetType: details.targetType,
        // Pass through other properties needed for chained actions
        recordContext: details.recordContext,
        // CRITICAL: chainedAction is at ability level, not in details
        // Convert "action" to "type" and "details" to "payload" for compatibility
        chainedAction: (ability as any).chainedAction ? {
          ...(ability as any).chainedAction,
          type: (ability as any).chainedAction.action || (ability as any).chainedAction.type,
          payload: (ability as any).chainedAction.details || (ability as any).chainedAction.payload,
        } : undefined,
      } as AbilityAction
    }

    case 'CREATE_STACK_SELF':
      // CREATE_STACK_SELF is a special case - places tokens on self
      return {
        type: 'CREATE_STACK',
        tokenType: details.tokenType,
        count: details.count,
        onlySelf: true,
        sourceCoords: coords,
        sourceCard: card,
      } as AbilityAction

    case 'CREATE_STACK_MULTI': {
      // CREATE_STACK_MULTI places tokens on multiple cards matching a pattern
      // Modes: LINES_WITH_THREAT, LINES_WITH_SUPPORT
      const mode = ability.mode || 'SELECT_TARGET'

      // LINES_WITH_SUPPORT: Select a line, then place tokens on all Support cards in that line
      if (mode === 'LINES_WITH_SUPPORT') {
        return {
          type: 'ENTER_MODE',
          mode: 'SELECT_LINE_FOR_SUPPORT_COUNTERS',
          sourceCard: card,
          sourceCoords: coords,
          payload: {
            ...details,
            actionType: 'CREATE_STACK_MULTI'
          }
        } as AbilityAction
      }

      // LINES_WITH_THREAT: Select a line, then place tokens on all opponent Threat cards in that line
      if (mode === 'LINES_WITH_THREAT') {
        return {
          type: 'ENTER_MODE',
          mode: 'SELECT_LINE_FOR_THREAT_COUNTERS',
          sourceCard: card,
          sourceCoords: coords,
          payload: {
            ...details,
            actionType: 'CREATE_STACK_MULTI'
          }
        } as AbilityAction
      }

      return {
        type: 'ENTER_MODE',
        mode,
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...details,
          actionType: 'CREATE_STACK_MULTI'
        }
      } as AbilityAction
    }

    case 'SEARCH_DECK': {
      // SEARCH_DECK allows searching deck and selecting a card
      const processedDetails = buildDetailsFromContent(ability, ownerId, coords, _gameState)
      return {
        type: 'ENTER_MODE',
        mode: ability.mode || 'SEARCH_DECK',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...processedDetails,
          actionType: 'SEARCH_DECK'
        }
      } as AbilityAction
    }

    case 'CREATE_TOKEN': {
      // CREATE_TOKEN places a token unit on the board
      // Preserve ALL details including cost, filter, etc.
      // DISCARD_FROM_HAND cost is handled in abilityActivation.ts
      return {
        type: 'OPEN_MODAL',
        mode: 'PLACE_TOKEN',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...details,
          tokenId: details.tokenId,
          range: ability.mode === 'ADJACENT_EMPTY' ? 'adjacent' : 'global'
        }
      } as AbilityAction
    }

    case 'ENTER_MODE': {
      // Use buildDetailsFromContent to convert filter strings to functions
      const processedDetails = buildDetailsFromContent(ability, ownerId, coords, _gameState)

      // Start with processedDetails, then ensure all critical properties from original details are preserved
      const payload: Record<string, any> = { ...processedDetails }

      // Handle different action types
      if (ability.actionType === 'DESTROY' && !payload.filter) {
        // If no filter provided, use default
        payload.actionType = 'DESTROY'
      } else if (ability.actionType) {
        payload.actionType = ability.actionType
      }

      // Special case: TRANSFER_ALL_STATUSES (Reckless Provocateur Commit)
      // Automatically create filter if not provided
      if (ability.mode === 'TRANSFER_ALL_STATUSES' && !payload.filter) {
        const cardOwnerId = ownerId
        const sourceCardId = card.id
        const validTokens = ['Aim', 'Exploit', 'Rule', 'Shield', 'Stun', 'Revealed']
        payload.filter = (target: Card) => {
          // Cannot target itself
          if (target.id === sourceCardId) return false
          // Must be owned by the same player
          if (target.ownerId !== cardOwnerId) return false
          // Must have at least one of the specified tokens/statuses
          if (!target.statuses || target.statuses.length === 0) return false
          return target.statuses.some((s: any) => validTokens.includes(s.type))
        }
      }

      // Build the action with properties that should be at top level
      const action: AbilityAction = {
        type: 'ENTER_MODE',
        mode: ability.mode,
        sourceCard: card,
        sourceCoords: coords,
        payload
      } as AbilityAction

      // IMPORTANT: Preserve these properties from original ability.details at the TOP LEVEL
      // modeHandlers.ts expects abilityMode.chainedAction, not abilityMode.payload.chainedAction
      const originalDetails = ability.details || {}
      const topLevelProps = ['chainedAction', 'skipChainedActionOnNoTargets']
      for (const prop of topLevelProps) {
        if (originalDetails[prop] !== undefined) {
          (action as any)[prop] = originalDetails[prop]
        }
      }

      // Keep these in payload as they're accessed from there
      const payloadOnlyProps = ['targetOwnerId', 'onlyOpponents', 'onlyFaceDown']
      for (const prop of payloadOnlyProps) {
        if (originalDetails[prop] !== undefined && payload[prop] === undefined) {
          payload[prop] = originalDetails[prop]
        }
      }

      return action
    }

    case 'PUSH':
      // Push mode
      return {
        type: 'ENTER_MODE',
        mode: 'PUSH',
        sourceCard: card,
        sourceCoords: coords,
        payload: details
      } as AbilityAction

    case 'OPEN_MODAL':
      return {
        type: 'OPEN_MODAL',
        mode: ability.mode,
        sourceCard: card,
        sourceCoords: coords,
        payload: details
      } as AbilityAction

    case 'RETURN_FROM_DISCARD_TO_BOARD': {
      // Immunis Deploy: Return card from discard to adjacent empty cell on battlefield
      return {
        type: 'OPEN_MODAL',
        mode: 'RETURN_FROM_DISCARD_TO_BOARD',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...details,
          filter: details.filter || null,
          withToken: details.withToken || null,
        }
      } as AbilityAction
    }

    case 'RETURN_FROM_DISCARD_TO_HAND': {
      // Inventive Maker Setup: Return card from discard to owner's hand
      return {
        type: 'OPEN_MODAL',
        mode: 'RETURN_FROM_DISCARD_TO_HAND',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...details,
          filter: details.filter || null,
        }
      } as AbilityAction
    }

    case 'LOOK_AT_TOP_DECK':
      // Secret Informant - Look at top cards, put any on bottom, then draw
      return {
        type: 'ENTER_MODE',
        mode: 'SELECT_DECK',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...details,
          actionType: 'LOOK_AT_TOP_DECK'
        }
      } as AbilityAction

    case 'MOVE_CARD': {
      // Convert MOVE_CARD to SELECT_UNIT_FOR_MOVE mode (Finn Setup, Signal Prophet)
      // Uses range from details to determine movement distance
      const range = details.distance || 2
      const filterString = details.filter || 'isOwner'
      const filter = buildFilterFromString(filterString, ownerId, coords)
      const action = {
        type: 'ENTER_MODE',
        mode: 'SELECT_UNIT_FOR_MOVE',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          filter,
          filterString,  // Store string for serialization
          range,
          moveFromHand: false,
          selectedCard: null,
          allowSelf: false,
          onlyOpponents: details.onlyOpponents,
          onlyAllies: details.target === 'ally',  // Signal Prophet: only target allied cards
          excludeSelf: details.excludeSelf,
          requireTokenFromSourceOwner: details.requireTokenFromSourceOwner  // Signal Prophet: must have your Exploit counter
        }
      } as AbilityAction
      console.log('[buildActionFromContentAbility] MOVE_CARD for', card?.baseId || 'unknown', {
        ownerId,
        filterString,
        range,
        hasFilter: !!filter,
        typeofFilter: typeof filter,
        payloadFilterString: action.payload.filterString,
        target: details.target,
        onlyAllies: action.payload.onlyAllies
      })
      return action
    }

    case 'SCORE_POINTS': {
      // Convert SCORE_POINTS to GLOBAL_AUTO_APPLY with customAction
      // Used by Finn Commit (points per revealed card) and other abilities
      const { per } = details

      if (per === 'revealedToOwner') {
        // Finn Commit: Gain 1 point for each card revealed to you
        return {
          type: 'GLOBAL_AUTO_APPLY',
          payload: {
            customAction: 'FINN_SCORING'
          },
          sourceCard: card,
          sourceCoords: coords
        } as AbilityAction
      }

      if (per === 'exploitInLine') {
        // Select a line, gain 1 point for each of your Exploit counters in that line
        return {
          type: 'ENTER_MODE',
          mode: 'SELECT_LINE_FOR_EXPLOIT_SCORING',
          sourceCard: card,
          sourceCoords: coords,
          payload: {
            ...details,
            actionType: 'SCORE_POINTS'
          }
        } as AbilityAction
      }

      if (per === 'exploitOnBattlefield') {
        // Reverend of The Choir Setup: Gain 1 point for each of your Exploit counters on the battlefield
        return {
          type: 'REVEREND_SETUP_SCORE',
          sourceCard: card,
          sourceCoords: coords
        } as AbilityAction
      }

      // For other SCORE_POINTS variations, can add more cases here
      console.warn(`[buildActionFromContentAbility] SCORE_POINTS with per=${per} not yet implemented`)
      return null
    }

    case 'MODIFY_POWER': {
      // MODIFY_POWER changes power of target cards by amount
      // Used by Walking Turret Setup: Give -1 power to a card with an Aim token
      const processedDetails = buildDetailsFromContent(ability, ownerId, coords, _gameState)
      return {
        type: 'ENTER_MODE',
        mode: 'SELECT_TARGET',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...processedDetails,
          actionType: 'MODIFY_POWER'
        }
      } as AbilityAction
    }

    // SACRIFICE_FOR_BUFF has been moved to the steps system
    // See Centurion's commit ability in contentDatabase.json

    case 'REPLACE_COUNTER': {
      // Replace one type of counter with another on a selected card
      // Used by Censor Commit: Replace Exploit with Stun
      // actionType is CENSOR_SWAP to match the handler in modeHandlers.ts
      const fromToken = details.fromToken

      // Create a custom filter that finds cards with the counter that were added by this player
      // For Censor: replace YOUR Exploit counter means any Exploit on the board that you placed
      const filterFn = (_card: Card) => {
        if (!_card.statuses) return false
        // Check if card has the counter and it was added by the source card's owner
        return _card.statuses.some((s: any) =>
          s.type === fromToken && s.addedByPlayerId === ownerId
        )
      }

      return {
        type: 'ENTER_MODE',
        mode: 'SELECT_TARGET',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          actionType: 'CENSOR_SWAP',
          fromToken: details.fromToken,
          toToken: details.toToken,
          filter: filterFn, // Function for runtime checking
          filterString: `hasCounterOwner_${fromToken}`, // String for serialization (custom format)
          requireTokenFromSourceOwner: details.requireTokenFromSourceOwner
        }
      } as AbilityAction
    }

    case 'DOUBLE_TOKEN': {
      // DOUBLE_TOKEN doubles the number of tokens on a selected card
      // Used by Reverend of The Choir Deploy: Double Exploit tokens on any one card
      const processedDetails = buildDetailsFromContent(ability, ownerId, coords, _gameState)
      const tokenType = details.tokenType || 'Exploit'

      return {
        type: 'ENTER_MODE',
        mode: 'SELECT_TARGET',
        sourceCard: card,
        sourceCoords: coords,
        payload: {
          ...processedDetails,
          actionType: 'DOUBLE_TOKEN',
          tokenType,
          // Filter for cards that have at least one token from the source owner
          filter: (c: Card) => c.statuses?.some((s: any) =>
            s.type === tokenType && s.addedByPlayerId === ownerId
          ) || false,
          filterString: `hasCounterOwner_${tokenType}`
        }
      } as AbilityAction
    }

    case 'MODIFY_SCORING': {
      // MODIFY_SCORING creates a passive scoring modifier
      // Used by Data Liberator Pass: Cards with your Exploit tokens score points for you
      const { targetFilter, requireTokenFromSourceOwner, effect } = details

      // Convert filter string to function
      const filter = buildFilterFromString(
        targetFilter || '',
        ownerId,
        coords
      )

      return {
        type: 'GLOBAL_AUTO_APPLY',
        payload: {
          customAction: 'MODIFY_SCORING',
          targetFilter,
          requireTokenFromSourceOwner: requireTokenFromSourceOwner ?? false,
          effect,
          // Include the filter function for runtime use
          filterFn: filter
        },
        sourceCard: card,
        sourceCoords: coords
      } as AbilityAction
    }

    case 'BUFF_ALLY_POWER':
    case 'MODIFY_THREAT_TARGETING':
    case 'TRIGGER_ON_EVENT':
      // These are passive abilities - they don't create an action
      return null

    default:
      console.warn(`Unknown action type: ${actionType}`)
      return null
  }
}

/**
 * Get command options for a command card.
 * Returns array of { optionIndex, optionText } for display in modal.
 *
 * @param baseId - The baseId of the command card
 * @param getCardAbilitiesFn - Function to get abilities from content database
 * @returns Array of command options or empty array if not a command card
 */
export function getCommandOptions(
  baseId: string,
  getCardAbilitiesFn: (baseId: string) => ContentAbility[]
): Array<{ optionIndex: number; optionText: string }> {
  const abilities = getCardAbilitiesFn(baseId)
  const commandAbilities = abilities.filter(a => a.type === 'command' && a.optionIndex !== undefined && a.optionText)
  return commandAbilities
    .map(a => ({
      optionIndex: a.optionIndex!,
      optionText: a.optionText || ''
    }))
    .sort((a, b) => a.optionIndex - b.optionIndex)
}

/**
 * Check if a card is a command card (has command abilities).
 *
 * @param baseId - The baseId of the card
 * @param getCardAbilitiesFn - Function to get abilities from content database
 * @returns true if card has command abilities
 */
export function isCommandCard(
  baseId: string,
  getCardAbilitiesFn: (baseId: string) => ContentAbility[]
): boolean {
  const abilities = getCardAbilitiesFn(baseId)
  return abilities.some(a => a.type === 'command')
}

/**
 * Get command ability action by option index.
 *
 * @param baseId - The baseId of the command card
 * @param optionIndex - The selected option index (1-based)
 * @param card - The card object
 * @param gameState - Current game state
 * @param ownerId - The owner player ID
 * @param coords - Board coordinates (not used for commands from hand, use {-1, -1})
 * @param getCardAbilitiesFn - Function to get abilities from content database
 * @returns AbilityAction or null if not found
 */
export function getCommandActionByOption(
  baseId: string,
  optionIndex: number,
  card: Card,
  gameState: GameState,
  ownerId: number,
  coords: { row: number; col: number },
  getCardAbilitiesFn: (baseId: string) => ContentAbility[]
): AbilityAction | null {
  const abilities = getCardAbilitiesFn(baseId)
  const commandAbility = abilities.find(
    a => a.type === 'command' && a.optionIndex === optionIndex
  )

  if (!commandAbility) {
    console.warn(`[getCommandActionByOption] Command option ${optionIndex} not found for card ${baseId}`)
    return null
  }

  return buildActionFromContentAbility(commandAbility, card, gameState, ownerId, coords)
}
