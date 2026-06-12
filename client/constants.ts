
/**
 * @file Defines constants and utility functions used across the application.
 */

import type { Card, PlayerColor } from './types'
import { DeckType, DeckType as DeckTypeEnum } from './types'
import { getCountersDatabase } from './content'

/**
 * The current version of the application.
 * This should match the version in package.json
 */
export const APP_VERSION = '0.2.11'

/**
 * The maximum number of players allowed in a game.
 */
export const MAX_PLAYERS = 4

/**
 * URLs for game-related icons and images.
 */
export const GAME_ICONS = {
  FIRST_PLAYER: 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365397/LastPlayed_ge4gyh.webp',
  ROUND_WIN_MEDAL: 'https://res.cloudinary.com/dxxh6meej/image/upload/v1771365397/medal_tavarc.webp',
} as const

/**
 * A mapping of deck types to their thematic properties, like color and ID prefix.
 */
export const DECK_THEMES: { [key in DeckType]: { prefix: string, color: string } } = {
  [DeckTypeEnum.SynchroTech]: { prefix: 'SYN', color: 'border-cyan-400' },
  [DeckTypeEnum.Hoods]: { prefix: 'HOO', color: 'border-purple-500' },
  [DeckTypeEnum.Optimates]: { prefix: 'OPT', color: 'border-red-500' },
  [DeckTypeEnum.Fusion]: { prefix: 'FUS', color: 'border-green-400' },
  [DeckTypeEnum.Command]: { prefix: 'CMD', color: 'border-yellow-500' },
  [DeckTypeEnum.Tokens]: { prefix: 'TKN', color: 'border-gray-400' },
  [DeckTypeEnum.Custom]: { prefix: 'CUS', color: 'border-purple-400' },
  [DeckTypeEnum.Neutral]: { prefix: 'NEU', color: 'border-gray-400' },
  [DeckTypeEnum.Random]: { prefix: 'RND', color: 'border-gray-400' },
}

/**
 * Defines the available player colors and their corresponding Tailwind CSS classes.
 * 'glow' provides an outer-glow box-shadow effect.
 */
export const PLAYER_COLORS: { [key in PlayerColor]: { bg: string, border: string, outline: string, glow: string } } = {
  blue: { bg: 'bg-blue-600', border: 'border-blue-600', outline: 'outline-blue-600', glow: 'shadow-[0_0_15px_#2563eb]' },
  purple: { bg: 'bg-purple-600', border: 'border-purple-600', outline: 'outline-purple-600', glow: 'shadow-[0_0_15px_#9333ea]' },
  red: { bg: 'bg-red-600', border: 'border-red-600', outline: 'outline-red-600', glow: 'shadow-[0_0_15px_#dc2626]' },
  green: { bg: 'bg-green-600', border: 'border-green-600', outline: 'outline-green-600', glow: 'shadow-[0_0_15px_#16a34a]' },
  yellow: { bg: 'bg-yellow-500', border: 'border-yellow-500', outline: 'outline-yellow-500', glow: 'shadow-[0_0_15px_#eab308]' },
  orange: { bg: 'bg-orange-500', border: 'border-orange-500', outline: 'outline-orange-500', glow: 'shadow-[0_0_15px_#f97316]' },
  pink: { bg: 'bg-pink-500', border: 'border-pink-500', outline: 'outline-pink-500', glow: 'shadow-[0_0_15px_#ec4899]' },
  brown: { bg: 'bg-[#8B4513]', border: 'border-[#8B4513]', outline: 'outline-[#8B4513]', glow: 'shadow-[0_0_15px_#8B4513]' },
  cyan: { bg: 'bg-cyan-400', border: 'border-cyan-400', outline: 'outline-cyan-400', glow: 'shadow-[0_0_15px_#22d3ee]' }, // Light blue for Neutral faction in Deck Builder
}

/**
 * RGB color values for player colors (used in gradients).
 */
export const PLAYER_COLOR_RGB: Record<PlayerColor, { r: number; g: number; b: number }> = {
  blue: { r: 37, g: 99, b: 235 },
  purple: { r: 147, g: 51, b: 234 },
  red: { r: 220, g: 38, b: 38 },
  green: { r: 22, g: 163, b: 74 },
  yellow: { r: 234, g: 179, b: 8 },
  orange: { r: 249, g: 115, b: 22 },
  pink: { r: 236, g: 72, b: 153 },
  brown: { r: 139, g: 69, b: 19 },
  cyan: { r: 34, g: 211, b: 238 },
}

/**
 * Text styling classes for floating text effects based on player color.
 */
export const FLOATING_TEXT_COLORS: Record<string, string> = {
  blue: 'text-blue-400 drop-shadow-[0_0_4px_rgba(59,130,246,0.8)]',
  purple: 'text-purple-400 drop-shadow-[0_0_4px_rgba(168,85,247,0.8)]',
  red: 'text-red-500 drop-shadow-[0_0_4px_rgba(239,68,68,0.8)]',
  green: 'text-green-400 drop-shadow-[0_0_4px_rgba(34,197,94,0.8)]',
  yellow: 'text-yellow-400 drop-shadow-[0_0_4px_rgba(234,179,8,0.8)]',
  orange: 'text-orange-400 drop-shadow-[0_0_4px_rgba(249,115,22,0.8)]',
  pink: 'text-pink-400 drop-shadow-[0_0_4px_rgba(236,72,153,0.8)]',
  brown: 'text-[#A0522D] drop-shadow-[0_0_4px_rgba(139,69,19,0.8)]',
  cyan: 'text-cyan-400 drop-shadow-[0_0_4px_rgba(34,211,238,0.8)]',
}

/**
 * Faction colors for power circles in DeckBuilderModal.
 * Maps faction names to PlayerColor values for consistent styling.
 */
export const FACTION_COLORS: Record<string, PlayerColor> = {
  SynchroTech: 'blue',    // cyan cards → blue power circles
  Hoods: 'purple',        // purple cards → purple power circles
  Optimates: 'red',       // red cards → red power circles
  Fusion: 'green',        // green cards → green power circles
  Neutral: 'cyan',        // gray cards → cyan (light blue) power circles
  Command: 'yellow',      // yellow command cards → yellow power circles
}

/**
 * An array of all available player color names in the specific UI order requested.
 * Note: 'cyan' is NOT included as it's for deck builder use only.
 */
export const PLAYER_COLOR_NAMES: PlayerColor[] = ['blue', 'purple', 'red', 'green', 'yellow', 'orange', 'pink', 'brown']

/**
 * Selectable player colors for the UI color picker (excludes cyan).
 */
export const SELECTABLE_PLAYER_COLORS: PlayerColor[] = ['blue', 'purple', 'red', 'green', 'yellow', 'orange', 'pink', 'brown']

/**
 * The sequence of phases in a player's turn.
 * Note: Phase 0 (Preparation) is hidden from UI and handles:
 *   - Round completion checks
 *   - Card status resets (readySetup, readyCommit)
 *   - Auto-draw if enabled
 *   - Auto-transition to Setup phase (1)
 *
 * Visible phases are 1-4: Setup, Main, Commit, Scoring
 */
export const TURN_PHASES = [
  'Setup',
  'Main',
  'Commit',
  'Scoring',
]

/**
 * Image URLs for status icons.
 * Returns icons from the counters database.
 * This function re-evaluates on every call to get fresh data.
 */
export const getStatusIcons = (): Record<string, string> => {
  const db = getCountersDatabase()
  const icons = Object.fromEntries(
    Object.entries(db).map(([key, def]) => [key, def.imageUrl]),
  )
  return icons
}

/**
 * Direct getter for a single status icon URL.
 * Use this for immediate access to fresh icon URLs.
 */
export const getStatusIconUrl = (type: string): string | undefined => {
  const db = getCountersDatabase()
  return db[type]?.imageUrl
}

/**
 * Reactive STATUS_ICONS - returns current state from counters database
 * This is a getter that always returns fresh data from the database
 */
export const STATUS_ICONS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop) {
    // Direct access via getter function - always fresh
    const db = getCountersDatabase()
    return db[prop as string]?.imageUrl
  },
  ownKeys() {
    return Object.keys(getCountersDatabase())
  },
  has(_target, prop) {
    return prop in getCountersDatabase()
  },
  getOwnPropertyDescriptor(_target, prop) {
    const db = getCountersDatabase()
    const value = db[prop as string]?.imageUrl
    return value !== undefined ? { enumerable: true, configurable: true, value } : undefined
  }
})

/**
 * Descriptions for various status effects and counters.
 * Returns descriptions from the counters database.
 */
export const getStatusDescriptions = (): Record<string, string> => {
  const db = getCountersDatabase()
  return Object.fromEntries(
    Object.entries(db).map(([key, def]) => [key, def.description]),
  )
}

/**
 * Reactive STATUS_DESCRIPTIONS - returns current state from counters database
 */
export const STATUS_DESCRIPTIONS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_target, prop) {
    const descriptions = getStatusDescriptions()
    return descriptions[prop as string]
  },
  ownKeys() {
    return Object.keys(getStatusDescriptions())
  },
  has(_target, prop) {
    return prop in getStatusDescriptions()
  },
  getOwnPropertyDescriptor(_target, prop) {
    const value = getStatusDescriptions()[prop as string]
    return value !== undefined ? { enumerable: true, configurable: true, value } : undefined
  }
})

/**
 * Available counters for the Counters Modal, sorted by sortOrder.
 * Filters counters to only show those allowed in the COUNTER_PANEL.
 * Excludes Resurrected - players cannot place it manually, only via card effects.
 * Excludes UsedThisTurn and ready statuses - these are system-managed.
 */
export const getAvailableCounters = () => {
  const db = getCountersDatabase()
  // System-managed statuses that should not appear in Remove Counters modal
  const systemStatuses = [
    'UsedThisTurn',           // Turn-limited usage tracking
    'deployUsedThisTurn',     // Deploy ability used this turn
    'setupUsedThisTurn',      // Setup ability used this turn (lowercase!)
    'commitUsedThisTurn',     // Commit ability used this turn (lowercase!)
    'readyDeploy',            // Deploy ready status
    'readySetup',             // Setup ready status
    'readyCommit',            // Commit ready status
  ]
  return Object.entries(db)
    .filter(([key, def]) =>
      key !== 'Resurrected' && // Exclude Resurrected token
      !systemStatuses.includes(key) && // Exclude system-managed statuses
      (!def.allowedPanels || def.allowedPanels.includes('COUNTER_PANEL'))
    )
    .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
    .map(([key, def]) => ({ type: key, label: def.name }))
}

/**
 * Backward compatible export - uses the function
 * NOTE: This is now a function to get fresh data after content loads
 */
export const AVAILABLE_COUNTERS = () => getAvailableCounters()

/**
 * An array of predefined counter items that can be placed on cards.
 */
export const COUNTERS: Card[] = [
  { id: 'CTR_BLUE', deck: 'counter', name: 'Blue Counter', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', color: 'bg-blue-500' },
  { id: 'CTR_PURPLE', deck: 'counter', name: 'Purple Counter', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', color: 'bg-purple-500' },
  { id: 'CTR_RED', deck: 'counter', name: 'Red Counter', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', color: 'bg-red-500' },
  { id: 'CTR_GREEN', deck: 'counter', name: 'Green Counter', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', color: 'bg-green-500' },
]

/**
 * A mapping of player IDs to their fixed positions on the screen.
 *
 * VU System - Dynamic sizing based on window height:
 * - Top positions: Header Height (~56px) + gap (~3px) = ~59px
 * - Bottom positions: gap (~3px) from bottom edge
 * - Corner positions: gap (~3px) from left/right edges
 *
 * All positions automatically scale with window height!
 */
export const PLAYER_POSITIONS: { [key: number]: string } = {
  1: 'top-vu-header-offset left-vu-corner',
  2: 'top-vu-header-offset right-vu-corner',
  3: 'bottom-vu-corner left-vu-corner',
  4: 'bottom-vu-corner right-vu-corner',
}
