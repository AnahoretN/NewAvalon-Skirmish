/**
 * @file Targeting utilities for game actions
 * Shared between client and server (no Node.js/browser dependencies)
 */

import type { GameState, Card, CommandContext, AbilityAction } from '../../client/types.js'
import { checkAdj } from '../abilities/abilityUtils.js'
import { hasStatus } from '../abilities/index.js'

/**
 * Get token targeting rules from countersDatabase
 * Client-side version for targeting validation
 * NOTE: This is a simplified version - full version is in client/utils/tokenTargeting.ts
 */
function getTokenTargetingRules(tokenType: string): { allowBoard: boolean; allowBoardFaceDown: boolean; allowHand: boolean } {
  // Import countersDatabase dynamically to avoid circular dependency
  // For shared targeting utilities, we need to check against allowedTargets
  // Default: tokens can target board cards
  const defaults = { allowBoard: true, allowBoardFaceDown: false, allowHand: false }

  // Revealed token special case: can target hand and board-facedown only
  if (tokenType === 'Revealed') {
    return { allowBoard: false, allowBoardFaceDown: true, allowHand: true }
  }

  return defaults
}

// Constants for target validation
const TARGET_OPPONENTS = -1
const TARGET_MOVED_OWNER = -2
const ADJACENT_DISTANCE = 1
const RANGE_TWO_DISTANCE = 2

/**
 * Check if a card is Lucius, The Immortal
 * Lucius has pass abilities: Immunity to Stun, +2 power if exited from Discard
 */
function isLucius(card: Card): boolean {
  if (!card.baseId) {return false}
  const baseId = card.baseId.toLowerCase()
  return baseId === 'luciustheimmortal' || baseId.includes('lucius')
}

/**
 * Validates if a specific target meets constraints.
 */
export const validateTarget = (
  target: { card: Card; ownerId: number; location: 'hand' | 'board'; boardCoords?: { row: number, col: number } },
  constraints: {
        targetOwnerId?: number | 'source';
        excludeOwnerId?: number | 'source';
        onlyOpponents?: boolean;
        onlyFaceDown?: boolean;
        targetType?: string;
        requiredTargetStatus?: string;
        requireStatusFromSourceOwner?: boolean;
        mustBeAdjacentToSource?: boolean;
        mustBeInLineWithSource?: boolean;
        maxDistanceFromSource?: number; // Maximum Chebyshev distance (King's move) from source
        maxOrthogonalDistance?: number; // Maximum Manhattan/orthogonal distance from source (walking distance)
        sourceCoords?: { row: number, col: number };
        tokenType?: string; // Passed to check for uniqueness
    },
  userPlayerId: number | null,
  players: GameState['players'],
  tokenOwnerId?: number, // CRITICAL: For command cards, the token owner might differ from userPlayerId
): boolean => {
  const { card, ownerId, location } = target

  // 1. Target Owner (Inclusive)
  // CRITICAL: Use != null to check for both undefined AND null
  // If targetOwnerId is not set (undefined/null), skip this check
  // NOTE: "source" should be resolved before calling validateTarget, but if present, skip the check
  if (constraints.targetOwnerId != null && constraints.targetOwnerId !== 'source' && constraints.targetOwnerId !== TARGET_OPPONENTS && constraints.targetOwnerId !== TARGET_MOVED_OWNER && constraints.targetOwnerId !== ownerId) {
    return false
  }

  // 2. Excluded Owner (Exclusive)
  // NOTE: "source" should be resolved before calling validateTarget, but if present, skip the check
  if (constraints.excludeOwnerId != null && constraints.excludeOwnerId !== 'source' && constraints.excludeOwnerId === ownerId) {
    return false
  }

  // 3. Only Opponents
  // TARGET_OPPONENTS in targetOwnerId also implies Only Opponents
  if (constraints.onlyOpponents || constraints.targetOwnerId === TARGET_OPPONENTS) {
    // CRITICAL: Use tokenOwnerId if available (for command cards), otherwise use userPlayerId
    // This fixes False Orders where Host (player 1) activates Dummy's (player 2) command
    const effectiveOwnerId = tokenOwnerId !== undefined ? tokenOwnerId : userPlayerId

    // Cannot be self (token owner's own cards)
    if (ownerId === effectiveOwnerId) {
      return false
    }

    // Cannot be teammate
    const tokenOwner = players.find(p => p.id === effectiveOwnerId)
    const targetPlayer = players.find(p => p.id === ownerId)
    // CRITICAL: Use != null to check for both undefined AND null
    // If teamId is not set (undefined/null), player is in FFA mode - no teammates
    if (tokenOwner && targetPlayer && tokenOwner.teamId != null && tokenOwner.teamId === targetPlayer.teamId) {
      return false
    }
  }

  // 4. Target Type
  if (constraints.targetType) {
    if (!card.types?.includes(constraints.targetType)) {
      return false
    }
  }

  // 5. Only Face Down (Strict Interpretation of user rules)
  if (constraints.onlyFaceDown) {
    // Rule 1: No 'Revealed' Token allowed FROM THIS PLAYER (Universal)
    if (card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === userPlayerId)) {
      return false
    }

    // Rule 2: If on board, must be physically face down OR revealed only to others
    if (location === 'board') {
      // CRITICAL: Check for explicit face-down, not falsy value
      // undefined means card was placed normally (face-up), not face-down
      if (card.isFaceDown !== true) {
        return false
      }
    }
  }

  // 5.1 Unique Token Check (If adding 'Revealed', target must not already have 'Revealed' from this player)
  if (constraints.tokenType === 'Revealed') {
    if (card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === userPlayerId)) {
      return false
    }
  }

  // 5.2 LUCIUS PASSIVE: Immunity to Stun - Lucius cannot receive Stun tokens
  if (constraints.tokenType === 'Stun' && isLucius(card)) {
    return false
  }

  // 6. Required Status
  if (constraints.requiredTargetStatus) {
    if (!card.statuses?.some(s => s.type === constraints.requiredTargetStatus)) {
      return false
    }

    // 6.1 Check if specific status was added by source owner (Actor)
    if (constraints.requireStatusFromSourceOwner && userPlayerId !== null) {
      const hasStatusFromActor = card.statuses?.some(s => s.type === constraints.requiredTargetStatus && s.addedByPlayerId === userPlayerId)
      if (!hasStatusFromActor) {
        return false
      }
    }
  }

  // 7. Adjacency
  if (constraints.mustBeAdjacentToSource && constraints.sourceCoords && target.boardCoords) {
    const { row: r1, col: c1 } = constraints.sourceCoords
    const { row: r2, col: c2 } = target.boardCoords
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== ADJACENT_DISTANCE) {
      return false
    }
  }

  // 8. Line Check
  if (constraints.mustBeInLineWithSource && constraints.sourceCoords && target.boardCoords) {
    const { row: r1, col: c1 } = constraints.sourceCoords
    const { row: r2, col: c2 } = target.boardCoords
    if (r1 !== r2 && c1 !== c2) {
      return false
    }
  }

  // 9. Max Distance Check (Chebyshev distance - max of row/col difference)
  if (constraints.maxDistanceFromSource != null && constraints.sourceCoords && target.boardCoords) {
    const { row: r1, col: c1 } = constraints.sourceCoords
    const { row: r2, col: c2 } = target.boardCoords
    const distance = Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2))
    if (distance > constraints.maxDistanceFromSource) {
      return false
    }
  }

  // 10. Max Orthogonal Distance Check (Manhattan distance - row diff + col diff, for orthogonal movement)
  if (constraints.maxOrthogonalDistance != null && constraints.sourceCoords && target.boardCoords) {
    const { row: r1, col: c1 } = constraints.sourceCoords
    const { row: r2, col: c2 } = target.boardCoords
    const distance = Math.abs(r1 - r2) + Math.abs(c1 - c2)
    if (distance > constraints.maxOrthogonalDistance) {
      return false
    }
  }

  return true
}

/**
 * Build a filter function from a filter string
 * Local copy to avoid circular dependency with contentAbilities
 */
function buildFilterFromString(
  filter: string,
  ownerId: number,
  _coords: { row: number; col: number }
// eslint-disable-next-line no-unused-vars
): ((card: Card, r?: number, c?: number) => boolean) | undefined {
  // hasStatus_StatusName1_or_StatusName2 (must check BEFORE single status)
  if (filter.startsWith('hasStatus_') && filter.includes('_or_')) {
    const statuses = filter.replace('hasStatus_', '').split('_or_')
    return (card: Card) => statuses.some(s => hasStatus(card, s, ownerId))
  }

  // hasStatus_StatusName
  if (filter.startsWith('hasStatus_')) {
    const statusType = filter.replace('hasStatus_', '')
    return (card: Card) => hasStatus(card, statusType, ownerId)
  }

  // hasToken_TokenName (alias for hasStatus_ - tokens are stored as statuses)
  if (filter.startsWith('hasToken_')) {
    const tokenType = filter.replace('hasToken_', '')
    return (card: Card) => hasStatus(card, tokenType, ownerId)
  }

  // hasTokenOwner_TokenName - checks if card has token added by specific owner
  if (filter.startsWith('hasTokenOwner_')) {
    const tokenType = filter.replace('hasTokenOwner_', '')
    return (card: Card) => {
      if (!card.statuses) return false
      return card.statuses.some((s: any) => s.type === tokenType && s.addedByPlayerId === ownerId)
    }
  }

  // hasCounter_CounterName - counters (Aim, Exploit, Stun, Shield) - alias for hasStatus_
  if (filter.startsWith('hasCounter_')) {
    const counterType = filter.replace('hasCounter_', '')
    return (card: Card) => hasStatus(card, counterType, ownerId)
  }

  // hasCounterOwner_CounterName - checks if card has counter added by specific owner
  // Used by Censor Commit to find cards with YOUR Exploit counters
  if (filter.startsWith('hasCounterOwner_')) {
    const counterType = filter.replace('hasCounterOwner_', '')
    return (card: Card) => {
      if (!card.statuses) return false
      return card.statuses.some((s: any) => s.type === counterType && s.addedByPlayerId === ownerId)
    }
  }

  // isAdjacent
  if (filter === 'isAdjacent') {
    return (_card: Card, r?: number, c?: number) =>
      r != null && c != null && checkAdj(r, c, _coords.row, _coords.col)
  }

  // isOpponent
  if (filter === 'isOpponent') {
    return (card: Card) => card.ownerId !== ownerId
  }

  // isOwner / isAlly (both check if card belongs to owner)
  if (filter === 'isOwner' || filter === 'isAlly') {
    return (card: Card) => card.ownerId === ownerId
  }

  // hasFaction_FactionName
  if (filter.startsWith('hasFaction_')) {
    const faction = filter.replace('hasFaction_', '')
    return (card: Card) => card.faction === faction
  }

  // hasType_Unit_and_not_Device (Experimental Stimulants - special compound filter)
  if (filter === 'hasType_Unit_and_not_Device') {
    return (card: Card) => card.types?.includes('Unit') === true && card.types?.includes('Device') !== true
  }

  // hasType_TypeName
  if (filter.startsWith('hasType_')) {
    const typeName = filter.replace('hasType_', '')
    return (card: Card) => card.types?.includes(typeName) === true
  }

  return undefined
}

/**
 * Helper to calculate valid targets for an ability action on board.
 * Optimized to iterate only over active grid bounds.
 */
export const calculateValidTargets = (
  action: AbilityAction | null,
  currentGameState: GameState,
  actorId: number | null, // Renamed from playerId to clarify intent (source card owner)
  commandContext?: CommandContext,
): {row: number, col: number}[] => {
  if (!action || (action.type !== 'ENTER_MODE' && action.type !== 'CREATE_STACK' && action.type !== 'OPEN_MODAL')) {
    return []
  }

  // CRITICAL: Resolve "source" string to actual owner ID for targeting properties
  // This fixes Enhanced Interrogation and other commands where "source" placeholder is used
  const sourceOwnerId = action.sourceCard?.ownerId ?? commandContext?.sourceOwnerId ?? actorId ?? 0
  if (action.targetOwnerId === 'source') {
    (action as AbilityAction).targetOwnerId = sourceOwnerId
  }
  if (action.excludeOwnerId === 'source') {
    (action as AbilityAction).excludeOwnerId = sourceOwnerId
  }

  // CRITICAL: Handle AUTO_STEPS by extracting the current step
  // AUTO_STEPS is a container for multi-step abilities - we need to calculate targets
  // based on the CURRENT step being processed, not the AUTO_STEPS mode itself
  if (action.type === 'ENTER_MODE' && action.mode === 'AUTO_STEPS' && action.payload?.steps) {
    const steps = action.payload.steps
    const currentStepIndex = action.payload.currentStepIndex || 0
    const currentStep = steps[currentStepIndex]

    if (!currentStep) {
      return []
    }

    // If current step has no mode (instant), return empty - no targeting needed
    if (!currentStep.mode) {
      return []
    }

    // CRITICAL: Normalize LINE_TARGET and ADJACENT_TARGET to SELECT_TARGET
    // These are targeting constraints, not separate modes. The constraint is stored in payload.
    const normalizedMode = (currentStep.mode === "LINE_TARGET" || currentStep.mode === "ADJACENT_TARGET")
      ? "SELECT_TARGET"
      : currentStep.mode

    // Create a synthetic action for the current step with normalized mode
    // CRITICAL: Preserve action-level properties like readyStatusToRemove and isDeployAbility
    const stepAction: AbilityAction = {
      type: 'ENTER_MODE',
      mode: normalizedMode,
      sourceCard: action.sourceCard,
      sourceCoords: action.sourceCoords,
      readyStatusToRemove: action.readyStatusToRemove,
      isDeployAbility: action.isDeployAbility,
      payload: {
        ...currentStep.details,
        _autoStepsContext: {
          steps: steps,
          currentStepIndex: currentStepIndex + 1,
          originalType: action.payload?.originalType,
          supportRequired: action.payload?.supportRequired,
          readyStatusToRemove: action.readyStatusToRemove
        }
      }
    }

    // Handle LINE_TARGET and ADJACENT_TARGET special modes - add targeting constraints to payload
    if (currentStep.action === 'CREATE_STACK' && currentStep.mode) {
      const details = currentStep.details || {}
      if (currentStep.mode === 'LINE_TARGET') {
        stepAction.payload.mustBeInLineWithSource = true
      } else if (currentStep.mode === 'ADJACENT_TARGET') {
        stepAction.payload.mustBeAdjacentToSource = true
      }
      stepAction.payload.tokenType = details.tokenType
      stepAction.payload.count = details.count || 1
    }

    // Recursively call calculateValidTargets with the step action
    return calculateValidTargets(stepAction, currentGameState, actorId, commandContext)
  }

  const targets: {row: number, col: number}[] = []
  const board = currentGameState.board
  const gridSize = board.length

  // Calculate visible boundaries - iterate ONLY over active grid area
  const activeSize = currentGameState.activeGridSize
  const offset = Math.floor((gridSize - activeSize) / 2)
  const minBound = offset
  const maxBound = offset + activeSize - 1

  // If action is CREATE_STACK, iterate only active grid area
  if (action.type === 'CREATE_STACK') {
    // CRITICAL: If targetLocation is 'hand', don't return board targets
    // Hand targets are calculated separately in actionExecutionHandler.ts
    if (action.targetLocation === 'hand') {
      return []
    }

    const constraints = {
      targetOwnerId: action.targetOwnerId,
      excludeOwnerId: action.excludeOwnerId,
      onlyOpponents: action.onlyOpponents,
      onlyFaceDown: action.onlyFaceDown,
      targetType: action.targetType,
      requiredTargetStatus: action.requiredTargetStatus,
      requireStatusFromSourceOwner: action.requireStatusFromSourceOwner,
      mustBeAdjacentToSource: action.mustBeAdjacentToSource,
      mustBeInLineWithSource: action.mustBeInLineWithSource,
      maxDistanceFromSource: action.maxDistanceFromSource,
      maxOrthogonalDistance: action.maxOrthogonalDistance,
      sourceCoords: action.sourceCoords,
      tokenType: action.tokenType,
    }

    // Collect dummy player IDs for Revealed token exclusion
    const dummyPlayerIds = new Set<number>()
    if (action.tokenType === 'Revealed') {
      currentGameState.players.forEach(p => {
        if (p.isDummy) {
          dummyPlayerIds.add(p.id)
        }
      })
    }

    // Iterate ONLY over active grid bounds (not entire 7x7 board)
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card && cell.card.ownerId !== undefined) { // Tokens generally apply to existing cards
          // Exclude dummy player cards for Revealed tokens
          if (dummyPlayerIds.has(cell.card.ownerId)) {
            continue
          }

          // CRITICAL: Check allowedTargets for token types from countersDatabase
          // Some tokens (like Revealed) can only target specific card states
          if (action.tokenType) {
            const tokenRules = getTokenTargetingRules(action.tokenType)

            // If token cannot target board at all (hand-only tokens), skip
            if (!tokenRules.allowBoard && !tokenRules.allowBoardFaceDown) {
              continue
            }

            // If token can only target board-facedown cards (not regular board), check face-down status
            if (tokenRules.allowBoardFaceDown && !tokenRules.allowBoard) {
              if (cell.card.isFaceDown !== true) {
                continue // Skip face-up cards - token only targets face-down cards
              }
            }
          }

          const isValid = validateTarget(
            { card: cell.card, ownerId: cell.card.ownerId || 0, location: 'board', boardCoords: { row: r, col: c } },
            constraints,
            actorId,
            currentGameState.players,
            action.sourceCard?.ownerId, // CRITICAL: Pass token owner ID for proper uniqueness check (e.g., Revealed)
          )
          if (isValid) {
            targets.push({ row: r, col: c })
          }
        }
      }
    }

    return targets
  }

  // OPEN_MODAL with PLACE_TOKEN mode - token placement on empty cells
  if (action.type === 'OPEN_MODAL' && action.mode === 'PLACE_TOKEN' && action.sourceCoords) {
    const { sourceCoords, payload } = action
    const range = payload?.range || 'global'

    if (range === 'adjacent') {
      // ADJACENT_EMPTY mode - only adjacent empty cells
      const neighbors = [
        { r: sourceCoords.row - 1, c: sourceCoords.col },
        { r: sourceCoords.row + 1, c: sourceCoords.col },
        { r: sourceCoords.row, c: sourceCoords.col - 1 },
        { r: sourceCoords.row, c: sourceCoords.col + 1 },
      ]

      neighbors.forEach(nb => {
        if (nb.r >= minBound && nb.r <= maxBound && nb.c >= minBound && nb.c <= maxBound) {
          const cell = board[nb.r][nb.c]
          if (!cell.card) {
            targets.push({ row: nb.r, col: nb.c })
          }
        }
      })
    } else {
      // Global range - all empty cells in active grid
      for (let r = minBound; r <= maxBound; r++) {
        for (let c = minBound; c <= maxBound; c++) {
          const cell = board[r][c]
          if (!cell.card) {
            targets.push({ row: r, col: c })
          }
        }
      }
    }
    return targets
  }

  const { mode, payload, sourceCoords: actionSourceCoords, contextCheck } = action

  // For PUSH mode, always find the CURRENT board position of sourceCard
  // This fixes the issue where sourceCoords are cached and not updated when other cards move
  let sourceCoords = actionSourceCoords
  if (mode === 'PUSH' && action.sourceCard) {
    console.log('[calculateValidTargets PUSH] TIMESTAMP:', Date.now())
    // Search the board for the current position of source card
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (board[r][c].card?.id === action.sourceCard.id) {
          sourceCoords = { row: r, col: c }
          console.log('[calculateValidTargets PUSH] Found current sourceCard position:', { row: r, col: c }, 'old position:', actionSourceCoords)
          break
        }
      }
      if (sourceCoords && actionSourceCoords && (sourceCoords.row !== actionSourceCoords.row || sourceCoords.col !== actionSourceCoords.col)) break
    }
  }

  // Special case: MOVE_SELF_ANY_EMPTY (Recon Drone Setup)
  // Handle early to avoid falling through to SELECT_TARGET
  if (mode === 'MOVE_SELF_ANY_EMPTY' && sourceCoords) {
    // Any empty cell in active grid is valid
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        if (!board[r][c].card) {
          targets.push({ row: r, col: c })
        }
      }
    }
    return targets
  }

  // Special case: RECON_DRONE_COMMIT (2-step ability - step 1: select adjacent opponent)
  // Handle early to use proper filter
  if (mode === 'RECON_DRONE_COMMIT' && sourceCoords) {
    const ownerId = action.sourceCard?.ownerId || actorId
    const neighbors = [
      { r: sourceCoords.row - 1, c: sourceCoords.col },
      { r: sourceCoords.row + 1, c: sourceCoords.col },
      { r: sourceCoords.row, c: sourceCoords.col - 1 },
      { r: sourceCoords.row, c: sourceCoords.col + 1 },
    ]

    for (const nb of neighbors) {
      if (nb.r >= minBound && nb.r <= maxBound && nb.c >= minBound && nb.c <= maxBound) {
        const cell = board[nb.r][nb.c]
        if (cell.card && cell.card.ownerId !== ownerId) {
          const targetOwnerId = cell.card.ownerId
          // Check if target is opponent (not teammate)
          const actorPlayer = currentGameState.players.find(p => p.id === ownerId)
          const targetPlayer = currentGameState.players.find(p => p.id === targetOwnerId)
          // CRITICAL: Use != null to check for both undefined AND null
          // If teamId is not set (undefined/null), player is in FFA mode - no teammates
          const isTeammate = actorPlayer?.teamId != null && targetPlayer?.teamId != null &&
                            actorPlayer.teamId === targetPlayer.teamId

          if (!isTeammate) {
            targets.push({ row: nb.r, col: nb.c })
          }
        }
      }
    }
    return targets
  }

  // Special case: TRANSFER_ALL_STATUSES (Reckless Provocateur Commit)
  // Can select any allied card (except self) that has transferable counters
  if (mode === 'TRANSFER_ALL_STATUSES' && sourceCoords) {
    const ownerId = action.sourceCard?.ownerId || actorId
    const transferableTypes = ['Aim', 'Shield', 'Exploit', 'Stun', 'Revealed', 'Rule']

    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        // Skip source card
        if (r === sourceCoords.row && c === sourceCoords.col) {
          continue
        }

        const cell = board[r][c]
        if (cell.card && cell.card.ownerId === ownerId) {
          // Check if card has any transferable statuses
          const hasTransferableStatus = cell.card.statuses?.some((s: any) => transferableTypes.includes(s.type))
          if (hasTransferableStatus) {
            targets.push({ row: r, col: c })
          }
        }
      }
    }
    return targets
  }

  // Special case: REVEREND_DOUBLE_EXPLOIT - can target ANY card on battlefield
  if (mode === 'REVEREND_DOUBLE_EXPLOIT') {
    // Iterate ONLY over active grid bounds - all cards with any unit are valid targets
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card) {
          targets.push({ row: r, col: c })
        }
      }
    }
    return targets
  }

  // SELECT_TARGET with tokenType (CREATE_STACK for tokens like Aim, Shield, etc.)
  // Used by Princeps/ABR Gawain Deploy: "Place an Aim token on a card in its line"
  // Also used by Cautious Avenger Deploy: "Place an Aim counter on a card within 2 cells"
  if (mode === 'SELECT_TARGET' && payload.tokenType && !(payload.filter || payload.filterString)) {
    const ownerId = action.sourceCard?.ownerId || actorId || 0

    // Iterate over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        // Skip source card (can't place token on self)
        if (sourceCoords && r === sourceCoords.row && c === sourceCoords.col) {
          continue
        }

        const cell = board[r][c]
        if (cell.card) {
          // Check constraints - include maxOrthogonalDistance and maxDistanceFromSource
          const isValid = validateTarget(
            { card: cell.card, ownerId: cell.card.ownerId || 0, location: 'board', boardCoords: { row: r, col: c } },
            {
              targetOwnerId: action.targetOwnerId,
              excludeOwnerId: action.excludeOwnerId,
              mustBeInLineWithSource: payload.mustBeInLineWithSource,
              mustBeAdjacentToSource: payload.mustBeAdjacentToSource,
              maxDistanceFromSource: payload.maxDistanceFromSource,
              maxOrthogonalDistance: payload.maxOrthogonalDistance,
              sourceCoords: sourceCoords,
            },
            ownerId,
            currentGameState.players,
          )
          if (isValid) {
            targets.push({ row: r, col: c })
          }
        }
      }
    }
    return targets
  }

  // 1. Generic TARGET selection
  if ((mode === 'SELECT_TARGET' || mode === 'CENSOR_SWAP' || mode === 'ZEALOUS_WEAKEN' || mode === 'CENTURION_BUFF' || mode === 'SELECT_UNIT_FOR_MOVE') && (payload.filter || payload.filterString)) {

    // Build filter function if not present (for serialization support)
    let filterFn = payload.filter
    console.log('[calculateValidTargets] SELECT_TARGET with filter:', { mode, actionType: payload.actionType, hasFilterFn: !!filterFn, hasFilterString: !!payload.filterString, filterString: payload.filterString, typeofFilterFn: typeof filterFn, sourceCard: action.sourceCard?.baseId })

    // CRITICAL: Convert filter string to function if needed
    // JSON stores filter as string, need to convert to function
    if (typeof filterFn !== 'function' && payload.filterString) {
      const ownerId = action.sourceCard?.ownerId || 0
      filterFn = buildFilterFromString(payload.filterString, ownerId, sourceCoords || action.sourceCoords || { row: 0, col: 0 })
      console.log('[calculateValidTargets] Built filter from filterString:', { filterString: payload.filterString, ownerId, hasFilterFn: !!filterFn, typeofFilterFn: typeof filterFn })
    }
    // Also handle case where filter is a string (not a function) - convert it
    else if (typeof filterFn !== 'function' && typeof filterFn === 'string') {
      const ownerId = action.sourceCard?.ownerId || 0
      filterFn = buildFilterFromString(filterFn, ownerId, sourceCoords || action.sourceCoords || { row: 0, col: 0 })
      console.log('[calculateValidTargets] Built filter from string:', { filterString: filterFn, ownerId, hasFilterFn: !!filterFn, typeofFilterFn: typeof filterFn })
    }

    if (!filterFn || typeof filterFn !== 'function') {
      console.log('[calculateValidTargets] No valid filter function:', { hasFilterFn: !!filterFn, typeofFilterFn: typeof filterFn, mode })
      return []
    }

    // Strict Hand-Only actions check - return empty for board targets
    if (payload.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN' ||
             payload.actionType === 'SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN' ||
             payload.actionType === 'LUCIUS_SETUP' ||
             payload.actionType === 'SELECT_HAND_FOR_DEPLOY' ||
             payload.handOnly) {
      return []
    }

    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]

        // Check basic filter
        let isValid = cell.card && filterFn(cell.card, r, c)

        if (cell.card && mode === 'SELECT_UNIT_FOR_MOVE') {
          console.log('[calculateValidTargets] Filter check:', {
            r, c,
            cardId: cell.card.baseId,
            cardOwnerId: cell.card.ownerId,
            actorId,
            isValid,
            filterString: typeof payload.filterString === 'function' ? '(function)' : payload.filterString,
            statuses: cell.card.statuses?.map(s => `${s.type}[${s.addedByPlayerId}]`).join(', ') || 'none'
          })
        }

        // CRITICAL: Do NOT check excludeSelf here! The excludeSelf logic is handled
        // within the onlyAllies/onlyOpponents checks below, which need to know about
        // the source card to make FFA vs team mode decisions.

        // Check onlyOpponents constraint for SELECT_UNIT_FOR_MOVE
        if (isValid && payload.onlyOpponents && cell.card) {
          const cardOwnerId = cell.card.ownerId
          // Cannot be self
          if (cardOwnerId === actorId) {
            isValid = false
          } else {
            // Check if target is opponent (not teammate)
            const actorPlayer = currentGameState.players.find(p => p.id === actorId)
            const targetPlayer = currentGameState.players.find(p => p.id === cardOwnerId)
            const isTeammate = actorPlayer?.teamId !== undefined && targetPlayer?.teamId !== undefined &&
                              actorPlayer.teamId === targetPlayer.teamId
            if (isTeammate) {
              isValid = false
            }
          }
        }

        // Check onlyAllies constraint for SELECT_UNIT_FOR_MOVE (Signal Prophet)
        if (isValid && payload.onlyAllies && cell.card) {
          const cardOwnerId = cell.card.ownerId
          const actorPlayer = currentGameState.players.find(p => p.id === actorId)
          const targetPlayer = currentGameState.players.find(p => p.id === cardOwnerId)

          // Must be self OR teammate
          // CRITICAL: Use != null to check for both undefined AND null
          // If teamId is not set (undefined/null), player is in FFA mode - only self is ally
          const isSelf = cardOwnerId === actorId
          const isTeammate = actorPlayer?.teamId != null && targetPlayer?.teamId != null &&
                            actorPlayer.teamId === targetPlayer.teamId

          // Check if in FFA mode (no team assignments)
          const isFFAMode = actorPlayer?.teamId == null

          // Check if this cell is the source card
          const isSourceCard = sourceCoords && r === sourceCoords.row && c === sourceCoords.col

          if (cell.card && mode === 'SELECT_UNIT_FOR_MOVE') {
            console.log('[calculateValidTargets] onlyAllies check:', {
              r, c, cardId: cell.card.baseId,
              cardOwnerId, actorId,
              isSelf, isTeammate, isFFAMode, isSourceCard,
              actorTeamId: actorPlayer?.teamId,
              targetTeamId: targetPlayer?.teamId,
              isValidBefore: isValid
            })
          }

          if (!isSelf && !isTeammate) {
            isValid = false
          }

          // excludeSelf: If true, self is not a valid target (Signal Prophet: "another allied card")
          // CRITICAL: Different behavior for FFA vs team mode:
          // - FFA mode: allow ALL self-owned cards (the "another" constraint doesn't apply in FFA)
          // - Team mode: exclude source card only (teammates' cards are "another" ally)
          if (payload.excludeSelf) {
            if (!isFFAMode) {
              // In team mode: exclude source card (teammates provide other valid targets)
              if (isSourceCard) {
                isValid = false
              }
            }
            // In FFA mode: do NOT exclude any self cards (allow all your cards with the counter)
          }

          if (cell.card && mode === 'SELECT_UNIT_FOR_MOVE') {
            console.log('[calculateValidTargets] onlyAllies result:', { r, c, isValidAfter: isValid, isFFAMode, isSourceCard })
          }
        }

        // Check requireTokenFromSourceOwner - ensures token/counter was added by the activating player
        // Used by Signal Prophet: "with an Exploit counter" (implicitly "your" counter)
        if (isValid && payload.requireTokenFromSourceOwner && cell.card?.statuses && actorId !== null) {
          // Extract counter type from filterString (e.g., "hasCounter_Exploit" -> "Exploit")
          let counterType = 'Exploit' // Default fallback
          if (payload.filterString && typeof payload.filterString === 'string') {
            // Handle hasCounter_CounterName format
            if (payload.filterString.startsWith('hasCounter_')) {
              counterType = payload.filterString.replace('hasCounter_', '')
            }
            // Handle hasCounterOwner_CounterName format
            else if (payload.filterString.startsWith('hasCounterOwner_')) {
              counterType = payload.filterString.replace('hasCounterOwner_', '')
            }
            // Handle hasStatus_StatusName format
            else if (payload.filterString.startsWith('hasStatus_')) {
              counterType = payload.filterString.replace('hasStatus_', '')
            }
          }

          const hasTokenFromSourceOwner = cell.card.statuses.some((s: any) =>
            s.type === counterType && s.addedByPlayerId === actorId
          )

          if (cell.card && mode === 'SELECT_UNIT_FOR_MOVE') {
            console.log('[calculateValidTargets] requireTokenFromSourceOwner check:', {
              r, c, cardId: cell.card.baseId,
              counterType, actorId,
              statuses: cell.card.statuses,
              hasTokenFromSourceOwner,
              isValidBefore: isValid
            })
          }

          if (!hasTokenFromSourceOwner) {
            isValid = false
          }
        }

        if (cell.card && mode === 'SELECT_UNIT_FOR_MOVE') {
          console.log('[calculateValidTargets] Checking cell', { r, c, cardId: cell.card.baseId, cardOwnerId: cell.card.ownerId, sourceOwnerId: actorId, isValid, onlyOpponents: payload.onlyOpponents, onlyAllies: payload.onlyAllies })
        }

        // Check context requirements (e.g., Adjacent to last move)
        if (isValid && contextCheck === 'ADJACENT_TO_LAST_MOVE' && commandContext?.lastMovedCardCoords) {
          const { row: lr, col: lc } = commandContext.lastMovedCardCoords
          const isAdj = Math.abs(r - lr) + Math.abs(c - lc) === 1
          if (!isAdj) {
            isValid = false
          }
        }

        if (isValid) {
          targets.push({ row: r, col: c })
        }
      }
    }

    console.log('[calculateValidTargets] Found targets:', { mode, actionType: payload.actionType, targetCount: targets.length, targets })
  }
  // 1.1 Enhanced Interrogation Generic Targeting (Any Unit)
  else if (mode === 'SELECT_TARGET' && (payload.actionType === 'ENHANCED_INT_REVEAL' || payload.actionType === 'ENHANCED_INT_MOVE')) {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 2. Patrol Move (Empty cell in same row/col)
  // Note: Patrol needs to check full rows/cols, but limited to active bounds
  else if (mode === 'PATROL_MOVE' && sourceCoords) {
    // Iterate ONLY over active grid bounds (patrol can move within active area)
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        // Must be same row OR same col
        const isLine = (r === sourceCoords.row || c === sourceCoords.col)
        const isSame = (r === sourceCoords.row && c === sourceCoords.col)
        const isEmpty = !board[r][c].card

        // Allow moving to empty cell OR cancelling by clicking same cell
        if (isLine && (isEmpty || isSame)) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 3. Push (Adjacent opponent who can be pushed into empty space)
  else if (mode === 'PUSH' && sourceCoords) {
    console.log('[calculateValidTargets PUSH] sourceCoords:', sourceCoords, 'actorId:', actorId, 'gridSize:', gridSize, 'activeSize:', activeSize, 'bounds:', { minBound, maxBound })
    console.log('[calculateValidTargets PUSH] board around sourceCoords:')
    // Show all cells around sourceCoords for debugging
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = sourceCoords.row + dr
        const c = sourceCoords.col + dc
        if (r >= 0 && r < gridSize && c >= 0 && c < gridSize) {
          const cell = board[r][c]
          console.log(`[calculateValidTargets PUSH] board[${r}][${c}]:`, cell?.card?.baseId || 'empty', 'ownerId:', cell?.card?.ownerId)
        }
      }
    }

    const neighbors = [
      { r: sourceCoords.row - 1, c: sourceCoords.col },
      { r: sourceCoords.row + 1, c: sourceCoords.col },
      { r: sourceCoords.row, c: sourceCoords.col - 1 },
      { r: sourceCoords.row, c: sourceCoords.col + 1 },
    ]

    // Helper to check if coords are in active bounds
    const isInActiveBounds = (r: number, c: number) => r >= minBound && r <= maxBound && c >= minBound && c <= maxBound

    neighbors.forEach(nb => {
      console.log('[calculateValidTargets PUSH] checking neighbor:', nb, 'inBounds:', isInActiveBounds(nb.r, nb.c))
      // Check bounds (using visible grid bounds)
      if (isInActiveBounds(nb.r, nb.c)) {
        const targetCard = board[nb.r][nb.c].card
        console.log('[calculateValidTargets PUSH] card at neighbor:', targetCard?.baseId, 'ownerId:', targetCard?.ownerId)

        // Check if opponent (Not Self AND Not Teammate)
        if (targetCard && targetCard.ownerId !== actorId) {
          const actorPlayer = currentGameState.players.find(p => p.id === actorId)
          const targetPlayer = currentGameState.players.find(p => p.id === targetCard.ownerId)
          // CRITICAL: Use != null to check for both undefined AND null
          // If teamId is not set (undefined/null), player is in FFA mode - no teammates
          const isTeammate = actorPlayer?.teamId != null && targetPlayer?.teamId != null && actorPlayer.teamId === targetPlayer.teamId
          console.log('[calculateValidTargets PUSH] actorPlayer:', actorPlayer?.name, 'teamId:', actorPlayer?.teamId, 'targetPlayer:', targetPlayer?.name, 'teamId:', targetPlayer?.teamId, 'isTeammate:', isTeammate)

          if (!isTeammate) {
            // Calculate push destination
            const dRow = nb.r - sourceCoords.row
            const dCol = nb.c - sourceCoords.col
            const pushRow = nb.r + dRow
            const pushCol = nb.c + dCol

            console.log('[calculateValidTargets PUSH] push dest:', { pushRow, pushCol }, 'inBounds:', isInActiveBounds(pushRow, pushCol), 'isEmpty:', !board[pushRow]?.[pushCol]?.card)

            // Check dest bounds and emptiness against VISIBLE grid
            if (isInActiveBounds(pushRow, pushCol)) {
              if (!board[pushRow][pushCol].card) {
                targets.push({ row: nb.r, col: nb.c })
                console.log('[calculateValidTargets PUSH] VALID TARGET FOUND!')
              }
            }
          }
        }
      }
    })
    console.log('[calculateValidTargets PUSH] final targets count:', targets.length)
  }
  // 3b. SHIELD_SELF_THEN_PUSH (Reclaimed Gawain - same as PUSH but includes self as valid target)
  else if (mode === 'SHIELD_SELF_THEN_PUSH' && sourceCoords) {
    // Include self as valid target (clicking self just adds Shield)
    if (sourceCoords) {
      targets.push(sourceCoords)
    }

    const neighbors = [
      { r: sourceCoords.row - 1, c: sourceCoords.col },
      { r: sourceCoords.row + 1, c: sourceCoords.col },
      { r: sourceCoords.row, c: sourceCoords.col - 1 },
      { r: sourceCoords.row, c: sourceCoords.col + 1 },
    ]

    // Helper to check if coords are in active bounds
    const isInActiveBounds = (r: number, c: number) => r >= minBound && r <= maxBound && c >= minBound && c <= maxBound

    neighbors.forEach(nb => {
      // Check bounds (using visible grid bounds)
      if (isInActiveBounds(nb.r, nb.c)) {
        const targetCard = board[nb.r][nb.c].card

        // Check if opponent (Not Self AND Not Teammate)
        if (targetCard && targetCard.ownerId !== actorId) {
          const actorPlayer = currentGameState.players.find(p => p.id === actorId)
          const targetPlayer = currentGameState.players.find(p => p.id === targetCard.ownerId)
          const isTeammate = actorPlayer?.teamId !== undefined && targetPlayer?.teamId !== undefined && actorPlayer.teamId === targetPlayer.teamId

          if (!isTeammate) {
            // Calculate push destination
            const dRow = nb.r - sourceCoords.row
            const dCol = nb.c - sourceCoords.col
            const pushRow = nb.r + dRow
            const pushCol = nb.c + dCol

            // Check dest bounds and emptiness against VISIBLE grid
            if (isInActiveBounds(pushRow, pushCol)) {
              if (!board[pushRow][pushCol].card) {
                targets.push({ row: nb.r, col: nb.c })
              }
            }
          }
        }
      }
    })
  }
  // 4. PUSH_MOVE (After push - choose where to move: stay in place or move to vacated cell)
  // Used by Riot Agent and Reclaimed Gawain after pushing an opponent card
  else if (mode === 'PUSH_MOVE' && payload.vacatedCoords && sourceCoords) {
    // Option 1: Stay in place (click on sourceCoords)
    targets.push(sourceCoords)

    // Option 2: Move to vacated cell (where pushed card was)
    targets.push(payload.vacatedCoords)

    // Option 3: Intermediate cells (if source and vacated are more than 1 cell apart)
    if (sourceCoords.row === payload.vacatedCoords.row) {
      // Same row - add intermediate columns
      const minCol = Math.min(sourceCoords.col, payload.vacatedCoords.col)
      const maxCol = Math.max(sourceCoords.col, payload.vacatedCoords.col)
      for (let c = minCol + 1; c < maxCol; c++) {
        // Only add if cell is empty
        if (!board[sourceCoords.row][c].card) {
          targets.push({ row: sourceCoords.row, col: c })
        }
      }
    } else if (sourceCoords.col === payload.vacatedCoords.col) {
      // Same column - add intermediate rows
      const minRow = Math.min(sourceCoords.row, payload.vacatedCoords.row)
      const maxRow = Math.max(sourceCoords.row, payload.vacatedCoords.row)
      for (let r = minRow + 1; r < maxRow; r++) {
        // Only add if cell is empty
        if (!board[r][sourceCoords.col].card) {
          targets.push({ row: r, col: sourceCoords.col })
        }
      }
    }
  }
  // 5. Riot Move (Specifically vacated cell)
  else if (mode === 'RIOT_MOVE' && payload.vacatedCoords) {
    targets.push(payload.vacatedCoords)
    // Also highlight self to indicate "stay" option
    if (sourceCoords) {
      targets.push(sourceCoords)
    }
  }
  // 5. Swap Positions (Reckless Provocateur)
  else if (mode === 'SWAP_POSITIONS' && payload.filter) {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card && payload.filter(cell.card, r, c)) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 6. Transfer Status (Reckless Provocateur Commit)
  // Update to handle both single and ALL transfers
  else if ((mode === 'TRANSFER_STATUS_SELECT' || mode === 'TRANSFER_ALL_STATUSES') && payload.filter) {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card && payload.filter(cell.card, r, c)) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // 7. Spawn Token / Select Cell / Move Self Any Empty
  else if ((mode === 'SPAWN_TOKEN' || mode === 'SELECT_CELL' || mode === 'IMMUNIS_RETRIEVE' || mode === 'MOVE_SELF_ANY_EMPTY')) {
    // Note: IMMUNIS_RETRIEVE behaves like select cell when picking the destination
    // MOVE_SELF_ANY_EMPTY allows moving to any empty cell (Recon Drone Setup)
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const isEmpty = !board[r][c].card

        // MOVE_SELF_ANY_EMPTY - any empty cell is valid
        if (mode === 'MOVE_SELF_ANY_EMPTY' && isEmpty) {
          targets.push({ row: r, col: c })
          continue
        }

        // If Immunis logic, we check filter (adjacency)
        if (mode === 'IMMUNIS_RETRIEVE' && payload.filter) {
          if (isEmpty && payload.filter(r, c)) {
            targets.push({ row: r, col: c })
          }
          continue
        }

        // For Generic Select Cell (e.g., Recon Drone move, Fusion moves)
        // Payload allowSelf controls "Stay"
        if (mode === 'SELECT_CELL') {
          // Check Move From Hand first
          if (payload.moveFromHand) {
            if (isEmpty) {
              targets.push({ row: r, col: c })
            }
            continue
          }

          if (!sourceCoords) {
            continue
          }

          const isSame = r === sourceCoords.row && c === sourceCoords.col
          const isGlobal = payload.range === 'global'

          let isValidLoc = false

          if (isGlobal) {
            isValidLoc = true
          } else if (payload.range === 'line') {
            isValidLoc = r === sourceCoords.row || c === sourceCoords.col
          } else if (payload.range === RANGE_TWO_DISTANCE) {
            // Range RANGE_TWO_DISTANCE: ADJACENT_DISTANCE or RANGE_TWO_DISTANCE cells away.
            const dRow = Math.abs(r - sourceCoords.row)
            const dCol = Math.abs(c - sourceCoords.col)
            const dist = dRow + dCol

            if (dist === ADJACENT_DISTANCE) {
              isValidLoc = true
            } else if (dist === RANGE_TWO_DISTANCE) {
              // Logic for RANGE_TWO_DISTANCE cells: must be reachable via an empty cell (or straight line RANGE_TWO_DISTANCE).
              // BFS Depth RANGE_TWO_DISTANCE check.
              // Candidates for intermediate step:
              const inters = []
              if (dRow === RANGE_TWO_DISTANCE && dCol === 0) {
                inters.push({ r: (r + sourceCoords.row) / 2, c: c })
              } // Straight vertical
              else if (dRow === 0 && dCol === RANGE_TWO_DISTANCE) {
                inters.push({ r: r, c: (c + sourceCoords.col) / 2 })
              } // Straight horizontal
              else if (dRow === ADJACENT_DISTANCE && dCol === ADJACENT_DISTANCE) { // Diagonal (L-shape)
                inters.push({ r: r, c: sourceCoords.col })
                inters.push({ r: sourceCoords.row, c: c })
              }

              // If ANY intermediate cell is empty, move is valid.
              // BOUNDS CHECK to prevent crash
              isValidLoc = inters.some(i => {
                if (i.r < 0 || i.r >= gridSize || i.c < 0 || i.c >= gridSize) {
                  return false
                }
                return !board[i.r][i.c].card
              })
            }
          } else {
            // Default to Adjacent
            isValidLoc = Math.abs(r - sourceCoords.row) + Math.abs(c - sourceCoords.col) === ADJACENT_DISTANCE
          }

          if ((isEmpty && isValidLoc) || (payload.allowSelf && isSame)) {
            targets.push({ row: r, col: c })
          }
        } else if (mode === 'SPAWN_TOKEN' && sourceCoords) {
          // For Inventive Maker Spawn (Adj)
          const isAdj = Math.abs(r - sourceCoords.row) + Math.abs(c - sourceCoords.col) === 1
          if (isEmpty && isAdj) {
            targets.push({ row: r, col: c })
          }
        }
      }
    }
  }
  // 8. Reveal Enemy (Recon Drone)
  else if (mode === 'REVEAL_ENEMY' && payload.filter) {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        const cell = board[r][c]
        if (cell.card && payload.filter(cell.card, r, c)) {
          targets.push({ row: r, col: c })
        }
      }
    }
  }
  // SHIELD_SELF_THEN_SPAWN (Edith Byron Deploy) - after Shield is added, spawn token adjacent
  else if (mode === 'SHIELD_SELF_THEN_SPAWN' && sourceCoords) {
    // Adjacent empty cells only (same as SPAWN_TOKEN)
    const neighbors = [
      { r: sourceCoords.row - 1, c: sourceCoords.col },
      { r: sourceCoords.row + 1, c: sourceCoords.col },
      { r: sourceCoords.row, c: sourceCoords.col - 1 },
      { r: sourceCoords.row, c: sourceCoords.col + 1 },
    ]

    neighbors.forEach(nb => {
      if (nb.r >= minBound && nb.r <= maxBound && nb.c >= minBound && nb.c <= maxBound) {
        const cell = board[nb.r][nb.c]
        if (!cell.card) {
          targets.push({ row: nb.r, col: nb.c })
        }
      }
    })
  }
  // 9. Select Line Start (Any cell in active grid)
  else if (mode === 'SELECT_LINE_START') {
    // Iterate ONLY over active grid bounds
    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        targets.push({ row: r, col: c })
      }
    }
  }
  // 10. Select Line End (Cells in same row/col)
  else if (mode === 'SELECT_LINE_END' && payload.firstCoords) {
    // Check row and col of firstCoords - iterate only those within active bounds
    const { row: firstRow, col: firstCol } = payload.firstCoords

    // Add all cells in same row (within active bounds)
    for (let c = minBound; c <= maxBound; c++) {
      targets.push({ row: firstRow, col: c })
    }
    // Add all cells in same col (within active bounds)
    for (let r = minBound; r <= maxBound; r++) {
      targets.push({ row: r, col: firstCol })
    }
  }
  // 11. Zius Line Select (Cells in same row/col as source)
  else if (mode === 'ZIUS_LINE_SELECT' && sourceCoords) {
    const { row: sourceRow, col: sourceCol } = sourceCoords

    // Add all cells in same row (within active bounds)
    for (let c = minBound; c <= maxBound; c++) {
      targets.push({ row: sourceRow, col: c })
    }
    // Add all cells in same col (within active bounds)
    for (let r = minBound; r <= maxBound; r++) {
      targets.push({ row: r, col: sourceCol })
    }
  }
  // 11.6. IP Agent Threat Scoring (same as Integrator - select any cell in same row or col)
  else if (mode === 'IP_AGENT_THREAT_SCORING' && sourceCoords) {
    const { row: sourceRow, col: sourceCol } = sourceCoords

    // Add all cells in same row (within active bounds)
    for (let c = minBound; c <= maxBound; c++) {
      targets.push({ row: sourceRow, col: c })
    }
    // Add all cells in same col (within active bounds)
    for (let r = minBound; r <= maxBound; r++) {
      targets.push({ row: r, col: sourceCol })
    }
  }
  // 12. Select Diagonal
  else if (mode === 'SELECT_DIAGONAL') {
    if (!payload.firstCoords) {
      // Step 1: Can start anywhere in active grid
      for (let r = minBound; r <= maxBound; r++) {
        for (let c = minBound; c <= maxBound; c++) {
          targets.push({ row: r, col: c })
        }
      }
    } else {
      // Step 2: Highlight only diagonals from firstCoords (within active bounds)
      const { row: r1, col: c1 } = payload.firstCoords
      // Calculate max diagonal distance from firstCoords to active bounds
      for (let r = minBound; r <= maxBound; r++) {
        for (let c = minBound; c <= maxBound; c++) {
          if (Math.abs(r - r1) === Math.abs(c - c1)) {
            targets.push({ row: r, col: c })
          }
        }
      }
    }
  }
  // 13. SWAP_ADJACENT - Adjacent cards for swapping
  else if (mode === 'SWAP_ADJACENT' && sourceCoords) {
    const neighbors = [
      { r: sourceCoords.row - 1, c: sourceCoords.col },
      { r: sourceCoords.row + 1, c: sourceCoords.col },
      { r: sourceCoords.row, c: sourceCoords.col - 1 },
      { r: sourceCoords.row, c: sourceCoords.col + 1 },
    ]

    neighbors.forEach(nb => {
      if (nb.r >= minBound && nb.r <= maxBound && nb.c >= minBound && nb.c <= maxBound) {
        const cell = board[nb.r][nb.c]
        if (cell.card) {
          targets.push({ row: nb.r, col: nb.c })
        }
      }
    })
  }

  return targets
}

/**
 * Checks if an action has ANY valid targets (Board or Hand).
 */
export const checkActionHasTargets = (action: AbilityAction, currentGameState: GameState, playerId: number | null, commandContext?: CommandContext): boolean => {
  // AUTO_STEPS always has targets (it's a multi-step ability that executes step by step)
  if (action.type === 'ENTER_MODE' && action.mode === 'AUTO_STEPS') {
    return true
  }

  // If modal open, check mode for specific conditions
  if (action.type === 'OPEN_MODAL') {
    // PLACE_TOKEN with adjacent range needs adjacent empty cell
    if (action.mode === 'PLACE_TOKEN' && action.payload?.range === 'adjacent' && action.sourceCoords) {
      const { row, col } = action.sourceCoords
      const neighbors = [
        { r: row - 1, c: col },
        { r: row + 1, c: col },
        { r: row, c: col - 1 },
        { r: row, c: col + 1 },
      ]
      for (const nb of neighbors) {
        if (nb.r >= 0 && nb.r < currentGameState.board.length &&
            nb.c >= 0 && nb.c < currentGameState.board[0].length) {
          if (!currentGameState.board[nb.r][nb.c].card) {
            return true // Found adjacent empty cell
          }
        }
      }
      return false // No adjacent empty cells
    }

    // RETURN_FROM_DISCARD_TO_BOARD needs both cards in discard AND adjacent empty cell
    if (action.mode === 'RETURN_FROM_DISCARD_TO_BOARD' && action.sourceCoords) {
      const ownerId = action.sourceCard?.ownerId ?? playerId ?? 0
      const player = currentGameState.players.find(p => p.id === ownerId)

      // Check if player has cards in discard that match filter
      let hasValidCards = false
      if (player && player.discard && player.discard.length > 0) {
        const filter = action.payload?.filter
        if (filter) {
          if (typeof filter === 'function') {
            hasValidCards = player.discard.some(card => filter(card))
          } else if (typeof filter === 'string') {
            // Handle string filters like 'hasFaction_Optimates'
            if (filter.startsWith('hasFaction_')) {
              const faction = filter.replace('hasFaction_', '')
              hasValidCards = player.discard.some(card => card.faction === faction)
            } else if (filter.startsWith('hasType_')) {
              const type = filter.replace('hasType_', '')
              hasValidCards = player.discard.some(card => card.types?.includes(type) === true)
            }
          }
        } else {
          hasValidCards = true // No filter means any card is valid
        }
      }

      // Also need adjacent empty cell
      const { row, col } = action.sourceCoords
      const neighbors = [
        { r: row - 1, c: col },
        { r: row + 1, c: col },
        { r: row, c: col - 1 },
        { r: row, c: col + 1 },
      ]
      let hasAdjacentEmpty = false
      for (const nb of neighbors) {
        if (nb.r >= 0 && nb.r < currentGameState.board.length &&
            nb.c >= 0 && nb.c < currentGameState.board[0].length) {
          if (!currentGameState.board[nb.r][nb.c].card) {
            hasAdjacentEmpty = true
            break
          }
        }
      }

      return hasValidCards && hasAdjacentEmpty
    }

    // RETURN_FROM_DISCARD_TO_HAND needs cards in discard
    if (action.mode === 'RETURN_FROM_DISCARD_TO_HAND') {
      const ownerId = action.sourceCard?.ownerId ?? playerId ?? 0
      const player = currentGameState.players.find(p => p.id === ownerId)

      // Check if source card has Support if required
      // This handles abilities like Inventive Maker Setup: "Setup (requires Support)"
      if (action.supportRequired && action.sourceCard) {
        if (!hasStatus(action.sourceCard, 'Support', ownerId)) {
          return false // No Support, cannot activate
        }
      }

      if (player && player.discard && player.discard.length > 0) {
        const filter = action.payload?.filter
        if (filter) {
          if (typeof filter === 'function') {
            return player.discard.some(card => filter(card))
          } else if (typeof filter === 'string') {
            if (filter.startsWith('hasFaction_')) {
              const faction = filter.replace('hasFaction_', '')
              return player.discard.some(card => card.faction === faction)
            } else if (filter.startsWith('hasType_')) {
              const type = filter.replace('hasType_', '')
              return player.discard.some(card => card.types?.includes(type) === true)
            }
          }
        }
        return true // No filter means any card is valid
      }
      return false // No cards in discard
    }

    return true // Other modals are always valid
  }

  // Special Case: Select Deck has global targets (all decks)
  if (action.mode === 'SELECT_DECK') {
    return true
  }

  // Special Case: SWAP_ADJACENT needs adjacent cards
  if (action.mode === 'SWAP_ADJACENT' && action.sourceCoords) {
    const { row, col } = action.sourceCoords
    const neighbors = [
      { r: row - 1, c: col },
      { r: row + 1, c: col },
      { r: row, c: col - 1 },
      { r: row, c: col + 1 },
    ]
    for (const nb of neighbors) {
      if (nb.r >= 0 && nb.r < currentGameState.board.length &&
          nb.c >= 0 && nb.c < currentGameState.board[0].length) {
        if (currentGameState.board[nb.r][nb.c].card) {
          return true // Found adjacent card
        }
      }
    }
    return false // No adjacent cards
  }

  // Special Case: PUSH (Riot Agent Deploy) - targets are validated at ability application time
  // Allows activation even if no valid targets exist at placement time
  // Valid targets (adjacent opponent that can be pushed into empty space) are checked when player clicks to activate
  if (action.mode === 'PUSH') {
    return true // Always allow activation - validation happens on click
  }

  // Special Case: REVEREND_DOUBLE_EXPLOIT can target any card on battlefield
  if (action.mode === 'REVEREND_DOUBLE_EXPLOIT') {
    // Check if there's at least one card on battlefield
    for (let r = 0; r < currentGameState.board.length; r++) {
      for (let c = 0; c < currentGameState.board[r].length; c++) {
        if (currentGameState.board[r][c].card) {
          return true
        }
      }
    }
    return false
  }

  // Special Case: Compound abilities that start with an immediate self-effect are always valid.
  // Even if there are no targets for secondary part (e.g., Aim), first part (Shield) still happens.
  if (action.mode === 'PRINCEPS_SHIELD_THEN_AIM' ||
         action.mode === 'SHIELD_SELF_THEN_SPAWN' ||
         action.mode === 'SHIELD_SELF_THEN_PUSH' ||
         action.mode === 'ABR_DEPLOY_SHIELD_AIM' ||
         action.mode === 'GAWAIN_DEPLOY_SHIELD_AIM') {
    return true
  }

  // Special Case: RECON_DRONE_COMMIT (2-step: select adjacent opponent card, then reveal their hand card)
  // Check if there's at least one adjacent opponent card
  if (action.mode === 'RECON_DRONE_COMMIT' && action.sourceCoords) {
    const { row, col } = action.sourceCoords
    const neighbors = [
      { r: row - 1, c: col },
      { r: row + 1, c: col },
      { r: row, c: col - 1 },
      { r: row, c: col + 1 },
    ]
    const ownerId = action.sourceCard?.ownerId || playerId

    for (const nb of neighbors) {
      if (nb.r >= 0 && nb.r < currentGameState.board.length &&
          nb.c >= 0 && nb.c < currentGameState.board[0].length) {
        const cell = currentGameState.board[nb.r][nb.c]
        if (cell.card && cell.card.ownerId !== ownerId) {
          const targetOwnerId = cell.card.ownerId
          // Check if target is opponent (not teammate)
          const actorPlayer = currentGameState.players.find(p => p.id === ownerId)
          const targetPlayer = currentGameState.players.find(p => p.id === targetOwnerId)
          const isTeammate = actorPlayer?.teamId !== undefined && targetPlayer?.teamId !== undefined &&
                            actorPlayer.teamId === targetPlayer.teamId

          if (!isTeammate) {
            return true // Found adjacent opponent card
          }
        }
      }
    }
    return false // No adjacent opponent cards
  }

  // Special Case: TRANSFER_ALL_STATUSES (Reckless Provocateur Commit)
  // Check if there's at least one allied card with transferable counters
  if (action.mode === 'TRANSFER_ALL_STATUSES' && action.sourceCoords) {
    const ownerId = action.sourceCard?.ownerId || playerId
    const transferableTypes = ['Aim', 'Shield', 'Exploit', 'Stun', 'Revealed', 'Rule']
    const activeSize = currentGameState.activeGridSize
    const gridSize = currentGameState.board.length
    const offset = Math.floor((gridSize - activeSize) / 2)
    const minBound = offset
    const maxBound = offset + activeSize - 1

    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        // Skip source card
        if (action.sourceCoords && r === action.sourceCoords.row && c === action.sourceCoords.col) {
          continue
        }

        const cell = currentGameState.board[r][c]
        if (cell.card && cell.card.ownerId === ownerId) {
          // Check if card has any transferable statuses
          const hasTransferableStatus = cell.card.statuses?.some((s: any) => transferableTypes.includes(s.type))
          if (hasTransferableStatus) {
            return true // Found allied card with transferable counters
          }
        }
      }
    }
    return false // No allied cards with transferable counters
  }

  // Special Case: MOVE_SELF_ANY_EMPTY (Recon Drone Setup)
  // Check if there's at least one empty cell on the board
  if (action.mode === 'MOVE_SELF_ANY_EMPTY') {
    const activeSize = currentGameState.activeGridSize
    const gridSize = currentGameState.board.length
    const offset = Math.floor((gridSize - activeSize) / 2)
    const minBound = offset
    const maxBound = offset + activeSize - 1

    for (let r = minBound; r <= maxBound; r++) {
      for (let c = minBound; c <= maxBound; c++) {
        if (!currentGameState.board[r][c].card) {
          return true // Found empty cell
        }
      }
    }
    return false // No empty cells
  }

  // Special Case: SELECT_UNIT_FOR_MOVE (Finn Setup) - needs allied cards on board
  if (action.mode === 'SELECT_UNIT_FOR_MOVE' && action.payload) {
    console.log('[checkActionHasTargets] SELECT_UNIT_FOR_MOVE check', {
      filterString: action.payload.filterString,
      hasFilter: !!action.payload.filter,
      sourceOwnerId: action.sourceCard?.ownerId || playerId
    })
  }

  // Special Case: Hand-only actions that require discarding (Faber, Lucius)
  // These actions target cards in hand, so we need to check if player has cards to discard
  if (action.mode === 'SELECT_TARGET' && action.payload?.actionType) {
    const actionType = action.payload.actionType
    if (actionType === 'SELECT_HAND_FOR_DISCARD_THEN_SPAWN' ||
        actionType === 'SELECT_HAND_FOR_DISCARD_THEN_PLACE_TOKEN' ||
        actionType === 'LUCIUS_SETUP' ||
        actionType === 'SELECT_HAND_FOR_DEPLOY') {
      // Check if source card's owner has cards in hand that pass the filter
      const ownerId = action.sourceCard?.ownerId || playerId
      console.log('[checkActionHasTargets] Hand-only discard action:', {
        actionType,
        ownerId,
        sourceCardName: action.sourceCard?.name,
      })
      if (ownerId !== null) {
        const player = currentGameState.players.find(p => p.id === ownerId)
        if (player && player.hand.length > 0) {
          // Check if any card in hand passes the filter
          const filter = action.payload.filter
          if (!filter) {
            console.log('[checkActionHasTargets] No filter, any card is valid')
            return true // No filter means any card is valid
          }
          // Check if at least one card passes the filter
          let validCount = 0
          for (const card of player.hand) {
            if (filter(card)) {
              validCount++
              console.log('[checkActionHasTargets] Card passes filter:', card.name)
            }
          }
          console.log('[checkActionHasTargets] Valid cards:', validCount, 'of', player.hand.length)
          if (validCount > 0) {
            return true // Found at least one valid card
          }
          return false // No cards pass the filter
        }
      }
      console.log('[checkActionHasTargets] No player or no cards in hand')
      return false // No cards in hand
    }
  }

  // Special Case: SACRIFICE_AND_BUFF_LINES (Centurion Commit)
  // Needs allied units on the board (can sacrifice itself in a pinch)
  if (action.mode === 'SELECT_TARGET' && action.payload?.actionType === 'SACRIFICE_AND_BUFF_LINES') {
    const ownerId = action.sourceCard?.ownerId || playerId
    if (ownerId !== null) {
      // Check if there are any allied cards on the board
      const activeSize = currentGameState.activeGridSize
      const gridSize = currentGameState.board.length
      const offset = Math.floor((gridSize - activeSize) / 2)
      const minBound = offset
      const maxBound = offset + activeSize - 1

      for (let r = minBound; r <= maxBound; r++) {
        for (let c = minBound; c <= maxBound; c++) {
          const card = currentGameState.board[r][c].card
          if (card && card.ownerId === ownerId) {
            return true // Found allied card to sacrifice
          }
        }
      }
    }
    return false // No allied cards on board
  }

  // Special Case: CENSOR_SWAP (Censor Commit - replace Exploit with Stun)
  // Needs cards on the board with the specified token from this player
  if (action.mode === 'SELECT_TARGET' && action.payload?.actionType === 'CENSOR_SWAP') {
    const ownerId = action.sourceCard?.ownerId || playerId
    const fromToken = action.payload.fromToken

    if (ownerId !== null && fromToken) {
      const activeSize = currentGameState.activeGridSize
      const gridSize = currentGameState.board.length
      const offset = Math.floor((gridSize - activeSize) / 2)
      const minBound = offset
      const maxBound = offset + activeSize - 1

      for (let r = minBound; r <= maxBound; r++) {
        for (let c = minBound; c <= maxBound; c++) {
          const card = currentGameState.board[r][c].card
          if (card && card.statuses) {
            // Check if card has the token
            const hasToken = card.statuses.some((s: any) => {
              if (s.type !== fromToken) return false
              // If requireTokenFromSourceOwner, check if added by this owner
              if (action.payload.requireTokenFromSourceOwner) {
                return s.addedByPlayerId === ownerId
              }
              return true
            })
            if (hasToken) {
              return true // Found card with the token
            }
          }
        }
      }
    }
    return false // No cards with the token
  }

  // Note: CREATE_STACK is now checked via calculateValidTargets as well
  if (action.type === 'CREATE_STACK') {
    // Special Case: Abilities with requiredTargetStatus (Riot Agent Commit, etc.) - targets validated at application time
    // Allows activation even if no valid targets exist at placement time
    // Valid targets are checked when player clicks to activate
    if (action.requiredTargetStatus) {
      return true // Always allow activation - validation happens on click
    }

    const boardTargets = calculateValidTargets(action, currentGameState, playerId, commandContext)

    if (boardTargets.length > 0) {
      return true
    }

    // Check Hand targets if stack type is compatible
    // RULE: Targeting tokens (Aim, Exploit, Stun, Shield) CANNOT target cards in hand
    // Only Revealed status and Rule tokens can target hand cards
    const targetingTokens = ['Aim', 'Exploit', 'Stun', 'Shield']
    const isTargetingToken = action.tokenType && targetingTokens.includes(action.tokenType)

    // Only allow hand targeting for Revealed status or Power buffs (not targeting tokens)
    if (!isTargetingToken && (action.tokenType === 'Revealed' || action.tokenType?.startsWith('Power'))) {
      // CRITICAL: Pass originalOwnerId as tokenOwnerId for proper onlyOpponents check
      // This fixes Enhanced Interrogation highlighting owner's hand cards
      const tokenOwnerId = action.originalOwnerId

      // We need to check if ANY hand card is valid
      for (const p of currentGameState.players) {
        for (let i = 0; i < p.hand.length; i++) {
          const constraints = {
            targetOwnerId: action.targetOwnerId,
            excludeOwnerId: action.excludeOwnerId,
            onlyOpponents: action.onlyOpponents,
            onlyFaceDown: action.onlyFaceDown,
            targetType: action.targetType,
            tokenType: action.tokenType,
          }
          const isValid = validateTarget(
            { card: p.hand[i], ownerId: p.id, location: 'hand' },
            constraints,
            playerId,
            currentGameState.players,
            tokenOwnerId,
          )
          if (isValid) {
            return true
          }
        }
      }
    }

    return false
  }

  // 1. Check Hand Targets first (for handOnly actions like IP Dept Agent)
  // DESTROY with filter (e.g., hasCounter_Aim) targets board cards, not hand
  if (action.mode === 'SELECT_TARGET' && action.payload?.filter) {
    if (action.payload.handOnly || action.payload.allowHandTargets) {
      // Iterate all players hands
      for (const p of currentGameState.players) {
        if (p.hand.some((card) => action.payload.filter!(card))) {
          // For handOnly actions, this is sufficient - don't check board
          if (action.payload.handOnly) {
            return true
          }
        }
      }
    }
    // For handOnly actions, we've already checked and should not continue to board
    if (action.payload.handOnly) {
      return false
    }
  }

  // 2. Check Board Targets
  const boardTargets = calculateValidTargets(action, currentGameState, playerId, commandContext)
  if (boardTargets.length > 0) {
    return true
  }

  // 3. Check modes with filters that only work on board (CENSOR_SWAP, etc.)
  if ((action.mode === 'CENSOR_SWAP' || action.mode === 'ZEALOUS_WEAKEN' || action.mode === 'CENTURION_BUFF' || action.mode === 'SELECT_UNIT_FOR_MOVE') && action.payload?.filter) {
    // Board targets are already checked in step 1
    // Return false since no valid board targets were found
    return false
  }

  return false
}

/**
 * Calculate hand targets for CREATE_STACK actions with allowHandTargets
 * Returns array of {playerId, cardIndex} for valid hand targets
 */
export function calculateHandTargets(
  action: AbilityAction | null,
  currentGameState: GameState,
  actorId: number | null,
  commandContext?: CommandContext,
): {playerId: number, cardIndex: number}[] {
  // CRITICAL: Check allowHandTargets from action, payload, or details (chained actions from JSON use payload/details format)
  // This fixes False Orders Option 1 where allowHandTargets is in payload after normalization
  const allowHandTargets = action?.allowHandTargets ?? action?.payload?.allowHandTargets ?? (action as any)?.details?.allowHandTargets
  if (!action || action.type !== 'CREATE_STACK' || !allowHandTargets) {
    return []
  }

  const handTargets: {playerId: number, cardIndex: number}[] = []
  const tokenOwnerId = action.sourceCard?.ownerId ?? actorId
  // CRITICAL: Read targetOwnerId from action, payload, or details (chained actions use payload/details format)
  const targetOwnerId = action.targetOwnerId ?? action.payload?.targetOwnerId ?? (action as any).details?.targetOwnerId
  // CRITICAL: Read onlyOpponents from action or payload
  const onlyOpponents = action.onlyOpponents ?? action.payload?.onlyOpponents
  // CRITICAL: Read excludeOwnerId from action or payload
  const excludeOwnerId = action.excludeOwnerId ?? action.payload?.excludeOwnerId
  // CRITICAL: Read tokenType from action or payload
  const tokenType = action.tokenType ?? action.payload?.tokenType
  // CRITICAL: Read onlyFaceDown from action or payload
  const onlyFaceDown = action.onlyFaceDown ?? action.payload?.onlyFaceDown

  // Determine which players to check
  const playersToCheck = targetOwnerId && targetOwnerId > 0
    ? currentGameState.players.filter(p => p.id === targetOwnerId)
    : currentGameState.players.filter(p => {
        // Check onlyOpponents constraint
        if (onlyOpponents) {
          const effectiveOwnerId = tokenOwnerId ?? actorId
          // Cannot be self
          if (p.id === effectiveOwnerId) return false
          // Cannot be teammate
          const tokenOwner = currentGameState.players.find(tp => tp.id === effectiveOwnerId)
          const targetPlayer = currentGameState.players.find(tp => tp.id === p.id)
          if (tokenOwner && targetPlayer &&
              tokenOwner.teamId != null &&
              tokenOwner.teamId === targetPlayer.teamId) {
            return false
          }
        }
        // Check excludeOwnerId
        if (excludeOwnerId && p.id === excludeOwnerId) {
          return false
        }
        return true
      })

  // Check each player's hand
  for (const player of playersToCheck) {
    if (!player.hand) continue

    for (let i = 0; i < player.hand.length; i++) {
      const card = player.hand[i]

      // Check if card already has this token (for Revealed)
      if (tokenType === 'Revealed') {
        const hasOurRevealed = card.statuses?.some(s =>
          s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId
        )
        if (hasOurRevealed) continue
      }

      // Check onlyFaceDown constraint (for Revealed token)
      if (onlyFaceDown) {
        // Hand cards are considered face-down by default
        // Just check if card doesn't have Revealed token (already checked above)
      }

      handTargets.push({ playerId: player.id, cardIndex: i })
    }
  }

  return handTargets
}
