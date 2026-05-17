/**
 * Common utility functions shared across the application
 */

import type { PlayerColor } from '@/types'
import { PLAYER_COLOR_RGB } from '@/constants'

/**
 * Deep clone a GameState using structuredClone with fallback
 * Prefer structuredClone for better performance and type preservation
 * Note: Removes targetingMode before cloning as it may contain non-serializable functions
 */
export function deepCloneState<T>(state: T): T {
  // targetingMode may contain functions (e.g., action.payload.filter) that can't be cloned
  // We temporarily remove it, clone the state, then restore it
  const stateAny = state as any
  const targetingMode = stateAny?.targetingMode

  if (targetingMode) {
    // Temporarily remove targetingMode
    delete stateAny.targetingMode
  }

  let cloned: T
  if (typeof structuredClone !== 'undefined') {
    cloned = structuredClone(state)
  } else {
    cloned = JSON.parse(JSON.stringify(state)) as T
  }

  // Restore targetingMode after cloning
  if (targetingMode) {
    (cloned as any).targetingMode = targetingMode
    stateAny.targetingMode = targetingMode
  }

  return cloned
}

/**
 * Timing constants used throughout the application
 */
export const TIMING = {
  /** Delay before clearing ability mode after execution (ms) */
  MODE_CLEAR_DELAY: 25,
  /** Delay before tooltip appears (ms) */
  TOOLTIP_DELAY: 250,
  /** Delay before reconnect attempt (ms) */
  RECONNECT_DELAY: 3000,
  /** Delay before resending deck data to server (ms) */
  DECK_SYNC_DELAY: 500,
  /** Duration for floating text to remain visible (ms) */
  FLOATING_TEXT_DURATION: 10000,
  /** Delay before cleaning up inactive games (ms) */
  INACTIVITY_TIMEOUT: 300000,
  /** Delay before terminating empty game (ms) */
  GAME_CLEANUP_DELAY: 30000,
  /** Delay before converting disconnected player to dummy (ms) */
  PLAYER_DUMMY_DELAY: 120000,
  /** Duration for no-target overlay display (ms) */
  NO_TARGET_DURATION: 2000,
  /** Duration for highlight display (ms) */
  HIGHLIGHT_DURATION: 1000,
  /** Duration for copy success message (ms) */
  COPY_SUCCESS_DURATION: 1500,
  /** Duration for link copy success message (ms) */
  LINK_COPY_SUCCESS_DURATION: 2000,
  /** Fallback delay for drag end reset (ms) */
  DRAG_END_FALLBACK: 100,
  /** Short debounce delay for checks (ms) */
  DEBOUNCE_SHORT: 100,
} as const

/**
 * Game constants
 */
export const GAME = {
  /** Maximum number of players in a game */
  MAX_PLAYERS: 4,
  /** Grid sizes available */
  GRID_SIZES: [4, 5, 6, 7] as const,
  /** Phase indices */
  PHASE: {
    SETUP: 0,
    MAIN: 1,
    COMMIT: 2,
    SCORING: 3,
  } as const,
  /** Default grid size */
  DEFAULT_GRID_SIZE: 6,
} as const

export type GridSize = typeof GAME.GRID_SIZES[number]

/**
 * Color utility functions
 */

/** RGB color representation */
export interface RgbColor {
  r: number
  g: number
  b: number
}

/**
 * Calculates a brighter version of a color for glow effects.
 * Multiplies each RGB component by 1.3 and caps at 255.
 */
export function calculateGlowColor(rgb: RgbColor): RgbColor {
  return {
    r: Math.min(255, Math.round(rgb.r * 1.3)),
    g: Math.min(255, Math.round(rgb.g * 1.3)),
    b: Math.min(255, Math.round(rgb.b * 1.3)),
  }
}

/**
 * Creates a CSS rgba color string from RGB values and opacity.
 */
export function rgba(rgb: RgbColor, alpha: number): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

/**
 * Gets the RGB color for a player color with safe fallback.
 * Returns null if color is not provided.
 */
export function getPlayerColorRgb(color: PlayerColor | undefined | null): RgbColor | null {
  return color ? PLAYER_COLOR_RGB[color] : null
}

/**
 * Gets the RGB color for a player color with a default fallback.
 * Returns the provided default color if color is not provided.
 */
export function getPlayerColorRgbOrDefault(color: PlayerColor | undefined | null, defaultColor: RgbColor): RgbColor {
  return color ? PLAYER_COLOR_RGB[color] : defaultColor
}

/**
 * Creates the highlight style object for valid target effects.
 * Returns both boxShadow and background style properties.
 */
export function createHighlightStyle(rgb: RgbColor, opacity: number = 0.5): React.CSSProperties {
  const glow = calculateGlowColor(rgb)
  return {
    boxShadow: `0 0 12px 2px ${rgba(glow, opacity)}`,
    border: '3px solid rgb(255, 255, 255)',
  }
}

/**
 * Creates the background radial gradient for highlight overlays.
 */
export function createHighlightBackground(rgb: RgbColor, innerTransparency: number = 0.3, outerOpacity: number = 0.4): string {
  return `radial-gradient(circle at center, transparent ${innerTransparency * 100}%, ${rgba(rgb, outerOpacity)} 100%)`
}
