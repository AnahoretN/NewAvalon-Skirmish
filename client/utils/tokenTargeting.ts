/**
 * Universal Token Targeting System
 *
 * This module provides a unified system for token (counter) targeting rules.
 * All tokens follow the same validation logic based on their definition in countersDatabase.
 *
 * Key principles:
 * 1. Token validity is determined by countersDatabase.allowedTargets
 * 2. Targeting mode is synchronized across all players via gameState.targetingMode
 * 3. Visual feedback shows the token owner's color to all players
 */

import type { CursorStackState } from '@/types'
import { getCountersDatabase } from '@/content'

/**
 * Allowed target locations from countersDatabase
 */
export type TokenTargetLocation = 'board' | 'board-facedown' | 'hand' | 'deck' | 'discard' | 'announced'

/**
 * Token targeting rules derived from countersDatabase
 */
export interface TokenTargetingRules {
  allowedTargets: TokenTargetLocation[]  // Where this token can be placed
  allowHand: boolean                     // Can target cards in hand
  allowBoard: boolean                    // Can target cards on board
  allowBoardFaceDown: boolean            // Can target face-down cards on board
  allowDeck: boolean                     // Can target deck
  allowDiscard: boolean                  // Can target discard
}

/**
 * Get targeting rules for a token type from countersDatabase
 */
export function getTokenTargetingRules(tokenType: string): TokenTargetingRules {
  const counterDef = getCountersDatabase()[tokenType]
  const allowedTargets = counterDef?.allowedTargets || []

  return {
    allowedTargets,
    allowHand: allowedTargets.includes('hand'),
    allowBoard: allowedTargets.includes('board'),
    allowBoardFaceDown: allowedTargets.includes('board-facedown'),
    allowDeck: allowedTargets.includes('deck'),
    allowDiscard: allowedTargets.includes('discard'),
  }
}

/**
 * Create a cursorStack state with universal token targeting rules
 *
 * @param tokenType - The type of token (e.g., 'Aim', 'Revealed', 'Stun')
 * @param tokenOwnerId - The player ID who owns this token
 * @param existingStack - Optional existing cursorStack to add to
 * @param modifications - Optional modifications to default rules (from abilities)
 * @returns A CursorStackState with proper targeting constraints
 */
export function createTokenCursorStack(
  tokenType: string,
  tokenOwnerId: number,
  existingStack?: CursorStackState | null,
  modifications?: Partial<CursorStackState>
): CursorStackState {
  // Base cursorStack state
  const baseState: CursorStackState = {
    type: tokenType,
    count: existingStack ? existingStack.count + 1 : 1,
    isDragging: true,
    originalOwnerId: tokenOwnerId,
    // Preserve sourceCoords if incrementing existing stack
    sourceCoords: existingStack?.sourceCoords,
  }

  // Apply token-specific targeting rules
  const tokenRules: Partial<CursorStackState> = {}

  // For Revealed token: cannot place on own cards
  // Note: allowedTargets from countersDatabase controls where it can be placed
  if (tokenType === 'Revealed') {
    tokenRules.excludeOwnerId = tokenOwnerId
    // onlyFaceDown removed - can now target any opponent card
  }

  // For tokens that don't allow hand targeting, this is enforced via allowedTargets
  // in the validation function, not via cursorStack properties

  // Merge: base state < token rules < modifications < existing preserved props
  const result = {
    ...baseState,
    ...tokenRules,
    ...modifications,
    // Preserve these from existing stack if present (but modifications take precedence)
    ...(existingStack && {
      chainedAction: modifications?.chainedAction !== undefined ? modifications.chainedAction : existingStack.chainedAction,
      isDeployAbility: existingStack.isDeployAbility,
      readyStatusToRemove: existingStack.readyStatusToRemove,
    }),
  }

  return result
}

/**
 * Check if a token can target hand cards based on its rules
 */
export function canTokenTargetHand(tokenType: string): boolean {
  const rules = getTokenTargetingRules(tokenType)
  return rules.allowHand
}

/**
 * Check if a token can target board cards based on its rules
 */
export function canTokenTargetBoard(tokenType: string): boolean {
  const rules = getTokenTargetingRules(tokenType)
  return rules.allowBoard || rules.allowBoardFaceDown
}

/**
 * Get all token types that can target hand cards
 */
export function getHandTargetableTokenTypes(): string[] {
  return Object.entries(getCountersDatabase())
    .filter(([_, def]: [string, any]) => def.allowedTargets?.includes('hand'))
    .map(([type]) => type)
}

/**
 * Get all token types that can target board cards
 */
export function getBoardTargetableTokenTypes(): string[] {
  return Object.entries(getCountersDatabase())
    .filter(([_, def]: [string, any]) =>
      def.allowedTargets?.includes('board') || def.allowedTargets?.includes('board-facedown')
    )
    .map(([type]) => type)
}
