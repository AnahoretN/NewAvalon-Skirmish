/**
 * Color Assigner
 *
 * Utility for assigning unique random colors to players.
 * Ensures no two players have the same color.
 */

import type { PlayerColor } from '../types'
import { SELECTABLE_PLAYER_COLORS } from '../constants'

/**
 * ColorAssigner class for managing unique color assignments
 */
export class ColorAssigner {
  private usedColors: Set<PlayerColor> = new Set()

  /**
   * Add a color as already used
   */
  markUsed(color: PlayerColor): void {
    this.usedColors.add(color)
  }

  /**
   * Check if a color is already used
   */
  isUsed(color: PlayerColor): boolean {
    return this.usedColors.has(color)
  }

  /**
   * Get all currently used colors
   */
  getUsedColors(): PlayerColor[] {
    return Array.from(this.usedColors)
  }

  /**
   * Get all available (unused) colors
   */
  getAvailableColors(): PlayerColor[] {
    return SELECTABLE_PLAYER_COLORS.filter(c => !this.usedColors.has(c))
  }

  /**
   * Get a random unused color
   * Returns null if all colors are used
   */
  getRandomColor(): PlayerColor | null {
    const available = this.getAvailableColors()
    if (available.length === 0) {
      return null
    }
    const randomIndex = Math.floor(Math.random() * available.length)
    const color = available[randomIndex]
    this.usedColors.add(color)
    return color
  }

  /**
   * Assign a random color for a new player
   * Guarantees uniqueness among already assigned colors
   */
  assignColor(): PlayerColor | null {
    return this.getRandomColor()
  }

  /**
   * Mark a color as available (e.g., when player is removed)
   */
  markAvailable(color: PlayerColor): void {
    this.usedColors.delete(color)
  }

  /**
   * Reset all used colors
   */
  reset(): void {
    this.usedColors.clear()
  }
}

/**
 * Helper function to get initial random color for host
 * Returns a random color from all available colors
 */
export function getRandomHostColor(): PlayerColor {
  const colors = SELECTABLE_PLAYER_COLORS
  const randomIndex = Math.floor(Math.random() * colors.length)
  return colors[randomIndex]
}

/**
 * Helper function to assign unique random color
 * Takes existing player colors and returns a new unique color
 */
export function assignUniqueRandomColor(existingColors: (PlayerColor | undefined)[]): PlayerColor {
  const used = new Set(existingColors.filter((c): c is PlayerColor => c !== undefined))

  // Get all available colors
  const available = SELECTABLE_PLAYER_COLORS.filter(c => !used.has(c))

  // If all colors are used, cycle back to first available
  // (shouldn't happen with MAX_PLAYERS=4 and 8 colors)
  if (available.length === 0) {
    return SELECTABLE_PLAYER_COLORS[0]
  }

  const randomIndex = Math.floor(Math.random() * available.length)
  return available[randomIndex]
}
