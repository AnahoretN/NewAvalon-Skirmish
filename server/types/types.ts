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
export type PlayerColor = 'blue' | 'purple' | 'red' | 'green' | 'yellow' | 'orange' | 'pink' | 'brown';

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
  fallbackImage?: string; // The local fallback image path (optional).
  power: number;
  powerModifier?: number; // Adjustment to the base power.
  bonusPower?: number; // Temporary power bonus from passive effects (recalculated on board updates).
  ability: string;
  abilityText: string; // Alias for ability, used by client for consistency
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
  abilityUsedInPhase?: number; // Stores the phase index where the ability was last used
  deployAbilityConsumed?: boolean; // True if the card's Deploy ability has already been used while on the board
  deployAttempted?: boolean; // True if Deploy was attempted but had no targets (allows skipping to phase abilities)
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
  autoDrawEnabled?: boolean; // Whether this player has auto-draw enabled.
  isSpectator?: boolean; // True if this "player" is actually a spectator in the players array.
  disconnectTimestamp?: number; // Timestamp when player disconnected (for timeout tracking)
  reconnectionDeadline?: number; // Unix timestamp when reconnection window closes (30 seconds after disconnect)
  position?: number; // Position in turn order (0-based)
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
 * Targeting mode data - shared across all clients for synchronized targeting UI
 * When a player activates an ability/command that requires targeting, this data is broadcast
 * so all players can see the valid targets highlighted in the activating player's color.
 */
export interface TargetingModeData {
    playerId: number; // The player whose turn it is to select a target
    action: AbilityAction; // The action defining targeting constraints
    sourceCoords?: { row: number; col: number }; // Source card coordinates (if applicable)
    timestamp: number; // For uniqueness and timeout
    boardTargets?: {row: number, col: number}[]; // Valid board targets (pre-calculated)
    handTargets?: { playerId: number, cardIndex: number }[]; // Valid hand targets (pre-calculated)
    isDeckSelectable?: boolean; // Whether deck is a valid target
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
  isRoundTransitionMulligan: boolean; // True if this is a round transition mulligan (not initial game mulligan)
  mulliganCompletePlayers: number[]; // Player IDs who have confirmed their mulligan
  revealRequests: RevealRequest[];
  activePlayerId: number | null; // Aligned with server and client: null when no active player
  startingPlayerId: number | null; // The ID of the player who started the game (Turn 1 Player 1)
  currentPhase: number; // 0 (hidden Preparation phase), 1-4 representing phases (Setup=1, Main=2, Commit=3, Scoring=4)
  isScoringStep: boolean; // True when waiting for the active player to score a line after Commit phase

  // Auto-abilities settings
  autoAbilitiesEnabled: boolean; // If true, auto-activate card abilities
  autoDrawEnabled: boolean; // If true, auto-draw at start of turn (via Draw phase)
  preserveDeployAbilities: boolean; // If true, deploy abilities remain available after auto-transition to Main
  strictRulesEnabled: boolean; // If true, lateness effect is enabled (non-command cards in hand become unplayable after playing a card to board)

  // Round Logic
  currentRound: number; // 1, 2, or 3
  turnNumber: number; // Counts total full orbits (circles)
  roundEndTriggered: boolean; // True if someone hit the score threshold
  roundWinners: Record<number, number[]>; // Map of Round Number -> Winner Player IDs
  gameWinner: number | null; // Player ID if game is over
  isRoundEndModalOpen: boolean; // Controls visibility of inter-round modal

  // Visual Effects (client-side only, synchronized via gameState)
  deckSelections?: DeckSelectionData[]; // Deck selection effects
  handCardSelections?: HandCardSelectionData[]; // Hand card selection effects
  targetingMode?: TargetingModeData | null; // Active targeting mode (shared across all clients)

  // Server-side auto-draw tracking for Setup phase
  autoDrawnPlayers?: number[]; // Player IDs who have already auto-drawn this Setup phase
  lastDrawnPlayerId?: number | null; // Player who most recently drew a card (for merge fix)
}

/**
 * Defines the data structure for an item being dragged.
 */
export interface DragItem {
  card: Card;
  source: 'hand' | 'board' | 'discard' | 'token_panel' | 'counter_panel' | 'deck' | 'announced';
  playerId?: number; // The ID of the player who owns the source location (hand, deck, etc.).
  boardCoords?: { row: number; col: number }; // Original coordinates if dragged from the board.
  cardIndex?: number; // Original index if dragged from an array (hand, discard, deck).
  statusType?: string; // For counters: the type of status (e.g., 'Aim', 'Power+')
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
  data: any; // Context-specific data (e.g. card, player, coordinates).
}

/**
 * Represents the state of a cursor dragging or placing a stack of counters.
 */
export interface CursorStackState {
    type: string;
    count: number;
    isDragging: boolean;
    sourceCoords?: {row: number, col: number}; // Origin for ability tracking
    targetOwnerId?: number; // Optional restriction for 'Revealed' token usage (Recon Drone) - Inclusive
    excludeOwnerId?: number | 'source'; // Optional restriction - Exclusive (e.g. Vigilant Spotter: Don't reveal self)
    onlyOpponents?: boolean; // Optional restriction - Exclusive (Don't reveal self OR teammates)
    onlyFaceDown?: boolean; // Optional restriction - Only cards that are currently hidden (Face down or unrevealed hand)
    targetType?: string; // Optional: Restrict target by card Type (e.g., "Unit")
    isDeployAbility?: boolean; // True if the stack was created by a Deploy ability (for correct consumption tracking)
    requiredTargetStatus?: string; // Optional: target must have this status to be valid
    requireStatusFromSourceOwner?: boolean; // Optional: target status must be added by the player executing the ability
    mustBeAdjacentToSource?: boolean; // Optional: target must be adjacent to sourceCoords
    mustBeInLineWithSource?: boolean; // Optional: target must be in line with sourceCoords
    placeAllAtOnce?: boolean; // Optional: if true, placing the stack puts ALL counters on one target instead of one by one
    chainedAction?: AbilityAction; // Optional: Action to enter immediately after the stack is depleted
    recordContext?: boolean; // Optional: If true, saves the target to CommandContext
}

/**
 * Context data stored between steps of a multi-step command.
 */
export interface CommandContext {
    lastMovedCardCoords?: { row: number, col: number };
    lastMovedCardId?: string; // To track power of moved card
    sourceOwnerId?: number; // Owner of the ability source (e.g., Centurion's owner for BUFF_LINES_FROM_CONTEXT)
    selectedHandCard?: { playerId: number, cardIndex: number }; // For Quick Response Team
}

/**
 * Data passed to the Counter Selection Modal (Inspiration).
 */
export interface CounterSelectionData {
    card: Card;
    callbackAction: 'DRAW_REMOVED' | 'SCORE_REMOVED';
}

/**
 * Represents a structured action for the auto-ability system.
 */
export type AbilityAction = {
    type: 'CREATE_STACK' | 'ENTER_MODE' | 'OPEN_MODAL' | 'GLOBAL_AUTO_APPLY' | 'ABILITY_COMPLETE' | 'REVEREND_SETUP_SCORE' | 'MODIFY_SCORE';
    mode?: string;
    tokenType?: string;
    count?: number;
    dynamicCount?: { factor: string; ownerId: number | 'source' }; // For dynamic stack counts (e.g. Overwatch Reveal)
    onlyFaceDown?: boolean;
    onlyOpponents?: boolean;
    targetOwnerId?: number | 'source';
    excludeOwnerId?: number | 'source';
    targetType?: string; // Optional: Restrict target by card Type
    sourceCard?: Card;
    sourceCoords?: { row: number, col: number };
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
    replaceStatus?: boolean; // If true, replace the requiredTargetStatus with tokenType (e.g., Censor: Exploit -> Stun)
    originalOwnerId?: number; // The owner of the card that initiated this action (for multi-step commands like Data Interception)
    skipChainedActionOnNoTargets?: boolean; // If true, chained action won't execute when no valid targets exist (e.g., Recon Drone Commit)
};
