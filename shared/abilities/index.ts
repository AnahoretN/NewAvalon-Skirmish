/**
 * Shared Abilities System
 *
 * Centralized ability definitions and utilities
 */

// ============================================================================
// New Unified Ready System
// ============================================================================

export {
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
  hasSupport,  // General status check with playerId filter
  hasStatus,  // General status check with playerId filter
  canCardActivate,  // Note: renamed to avoid conflict with server's canActivateAbility

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
  type CardAbilityInfo,
} from './readySystem.js'

// ============================================================================
// @deprecated Legacy Ready Status - use readySystem.js instead
// ============================================================================

/**
 * @deprecated Legacy ready status system. Use READY_STATUS from './readySystem.js' instead.
 *
 * Migration:
 * - READY_STATUS_DEPLOY -> READY_STATUS.DEPLOY
 * - READY_STATUS_SETUP -> READY_STATUS.SETUP
 * - READY_STATUS_COMMIT -> READY_STATUS.COMMIT
 */
export const READY_STATUS_DEPLOY = 'readyDeploy'
export const READY_STATUS_SETUP = 'readySetup'
export const READY_STATUS_COMMIT = 'readyCommit'

// Legacy re-exports (marked with _Legacy suffix where possible)
export {
  hasReadyStatusForPhase as hasReadyStatusForPhase_Legacy,
  hasReadyAbilityInCurrentPhase as hasReadyAbilityInCurrentPhase_Legacy,
  resetReadyStatusesForTurn as resetReadyStatusesForTurn_Legacy,
  getNextAbilityType,
  canActivateAbility as canActivateAbility_Legacy,  // Old version with different signature
  type Card,
} from './readyStatus.js'

// @deprecated Re-export of old functions for backward compatibility - use _Legacy versions or readySystem.js
export { canActivateAbility } from './readyStatus.js'
export { hasReadyStatusForPhase } from './readyStatus.js'
export { hasReadyAbilityInCurrentPhase } from './readyStatus.js'

// ============================================================================
// Ability Utils
// ============================================================================

export {
  checkAdj,
  type AbilityActivationType,
  type CardAbilityDefinition,
  type HandTargetFilter,
  createHandTargetFilter,
} from './abilityUtils.js'

// ============================================================================
// Content Abilities System
// ============================================================================

export {
  buildFilterFromString,
  buildDetailsFromContent,
  buildActionFromContentAbility,
  getCommandOptions,
  isCommandCard,
  getCommandActionByOption,
  type ContentAbility,
  type TriggerEventType,
} from './contentAbilities.js'

// ============================================================================
// Trigger System
// ============================================================================

export {
  getActiveTriggers,
  checkTriggersOnCardPlaced,
  type ActiveTrigger,
  type CardPlacedEvent,
  type TriggerResult,
} from './triggerSystem.js'
