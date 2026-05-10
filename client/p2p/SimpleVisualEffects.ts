/**
 * Visual Effects for SimpleP2P
 *
 * Simple broadcast system for visual effects in P2P mode
 * Works with SimpleHost to broadcast effects to all guests
 */

import type { SimpleHost } from './SimpleHost'
import type { HighlightData, FloatingTextData, TargetingModeData, AbilityAction } from '../types'

/**
 * Check if a value can be serialized by PeerJS
 * Only primitives, arrays, and plain objects are allowed
 */
function isSerializable(value: any): boolean {
  if (value === null || value === undefined) {
    return true
  }

  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return true
  }

  if (value instanceof Date) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every(isSerializable)
  }

  if (type === 'object') {
    // Check for functions
    for (const key in value) {
      if (typeof value[key] === 'function') {
        return false
      }
      if (!isSerializable(value[key])) {
        return false
      }
    }
    return true
  }

  return false
}

/**
 * Sanitize AbilityAction for PeerJS serialization
 * Removes sourceCard and other non-serializable properties
 */
function sanitizeAbilityAction(action: AbilityAction): any {
  const sanitized: any = {}

  // Copy only serializable properties
  for (const key in action) {
    const value = (action as any)[key]

    // Skip sourceCard - replace with baseId
    if (key === 'sourceCard' && value) {
      sanitized.sourceCardBaseId = value.baseId || value.id
      continue
    }

    // Skip non-serializable values (functions, etc.)
    if (typeof value === 'function') {
      continue
    }

    // Recursively sanitize chainedAction
    if (key === 'chainedAction' && value) {
      sanitized.chainedAction = sanitizeAbilityAction(value)
      continue
    }

    // Sanitize payload - keep serializable properties
    if (key === 'payload' && value) {
      if (isSerializable(value)) {
        // Payload is serializable, copy it directly
        sanitized.payload = value
        // Log important payload properties for debugging
        if (value.contextCardId || value.tokenType || value.count) {
        }
      } else {
        // Payload has non-serializable values, try to salvage what we can
        const salvagedPayload: any = {}
        for (const prop in value) {
          const propValue = value[prop]
          if (isSerializable(propValue)) {
            salvagedPayload[prop] = propValue
          }
        }
        if (Object.keys(salvagedPayload).length > 0) {
          sanitized.payload = salvagedPayload
        }
      }
      continue
    }

    sanitized[key] = value
  }

  return sanitized
}

/**
 * Deep sanitize any object for PeerJS serialization
 * Removes functions, circular references, and other non-serializable data
 */
function deepSanitize(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj
  }

  const type = typeof obj

  // Primitives are fine
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return obj
  }

  // Date objects - convert to timestamp
  if (obj instanceof Date) {
    return obj.getTime()
  }

  // Arrays - recursively sanitize
  if (Array.isArray(obj)) {
    return obj.map(deepSanitize).filter(item => item !== undefined)
  }

  // Objects - recursively sanitize properties
  if (type === 'object') {
    const sanitized: any = {}

    for (const key in obj) {
      // Skip functions
      if (typeof obj[key] === 'function') {
        continue
      }

      // Skip special React properties
      if (key === '_reactInternalFiber' || key === '_reactFiber') {
        continue
      }

      try {
        const value = deepSanitize(obj[key])
        if (value !== undefined) {
          sanitized[key] = value
        }
      } catch (e) {
        // Skip properties that cause errors during serialization
      }
    }

    return sanitized
  }

  // Skip everything else (functions, symbols, etc.)
  return undefined
}

/**
 * Visual effects broadcaster for P2P mode
 * Works with SimpleHost to broadcast effects to all guests
 */
export class SimpleVisualEffects {
  private host: SimpleHost

  constructor(host: SimpleHost) {
    this.host = host
  }

  /**
   * Broadcast highlight to all guests
   */
  broadcastHighlight(highlightData: HighlightData): void {
    this.host.broadcast({
      type: 'HIGHLIGHT',
      data: highlightData
    })
  }

  /**
   * Broadcast floating text to all guests
   */
  broadcastFloatingText(textData: FloatingTextData | FloatingTextData[]): void {
    const batch = Array.isArray(textData) ? textData : [textData]

    this.host.broadcast({
      type: 'FLOATING_TEXT',
      data: { batch }
    })
  }

  /**
   * Broadcast "no target" overlay
   */
  broadcastNoTarget(coords: { row: number; col: number }): void {
    this.host.broadcast({
      type: 'NO_TARGET',
      data: { coords, timestamp: Date.now() }
    })
  }

  /**
   * Set targeting mode for all guests
   */
  setTargetingMode(mode: TargetingModeData): void {
    // Sanitize the action to remove non-serializable properties like sourceCard
    const sanitizedAction = sanitizeAbilityAction(mode.action)

    // Create sanitized mode object
    const sanitizedMode: any = {
      playerId: mode.playerId,
      action: sanitizedAction,
      timestamp: mode.timestamp,
    }

    // Add optional properties if present
    if (mode.sourceCoords) {
      sanitizedMode.sourceCoords = mode.sourceCoords
    }
    if (mode.boardTargets) {
      sanitizedMode.boardTargets = mode.boardTargets
    }
    if (mode.handTargets) {
      sanitizedMode.handTargets = mode.handTargets
    }
    // CRITICAL: Include chainedAction for False Orders and other multi-step abilities
    // MUST be sanitized to preserve payload properties like contextCardId
    if (mode.chainedAction) {
      sanitizedMode.chainedAction = sanitizeAbilityAction(mode.chainedAction)
    }
    if (mode.isDeckSelectable !== undefined) {
      sanitizedMode.isDeckSelectable = mode.isDeckSelectable
    }
    if (mode.originalOwnerId !== undefined) {
      sanitizedMode.originalOwnerId = mode.originalOwnerId
    }
    if (mode.ownerId !== undefined) {
      sanitizedMode.ownerId = mode.ownerId
    }

    // Final deep sanitization to catch anything missed
    const finalMode = deepSanitize(sanitizedMode)

    this.host.broadcast({
      type: 'TARGETING_MODE',
      data: { targetingMode: finalMode }
    })
  }

  /**
   * Clear targeting mode
   */
  clearTargetingMode(): void {
    this.host.broadcast({
      type: 'CLEAR_TARGETING_MODE',
      data: { timestamp: Date.now() }
    })
  }

  /**
   * Broadcast deck selection
   */
  broadcastDeckSelection(playerId: number, selectedByPlayerId: number): void {
    this.host.broadcast({
      type: 'DECK_SELECTION',
      data: { playerId, selectedByPlayerId, timestamp: Date.now() }
    })
  }

  /**
   * Broadcast hand card selection
   */
  broadcastHandCardSelection(playerId: number, cardIndex: number, selectedByPlayerId: number): void {
    this.host.broadcast({
      type: 'HAND_CARD_SELECTION',
      data: { playerId, cardIndex, selectedByPlayerId, timestamp: Date.now() }
    })
  }

  /**
   * Broadcast click wave
   */
  broadcastClickWave(wave: {
    timestamp: number
    location: 'board' | 'hand' | 'deck'
    boardCoords?: { row: number; col: number }
    handTarget?: { playerId: number; cardIndex: number }
    clickedByPlayerId: number
    playerColor: string
  }): void {
    this.host.broadcast({
      type: 'CLICK_WAVE',
      data: wave
    })
  }
}
