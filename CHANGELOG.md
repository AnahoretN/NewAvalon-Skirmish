# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-06-14

### Fixed
- **Line Selection Visual Sync (P2P)**: Fixed line selection targeting modes not broadcasting to other players
  - Affected abilities: Signal Prophet Deploy, Code Keeper Deploy, Unwavering Integrator Setup, Zius Setup, IP Dept Agent Setup
  - Previously: Line selection highlights were only visible locally, not synchronized across players
  - Now: All line selection modes properly broadcast targeting mode with board targets to all players
  - SELECT_LINE_FOR_SUPPORT_COUNTERS, SELECT_LINE_FOR_THREAT_COUNTERS, SELECT_LINE_FOR_EXPLOIT_SCORING now call setTargetingMode
- **Line Selection Offset Calculation**: Fixed line selection highlights being cut off at edges
  - Previously: boardTargets were generated from 0 to gridSize-1 without accounting for board offset
  - Now: boardTargets use full board coordinates with proper offset calculation
  - This fixes the issue where edge cells in lines were not highlighted for remote players
- **Starting Hero Mulligan**: Fixed Hero card mulligan when no other Heroes remain in deck
  - Previously: When only one Hero existed in deck, mulligan was blocked
  - Now: Hero card mulligans as normal card when no other Heroes available in deck
  - Maintains flexibility while preserving Starting Hero rule intent

## [0.4.1] - 2026-06-12

### Changed
- **Stun Mechanic Overhaul**: Removed movement restriction from stunned cards
  - Stunned cards can now be moved by effects (both owner's and opponent's)
  - Stun still prevents ability activation (Deploy, Setup, Commit, Passive)
  - Stunned cards still ignored when calculating dynamic statuses (Support, Threat)
  - Updated descriptions in all languages and game rules

- **Patrol Agent & Riot Agent Ability Timing**: Stun placement moved from Commit to Setup phase
  - **Patrol Agent**: Now places Stun in Setup phase instead of Commit
  - **Riot Agent**: Now places Stun in Setup phase instead of Commit



## [0.4.0] - 2026-06-12

### Added
- **Deck Creation System with Resource Stats**: New deck building system with three resources (Cost, Loyalty, Discipline)
  - Each card consumes resources when added to deck
  - Different factions have different starting resource amounts
  - Two-faction decks: resources are averaged and each resource loses 2 points
  - Visual feedback in deck builder showing available/used resources



## [0.3.8] - 2026-05-30

### Added
- **Starting Hero Rule**: New game setting for guaranteed Hero card in starting hand
  - Toggle switch in Game Settings menu (Settings → Game Settings → Starting Hero)
  - When enabled, first card of starting hand is always the topmost Hero type card from deck
  - Hero card is found in deck and placed as first card, remaining 5 cards drawn normally
  - Mulligan system handles Hero cards specially:
    - Mulliganed Hero goes to bottom of deck
    - Next Hero from deck is drawn as replacement
    - If only one Hero exists in deck, cannot mulligan it (prevents losing only Hero)
  - Default: OFF (can be enabled by host before game starts)
  - Translations: English, Russian, Serbian, Belarusian, Ukrainian

## [0.3.7] - 2026-05-23

### Fixed
- **Temporary Cover Command**: Fixed command option not applying Shield status correctly
  - Shield status now properly added to selected cards
  - Visual feedback now shows correctly after command execution

- **Reclaimed Gawain Ability**: Fixed SHIELD_SELF_THEN_RIOT_PUSH mode execution
  - Shield status now correctly applied to self before entering push mode
  - Push targeting mode now activates properly after Shield is applied
  - Fixed ability flow completing both actions in sequence

- **Immunis Resurrect Ability**: Fixed card resurrection from discard
  - Resurrected cards now properly initialize all ready statuses
  - Abilities can now be used correctly after returning to play
  - Fixed card state restoration issues

## [0.3.6] - 2026-05-09

### Fixed
- **IP Agent Threat Scoring**: Fixed row/column highlighting now uses active grid bounds
  - Added IP_AGENT_THREAT_SCORING mode support to GameBoard
  - Fixed missing cell issue in vertical line selection
  - Visual effects now match actual active grid area

- **Targeting Mode Race Condition**: Fixed instant steps clearing targetingMode too early
  - Added abilityMode clearing for instant AUTO_STEPS (e.g., Overwatch Option 2)
  - Prevents visual highlights from persisting after instant action completion
  - Added 500ms debounce to prevent re-setting targetingMode after clear

## [0.3.5] - 2026-05-03

### Fixed
- **Overwatch Command**: Fixed both options now working correctly
  - Option 1: Fixed command card not discarding after revealing cards
  - Option 2: Fixed draw cards mechanic now properly counts Aim tokens
  - Added CLEANUP_COMMAND handling for proper command discard flow
  - Added dynamicResource processing for draw effects
  - Fixed AUTO_STEPS continuation when no hand targets available

- **Ability Execution**: Fixed `handleActionExecution is not a function` error
  - Added missing props to `handleContinueAutoSteps` function
  - Added `getFreshGameState` and `handleActionExecution` to props

## [0.3.4] - 2026-04-25

### Added
- **Game Action Logging**: Complete game history tracking and visualization
  - New GameLogModal component for viewing game history
  - GameLogEntry types for structured action logging
  - Logging utilities in client/utils/gameStateLogger.ts
  - Ability to rewind and review game states
  - Visual timeline of all game actions

- **P2P Connection Settings**: Enhanced WebRTC connection configuration
  - Custom signaling servers support
  - Trystero trackers configuration
  - Primary/Secondary/Tertiary server labels
  - Add/remove custom servers from settings
  - Improved connection management in ConnectionManager

- **New Translations**: Added Belarusian (be) and Ukrainian (uk) locales
  - Complete UI translations for new languages
  - Extended locale types with P2P settings strings

### Fixed
- **DISCARD_FROM_HAND Visual Effect**: Fixed hand card highlights not showing for discard abilities
  - Added check in App.tsx to preserve targetingMode when it has handTargets
  - Updated useVisualEffects to use getter functions for simpleHost/simpleGuest to ensure current values
  - Added hasHandTargets check in clearTargetingMode conditions to prevent premature clearing
  - targetingMode with handTargets (like Faber's discard ability) now persists until card is selected

## [0.3.3] - 2026-04-24

### Fixed
- **Targeting Mode Not Clearing**: Fixed targeting mode not clearing after token placement for dummy players
- **Token Placement Targeting**: Fixed token placement targeting mode showing stale cards from previous ability activation

## [0.3.2] - 2026-04-21

### Fixed
- **Critical Compilation Errors**: Fixed multiple syntax errors preventing build
  - Missing semicolons in GameBoard.tsx (lines 601-606)
  - Incorrect GridCell component type definition - changed from inline type to interface
  - React Hooks violation - moved useMemo out of conditional block (IIFE)
  - Improper hook dependencies causing order mismatch errors

### Added
- **Ready Ability Animation Enhancement**: Improved visual feedback for ready abilities
  - Random delay (0-0.25 seconds) for each card's ability highlight
  - Delay recalculates on phase change for dynamic effect
  - Smooth entrance animation with proper opacity transitions
  - Prevents visual clutter by desynchronizing ability highlights

## [0.3.1] - 2026-04-20

### Changed
- **Deck Selection Visual Feedback**: Improved visual distinction in card selection modals
  - Valid targets: Normal appearance with optional highlight ring
  - Invalid targets: Grayscale (100%) + dimmed (40% brightness)
  - Removed glow effect from invalid targets for clearer visual hierarchy
  - Applied to "Select Card from Deck" ability interactions

## [0.3.0] - 2026-04-20

### Added
- **Virtual Units (VU) System**: Complete dynamic measurement system for responsive UI
  - **1 VU = 0.1% of window height** - fully dynamic scaling based on viewport
  - Interface automatically scales to any screen size (720p - 4K)
  - All elements maintain proportions regardless of window size
  - No media queries needed for basic responsiveness
  - Unified measurement system across entire interface

- **Complete Component Migration**: All 22 UI components migrated to VU system
  - Core components: Card.tsx, GameBoard.tsx, PlayerPanel.tsx, App.tsx
  - Modal windows: BaseModal, DeckViewModal, CardDetailModal, CommandModal, CountersModal, TokensModal
  - UI elements: Header, Tooltip, ContextMenu, TeamAssignmentModal, JoinGameModal
  - Animations: ClickWave effects, box-shadows, translateY values
  - Image optimization: Dynamic Cloudinary image sizes based on VU

- **Testing Infrastructure**: Comprehensive VU testing tools
  - VUTestPanel for real-time monitoring (enable with VITE_SHOW_VU_PANEL=true)
  - Automated test suite with runVuTests()
  - Visual overlay debugging tools
  - Performance monitoring for FPS and scaling

### Changed
- **Responsive Design**: Interface now scales seamlessly across all devices
  - Mobile phones (< 640px): Automatic scaling
  - Tablets (640px - 1024px): Optimized layout
  - Desktop (1024px - 1280px): Standard view
  - 4K screens (> 1280px): Enhanced resolution support

- **Performance**: GPU-accelerated animations and CSS calc() optimizations
  - Hardware acceleration for smooth 60 FPS animations
  - CSS calc() expressions processed natively by browser
  - Reduced JavaScript recalculations

- **Developer Experience**: Simplified responsive design workflow
  - Single VU measurement system replaces multiple media queries
  - Consistent sizing across all components
  - Easy to add new components with VU classes

## [0.2.13] - 2026-04-14

### Added
- **Play Button for Command Cards**: Added play button functionality for command cards
  - Command cards can now be played directly from hand using the new play button
  - Improved user experience for command card activation

- **Unified Line Selection System**: Created single file for line selection mechanics
  - Consolidated line selection logic into dedicated module (`shared/utils/lineSelection.ts`)
  - Improved code organization and maintainability
  - Centralized line selection utilities for better consistency across abilities

### Fixed
- **Line Selection Bugs**: Fixed various bugs related to line selection abilities
  - Improved targeting validation for line-based abilities
  - Fixed edge cases in line selection logic
  - Better handling of diagonal line selection

## [0.2.12] - 2026-03-13

### Fixed
- **Recon Drone Commit Ability**: Fixed multi-step targeting flow for Recon Drone's Commit ability
  - Board targeting mode now properly clears when selecting adjacent opponent card
  - Hand card targeting correctly activates after board card selection
  - Ability properly completes after placing Revealed token (readyCommit status removed)
  - Revealed token now correctly targets only face-down cards on battlefield
  - Fixed face-down card validation logic to properly handle undefined values

## [0.2.11] - 2026-03-06

### Added
- **P2P WebRTC System - Fully Completed**: Complete peer-to-peer multiplayer without central server during gameplay
  - **Architecture**: Host player (player 1) becomes the game authority, all other players connect as guests
  - **Connection**: Host shares peer ID via invite link, guests connect directly using PeerJS WebRTC library
  - **State Synchronization**: Host maintains master game state, broadcasts personalized state updates to all guests
  - **Personalized States**: Each player receives custom state view (own hand/deck visible, opponents' cards hidden as placeholders)
  - **Phase Management**: Automatic phase transitions (Preparation → Setup → Main → Commit → Scoring)
  - **Round Management**: Round victory detection, best-of-3 match system, round end modal
  - **Binary Encoding**: ~90% size reduction for card data transmission using baseId only
  - **Visual Effects**: All visual effects synchronized across all players (highlights, floating text, targeting)

- **Global Visual Effects System**: All players now see the same visual feedback
  - **Highlights**: Row/column/cell highlights broadcast to all players when targeting
  - **Floating Text**: Damage numbers, score changes, ability effects visible to everyone
  - **Targeting Mode**: Valid targets highlighted with activating player's color for all players
  - **No-Target Overlay**: Red "X" overlay when ability has no valid targets
  - **Click Waves**: Visual ripple effect when player clicks any game element
  - **Batched Updates**: Floating texts batched for network efficiency with staggered timing

- **Mulligan System**: Pre-game card exchange phase before first turn
  - Activates after all players draw starting hand (6 cards each)
  - 2x3 grid layout displays player's hand face-up
  - Click-to-exchange mechanic: click any card to send it to bottom of deck and draw new card
  - 3 exchange attempts per player, displayed as "[Attempts: 3]" in modal header
  - Attempts counter decrements with each exchange, prevents exchange at 0
  - "Confirm Hand" button shows confirmation progress: "Confirm Hand [X/Y]"
  - First player receives 7th card AFTER all players confirm mulligan
  - Waiting screen shows confirmation status for all players

- **Player Reconnection System**: Automatic reconnection for disconnected players
  - 30-second reconnection window when player disconnects accidentally
  - Reconnection overlay with countdown timer on disconnected player panel
  - Auto-reconnect on page load using saved credentials (localStorage)
  - Guest player cards displayed with player's color as background (no more white placeholders)
  - Intentional exit (Exit button) converts player to dummy immediately
  - Multiple reconnection attempts prevented with ref tracking
  - Connection cleanup on reconnect to prevent duplicate connections

### Changed
- **SimpleHost**: P2P host now handles all game logic previously on server
  - `personalizeForPlayer()` creates custom state views for privacy
  - `broadcastAll()` sends personalized state to each connected guest
  - `applyAction()` routes player actions to appropriate handlers
  - Auto-handling of scoring, phase transitions, round management

- **SimpleGuest**: Guest connection manager for P2P mode
  - Connects to host using peer ID from invite link
  - Sends player actions to host, receives state updates
  - Handles disconnect/reconnect with automatic retry

- **Localization**: Added mulligan-related translations in English, Russian, and Serbian
  - Mulligan modal, instructions, button labels, status messages

## [0.2.10] - 2026-02-15

### Added
- **SimpleWebRTC P2P Mode**: Peer-to-peer WebRTC support for direct player connections
  - Host creates P2P game without requiring external server
  - Guest connects using host's peer ID
  - Direct state synchronization between all players
  - Reconnection support after page reload (sessionStorage)
  - Visual effects broadcasting across P2P connections
  - Phase management and round progression for P2P games

### Changed
- **IP Dept Agent**: Modified ability - now enters "IP_AGENT_THREAT_SCORING" mode instead of direct scoring
- **Threat Analyst**: Now grants Threat ability to own units when they have Support status
  - Units with Threat can destroy cards with owner's Exploit tokens
  - Creates new tactical opportunities with Exploit token interactions
- **Code Cleanup**: Removed unused files and duplicate code
  - Removed `client/unused_host_webrtc_old/` directory
  - Removed `client/webrtc/` old implementation
  - Removed unused hooks: `useContentDatabase.ts`, `useWebRTC.ts`
  - Removed duplicate utilities: `server/utils/boardUtils.ts`, `server/utils/targeting.ts`
  - Removed duplicate `client/utils/webrtcStatePersistence.ts`
- **TypeScript**: Fixed all type errors
  - Added missing `Random` to server `DeckType` enum
  - Added `MODIFY_SCORE` to `AbilityAction` type
  - Unified `WebrtcMessageType` across modules
  - Added type assertions for client/server type compatibility
- **Version**: Updated project version to 0.2.10


## [0.2.8t] - 2026-01-27

### Added
- **Round Management**: Added "Start Round X" button to Round Y Complete modal
  - Resets all player scores to 0
  - Closes the modal
  - Increments round number
  - Prevents modal from reopening immediately after starting new round

### Changed
- **Logging System**: Simplified and centralized logging
  - Removed unnecessary client-side debug logs
  - Server logs now only show session lifecycle events (game creation, player join/leave, game end)
  - Detailed game actions are logged to separate game-specific log files
  - Centralized WebSocket message validation in security.ts

### Fixed
- **handleTriggerHighlight**: Restored missing export in visualEffects.ts


## [0.2.7t] - 2026-01-21

### Added
- **Text Deck Format**: New deck save/load system using plain text format
  - Format: "Nx Card Name" (quantity followed by 'x' and card name)
  - Cards sorted alphabetically
  - Supports localized card names (English, Russian, Serbian)
  - Strict security validation with file size limits (max 10KB) and line length limits (max 200 chars)
  - Input sanitization removing control characters and suspicious patterns
- **Deck Quantity Rules**: Enforced limits per card type
  - Hero and Rarity cards: max 1 per deck
  - Command cards: max 2 per deck
  - Other cards: max 3 per deck
  - Any violation prevents file loading with clear error message

### Changed
- Deck Builder now only supports text format (.txt) for save/load
  - Removed JSON export option
  - Simplified UI with Clear, Load Text, and Save Text buttons
  - Updated button colors: Save Text now matches Close (indigo), Clear matches Load (gray)

### Fixed
- **Critical Card Ownership Bug**: Fixed issue where playing a card from hand would remove the same card from other players' hands/decks
  - Server now checks both card ID AND ownerId when removing duplicates from board/announced slots
  - Cards with same type (same ID) but different owners are now treated independently
  - Client-side moveItem also enhanced with ownerId verification
- **Logistics Chain**: Fixed to NOT advance phase after scoring/selecting diagonal

### Added
- **Universal Targeting Mode System**: Targeting highlights are now synchronized across all players
  - When any player activates an ability requiring targeting, all players see the valid targets highlighted
  - Target highlights use the activating player's color for visual distinction
  - TargetingModeData structure includes playerId, action, sourceCoords, and boardTargets
- **Target Selection Visual Effect**: White ripple animation (1s duration) when a player makes a target selection
  - Broadcast to all players via WebSocket
  - Auto-removes after animation completes
  - Works for both board and hand targets
- **4-Phase Tracker**: Added visual phase tracker showing all 4 phases (Setup/Main/Commit/Scoring)
- **Player-Colored Ready Effects**: Ready ability highlights now use each player's color
  - Card glow effect shows owner's color when ability is ready to activate
  - Inner glow and overlay effects scale with card power (higher power = more visible)
- **Shared Visual Effects**: All visual effects (highlights, floating texts, no-target overlays) are now broadcast to all players

### Changed
- Phase transitions now skip automatically when using certain command cards (e.g., Logistics Chain)


## [0.2.6t] - 2026-01-20

### Fixed
- **ABR Gawain Deploy**: Fixed targeting - can now Aim any card in its line (not just threats)
- **ABR Gawain Shield**: Fixed duplicate Shield status by adding Shield to unique statuses list
- **Reckless Provocateur Deploy**: Fixed swap positions ability - now correctly swaps with adjacent cards
- **Card Click Event Bubbling**: Fixed double-triggering by adding stopPropagation to Card component click handler
- **Auto-Draw System**: Completely refactored to prevent duplicate card draws
  - Auto-draw now only triggers when ENTERING Setup phase from a different phase (Scoring/Main/Commit)
  - No longer draws on game start when beginning in Setup phase
  - No longer draws on page refresh when already in Setup phase
  - Removed duplicate server-side auto-draw from `handleToggleActivePlayer`
  - Starting hand draw changed: all players now draw 6 cards (first player no longer gets 7)
  - First player's extra card now comes from client-side auto-draw on first turn transition

### Added
- **4-Phase Tracker**: Added visual phase tracker showing all 4 phases (Setup/Main/Commit/Scoring)
- **Player-Colored Ready Effects**: Ready ability highlights now use each player's color
  - Card glow effect shows owner's color when ability is ready to activate
  - Inner glow and overlay effects scale with card power (higher power = more visible)
- **Shared Visual Effects**: Highlight effects are now broadcast to all players with player-colored distinction


## [0.2.5t] - 2026-01-03

### Fixed
- **Tunnel Compatibility**: Fixed WebSocket connections dropping when using ngrok or cloudflared tunnels
  - Removed CONNECTION_ESTABLISHED message that was sent immediately on connect
  - Added explicit `app.ws('/', ...)` route before Vite middleware for proper tunnel handshake
  - Server now waits for client to send first message before responding

### Changed
- Version now automatically sourced from `package.json` via virtual Vite module
- Removed hardcoded `client/version.ts` file
- Removed unused `autoJoin` variable from invite link parsing

### Fixed
- Fixed ESLint warnings (removed console.log statements, unused imports)
- Fixed TypeScript type errors


## [0.2.5] - 2025-12-30

### Changed
- **UI/UX Improvements for Remote Player Panels**
  - Unified card sizing: all cards in hand now use aspect-square for consistent square shape
  - Local player hand cards are 15% larger than deck cards
  - Remote player panel resources (deck, discard, showcase, score) sized at 96% of hand card size
  - Score counter uses aspect-square with each button at 1/3 height
  - Removed horizontal gaps between remote player panels for cleaner layout
  - Vertical spacing between resources and hand cards now uses gap-1 (same as between cards)
  - Scrollbar restored for hand cards in remote panels
  - Player name dynamically shrinks to accommodate status icons (star, medal, checkbox)
  - Status icons (active player checkbox, win stars) absolutely positioned in top-right corner
  - Compact color picker for remote panels (smaller, rounded-sm, no arrow icon)
  - Deck select for dummy players moved to header row in remote panels

### Fixed
- Counter icons now load immediately after page refresh by caching in localStorage
- Improved game state restoration on reconnect with playerToken support
- RemoteScore component properly sized to match deck dimensions

### Fixed
- Fixed deck data sync - server now correctly preserves `cards` array with `cardId/quantity` format when receiving deck data from client
- Fixed ability text formatting - `sanitizeString` now preserves newlines (\n) for proper multi-line ability display in tooltips
- Fixed issue where deckFiles were sent without cards array causing empty decks in game sessions

### Added
- GitHub Actions workflow (`.github/workflows/docker.yml`) for automatic Docker builds on push to master
- Docker images now pushed to GitHub Container Registry (`ghcr.io/uz0/newavalonskirmish`)


## [0.2.2] - 2025-12-29

### Fixed
- Fixed Faber and Lucius discard abilities validation - no longer incorrectly show "no target" when player has cards in hand
- Fixed target validation for hand-only actions that require discarding (SELECT_HAND_FOR_DISCARD_THEN_SPAWN, LUCIUS_SETUP, SELECT_HAND_FOR_DEPLOY)
- Fixed Zius ability - now correctly targets only cells in the same row or column as the Exploit target card
- Fixed floating score numbers not displaying - added immediate local state update in triggerFloatingText
- Fixed visual effect broadcasting to prevent duplicates by excluding sender from broadcast
- Fixed token placement mode - now persists on invalid targets instead of closing; only closes on valid target placement, right-click, or clicking outside game areas
- Fixed resurrected cards from discard (Immunis ability) - now properly initialize ready statuses so abilities can be used after returning to play

### Changed
- **Zius ability rework**: Now works like Unwavering Integrator - single-click line selection through the Exploit target card
- Updated Zius ability description in all languages to reflect simplified mechanic
- Auto-phase transition now applies to both Units and Command cards when played from hand during Setup phase
- Floating score numbers display duration set to 2 seconds
  - English: "Deploy: Exploit any card.\nSupport ⇒ Setup: Exploit any card. Gain 1 point for each of your exploits in that line."
  - Russian: "Deploy: Exploit на любую карту.\nSupport ⇒ Setup: Exploit на любую карту. Получите 1 очко за каждый ваш Exploit в этой линии."
  - Serbian: "Deploy: Exploit na bilo koju kartu.\nSupport ⇒ Setup: Exploit na bilo koju kartu. Dobij 1 bod za svaki tvoj Exploit u ovoj liniji."

### Added
- New ability mode: `ZIUS_LINE_SELECT` - single-click line selection anchored at target card position
- Special case handling in `checkActionHasTargets` for hand-only actions requiring discard
- Token ownership system: tokens from token panel are owned by active player, tokens from abilities owned by card owner
- Any player can now control dummy player's cards/tokens when dummy is the active player


## [0.2.1] - 2025-12-26

### Fixed
- Fixed IP Dept Agent Support ability - now targets any card in hand with Reveal token from same player
- Fixed Setup abilities - now only work in Setup phase (phase 0), not in Main phase
- Fixed Patrol Agent Setup ability - now properly consumes ready status when used
- Fixed Maria "Eleftheria" Damanaki Setup ability - now only works in Setup phase
- Fixed card movement - all card statuses (including ready statuses) are now preserved when moving cards on the board
- Fixed Secret Informant deploy ability - decks now properly highlight when selecting a target
- Fixed React Hooks order violation in DeckViewModal - all hooks now defined before early return

### Changed
- **Ability System Overhaul**: Replaced global ability flags with card-based ready status system (readyDeploy, readySetup, readyCommit)
- Setup abilities now work only in Setup phase (phase 0) instead of Setup + Main phases (phases 0-1)
- Main phase (phase 1) is now for manual actions only, no phase abilities
- **Content Loading Refactor**: Moved content database loading from client import to server API
- Client now fetches card/token/counter data from `/api/content/database` endpoint
- Removed client-side `contentDatabase.json` - now served exclusively by server
- Improved drag-and-drop: cards can now be dragged from deck/discard/top-deck views directly to board or hand
- `allowHandTargets` added to AbilityAction type for targeting cards in hand

### Added
- Dynamic version display in main menu - version is now sourced from `client/version.ts`
- Auto-draw feature enabled by default for all players
- Auto-draw and auto-abilities settings persist in localStorage
- Auto-phase transition: when playing a unit from hand in Setup phase with auto-abilities enabled, game automatically transitions to Main phase
- Visual ready status indicators on cards showing which abilities are available
- Deck selection highlighting (cyan glow) for abilities that target decks (Secret Informant)
- Server-side targeting utilities (`server/utils/targeting.ts`) with validation logic
- Toggle auto-draw handler (`handleToggleAutoDraw`) for per-player auto-draw settings
- New locale: Serbian (Српски) with complete UI and rules translation
- `client/version.ts` - centralized version constant

### Removed
- `client/utils/boardUtils.ts` - moved to server
- `client/utils/commandLogic.ts` - moved to server
- `client/utils/targeting.ts` - moved to server
- `client/content/contentDatabase.json` - now served from server


## [0.2.0] - 2025-12-24

### Fixed
- Fixed CodeRabbit issues: tsconfig path alias, board bounds checking, type mismatches
- Fixed DeckType import to use value import instead of type import
- Added MAX_DECK_SIZE constant export and usage
- Removed unused variables and imports across multiple files
- Fixed player lookup in websocket to use playerId instead of ws reference
- Fixed message type from LEAVE_GAME to EXIT_GAME
- Fixed playerColorMap type to use PlayerColor instead of string
- Improved type safety in GameBoard, PlayerPanel, and other components
- Resolved TypeScript import paths after restructuring
- Fixed duplicate dependency declarations
- Cleaned up root directory to contain only configuration files
- Improved type safety across client and server code
- Added type guards for GameState validation
- Enhanced counter and ability utility functions
- Improved error handling in components

### Changed
- **BREAKING**: Complete project refactoring - split client/server architecture
- Moved frontend code to `/client/` directory
- Moved backend code to `/server/` directory
- Updated build system to use separate TypeScript configs
- Changed client build output from `/docs` to `/dist`
- Replaced tsx with ts-node for server execution
- Enhanced deck validation with proper sanitization
- Improved error handling and type checking throughout codebase
- Updated locale system to include Serbian translation
- Language dropdown now functional (previously disabled)

### Added
- Client TypeScript configuration (`tsconfig.client.json`)
- Server TypeScript configuration (`tsconfig.server.json`)
- Clean separation of client and server codebases
- Modular server architecture with routes, services, and utilities
- Vite proxy configuration for API calls during development
- Enhanced type guards for GameState validation
- Improved null/undefined checks in React components
- Enhanced counter and ability utility functions
- Visual effects handler improvements
- Serbian (Српски) locale support with complete UI and rules translation
- Enabled language selector in Settings modal
- Language changes are saved to localStorage and persist across sessions

### Removed
- Old monolithic project structure
- Unused server-dev.js and old server.js files
- Shared directory - moved types to respective client/server directories

## [0.1.0] - 2024-12-20

### Added
- Initial project setup
- React frontend with TypeScript
- Express server with WebSocket support
- Basic game mechanics
- Card and token content database
