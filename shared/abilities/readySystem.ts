/**
 * Unified Ready Status System
 *
 * Consolidates all ready status logic into a single, consistent system.
 * Replaces the scattered logic across client/server/autoAbilities files.
 *
 * Core principles:
 * 1. Single source of truth for ready status rules
 * 2. Minimal duplication between client/server
 * 3. Clear separation: what statuses exist vs how they're displayed
 */

// Use 'any' for Card and GameState types to avoid conflicts between client/server type definitions
// The server and client have slightly different Card types (ability vs abilityText)
// but the shared code only needs access to common properties like statuses, baseId, etc.
type Card = any
type GameState = any

// Status type for internal use
type CardStatus = {
  type: string
  addedByPlayerId: number
}

// ============================================================================
// Constants
// ============================================================================

export const READY_STATUS = {
  DEPLOY: 'readyDeploy',
  SETUP: 'readySetup',
  COMMIT: 'readyCommit'
} as const

export type ReadyStatusType = typeof READY_STATUS[keyof typeof READY_STATUS]

// Ready statuses that are phase-specific (calculated locally, not broadcast)
export const PHASE_SPECIFIC_STATUSES = [READY_STATUS.SETUP, READY_STATUS.COMMIT] as const

// Turn-limited ability usage tracking (removed when turn passes)
export const TURN_LIMITED_ABILITIES = {
  DEPLOY_USED: 'deployUsedThisTurn',  // Deploy ability - once per battlefield stay
  SETUP_USED: 'setupUsedThisTurn',    // Setup ability - once per turn
  COMMIT_USED: 'commitUsedThisTurn'   // Commit ability - once per turn
} as const

// ============================================================================
// Type Guards
// ============================================================================

export function isReadyStatus(statusType: string): statusType is ReadyStatusType {
  return Object.values(READY_STATUS).includes(statusType as ReadyStatusType)
}

// ============================================================================
// Ready Status Helpers
// ============================================================================

/** Check if card has a specific ready status */
export function hasReadyStatus(card: Card, statusType: ReadyStatusType): boolean {
  if (!card.statuses) return false
  return card.statuses.some((s: CardStatus) => s.type === statusType)
}

/** Check if card has any ready status */
export function hasAnyReadyStatus(card: Card): boolean {
  if (!card.statuses) return false
  return card.statuses.some((s: CardStatus) => isReadyStatus(s.type))
}

/** Add ready status to card if not present */
export function addReadyStatus(card: Card, statusType: ReadyStatusType, ownerId: number): void {
  if (!card.statuses) card.statuses = []
  if (!card.statuses.some((s: CardStatus) => s.type === statusType)) {
    card.statuses.push({ type: statusType, addedByPlayerId: ownerId })
  }
}

/** Remove ready status from card */
export function removeReadyStatus(card: Card, statusType: ReadyStatusType): void {
  if (!card.statuses) return
  card.statuses = card.statuses.filter((s: CardStatus) => s.type !== statusType)
}

/** Remove all ready statuses from card */
export function removeAllReadyStatuses(card: Card): void {
  if (!card.statuses) return
  card.statuses = card.statuses.filter((s: CardStatus) => !isReadyStatus(s.type))
}

/** Remove phase-specific ready statuses (keeps readyDeploy) */
export function removePhaseSpecificStatuses(card: Card): void {
  if (!card.statuses) return
  card.statuses = card.statuses.filter((s: CardStatus) => {
    if (s.type === READY_STATUS.DEPLOY) return false
    if (s.type === READY_STATUS.SETUP) return false
    if (s.type === READY_STATUS.COMMIT) return false
    return true
  })
}

/** Check if card has used a turn-limited ability this turn */
export function hasUsedAbilityThisTurn(card: Card, abilityType: 'setup' | 'commit'): boolean {
  const usedStatus = abilityType === 'setup'
    ? TURN_LIMITED_ABILITIES.SETUP_USED
    : TURN_LIMITED_ABILITIES.COMMIT_USED
  return card.statuses?.some((s: CardStatus) => s.type === usedStatus) ?? false
}

/** Mark that a card has used its turn-limited ability this turn */
export function markAbilityUsedThisTurn(card: Card, abilityType: 'setup' | 'commit'): void {
  const usedStatus = abilityType === 'setup'
    ? TURN_LIMITED_ABILITIES.SETUP_USED
    : TURN_LIMITED_ABILITIES.COMMIT_USED

  if (!card.statuses) card.statuses = []
  if (!card.statuses.some((s: CardStatus) => s.type === usedStatus)) {
    card.statuses.push({ type: usedStatus, addedByPlayerId: card.ownerId || 0 })

    // When ability is used, also remove the corresponding ready status
    const readyStatus = abilityType === 'setup' ? READY_STATUS.SETUP : READY_STATUS.COMMIT
    removeReadyStatus(card, readyStatus)
  }
}

/** Clear turn-limited ability usage flags from a card */
export function clearTurnLimitedAbilities(card: Card): void {
  if (!card.statuses) return
  card.statuses = card.statuses.filter((s: CardStatus) => {
    if (s.type === TURN_LIMITED_ABILITIES.DEPLOY_USED) return false
    if (s.type === TURN_LIMITED_ABILITIES.SETUP_USED) return false
    if (s.type === TURN_LIMITED_ABILITIES.COMMIT_USED) return false
    return true
  })
}

/** Clear turn-limited ability usage from all cards on board for a player */
export function clearTurnLimitedAbilitiesForPlayer(gameState: GameState, playerId: number): void {
  for (const row of gameState.board) {
    for (const cell of row) {
      if (cell.card?.ownerId === playerId) {
        clearTurnLimitedAbilities(cell.card)
      }
    }
  }
}

// ============================================================================
// Deploy Ability Specific Functions
// ============================================================================

/**
 * Check if a card has used its deploy ability since entering the battlefield.
 * Deploy abilities are single-use - once used, they cannot be used again
 * unless the card leaves and returns to the battlefield.
 */
export function hasDeployAbilityUsed(card: Card): boolean {
  return card.statuses?.some((s: CardStatus) => s.type === TURN_LIMITED_ABILITIES.DEPLOY_USED) ?? false
}

/**
 * Mark that a card has used its deploy ability.
 * This removes the readyDeploy status and adds the deployUsedThisTurn marker.
 * The marker persists until the card leaves the battlefield.
 */
export function markDeployAbilityUsed(card: Card): void {
  if (!card.statuses) card.statuses = []

  // Add the usage marker
  if (!card.statuses.some((s: CardStatus) => s.type === TURN_LIMITED_ABILITIES.DEPLOY_USED)) {
    card.statuses.push({ type: TURN_LIMITED_ABILITIES.DEPLOY_USED, addedByPlayerId: card.ownerId || 0 })
  }

  // Remove the ready status
  removeReadyStatus(card, READY_STATUS.DEPLOY)
}

/**
 * Clear deploy ability usage marker.
 * This should be called when a card leaves the battlefield.
 * When the card returns, it can use deploy again.
 */
export function clearDeployAbilityUsage(card: Card): void {
  if (!card.statuses) return
  card.statuses = card.statuses.filter((s: CardStatus) => s.type !== TURN_LIMITED_ABILITIES.DEPLOY_USED)
}

// ============================================================================
// Conditions for Ready Statuses
// ============================================================================

/** Check if card is stunned */
export function isStunned(card: Card): boolean {
  return card.statuses?.some((s: CardStatus) => s.type === 'Stun') ?? false
}

/** Check if card has Support from its owner */
export function hasSupport(card: Card, playerId?: number): boolean {
  if (!card.statuses) return false
  return card.statuses.some((s: CardStatus) =>
    s.type === 'Support' &&
    (playerId === undefined || s.addedByPlayerId === playerId)
  )
}

/** Check if a card has a specific status (including playerId filter) */
export function hasStatus(card: Card, type: string, playerId?: number): boolean {
  if (!card.statuses) return false
  return card.statuses.some((s: CardStatus) =>
    s.type === type &&
    (playerId === undefined || s.addedByPlayerId === playerId)
  )
}

/** Check if card can activate abilities (not stunned, has support if needed) */
export function canCardActivate(
  card: Card,
  supportRequired: boolean,
  activePlayerId: number
): boolean {
  if (!card.ownerId || card.ownerId !== activePlayerId) return false
  if (isStunned(card)) return false
  if (supportRequired && !hasSupport(card, activePlayerId)) return false
  return true
}

// ============================================================================
// Core Ready Status Update Logic
// ============================================================================

/** Context for updating ready statuses */
export interface ReadyUpdateContext {
  gameState: GameState
  playerId?: number           // undefined = use activePlayerId
  cards?: Card[]             // specific cards to update (undefined = all on board)
}

/**
 * Ability type info for a card - provided by caller to avoid dependency on server module
 */
export interface CardAbilityInfo {
  hasDeployAbility: boolean
  hasSetupAbility: boolean
  hasCommitAbility: boolean
  deployRequiresSupport: boolean
  setupRequiresSupport: boolean
  commitRequiresSupport: boolean
}

/**
 * Update ready statuses for cards based on current game state.
 * This is the unified function that replaces resetReadyStatusesForTurn,
 * recalculateAllReadyStatuses, recheckReadyStatuses, etc.
 */
export function updateReadyStatuses(
  context: ReadyUpdateContext,
  // eslint-disable-next-line no-unused-vars
  getAbilityInfo: (card: Card) => CardAbilityInfo
): void {
  const { gameState, cards: specificCards } = context
  const activePlayerId = context.playerId ?? gameState.activePlayerId

  if (activePlayerId === undefined) {
    return // No active player, nothing to update
  }

  const currentPhase = gameState.currentPhase
  const cards = specificCards ?? getAllCardsOnBoard(gameState)

  for (const card of cards) {
    if (activePlayerId !== null) {
      updateCardReadyStatuses(card, activePlayerId, currentPhase, getAbilityInfo(card))
    }
  }
}

/**
 * Update ready statuses for a single card.
 * This determines what statuses SHOULD exist and syncs the card's statuses.
 *
 * IMPORTANT: Face-down cards on battlefield should NOT receive ready statuses.
 * They only get ready statuses when flipped face-up.
 */
export function updateCardReadyStatuses(
  card: Card,
  activePlayerId: number,
  currentPhase: number,
  abilityInfo: CardAbilityInfo
): void {
  if (!card.ownerId || !card.statuses) {
    card.statuses = card.statuses || []
    return
  }

  // Face-down cards on battlefield do not receive ready statuses
  // They will get ready statuses when flipped face-up
  if (card.isFaceDown) {
    // Remove any existing ready statuses from face-down cards
    syncCardStatuses(card, new Set()) // Empty set = remove all ready statuses
    return
  }

  const isActivePlayer = card.ownerId === activePlayerId

  // Determine what statuses this card SHOULD have
  const shouldHave: Set<ReadyStatusType> = new Set()

  if (isActivePlayer && !isStunned(card)) {
    // Check if activation conditions are met (Support, etc.)
    const canSetup = abilityInfo.hasSetupAbility && canCardActivate(
      card,
      abilityInfo.setupRequiresSupport,
      activePlayerId
    )
    const canCommit = abilityInfo.hasCommitAbility && canCardActivate(
      card,
      abilityInfo.commitRequiresSupport,
      activePlayerId
    )

    // Deploy: only if hasn't been used yet (checked via deployUsedThisTurn status)
    // Deploy ability is single-use - once used, cannot be used again unless card leaves battlefield
    // Deploy works in ANY phase
    const deployAlreadyUsed = hasDeployAbilityUsed(card)
    const canDeploy = abilityInfo.hasDeployAbility && canCardActivate(
      card,
      abilityInfo.deployRequiresSupport,
      activePlayerId
    )
    if (canDeploy && !deployAlreadyUsed) {
      shouldHave.add(READY_STATUS.DEPLOY)
    }

    // Setup: phase 1, only if hasn't been used this turn
    // Setup can coexist with Deploy - player chooses which to use
    if (canSetup && currentPhase === 1 && !hasUsedAbilityThisTurn(card, 'setup')) {
      shouldHave.add(READY_STATUS.SETUP)
    }

    // Commit: phase 3, only if hasn't been used this turn
    // Commit can coexist with Deploy - player chooses which to use
    if (canCommit && currentPhase === 3 && !hasUsedAbilityThisTurn(card, 'commit')) {
      shouldHave.add(READY_STATUS.COMMIT)
    }
  }

  // Sync statuses to match what should exist
  syncCardStatuses(card, shouldHave)
}

/** Sync card's statuses to match the target set */
function syncCardStatuses(card: Card, shouldHave: Set<ReadyStatusType>): void {
  if (!card.statuses) {
    card.statuses = []
  }

  const ownerId = card.ownerId ?? 0

  // Remove ready statuses that shouldn't exist
  card.statuses = card.statuses.filter((s: CardStatus) => {
    if (!isReadyStatus(s.type)) return true // Keep non-ready statuses
    return shouldHave.has(s.type as ReadyStatusType)
  })

  // Add missing ready statuses
  if (shouldHave.has(READY_STATUS.DEPLOY) && !hasReadyStatus(card, READY_STATUS.DEPLOY)) {
    card.statuses.push({ type: READY_STATUS.DEPLOY, addedByPlayerId: ownerId })
  }
  if (shouldHave.has(READY_STATUS.SETUP) && !hasReadyStatus(card, READY_STATUS.SETUP)) {
    card.statuses.push({ type: READY_STATUS.SETUP, addedByPlayerId: ownerId })
  }
  if (shouldHave.has(READY_STATUS.COMMIT) && !hasReadyStatus(card, READY_STATUS.COMMIT)) {
    card.statuses.push({ type: READY_STATUS.COMMIT, addedByPlayerId: ownerId })
  }
}

/** Get all cards on the board */
function getAllCardsOnBoard(gameState: GameState): Card[] {
  const cards: Card[] = []
  for (const row of gameState.board) {
    for (const cell of row) {
      if (cell.card) {
        cards.push(cell.card)
      }
    }
  }
  return cards
}

// ============================================================================
// Special Operations
// ============================================================================

/**
 * Initialize ready statuses when card enters battlefield.
 *
 * Logic:
 * - Deploy ability → gets readyDeploy only if Support requirement is met (if required)
 * - Setup ability → also gets readySetup if currently in Setup phase AND has Support if required
 * - Commit ability → also gets readyCommit if currently in Commit phase AND has Support if required
 *
 * Examples:
 * - Walking Turret (Deploy + Setup) enters in Setup phase → gets BOTH readyDeploy AND readySetup
 * - Walking Turret (Deploy + Setup) enters in Main phase → gets readyDeploy only
 * - Recon Drone (Setup + Commit) enters in Setup phase → gets readySetup only
 * - Recon Drone (Setup + Commit) enters in Commit phase → gets readyCommit only
 * - Inventive Maker (Deploy + Setup requires Support) → gets readySetup ONLY if has Support
 * - Immunis (Deploy requires Support) → gets readyDeploy ONLY if has Support
 */
export function initializeCardReadyStatuses(
  card: Card,
  ownerId: number,
  abilityInfo: CardAbilityInfo,
  currentPhase: number
): void {
  if (!card.statuses) card.statuses = []

  // Deploy ability - only if support requirement is met (if required)
  const canDeploy = abilityInfo.hasDeployAbility && canCardActivate(card, abilityInfo.deployRequiresSupport, ownerId)
  if (canDeploy) {
    addReadyStatus(card, READY_STATUS.DEPLOY, ownerId)
  }

  // Phase-specific abilities - only add if currently in that phase
  // AND support requirement is met (if support is required)
  const canSetup = abilityInfo.hasSetupAbility && canCardActivate(card, abilityInfo.setupRequiresSupport, ownerId)
  if (currentPhase === 1 && canSetup) {
    addReadyStatus(card, READY_STATUS.SETUP, ownerId)
  }

  const canCommit = abilityInfo.hasCommitAbility && canCardActivate(card, abilityInfo.commitRequiresSupport, ownerId)
  if (currentPhase === 3 && canCommit) {
    addReadyStatus(card, READY_STATUS.COMMIT, ownerId)
  }
}

/**
 * Skip Deploy ability - removes readyDeploy WITHOUT adding phase-specific status.
 * Call this when player explicitly skips Deploy (right-click cancel).
 */
export function skipDeployAbility(card: Card): void {
  removeReadyStatus(card, READY_STATUS.DEPLOY)
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get the ready status that should be used for a card in the current phase.
 *
 * Cards can have multiple ready statuses simultaneously (e.g., Deploy + Setup).
 * This function returns which one takes priority when clicking the card.
 *
 * Priority: Deploy > Setup (phase 1 or just played in phase 2) > Commit (phase 3)
 *
 * Example: Walking Turret in Setup phase with both readyDeploy and readySetup
 * → clicking activates Deploy ability first (priority), then can use Setup
 *
 * SPECIAL CASE: If a Setup ability card is played during Setup phase, it gets
 * readySetup status which persists into Main phase (2). This allows the player
 * to use the Setup ability immediately after playing the card.
 */
export function getReadyStatusForPhase(card: Card, phaseIndex: number): ReadyStatusType | null {
  // Scoring phase (4) - no abilities can be activated
  if (phaseIndex === 4) {
    return null
  }

  // Priority 1: Deploy in any phase except Scoring
  if (hasReadyStatus(card, READY_STATUS.DEPLOY)) {
    return READY_STATUS.DEPLOY
  }

  // Priority 2: Setup in Setup phase OR in Main phase if card was just played
  const hasSetup = hasReadyStatus(card, READY_STATUS.SETUP)
  const justPlayed = card.enteredThisTurn || hasStatus(card, 'LastPlayed')

  if (hasSetup && (phaseIndex === 1 || (phaseIndex === 2 && justPlayed))) {
    return READY_STATUS.SETUP
  }

  // Priority 3: Commit in Commit phase
  if (phaseIndex === 3 && hasReadyStatus(card, READY_STATUS.COMMIT)) {
    return READY_STATUS.COMMIT
  }

  return null
}

/**
 * Check if a card should show visual ready highlighting for the active player.
 */
export function shouldShowReadyHighlight(card: Card, activePlayerId: number | null): boolean {
  if (!activePlayerId || card.ownerId !== activePlayerId) {
    return false
  }
  return hasAnyReadyStatus(card)
}

/**
 * Get all available ready statuses for a card (for UI display).
 */
export function getAvailableReadyStatuses(card: Card): ReadyStatusType[] {
  const available: ReadyStatusType[] = []
  if (hasReadyStatus(card, READY_STATUS.DEPLOY)) available.push(READY_STATUS.DEPLOY)
  if (hasReadyStatus(card, READY_STATUS.SETUP)) available.push(READY_STATUS.SETUP)
  if (hasReadyStatus(card, READY_STATUS.COMMIT)) available.push(READY_STATUS.COMMIT)
  return available
}
