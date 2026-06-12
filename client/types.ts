/**
 * @file Defines the core data structures and types used throughout the application.
 */

/**
 * Enum representing the different playable deck factions.
 */
export enum DeckType {
  SynchroTech = 'SynchroTech',
  Hoods = 'Hoods',
  Optimates = 'Optimates',
  Fusion = 'Fusion',
  Command = 'Command',
  Tokens = 'Tokens',
  Custom = 'Custom',
  Neutral = 'Neutral',
  Random = 'Random',
}

/**
 * Enum for game modes.
 */
export enum GameMode {
  FreeForAll = 'FFA',
  TwoVTwo = '2v2',
  ThreeVOne = '3v1',
}

/**
 * Represents special, non-deck items like tokens or counters.
 */
export type SpecialItemType = 'counter';

/**
 * Defines the available player colors.
 */
export type PlayerColor = 'blue' | 'purple' | 'red' | 'green' | 'yellow' | 'orange' | 'pink' | 'brown' | 'cyan';

/**
 * Represents a single status effect applied to a card.
 */
export interface CardStatus {
  type: string;
  addedByPlayerId: number;
}

/**
 * Represents the definition of a counter/status in the database.
 */
export interface CounterDefinition {
    id: string;
    name: string; // Display name
    imageUrl: string;
    description: string;
    sortOrder: number;
    allowedPanels?: string[]; // Controls visibility in UI panels (e.g. 'COUNTER_PANEL')
    allowedTargets?: ('board' | 'board-facedown' | 'hand' | 'deck' | 'discard' | 'announced')[]; // Controls where this counter can be placed
}


/**
 * Represents a single card, token, or counter in the game.
 */
export interface Card {
  id: string;
  baseId?: string; // The ID key from the contentDatabase (e.g., 'riotAgent'). Used for localization.
  deck: DeckType | SpecialItemType;
  name: string;
  imageUrl: string; // The primary Cloudinary URL.
  fallbackImage?: string; // The local fallback image path (optional for placeholder cards).
  power: number;
  powerModifier?: number; // Adjustment to the base power.
  bonusPower?: number; // Temporary power bonus from passive effects (recalculated on board updates).
  abilityText: string;
  flavorText?: string;
  color?: string; // Used for counters or simple tokens to define their display color.
  ownerId?: number; // Player ID of the card's original owner.
  ownerName?: string; // Display name of the card's original owner.
  statuses?: CardStatus[]; // Status effects applied to the card on the board.
  isFaceDown?: boolean; // True if the card is played face-down on the board.
  revealedTo?: 'all' | number[]; // Defines who can see this card when it's in hand or face-down.
  types?: string[]; // The types associated with the card (e.g. ["Unit", "SynchroTech"], ["Command"]).
  faction?: string; // The faction this card belongs to (for deck building colors).
  allowedPanels?: string[]; // Controls visibility in UI panels (e.g. 'DECK_BUILDER', 'TOKEN_PANEL')
  enteredThisTurn?: boolean; // True if the card entered the battlefield during the current turn
  isPlaceholder?: boolean; // True if this is a placeholder card (for WebRTC optimization)
  // Deck building constraints
  cost?: number; // Cost value for deck building (default: 2)
  loyalty?: number; // Loyalty value for deck building (default: 2)
  discipline?: number; // Discipline value for deck building (default: 2)
  // For command cards: the selected option index (1-based) when player chooses an option
  selectedOption?: number;
  // ABILITIES array from contentDatabase.json (used for both units and command cards)
  ABILITIES?: any[];
}

/**
 * Represents a spectator in the game.
 */
export interface Spectator {
  id: string; // Unique spectator ID (UUID)
  name: string;
  connectedAt: number; // Timestamp when they joined as spectator
}

/**
 * Represents a player in the game.
 */
export interface Player {
  id: number;
  name: string;
  score: number;
  hand: Card[];
  deck: Card[];
  discard: Card[];
  announcedCard?: Card | null;
  selectedDeck: DeckType;
  color: PlayerColor;
  isDummy?: boolean; // True if this is a dummy player.
  isDisconnected?: boolean; // True if the player has disconnected but can rejoin.
  playerToken?: string; // A secret token for reconnecting to this player slot.
  isReady?: boolean; // For the pre-game ready check.
  hasMulliganed?: boolean; // True if player has confirmed their mulligan hand arrangement.
  mulliganAttempts?: number; // Number of mulligan card exchange attempts remaining (starts at 3).
  teamId?: number; // The team this player belongs to.
  boardHistory: string[]; // Stack of card IDs currently on the board, used to track 'LastPlayed' status fallback.
  lastPlayedCardId?: string | null; // The most recent card this player played from hand to board (for scoring phase).
  autoDrawEnabled?: boolean; // Whether this player has auto-draw enabled.
  isSpectator?: boolean; // True if this "player" is actually a spectator in the players array.
  disconnectTimestamp?: number; // Timestamp when player disconnected (for timeout tracking)
  reconnectionDeadline?: number; // Unix timestamp when reconnection window closes (30 seconds after disconnect)
  position?: number; // Position in turn order (0-based)
  // Size metadata for WebRTC optimized states
  handSize?: number; // Hand size (used when hand array is optimized out)
  deckSize?: number; // Deck size (used when deck array is optimized out)
  discardSize?: number; // Discard size (used when discard array is optimized out)
  customDeckName?: string; // Name of the custom deck if selected (for display in dropdown)
  hasLateness?: boolean; // True if player's non-command cards in hand are affected by lateness (when they have a new LastPlayed card on board)
}

/**
 * Represents a single cell on the game board.
 */
export interface Cell {
  card: Card | null;
}

/**
 * Represents the entire game board as a 2D array of cells.
 */
export type Board = Cell[][];

/**
 * Defines the possible sizes for the active grid on the game board.
 */
export type GridSize = 4 | 5 | 6 | 7;

/**
 * Represents a scoring line available during Scoring phase.
 */
export interface ScoringLineData {
  playerId: number; // The player who can score this line
  lineType: 'row' | 'col' | 'diagonal' | 'anti-diagonal';
  lineIndex?: number; // For row/col, the index; for diagonals, undefined
  score: number; // The calculated score for this line
}

/**
 * Represents a unique identifier for a card's location, whether on the board or in a hand.
 */
export type CardIdentifier = {
    source: 'hand' | 'board';
    ownerId: number;
    cardIndex?: number;
    boardCoords?: { row: number, col: number };
};

/**
 * Represents a request from one player to another to reveal one or more hidden cards.
 */
export interface RevealRequest {
    fromPlayerId: number;
    toPlayerId: number;
    cardIdentifiers: CardIdentifier[];
}

/**
 * Data structure for sharing board highlights between players.
 */
export interface HighlightData {
    type: 'row' | 'col' | 'cell';
    row?: number;
    col?: number;
    playerId: number;
    timestamp: number; // Ensures unique events for consecutive clicks
}

/**
 * Data structure for deck selection effects (visible to all players).
 */
export interface DeckSelectionData {
    playerId: number; // The player whose deck was selected
    selectedByPlayerId: number; // The player who made the selection (active player)
    timestamp: number;
}

/**
 * Data structure for hand card selection effects (visible to all players).
 */
export interface HandCardSelectionData {
    playerId: number; // The player whose hand card was selected
    cardIndex: number; // The index of the card in hand
    selectedByPlayerId: number; // The player who made the selection (active player)
    timestamp: number;
}

/**
 * Data structure for floating text effects (e.g. damage, score).
 */
export interface FloatingTextData {
    id?: string; // Added locally for keying
    row: number;
    col: number;
    text: string;
    playerId: number; // The player associated with the effect (determines color)
    timestamp: number;
}

/**
 * Represents the complete state of the game at any given moment.
 */
export interface GameState {
  players: Player[];
  spectators: Spectator[]; // List of spectators watching the game
  board: Board;
  activeGridSize: GridSize;
  gameId: string | null;
  hostId: number; // Player ID of the current host (can transfer on disconnect)
  dummyPlayerCount: number;
  isGameStarted: boolean;
  gameMode: GameMode;
  isPrivate: boolean;
  isReadyCheckActive: boolean;
  isMulliganActive: boolean; // True when mulligan/reorder initial hand is available
  mulliganCompletePlayers: number[]; // Player IDs who have confirmed their mulligan
  revealRequests: RevealRequest[];
  activePlayerId: number | null; // Aligned with server: null when no active player
  startingPlayerId: number | null; // The ID of the player who started the game (Turn 1 Player 1)
  currentPhase: number; // 0 (hidden Preparation phase), 1-4 representing phases (Setup=1, Main=2, Commit=3, Scoring=4)
  isScoringStep: boolean; // True when waiting for the active player to score a line after Commit phase
  scoringLines: ScoringLineData[]; // Lines available for scoring during Scoring phase

  // Auto-abilities settings
  preserveDeployAbilities: boolean; // If true, deploy abilities remain available after auto-transition to Main
  autoAbilitiesEnabled: boolean; // Server-side flag for auto-abilities
  autoDrawEnabled: boolean; // Server-side flag for auto-draw
  strictRulesEnabled: boolean; // If true, lateness effect is enabled (non-command cards in hand become unplayable after playing a card to board)
  startingHeroEnabled: boolean; // If true, first card of starting hand must be a Hero type card

  // Round Logic
  currentRound: number; // 1, 2, or 3
  turnNumber: number; // Counts total full orbits (circles)
  roundEndTriggered: boolean; // True if someone hit the score threshold
  roundWinners: Record<number, number[]>; // Map of Round Number -> Winner Player IDs
  gameWinner: number | null; // Player ID if game is over
  isRoundEndModalOpen: boolean; // Controls visibility of inter-round modal

  // Visual effects (synced across all clients)
  floatingTexts: FloatingTextData[]; // Array of floating texts to display
  highlights: HighlightData[]; // Array of cell highlights to display
  deckSelections: DeckSelectionData[]; // Array of deck selection effects to display
  handCardSelections: HandCardSelectionData[]; // Array of hand card selection effects to display
  // Split targeting mode for simpler race condition handling
  localTargetingMode: TargetingModeData | null; // Only for local player's actions
  remoteTargetingMode: TargetingModeData | null; // Only for visualizing other players' actions
  // Legacy targetingMode (deprecated, kept for backward compatibility during migration)
  targetingMode?: TargetingModeData | null;
  abilityMode?: AbilityAction; // Active ability mode (for P2P visual sync) - extends AbilityAction with sourceCard, sourceCoords, etc.
  clickWaves?: ClickWave[]; // Array of click wave effects
  // NEW: ID-based effects system (replaces old arrays)
  visualEffects?: VisualEffectsState; // Map of effect ID -> effect data

  // Server-side auto-draw tracking for Setup phase
  autoDrawnPlayers?: number[]; // Player IDs who have already auto-drawn this Setup phase

  // Local spectator state (not synced with server)
  localPlayerId: number | null; // The player ID of the local client (null if spectator)
  isSpectator: boolean; // True if the local client is a spectator

  // Game Log System
  gameLogs: GameLogEntry[]; // Array of all game actions performed
  gameLogIndex?: number; // Current position in log history (for rewind/forward)
}

/**
 * Defines the data structure for an item being dragged.
 */
export interface DragItem {
  card: Card;
  source: 'hand' | 'board' | 'discard' | 'token_panel' | 'counter_panel' | 'deck' | 'announced';
  playerId?: number; // The ID of the player who owns the source location (hand, deck, etc.).
  ownerId?: number; // The ID of the player who should be credited as the actor (for status/counter ownership)
  boardCoords?: { row: number; col: number }; // Original coordinates if dragged from the board.
  cardIndex?: number; // Original index if dragged from an array (hand, discard, deck).
  statusType?: string; // For counters: the type of status (e.g., 'Aim', 'Power+')
  replaceStatusType?: string; // For counters: the type of status to replace (e.g., 'Exploit' -> 'Stun' for Censor)
  count?: number; // For counters: how many are being dragged/applied
  bypassOwnershipCheck?: boolean; // If true, allows moving cards owned by others (e.g. Destroy effects)
  isManual?: boolean; // True if the drag was initiated manually by the user (vs an ability effect)
  clearLatenessOnNextPlay?: boolean; // If true, the next played card will clear hasLateness instead of setting it (for Quick Response Team option 1)
}

/**
 * Defines the data structure for a potential drop location.
 */
export interface DropTarget {
    target: 'hand' | 'board' | 'deck' | 'discard' | 'announced';
    playerId?: number; // The ID of the player who owns the target location.
    boardCoords?: { row: number; col: number }; // Target coordinates if dropping on the board.
    deckPosition?: 'top' | 'bottom'; // Target position if dropping on a deck.
    cardIndex?: number; // Target index if dropping on a specific card in a list (e.g. hand).
    chainedAction?: AbilityAction; // For False Orders: enriched chainedAction with contextCardId
}

/**
 * Represents a card entry in a custom deck file.
 */
export interface CustomDeckCard {
  cardId: string;
  quantity: number;
}

/**
 * Represents the structure of a saved custom deck file.
 */
export interface CustomDeckFile {
  deckName: string;
  cards: CustomDeckCard[];
}

/**
 * Defines the types of items that can appear in a context menu.
 */
export type ContextMenuItem =
  // A standard clickable button item.
  | { label: string; onClick: () => void; disabled?: boolean; isBold?: boolean }
  // A visual separator line.
  | { isDivider: true }
  // A special control for incrementing/decrementing a status.
  | {
      type: 'statusControl';
      label: string;
      onAdd: () => void;
      onRemove: () => void;
      removeDisabled?: boolean;
    };

/**
 * Defines the parameters required to open a context menu.
 */
export type ContextMenuParams = {
  x: number;
  y: number;
  type: 'boardItem' | 'handCard' | 'discardCard' | 'deckPile' | 'discardPile' | 'token_panel_item' | 'deckCard' | 'announcedCard' | 'emptyBoardCell';
  data: any; // Context-specific data (e.g. card, player, coordinates)
}

/**
 * Represents the state of a cursor dragging or placing a stack of counters.
 */
export interface CursorStackState {
    type: string;
    count: number;
    isDragging: boolean;
    sourceCoords?: {row: number, col: number}; // Origin for ability tracking
    sourceCard?: Card; // Source card that created this stack (important for actorId validation)
    targetOwnerId?: number; // Optional restriction for 'Revealed' token usage (Recon Drone) - Inclusive
    excludeOwnerId?: number | 'source'; // Optional restriction - Exclusive (e.g. Vigilant Spotter: Don't reveal self)
    onlyOpponents?: boolean; // Optional restriction - Exclusive (Don't reveal self OR teammates)
    onlyFaceDown?: boolean; // Optional restriction - Only cards that are currently hidden (Face down or unrevealed hand)
    targetType?: string; // Optional: Restrict target by card Type (e.g., "Unit")
    isDeployAbility?: boolean; // True if the stack was created by a Deploy ability (for correct consumption tracking)
    readyStatusToRemove?: string; // The ready status to remove when this action is executed
    requiredTargetStatus?: string; // Optional: target must have this status to be valid
    requireStatusFromSourceOwner?: boolean; // Optional: target status must be added by the player executing the ability
    mustBeAdjacentToSource?: boolean; // Optional: target must be adjacent to sourceCoords
    mustBeInLineWithSource?: boolean; // Optional: target must be in line with sourceCoords
    maxDistanceFromSource?: number; // Maximum Chebyshev distance from source (e.g., 2 = within 2 cells including diagonals)
    maxOrthogonalDistance?: number; // Maximum Manhattan/orthogonal distance from source (walking distance)
    placeAllAtOnce?: boolean; // Optional: if true, placing the stack puts ALL counters on one target instead of one by one
    range?: number; // Optional: targeting range for ability (e.g., 2 = within 2 cells)
    chainedAction?: AbilityAction; // Optional: Action to enter immediately after the stack is depleted
    recordContext?: boolean; // Optional: If true, saves the target to CommandContext
    replaceStatus?: boolean; // If true, replace the requiredTargetStatus with type (e.g., Censor: Exploit -> Stun)
    originalOwnerId?: number; // The owner of the card that initiated the action (for multi-step commands)
    _autoStepsContext?: any; // AUTO_STEPS context for continuing multi-step abilities after cursorStack completes (e.g., Centurion Commit)
}

/**
 * Context data stored between steps of a multi-step command.
 */
export interface CommandContext {
    lastMovedCardCoords?: { row: number, col: number };
    lastMovedCardId?: string; // To track power of moved card
    _sourceCoordsBeforeMove?: { row: number, col: number }; // Track where card WAS before move (for Tactical Maneuver rewards)
    sourceOwnerId?: number; // Owner of the ability source (e.g., Centurion's owner for BUFF_LINES_FROM_CONTEXT)
    selectedHandCard?: { playerId: number, cardIndex: number }; // For Quick Response Team
    pendingCommandCard?: { sourceCoords: { row: number; col: number }; isDeployAbility?: boolean; readyStatusToRemove?: string }; // For Quick Response Team - marks command as used when play completes
    clearLatenessOnNextPlay?: boolean; // When true, the next card played from hand will clear hasLateness instead of setting it (for Quick Response Team option 1)
    lastPlacedToken?: {
        boardCoords: { row: number; col: number };
        cardId: string;
        tokenType: string;
        addedByPlayerId: number;
    }; // For Data Interception, Overwatch - tracks token placement for dynamic count calculations
}

/**
 * Data passed to the Counter Selection Modal (Inspiration).
 */
export interface CounterSelectionData {
    card: Card;
    callbackAction: 'DRAW_REMOVED' | 'SCORE_REMOVED';
    coords?: {row: number, col: number};
    counterTypes?: string[];
    sourceCoords?: {row: number, col: number};
    isDeployAbility?: boolean;
    readyStatusToRemove?: string[];
    // AUTO_STEPS context for continuing to cleanup step after modal confirmation
    autoStepsContext?: {
      steps: any[];
      currentStepIndex: number;
      abilityAction: AbilityAction;
    };
}

/**
 * Represents a structured action for the auto-ability system.
 */
export type AbilityAction = {
    type: 'CREATE_STACK' | 'ENTER_MODE' | 'OPEN_MODAL' | 'GLOBAL_AUTO_APPLY' | 'ABILITY_COMPLETE' | 'REVEREND_SETUP_SCORE' | 'MODIFY_SCORE' | 'CONTINUE_AUTO_STEPS';
    mode?: string;
    tokenType?: string;
    count?: number;
    dynamicCount?: { factor: string; ownerId: number | 'source' }; // For dynamic stack counts (e.g. Overwatch Reveal)
    onlyFaceDown?: boolean;
    onlyOpponents?: boolean;
    onlyAllies?: boolean; // Optional restriction - Only self OR teammates (Signal Prophet)
    targetOwnerId?: number | 'source';
    excludeOwnerId?: number | 'source';
    targetType?: string; // Optional: Restrict target by card Type
    sourceCard?: Card;
    sourceCoords?: { row: number; col: number };
    payload?: any;
    isDeployAbility?: boolean;
    recordContext?: boolean; // If true, the result of this action (e.g. move destination) is saved
    contextCheck?: 'ADJACENT_TO_LAST_MOVE'; // If set, validates targets based on saved context
    requiredTargetStatus?: string;
    requireStatusFromSourceOwner?: boolean; // Optional: target status must be added by the player executing the ability
    mustBeAdjacentToSource?: boolean;
    mustBeInLineWithSource?: boolean;
    maxDistanceFromSource?: number; // Maximum Chebyshev distance from source (e.g., 2 = within 2 cells including diagonals)
    maxOrthogonalDistance?: number; // Maximum Manhattan/orthogonal distance from source (walking distance)
    placeAllAtOnce?: boolean;
    chainedAction?: AbilityAction;
    readyStatusToRemove?: string; // The ready status to remove when this action is executed/cancelled/has no targets
    allowHandTargets?: boolean; // If true, allows targeting cards in player's hand
    handOnly?: boolean; // If true, ONLY target cards in hand, not on board (e.g., IP Dept Agent Commit)
    targetLocation?: 'hand' | 'board'; // Specifies target location for abilities (e.g., Vigilant Spotter targets hand cards)
    replaceStatus?: boolean; // If true, replace the requiredTargetStatus with tokenType (e.g., Censor: Exploit -> Stun)
    originalOwnerId?: number; // The owner of the card that initiated this action (for multi-step commands like Data Interception)
    _sourceOwnerId?: number; // Internal: Owner ID of the card that was targeted/moved (used for resolving targetOwnerId: -2)
    skipChainedActionOnNoTargets?: boolean; // If true, chained action won't execute when no valid targets exist (e.g., Recon Drone Commit)
    supportRequired?: boolean; // If true, requires source card to have Support status (e.g., Inventive Maker Setup)
};

/**
 * Targeting mode data - shared across all clients for synchronized targeting UI
 * When a player activates an ability/command that requires targeting, this data is broadcast
 * so all players can see the valid targets highlighted in the activating player's color.
 */
export interface TargetingModeData {
    playerId: number; // The player whose turn it is to select a target (owner of this targeting mode)
    action: AbilityAction; // The action defining targeting constraints (includes chainedAction for multi-step abilities)
    sourceCoords?: { row: number; col: number }; // Source card coordinates (if applicable)
    timestamp: number; // For uniqueness and timeout
    boardTargets?: {row: number, col: number}[]; // Valid board targets (pre-calculated)
    handTargets?: { playerId: number, cardIndex: number }[]; // Valid hand targets (pre-calculated)
    isDeckSelectable?: boolean; // Whether deck is a valid target
    originalOwnerId?: number; // The owner of the card that initiated this action (for correct highlight color)
    ownerId: number; // The player who created this targeting mode (for preventing remote overwrites)
    // Convenience accessor for chainedAction (also available via action.chainedAction)
    chainedAction?: AbilityAction; // Action to execute after this targeting mode completes (e.g., draw/score rewards for Tactical Maneuver)
}

/**
 * Click wave effect - visual feedback when a player clicks on a card or cell
 * Shows a colored ripple animation at the clicked location
 * @deprecated Use ID-based Effect system instead
 */
export interface ClickWave {
    timestamp: number; // When the click occurred
    location: 'board' | 'hand' | 'emptyCell'; // Where the click occurred
    boardCoords?: { row: number; col: number }; // For board/cell targets
    handTarget?: { playerId: number; cardIndex: number }; // For hand card targets
    clickedByPlayerId: number; // The player who clicked
    playerColor: PlayerColor; // The color of the clicking player
}

// ============================================================================
// ID-BASED VISUAL EFFECTS SYSTEM (NEW)
// ============================================================================

/**
 * Visual effect types for ID-based synchronization
 */
export type VisualEffectType =
  | 'highlight'      // Row/column/cell highlight
  | 'floatingText'   // Floating text (damage, score, etc.)
  | 'noTarget'       // Red X overlay for invalid target
  | 'clickWave'      // Colored ripple on click
  | 'targetingMode'  // Ability targeting mode

/**
 * Base interface for ID-based visual effects
 */
export interface BaseVisualEffect {
  id: string              // 5-character unique ID
  type: VisualEffectType  // Effect type
  playerId: number        // Player who created the effect (determines color)
  createdAt: number       // Timestamp when created
  expiresAt?: number      // Auto-remove timestamp (optional)
}

/**
 * Highlight effect (row/col/cell) with ID
 */
export interface HighlightEffect extends BaseVisualEffect {
  type: 'highlight'
  highlightType: 'row' | 'col' | 'cell'
  row?: number            // Row index (for row/cell highlights)
  col?: number            // Column index (for col/cell highlights)
}

/**
 * Floating text effect with ID
 */
export interface FloatingTextEffect extends BaseVisualEffect {
  type: 'floatingText'
  row: number             // Board row position
  col: number             // Board column position
  text: string            // Text to display (e.g., "+3", "-2")
  color?: string          // Custom color (overrides player color)
}

/**
 * No-target overlay effect with ID
 */
export interface NoTargetEffect extends BaseVisualEffect {
  type: 'noTarget'
  row: number             // Board row position
  col: number             // Board column position
}

/**
 * Click wave effect with ID
 */
export interface ClickWaveEffect extends BaseVisualEffect {
  type: 'clickWave'
  location: 'board' | 'hand' | 'emptyCell'
  row?: number            // Board row (if applicable)
  col?: number            // Board column (if applicable)
  handPlayerId?: number   // Player whose hand was clicked
  handCardIndex?: number  // Card index in hand
}

/**
 * Targeting mode effect with ID
 */
export interface TargetingModeEffect extends BaseVisualEffect {
  type: 'targetingMode'
  mode: string            // Ability mode (e.g., 'SELECT_TARGET', 'RIOT_PUSH')
  sourceRow?: number      // Source card row
  sourceCol?: number      // Source card column
  boardTargets: string[]  // Array of "row,col" strings for valid targets
  handTargets: string[]   // Array of "playerId,cardIndex" strings
  isDeckSelectable: boolean
}

/**
 * Union type of all ID-based effects
 */
export type VisualEffect =
  | HighlightEffect
  | FloatingTextEffect
  | NoTargetEffect
  | ClickWaveEffect
  | TargetingModeEffect

/**
 * Visual effects state in game state
 * Maps effect IDs to effect objects
 */
export type VisualEffectsState = Map<string, VisualEffect>

/**
 * Compact state delta for WebRTC synchronization
 * Only contains the changes that happened, not the full state
 */
export interface StateDelta {
  // Player-specific changes (by playerId)
  playerDeltas?: Record<number, PlayerDelta>;

  // Board changes
  boardCells?: BoardCellDelta[]; // Changed cells on the board

  // Game-wide changes
  phaseDelta?: {
    currentPhase?: number;
    isScoringStep?: boolean;
    activePlayerId?: number | null;
    startingPlayerId?: number | null;
  };

  roundDelta?: {
    currentRound?: number;
    turnNumber?: number;
    roundEndTriggered?: boolean;
    roundWinners?: Record<number, number[]>;
    gameWinner?: number | null;
    isRoundEndModalOpen?: boolean;
  };

  // Game settings changes
  settingsDelta?: {
    activeGridSize?: GridSize;
    gameMode?: GameMode;
    isPrivate?: boolean;
    dummyPlayerCount?: number;
  };

  // Visual effects
  highlightsDelta?: {
    add?: HighlightData[];
    remove?: number[]; // Timestamps to remove
    clear?: boolean;
  };
  floatingTextsDelta?: {
    add?: FloatingTextData[];
    clear?: boolean;
  };
  targetingModeDelta?: {
    set?: TargetingModeData;
    clear?: boolean;
  };
  abilityModeDelta?: any; // Active ability mode for P2P visual sync

  // Metadata
  timestamp: number;
  sourcePlayerId: number; // Who made the change
}

/**
 * Delta for a single player's state
 */
export interface PlayerDelta {
  id: number;

  // Player removal flag
  removed?: boolean;  // true if player was removed from game

  // Card count changes (only sizes, not full arrays for privacy)
  handSizeDelta?: number; // Change in hand size (+1, -1, etc.)
  deckSizeDelta?: number;
  discardSizeDelta?: number;

  // Full array updates (only when necessary, e.g., for local player or dummy players)
  hand?: Card[]; // Full hand array (for dummy players)
  deck?: Card[]; // Full deck array (for dummy players)
  discard?: Card[]; // Full discard array (for dummy players)
  handAdd?: Card[]; // Cards added to hand
  handRemove?: number; // Number of cards removed from end of hand
  deckAdd?: Card[]; // Cards added to deck
  deckRemove?: number; // Number of cards removed from end of deck
  discardAdd?: Card[]; // Cards added to discard
  discardClear?: boolean; // Clear discard pile

  // Announced card (showcase) changes
  announcedCard?: Card | null; // Full announced card state (for all players to see)

  // Board history changes (for LastPlayed status tracking)
  boardHistory?: string[]; // New board history state

  // Score changes
  scoreDelta?: number;

  // Property changes
  isReady?: boolean;
  selectedDeck?: DeckType;
  name?: string;
  color?: PlayerColor;
  isDummy?: boolean;
  isDisconnected?: boolean;
  teamId?: number;
  autoDrawEnabled?: boolean;
  readySetup?: boolean;
  readyCommit?: boolean;
  position?: number;
}

/**
 * Delta for a single board cell
 */
export interface BoardCellDelta {
  row: number;
  col: number;

  // Card placement/removal
  card?: Card | null; // null = card removed

  // Card status changes (if card already exists)
  cardStatuses?: {
    add?: CardStatus[];
    remove?: string[]; // Status types to remove
    clear?: boolean;
  };

  // Card power changes
  cardPowerDelta?: number;
  cardPowerModifier?: number;
}

// ============================================================================
// GAME LOG SYSTEM (DELTA-BASED)
// ============================================================================

/**
 * Types of game actions that can be logged
 */
export type GameLogActionType =
  | 'GAME_START'
  | 'ROUND_START'
  | 'ROUND_WIN'
  | 'MATCH_WIN'
  | 'TURN_START'
  | 'PHASE_CHANGE'
  | 'DRAW_CARD'
  | 'DRAW_MULTIPLE_CARDS'
  | 'PLAY_CARD'
  | 'ANNOUNCE_CARD'
  | 'MOVE_CARD'
  | 'DESTROY_CARD'
  | 'RETURN_TO_HAND'
  | 'DISCARD_CARD'
  | 'DISCARD_FROM_BOARD'
  | 'ACTIVATE_ABILITY'
  | 'PLACE_TOKEN'
  | 'PLACE_TOKEN_ON_CARD'
  | 'REMOVE_STATUS'
  | 'ADD_STATUS'
  | 'SCORE_POINTS'
  | 'SHUFFLE_DECK'
  | 'PLAYER_JOIN'
  | 'PLAYER_LEAVE'
  | 'GAME_END'
  | 'COMMAND_OPTION'

/**
 * Details for a game log entry
 */
export interface GameLogEntryDetails {
  cardName?: string;
  cardId?: string;
  targetPlayerName?: string;
  targetCardName?: string;
  targetPlayerId?: number;
  abilityText?: string;
  amount?: number;
  count?: number;
  from?: string;
  to?: string;
  fromCoords?: { row: number; col: number };
  toCoords?: { row: number; col: number };
  coords?: { row: number; col: number };
  commandOption?: string;
  commandModule?: number; // 1 or 2 for command cards
  scoreChange?: number;
  newScore?: number;
  winners?: number[]; // Player IDs who won
  winnerName?: string;
  targetLocation?: 'board' | 'hand' | 'discard' | 'deck' | 'showcase';
  phase?: number;
}

/**
 * Path to a nested property in game state
 * Examples: ['board', 3, 4], ['players', 0, 'hand'], ['players', 1, 'score']
 */
export type DeltaPath = Array<string | number>

/**
 * A delta represents a change to a specific part of game state
 */
export interface GameDelta {
  path: DeltaPath;        // Path to the changed element
  before: any;            // Value before the change
  after: any;             // Value after the change
  op?: 'set' | 'add' | 'remove'; // Operation type
}

/**
 * A single entry in the game log
 * Now uses delta-based storage instead of full game state snapshots
 */
export interface GameLogEntry {
  id: string;              // Unique ID for this entry
  timestamp: number;       // When this action occurred
  type: GameLogActionType; // Type of action
  playerId: number;        // Player who performed the action
  playerName: string;      // Player name at time of action
  playerColor: PlayerColor;// Player color at time of action
  round?: number;          // Round number (if applicable)
  turn?: number;           // Turn number (if applicable)
  phase?: number;          // Phase number (0-4, if applicable)
  details: GameLogEntryDetails; // Additional details about the action
  // NEW: Delta-based storage (replaces gameState)
  deltas?: GameDelta[];    // Changes made by this action
  inverseDeltas?: GameDelta[]; // Reverse changes for rewind (before/after swapped)
}

/**
 * Game log history with base state
 * Used to reconstruct any point in the game
 */
export interface GameLogHistory {
  baseState: GameState;    // Initial state before any logged actions
  entries: GameLogEntry[]; // All log entries with deltas
}
