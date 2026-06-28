/**
 * Client-side Ability Utilities
 *
 * This file now serves as a thin wrapper around the shared ready system.
 * Core ready status logic has been moved to shared/abilities/readySystem.ts
 * to eliminate duplication between client and server.
 *
 * Client-specific helper functions for UI are still here.
 */

import type { Card, GameState, AbilityAction } from '@/types'
import { logger } from './logger'
import type { CardAbilityInfo } from '@shared/abilities/index.js'

// Import unified ready system from shared - import for local use AND re-export
import {
  // Constants
  READY_STATUS,
  type ReadyStatusType,
  PHASE_SPECIFIC_STATUSES,
  TURN_LIMITED_ABILITIES,

  // Type guards
  isReadyStatus,

  // Ready status helpers
  hasReadyStatus,
  hasAnyReadyStatus,
  addReadyStatus,
  removeReadyStatus,
  removeAllReadyStatuses,
  removePhaseSpecificStatuses,

  // Condition checks
  isStunned,
  hasSupport,
  hasStatus,

  // Core update functions - import for local use
  updateReadyStatuses,
  updateCardReadyStatuses,
  initializeCardReadyStatuses,
  markDeployAbilityUsed,
  skipDeployAbility,

  // Query functions
  getReadyStatusForPhase,
  shouldShowReadyHighlight,
  getAvailableReadyStatuses,

  // Turn-limited ability tracking
  hasUsedAbilityThisTurn,
  markAbilityUsedThisTurn,
  clearTurnLimitedAbilities,
  clearTurnLimitedAbilitiesForPlayer,

  // Deploy ability specific tracking
  hasDeployAbilityUsed,
  clearDeployAbilityUsage,
} from '@shared/abilities/index.js'

// Re-export everything for external use
export {
  // Constants
  READY_STATUS,
  ReadyStatusType,
  PHASE_SPECIFIC_STATUSES,
  TURN_LIMITED_ABILITIES,

  // Type guards
  isReadyStatus,

  // Ready status helpers
  hasReadyStatus,
  hasAnyReadyStatus,
  addReadyStatus,
  removeReadyStatus,
  removeAllReadyStatuses,
  removePhaseSpecificStatuses,

  // Condition checks
  isStunned,
  hasSupport,
  hasStatus,

  // Core update functions
  updateReadyStatuses,
  updateCardReadyStatuses,
  initializeCardReadyStatuses,
  markDeployAbilityUsed,
  skipDeployAbility,

  // Query functions
  getReadyStatusForPhase,
  shouldShowReadyHighlight,
  getAvailableReadyStatuses,

  // Turn-limited ability tracking
  hasUsedAbilityThisTurn,
  markAbilityUsedThisTurn,
  clearTurnLimitedAbilities,
  clearTurnLimitedAbilitiesForPlayer,

  // Deploy ability specific tracking
  hasDeployAbilityUsed,
  clearDeployAbilityUsage,

  // Types
  CardAbilityInfo,
}

// Import getCardAbilityTypes from server (works via @server alias in Vite)
import { getCardAbilityTypes as serverGetCardAbilityTypes, getAbilitiesForCard, setClientGetCardAbilitiesProvider } from '@server/utils/autoAbilities'
import { getCardAbilities as clientGetCardAbilities, type ContentAbility } from '@/content'

// Set the client-side provider for getCardAbilities
setClientGetCardAbilitiesProvider((baseId: string): ContentAbility[] => {
  return clientGetCardAbilities(baseId)
})

// Re-export for convenience
export { serverGetCardAbilityTypes, getAbilitiesForCard }

/**
 * Get ability info for a card - provides data needed by shared ready system
 */
export function getCardAbilityInfo(card: Card): CardAbilityInfo {
  const abilityTypes = serverGetCardAbilityTypes(card as any)
  const hasDeployAbility = abilityTypes.includes('deploy')
  const hasSetupAbility = abilityTypes.includes('setup')
  const hasCommitAbility = abilityTypes.includes('commit')

  // Check if abilities require Support
  const abilities = getAbilitiesForCard(card as any)
  const deployAbility = abilities.find(a => a.activationType === 'deploy')
  const setupAbility = abilities.find(a => a.activationType === 'setup')
  const commitAbility = abilities.find(a => a.activationType === 'commit')

  return {
    hasDeployAbility,
    hasSetupAbility,
    hasCommitAbility,
    deployRequiresSupport: deployAbility?.supportRequired ?? false,
    setupRequiresSupport: setupAbility?.supportRequired ?? false,
    commitRequiresSupport: commitAbility?.supportRequired ?? false,
  }
}

/**
 * Check if card has specific ability type
 */
export function cardHasAbility(
  card: Card,
  abilityType: 'deploy' | 'setup' | 'commit'
): boolean {
  const abilityTypes = serverGetCardAbilityTypes(card as any)
  return abilityTypes.includes(abilityType)
}

// ============================================================================
// Client-Specific Helper Functions (for UI)
// ============================================================================

/**
 * Checks if a card has a ready status for visual display in the current phase.
 *
 * This is a simplified version - the visual effect is directly tied to the
 * presence of the ready status. All rules (owner, Stun, phase, Support) are
 * applied when adding/removing the status, not when checking for display.
 */
export const hasReadyStatusForPhase = (
  card: Card,
  phaseOrGameState: GameState | number
): boolean => {
  let phaseIndex: number
  if (typeof phaseOrGameState === 'object') {
    phaseIndex = phaseOrGameState.currentPhase
  } else {
    phaseIndex = phaseOrGameState
  }

  return getReadyStatusForPhase(card, phaseIndex) !== null
}

/**
 * Checks if a card should show visual ready highlighting AND can be activated.
 *
 * Ready highlights appear for the active player's cards only.
 * All players in the session can see these highlights (not just the local player).
 * Dummy player cards: show when it's dummy's turn, any player can activate.
 */
export const hasReadyAbilityInCurrentPhase = (
  card: Card,
  phaseOrGameState: GameState | number,
  activePlayerId?: number | null
): boolean => {
  // Handle both call styles:
  // - hasReadyAbilityInCurrentPhase(card, gameState)
  // - hasReadyAbilityInCurrentPhase(card, phaseIndex, activePlayerId)
  let phaseIndex: number
  if (typeof phaseOrGameState === 'object') {
    phaseIndex = phaseOrGameState.currentPhase
    activePlayerId = phaseOrGameState.activePlayerId ?? undefined
  } else {
    phaseIndex = phaseOrGameState
  }

  // Only show ready highlights for the active player's cards (whose turn it is)
  if (activePlayerId !== undefined && card.ownerId !== activePlayerId) {
    return false
  }

  return getReadyStatusForPhase(card, phaseIndex) !== null
}

/**
 * Recalculates ready statuses for ALL players' cards from local perspective.
 * This is called on the guest/client side when receiving state from the host.
 *
 * The key insight is that readySetup/readyCommit are LOCAL (calculated per-client),
 * while readyDeploy is SYNCHRONIZED (received from host).
 */
export function recalculateAllReadyStatuses(gameState: GameState): void {
  const activePlayerId = gameState.activePlayerId
  if (activePlayerId === undefined) {
    return
  }

  // Call updateReadyStatuses in ALL phases
  // - Phase 0 (Preparation): Set up ready statuses for new active player
  // - Phase 1 (Setup): Add readySetup, keep readyDeploy
  // - Phase 2 (Main): Add readyDeploy to newly played cards
  // - Phase 3 (Commit): Add readyCommit, keep readyDeploy
  // - Phase 4 (Scoring): No ready highlights shown (abilities cannot be activated)
  updateReadyStatuses({ gameState }, getCardAbilityInfo)
}

/**
 * Resets phase-specific ready statuses for ALL cards owned by a player.
 * This should be called at the start of each turn (Preparation phase).
 */
export function resetReadyStatusesForTurn(gameState: GameState, playerId: number): void {
  updateReadyStatuses({ gameState, playerId }, getCardAbilityInfo)
}

/**
 * Rechecks and updates ready statuses for a single card.
 * Called when conditions change: Stun added/removed, Support added/removed, etc.
 */
export function recheckReadyStatuses(card: Card, gameState: GameState): void {
  const activePlayerId = gameState.activePlayerId
  if (activePlayerId === undefined || activePlayerId === null) {
    return
  }

  const abilityInfo = getCardAbilityInfo(card)
  updateCardReadyStatuses(card, activePlayerId, gameState.currentPhase, abilityInfo)
}

/**
 * Rechecks ready statuses for all cards of a player.
 */
export function recheckAllReadyStatuses(gameState: GameState, playerId: number): void {
  updateReadyStatuses({ gameState, playerId }, getCardAbilityInfo)
}

/**
 * Initialize ready statuses when card enters battlefield.
 */
export function initializeReadyStatuses(card: Card, ownerId: number, currentPhase: number): void {
  const abilityInfo = getCardAbilityInfo(card)
  initializeCardReadyStatuses(card, ownerId, abilityInfo, currentPhase)
}

// ============================================================================
// Legacy Compatibility (deprecated functions, kept for migration)
// ============================================================================

/**
 * @deprecated Use initializeReadyStatuses instead
 */
export const initializeReadyStatuses_Deprecated = (card: Card, ownerId: number, currentPhase: number): void => {
  initializeReadyStatuses(card, ownerId, currentPhase)
}

/**
 * @deprecated Use updateReadyStatuses instead
 */
export const resetPhaseReadyStatuses = (_card: Card, _ownerId: number): void => {
  // This was used for single-card reset, now handled by updateReadyStatuses
}

// ============================================================================
// getCardAbilityAction - Client-side version for WebRTC P2P mode
// ============================================================================

/**
 * Get the ability action for a card in the current phase.
 * Client-side version of getCardAbilityAction for WebRTC P2P mode.
 *
 * Determines which ability to activate based on:
 * 1. Deploy abilities - ALWAYS FIRST PRIORITY (in ANY phase)
 * 2. Setup abilities - ONLY in Setup phase (phase 1) if Deploy not available
 * 3. Commit abilities - ONLY in Commit phase (phase 3) if Deploy not available
 */
export const getCardAbilityAction = (
  card: Card,
  gameState: GameState,
  localPlayerId: number | null,
  coords: { row: number; col: number }
): (AbilityAction & { supportRequired?: boolean }) | null => {
  // Ownership check
  if (localPlayerId !== card.ownerId) {
    // Check if the card belongs to a dummy player - if so, local player can control it
    if (card.ownerId !== undefined) {
      const cardOwner = gameState.players.find(p => p.id === card.ownerId)
      if (!cardOwner?.isDummy) {
        return null
      }
    } else {
      return null
    }
  }

  const abilities = getAbilitiesForCard(card as any)
  const phaseIndex = gameState.currentPhase
  const actorId = card.ownerId ?? localPlayerId ?? 0

  // Priority 1: Deploy ability (ALWAYS FIRST - in ANY phase)
  const deployAbility = abilities.find(a => a.activationType === 'deploy')
  if (deployAbility && hasReadyStatus(card, READY_STATUS.DEPLOY)) {
    if (deployAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
      return null
    }
    const action = deployAbility.getAction(card as any, gameState as any, actorId, coords)
    if (action) {
      return {
        ...action,
        isDeployAbility: true,
        readyStatusToRemove: READY_STATUS.DEPLOY,
        supportRequired: deployAbility.supportRequired
      }
    }
  }

  // Priority 2: Setup ability (ONLY in Setup phase / phase 1)
  if (phaseIndex === 1) {
    const setupAbility = abilities.find(a => a.activationType === 'setup')
    if (setupAbility && hasReadyStatus(card, READY_STATUS.SETUP)) {
      if (setupAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = setupAbility.getAction(card as any, gameState as any, actorId, coords)
      if (action) {
        return { ...action, readyStatusToRemove: READY_STATUS.SETUP, supportRequired: setupAbility.supportRequired }
      }
    }
  }

  // Priority 3: Commit ability (ONLY in Commit phase / phase 3)
  if (phaseIndex === 3) {
    const commitAbility = abilities.find(a => a.activationType === 'commit')
    if (commitAbility && hasReadyStatus(card, READY_STATUS.COMMIT)) {
      if (commitAbility.supportRequired && !hasStatus(card, 'Support', actorId)) {
        return null
      }
      const action = commitAbility.getAction(card as any, gameState as any, actorId, coords)
      if (action) {
        return { ...action, readyStatusToRemove: READY_STATUS.COMMIT, supportRequired: commitAbility.supportRequired }
      }
    }
  }

  return null
}

// ============================================================================
// canActivateAbility - Check if a card can activate an ability
// ============================================================================

/**
 * Check if a card can activate an ability in the current phase.
 *
 * Determines if a card has any usable ability based on:
 * 1. Ownership check (dummy player cards can be activated by anyone)
 * 2. Not stunned
 * 3. Has ready status for current phase
 * 4. Has Support if required
 *
 * Priority: Deploy (any phase) > Setup (phase 1) > Commit (phase 3)
 */
export const canActivateAbility = (
  card: Card,
  phaseIndex: number,
  activePlayerId: number | undefined,
  gameState?: GameState
): boolean => {
  // Ownership check: active player must own the card
  // Exception: dummy player cards can be activated by anyone
  if (gameState && card.ownerId !== undefined) {
    const cardOwner = gameState.players.find((p: any) => p.id === card.ownerId)
    // If card belongs to dummy player, skip the ownership check (anyone can activate)
    if (!cardOwner?.isDummy && activePlayerId !== card.ownerId) {
      return false
    }
  } else if (activePlayerId !== card.ownerId) {
    return false
  }

  if (card.statuses?.some((s: any) => s.type === 'Stun')) {
    return false
  }

  const abilities = getAbilitiesForCard(card as any)

  // Check if card has a phase-specific ability for current phase
  const hasPhaseSpecificAbility =
    (phaseIndex === 1 && abilities.some((a: any) => a.activationType === 'setup')) ||
    (phaseIndex === 3 && abilities.some((a: any) => a.activationType === 'commit'))

  // === 1. CHECK SETUP ABILITY (ONLY in Setup phase) ===
  if (phaseIndex === 1) {
    const setupAbility = abilities.find((a: any) => a.activationType === 'setup')
    if (setupAbility && hasReadyStatus(card, READY_STATUS.SETUP)) {
      if (setupAbility.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
        return false
      }
      return true
    }
  }

  // === 2. CHECK COMMIT ABILITY (ONLY in Commit phase) ===
  if (phaseIndex === 3) {
    const commitAbility = abilities.find((a: any) => a.activationType === 'commit')
    if (commitAbility && hasReadyStatus(card, READY_STATUS.COMMIT)) {
      if (commitAbility.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
        return false
      }
      return true
    }
  }

  // === 3. CHECK DEPLOY ABILITY (works in ANY phase if no phase-specific ability for this phase) ===
  // Deploy abilities can be used in any phase UNLESS the card has a phase-specific ability
  // for the current phase that should take priority
  if (!hasPhaseSpecificAbility) {
    const deployAbility = abilities.find((a: any) => a.activationType === 'deploy')
    if (deployAbility && hasReadyStatus(card, READY_STATUS.DEPLOY)) {
      if (deployAbility.supportRequired && !hasStatus(card, 'Support', activePlayerId)) {
        return false
      }
      return true
    }
  }

  return false
}

// ============================================================================
// Command Card Utilities
// ============================================================================

import { getCommandOptions as getCommandOptionsShared, isCommandCard as isCommandCardShared, getCommandActionByOption as getCommandActionByOptionShared, type ContentAbility } from '@shared/abilities/index.js'
import { getCardAbilities } from '@/content'

/**
 * Get command options for a command card from contentDatabase.
 * Returns array of { optionIndex, optionText } for display in modal.
 *
 * @param baseId - The baseId of the command card
 * @returns Array of command options or empty array if not a command card
 */
export function getCommandOptions(baseId: string): Array<{ optionIndex: number; optionText: string }> {
  return getCommandOptionsShared(baseId, getCardAbilities as (baseId: string) => ContentAbility[])
}

/**
 * Check if a card is a command card (has command abilities).
 *
 * @param baseId - The baseId of the card
 * @returns true if card has command abilities
 */
export function isCommandCard(baseId: string): boolean {
  return isCommandCardShared(baseId, getCardAbilities as (baseId: string) => ContentAbility[])
}

/**
 * Get command ability action by option index.
 *
 * @param baseId - The baseId of the command card
 * @param optionIndex - The selected option index (1-based)
 * @param card - The card object
 * @param gameState - Current game state
 * @param ownerId - The owner player ID
 * @param coords - Board coordinates (use {-1, -1} for commands from hand)
 * @returns AbilityAction or null if not found
 */
export function getCommandActionByOption(
  baseId: string,
  optionIndex: number,
  card: Card,
  gameState: GameState,
  ownerId: number,
  coords: { row: number; col: number }
): AbilityAction | null {
  return getCommandActionByOptionShared(
    baseId,
    optionIndex,
    card,
    gameState,
    ownerId,
    coords,
    getCardAbilities as (baseId: string) => ContentAbility[]
  )
}
