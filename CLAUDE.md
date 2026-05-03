# New Avalon: Skirmish - Development Guide

## Setup

```bash
npm i         # Install dependencies
npm run dev   # Start development server (tsx + Vite HMR)
```

**IMPORTANT**: Use `npm run dev` for development - runs both server (tsx) and client (Vite) with HMR. Do not use npm start or docker during development.

## Deployment Architecture

This version uses a **split deployment** strategy:
- **Client**: Static files hosted on GitHub Pages
- **Server**: Runs locally, exposed via ngrok for remote players
- **Shared**: Common code shared between client and server

Players configure the WebSocket URL in Settings to connect to any game server.

## Workflow

### Development
1. **Development**: `npm run dev` (localhost:8080)
Before commit **MANDATORY**:
   a. Always update CLAUDE.md ## Project Structure, ## Key Dependencies, ## API Flow IF there are any changes to:
      - Added/removed files
      - Modified component props or function signatures
      - Changed API endpoints or data flow
      - Updated dependencies or build configuration
      - Altered WebSocket message types or game state structure
   b. Update locales, all should be in sync
   c. Ensure all lint checks and type checks pass

## Critical Rules - NEVER BREAK

### Card Movement Rule
**Cards MUST be movable ANYWHERE at ANY TIME:**
- Hand ↔ Deck ↔ Discard ↔ Showcase ↔ Battlefield
- This flexibility is intentional and essential for game mechanics
- Located in: `client/components/PlayerPanel.tsx` (see header documentation)

### Deck Selection Visual Feedback Rule
**When player selects a deck from dropdown, it MUST update VISUALLY IMMEDIATELY:**

1. **Client-side (`PlayerPanel.tsx`):**
   - Memo function MUST include `player.selectedDeck` in comparison
   - `selectableDecks` MUST use `useMemo(() => deckFiles.filter(...), [deckFiles])`
   - Dropdown only renders when `selectableDecks.length > 0`

2. **Server-side (`gameManagement.ts`):**
   - Player merge logic MUST include `selectedDeck` in BOTH branches:
     - `trustClientCards=true`: Spread `...clientPlayer` covers it
     - `trustClientCards=false`: MUST explicitly add `selectedDeck: clientPlayer.selectedDeck ?? serverPlayerAfterDraw.selectedDeck`

**Failure to follow these rules will cause:**
- Dropdown not updating when deck is selected
- User having no visual feedback that selection was made
- Page reload required to see correct deck

### Deployment (GitHub Pages + ngrok)
1. **Build for GitHub Pages**:
   ```bash
   npm run build:gh-pages
   ```
2. **Deploy `dist/` folder to GitHub Pages** (via GitHub UI or gh-pages CLI)
3. **Start server locally**:
   ```bash
   npm run dev
   ```
4. **Expose via ngrok**:
   ```bash
   ngrok http 8822
   ```
5. **Share ngrok URL with players**:
   - Players open GitHub Pages URL
   - Click Settings (gear icon in main menu)
   - Enter WebSocket URL: `wss://xxxx-xxxx.ngrok-free.app`
   - Click "Save and Apply"
   - Connection status should show "Connected" (green)

### Merging
- **Build & Test**:
   ```bash
   docker build -t newavalonskirmish .
   docker run -d -p 8822:8080 --name test newavalonskirmish
   ```
   Test on `http://localhost:8822`
   - check static files served and contain changes
   - make request to server to check it works
   - establish websocket connection
   - IF something wrong use `docker logs newavalonskirmish` and find root cause, dive in and start fixing
- **Create branch**: `git checkout -b feature-name` (mandatory)
- **Update version***: this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
   - Update package.json version
   - Update CHANGELOG.md with new version
- **Commit & Push**: `git add . && git commit -m "{{VERSION}} {{CHANGES}}" && git push`
- **Code Review**: Wait 2-5 mins, read GitHub PR comments from coderabbit
- **Merge**: If OK, squash merge to main
- **Deploy**: Push to main triggers GitHub Pages auto-deploy

## Project Structure

```text
/
├── client/                       # Client-side application
│   ├── components/               # React UI components (24 files)
│   │   ├── GameBoard.tsx         # React.FC({board: Board, isGameStarted: boolean, activeGridSize: GridSize, handleDrop: (item: DragItem, target: DropTarget) => void, draggedItem: DragItem | null, setDraggedItem: (item: DragItem | null) => void, openContextMenu: (e: React.MouseEvent, type: 'boardItem' | 'emptyBoardCell', data: any) => void, playMode: { card: Card; sourceItem: DragItem; faceDown?: boolean } | null, setPlayMode: (mode: null) => void, highlight: HighlightData | null, playerColorMap: Map<number, PlayerColor>, localPlayerId: number | null, onCardDoubleClick: (card: Card, boardCoords: { row: number; col: number }) => void, onEmptyCellDoubleClick: (boardCoords: { row: number; col: number }) => void, imageRefreshVersion?: number, cursorStack: { type: string; count: number } | null, currentPhase?: number, activePlayerId?: number, onCardClick?: (card: Card, boardCoords: { row: number; col: number }) => void, onEmptyCellClick?: (boardCoords: { row: number; col: number }) => void, validTargets?: {row: number, col: number}[], noTargetOverlay?: {row: number, col: number} | null, disableActiveHighlights?: boolean, preserveDeployAbilities?: boolean, activeFloatingTexts?: FloatingTextData[], abilitySourceCoords?: { row: number, col: number } | null, abilityCheckKey?: number})
│   │   ├── PlayerPanel.tsx       # React.FC({player: Player, isLocalPlayer: boolean, localPlayerId: number | null, isSpectator: boolean, isGameStarted: boolean, onNameChange: (name: string) => void, onColorChange: (color: PlayerColor) => void, onScoreChange: (delta: number) => void, onDeckChange: (deckType: DeckType) => void, onLoadCustomDeck: (deckFile: CustomDeckFile) => void, onDrawCard: () => void, handleDrop: (item: DragItem, target: DropTarget) => void, draggedItem: DragItem | null, setDraggedItem: (item: DragItem | null) => void, openContextMenu: (e: React.MouseEvent, type: ContextMenuParams['type'], data: ContextMenuData) => void, onHandCardDoubleClick: (player: Player, card: Card, index: number) => void, playerColorMap: Map<number, PlayerColor>, allPlayers: Player[], localPlayerTeamId?: number, activePlayerId?: number, onToggleActivePlayer: (playerId: number) => void, imageRefreshVersion: number, layoutMode: 'list-local' | 'list-remote', onCardClick?: (player: Player, card: Card, index: number) => void, validHandTargets?: { playerId: number, cardIndex: number }[], onAnnouncedCardDoubleClick?: (player: Player, card: Card) => void, currentPhase: number, disableActiveHighlights?: boolean, preserveDeployAbilities?: boolean, roundWinners?: Record<number, number[]>, startingPlayerId?: number, onDeckClick?: (playerId: number) => void, isDeckSelectable?: boolean})
│   │   ├── Card.tsx              # React.FC with split props: CardCoreProps({card: Card, isFaceUp: boolean, playerColorMap: Map<number, PlayerColor>, imageRefreshVersion?: number, smallStatusIcons?: boolean, extraPowerSpacing?: boolean, hidePower?: boolean}) and CardInteractionProps({localPlayerId?: number | null, disableTooltip?: boolean, activePhaseIndex?: number, activePlayerId?: number, disableActiveHighlights?: boolean, preserveDeployAbilities?: boolean, activeAbilitySourceCoords?: { row: number, col: number } | null, boardCoords?: { row: number; col: number } | null, abilityCheckKey?: number})
│   │   ├── Header.tsx            # React.FC with InvitePlayerMenu for game invites (copy link with gameId + encoded server URL), StatusIndicator (connection status), RoundTracker, PhaseControls, GameSettings menu
│   │   ├── MainMenu.tsx          # React.FC with connectionStatus and forceReconnect props, passes to SettingsModal
│   │   ├── TopDeckView.tsx       # React.FC({players: Player[], localPlayerId: number | null, gameState: GameState | null, onPlayerClick: (playerId: number) => void, t: (key: string) => string})
│   │   ├── JoinGameModal.tsx     # React.FC({isOpen: boolean, onClose: () => void, onJoin: (data: { playerName: string; gameCode: string }) => void, games: any[]})
│   │   ├── TeamAssignmentModal.tsx # React.FC({players: Player[], gameMode: GameMode, onCancel: () => void, onConfirm: (teams: any) => void})
│   │   ├── ReadyCheckModal.tsx   # React.FC({players: Player[], localPlayer: Player, onReady: () => void, onCancel: () => void})
│   │   ├── CardDetailModal.tsx   # React.FC({card: Card | null, ownerPlayer: Player | null, onClose: () => void, statusDescriptions: Record<string, string>, allPlayers: Player[], imageRefreshVersion?: number})
│   │   ├── DeckViewModal.tsx     # React.FC({isOpen: boolean, onClose: () => void, title: string, player: Player, cards: Card[], setDraggedItem: (item: DragItem | null) => void, onCardContextMenu: (e: React.MouseEvent, card: Card, source: string) => void, onCardDoubleClick: (card: Card, source: string) => void, onCardClick: (card: Card, source: string) => void, canInteract: boolean, isDeckView?: boolean, playerColorMap: Map<number, PlayerColor>, localPlayerId: number | null, imageRefreshVersion?: number, highlightFilter?: (card: Card) => boolean})
│   │   ├── TokensModal.tsx       # React.FC({isOpen: boolean, onClose: () => void, setDraggedItem: (item: DragItem | null) => void, openContextMenu: (e: React.MouseEvent, type: string, data: any) => void, canInteract: boolean, anchorEl: HTMLElement | null, imageRefreshVersion?: number, draggedItem: DragItem | null})
│   │   ├── CountersModal.tsx     # React.FC({isOpen: boolean, onClose: () => void, setDraggedItem: (item: DragItem | null) => void, canInteract: boolean, anchorEl: HTMLElement | null, imageRefreshVersion?: number, onCounterMouseDown: (counter: any) => void, cursorStack: { type: string; count: number } | null})
│   │   ├── DeckBuilderModal.tsx  # React.FC({isOpen: boolean, onClose: () => void, setViewingCard: (card: Card | null) => void}) - Now supports text deck format (.txt) export/import with format "Nx Card Name"
│   │   ├── SettingsModal.tsx     # React.FC({isOpen, onClose, onSave, connectionStatus, onReconnect}) - Server URL config, reconnect button, connection status indicator, Copy Game Link button (only active when connected)
│   │   ├── RulesModal.tsx        # React.FC({isOpen: boolean, onClose: () => void})
│   │   ├── CommandModal.tsx      # React.FC({isOpen: boolean, card: Card | null, playerColorMap: Map<number, PlayerColor>, onConfirm: (command: string) => void, onCancel: () => void})
│   │   ├── CounterSelectionModal.tsx # React.FC({isOpen: boolean, data: any, onConfirm: (counterId: string) => void, onCancel: () => void})
│   │   ├── RevealRequestModal.tsx # React.FC({fromPlayer: Player, cardCount: number, onAccept: () => void, onDecline: () => void})
│   │   ├── RoundEndModal.tsx     # React.FC({gameState: GameState, onConfirm: () => void, localPlayerId: number | null, onExit: () => void})
│   │   ├── ContextMenu.tsx       # React.FC({x: number, y: number, items: ContextMenuItem[], onClose: () => void})
│   │   ├── Tooltip.tsx           # React.FC({x: number; y: number; children: React.ReactNode}) + export { Tooltip, CardTooltipContent }
│   │   ├── BaseModal.tsx         # NEW: Base modal component with consistent styling and behavior
│   │   └── TargetSelectionEffect.tsx
│   ├── contexts/                 # React Context providers
│   │   └── LanguageContext.tsx       # export const LanguageProvider: React.FC<{ children: ReactNode }>, export const useLanguage: () => {language: LanguageCode; setLanguage: (lang: LanguageCode) => void; t: (key: string) => string; getCardTranslation: (cardId: string) => CardTranslation | undefined; getCounterTranslation: (type: string) => { name: string; description: string } | undefined; resources: TranslationResource; isRTL: boolean}
│   ├── hooks/                    # Custom React hooks (4 files) + ability handlers (6 files)
│   │   ├── useGameState.ts       # export const useGameState: () => {gameState: GameState, localPlayerId: number | null, setLocalPlayerId: (id: number | null) => void, draggedItem: DragItem | null, setDraggedItem: (item: DragItem | null) => void, connectionStatus: ConnectionStatus ('Connecting' | 'Connected' | 'Disconnected'), gamesList: any[], latestHighlight: HighlightData | null, latestFloatingTexts: FloatingTextData[], latestNoTarget: {row: number, col: number} | null, setTargetingMode, clearTargetingMode, createGame, joinGame, requestGamesList, exitGame, startReadyCheck, cancelReadyCheck, playerReady, assignTeams, setGameMode, setGamePrivacy, setActiveGridSize, setDummyPlayerCount, updatePlayerName, changePlayerColor, updatePlayerScore, changePlayerDeck, loadCustomDeck, drawCard, shufflePlayerDeck, playCard, moveCard, returnCardToHand, announceCard, endTurn, playCounter, playToken, destroyCard, addCommand, cancelPendingCommand, executePendingCommand, handleQuickDrop, forceReconnect}
│   │   ├── useAppCommand.ts      # export const useAppCommand: ({gameState, localPlayerId, draggedItem, setDraggedItem, openContextMenu, playMode, setPlayMode, setCursorStack, playerColorMap}) => {playCard, moveCard, returnCardToHand, announceCard, endTurn, playCounter, playToken, destroyCard, addCommand, cancelPendingCommand, executePendingCommand, handleQuickDrop}
│   │   ├── useAppAbilities.ts    # export const useAppAbilities: ({gameState, localPlayerId, setCursorStack, playerColorMap}) => {handleDeployAbility}
│   │   ├── useAppCounters.ts     # export const useAppCounters: ({gameState, localPlayerId}) => {handleStackInteraction}
│   │   └── abilities/            # Ability activation and mode handlers
│   │       ├── abilityActivation.ts    # Main ability activation logic
│   │       ├── actionExecutionHandler.ts  # Centralized execution of ability actions (ENTER_MODE, OPEN_MODAL, CREATE_STACK)
│   │       ├── modeHandlers.ts           # Handles different ability modes (SWAP_ADJACENT, PLACE_TOKEN, PATROL_MOVE, RIOT_PUSH, etc.)
│   │       ├── emptyCellHandlers.ts      # Handles clicks on empty cells during ability modes
│   │       ├── lineSelectionHandlers.ts  # Handles line selection for scoring abilities
│   │       └── targetingHandler.ts       # Target selection and validation
│   ├── host/                     # WebRTC P2P host system (11 files)
│   │   ├── types.ts              # Type definitions for WebRTC host
│   │   ├── HostManager.ts        # Main host class
│   │   ├── HostConnectionManager.ts # Connection management
│   │   ├── HostStateManager.ts   # State management
│   │   ├── GuestStateSync.ts    # Guest state synchronization
│   │   ├── HostMessageHandler.ts # Message handling
│   │   ├── VisualEffects.ts      # Visual effects broadcasting
│   │   ├── TimerSystem.ts       # Disconnect/inactivity timers
│   │   ├── GameLogger.ts        # Game action logging
│   │   ├── PhaseManagement.ts   # Phase transitions, round management
│   │   └── ReconnectionManager.ts
│   ├── utils/                    # Client-side utilities (9 files)
│   │   ├── boardUtils.ts         # NOW IMPORTED FROM SHARED
│   │   ├── targeting.ts          # NOW IMPORTED FROM SHARED
│   │   ├── autoAbilities.ts      # Re-exports shared abilities for client, includes getCommandOptions, getCommandActionByOption, isCommandCard
│   │   ├── textFormatters.ts     # export const formatAbilityText: (ability: string) => React.ReactNode
│   │   ├── textDeckFormat.ts     # Text-based deck format parser/exporter (format: "Nx Card Name"), export const parseTextDeckFormat: (textContent: string) => TextDeckParseResult, export const exportToTextDeckFormat: (deckFile: CustomDeckFile) => string
│   │   ├── deckValidation.ts     # export const validateDeckData: (data: any) => DeckValidationResult
│   │   ├── common.ts             # Shared utilities (deepCloneState, TIMING, color functions)
│   │   ├── inviteLinks.ts        # Invite link generation/parsing
│   │   ├── stateDelta.ts         # State delta utilities for WebRTC optimization
│   │   └── webrtcManager.ts      # WebRTC P2P connection manager
│   ├── locales/                  # Translation system
│   │   ├── index.ts              # export const resources: Record<LanguageCode, TranslationResource>, export const LANGUAGE_NAMES: Record<LanguageCode, string>, export const AVAILABLE_LANGUAGES (en, ru, sr), includes new translations: saveJson, saveText, loadTextDeck, cannotSaveEmptyDeck
│   │   ├── types.ts              # type LanguageCode, interface CardTranslation, interface CounterTranslation, interface TranslationResource
│   │   └── ru.ts, sr.ts          # Translation files with same structure as en
│   ├── App.tsx                   # export default function App - includes useEffect for auto-joining games from invite links (checks sessionStorage for invite_game_id)
│   ├── index.tsx                 # Entry point - parses URL params (game, s) for invite links, stores invite_game_id in sessionStorage, decodes and saves WebSocket URL to localStorage
│   ├── types.ts                  # enum DeckType, enum GameMode, type SpecialItemType, type PlayerColor, type GridSize, interface CardStatus, interface CounterDefinition, interface Card, interface Player, interface Cell, type Board, type CardIdentifier, interface RevealRequest, interface HighlightData, interface FloatingTextData, interface DeckSelectionData, interface HandCardSelectionData, interface TargetingModeData, interface GameState, interface DragItem, interface DropTarget, interface CustomDeckCard, interface CustomDeckFile, type ContextMenuItem, type ContextMenuParams, interface CursorStackState, interface CommandContext
│   ├── constants.ts              # export const MAX_PLAYERS, DECK_THEMES, PLAYER_COLORS, FLOATING_TEXT_COLORS, PLAYER_COLOR_NAMES, TURN_PHASES, STATUS_ICONS, STATUS_DESCRIPTIONS, AVAILABLE_COUNTERS, COUNTERS, shuffleDeck, PLAYER_POSITIONS
│   ├── contentDatabase.ts        # export const rawJsonData, export type CardDefinition, export const cardDatabase, export const tokenDatabase, export const countersDatabase, export const deckFiles, export const commandCardIds, export const decksData, export const getSelectableDecks, export function getCardDefinition, export function getCardDefinitionByName, export function getAllCards
│   ├── vite.config.ts            # export default defineConfig: (options: { command: string }) => UserConfig
│   └── index.css                 # (no exports - global styles)
├── server/                       # Server-side application
│   ├── services/                 # Core services (6 files)
│   │   ├── websocket.ts          # export function setupWebSocket(wss), export function broadcastToGame(gameId, gameState, excludeClient), export function sendToClient(client, message), export function broadcastToGameMessage(gameId, message, excludeClient)
│   │   ├── gameState.ts          # export function createGameState(gameId, options), export function getGameState(gameId), export function updateGameState(gameId, updates), export function deleteGameState(gameId), export function addPlayerToGame(gameId, player), export function removePlayerFromGame(gameId, playerId), export function getAllGameStates(), export function getPublicGames(), export function associateClientWithGame(client, gameId), export function getGameIdForClient(client), export function removeClientAssociation(client), export function getClientGameMap(), export function logGameAction(gameId, action), export function getGameLogs(gameId), export function clearGameTimers(gameId), export function getGameStats()
│   │   ├── gameLifecycle.ts      # export const gameTerminationTimers, export const gameInactivityTimers, export const playerDisconnectTimers, export function logToGame(gameId, message, gameLogs), export function endGame(gameId, reason, gameLogs, wss), export function resetInactivityTimer(gameId, gameLogs, wss), export function convertPlayerToDummy(gameId, playerId, gameLogs, wss, broadcastToGame), export function scheduleGameTermination(gameId, gameLogs, wss), export function cancelGameTermination(gameId, gameLogs), export function handlePlayerLeave(gameId, playerId, isManualExit, gameLogs, wss, broadcastToGame, broadcastGamesListFn), export function broadcastGamesList(gameLogs, wss)
│   │   ├── content.ts            # export function getCardDefinition(cardId), export function getTokenDefinition(tokenId), export function getCounterDefinition(counterId), export function getDeckFiles(), export function getAllCards(), export function getAllTokens(), export function getAllCounters(), export function setCardDatabase(cards), export function setTokenDatabase(tokens), export function setDeckFiles(decks)
│   │   └── rateLimit.ts          # export function isRateLimited(client), export function cleanupRateLimitData(client), export function getRateLimitStatus(client)
│   ├── handlers/                 # WebSocket message handlers (7 modules)
│   │   ├── gameManagement.ts     # export function handleSubscribe(ws, data), export function handleUpdateState(ws, data), export function handleJoinGame(ws, data), export function handleExitGame(ws, data), export function handleForceSync(ws, data)
│   │   ├── readyCheck.ts         # export function handleStartReadyCheck(ws, data), export function handleCancelReadyCheck(ws, data), export function handlePlayerReady(ws, data)
│   │   ├── gameSettings.ts       # export function handleSetGameMode(ws, data), export function handleSetGamePrivacy(ws, data), export function handleAssignTeams(ws, data), export function handleSetGridSize(ws, data)
│   │   ├── visualEffects.ts      # export function handleTriggerHighlight(ws, data), export function handleTriggerNoTarget(ws, data), export function handleTriggerFloatingText(ws, data), export function handleTriggerFloatingTextBatch(ws, data), export function handleSyncHighlights(ws, data), export function handleSyncValidTargets(ws, data), export function handleTriggerDeckSelection(ws, data), export function handleTriggerHandCardSelection(ws, data), export function handleSetTargetingMode(ws, data), export function handleClearTargetingMode(ws, data)
│   │   ├── deckData.ts           # export function handleUpdateDeckData(ws, data)
│   │   ├── playerSettings.ts     # export function handleUpdatePlayerName(ws, data), export function handleChangePlayerColor(ws, data), export function handleUpdatePlayerScore(ws, data), export function handleChangePlayerDeck(ws, data), export function handleLoadCustomDeck(ws, data), export function handleSetDummyPlayerCount(ws, data), export function handleLogGameAction(ws, data), export function handleGetGameLogs(ws, data)
│   │   └── phaseManagement.ts    # export function handleToggleAutoAbilities(ws, data), export function handleNextPhase(ws, data), export function handlePrevPhase(ws, data), export function handleSetPhase(ws, data), export function performDrawPhase(gameState), export function handleToggleAutoDraw(ws, data), export function handleToggleActivePlayer(ws, data), export function handleStartNextRound(ws, data), export function handleStartNewMatch(ws, data), includes getRoundVictoryThreshold(round), checkRoundEnd(gameState), endRound(gameState)
│   ├── utils/                    # Server utilities (4 files - boardUtils and targeting moved to shared)
│   │   ├── logger.ts             # export const logger: Logger (info, warn, error, debug methods)
│   │   ├── config.ts             # export const CONFIG: {MAX_PLAYERS, MAX_ACTIVE_GAMES, MAX_MESSAGE_SIZE, MAX_GAME_STATE_SIZE, MAX_STRING_LENGTH, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW, INACTIVITY_TIMEOUT, GAME_CLEANUP_DELAY, PLAYER_DUMMY_DELAY}, export function validateConfig()
│   │   ├── security.ts           # export function sanitizeString(input, maxLength), export function sanitizePlayerName(name), export function validateGameStateSize(gameState), export function validateMessageSize(message), export function generateSecureGameId()
│   │   └── deckUtils.ts          # export const COMMAND_CARD_IDS: Set<string>, export function shuffleDeck<T>(deck: T[]): T[], export function generatePlayerToken(): string, export function createDeck(deckType, playerId, playerName): any[], export function createNewPlayer(id, isDummy): any
│   ├── constants/                # Server constants
│   │   └── playerColors.ts       # export const PLAYER_COLOR_MAP: Map<string, PlayerColor>
│   └── dev.ts                    # Development server entry point (no exports)
├── shared/                     # Shared code between client and server
│   ├── types/                    # Shared type definitions
│   │   └── index.ts              # All shared types (DeckType, GameMode, PlayerColor, Card, Player, Board, GameState, etc.)
│   ├── utils/                    # Shared utilities
│   │   ├── array.ts              # Shared array utilities (shuffleDeck)
│   │   ├── boardUtils.ts         # Board utilities (createInitialBoard, recalculateBoardStatuses)
│   │   └── targeting.ts          # Targeting utilities (validateTarget, calculateValidTargets, checkActionHasTargets)
│   ├── abilities/                # Shared ability system
│   │   ├── contentAbilities.ts   # Converts contentDatabase abilities to game actions
│   │   ├── readySystem.ts        # Ready status management (readyDeploy, readySetup, readyCommit)
│   │   ├── index.ts              # Exports shared ability utilities
│   │   └── abilityUtils.ts       # Helper functions for abilities
│   └── content/                  # Game content data - SHARED between all modes
│       └── contentDatabase.json  # Cards, tokens, decks definitions (SINGLE SOURCE OF TRUTH)
├── Dockerfile                    # (no exports - build configuration)
├── index.html                    # (no exports - HTML template)
├── package.json                  # (no exports - dependencies and scripts)
├── tsconfig.json                 # (no exports - TypeScript config)
├── tsconfig.client.json          # (no exports - TypeScript config (client override))
├── tsconfig.server.json          # (no exports - TypeScript config (server))
├── vite.config.ts                # Vite configuration with BASE_URL support for GitHub Pages
├── .env.example                  # Environment variables template
├── .gitignore                    # Git ignore patterns (includes .env)
├── README.md                     # Project README with deployment instructions
├── DEPLOYMENT.md                 # Detailed deployment guide
└── CLAUDE.md                     # This file - development guide
```

## Key Dependencies

### Core Runtime

- **React 18.2.0**: UI framework (components + hooks)
- **Express 5.2.1**: HTTP server + middleware
- **express-ws 5.0.2**: WebSocket integration
- **ws 8.17.1**: WebSocket protocol implementation
- **tsx 4.21.0**: TypeScript executor for Node.js server development
- **Vite 5.2.11**: Build tool + dev server + HMR

### Build & Styling

- **@vitejs/plugin-react 4.2.1**: React JSX support
- **Tailwind CSS 3.4.3**: Utility-first CSS framework
- **PostCSS 8.4.38**: CSS processing pipeline
- **Autoprefixer 10.4.19**: CSS vendor prefixing
- **TypeScript 5.4.5**: Type checking and compilation

## API Flow

### Server-to-Client Game State Broadcast
1. **server/services/websocket.ts** - `broadcastToGame(gameId, gameState, excludeClient)` (line 287)
2. **server/services/websocket.ts** - `sanitizeGameState(gameState)` removes `ws` references (line 327)
3. **server/services/websocket.ts** - Iterate `wssInstance.clients`, check `clientGameMap.get(client) === gameId` (line 296-307)
4. **client/hooks/useGameState.ts** - `ws.current.onmessage = (event) =>` (line 201)
5. **client/hooks/useGameState.ts** - `const data = JSON.parse(event.data)` (line 203)
6. **client/hooks/useGameState.ts** - `setGameState(data)` → React state update (line 244)

### Client-to-Server Action Flow
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify(payload))` (line 283)
2. **server/services/websocket.ts** - `ws.on('message', message =>` (line 85)
3. **server/services/websocket.ts** - `data = JSON.parse(message.toString())` (line 131)
4. **server/services/websocket.ts** - `routeMessage(ws, data)` → handler dispatch (line 152, line 166)
5. **server/services/websocket.ts** - `broadcastToGame(gameId, updatedGameState)` (called by handlers)

### Games List Request
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'GET_GAMES_LIST' }))` (line 317)
2. **server/services/websocket.ts** - `routeMessage` → `handleGetGamesList` (line 167)
3. **server/services/gameState.ts** - `getPublicGames()` filters non-private games (line 151)
4. **server/services/websocket.ts** - `sendToClient(ws, { type: 'GAMES_LIST', games: publicGames })` (line 345)
5. **client/hooks/useGameState.ts** - `if (data.type === 'GAMES_LIST') { setGamesList(data.games) }` (line 204)

### Game Join Flow
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'JOIN_GAME', gameId, playerToken }))` (line 188-194)
2. **server/services/websocket.ts** - `routeMessage` → `handleJoinGame` (line 170)
3. **server/handlers/gameManagement.ts** - `associateClientWithGame(ws, gameId)` (line 119)
4. **server/handlers/gameManagement.ts** - `ws.send(JSON.stringify({ type: 'JOIN_SUCCESS', playerId, playerToken }))` (line 204-207)
5. **server/services/websocket.ts** - `broadcastToGame(gameId, gameState)` (line 210)
6. **client/hooks/useGameState.ts** - `if (data.type === 'JOIN_SUCCESS') { setLocalPlayerId(data.playerId) }` (line 206)

### Invite Link System
#### Invite Link Creation (Header.tsx → handleCopyLink)
1. **client/components/Header.tsx** - `handleCopyLink()` creates invite link (line 317-344)
2. Get baseUrl: `window.location.origin` (e.g., `http://localhost:8822/`)
3. Get WebSocket URL from `localStorage.getItem('websocket_url')`
4. Encode WebSocket URL: `btoa(encodeURIComponent(wsUrl))`
5. Create invite link: `${baseUrl}?game=${gameId}&s=${encodedServerUrl}`

#### Invite Link Processing (index.tsx)
1. **client/index.tsx** - Parse URL parameters on app load (line 8-39)
2. `game` parameter → `sessionStorage.setItem('invite_game_id', inviteGameId)`
3. `s` parameter → decode and save to both `localStorage.setItem('websocket_url', decodedUrl)` and `localStorage.setItem('custom_ws_url', decodedUrl)`
4. Clear URL parameters from browser address bar: `window.history.replaceState({}, '', window.location.pathname)`

#### Auto-Join Flow (App.tsx)
1. **client/App.tsx** - `useEffect` checks for invite game ID (line 1071-1081)
2. When connected (`connectionStatus === 'Connected'`) and invite exists:
   - `handleJoinGame(inviteGameId)` is called
   - `sessionStorage.removeItem('invite_game_id')` clears the invite

#### WebSocket URL Management
- **custom_ws_url**: User-configured server URL (from Settings modal)
- **websocket_url**: Active/verified server URL (saved by getWebSocketURL and onopen handler)
- **client/hooks/useGameState.ts** - `getWebSocketURL()` saves validated URL to `websocket_url` (line 41)
- **client/hooks/useGameState.ts** - `ws.current.onopen` saves active URL to `websocket_url` (line 370)

### Host Game Creation & Deck Sync
1. **client/hooks/useGameState.ts** - Player 1 sends: `ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))` (line 311)
2. **server/services/websocket.ts** - `routeMessage` → `handleUpdateDeckData` (line 176)
3. **client/hooks/useGameState.ts** - Delay 500ms resend: `ws.current.send(JSON.stringify({ type: 'UPDATE_DECK_DATA', deckData: rawJsonData }))` (line 221-224)
4. **server/handlers/deckData.ts** - Load deck data: `cardDatabase = deckData.cards; tokenDatabase = deckData.tokens;`

### Real-time Visual Effects
#### Highlight Trigger
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'TRIGGER_HIGHLIGHT', gameId, highlightData }))` (line 1391)
2. **server/services/websocket.ts** - `routeMessage` → `handleTriggerHighlight` (line 195)
3. **server/handlers/visualEffects.ts** - Broadcast: `JSON.stringify({ type: 'HIGHLIGHT_TRIGGERED', highlightData })`
4. **client/hooks/useGameState.ts** - `if (data.type === 'HIGHLIGHT_TRIGGERED') { setLatestHighlight(data.highlightData) }` (line 235)

#### Floating Text
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'TRIGGER_FLOATING_TEXT_BATCH', gameId, batch }))` (line 1400)
2. **server/services/websocket.ts** - `routeMessage` → `handleTriggerFloatingTextBatch` (line 197)
3. **client/hooks/useGameState.ts** - `if (data.type === 'FLOATING_TEXT_BATCH_TRIGGERED') { setLatestFloatingTexts(data.batch) }` (line 239-242)

#### No Target Overlay
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'TRIGGER_NO_TARGET', gameId, coords, timestamp }))` (line 1410)
2. **server/services/websocket.ts** - `routeMessage` → `handleTriggerNoTarget` (line 198)
3. **client/hooks/useGameState.ts** - `if (data.type === 'NO_TARGET_TRIGGERED') { setLatestNoTarget({ coords: data.coords, timestamp: data.timestamp }) }` (line 237-238)

### Universal Targeting Mode System
The universal targeting mode system provides a synchronized way to show valid targets to all players when any player activates an ability, command, or multi-step action that requires targeting.

#### Targeting Mode Activation
1. **client/hooks/useGameState.ts** - `setTargetingMode(action, playerId, sourceCoords?, commandContext?)` (line 2515-2561)
   - Calculates valid board targets using `calculateValidTargets` from **shared/utils/targeting.ts**
   - Creates `TargetingModeData` object with action, playerId, sourceCoords, timestamp, boardTargets
   - Updates local gameState.targetingMode immediately
   - Broadcasts `SET_TARGETING_MODE` message to server
2. **server/services/websocket.ts** - `routeMessage` → `handleSetTargetingMode` (line 215)
3. **server/handlers/visualEffects.ts** - `handleSetTargetingMode()` (line 642-703)
   - Validates gameId and targetingMode data
   - Updates gameState.targetingMode on server
   - Broadcasts `TARGETING_MODE_SET` to all clients
4. **client/hooks/useGameState.ts** - `if (data.type === 'TARGETING_MODE_SET')` (line 641-654)
   - All clients update their local gameState.targetingMode
   - Visual highlights appear on GameBoard using targeting player's color

#### Targeting Mode Clearing
1. **client/hooks/useGameState.ts** - `clearTargetingMode()` (line 2567-2586)
   - Clears local gameState.targetingMode
   - Broadcasts `CLEAR_TARGETING_MODE` message to server
2. **server/services/websocket.ts** - `routeMessage` → `handleClearTargetingMode` (line 216)
3. **server/handlers/visualEffects.ts** - `handleClearTargetingMode()` (line 709-762)
   - Clears gameState.targetingMode on server
   - Broadcasts `TARGETING_MODE_CLEARED` to all clients
4. **client/hooks/useGameState.ts** - `if (data.type === 'TARGETING_MODE_CLEARED')` (line 655-662)
   - All clients clear their local gameState.targetingMode
   - Visual highlights are removed

#### Visual Display (GameBoard)
- **client/components/GameBoard.tsx** - `targetingMode` prop (line 37)
- Valid targets from `targetingMode.boardTargets` are combined with local `validTargets`
- Each valid target cell is highlighted with dashed border in targeting player's color
- Highlights are visible to ALL players, but only the targeting player can click to select

#### TargetingModeData Structure
```typescript
interface TargetingModeData {
  playerId: number;              // The player whose turn it is to select a target
  action: AbilityAction;         // The action defining targeting constraints
  sourceCoords?: {row: number; col: number};  // Source card coordinates (if applicable)
  timestamp: number;             // For uniqueness and timeout
  boardTargets?: {row: number, col: number}[];  // Valid board targets (pre-calculated)
  handTargets?: {playerId: number, cardIndex: number}[];  // Valid hand targets
  isDeckSelectable?: boolean;    // Whether deck is a valid target
}
```

#### Supported Ability Modes
- **SELECT_TARGET**: Generic targeting with filter function
- **SWAP_POSITIONS**: Swap positions with filtered cards
- **SWAP_ADJACENT**: Swap positions with any adjacent card
- **PATROL_MOVE**: Move to empty cell in same row/column
- **RIOT_PUSH**: Push adjacent opponent into empty space
- **SHIELD_SELF_THEN_RIOT_PUSH**: Add Shield then push (Reclaimed Gawain)
- **SHIELD_SELF_THEN_SPAWN**: Add Shield then spawn token (Edith Byron)
- **PLACE_TOKEN**: Place token on empty cell (supports `range: 'adjacent'` or `range: 'global'`)
- **SPAWN_TOKEN**: Spawn adjacent token (Inventive Maker)
- **REVEAL_ENEMY**: Reveal adjacent enemy card (Recon Drone)
- **SELECT_CELL**: Select empty cell for movement/spawning
- **CREATE_STACK**: Add status tokens to cards (Aim, Shield, Exploit, Stun)
- **TRANSFER_STATUS_SELECT**: Transfer status to another card
- **REVEREND_DOUBLE_EXPLOIT**: Double Exploit counters from any card
- **ZIUS_LINE_SELECT**: Select row/column for effect (Zius)
- **IP_AGENT_THREAT_SCORING**: Score row/column with Threat tokens
- **SELECT_DIAGONAL**: Select diagonal line
- **SELECT_LINE_START/END**: Select line endpoints

### Game State Updates
#### Ready Check System
1. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'START_READY_CHECK', gameId }))` (line 348)
2. **server/services/websocket.ts** - `routeMessage` → `handleStartReadyCheck` (line 193)
3. **server/handlers/readyCheck.ts** - `updateGameState(gameId, { isReadyCheckActive: true })`
4. **client/hooks/useGameState.ts** - `ws.current.send(JSON.stringify({ type: 'PLAYER_READY', gameId, playerId }))` (line 356)
5. **server/services/websocket.ts** - `routeMessage` → `handlePlayerReady` (line 178)
6. **server/handlers/readyCheck.ts** - `player.isReady = true` → `updateGameState` → `broadcastToGame`

### UPDATE_STATE Flow (Game Creation/Updates)
1. **client/hooks/useGameState.ts** - `updateState(gameState)` sends WebSocket message (line 145-157)
2. **server/services/websocket.ts** - `routeMessage` → `handleUpdateState` (line 177)
3. **server/handlers/gameManagement.ts** - Extract `gameState` from `data.gameState` (line 57)
4. **server/handlers/gameManagement.ts** - If game exists: `Object.assign(existingGameState, updatedGameState)` (line 82)
5. **server/handlers/gameManagement.ts** - If game doesn't exist: `createGameState(gameId, updatedGameState)` + `ws.playerId = 1` (line 88-91)
6. **server/services/websocket.ts** - `broadcastToGame(gameId, gameState)` to all clients

### RESET_GAME Flow (Optimized with Compact Message)
1. **client/hooks/useGameState.ts** - `resetGame()` sends `RESET_GAME` message (line ~1864)
2. **server/services/websocket.ts** - `routeMessage` → `handleResetGame` (line 201)
3. **server/handlers/gameManagement.ts** - `handleResetGame()` resets server-side state (line 943-1026)
4. **server/services/websocket.ts** - `broadcastToGameMessage(gameId, { type: 'GAME_RESET', ... })` sends compact message (line ~300)
   - Only sends necessary reset data (players, settings, flags)
   - Avoids sending full deck data and large game state
5. **client/hooks/useGameState.ts** - `data.type === 'GAME_RESET'` handler (line ~665)
   - Updates local gameState with reset values
   - Clears board, targetingMode, floatingTexts, currentCommand

### Phase Transition Flow (with Draw Phase)
1. **client/hooks/useGameState.ts** - `nextPhase()` called after scoring (line ~1730)
2. **client/hooks/useGameState.ts** - `completeTurn()` sets `currentPhase = -1` (Draw Phase) (line ~1725)
3. **client/hooks/useGameState.ts** - Sends `SET_PHASE` with `phaseIndex: -1` to server (line ~1749)
4. **server/handlers/phaseManagement.ts** - `handleSetPhase()` receives phaseIndex -1 (line ~329)
5. **server/handlers/phaseManagement.ts** - Calls `performDrawPhase()` to auto-draw card (line ~332)
6. **server/handlers/phaseManagement.ts** - `performDrawPhase()` sets phase to 0 (Setup) after draw (line ~201)
7. **server/services/websocket.ts** - `broadcastToGame(gameId, gameState)` with updated state

### Round Management Flow (Server-Side)
1. **server/handlers/phaseManagement.ts** - `performDrawPhase()` transitions to phase 0 (Setup)
2. **server/handlers/phaseManagement.ts** - `checkRoundEnd(gameState)` checks if round should end:
   - Only during Setup phase (0)
   - Only when first player (startingPlayerId) becomes active
   - Calculates victory threshold: `10 + (roundNumber * 10)` (Round 1: 20, Round 2: 30, etc.)
   - If any player's score >= threshold, round ends
3. **server/handlers/phaseManagement.ts** - `endRound(gameState)` determines winners:
   - Finds player(s) with highest score
   - Stores in `roundWinners[roundNumber]`
   - Checks if any player has 2 round wins → sets `gameWinner`
   - Sets `isRoundEndModalOpen = true`
4. **client/components/RoundEndModal.tsx** - Displays round results with medal icons
5. **client/hooks/useGameState.ts** - `closeRoundEndModal()` sends `START_NEXT_ROUND` message
6. **server/handlers/phaseManagement.ts** - `handleStartNextRound()` processes:
   - Increments `currentRound` (resets to 1 if game was over)
   - Resets all player scores to 0
   - Closes modal (`isRoundEndModalOpen = false`)
   - Same `startingPlayerId` continues (no rotation)
   - Cards remain on board (no reset)

### Game Start Flow (Random First Player)
1. **server/handlers/readyCheck.ts** - All players ready → game starts (line ~135-216)
2. **server/handlers/readyCheck.ts** - Randomly selects starting player:
   - Gets all non-disconnected players
   - `Math.floor(Math.random() * allPlayers.length)` selects index
   - Sets both `startingPlayerId` and `activePlayerId` to selected player
   - Triggers Draw phase for starting player (7th card after initial 6)

---

# WebRTC P2P Architecture

## Overview

The project supports **two connection modes**:
1. **WebSocket Server Mode** — Traditional client-server architecture using Express + ws
2. **WebRTC P2P Mode** — True peer-to-peer connection without central server during gameplay

WebRTC P2P mode allows players to connect directly to each other, reducing latency and server dependency. The first player (host) becomes the authority, and other players (guests) connect directly to them.

## WebRTC Core Components

### HostManager (`client/host/HostManager.ts`)
The central authority that manages everything in P2P mode:
- **State Authority**: Maintains the source of truth for game state
- **Guest Management**: Handles guest connections, disconnections, and reconnections
- **Action Processing**: All game actions from guests flow through the host
- **State Broadcasting**: Distributes personalized state updates to all guests
- **Phase Management**: Controls game phases, rounds, and turn progression
- **Visual Effects**: Synchronizes highlights, floating text, targeting modes

### HostConnectionManager (`client/host/HostConnectionManager.ts`)
Low-level WebRTC connection management:
- Uses **PeerJS** library for WebRTC abstraction
- Manages multiple guest connections simultaneously
- Handles data serialization with **MessagePack** for efficiency
- Routes incoming messages to appropriate handlers
- Connection health monitoring

### GuestConnectionManager (`client/host/GuestConnection.ts` OR `client/host/GuestConnectionManager.ts`)
Guest-side connection to host:
- Initiates connection to host's peerId
- Sends player actions to host for processing
- Receives personalized state updates from host
- **Reconnection System**: Auto-reconnects within 30-second window
- Uses **localStorage** to persist connection data across page refreshes

### HostStateManager (`client/host/HostStateManager.ts`)
Manages game state on the host:
- Maintains master copy of game state
- **Personalized State Broadcasting**: Creates custom state views for each guest:
  - Local player: Full hand, deck, discard data
  - Other players: Only sizes (handSize, deckSize, discardSize) for privacy
  - Dummy players: Full data (all players control dummies)
- Merges guest state updates with master state
- Manages targeting modes and visual effects state

### VisualEffectsManager (`client/host/VisualEffects.ts`)
Synchronizes visual feedback across all players:
- **Highlights**: Row/column/cell highlighting
- **Floating Text**: Damage, score changes, ability effects (batched for efficiency)
- **Targeting Mode**: Shows valid targets when activating abilities
- **No Target Overlay**: Indicates invalid targets
- **Deck/Hand Selection**: Visual feedback for selecting other players' cards

### ReconnectionManager (`client/host/ReconnectionManager.ts`)
Handles disconnect/reconnect scenarios:
- **30-second reconnect window**: Guests can reconnect and resume
- **localStorage persistence**: Connection data survives page refresh
- **F5 Support**: Host broadcasts new peerId after page refresh
- **Guest timeout**: Converts to dummy player after timeout

### PhaseManagement (`client/host/PhaseManagement.ts`)
Controls game flow in P2P mode:
- Phase transitions (Preparation → Setup → Main → Commit → Scoring)
- Round management and victory checking
- Turn cycling between players

## WebRTC Connection Flow

### 1. Host Starting a Game
```
1. Host clicks "Create Game"
2. HostManager creates PeerJS instance with unique peerId
3. Host broadcasts peerId via BroadcastChannel API (for same-browser tabs)
4. Host shares peerId with guests (via invite link or manual sharing)
```

### 2. Guest Joining
```
1. Guest enters host's peerId (or via invite link)
2. GuestConnectionManager connects to host's PeerJS
3. Guest sends JOIN_REQUEST with:
   - playerName
   - deckPreference (optional)
4. Host assigns unique playerId (1 = host, 2+ = guests)
5. Host sends initial personalized game state
6. Guest receives and renders initial state
```

### 3. Gameplay Loop
```
Guest Action Flow:
1. Guest performs action (play card, move card, etc.)
2. Guest sends ACTION message to host
3. Host processes action on master state
4. Host broadcasts updated state to ALL guests
5. All guests receive and apply update

Visual Effects Flow:
1. Any player triggers effect (highlight, floating text)
2. Effect sent to host
3. Host broadcasts to all guests
4. All guests render effect synchronously
```

### 4. Disconnect/Reconnect
```
Guest Disconnect:
1. Connection lost detected
2. 30-second reconnect timer starts
3. Guest shows "Reconnecting..." UI
4. Guest attempts to reconnect with saved credentials

Successful Reconnect:
1. Guest reconnects to host (or new host peerId after F5)
2. Guest sends RECONNECT message with previous playerId
3. Host validates and sends current state
4. Guest resumes with full state

Failed Reconnect:
1. Timer expires (30 seconds)
2. Host converts guest to dummy player
3. Game continues with AI-controlled dummy
```

## State Optimization Techniques

### Binary Encoding
- Cards sent with **baseId only** (not full card objects)
- ~90% size reduction for card-heavy messages
- Guests reconstruct full cards from local contentDatabase

### Personalized States
- Each guest receives custom view of state
- Privacy: Opponents' hands hidden (only count shown)
- Efficiency: Only send relevant data to each guest

### Delta Updates (Future)
- Currently: Full state broadcast on each change
- Planned: Only send changed portions (stub in `stateDelta.ts`)

## WebRTC vs WebSocket Comparison

| Feature | WebSocket Server | WebRTC P2P |
|---------|------------------|------------|
| Latency | Medium (server relay) | Low (direct P2P) |
| Server Required | Yes | No (after initial) |
| Player Discovery | Server games list | Manual peerId sharing |
| State Authority | Server | Host player |
| Disconnect Recovery | Via server | 30s window to host |
| Bandwidth | Server mediates all | Direct P2P streams |

---

# Game User Features

## What is New Avalon: Skirmish?

A **multiplayer tactical card game** where players:
1. Build decks from faction-specific cards
2. Place units on a grid-based battlefield
3. Activate abilities to attack, defend, and manipulate the board
4. Score points by completing lines (horizontal, vertical, diagonal)
5. Compete in round-based matches (best of 3)

## Game Modes

### FFA (Free For All)
- Every player competes individually
- No teams
- Winner is the player with highest score

### 2v2 (Two vs Two)
- Two teams of two players each
- Team scores are combined
- Both team members share victory/defeat

### 3v1 (Three vs One)
- One team of three vs one player
- Asymmetric gameplay
- Single player has advantages to balance

## Card System

### Card Locations
- **Hand**: Cards available to play (max varies by deck)
- **Deck**: Draw pile, shuffled between rounds
- **Battlefield**: Grid where cards are placed (4x4 to 7x7)
- **Showcase**: Announced/command cards displayed separately
- **Discard**: Used cards pile

### Card Attributes
- **Name**: Card identifier
- **Power**: Combat strength (number in corner)
- **Faction**: SynchroTech, Hoods, Optimates, Fusion
- **Abilities**: Special effects (text description)
- **Status Icons**: Active conditions (shield, poison, etc.)

### Card Types
- **Unit Cards**: Place on battlefield, have power and abilities
- **Command Cards**: Special cards with multiple choice effects
- **Token Cards**: Temporary modifiers, counters, status effects

## Deck System

### Faction Decks
- **SynchroTech**: Tech-focused, synergy abilities
- **Hoods**: Aggressive, direct damage
- **Optimates**: Defensive, control-oriented
- **Fusion**: Multi-faction combinations

### Custom Decks
- Players can build custom decks
- **Text Format**: "Nx Card Name" (e.g., "3x Plasma Trooper")
- Import/export via .txt files
- Validation ensures card legality

### Deck Selection
- Visual dropdown in player panel
- Immediate visual feedback when selected
- Can change before game starts

## Gameplay Phases

### 1. Preparation (Phase 0)
- Active player draws 1 card from deck
- Automatic at start of turn
- Skips if deck is empty

### 2. Setup (Phase 1)
- Place units from hand onto battlefield
- Can place **face-up** or **face-down**
- Face-down cards are hidden until revealed
- Grid size varies (4x4 to 7x7)

### 3. Main (Phase 2)
- Activate card abilities
- May enter **targeting mode** to select targets
- Examples: Deal damage, destroy cards, draw cards
- Some abilities require specific conditions

### 4. Commit (Phase 3)
- Add counters/statuses to cards
- Place tokens from hand
- Prepare for scoring

### 5. Scoring (Phase 4)
- Count completed lines on battlefield
- **Lines**: Horizontal, vertical, diagonal
- Line = "complete" if full of cards
- Each line = points equal to total power
- Add points to player score
- End turn

## Scoring & Victory

### Round Victory
- Victory threshold: `10 + (roundNumber × 10)`
- Round 1: 20 points to win
- Round 2: 30 points to win
- Round 3+: 40+ points
- Player(s) with highest score win the round

### Match Victory
- **Best of 3 rounds**
- First player to win 2 rounds wins the match
- Game Over modal appears
- Option to start new match

### Score Tracking
- Scores displayed in player panels
- Round wins shown with medal icons
- Round number displayed in header

## Turn Management

### Turn Cycle
1. Starting player selected randomly at game start
2. Active player indicator (highlighted panel)
3. Click any player to select them (including yourself)
4. Click same player again to **deselect** and check round end
5. Turn passes to selected player

### Auto-Draw
- Can be toggled in settings
- Automatically draws card at turn start
- Manual draw button available if disabled

## Ready Check System

### Before Game Start
1. Players join lobby
2. Select decks
3. Assign teams (if team mode)
4. Click "Ready" button when prepared
5. Host sees who's ready (green checkmarks)
6. Guests see only own status

### Starting the Game
- When **all players are ready**, game starts automatically
- Random first player selected
- Each player draws 6 initial cards
- First player enters Preparation phase (draws 7th card)

## Team Assignment

### Drag-and-Drop Interface
- Visual team assignment modal
- Drag players to teams
- Respects game mode constraints:
  - 2v2: 2 players per team
  - 3v1: 3 vs 1
- Visual feedback with team colors

## Visual Effects System

### Highlights
- **Row Highlight**: Highlight entire row
- **Column Highlight**: Highlight entire column
- **Cell Highlight**: Highlight single cell
- Color-coded by player

### Floating Text
- **Damage**: Red numbers showing damage dealt
- **Score Changes**: Green/yellow numbers for points
- **Ability Effects**: Text describing ability results
- Batched for efficiency (multiple texts at once)

### Targeting Mode
- Shows valid targets for abilities
- Dashed border highlights
- All players see targeting (only targeting player can select)
- Automatically clears after target selected

### No Target Overlay
- Red "X" overlay on invalid targets
- Visual feedback when ability has no valid targets

## Command System

### Command Cards
Special cards with multiple options:
- **Overwatch**: Choose from several tactical options
- **Tactical Maneuver**: Movement/positioning choices
- **Inspiration**: Buff options

### Command Modal
- Opens when playing a command card
- Shows N options separated by "●"
- Player clicks to select option
- Selected option is executed

## Invite Link System

### Creating Invite Link
1. Host clicks "Copy Game Link" in header
2. Link includes:
   - Game ID
   - Encoded WebSocket URL (for server mode)
   - Host peerId (for WebRTC mode)
3. Share link with potential players

### Joining via Invite Link
1. Guest opens link
2. URL parameters parsed:
   - `game` → game ID (server mode)
   - `s` → encoded server URL (server mode)
   - `peerId` → host peerId (WebRTC mode)
3. Auto-join when connected
4. sessionStorage cleared after join

## Settings & Configuration

### Game Settings
- **Game Mode**: FFA, 2v2, 3v1
- **Grid Size**: 4x4, 5x5, 6x6, 7x7
- **Privacy**: Public (listed) or Private (unlisted)
- **Dummy Players**: Add AI-controlled players

### Connection Settings
- **WebSocket URL**: Configure server address
- **Reconnect**: Force reconnection button
- **Connection Status**: Visual indicator (green/yellow/red)

### Player Settings
- **Player Name**: Change display name
- **Player Color**: Choose from preset colors
- **Deck Selection**: Choose faction deck

## Special Features

### Dummy Players
- AI-controlled players
- Can be added by host
- Auto-generated random decks
- Controlled by all players
- Converted from disconnected players (after timeout)

### Spectator Mode
- Watch games without participating
- See all players' hands
- No interaction with game state

### Auto-Abilities
- Some abilities trigger automatically
- Deploy abilities: Trigger when card placed
- Continuous effects: Ongoing modifications
- Can be toggled in settings

### Card Interactions
- **Drag & Drop**: Move cards between locations
- **Double Click**: Quick actions (play, announce, details)
- **Right Click**: Context menu with options
- **Click**: Select for targeting

## Localization

### Supported Languages
- **English** (en)
- **Russian** (ru)
- **Serbian** (sr)

### Translation System
- React Context for language state
- All UI text translatable
- Card names and abilities translated
- Language selection in Settings
