/**
 * Simple P2P Types
 *
 * Simplified P2P system with 2 message types:
 * 1. ACTION - from client to host (change request)
 * 2. STATE - from host to all clients (full state)
 */

import type { GameState, ScoringLineData } from '../types'

/**
 * Action that a player can perform
 */
export type ActionType =
  // Phase actions
  | 'NEXT_PHASE'
  | 'PREVIOUS_PHASE'
  | 'PASS_TURN'
  | 'SET_PHASE'

  // Card actions
  | 'PLAY_CARD'
  | 'PLAY_CARD_FROM_DECK'
  | 'PLAY_CARD_FROM_DISCARD'
  | 'MOVE_CARD'
  | 'MOVE_CARD_ON_BOARD'
  | 'SWAP_CARDS'
  | 'SPAWN_TOKEN'
  | 'RETURN_CARD_TO_HAND'
  | 'ANNOUNCE_CARD'
  | 'DESTROY_CARD'

  // Movement between zones
  | 'MOVE_CARD_TO_HAND'
  | 'MOVE_CARD_TO_DECK'
  | 'MOVE_CARD_TO_DISCARD'
  | 'MOVE_CARD_TO_BOARD'
  | 'MOVE_HAND_CARD_TO_DECK'
  | 'MOVE_HAND_CARD_TO_DISCARD'

  // Movement from showcase
  | 'MOVE_ANNOUNCED_TO_HAND'
  | 'MOVE_ANNOUNCED_TO_DECK'
  | 'MOVE_ANNOUNCED_TO_DISCARD'
  | 'PLAY_ANNOUNCED_TO_BOARD'

  // Deck control
  | 'DRAW_CARD'
  | 'DRAW_CARDS_BATCH'
  | 'SHUFFLE_DECK'
  | 'REQUEST_DECK_VIEW'

  // Score and status
  | 'UPDATE_SCORE'
  | 'CHANGE_PLAYER_NAME'
  | 'CHANGE_PLAYER_COLOR'
  | 'CHANGE_PLAYER_DECK'
  | 'LOAD_CUSTOM_DECK'

  // Scoring
  | 'START_SCORING'
  | 'SELECT_SCORING_LINE'
  | 'SCORE_DIAGONAL'

  // Round and match
  | 'COMPLETE_ROUND'
  | 'START_NEXT_ROUND'
  | 'START_NEW_MATCH'

  // Ready check
  | 'PLAYER_READY'

  // Mulligan
  | 'CONFIRM_MULLIGAN'
  | 'EXCHANGE_MULLIGAN_CARD'

  // Game reset
  | 'RESET_GAME'

  // Global actions
  | 'GLOBAL_AUTO_APPLY'
  | 'CLEANUP_COMMAND'  // Final step for command cards - discard from showcase to discard

  // Game settings
  | 'SET_GAME_MODE'
  | 'SET_GRID_SIZE'
  | 'SET_PRIVACY'
  | 'ASSIGN_TEAMS'
  | 'SET_DUMMY_PLAYER_COUNT'

  // Ability tracking
  | 'MARK_ABILITY_USED'
  | 'EXECUTE_ABILITY_CHAINED'  // Guest requests host to execute ability with chained action
  | 'REMOVE_ALL_COUNTERS_BY_TYPE'
  | 'REMOVE_COUNTER_BY_TYPE'  // Remove counter by type and owner (for Censor Commit)
  | 'REMOVE_COUNTERS_WITH_REWARD'  // Remove counters with draw/score reward (Inspiration)
  | 'MODIFY_CARD_POWER'

  // Status effects
  | 'ADD_STATUS_TO_BOARD_CARD'
  | 'ADD_STATUS_TO_HAND_CARD'
  | 'TRANSFER_ALL_STATUSES'  // Reckless Provocateur Commit

  // Token cards
  | 'PLAY_TOKEN_CARD'
  | 'PLAY_COMMAND_FROM_TOKEN_PANEL'  // Command card from token panel - goes to announced
  | 'PLAY_COMMAND_FROM_DECK'  // Command card from deck view - goes to announced
  | 'RESURRECT_DISCARDED'  // Immunis Deploy - return card from discard to board

  // Card orientation
  | 'FLIP_CARD'

  // Deck reordering
  | 'REORDER_CARDS'
  | 'REORDER_TOP_DECK'

  // Visual effects
  | 'CLICK_WAVE'

  // Host exit game
  | 'HOST_EXIT_GAME'

  // Special actions
  | 'TARGETING_MODE'
  | 'CLEAR_TARGETING_MODE'
  | 'EXIT_GAME'

/**
 * Message from client to host - action request
 */
export interface ActionMessage {
  type: 'ACTION'
  playerId: number
  action: ActionType
  data?: any
  timestamp: number
}

/**
 * Message from host to all clients - full state
 */
export interface StateMessage {
  type: 'STATE'
  version: number  // monotonic counter for message ordering
  state: PersonalizedState
  timestamp: number
}

/**
 * Personalized state for specific player
 * - For local player: full hand/deck/discard
 * - For others: only sizes (handSize, deckSize, discardSize)
 */
export interface PersonalizedState {
  // Common data (same for everyone)
  board: GameState['board']
  activeGridSize: GameState['activeGridSize']
  gameId: GameState['gameId']
  hostId: GameState['hostId']
  dummyPlayerCount: GameState['dummyPlayerCount']
  isGameStarted: GameState['isGameStarted']
  gameMode: GameState['gameMode']
  isPrivate: GameState['isPrivate']
  isReadyCheckActive: GameState['isReadyCheckActive']
  activePlayerId: GameState['activePlayerId']
  startingPlayerId: GameState['startingPlayerId']
  currentPhase: GameState['currentPhase']
  isScoringStep: GameState['isScoringStep']
  scoringLines: ScoringLineData[]  // Lines available for scoring
  preserveDeployAbilities: GameState['preserveDeployAbilities']
  autoAbilitiesEnabled: GameState['autoAbilitiesEnabled']
  autoDrawEnabled: GameState['autoDrawEnabled']
  currentRound: GameState['currentRound']
  turnNumber: GameState['turnNumber']
  roundEndTriggered: GameState['roundEndTriggered']
  roundWinners: GameState['roundWinners']
  gameWinner: GameState['gameWinner']
  isRoundEndModalOpen: GameState['isRoundEndModalOpen']
  floatingTexts: GameState['floatingTexts']
  highlights: GameState['highlights']
  deckSelections: GameState['deckSelections']
  handCardSelections: GameState['handCardSelections']
  targetingMode: GameState['targetingMode']
  abilityMode: GameState['abilityMode']
  clickWaves: GameState['clickWaves']
  visualEffects: GameState['visualEffects'] | Record<string, any>  // Allow plain object for PeerJS
  autoDrawnPlayers: GameState['autoDrawnPlayers']

  // Personalized player data
  players: PersonalizedPlayer[]
  spectators: GameState['spectators']
}

/**
 * Personalized player data
 */
export interface PersonalizedPlayer {
  id: number
  name: string
  score: number
  color: GameState['players'][0]['color']
  isDummy: GameState['players'][0]['isDummy']
  isDisconnected: GameState['players'][0]['isDisconnected']
  isReady: GameState['players'][0]['isReady']
  teamId: GameState['players'][0]['teamId']
  autoDrawEnabled: GameState['players'][0]['autoDrawEnabled']
  isSpectator: GameState['players'][0]['isSpectator']
  position: GameState['players'][0]['position']
  selectedDeck: GameState['players'][0]['selectedDeck']
  playerToken?: string  // Only for local player identification
  announcedCard?: GameState['players'][0]['announcedCard']  // Showcase visible to all
  lastPlayedCardId?: string | null  // Last played card (for scoring)

  // For local player: full data
  hand?: GameState['players'][0]['hand']
  deck?: GameState['players'][0]['deck']
  discard?: GameState['players'][0]['discard']
  boardHistory?: GameState['players'][0]['boardHistory']

  // For other players: placeholder hand cards (for Revealed token targeting) + sizes
  // Opponents' hands contain placeholder cards with minimal data (id, statuses) for targeting
  handSize?: number
  deckSize?: number
  discardSize?: number
}

/**
 * Visual effect (cell highlight)
 */
export interface HighlightMessage {
  type: 'HIGHLIGHT'
  data: {
    row: number
    col: number
    color: string
    duration?: number
    timestamp: number
  }
}

/**
 * Floating text
 */
export interface FloatingTextMessage {
  type: 'FLOATING_TEXT'
  data: {
    batch: Array<{
      text: string
      coords?: { row: number; col: number }
      color: string
      timestamp: number
    }>
  }
}

/**
 * Targeting mode
 */
export interface TargetingModeMessage {
  type: 'TARGETING_MODE'
  data: {
    targetingMode: any
  }
}

/**
 * Clear targeting mode
 */
export interface ClearTargetingModeMessage {
  type: 'CLEAR_TARGETING_MODE'
  data: {
    timestamp: number
  }
}

/**
 * No target overlay
 */
export interface NoTargetMessage {
  type: 'NO_TARGET'
  data: {
    coords: { row: number; col: number }
    timestamp: number
  }
}

/**
 * Deck selection
 */
export interface DeckSelectionMessage {
  type: 'DECK_SELECTION'
  data: {
    playerId: number
    selectedByPlayerId: number
    timestamp: number
  }
}

/**
 * Hand card selection
 */
export interface HandCardSelectionMessage {
  type: 'HAND_CARD_SELECTION'
  data: {
    playerId: number
    cardIndex: number
    selectedByPlayerId: number
    timestamp: number
  }
}

/**
 * Click wave
 */
export interface ClickWaveMessage {
  type: 'CLICK_WAVE'
  data: {
    timestamp: number
    location: 'board' | 'hand' | 'deck'
    boardCoords?: { row: number; col: number }
    handTarget?: { playerId: number; cardIndex: number }
    clickedByPlayerId: number
    playerColor: string
  }
}

/**
 * Reconnect rejected - sent by host when player cannot reconnect (converted to dummy)
 */
export interface ReconnectRejectedMessage {
  type: 'RECONNECT_REJECTED'
  reason: string
}

/**
 * Host ended game - sent by host when host exits the game
 */
export interface HostEndedGameMessage {
  type: 'HOST_ENDED_GAME'
  data: {
    reason: string
  }
}

/**
 * Join accept - sent by host to accept guest connection
 */
export interface JoinAcceptMessage {
  type: 'JOIN_ACCEPT'
  playerId: number
  state: PersonalizedState
  version?: number
}

/**
 * Incoming P2P message type
 */
export type P2PMessage =
  | ActionMessage
  | StateMessage
  | HighlightMessage
  | FloatingTextMessage
  | TargetingModeMessage
  | ClearTargetingModeMessage
  | NoTargetMessage
  | DeckSelectionMessage
  | HandCardSelectionMessage
  | ClickWaveMessage
  | JoinAcceptMessage
  | ReconnectRejectedMessage
  | HostEndedGameMessage

/**
 * SimpleHost configuration
 */
export interface SimpleHostConfig {
  onStateUpdate?: (state: PersonalizedState) => void
  onPlayerJoin?: (playerId: number) => void
  onPlayerLeave?: (playerId: number) => void
  onError?: (error: string) => void
  onHostEndedGame?: () => void
  // Visual effect callbacks (for host-local display)
  onClickWave?: (wave: {
    timestamp: number
    location: 'board' | 'hand' | 'deck'
    boardCoords?: { row: number; col: number }
    handTarget?: { playerId: number; cardIndex: number }
    clickedByPlayerId: number
    playerColor: string
  }) => void
  onFloatingTextBatch?: (events: Array<{ row: number; col: number; text: string; playerId: number }>) => void
  // Signalling server optimization
  disconnectFromSignallingOnGameStart?: boolean  // Default: true - disconnect from signalling server when game starts
  onSignallingDisconnected?: () => void  // Callback when host disconnects from signalling server
}

/**
 * SimpleGuest configuration
 */
export interface SimpleGuestConfig {
  localPlayerId: number
  onStateUpdate?: (state: PersonalizedState) => void
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (error: string) => void
  // Visual effect callbacks
  onHighlight?: (data: { row: number; col: number; color: string; duration?: number }) => void
  onFloatingText?: (batch: Array<{ text: string; coords?: { row: number; col: number }; color: string }>) => void
  onTargetingMode?: (targetingMode: any) => void
  onClearTargetingMode?: () => void
  onNoTarget?: (coords: { row: number; col: number }) => void
  onDeckSelection?: (playerId: number, selectedByPlayerId: number) => void
  onHandCardSelection?: (playerId: number, cardIndex: number, selectedByPlayerId: number) => void
  onClickWave?: (wave: {
    timestamp: number
    location: 'board' | 'hand' | 'deck'
    boardCoords?: { row: number; col: number }
    handTarget?: { playerId: number; cardIndex: number }
    clickedByPlayerId: number
    playerColor: string
  }) => void
  onReconnectRejected?: (reason: string) => void
  onHostEndedGame?: () => void
}
