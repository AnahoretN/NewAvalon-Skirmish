import React, { memo, useState, useMemo, useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { GameBoard } from './components/GameBoard'
import { PlayerPanel } from './components/PlayerPanel'
import { Header } from './components/Header'
import { DeckViewModal } from './components/DeckViewModal'
import { TokensModal } from './components/TokensModal'
import { CountersModal } from './components/CountersModal'
import { TeamAssignmentModal } from './components/TeamAssignmentModal'
import { CardDetailModal } from './components/CardDetailModal'
import { RevealRequestModal } from './components/RevealRequestModal'
import { ContextMenu } from './components/ContextMenu'
import { CommandModal } from './components/CommandModal'
import { MainMenu } from './components/MainMenu'
import { RoundEndModal } from './components/RoundEndModal'
import { CounterSelectionModal } from './components/CounterSelectionModal'
import { TopDeckView } from './components/TopDeckView'
import { ReconnectingModal } from './components/ReconnectingModal'
import { ModalsRenderer, ModalsProvider, useModals } from './components/ModalsRenderer'
import { VUTestPanel } from './components/VUTestPanel'
import GameLogModal from './components/GameLogModal'
import { logger } from './utils/logger'
import { useGameState } from './hooks/useGameState'
import { useAppAbilities } from './hooks/useAppAbilities'
import { useAppCommand } from './hooks/useAppCommand'
import { useAppCounters } from './hooks/useAppCounters'
import { useGameLog, createLogDetails } from './hooks/useGameLog'
import { initializeVUBasePixels } from './utils/virtualUnits'
import type {
  Player,
  Card,
  DragItem,
  ContextMenuItem,
  ContextMenuParams,
  CursorStackState,
  CardStatus,
  HighlightData,
  PlayerColor,
  FloatingTextData,
  CommandContext,
  CounterSelectionData,
  AbilityAction,
  GameState,
} from './types'
import { DeckType } from './types'
import { STATUS_ICONS, STATUS_DESCRIPTIONS, PLAYER_COLOR_RGB } from './constants'
import { getCountersDatabase, fetchContentDatabase } from './content'
import { validateTarget, calculateValidTargets, checkActionHasTargets } from '@shared/utils/targeting'
import { getCommandActionByOption, getCommandOptions, isCommandCard } from './utils/autoAbilities'
import { createTargetingActionFromCursorStack, createTargetingActionFromAbilityMode, determineTargetingPlayerId } from './utils/targetingActionUtils'
import { getTokenTargetingRules } from './utils/tokenTargeting'
import { useLanguage } from './contexts/LanguageContext'
import { TIMING, deepCloneState } from './utils/common'
import { getWebRTCEnabled } from './hooks/useWebRTCEnabled'
import { getCardAbilityTypes } from '@server/utils/autoAbilities'

// Inner app component without ModalsProvider
const AppInner = function AppInner() {
  const { t } = useLanguage()

  // Initialize VU system with current viewport height
  useEffect(() => {
    initializeVUBasePixels()

    const handleResize = () => {
      initializeVUBasePixels()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Declare ability state early (needed by useGameState)
  const [abilityMode, setAbilityMode] = useState<AbilityAction | null>(null)
  // CRITICAL: Track pending command card that needs cleanup after abilityMode completes
  const pendingCommandCleanupRef = useRef<{ card: Card; ownerId: number } | null>(null)
  // CRITICAL: Track pending chained actions to prevent race condition
  // When a chained action is being processed, the action queue should wait
  const pendingChainedActionRef = useRef<boolean>(false)

  const gameStateHook = useGameState({ abilityMode, setAbilityMode })

  const {
    gameState,
    getFreshGameState,
    localPlayerId,
    setLocalPlayerId,
    createLocalGame,
    createGame,
    joinGameViaModal,
    joinAsInvite,
    playerReady,
    assignTeams,
    setGameMode,
    setGamePrivacy,
    setActiveGridSize,
    setDummyPlayerCount,
    updatePlayerName,
    changePlayerColor,
    updatePlayerScore,
    changePlayerDeck,
    loadCustomDeck,
    drawCard,
    drawCardsBatch,
    handleDrop,
    draggedItem,
    setDraggedItem,
    connectionStatus,
    gamesList,
    requestGamesList,
    exitGame,
    disconnectHostAndPeerJS,
    sendAction,
    moveItem,
    updateState,
    shufflePlayerDeck,
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    modifyBoardCardPower,
    addAnnouncedCardStatus,
    removeAnnouncedCardStatus,
    modifyAnnouncedCardPower,
    addHandCardStatus,
    removeHandCardStatus,
    flipBoardCard,
    flipBoardCardFaceDown,
    revealHandCard,
    revealBoardCard,
    requestCardReveal,
    respondToRevealRequest,
    syncGame,
    toggleActivePlayer,
    toggleAutoDraw,
    forceReconnect,
    connectToSignalling,
    isConnectedToSignalling,
    triggerHighlight,
    latestHighlight,
    latestFloatingTexts,
    latestNoTarget,
    triggerNoTarget,
    triggerDeckSelection,
    triggerHandCardSelection,
    triggerClickWave,
    clickWaves,
    syncValidTargets,
    setTargetingMode,
    clearTargetingMode,
    nextPhase,
    prevPhase,
    setPhase,
    markAbilityUsed,
    applyGlobalEffect,
    swapCards,
    transferStatus,
    transferAllCounters,
    transferAllStatusesWithoutException,
    destroyCard,
    recoverDiscardedCard,
    resurrectDiscardedCard,
    spawnToken,
    scoreLine,
    closeRoundEndModal,
    closeRoundEndModalOnly,
    confirmMulligan,
    exchangeMulliganCard,
    resetGame,
    resetDeployStatus,
    scoreDiagonal,
    selectScoringLine,
    removeStatusByType,
    reorderTopDeck,
    reorderCards,
    requestDeckView,
    triggerFloatingText,
    latestDeckSelections,
    latestHandCardSelections,
    // WebRTC props
    webrtcHostId,
    webrtcIsHost,
    connectAsGuest,
    sendFullDeckToHost,
    shareHostDeckWithGuests,
    // Reconnection props
    isReconnecting,
    reconnectProgress,
  } = gameStateHook

  // ============================================================================
  // Logging wrappers for game actions - will be initialized after gameLogHook
  // ============================================================================
  const previousStateRef = useRef<GameState | null>(null)

  const [modalsState, setModalsState] = useState({
    isJoinModalOpen: false,
    isDeckBuilderOpen: false,
    isSettingsModalOpen: false,
    isTokensModalOpen: false,
    isCountersModalOpen: false,
    isRulesModalOpen: false,
    isTeamAssignOpen: false,
  })

  // Mulligan modal control
  const { open: openMulliganModal, close: closeMulliganModal } = useModals()

  const [commandModalCard, setCommandModalCard] = useState<Card | null>(null)
  const [counterSelectionData, setCounterSelectionData] = useState<CounterSelectionData | null>(null)
  const [topDeckViewState, setTopDeckViewState] = useState<{
    targetPlayerId: number;
    isLocked: boolean;
    initialCount: number;
    sourceCard?: Card;
    isDeployAbility?: boolean;
    sourceCoords?: {row: number, col: number};
    shuffleOnClose?: boolean;  // If true, shuffle deck after closing (for search abilities)
    thenDraw?: number;  // Number of cards to draw after closing (for LOOK_AT_TOP_DECK)
  } | null>(null)

  const [modalAnchors, setModalAnchors] = useState({
    tokensModalAnchor: null as { top: number; left: number } | null,
    countersModalAnchor: null as { top: number; left: number } | null,
  })

  // Memoize command options to avoid recalculating on every render
  // This prevents repeated getCommandOptions calls when commandModalCard is open
  const commandOptionsCache = React.useMemo(() => {
    if (!commandModalCard) return { baseId: null, options: [] }
    const baseId = commandModalCard.baseId || commandModalCard.id.split('_')[1] || commandModalCard.id
    const options = getCommandOptions(baseId)
    return { baseId, options }
  }, [commandModalCard?.id, commandModalCard?.baseId])

  const [viewingDiscard, setViewingDiscard] = useState<{
    player: Player;
    isDeckView?: boolean;
    pickConfig?: {
      filterType: string;
      action: 'recover' | 'resurrect';
      targetCoords?: {row: number, col: number};
      isDeck?: boolean
    }
    // Fields for ability-triggered deck view
    sourceCard?: Card;
    isDeployAbility?: boolean;
    sourceCoords?: {row: number, col: number};
    shuffleOnClose?: boolean;
  } | null>(null)

  const [viewingCard, setViewingCard] = useState<{ card: Card; player?: Player } | null>(null)

  const [imageRefreshVersion, setImageRefreshVersion] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('image_refresh_data')
      if (stored) {
        const { version, timestamp } = JSON.parse(stored)
        const twelveHours = 12 * 60 * 60 * 1000
        if (Date.now() - timestamp < twelveHours) {
          return version
        }
      }
    } catch (e) {
    }
    const newVersion = Date.now()
    localStorage.setItem('image_refresh_data', JSON.stringify({ version: newVersion, timestamp: newVersion }))
    return newVersion
  })

  // Mulligan modal control - Handle mulligan modal open/close based on gameState
  useEffect(() => {
    if (gameState.isMulliganActive && gameState.isGameStarted) {
      const localPlayer = gameState.players.find(p => p.id === localPlayerId)
      // Check if all REAL (non-dummy) players have confirmed - dummy players auto-confirm
      const realPlayers = gameState.players.filter(p => !p.isDummy && !p.isSpectator)
      const confirmedCount = realPlayers.filter(p => p.hasMulliganed).length
      const totalPlayers = realPlayers.length
      const allConfirmed = totalPlayers > 0 && confirmedCount === totalPlayers

      // Keep modal open for non-dummy players until ALL players confirm
      // Modal shows waiting state when local player confirmed but others haven't
      if (localPlayer && !localPlayer.isDummy && !allConfirmed) {
        openMulliganModal('mulligan', {
          players: gameState.players,
          localPlayerId,
          playerColorMap: new Map(gameState.players.map(p => [p.id, p.color])),
          imageRefreshVersion,
          onConfirm: confirmMulligan,
          onExchangeCard: exchangeMulliganCard,
          // Pass gameState for fresh data access
          gameState: gameState,
        }, 'xl')
      } else {
        // Close only when all players confirmed or local player is dummy
        closeMulliganModal()
      }
    } else {
      closeMulliganModal()
    }
  }, [gameState.isMulliganActive, gameState.isGameStarted, gameState, localPlayerId, imageRefreshVersion, openMulliganModal, closeMulliganModal, confirmMulligan])

  const [contextMenuProps, setContextMenuProps] = useState<ContextMenuParams | null>(null)
  const [playMode, setPlayMode] = useState<{ card: Card; sourceItem: DragItem; faceDown?: boolean } | null>(null)

  const [highlight, setHighlight] = useState<HighlightData | { row: number; col: number; color: string; duration?: number; timestamp: number } | null>(null)
  const [activeFloatingTexts, setActiveFloatingTexts] = useState<FloatingTextData[] | { id: string; text: string; coords?: { row: number; col: number }; color: string; timestamp: number }[]>([])

  // Track when we last received highlights from server (to prevent clearing them prematurely)
  const [isAutoAbilitiesEnabled, setIsAutoAbilitiesEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('auto_abilities_enabled')
      return saved === null ? true : saved === 'true'
    } catch {
      return true
    }
  })

  // Save auto-abilities setting to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('auto_abilities_enabled', String(isAutoAbilitiesEnabled))
    } catch {
      // Ignore localStorage errors
    }
  }, [isAutoAbilitiesEnabled])

  // Auto-draw is now stored per-player in gameState.players
  const isAutoDrawEnabled = useMemo(() => {
    if (!localPlayerId || !gameState) {
      return false
    }
    const localPlayer = gameState.players.find(p => p.id === localPlayerId)
    return localPlayer?.autoDrawEnabled ?? true // Default to true if not set
  }, [gameState, localPlayerId])

  // Memoize board size to avoid unnecessary effect re-renders
  const boardSize = useMemo(() => gameState?.board?.length ?? 6, [gameState?.board?.length])

  // Save auto-draw setting to localStorage when it changes
  useEffect(() => {
    if (!localPlayerId || !gameState) {
      return
    }
    const localPlayer = gameState.players.find(p => p.id === localPlayerId)
    if (localPlayer && localPlayer.autoDrawEnabled !== undefined) {
      try {
        localStorage.setItem('auto_draw_enabled', String(localPlayer.autoDrawEnabled))
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [localPlayerId, gameState])

  // Hide dummy cards setting - stored in localStorage
  const [hideDummyCards, setHideDummyCards] = useState(() => {
    try {
      const saved = localStorage.getItem('hide_dummy_cards')
      return saved === null ? false : saved === 'true'
    } catch {
      return false
    }
  })

  // Save hideDummyCards setting to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('hide_dummy_cards', String(hideDummyCards))
    } catch {
      // Ignore localStorage errors
    }
  }, [hideDummyCards])

  const [justAutoTransitioned, setJustAutoTransitioned] = useState(false)
  const [actionQueue, setActionQueue] = useState<AbilityAction[]>([])
  const [validTargets, setValidTargets] = useState<{row: number, col: number}[]>([])
  const [validHandTargets, setValidHandTargets] = useState<{playerId: number, cardIndex: number}[]>([])
  const [noTargetOverlay, setNoTargetOverlay] = useState<{row: number, col: number} | null>(null)
  // Local state for highlights - synchronized via WebSocket, NOT via gameState
  const [commandContext, setCommandContext] = useState<CommandContext>({})
  const [abilityCheckKey, setAbilityCheckKey] = useState(0)
  const leftPanelRef = useRef<HTMLDivElement>(null)
  const boardContainerRef = useRef<HTMLDivElement>(null)
  const [sidePanelWidth, setSidePanelWidth] = useState<number | undefined>(undefined)

  const interactionLock = useRef(false)
  // Track sent highlights to avoid duplicate broadcasts

  // Track if we previously had targeting mode to avoid clearing validTargets too aggressively
  const prevHadTargetingModeRef = useRef(false)
  const prevTargetingModePlayerIdRef = useRef<number | undefined>(undefined)

  // Track previous gameState.abilityMode for WebRTC host sync (separate from local abilityMode tracking)
  const prevGameStateAbilityModeRef = useRef<AbilityAction | null>(null)

  // Lifted state for cursor stack to resolve circular dependency
  const [cursorStack, setCursorStack] = useState<CursorStackState | null>(null)

  // Determine the owner of the current mode for highlight color
  // This is used for both board highlights and hand card selection highlights
  const highlightOwnerId = useMemo(() => {
    if (abilityMode?.originalOwnerId !== undefined) {
      return abilityMode.originalOwnerId
    }
    if (abilityMode?.sourceCard?.ownerId !== undefined) {
      return abilityMode.sourceCard.ownerId
    }
    if (cursorStack?.originalOwnerId !== undefined) {
      return cursorStack.originalOwnerId
    }
    if (cursorStack?.sourceCard?.ownerId !== undefined) {
      return cursorStack.sourceCard.ownerId
    }
    if (playMode?.card?.ownerId !== undefined) {
      return playMode.card.ownerId
    }
    if (commandModalCard?.ownerId !== undefined) {
      return commandModalCard.ownerId
    }
    return gameState?.activePlayerId ?? 0
  }, [abilityMode, cursorStack, playMode, commandModalCard, gameState?.activePlayerId])

  const pendingRevealRequest = useMemo(() => {
    if (!localPlayerId || !gameState) {
      return null
    }
    return gameState.revealRequests?.find(req => req.toPlayerId === localPlayerId)
  }, [gameState, localPlayerId])

  const {
    playCommandCard,
    handleCommandConfirm,
    handleCounterSelectionConfirm,
  } = useAppCommand({
    gameState,
    localPlayerId,
    setActionQueue,
    setCommandContext,
    setCommandModalCard,
    setCounterSelectionData,
    moveItem,
    drawCard,
    drawCardsBatch,
    updatePlayerScore,
    removeBoardCardStatus,
    sendAction,
  })

  // Determine if current player is host (needed for gameLogHook)
  const isHost = useMemo(() => localPlayerId === 1, [localPlayerId])

  // Game Log hook (must be before wrapped functions that use it)
  const [isGameLogOpen, setIsGameLogOpen] = useState(false)
  const gameLogHook = useGameLog({
    gameState,
    localPlayerId,
    isHost,
    sendAction: sendAction,
  })

  // Wrapper for nextPhase that sets justAutoTransitioned flag
  // Also forwards forceTurnPass parameter for scoring completion
  const handleNextPhase = useCallback((forceTurnPass?: boolean) => {
    setJustAutoTransitioned(true)
    nextPhase(forceTurnPass)
  }, [nextPhase])

  // ============================================================================
  // Wrapped functions with logging (must be before useAppAbilities)
  // ============================================================================
  // Wrapper for destroyCard with logging
  const destroyCardWithLogging = useCallback((card: Card, boardCoords: { row: number; col: number }) => {
    destroyCard(card, boardCoords)
    gameLogHook.addLogEntry('DESTROY_CARD', createLogDetails.destroyCard(card.name), localPlayerId ?? 0)
  }, [destroyCard, gameLogHook, localPlayerId])

  // Wrapper for spawnToken with logging
  const spawnTokenWithLogging = useCallback((coords: {row: number, col: number}, name: string, ownerId: number) => {
    spawnToken(coords, name, ownerId)
    gameLogHook.addLogEntry('PLACE_TOKEN', createLogDetails.placeToken(name), ownerId)
  }, [spawnToken, gameLogHook, gameState?.players])

  // Wrapper for addBoardCardStatus with logging (placing tokens/counters on cards)
  const addBoardCardStatusWithLogging = useCallback((coords: any, status: any, playerId?: number, count?: number) => {
    addBoardCardStatus(coords, status, playerId, count)
    const ownerId = playerId ?? localPlayerId ?? 0
    const card = gameState?.board[coords.row]?.[coords.col]?.card
    if (card) {
      const targetPlayer = gameState?.players.find(p => p.id === card.ownerId)
      gameLogHook.addLogEntry('PLACE_TOKEN_ON_CARD', createLogDetails.placeTokenOnCard(
        status,
        targetPlayer?.name,
        card.name,
        coords,
        'board'
      ), ownerId)
    }
  }, [addBoardCardStatus, gameLogHook, gameState, localPlayerId])

  // Wrapper for handleCommandConfirm with logging
  const handleCommandConfirmWithLogging = useCallback((optionIndex: number, card: Card) => {
    handleCommandConfirm(optionIndex, card)
    const moduleNumber = optionIndex + 1
    gameLogHook.addLogEntry('COMMAND_OPTION', createLogDetails.commandOption(card.name, `${(t as any)('module')} ${moduleNumber}`), (card.ownerId || localPlayerId) ?? 0)
  }, [handleCommandConfirm, gameLogHook, localPlayerId, t])

  const {
    executeAction,
    handleBoardCardClick,
    handleEmptyCellClick,
    handleHandCardClick,
  } = useAppAbilities({
    gameState,
    getFreshGameState,
    localPlayerId,
    abilityMode,
    setAbilityMode,
    cursorStack,
    setCursorStack,
    commandContext,
    setCommandContext,
    setViewingDiscard,
    triggerNoTarget,
    triggerClickWave,
    triggerDeckSelection,
    playMode,
    setPlayMode,
    setCounterSelectionData,
    interactionLock,
    onAbilityComplete: () => setAbilityCheckKey(prev => prev + 1),
    updateState,
    moveItem,
    drawCard,
    drawCardsBatch,
    updatePlayerScore,
    markAbilityUsed,
    applyGlobalEffect,
    swapCards,
    transferStatus,
    transferAllCounters,
    transferAllStatusesWithoutException,
    destroyCard: destroyCardWithLogging,
    resurrectDiscardedCard,
    spawnToken: spawnTokenWithLogging,
    scoreLine,
    nextPhase: handleNextPhase,
    modifyBoardCardPower,
    addBoardCardStatus: addBoardCardStatusWithLogging,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    resetDeployStatus,
    scoreDiagonal,
    removeStatusByType,
    triggerFloatingText,
    triggerHandCardSelection,
    clearValidTargets: () => setValidTargets([]),
    setTargetingMode,
    clearTargetingMode,
    validTargets,
    sendAction,
    setActionQueue,
    pendingChainedActionRef,
    addLogEntry: (type, details, playerId) => gameLogHook.addLogEntry(type as any, details, playerId),
  })

  const handleAnnouncedCardDoubleClick = (player: Player, card: Card) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }

    const isOwner = player.id === localPlayerId
    const isDummy = !!player.isDummy
    const canControl = isOwner || isDummy

    if (canControl) {
      if (card.deck === DeckType.Command) {
        closeAllModals()
        playCommandCard(card, { card, source: 'announced', playerId: player.id })
        return
      }

      closeAllModals()
      const sourceItem: DragItem = { card, source: 'announced', playerId: player.id }
      setPlayMode({ card, sourceItem, faceDown: false })
    } else {
      setViewingCard({ card, player })
    }
  }

  // Handle scoring line selection when in scoring phase
  const handleScoringLineClick = useCallback((boardCoords: { row: number; col: number }) => {
    // Only allow scoring if we're in scoring step
    if (!gameState.isScoringStep) {
      return
    }

    // Check if player can control scoring:
    // - Either it's their turn (activePlayerId === localPlayerId)
    // - Or the active player is a dummy (any player can control dummies)
    const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
    const isDummyPlayer = activePlayer?.isDummy ?? false
    const canControlScoring = gameState.activePlayerId === localPlayerId || isDummyPlayer

    if (!canControlScoring) {
      return
    }

    // CRITICAL: Convert full board coordinates to active grid coordinates
    // The active grid is centered in the full board, so we subtract the offset
    const totalSize = gameState.board.length
    const offset = Math.floor((totalSize - gameState.activeGridSize) / 2)
    const activeRow = boardCoords.row - offset
    const activeCol = boardCoords.col - offset

    // Find which scoring line was clicked based on the cell coordinates
    const scoringLines = gameState.scoringLines || []
    const clickedLine = scoringLines.find(line => {
      if (line.lineType === 'row' && line.lineIndex === activeRow) {
        return true
      }
      if (line.lineType === 'col' && line.lineIndex === activeCol) {
        return true
      }
      if (line.lineType === 'diagonal' && activeRow === activeCol) {
        return true
      }
      // Anti-diagonal: row + col = gridSize - 1 (e.g., for 5x5: 0+4=4, 1+3=4, etc.)
      if (line.lineType === 'anti-diagonal') {
        if (activeRow + activeCol === gameState.activeGridSize - 1) {
          return true
        }
      }
      return false
    })

    if (clickedLine) {
      selectScoringLine(clickedLine.lineType, clickedLine.lineIndex)
    }
  }, [gameState.isScoringStep, gameState.activePlayerId, gameState.scoringLines, gameState.activeGridSize, gameState.board.length, gameState.players, localPlayerId, selectScoringLine])

  // Create a wrapper for handleEmptyCellClick that includes scoring line handling
  const handleEmptyCellClickWithScoring = useCallback((boardCoords: { row: number; col: number }) => {
    // Check if this is a scoring line click
    if (gameState.isScoringStep) {
      // Check if player can control scoring
      const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
      const isDummyPlayer = activePlayer?.isDummy ?? false
      const canControlScoring = gameState.activePlayerId === localPlayerId || isDummyPlayer

      if (canControlScoring) {
        handleScoringLineClick(boardCoords)
        return
      }
    }
    // Otherwise, use the original handler
    handleEmptyCellClick(boardCoords)
  }, [gameState.isScoringStep, gameState.activePlayerId, gameState.players, localPlayerId, handleScoringLineClick, handleEmptyCellClick])

  // Player status checks (must be before useGameLog which depends on isHost)
  const isSpectator = useMemo(
    () => localPlayerId === null && gameState.gameId !== null,
    [localPlayerId, gameState.gameId],
  )

  const realPlayerCount = useMemo(
    () => gameState.players?.filter(p => !p.isDummy).length || 0,
    [gameState.players],
  )

  const {
    cursorFollowerRef,
    handleCounterMouseDown,
  } = useAppCounters({
    gameState,
    localPlayerId,
    handleDrop,
    markAbilityUsed,
    requestCardReveal,
    interactionLock,
    setCommandContext, // Passed down for False Orders Step 1 recording
    onAction: executeAction, // Pass the executor here
    cursorStack,
    setCursorStack,
    setAbilityMode,
    triggerClickWave,
    clearTargetingMode,
    setActionQueue,
  })

  // ============================================================================
  // Track state changes for logging (scores, round winners, etc.)
  // ============================================================================
  useEffect(() => {
    if (!gameState || !previousStateRef.current || !gameState.isGameStarted) {
      previousStateRef.current = gameState
      return
    }

    const prevState = previousStateRef.current

    // Log score changes
    gameState.players.forEach(player => {
      const prevPlayer = prevState.players.find(p => p.id === player.id)
      if (prevPlayer && player.score !== prevPlayer.score) {
        const delta = player.score - prevPlayer.score
        if (delta !== 0) {
          gameLogHook.addLogEntry('SCORE_POINTS', createLogDetails.scorePoints(delta, player.score), player.id)
        }
      }
    })

    // Log round winners
    if (gameState.roundWinners && prevState.roundWinners) {
      const currentRound = gameState.currentRound
      const prevRound = prevState.currentRound
      if (currentRound !== prevRound && prevState.roundWinners[currentRound - 1]) {
        const winners = prevState.roundWinners[currentRound - 1] || []
        const winnerNames = winners.map(id => gameState.players.find(p => p.id === id)?.name).filter(Boolean)
        if (winners.length > 0) {
          gameLogHook.addLogEntry('ROUND_WIN', createLogDetails.roundWin(winners, winnerNames[0]), winners[0])
        }
      }
    }

    // Log match winner
    if (gameState.gameWinner && !prevState.gameWinner) {
      const winner = gameState.players.find(p => p.id === gameState.gameWinner)
      if (winner) {
        gameLogHook.addLogEntry('MATCH_WIN', createLogDetails.matchWin(winner.name), winner.id)
      }
    }

    previousStateRef.current = gameState
  }, [gameState, gameLogHook])

  // ============================================================================
  // Wrapped functions with logging
  // ============================================================================
  const drawCardWithLogging = useCallback((playerId?: number) => {
    const targetId = playerId ?? localPlayerId

    // Call original function first
    drawCard(playerId)

    // Log after a short delay to let state update
    setTimeout(() => {
      gameLogHook.addLogEntry('DRAW_CARD', createLogDetails.drawCard((t as any)('aCard')), targetId ?? localPlayerId ?? 0)
    }, 50)
  }, [drawCard, localPlayerId, gameLogHook, t])

  const drawCardsBatchWithLogging = useCallback((playerId: number, count: number) => {
    drawCardsBatch(playerId, count)
    gameLogHook.addLogEntry('DRAW_MULTIPLE_CARDS', createLogDetails.drawMultipleCards(count), playerId)
  }, [drawCardsBatch, gameLogHook])

  const updatePlayerScoreWithLogging = useCallback((playerId: number, delta: number) => {
    updatePlayerScore(playerId, delta)
  }, [updatePlayerScore])

  const shufflePlayerDeckWithLogging = useCallback((playerId?: number) => {
    shufflePlayerDeck(playerId)
    const targetId = playerId ?? localPlayerId
    gameLogHook.addLogEntry('SHUFFLE_DECK', {}, targetId)
  }, [shufflePlayerDeck, localPlayerId, gameLogHook])

  // Enhanced handleDrop with logging
  const handleDropWithLogging = useCallback((item: DragItem, target: any) => {
    const result = handleDrop(item, target)

    // Log card plays
    if (target.target === 'board' && item.source === 'hand' && item.card) {
      gameLogHook.addLogEntry('PLAY_CARD', createLogDetails.playCard(
        item.card.name,
        target.boardCoords
      ), item.playerId)
    } else if (target.target === 'board' && item.source === 'board' && item.card) {
      // Moving card on board
      gameLogHook.addLogEntry('MOVE_CARD', createLogDetails.moveCard(
        item.card.name,
        undefined, undefined,
        item.boardCoords, // fromCoords
        target.boardCoords // toCoords
      ), item.playerId)
    } else if (target.target === 'announced' && item.card) {
      gameLogHook.addLogEntry('ANNOUNCE_CARD', createLogDetails.announceCard(item.card.name), item.playerId)
    } else if (target.target === 'discard' && item.card) {
      gameLogHook.addLogEntry('DISCARD_CARD', createLogDetails.discardCard(item.card.name), item.playerId)
    } else if (target.target === 'hand' && item.card) {
      gameLogHook.addLogEntry('RETURN_TO_HAND', createLogDetails.returnToHand(item.card.name), item.playerId)
    }

    return result
  }, [handleDrop, gameLogHook])

  const localPlayer = useMemo(
    () => gameState?.players?.find(p => p.id === localPlayerId),
    [gameState?.players, localPlayerId],
  )

  // isGameActive now uses a more stable check that prevents flickering
  // during state updates. We check if localPlayerId exists in the players array
  // rather than requiring the localPlayer object itself (which can lag behind
  // due to useMemo timing issues).
  const isGameActive = useMemo(
    () => {
      // Check if local player exists in the players array (more stable than localPlayer object)
      const localPlayerExists = localPlayerId !== null && gameState?.players?.some(p => p.id === localPlayerId)
      const active = gameState?.gameId && (localPlayerExists || isSpectator)

      // Debug logging for WebRTC P2P restore
      // if (getWebRTCEnabled()) {
      //   logger.debug('[isGameActive] Check:', {
      //     hasGameId: !!gameState?.gameId,
      //     gameId: gameState?.gameId,
      //     localPlayerExists,
      //     localPlayerId,
      //     hasIsSpectator: isSpectator,
      //     playersCount: gameState?.players?.length || 0,
      //     isActive: active
      //   })
      // }
      return active
    },
    [gameState?.gameId, gameState?.players, localPlayerId, isSpectator],
  )

  // Auto-disconnect host mode and PeerJS when returning to main menu
  const wasGameActiveRef = useRef(false)
  useEffect(() => {
    // Check if we just transitioned from active game to main menu
    if (wasGameActiveRef.current && !isGameActive) {
      // Disconnect host and PeerJS connections
      disconnectHostAndPeerJS()
    }
    wasGameActiveRef.current = !!isGameActive
  }, [isGameActive, disconnectHostAndPeerJS])

  // PERFORMANCE: Use useRef to track player colors and only update when they actually change
  // This prevents unnecessary re-renders of components that depend on playerColorMap
  const playerColorMapRef = useRef<Map<number, PlayerColor>>(new Map())
  const prevPlayersRef = useRef<string>('')

  const playerColorMap = useMemo(() => {
    const currentPlayers = gameState?.players || []

    // Create a signature of player IDs and their colors
    const playersSignature = currentPlayers
      .map(p => `${p.id}:${p.color}`)
      .sort()
      .join('|')

    // Only recreate Map if player colors actually changed
    if (prevPlayersRef.current !== playersSignature) {
      prevPlayersRef.current = playersSignature
      const newMap = new Map<number, PlayerColor>()

      // Validate player colors before adding to map
      const validColors: PlayerColor[] = ['blue', 'purple', 'red', 'green', 'yellow', 'orange', 'pink', 'brown']

      currentPlayers.forEach(p => {
        if (p.color && validColors.includes(p.color)) {
          newMap.set(p.id, p.color)
        } else {
          // Use fallback color (blue) for players with invalid colors
          newMap.set(p.id, 'blue')
        }
      })

      playerColorMapRef.current = newMap
    }

    return playerColorMapRef.current
  }, [gameState?.players])

  // Sort players by turn order relative to local player
  // Turn order is circular: startingPlayerId -> (startingPlayerId+1) -> ... -> last -> first -> startingPlayerId
  // Right panel shows: player after local (top), then next, ..., player before local (bottom)
  const sortedPlayers = useMemo(() => {
    if (!gameState?.players || !localPlayerId) {
      return gameState?.players || []
    }

    const localPlayerIndex = gameState.players.findIndex(p => p.id === localPlayerId)
    if (localPlayerIndex === -1) {
      return gameState.players
    }

    // Before game starts, show players in ID order (no turn order yet)
    const gameStarted = !!gameState.isGameStarted && gameState.startingPlayerId !== undefined
    if (!gameStarted) {
      return [...gameState.players].sort((a, b) => a.id - b.id)
    }

    // After game starts, use turn order relative to local player
    // Sort players by ID to ensure consistent order
    const playersById = [...gameState.players].sort((a, b) => a.id - b.id)

    // Find starting player position
    const startingId = gameState.startingPlayerId!
    const startingIndex = playersById.findIndex(p => p.id === startingId)

    // Create circular turn order starting from startingPlayerId
    // For example: if startingPlayerId=3 and players are [1,2,3,4], turn order is [3,4,1,2]
    const turnOrder = [
      ...playersById.slice(startingIndex),  // starting player and those after
      ...playersById.slice(0, startingIndex) // wrap around to beginning
    ]

    // Find local player's position in the turn order
    const localIndex = turnOrder.findIndex(p => p.id === localPlayerId)

    // Players after local in turn order (next players)
    const playersAfterLocal = turnOrder.slice(localIndex + 1)

    // Players before local in turn order (previous players)
    const playersBeforeLocal = turnOrder.slice(0, localIndex)

    // Return all players except local, in turn order:
    // first those who come after local, then those who come before local
    return [...playersAfterLocal, ...playersBeforeLocal]
  }, [gameState?.players, localPlayerId, gameState?.isGameStarted, gameState?.startingPlayerId])

  const isTargetingMode = useMemo(
    () => !!abilityMode || !!cursorStack,
    [abilityMode, cursorStack],
  )

  const handleDeckClick = useCallback((targetPlayerId: number) => {
    // Check both local abilityMode and synchronized targetingMode
    const isLocalDeckSelect = abilityMode?.mode === 'SELECT_DECK'
    const isTargetingModeDeckSelect = gameState.targetingMode?.isDeckSelectable === true

    if (isLocalDeckSelect || isTargetingModeDeckSelect) {
      // Use abilityMode if available (host), otherwise use targetingMode (client)
      const modeData = abilityMode || gameState.targetingMode
      if (!modeData) {
        return
      }

      // For abilityMode (AbilityAction), sourceCard is directly on the object
      // For targetingMode (TargetingModeData), sourceCard is in the action property
      const sourceCard = abilityMode ? (abilityMode.sourceCard) : (gameState.targetingMode?.action?.sourceCard)
      const isDeployAbility = abilityMode?.isDeployAbility
      const sourceCoords = modeData.sourceCoords

      // Request full deck data for viewing opponent's deck in P2P mode
      if (targetPlayerId !== localPlayerId) {
        requestDeckView(targetPlayerId)
      }

      // Trigger deck selection effect visible to all players via WebSocket
      triggerDeckSelection(targetPlayerId, gameState.activePlayerId ?? localPlayerId ?? 1)
      // Get count from payload (for abilityMode) or from action.payload (for targetingMode)
      const cardCount = abilityMode?.payload?.count ||
                        gameState.targetingMode?.action?.payload?.count ||
                        3
      // Get thenDraw from payload (for LOOK_AT_TOP_DECK)
      const thenDraw = abilityMode?.payload?.thenDraw ??
                       gameState.targetingMode?.action?.payload?.thenDraw

      setTopDeckViewState({
        targetPlayerId,
        isLocked: true,
        initialCount: cardCount,
        ...(sourceCard && { sourceCard }),
        ...(isDeployAbility !== undefined && { isDeployAbility }),
        ...(sourceCoords && { sourceCoords }),
        ...(abilityMode?.payload?.shuffleOnClose && { shuffleOnClose: true }),
        ...(thenDraw !== undefined && { thenDraw }),
      })

      // Clear modes
      setAbilityMode(null)
      // Also clear targetingMode explicitly for P2P mode (works for both WebSocket and WebRTC)
      clearTargetingMode()
    }
  }, [abilityMode, gameState.targetingMode, gameState.activePlayerId, localPlayerId, triggerDeckSelection, clearTargetingMode, requestDeckView])

  // CRITICAL: Sync validHandTargets dynamically based on current hand state (not static targetingMode.handTargets)
  // This fixes the issue where Faber's DISCARD_FROM_HAND mode highlights stale cards from when Faber was deployed
  // instead of current cards in hand at ability activation time
  useEffect(() => {
    // Only sync from remote targetingMode if we don't have our own active mode
    // This prevents local abilityMode/cursorStack from being overridden by remote targetingMode
    const hasLocalActiveMode = abilityMode || cursorStack || playMode || commandModalCard

    // CRITICAL: For SELECT_CELL mode (False Orders), always clear handTargets
    // SELECT_CELL should only highlight board cells, not hand cards
    const isSelectCellMode = abilityMode?.mode === 'SELECT_CELL'
    if (isSelectCellMode) {
      setValidHandTargets([])
      return
    }

    if (gameState.targetingMode?.handTargets && !hasLocalActiveMode) {
      // CRITICAL: Don't use static targetingMode.handTargets - they contain stale indices
      // Instead, dynamically compute valid targets based on current hand state
      const targetingPlayerId = gameState.targetingMode.playerId
      const action = gameState.targetingMode.action

      // CRITICAL: Check for restrictions (e.g., False Orders Revealed token)
      // Note: These fields are in action.payload
      const excludedOwnerId = action?.payload?.excludeOwnerId ?? action?.excludeOwnerId
      const onlyOpponents = action?.payload?.onlyOpponents ?? action?.onlyOpponents

      // If targeting player is excluded, don't show their hand
      if (targetingPlayerId === excludedOwnerId) {
        setValidHandTargets([])
      } else {
        // Collect hand targets from all non-excluded players
        const freshHandTargets: {playerId: number, cardIndex: number}[] = []

        for (const player of gameState.players) {
          // Skip excluded player
          if (player.id === excludedOwnerId) {
            continue
          }
          // Skip teammates if onlyOpponents is set
          if (onlyOpponents && excludedOwnerId !== undefined) {
            const excludedPlayer = gameState.players.find(p => p.id === excludedOwnerId)
            if (excludedPlayer && excludedPlayer.teamId !== null && excludedPlayer.teamId === player.teamId) {
              continue
            }
          }

          if (player.hand && player.hand.length > 0) {
            for (let i = 0; i < player.hand.length; i++) {
              freshHandTargets.push({ playerId: player.id, cardIndex: i })
            }
          }
        }

        setValidHandTargets(freshHandTargets)
      }
    } else if (!gameState.targetingMode?.handTargets && !hasLocalActiveMode) {
      // Clear validHandTargets when targetingMode is cleared (no longer has handTargets)
      // This ensures remote players see targeting highlights cleared when token is placed
      // Note: Local cursorStack/abilityMode will re-populate validHandTargets in the next useEffect cycle
      setValidHandTargets([])
    } else if (hasLocalActiveMode) {
      // CRITICAL: When we have a local active mode (cursorStack, abilityMode, etc.),
      // populate validHandTargets from cursorStack if targeting hand cards
      // This fixes the issue where REVEAL_ENEMY_CHAINED creates cursorStack but validHandTargets is not populated
      if (cursorStack && getTokenTargetingRules(cursorStack.type).allowHand) {
        // Validate targets based on cursorStack constraints
        const actorId = gameState.activePlayerId ?? localPlayerId ?? 0
        const freshHandTargets: {playerId: number, cardIndex: number}[] = []

        gameState.players.forEach(p => {
          p.hand.forEach((card, index) => {
            const constraints = {
              ...(cursorStack.targetOwnerId !== undefined && { targetOwnerId: cursorStack.targetOwnerId }),
              ...(cursorStack.excludeOwnerId !== undefined && { excludeOwnerId: cursorStack.excludeOwnerId }),
              onlyOpponents: cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1),
              ...(cursorStack.onlyFaceDown !== undefined && { onlyFaceDown: cursorStack.onlyFaceDown }),
              ...(cursorStack.targetType && { targetType: cursorStack.targetType }),
              ...(cursorStack.requiredTargetStatus && { requiredTargetStatus: cursorStack.requiredTargetStatus }),
              tokenType: cursorStack.type,
            }

            const isValid = validateTarget(
              { card, ownerId: p.id, location: 'hand' },
              constraints,
              actorId,
              gameState.players,
              cursorStack.originalOwnerId,
            )

            if (isValid) {
              freshHandTargets.push({ playerId: p.id, cardIndex: index })
            }
          })
        })

        setValidHandTargets(freshHandTargets)
      } else if (!cursorStack && !abilityMode && !playMode && !commandModalCard) {
        // No local active mode - clear validHandTargets
        setValidHandTargets([])
      }
    }
  }, [
    gameState.targetingMode?.handTargets,
    gameState.targetingMode?.timestamp,
    gameState.targetingMode?.playerId,
    gameState.players,
    abilityMode,
    cursorStack,
    playMode,
    commandModalCard
  ])

  const handleTopDeckReorder = useCallback((playerId: number, newTopCards: Card[]) => {
    reorderTopDeck(playerId, newTopCards)
  }, [reorderTopDeck])

  const handleTopDeckMoveToBottom = useCallback((cardIndex: number) => {
    if (!topDeckViewState) {
      return
    }
    const targetPlayer = gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
    if (!targetPlayer || targetPlayer.deck.length <= cardIndex) {
      return
    }

    const cardToMove = targetPlayer.deck[cardIndex]
    if (!cardToMove) {
      return
    }

    moveItem({
      card: cardToMove,
      source: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      cardIndex: cardIndex,
    }, {
      target: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      deckPosition: 'bottom',
    })
  }, [topDeckViewState, gameState.players, moveItem])

  const handleTopDeckMoveToHand = useCallback((cardIndex: number) => {
    if (!topDeckViewState) {
      return
    }
    const targetPlayer = gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
    if (!targetPlayer || targetPlayer.deck.length <= cardIndex) {
      return
    }

    const cardToMove = targetPlayer.deck[cardIndex]
    if (!cardToMove) {
      return
    }

    moveItem({
      card: cardToMove,
      source: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      cardIndex: cardIndex,
    }, {
      target: 'hand',
      playerId: topDeckViewState.targetPlayerId,
    })
  }, [topDeckViewState, gameState.players, moveItem])

  const handleTopDeckMoveToDiscard = useCallback((cardIndex: number) => {
    if (!topDeckViewState) {
      return
    }
    const targetPlayer = gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
    if (!targetPlayer || targetPlayer.deck.length <= cardIndex) {
      return
    }

    const cardToMove = targetPlayer.deck[cardIndex]
    if (!cardToMove) {
      return
    }

    moveItem({
      card: cardToMove,
      source: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      cardIndex: cardIndex,
    }, {
      target: 'discard',
      playerId: topDeckViewState.targetPlayerId,
    })
  }, [topDeckViewState, gameState.players, moveItem])

  const handleTopDeckPlay = useCallback((cardIndex: number) => {
    if (!topDeckViewState) {
      return
    }
    const targetPlayer = gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
    if (!targetPlayer || targetPlayer.deck.length <= cardIndex) {
      return
    }

    const card = targetPlayer.deck[cardIndex]
    if (!card) {
      return
    }

    setTopDeckViewState(null)

    const sourceItem: DragItem = {
      card,
      source: 'deck',
      playerId: topDeckViewState.targetPlayerId,
      cardIndex,
    }
    setPlayMode({ card, sourceItem, faceDown: false })
  }, [topDeckViewState, gameState.players, setPlayMode])

  const handleTopDeckClose = useCallback(() => {
    if (topDeckViewState) {
      const playerId = topDeckViewState.targetPlayerId

      // Shuffle deck if required by the search ability
      if (topDeckViewState.shuffleOnClose) {
        shufflePlayerDeckWithLogging(playerId)
      }

      if (topDeckViewState.isLocked && topDeckViewState.sourceCard) {
        if (topDeckViewState.sourceCard.ownerId !== undefined) {
          // Use thenDraw if specified, otherwise draw 1 card (default behavior)
          const drawCount = topDeckViewState.thenDraw ?? 1
          for (let i = 0; i < drawCount; i++) {
            drawCardWithLogging(topDeckViewState.sourceCard.ownerId)
          }
        }
        if (topDeckViewState.sourceCoords) {
          markAbilityUsed(topDeckViewState.sourceCoords, topDeckViewState.isDeployAbility)
        }
      }
    }
    setTopDeckViewState(null)
  }, [topDeckViewState, drawCard, markAbilityUsed, shufflePlayerDeck])

  const topDeckPlayer = useMemo(() => {
    if (!topDeckViewState) {
      return null
    }
    return gameState.players.find(p => p.id === topDeckViewState.targetPlayerId)
  }, [topDeckViewState, gameState.players])

  useLayoutEffect(() => {
    const handleResize = () => {
      const headerHeight = 56
      const availableHeight = window.innerHeight - headerHeight
      const boardWidth = availableHeight

      const availableWidth = window.innerWidth
      const remainingX = (availableWidth - boardWidth) / 2

      setSidePanelWidth(Math.max(0, remainingX))
    }

    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Load content database from server on mount
  useEffect(() => {
    let mounted = true

    fetchContentDatabase().then(() => {
      // After loading, if counters are now available, trigger a re-render
      // This ensures STATUS_ICONS are properly loaded for status displays
      if (mounted && Object.keys(getCountersDatabase()).length > 0) {
        setImageRefreshVersion(prev => prev + 1)
      }
    }).catch(() => {
      })

    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const handleGlobalClickCapture = (e: MouseEvent) => {
      if (interactionLock.current) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    window.addEventListener('click', handleGlobalClickCapture, true)
    return () => window.removeEventListener('click', handleGlobalClickCapture, true)
  }, [])

  useEffect(() => {
    const handleCancelInteraction = () => {
      if (abilityMode?.sourceCoords && abilityMode.sourceCoords.row >= 0) {
        markAbilityUsed(abilityMode.sourceCoords, abilityMode.isDeployAbility, false, abilityMode.readyStatusToRemove)
      }
      if (cursorStack?.sourceCoords && cursorStack.sourceCoords.row >= 0) {
        markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
      }

      // Robust cleanup for ALL controlled players (Local + Dummies)
      gameState.players.forEach(p => {
        // Check if we have permission to control this player (Local or Dummy if we are Host/involved)
        if ((p.id === localPlayerId || p.isDummy) && p.announcedCard) {
          moveItem({
            card: p.announcedCard,
            source: 'announced',
            playerId: p.id,
          }, {
            target: 'discard',
            playerId: p.id,
          })
        }
      })

      setCursorStack(null)
      setPlayMode(null)
      setAbilityMode(null)
      setViewingDiscard(null)
      setCommandModalCard(null)
      setActionQueue([])
      setCommandContext({})
      setCounterSelectionData(null)
      setTopDeckViewState(null)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        if (gameState.isGameStarted) {
          nextPhase()
        }
      }
      if (e.key === 'Escape') {
        handleCancelInteraction()
      }
    }

    const handleRightClick = (e: MouseEvent) => {
      if (cursorStack || playMode || abilityMode) {
        e.preventDefault()
        handleCancelInteraction()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('contextmenu', handleRightClick)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('contextmenu', handleRightClick)
    }
  }, [cursorStack, playMode, abilityMode, markAbilityUsed, gameState.isGameStarted, nextPhase, localPlayer, moveItem, gameState.players, localPlayerId])

  // Synchronize NO TARGET Overlay via WebSocket Signal
  useEffect(() => {
    if (latestNoTarget) {
      setNoTargetOverlay(latestNoTarget.coords)
      const timer = setTimeout(() => setNoTargetOverlay(null), TIMING.NO_TARGET_DURATION)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [latestNoTarget])

  // Mark command card as used when playMode completes (for Quick Response Team)
  const prevPlayModeRef = useRef<{ card: Card; sourceItem: any; faceDown?: boolean } | null>(null)
  useEffect(() => {
    // When playMode goes from non-null to null and there's a pending command card
    if (prevPlayModeRef.current && !playMode && commandContext.pendingCommandCard) {
      const { sourceCoords, isDeployAbility, readyStatusToRemove } = commandContext.pendingCommandCard
      if (sourceCoords && sourceCoords.row >= 0) {
        markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      }
      // Clear the pending command card
      setCommandContext((prev: any) => {
        const { pendingCommandCard, ...rest } = prev
        return rest
      })
    }
    prevPlayModeRef.current = playMode
  }, [playMode, commandContext.pendingCommandCard, markAbilityUsed, setCommandContext])

  // Handle command card from token panel - open modal when card appears in announced
  const pendingCommandFromTokenPanelRef = useRef<string | null>(null)
  useEffect(() => {
    if (!localPlayerId || !gameState?.players) {
      return
    }

    const localPlayer = gameState.players.find(p => p.id === localPlayerId)
    if (!localPlayer?.announcedCard) {
      pendingCommandFromTokenPanelRef.current = null
      return
    }

    const card = localPlayer.announcedCard
    const cardId = card.id

    // Only auto-process if we're explicitly waiting for this card from token panel
    // If ref is null or different, the card was placed by other means (playCommandCard, drag-and-drop, etc.)
    // Those should handle their own modal opening
    if (pendingCommandFromTokenPanelRef.current !== cardId) {
      return
    }

    // We've been waiting for this card - open the modal
    pendingCommandFromTokenPanelRef.current = null

    // Note: baseId is already camelCase from database, don't convert to lowercase
    const baseId = card.baseId || card.id.split('_')[1] || card.id
    const commandOptions = getCommandOptions(baseId)

    // Check if command has options using the new system
    // CRITICAL: Don't reopen modal if actionQueue is active (still processing current command)
    if (commandOptions.length > 0 && !commandModalCard && actionQueue.length === 0) {
      // Command with options - open modal
      // CRITICAL: Use the card's actual owner, NOT localPlayerId
      // This fixes dummy player command activation where local player controls dummy's cards
      setCommandModalCard({ ...card, ownerId: card.ownerId ?? localPlayerId })
    } else if (!commandModalCard) {
      // Command without options (shouldn't happen with current data, but handle gracefully)
      // Execute with first option if available
      if (commandOptions.length === 1) {
        const action = getCommandActionByOption(
          baseId,
          commandOptions[0].optionIndex,
          { ...card, ownerId: card.ownerId ?? localPlayerId },
          gameState,
          card.ownerId ?? localPlayerId,
          { row: -1, col: -1 }
        )
        if (action) {
          setActionQueue([
            action,
            { type: 'GLOBAL_AUTO_APPLY', payload: { cleanupCommand: true, card: card, ownerId: localPlayerId }, sourceCard: card },
          ])
        }
      }
    }
  }, [gameState?.players, localPlayerId, commandModalCard, setCommandModalCard, setActionQueue])

  // Track token status changes for ability readiness recheck
  const tokenHashRef = useRef<string>('')

  // Use refs to avoid infinite loops when setting targeting mode state
  // These track previous targets to prevent unnecessary re-renders
  const prevBoardTargetsRef = useRef<{row: number, col: number}[]>([])
  const prevHandTargetsRef = useRef<{playerId: number, cardIndex: number}[]>([])

  // Reset justAutoTransitioned when phase changes
  useEffect(() => {
    setJustAutoTransitioned(false)
  }, [gameState?.currentPhase])

  // Recheck ability readiness when phase changes
  useEffect(() => {
    setAbilityCheckKey(prev => prev + 1)
  }, [gameState?.currentPhase])

  // Recheck ability readiness when Support/Threat tokens change on active player's cards
  useEffect(() => {
    if (!gameState) {return}
    const activePlayerId = gameState.activePlayerId
    if (activePlayerId === undefined) {
      return
    }

    // Count Support and Threat tokens on all active player's cards
    let tokenHash = ''
    gameState.board.forEach(row => {
      row.forEach(cell => {
        if (cell.card?.ownerId === activePlayerId && cell.card.statuses) {
          const supportCount = cell.card.statuses.filter(s => s.type === 'Support').length
          const threatCount = cell.card.statuses.filter(s => s.type === 'Threat').length
          const stunCount = cell.card.statuses.filter(s => s.type === 'Stun').length
          tokenHash += `${cell.card.id}:${supportCount}:${threatCount}:${stunCount};`
        }
      })
    })

    // Use ref to track previous hash and trigger recheck when it changes
    if (tokenHashRef.current !== tokenHash) {
      tokenHashRef.current = tokenHash
      setAbilityCheckKey(prev => prev + 1)
    }
  }, [gameState])

  useEffect(() => {
    // If another player has set targeting mode, don't override with local calculations
    // This allows visual effects from remote players to display correctly
    if (gameState.targetingMode && gameState.targetingMode.playerId !== localPlayerId) {
      return
    }

    // CRITICAL: If abilityMode is null/cleared AND cursorStack is also null, don't set targetingMode
    // This prevents setTargetingMode from being called after ability is complete
    // But allow targetingMode for cursorStack (tokens) even when abilityMode is null
    if (!abilityMode && !cursorStack) {
      return
    }

    // If targeting mode is already set for our ability mode, don't re-set it (prevents infinite loop)
    // Check both action.mode and sourceCoords to ensure we're not re-setting the same targeting
    if (gameState.targetingMode && abilityMode) {
      const sameMode = gameState.targetingMode.action?.mode === abilityMode.mode
      const sameSource = !gameState.targetingMode.sourceCoords || !abilityMode.sourceCoords ||
        (gameState.targetingMode.sourceCoords.row === abilityMode.sourceCoords.row &&
         gameState.targetingMode.sourceCoords.col === abilityMode.sourceCoords.col)
      if (sameMode && sameSource) {
        return
      }
    }

    // CRITICAL: Also check if targetingMode is already set for cursorStack (token targeting)
    // This prevents infinite loop when CREATE_STACK sets targetingMode and gameState updates
    if (gameState.targetingMode && cursorStack && !abilityMode) {
      // Check if the targeting mode is for CREATE_STACK (token targeting)
      const isTokenTargetingMode = gameState.targetingMode.action?.type === 'CREATE_STACK' ||
                                   gameState.targetingMode.action?.mode === 'SELECT_TARGET'
      // Check if the token type matches
      const sameTokenType = gameState.targetingMode.action?.tokenType === cursorStack.type
      if (isTokenTargetingMode && sameTokenType) {
        return
      }
    }

    // PRIORITY: cursorStack overrides abilityMode for visual effects
    // When tokens are active, abilityMode is suppressed
    let effectiveAction: AbilityAction | null = null
    if (cursorStack) {
      // Token mode - create action from cursorStack
      // abilityMode is NOT used (visually suppressed)
      // But ability can modify cursorStack parameters via the cursorStack itself
      effectiveAction = {
        type: 'CREATE_STACK',
        tokenType: cursorStack.type,
        count: cursorStack.count,
        ...(cursorStack.sourceCard && { sourceCard: cursorStack.sourceCard }),
        ...(cursorStack.onlyFaceDown !== undefined && { onlyFaceDown: cursorStack.onlyFaceDown }),
        ...(cursorStack.onlyOpponents !== undefined && { onlyOpponents: cursorStack.onlyOpponents }),
        ...(cursorStack.targetOwnerId !== undefined && { targetOwnerId: cursorStack.targetOwnerId }),
        ...(cursorStack.excludeOwnerId !== undefined && { excludeOwnerId: cursorStack.excludeOwnerId }),
        ...(cursorStack.targetType && { targetType: cursorStack.targetType }),
        ...(cursorStack.requiredTargetStatus && { requiredTargetStatus: cursorStack.requiredTargetStatus }),
        ...(cursorStack.requireStatusFromSourceOwner !== undefined && { requireStatusFromSourceOwner: cursorStack.requireStatusFromSourceOwner }),
        ...(cursorStack.mustBeAdjacentToSource && { mustBeAdjacentToSource: cursorStack.mustBeAdjacentToSource }),
        ...(cursorStack.mustBeInLineWithSource && { mustBeInLineWithSource: cursorStack.mustBeInLineWithSource }),
        ...(cursorStack.maxDistanceFromSource !== undefined && { maxDistanceFromSource: cursorStack.maxDistanceFromSource }),
        ...(cursorStack.maxOrthogonalDistance !== undefined && { maxOrthogonalDistance: cursorStack.maxOrthogonalDistance }),
        ...(cursorStack.sourceCoords && { sourceCoords: cursorStack.sourceCoords }),
      }
    } else if (abilityMode && !cursorStack) {
      // Pure ability mode - only when no tokens active
      effectiveAction = abilityMode
    }

    // Effective actor logic for highlighting valid targets
    let actorId: number | null = localPlayerId || gameState.activePlayerId || null

    // CRITICAL: For cursorStack (tokens), use originalOwnerId as actorId
    // This ensures proper validation (e.g., Revealed token excludes owner's own cards)
    if (cursorStack?.originalOwnerId !== undefined) {
      actorId = cursorStack.originalOwnerId
    } else if (effectiveAction?.sourceCard?.ownerId) {
      actorId = effectiveAction.sourceCard.ownerId
    } else if (effectiveAction?.sourceCoords &&
                 effectiveAction.sourceCoords.row >= 0 &&
                 effectiveAction.sourceCoords.row < boardSize &&
                 effectiveAction.sourceCoords.col >= 0 &&
                 effectiveAction.sourceCoords.col < gameState.board[effectiveAction.sourceCoords.row].length) {
      const sourceCell = gameState.board[effectiveAction.sourceCoords.row][effectiveAction.sourceCoords.col]
      const sourceCard = sourceCell?.card
      if (sourceCard?.ownerId) {
        actorId = sourceCard.ownerId
      }
    } else if (gameState.activePlayerId) {
      const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
      if (activePlayer?.isDummy) {
        actorId = activePlayer.id
      }
    }

    // CRITICAL: Use gameState for calculateValidTargets
    // This ensures filters see tokens added in previous steps of multi-step commands (e.g., Data Interception)
    const boardTargets = effectiveAction ? calculateValidTargets(effectiveAction, gameState, actorId ?? null, commandContext) : []
    const handTargets: {playerId: number, cardIndex: number}[] = []

    // Handle playMode - highlight empty board cells for unit placement
    if (playMode && !abilityMode && !cursorStack) {
      const card = playMode.card
      const isUnit = card?.types?.includes('Unit')

      if (isUnit) {
        // Find all empty cells on the board within the active grid size
        const activeRows = gameState.board.slice(0, boardSize)
        activeRows.forEach((row, r) => {
          const activeCols = row.slice(0, row.length)
          activeCols.forEach((cell, c) => {
            if (!cell.card) {
              boardTargets.push({ row: r, col: c })
            }
          })
        })
      }
    }

    // Handle commandModalCard - calculate valid targets for command card actions
    if (commandModalCard && !abilityMode && !cursorStack) {
      const player = gameState.players.find(p => p.id === commandModalCard.ownerId)
      if (player?.announcedCard?.id === commandModalCard.id) {
        // Use cached command options to avoid repeated database lookups
        const { baseId, options: commandOptions } = commandOptionsCache

        if (commandOptions.length > 0) {
          // For commands with options, calculate targets for ALL options
          const freshGameState = getFreshGameState ? getFreshGameState() : gameState
          try {
            commandOptions.forEach((option) => {
              const action = getCommandActionByOption(
                baseId,
                option.optionIndex,
                commandModalCard,
                freshGameState,
                commandModalCard.ownerId!,
                { row: -1, col: -1 }
              )
              if (action) {
                const targets = calculateValidTargets(action as any, freshGameState as any, commandModalCard.ownerId!, commandContext)
                targets.forEach(t => {
                  if (!boardTargets.some(bt => bt.row === t.row && bt.col === t.col)) {
                    boardTargets.push(t)
                  }
                })
              }
            })
          } catch (e) {
            // If we can't calculate targets, that's ok - modal is open for selection
          }
        }
      }
    }

    // CRITICAL: abilityMode targets are ONLY calculated when cursorStack is NOT active
    // When tokens are being placed (cursorStack), abilityMode is suppressed visually
    // The ability may still modify cursorStack parameters, but doesn't add its own targets
    // NOTE: Hand targets for SELECT_TARGET modes are now handled via GLOBAL targetingMode only
    // This is set in actionExecutionHandler.ts and synchronized across all players
    // Local handTargets calculation has been removed to prevent unsynchronized highlights

    // Handle cursorStack - process BEFORE setting validHandTargets
    // Uses universal token targeting rules from countersDatabase
    if (cursorStack) {
      const tokenRules = getTokenTargetingRules(cursorStack.type)
      if (!tokenRules.allowHand) {
        handTargets.length = 0 // Clear handTargets - tokens like Exploit/Aim/Stun/Shield can't go on hand cards
      } else {
        gameState.players.forEach(p => {
          p.hand.forEach((card, index) => {
            const constraints = {
              ...(cursorStack.targetOwnerId !== undefined && { targetOwnerId: cursorStack.targetOwnerId }),
              ...(cursorStack.excludeOwnerId !== undefined && { excludeOwnerId: cursorStack.excludeOwnerId }),
              onlyOpponents: cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1),
              ...(cursorStack.onlyFaceDown !== undefined && { onlyFaceDown: cursorStack.onlyFaceDown }),
              ...(cursorStack.targetType && { targetType: cursorStack.targetType }),
              ...(cursorStack.requiredTargetStatus && { requiredTargetStatus: cursorStack.requiredTargetStatus }),
              tokenType: cursorStack.type,
            }

            const isValid = validateTarget(
              { card, ownerId: p.id, location: 'hand' },
              constraints,
              actorId,
              gameState.players,
              cursorStack.originalOwnerId, // CRITICAL: Pass token owner ID for command cards
            )

            if (isValid) {
              handTargets.push({ playerId: p.id, cardIndex: index })
            }
          })
        })
      }
    }
    // Line selection modes - only active when cursorStack is NOT active
    if (abilityMode && !cursorStack && (abilityMode.mode === 'SCORE_LAST_PLAYED_LINE' || abilityMode.mode === 'SELECT_LINE_END' || abilityMode.mode === 'ZIUS_LINE_SELECT')) {
      const gridSize = boardSize
      if (abilityMode.sourceCoords) {
        // Highlight horizontal line (same row)
        for (let c = 0; c < gridSize; c++) {
          boardTargets.push({ row: abilityMode.sourceCoords.row, col: c })
        }
        // Highlight vertical line (same column)
        for (let r = 0; r < gridSize; r++) {
          boardTargets.push({ row: r, col: abilityMode.sourceCoords.col })
        }
      } else {
        for (let r = 0; r < gridSize; r++) {
          for (let c = 0; c < gridSize; c++) {
            boardTargets.push({ row: r, col: c })
          }
        }
      }
    }

    // Use universal targeting mode system to sync targets to all players
    // This ensures all players see the same visual highlights
    //
    // PRIORITY RULES:
    // 1. cursorStack (tokens) ALWAYS has priority over abilityMode for visual effects
    //    - When tokens are active, only token targeting logic applies
    //    - abilityMode is suppressed visually but can modify token behavior via cursorStack params
    // 2. abilityMode (abilities) only when cursorStack is not active
    //    - Pure ability targeting without tokens
    // 3. playMode for unit placement
    // 4. commandModal for command cards
    //
    const hasPlayMode = playMode && playMode.card?.types?.includes('Unit')
    const hasCommandModal = !!commandModalCard
    const hasActiveMode = cursorStack || abilityMode || hasPlayMode || hasCommandModal
    const isDeckSelectableMode = abilityMode?.mode === 'SELECT_DECK'

    // CRITICAL: Don't override targetingMode if it's already set with handTargets (DISCARD_FROM_HAND abilities)
    // These abilities set targetingMode in actionExecutionHandler.ts with pre-calculated handTargets
    // We should preserve them instead of recalculating and potentially clearing them
    const isHandTargetingMode = gameState.targetingMode?.handTargets &&
                                gameState.targetingMode.handTargets.length > 0 &&
                                gameState.targetingMode.action?.payload?.actionType === abilityMode?.payload?.actionType

    // Check if targets actually changed before setting state
    const boardTargetsChanged = JSON.stringify(boardTargets) !== JSON.stringify(prevBoardTargetsRef.current)
    const handTargetsChanged = JSON.stringify(handTargets) !== JSON.stringify(prevHandTargetsRef.current)

    if (isHandTargetingMode) {
      // Targeting mode with handTargets is already set correctly - skip re-setting
      // This prevents DISCARD_FROM_HAND visual effects from being cleared
      // CRITICAL: Still update validTargets for UI highlights, but don't call setTargetingMode
      if (boardTargetsChanged) {
        setValidTargets(boardTargets)
        prevBoardTargetsRef.current = boardTargets
      }
      const handTargetsToUse = gameState.targetingMode?.handTargets ?? []
      if (JSON.stringify(handTargetsToUse) !== JSON.stringify(prevHandTargetsRef.current)) {
        setValidHandTargets(handTargetsToUse)
        prevHandTargetsRef.current = handTargetsToUse
      }
      return undefined
    }

    // Only update state if targets actually changed
    if (boardTargetsChanged) {
      setValidTargets(boardTargets)
      prevBoardTargetsRef.current = boardTargets
    }
    // CRITICAL: For SELECT_CELL mode (False Orders), never show hand targets
    // SELECT_CELL should only highlight board cells, not hand cards
    if (abilityMode?.mode === 'SELECT_CELL') {
      if (handTargetsChanged) {
        setValidHandTargets([])
        prevHandTargetsRef.current = []
      }
    } else {
      if (handTargetsChanged) {
        setValidHandTargets(handTargets)
        prevHandTargetsRef.current = handTargets
      }
    }

    if (hasActiveMode && (boardTargets.length > 0 || handTargets.length > 0 || isDeckSelectableMode)) {
      // Determine the action to use for targeting mode
      // CRITICAL: cursorStack has priority over abilityMode
      let targetingAction: AbilityAction | null = null
      let sourceCoords: { row: number; col: number } | undefined = undefined

      if (cursorStack && actorId !== null) {
        // Token mode - create action from cursorStack
        // abilityMode is suppressed visually but can modify cursorStack parameters
        targetingAction = createTargetingActionFromCursorStack(cursorStack, gameState, actorId)
        sourceCoords = cursorStack.sourceCoords
      } else if (playMode && abilityMode) {
        targetingAction = createTargetingActionFromAbilityMode(abilityMode)
      } else if (commandModalCard && abilityMode) {
        targetingAction = createTargetingActionFromAbilityMode(abilityMode)
      } else if (abilityMode) {
        // Pure ability mode (no tokens active)
        targetingAction = abilityMode
        sourceCoords = abilityMode.sourceCoords
      }

      if (targetingAction && actorId !== null) {
        const targetingPlayerId = determineTargetingPlayerId(
          commandModalCard,
          abilityMode,
          cursorStack,
          gameState,
          localPlayerId,
          actorId,
          boardSize
        )

        // CRITICAL: Line selection modes use abilityMode + handleLineSelection for their interaction
        // They should NOT use setTargetingMode() which sends ABILITY_ACTIVATED to host
        // This prevents immediate processing when guest clicks on a line
        const isLineSelectionMode = targetingAction.mode === 'SCORE_LAST_PLAYED_LINE' ||
                                   targetingAction.mode === 'SELECT_LINE_END' ||
                                   targetingAction.mode === 'ZIUS_LINE_SELECT'

        if (!isLineSelectionMode) {
          // CRITICAL: For SELECT_CELL mode, never pass handTargets - only board targets
          // SELECT_CELL is for selecting empty cells on the board, NOT cards in hand
          const finalHandTargets = targetingAction.mode === 'SELECT_CELL' ? [] : handTargets

          // Pass pre-calculated boardTargets and handTargets to avoid recalculating (important for line modes and hand targeting)
          setTargetingMode(targetingAction, targetingPlayerId, sourceCoords, boardTargets, commandContext, finalHandTargets)
        } else {
          // For line selection modes, only set local validTargets - don't call setTargetingMode
          // The line selection is handled via handleLineSelection in lineSelectionHandlers.ts
        }
      }
    } else if (!hasActiveMode) {
      // Clear targeting mode ONLY if it belongs to the local player AND no cursorStack is active
      // CRITICAL: Don't clear targeting mode if cursorStack is active (e.g., placing tokens)
      // CRITICAL: Don't clear targeting mode if it has handTargets (DISCARD_FROM_HAND abilities)
      // Targeting mode will be cleared when token is placed (in handCardHandlers.ts)
      const hasHandTargets = gameState.targetingMode?.handTargets && gameState.targetingMode.handTargets.length > 0
      if (gameState.targetingMode?.playerId === localPlayerId && !cursorStack && !hasHandTargets) {
        clearTargetingMode()
      }
      // Also clear valid hand targets to remove highlights
      if (!hasHandTargets) {
        setValidHandTargets([])
      }
    }

    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abilityMode, cursorStack, playMode, commandModalCard, gameState.board, gameState.players, localPlayerId, commandContext, gameState.activePlayerId, setTargetingMode, clearTargetingMode])


  // Sync valid hand targets and deck selectability to other players
  useEffect(() => {
    const activePlayerId = gameState.activePlayerId

    // Only the active player should broadcast valid targets
    if (!activePlayerId || activePlayerId !== localPlayerId) {
      return
    }

    // Check if we have valid hand targets or deck selectability
    const hasValidHandTargets = validHandTargets.length > 0
    const isDeckSelectableMode = abilityMode?.mode === 'SELECT_DECK'

    if (!hasValidHandTargets && !isDeckSelectableMode) {
      // No valid targets to sync - could send empty array to clear, but for now just skip
      return
    }

    // Sync valid targets to other players
    syncValidTargets({
      validHandTargets,
      isDeckSelectable: isDeckSelectableMode,
    })
  }, [abilityMode, abilityMode?.mode, validHandTargets, gameState.activePlayerId, localPlayerId, syncValidTargets])

  // Clear valid targets when cursorStack is cleared (all tokens used)
  useEffect(() => {
    if (!cursorStack && !abilityMode && !playMode) {
      // No active mode - clear all target highlights
      setValidTargets([])
      setValidHandTargets([])
    }
  }, [cursorStack, abilityMode, playMode])

  // Clear targetingMode when abilityMode transitions from active to null (Deploy ability completion)
  // This ensures targeting highlights are cleared on all clients when Deploy finishes
  // CRITICAL: Don't auto-clear if cursorStack is active (e.g., Vigilant Spotter placing Revealed token)
  // CRITICAL: Don't auto-clear if targetingMode has handTargets (DISCARD_FROM_HAND abilities)
  const prevAbilityModeRef = useRef<AbilityAction | null>(null)
  useEffect(() => {
    const hadAbilityMode = prevAbilityModeRef.current !== null
    const hasAbilityMode = abilityMode !== null

    if (hadAbilityMode && !hasAbilityMode) {
      // Ability mode was just cleared - check if it was a Deploy ability or any ability that set targeting mode
      // CRITICAL: Only clear targeting mode if cursorStack is NOT active
      // If cursorStack is active, targeting mode will be cleared when token is placed (in handCardHandlers.ts)
      const targetingPlayerId = gameState.targetingMode?.playerId
      const targetingPlayer = targetingPlayerId
        ? gameState.players.find(p => p.id === targetingPlayerId)
        : null
      const isTargetingModeOwnerDummy = targetingPlayer?.isDummy ?? false
      // CRITICAL: Don't clear targetingMode if it has handTargets (DISCARD_FROM_HAND abilities like Faber)
      // These targeting modes are managed separately and should only be cleared when a card is selected
      const hasHandTargets = gameState.targetingMode?.handTargets && gameState.targetingMode.handTargets.length > 0

      if ((gameState.targetingMode?.playerId === localPlayerId || isTargetingModeOwnerDummy) && !cursorStack && !hasHandTargets) {
        clearTargetingMode()
      }
    }

    prevAbilityModeRef.current = abilityMode
  }, [abilityMode, gameState.targetingMode?.playerId, gameState.targetingMode?.handTargets, gameState.players, localPlayerId, clearTargetingMode, cursorStack])


  useEffect(() => {
    if (latestHighlight) {
      setHighlight(latestHighlight)
      const timer = setTimeout(() => setHighlight(null), TIMING.HIGHLIGHT_DURATION)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [latestHighlight])

  useEffect(() => {
    if (latestFloatingTexts && latestFloatingTexts.length > 0) {
      // Convert P2P format to FloatingTextData format
      const newTexts = latestFloatingTexts.map(ft => {
        const base = {
          id: `float_${Date.now()}_${Math.random()}`,
          text: ft.text,
          timestamp: ft.timestamp || Date.now()
        }
        // Check if it's P2P format (has coords) or FloatingTextData format (has row, col)
        if ('coords' in ft && ft.coords) {
          // P2P format - use playerId 0 as default, color is handled separately
          return { ...base, row: ft.coords.row, col: ft.coords.col, playerId: 0, _color: (ft as any).color }
        } else if ('row' in ft && 'col' in ft) {
          // FloatingTextData format
          return { ...base, row: ft.row, col: ft.col, playerId: ft.playerId }
        }
        // Fallback - include _color if present
        return { ...base, _color: (ft as any).color }
      }) as Array<FloatingTextData | { id: string; text: string; row?: number; col?: number; playerId?: number; _color?: string; timestamp: number }>

      // CRITICAL FIX: Clear previous floating texts before adding new ones
      // This prevents floating texts from multiple scorings from being visible simultaneously
      setActiveFloatingTexts(newTexts as any)

      const timer = setTimeout(() => {
        setActiveFloatingTexts((prev: any) => prev.filter((item: any) => !newTexts.find((nt: any) => nt.id === item.id)))
      }, 2000)

      return () => clearTimeout(timer)
    }
    return undefined
  }, [latestFloatingTexts])

  // Sync gameState.floatingTexts with activeFloatingTexts for P2P mode
  // This handles floating texts from trigger abilities (like Vigilant Spotter)
  useEffect(() => {
    if (gameState.floatingTexts && gameState.floatingTexts.length > 0) {
      // Generate unique IDs for the new floating texts
      const newTextsWithIds = gameState.floatingTexts.map(ft => ({
        ...ft,
        id: ft.id || `ft-${ft.timestamp}-${Math.random().toString(36).substr(2, 9)}`
      }))

      // Add new floating texts from gameState
      setActiveFloatingTexts((prev: any) => {
        const existing = prev as FloatingTextData[]
        return [...existing, ...newTextsWithIds]
      })

      // Clear floating texts from gameState after processing
      gameState.floatingTexts = []

      // Remove floating texts after animation completes (2 seconds)
      const timer = setTimeout(() => {
        setActiveFloatingTexts((prev: any) => (prev as any[]).filter((item: any) => !newTextsWithIds.find((nt: any) => nt.id === item.id)))
      }, 2000)

      return () => clearTimeout(timer)
    }
    return undefined
  }, [gameState.floatingTexts])

  // Sync validTargets with gameState.targetingMode for WebRTC P2P mode
  // When gameState.targetingMode changes, update validTargets to show highlights
  useEffect(() => {
    if (gameState.targetingMode) {
      // Extract boardTargets from targetingMode and update local state
      const boardTargets = gameState.targetingMode.boardTargets || []
      setValidTargets(boardTargets)

      // CRITICAL: If cursorStack is active, use its targeting rules instead of gameState.targetingMode
      // This ensures Revealed token properly excludes owner's hand and other token-specific rules
      if (cursorStack) {
        const tokenRules = getTokenTargetingRules(cursorStack.type)
        if (!tokenRules.allowHand) {
          // Tokens like Exploit/Aim/Stun/Shield can't go on hand cards
          setValidHandTargets([])
        } else {
          // Token can target hand - use cursorStack targeting rules
          const freshHandTargets: {playerId: number, cardIndex: number}[] = []
          const excludedOwnerId = cursorStack.excludeOwnerId
          const onlyOpponents = cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1)
          const tokenOwnerId = cursorStack.originalOwnerId

          for (const player of gameState.players) {
            // Skip excluded player (token owner's own hand for Revealed)
            if (player.id === excludedOwnerId) {
              continue
            }
            // Skip teammates if onlyOpponents is set
            if (onlyOpponents && excludedOwnerId !== undefined) {
              const excludedPlayer = gameState.players.find(p => p.id === excludedOwnerId)
              if (excludedPlayer && excludedPlayer.teamId !== null && excludedPlayer.teamId === player.teamId) {
                continue
              }
            }

            if (player.hand && player.hand.length > 0) {
              for (let i = 0; i < player.hand.length; i++) {
                const card = player.hand[i]
                // CRITICAL: Check if card already has this token (for uniqueness)
                if (cursorStack.type === 'Revealed') {
                  const hasOurToken = card.statuses?.some(s =>
                    s.type === 'Revealed' && s.addedByPlayerId === tokenOwnerId
                  )
                  if (hasOurToken) {
                    continue
                  }
                }
                freshHandTargets.push({ playerId: player.id, cardIndex: i })
              }
            }
          }

          setValidHandTargets(freshHandTargets)
        }
        // Still mark that we have targeting mode and sync boardTargets
        prevHadTargetingModeRef.current = true
        prevTargetingModePlayerIdRef.current = gameState.targetingMode.playerId
        return
      }

      // CRITICAL: Don't use static targetingMode.handTargets - compute dynamically from current hand
      // This fixes Faber's DISCARD_FROM_HAND showing stale cards
      // ALSO CRITICAL: For SELECT_CELL mode, NEVER show hand targets - only board cells are valid
      const isSelectCellMode = gameState.targetingMode.action?.mode === 'SELECT_CELL'
      if (!isSelectCellMode && gameState.targetingMode.handTargets) {
        const targetingPlayerId = gameState.targetingMode.playerId
        const action = gameState.targetingMode.action

        // CRITICAL: Check if there are restrictions on which hands can be targeted
        // e.g., False Orders Option 0 (Reveal x2) with onlyOpponents/excludeOwnerId
        // Note: These fields are in action.payload (set in actionExecutionHandler.ts)
        const excludedOwnerId = action?.payload?.excludeOwnerId ?? action?.excludeOwnerId
        const onlyOpponents = action?.payload?.onlyOpponents ?? action?.onlyOpponents

        if (targetingPlayerId === excludedOwnerId) {
          // CRITICAL: If targeting player is the excluded owner, don't show their hand as valid targets
          // This fixes False Orders Revealed token highlighting owner's own hand
          setValidHandTargets([])
        } else {
          // Collect hand targets from all players that are not excluded
          const freshHandTargets: {playerId: number, cardIndex: number}[] = []

          for (const player of gameState.players) {
            // Skip excluded player (token owner's own hand)
            if (player.id === excludedOwnerId) {
              continue
            }
            // Skip teammates if onlyOpponents is set
            if (onlyOpponents && excludedOwnerId !== undefined) {
              const excludedPlayer = gameState.players.find(p => p.id === excludedOwnerId)
              if (excludedPlayer && excludedPlayer.teamId !== null && excludedPlayer.teamId === player.teamId) {
                continue
              }
            }

            if (player.hand && player.hand.length > 0) {
              for (let i = 0; i < player.hand.length; i++) {
                freshHandTargets.push({ playerId: player.id, cardIndex: i })
              }
            }
          }

          setValidHandTargets(freshHandTargets)
        }
      } else {
        // Clear hand targets if targeting mode doesn't have any OR is SELECT_CELL mode
        setValidHandTargets([])
      }

      // Mark that we now have targeting mode and whose it is
      prevHadTargetingModeRef.current = true
      prevTargetingModePlayerIdRef.current = gameState.targetingMode.playerId
    } else if (!abilityMode && !cursorStack && !playMode) {
      // Clear validTargets ONLY when we had a targeting mode before and it was cleared
      // AND it was our targeting mode (not another player's)
      if (prevHadTargetingModeRef.current && prevTargetingModePlayerIdRef.current !== localPlayerId) {
        // Don't clear - targeting mode belonged to another player
        return
      }
      if (prevHadTargetingModeRef.current) {
        setValidTargets([])
        setValidHandTargets([])
        prevHadTargetingModeRef.current = false
        prevTargetingModePlayerIdRef.current = undefined
      }
    }
  }, [gameState.targetingMode, gameState.targetingMode?.handTargets, gameState.targetingMode?.timestamp, gameState.targetingMode?.playerId, gameState.players, abilityMode, cursorStack, playMode, localPlayerId])

  // Scoring Phase Logic
  useEffect(() => {
    // Simplified approach: when entering scoring phase, open the scoring mode
    // After player scores, nextPhase passes turn and phase changes to Preparation
    // The phase change naturally closes the scoring mode - no complex tracking needed!

    if (gameState.isScoringStep && !abilityMode) {
      const activePlayerId = gameState.activePlayerId
      const activePlayer = gameState.players.find(p => p.id === activePlayerId)
      // Allow control if it's local player's turn OR if it's a dummy turn (anyone helps dummy)
      const canControl = activePlayer && (activePlayer.id === localPlayerId || activePlayer.isDummy)

      if (canControl) {
        let found = false
        let lastPlayedCoords = null

        // Find the card with LastPlayed status owned by ACTIVE PLAYER
        for (let r = 0; r < boardSize; r++) {
          for (let c = 0; c < boardSize; c++) {
            const cell = gameState.board[r]?.[c]
            const card = cell?.card
            // Check that card belongs to active player AND has LastPlayed status from that player
            if (card?.ownerId === activePlayerId && card?.statuses?.some((s: CardStatus) => s.type === 'LastPlayed' && s.addedByPlayerId === activePlayerId)) {
              lastPlayedCoords = { row: r, col: c }
              found = true
              break
            }
          }
          if (found) {
            break
          }
        }

        if (found && lastPlayedCoords) {
          // Create ability action for scoring line selection
          const scoringAction: AbilityAction = {
            type: 'ENTER_MODE',
            mode: 'SCORE_LAST_PLAYED_LINE',
            sourceCoords: lastPlayedCoords,
          }

          // Check if WebRTC mode
          const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

          if (isWebRTCMode) {
            // In WebRTC mode, host controls scoring mode for all players
            const webrtcManager = (window as any).webrtcManager
            const isHost = (window as any).webrtcIsHost

            if (isHost && webrtcManager?.broadcastToGuests) {
              // Host: set local abilityMode AND broadcast to guests
              setAbilityMode(scoringAction)

              // Calculate boardTargets for the line selection
              const gridSize = boardSize
              const boardTargets: {row: number, col: number}[] = []
              // Highlight horizontal line (same row)
              for (let c = 0; c < gridSize; c++) {
                boardTargets.push({ row: lastPlayedCoords.row, col: c })
              }
              // Highlight vertical line (same column)
              for (let r = 0; r < gridSize; r++) {
                boardTargets.push({ row: r, col: lastPlayedCoords.col })
              }

              // Host broadcasts ABILITY_MODE_SET to all guests
              webrtcManager.broadcastToGuests({
                type: 'ABILITY_MODE_SET',
                senderId: webrtcManager.getPeerId(),
                data: {
                  abilityMode: {
                    ...scoringAction,
                    playerId: activePlayerId,
                    boardTargets,
                  }
                },
                timestamp: Date.now()
              })
            }
            // Guest: Do NOT set abilityMode locally and do NOT request from host
            // The host's phase manager will automatically broadcast ABILITY_MODE_SET
            // when any player (including guest) enters scoring phase
            // Guest just waits for ABILITY_MODE_SET from host
          } else {
            // Non-WebRTC mode (WebSocket server): set local abilityMode
            setAbilityMode(scoringAction)
          }
        } else {
          // No LastPlayed card found (e.g. destroyed), skip scoring.
          // Any player can trigger phase change for dummy active player
          if (activePlayerId === localPlayerId || activePlayer?.isDummy) {
            nextPhase()
          }
        }
      }
    }
  }, [gameState?.isScoringStep, gameState?.activePlayerId, localPlayerId, gameState?.board, abilityMode, nextPhase, gameState?.players, boardSize, gameState?.currentRound, gameState?.turnNumber])

  // Sync local abilityMode with gameState.abilityMode in WebRTC mode (for host)
  // This ensures host sees scoring mode visuals when guest enters scoring phase
  // Use separate ref to avoid infinite loops
  useEffect(() => {
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'
    const isHost = (window as any).webrtcIsHost

    if (isWebRTCMode && isHost) {
      const currentAbilityMode = gameState.abilityMode
      const prevAbilityMode = prevGameStateAbilityModeRef.current

      // Only update if gameState.abilityMode actually changed
      // Compare by stringified JSON to detect actual changes
      const currentModeStr = currentAbilityMode ? JSON.stringify(currentAbilityMode) : ''
      const prevModeStr = prevAbilityMode ? JSON.stringify(prevAbilityMode) : ''

      if (currentModeStr !== prevModeStr) {
        if (currentAbilityMode) {
          // gameState has abilityMode - sync it to local state
          setAbilityMode(currentAbilityMode)
        } else if (abilityMode?.mode === 'SCORE_LAST_PLAYED_LINE') {
          // gameState doesn't have abilityMode but local does - clear it
          setAbilityMode(null)
        }
        // Update ref after handling
        prevGameStateAbilityModeRef.current = currentAbilityMode ?? null
      }
    }
  }, [gameState.abilityMode, abilityMode])

  // Close scoring mode when isScoringStep becomes false
  useEffect(() => {
    if (!gameState.isScoringStep && abilityMode?.mode === 'SCORE_LAST_PLAYED_LINE') {
      setAbilityMode(null)
    }
  }, [gameState?.isScoringStep, abilityMode])

  // Close scoring mode when leaving Scoring phase (4)
  useEffect(() => {
    if (abilityMode?.mode === 'SCORE_LAST_PLAYED_LINE' && gameState.currentPhase !== 4) {
      setAbilityMode(null)
    }
  }, [gameState?.currentPhase, abilityMode])

  useEffect(() => {
    // CRITICAL: Also check pendingChainedActionRef - if a chained action is being processed,
    // wait for it to complete before processing the next action in the queue
    if (actionQueue.length > 0 && !abilityMode && !cursorStack && !pendingChainedActionRef.current) {
      const nextAction = actionQueue[0]
      // DEBUG: Log actionQueue processing
      console.log('[actionQueue] Processing action:', {
        actionQueueLength: actionQueue.length,
        actionType: nextAction.type,
        actionMode: nextAction.mode,
        hasCleanupCommand: nextAction.payload?.cleanupCommand,
        abilityMode,
        cursorStack,
        pendingChainedAction: pendingChainedActionRef.current
      })
      setActionQueue(prev => prev.slice(1))

      // Context Injection Logic for Multi-Step Commands (False Orders / Tactical Maneuver)
      const actionToProcess = { ...nextAction }

      // Only use commandContext if the action explicitly requests it (via useContextCard flag)
      // This prevents actions like Recon Drone's Setup from incorrectly targeting the wrong card
      // Also handle SELECT_UNIT_FOR_MOVE for Data Interception and similar commands
      if (actionToProcess.mode === 'SELECT_CELL' && commandContext.lastMovedCardCoords && actionToProcess.payload?.useContextCard) {
        const { row, col } = commandContext.lastMovedCardCoords
        // Add bounds/null checks before accessing the board
        if (
          typeof row === 'number' && typeof col === 'number' &&
          row >= 0 && row < boardSize &&
          gameState.board[row] &&
          col >= 0 && col < gameState.board[row].length &&
          gameState.board[row][col]
        ) {
          const contextCard = gameState.board[row][col].card
          // If we have a context card on the board, inject it as the source for the move.
          // This is crucial for commands where Step 1 selects a unit and Step 2 moves it.
          if (contextCard) {
            actionToProcess.sourceCard = contextCard
            actionToProcess.sourceCoords = commandContext.lastMovedCardCoords
            // Force recordContext to true so the subsequent step (e.g. Stun in False Orders Mode 2)
            // knows where the card ended up.
            actionToProcess.recordContext = true
          }
        }
      } else if (actionToProcess.mode === 'SELECT_UNIT_FOR_MOVE' && commandContext.lastPlacedToken?.boardCoords) {
        // Data Interception Option 1: Place Exploit token, then move unit with Exploit
        // Inject sourceCoords from the token placement step
        actionToProcess.sourceCoords = commandContext.lastPlacedToken.boardCoords
        actionToProcess.recordContext = true
      }

      const calculateDynamicCount = (factor: string, ownerId: number, baseCount: number = 0) => {
        let count = baseCount
        if (factor === 'Aim') {
          gameState.board.forEach(row => row.forEach(cell => {
            if (cell.card?.statuses) {
              count += cell.card.statuses.filter(s => s.type === 'Aim' && s.addedByPlayerId === ownerId).length
            }
          }))
          // CRITICAL: Also count Aim token from commandContext.lastPlacedToken
          // This fixes Overwatch Option 2 where the Aim token placed in step 1 needs to be counted in step 2
          const justPlaced = commandContext.lastPlacedToken
          if (justPlaced && justPlaced.tokenType === 'Aim' && justPlaced.addedByPlayerId === ownerId && justPlaced.boardCoords) {
            // Check if this token is already counted on the board (it might not be synced yet)
            const alreadyCounted = gameState.board.some(row =>
              row.some(cell => {
                if (cell.card?.statuses && cell.card.id === justPlaced.cardId) {
                  // Count Aim tokens at this location
                  const aimCount = cell.card.statuses.filter(s =>
                    s.type === 'Aim' &&
                    s.addedByPlayerId === ownerId
                  ).length
                  // If we found the card, check if we're at the right coords
                  if (cell.card.id === justPlaced.cardId && cell.row === justPlaced.boardCoords.row && cell.col === justPlaced.boardCoords.col) {
                    return aimCount > 0
                  }
                }
                return false
              })
            )
            if (!alreadyCounted) {
              console.log('[calculateDynamicCount] Adding lastPlaced Aim token to count:', {
                tokenType: justPlaced.tokenType,
                boardCoords: justPlaced.boardCoords,
                addedByPlayerId: justPlaced.addedByPlayerId,
                countBefore: count,
                countAfter: count + 1
              })
              count += 1
            }
          }
        } else if (factor === 'Exploit') {
          gameState.board.forEach(row => row.forEach(cell => {
            if (cell.card?.statuses) {
              count += cell.card.statuses.filter(s => s.type === 'Exploit' && s.addedByPlayerId === ownerId).length
            }
          }))
          // CRITICAL: Also count Exploit token from commandContext.lastPlacedToken
          const justPlaced = commandContext.lastPlacedToken
          if (justPlaced && justPlaced.tokenType === 'Exploit' && justPlaced.addedByPlayerId === ownerId && justPlaced.boardCoords) {
            const alreadyCounted = gameState.board.some(row =>
              row.some(cell => {
                if (cell.card?.statuses && cell.card.id === justPlaced.cardId) {
                  const exploitCount = cell.card.statuses.filter(s =>
                    s.type === 'Exploit' &&
                    s.addedByPlayerId === ownerId
                  ).length
                  if (cell.card.id === justPlaced.cardId && cell.row === justPlaced.boardCoords.row && cell.col === justPlaced.boardCoords.col) {
                    return exploitCount > 0
                  }
                }
                return false
              })
            )
            if (!alreadyCounted) {
              console.log('[calculateDynamicCount] Adding lastPlaced Exploit token to count:', {
                tokenType: justPlaced.tokenType,
                boardCoords: justPlaced.boardCoords,
                addedByPlayerId: justPlaced.addedByPlayerId,
                countBefore: count,
                countAfter: count + 1
              })
              count += 1
            }
          }
        }
        return count
      }

      if (actionToProcess.type === 'GLOBAL_AUTO_APPLY') {
        if (actionToProcess.payload?.cleanupCommand) {
          // CRITICAL: Don't cleanup if there's an active ability mode (AUTO_STEPS, SELECT_TARGET, etc.)
          // The cleanup will be triggered after the ability mode completes
          if (abilityMode) {
            console.log('[cleanupCommand] Skipping cleanup - abilityMode is active:', abilityMode.mode)
            // CRITICAL: Move cleanup to the end of the queue instead of removing it
            // This ensures it will be processed after abilityMode clears
            const cleanupSkipCount = (nextAction as any)._cleanupSkipCount || 0
            if (cleanupSkipCount < 5) {
              ;(nextAction as any)._cleanupSkipCount = cleanupSkipCount + 1
              setActionQueue(prev => [...prev.filter(a => a !== nextAction), nextAction])
              return
            } else {
              console.log('[cleanupCommand] Processing cleanup after 5 skips (abilityMode not clearing)')
            }
          }

          // CRITICAL: Also check if there are still pending non-cleanup actions in the queue
          // This prevents cleanup from executing before command card abilities complete
          // EXCEPTION: Allow cleanup if all remaining actions are from chained actions (detected by missing cleanupCommand in original queue)
          const remainingQueue = actionQueue.slice(1)
          const hasPendingActions = remainingQueue.some(a =>
            !a.payload?.cleanupCommand && // Not a cleanup action
            (a.type !== 'GLOBAL_AUTO_APPLY' || !a.payload?.cleanupCommand)
          )
          // CRITICAL: If cleanup has been skipped multiple times (5+), just process it to prevent infinite loop
          const cleanupSkipCount = (nextAction as any)._cleanupSkipCount || 0
          if (hasPendingActions && cleanupSkipCount < 5) {
            console.log('[cleanupCommand] Skipping cleanup - pending actions in queue:', remainingQueue.map(a => ({ type: a.type, mode: a.mode, hasCleanup: !!a.payload?.cleanupCommand })))
            // Move cleanup to the end of the queue and increment skip count on the actual action object
            ;(nextAction as any)._cleanupSkipCount = cleanupSkipCount + 1
            setActionQueue(prev => [...prev.filter(a => a !== nextAction), nextAction])
            return
          }
          if (cleanupSkipCount >= 5) {
            console.log('[cleanupCommand] Processing cleanup after 5 skips (breaking potential infinite loop)')
          }

          console.log('[cleanupCommand] Processing cleanupCommand:', {
            targetPlayerId: actionToProcess.payload.ownerId,
            sourceCardOwnerId: actionToProcess.sourceCard?.ownerId,
            localPlayerId,
            actionQueueLength: actionQueue.length
          })

          // Robust cleanup: determine target player and use current announced card
          const targetPlayerId = actionToProcess.payload.ownerId !== undefined
            ? actionToProcess.payload.ownerId
            : actionToProcess.sourceCard?.ownerId

          if (targetPlayerId !== undefined) {
            const playerState = gameState.players.find(p => p.id === targetPlayerId)
            // Prefer the card actually sitting in the announced slot
            const cardToDiscard = playerState?.announcedCard || actionToProcess.sourceCard

            console.log('[cleanupCommand] Player and card:', {
              playerState,
              cardToDiscard,
              announcedCard: playerState?.announcedCard
            })

            if (cardToDiscard && cardToDiscard.id !== 'dummy') {
              console.log('[cleanupCommand] Moving card to discard')
              moveItem({
                card: cardToDiscard,
                source: 'announced',
                playerId: targetPlayerId,
              }, {
                target: 'discard',
                playerId: targetPlayerId,
              })
            } else {
              console.log('[cleanupCommand] No valid card to discard')
            }
            // CRITICAL: Return after cleanupCommand to prevent double-processing
            return
          } else {
            console.log('[cleanupCommand] No targetPlayerId found')
          }
        } else if (actionToProcess.payload?.dynamicResource) {
          const { type, factor, baseCount, ownerId: payloadOwnerId } = actionToProcess.payload.dynamicResource
          // Use multiple fallbacks: sourceCard.ownerId, originalOwnerId (set in commandLogic), payload.ownerId, then localPlayerId
          const resourceOwnerId = actionToProcess.sourceCard?.ownerId ?? actionToProcess.originalOwnerId ?? payloadOwnerId ?? localPlayerId
          const count = calculateDynamicCount(factor, resourceOwnerId, baseCount)
          if (type === 'draw' && count > 0) {
            drawCardsBatchWithLogging(resourceOwnerId, count)
          }
        } else if (actionToProcess.payload?.resourceChange) {
          const { draw, score } = actionToProcess.payload.resourceChange
          const activePlayerId = actionToProcess.sourceCard?.ownerId || gameState.activePlayerId
          if (activePlayerId !== undefined && activePlayerId !== null) {
            if (draw) {
              const count = typeof draw === 'number' ? draw : 1
              drawCardsBatchWithLogging(activePlayerId, count)
            }
            if (score) {
              updatePlayerScoreWithLogging(activePlayerId, score)
            }
          }
        } else if (actionToProcess.payload?.contextReward && (actionToProcess.sourceCard || actionToProcess.originalOwnerId || actionToProcess.sourceCoords)) {
          // This is handled inside useAppAbilities now for better access to board state
          // but we call executeAction to trigger it
          // CRITICAL: contextReward (DRAW_MOVED_POWER, SCORE_MOVED_POWER) doesn't require sourceCard
          // It finds the moved card via commandContext and uses its power
          console.log('[actionQueue] Processing contextReward action:', {
            contextReward: actionToProcess.payload.contextReward,
            sourceCardName: actionToProcess.sourceCard?.name || '(no sourceCard)',
            sourceCoords: actionToProcess.sourceCoords,
            originalOwnerId: actionToProcess.originalOwnerId,
            _tempContextId: actionToProcess.payload._tempContextId,
            _sourceCoordsBeforeMove: actionToProcess.payload._sourceCoordsBeforeMove
          })
          executeAction(actionToProcess, actionToProcess.sourceCoords || { row: -1, col: -1 })
        } else if (actionToProcess.payload?.customAction && actionToProcess.sourceCard) {
          // Handle custom actions like FINN_SCORING
          executeAction(actionToProcess, actionToProcess.sourceCoords || { row: -1, col: -1 })
        } else {
          // CRITICAL: Unknown GLOBAL_AUTO_APPLY action - don't let it fall through to executeAction
          // This prevents cleanupCommand and other special actions from being routed incorrectly
          console.warn('[actionQueue] Unknown GLOBAL_AUTO_APPLY action, skipping:', actionToProcess)
          setActionQueue(prev => prev.slice(1))
          return
        }
      } else if (actionToProcess.type === 'CREATE_STACK' ||
                 actionToProcess.type === 'OPEN_MODAL' ||
                 actionToProcess.type === 'ENTER_MODE' ||
                 // Note: GLOBAL_AUTO_APPLY is now handled above with explicit return
                 // actionToProcess.type === 'GLOBAL_AUTO_APPLY' ||
                 actionToProcess.type === 'CONTINUE_AUTO_STEPS') {
        // DIRECTLY EXECUTE the action from the queue.
        // This ensures setTargetingMode is called for hand targeting effects
        // Also handles GLOBAL_AUTO_APPLY (e.g., False Orders Stun x2) correctly
        // Also handles CONTINUE_AUTO_STEPS for command card cleanup
        executeAction(actionToProcess, actionToProcess.sourceCoords || { row: -1, col: -1 })
      } else {
        // Ensure we check targets before blindly setting mode from queue
        const actorId = actionToProcess.sourceCard?.ownerId || localPlayerId
        const hasTargets = checkActionHasTargets(actionToProcess, gameState, actorId, commandContext)


        if (hasTargets) {
          setAbilityMode(actionToProcess)
        } else {
          if (actionToProcess.sourceCoords && actionToProcess.sourceCoords.row >= 0) {
            triggerNoTarget(actionToProcess.sourceCoords)
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionQueue, abilityMode, cursorStack, localPlayerId, drawCard, updatePlayerScore, gameState.activePlayerId, gameState.board, moveItem, commandContext, addBoardCardStatus, gameState.players, executeAction, triggerNoTarget])

  const closeAllModals = useCallback(() => {
    setModalsState(prev => ({
      ...prev,
      isTokensModalOpen: false,
      isCountersModalOpen: false,
      isRulesModalOpen: false,
    }))
    setViewingDiscard(null)
    setViewingCard(null)
    setCommandModalCard(null)
    setCounterSelectionData(null)
    setTopDeckViewState(null)
    setModalAnchors({
      tokensModalAnchor: null,
      countersModalAnchor: null,
    })
  }, [])

  const handleTeamAssignment = useCallback((teamAssignments: Record<number, number[]>) => {
    assignTeams(teamAssignments)
    setModalsState(prev => ({ ...prev, isTeamAssignOpen: false }))
  }, [assignTeams])

  const handleJoinGame = useCallback((gameId: string) => {
    joinGameViaModal(gameId)
    setModalsState(prev => ({ ...prev, isJoinModalOpen: false }))
  }, [joinGameViaModal])

  const handleCreateGame = useCallback(() => {
    createGame()
    setLocalPlayerId(1)
  }, [createGame, setLocalPlayerId])

  const handleSaveSettings = useCallback((url: string) => {
    const trimmedUrl = url.trim()
    const oldUrl = localStorage.getItem('custom_ws_url') || ''

    // Only reconnect if URL actually changed
    if (trimmedUrl !== oldUrl) {
      localStorage.setItem('custom_ws_url', trimmedUrl)
      forceReconnect()
    }
    setModalsState(prev => ({ ...prev, isSettingsModalOpen: false }))
  }, [forceReconnect])

  const handleClearImageCache = useCallback(() => {
    // Increment image refresh version to force reload of all images
    const newVersion = Date.now()
    setImageRefreshVersion(newVersion)
    localStorage.setItem('image_refresh_data', JSON.stringify({ version: newVersion, timestamp: newVersion }))
  }, [])

  // Handle WebRTC host invite link - auto-connect to host
  useEffect(() => {
    const inviteHostId = sessionStorage.getItem('invite_host_id')
    const autoJoinFlag = sessionStorage.getItem('invite_auto_join')

    logger.info('[App] WebRTC invite effect:', {
      inviteHostId,
      autoJoinFlag,
      connectAsGuestAvailable: typeof connectAsGuest === 'function',
      webrtcIsHost
    })

    // Only log if there's actually an invite to process
    if (inviteHostId && autoJoinFlag && typeof connectAsGuest === 'function') {
      // Clear the stored invite data
      sessionStorage.removeItem('invite_host_id')
      sessionStorage.removeItem('invite_auto_join')

      logger.info('[App] Attempting to connect as guest to host:', inviteHostId)

      // Connect to host (async, but we don't need to wait for it here)
      connectAsGuest(inviteHostId)
        .then((success) => {
          logger.info('[App] connectAsGuest result:', success, 'localPlayerId:', localPlayerId)
        })
        .catch((err) => {
          logger.error('[App] connectAsGuest error:', err)
        })
    }
  }, [connectAsGuest]) // Run when connectAsGuest is available

  // Handle invite link - auto-join game as new player or spectator
  // NOTE: For WebRTC P2P mode, use #hostId=... in invite links (not #game=...)
  // The #game=... parameter is reserved for future server mode implementation
  useEffect(() => {
    const inviteGameId = sessionStorage.getItem('invite_game_id')
    const autoJoinFlag = sessionStorage.getItem('invite_auto_join')

    // Only attempt invite join if:
    // 1. We have an invite game ID
    // 2. Connection is established
    // 3. Either we're not in a game, OR the invite game is different from current game
    // 4. We have the auto-join flag (prevents accidental joins when refreshing in an existing game)
    if (inviteGameId && autoJoinFlag && connectionStatus === 'Connected') {
      const shouldJoinAsInvite = !gameState.gameId || gameState.gameId !== inviteGameId

      if (shouldJoinAsInvite) {
        // Clear the stored invite data so we don't try again
        sessionStorage.removeItem('invite_game_id')
        sessionStorage.removeItem('invite_auto_join')

        // Check if this is WebRTC mode - if so, gameId is not a valid host identifier
        const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'
        if (isWebRTCMode) {
          // For WebRTC mode, we need hostId, not gameId
          // The invite link should have #hostId=... instead of #game=...
          logger.warn('[App] Received gameId invite in WebRTC mode - this requires hostId parameter')
          // Don't attempt to join - would cause incorrect connection
          return
        }

        // For server mode (not implemented yet), would use proper join logic here
        // Generate a player name for the invite join
        const playerName = `Player ${Math.floor(Math.random() * 1000)}`
        // Join using joinAsInvite (handles new player or spectator)
        joinAsInvite(inviteGameId, playerName)
      } else {
        // Already in this game, clear invite flags
        sessionStorage.removeItem('invite_game_id')
        sessionStorage.removeItem('invite_auto_join')
      }
    }
  }, [connectionStatus, gameState.gameId, joinAsInvite])

  const handleSyncAndRefresh = useCallback(() => {
    const newVersion = Date.now()
    setImageRefreshVersion(newVersion)
    localStorage.setItem('image_refresh_data', JSON.stringify({ version: newVersion, timestamp: newVersion }))
    syncGame()
  }, [syncGame])

  const handleTriggerHighlight = useCallback((coords: { type: 'row' | 'col' | 'cell', row?: number, col?: number}) => {
    if (localPlayerId === null) {
      return
    }
    triggerHighlight({
      ...coords,
      playerId: localPlayerId,
    })
  }, [localPlayerId, triggerHighlight])

  const closeContextMenu = useCallback(() => setContextMenuProps(null), [])

  const openContextMenu = useCallback((e: React.MouseEvent, type: ContextMenuParams['type'], data: any) => {
    e.preventDefault()
    if (abilityMode || cursorStack || playMode) {
      return
    }
    e.stopPropagation()
    if (localPlayerId === null) {
      return
    }
    setContextMenuProps({ x: e.clientX, y: e.clientY, type, data })
  }, [abilityMode, cursorStack, playMode, localPlayerId])

  const handleDoubleClickBoardCard = (card: Card, boardCoords: { row: number, col: number }) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }
    const isOwner = card.ownerId === localPlayerId
    if (isOwner && card.isFaceDown) {
      flipBoardCard(boardCoords); return
    }
    const owner = card.ownerId ? gameState?.players?.find(p => p.id === card.ownerId) : undefined
    const isRevealedByRequest = card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)
    const isVisibleForMe = !card.isFaceDown || card.revealedTo === 'all' || (Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId!)) || isRevealedByRequest
    if (isVisibleForMe || isOwner) {
      setViewingCard({ card, player: owner })
    } else if (localPlayerId !== null) {
      requestCardReveal({ source: 'board', ownerId: card.ownerId!, boardCoords }, localPlayerId)
    }
  }

  const handleDoubleClickEmptyCell = (_boardCoords: { row: number, col: number }) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }
    // Empty double-click - only click wave effect remains (triggered separately in GameBoard)
    // Thick highlight effect removed per user request
  }

  // Cancels all active modes (abilityMode, cursorStack, playMode, targetingMode)
  // Called by right-click on board or cards
  const handleCancelAllModes = useCallback(() => {
    // Handle Deploy ability cancellation: remove readyDeploy and add phase-specific status
    if (abilityMode && abilityMode.isDeployAbility && abilityMode.sourceCoords) {
      const { row, col } = abilityMode.sourceCoords
      if (row >= 0 && col >= 0) {
        // Clone state to avoid mutation
        const newState = deepCloneState(gameState)
        const card = newState.board[row]?.[col]?.card
        if (card && card.ownerId && card.statuses) {
          // Find if card has readyDeploy
          const hasReadyDeploy = card.statuses.some(s => s.type === 'readyDeploy')
          if (hasReadyDeploy) {
            // Remove readyDeploy
            card.statuses = card.statuses.filter(s => s.type !== 'readyDeploy')
            // Add phase-specific status if conditions are met
            // Note: We DON'T check canActivate here because the card just lost readyDeploy
            // and hasn't gained the phase-specific status yet, so canActivate would return false
            const isActivePlayer = newState.activePlayerId === card.ownerId
            const isStunned = card.statuses.some(s => s.type === 'Stun')

            if (isActivePlayer && !isStunned) {
              // Check which phase-specific status to add using getCardAbilityTypes
              const abilityTypes = getCardAbilityTypes(card as any)
              let phaseStatusToAdd: string | null = null

              if (newState.currentPhase === 1 && abilityTypes.includes('setup')) {
                phaseStatusToAdd = 'readySetup'
              } else if (newState.currentPhase === 3 && abilityTypes.includes('commit')) {
                phaseStatusToAdd = 'readyCommit'
              }

              if (phaseStatusToAdd && !card.statuses.some(s => s.type === phaseStatusToAdd)) {
                card.statuses.push({ type: phaseStatusToAdd, addedByPlayerId: card.ownerId })
              }
            }
            // Update state
            updateState(newState)
          }
        }
      }
    }

    // Clear ability mode
    if (abilityMode) {
      setAbilityMode(null)
    }
    // Clear cursor stack (token placement)
    if (cursorStack) {
      setCursorStack(null)
    }
    // Clear play mode
    if (playMode) {
      setPlayMode(null)
    }
    // CRITICAL: Force clear targeting mode with bypass for right-click cancel
    // This ensures targetingMode is cleared immediately regardless of ownership
    clearTargetingMode(true)
    // Clear valid hand targets
    setValidHandTargets([])
    // Clear valid board targets
    setValidTargets([])
  }, [abilityMode, cursorStack, playMode, clearTargetingMode])

  const handleDoubleClickHandCard = (player: Player, card: Card, cardIndex: number) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }

    if (player.id === localPlayerId || player.isDummy) {
      if (card.deck === DeckType.Command) {
        closeAllModals()
        playCommandCard(card, { card, source: 'hand', playerId: player.id, cardIndex })
        return
      }

      closeAllModals()
      const sourceItem: DragItem = { card, source: 'hand', playerId: player.id, cardIndex }
      setPlayMode({ card, sourceItem, faceDown: false })
    } else if (localPlayerId !== null) {
      const isRevealedToAll = card.revealedTo === 'all'
      const isRevealedToMe = Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId)
      const isRevealedByRequest = card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)
      const isVisible = isRevealedToAll || isRevealedToMe || isRevealedByRequest || !!player.isDummy || !!player.isDisconnected
      if (isVisible) {
        setViewingCard({ card, player })
      } else {
        requestCardReveal({ source: 'hand', ownerId: player.id, cardIndex }, localPlayerId)
      }
    }
  }

  // Handler for command Play button click - same logic as double click
  const handleCommandPlayClick = (player: Player, card: Card, cardIndex: number) => {
    if (abilityMode || cursorStack) {
      return
    }
    if (interactionLock.current) {
      return
    }

    // Only allow card owner or dummy player cards to be played
    if (player.id === localPlayerId || player.isDummy) {
      closeAllModals()
      playCommandCard(card, { card, source: 'hand', playerId: player.id, cardIndex })
    }
  }


  const handleViewDeck = useCallback((player: Player) => {
    // Check if WebRTC is enabled and we're viewing another player's deck
    const isWebRTCMode = getWebRTCEnabled()
    const isOtherPlayerDeck = player.id !== localPlayerId

    // If we're a guest viewing any deck (own or other player's), send our full deck data to host
    // This ensures host has complete card data for deck view synchronization
    if (isWebRTCMode && !webrtcIsHost && localPlayerId !== null) {
      const localPlayer = gameState.players.find(p => p.id === localPlayerId)
      if (localPlayer && localPlayer.deck.length > 0) {
          sendFullDeckToHost(localPlayerId, localPlayer.deck, localPlayer.deck.length)
      }
    }

    // If we're the host viewing our own deck, share deck data with all guests
    // This ensures guests see the host's deck in the same order
    if (isWebRTCMode && webrtcIsHost && player.id === localPlayerId && player.deck.length > 0) {
      shareHostDeckWithGuests(player.deck, player.deck.length)
    }

    if (isWebRTCMode && isOtherPlayerDeck && player.deck.length === 0) {
      // Request full deck data from host
      requestDeckView(player.id)
    }

    setViewingDiscard({ player, isDeckView: true })
  }, [localPlayerId, requestDeckView, sendFullDeckToHost, shareHostDeckWithGuests, gameState.players, webrtcIsHost])
  const handleViewDiscard = useCallback((player: Player) => {
    setViewingDiscard({ player, isDeckView: false })
  }, [])

  const viewingDiscardPlayer = useMemo(() => {
    if (!viewingDiscard) {
      return null
    }
    return gameState.players.find(p => p.id === viewingDiscard.player.id) || viewingDiscard.player
  }, [viewingDiscard, gameState.players])

  // Derived highlighting filter for DiscardModal (Deck Search)
  const highlightFilter = useMemo(() => {
    if (viewingDiscard?.pickConfig?.filterType === 'Unit') {
      return (card: Card) => !!card.types?.includes('Unit')
    }
    if (viewingDiscard?.pickConfig?.filterType === 'Command') {
      return (card: Card) => card.deck === DeckType.Command || !!card.types?.includes('Command')
    }
    if (viewingDiscard?.pickConfig?.filterType === 'Device') {
      return (card: Card) => !!card.types?.includes('Device')
    }
    if (viewingDiscard?.pickConfig?.filterType === 'Optimates') {
      return (card: Card) => !!card.types?.includes('Unit') && !!card.types?.includes('Optimates')
    }
    return undefined
  }, [viewingDiscard?.pickConfig?.filterType])

  // Shared handler for closing deck/discard view with shuffle support
  const handleDeckViewClose = useCallback(() => {
    if (!viewingDiscard) {
      return
    }

    // Shuffle deck if required by the search ability (even when cancelling without selection)
    if (viewingDiscard.shuffleOnClose) {
      shufflePlayerDeckWithLogging(viewingDiscard.player.id)
    }

    // If closing during a card pick/search ability without selecting a card, cancel the ability
    if (viewingDiscard.pickConfig) {
      setViewingDiscard(null)
      setAbilityMode(null)
      return
    }

    // Draw card and mark ability used if triggered by deploy/setup ability
    if (viewingDiscard.isDeployAbility !== undefined && viewingDiscard.sourceCard) {
      if (viewingDiscard.sourceCard.ownerId !== undefined) {
        drawCardWithLogging(viewingDiscard.sourceCard.ownerId)
      }
      if (viewingDiscard.sourceCoords) {
        markAbilityUsed(viewingDiscard.sourceCoords, viewingDiscard.isDeployAbility)
      }
    }

    setViewingDiscard(null)
    setAbilityMode(null)
  }, [viewingDiscard, shufflePlayerDeck, drawCard, markAbilityUsed, setAbilityMode])

  const handleDiscardCardClick = (cardIndex: number) => {
    if (!viewingDiscard || !viewingDiscardPlayer) {
      return
    }

    const { pickConfig } = viewingDiscard

    // Only handle clicks when there's a pickConfig (ability-related card selection)
    // Normal card movement should be done via drag-and-drop
    if (!pickConfig) {
      return
    }

    const { action, isDeck: pickIsDeck } = pickConfig

    if (action === 'recover') {
      // Add to hand
      if (pickIsDeck) {
        moveItem({
          card: viewingDiscardPlayer.deck[cardIndex],
          source: 'deck',
          playerId: viewingDiscardPlayer.id,
          cardIndex,
        }, {
          target: 'hand',
          playerId: viewingDiscardPlayer.id,
        })
      } else {
        recoverDiscardedCard(viewingDiscardPlayer.id, cardIndex)
      }
      // Use shared close handler (handles shuffle if required)
      handleDeckViewClose()
    } else if (action === 'resurrect') {
      // For Immunis: Select card, then close modal to allow cell selection
      if (abilityMode?.mode === 'IMMUNIS_RETRIEVE') {
        setAbilityMode(prev => ({
          ...prev!,
          payload: { ...prev!.payload, selectedCardIndex: cardIndex },
        }))
        setViewingDiscard(null)

        // Set targeting mode for adjacent empty cells
        if (abilityMode?.sourceCoords) {
          const neighbors = [
            { r: abilityMode.sourceCoords.row - 1, c: abilityMode.sourceCoords.col },
            { r: abilityMode.sourceCoords.row + 1, c: abilityMode.sourceCoords.col },
            { r: abilityMode.sourceCoords.row, c: abilityMode.sourceCoords.col - 1 },
            { r: abilityMode.sourceCoords.row, c: abilityMode.sourceCoords.col + 1 },
          ]
          const validTargets = neighbors
            .filter(nb =>
              nb.r >= 0 && nb.r < gameState.activeGridSize &&
              nb.c >= 0 && nb.c < gameState.activeGridSize &&
              !gameState.board[nb.r][nb.c].card
            )
            .map(nb => ({ row: nb.r, col: nb.c }))

          if (validTargets.length > 0) {
            setTargetingMode(abilityMode, gameState.activePlayerId ?? localPlayerId ?? 1, abilityMode.sourceCoords, validTargets)
          }
        }
      } else if (abilityMode?.mode === 'RESURRECT_FROM_DISCARD') {
        // For Finn MW Deploy: Select card, then click empty adjacent cell to place
        setAbilityMode(prev => ({
          ...prev!,
          payload: { ...prev!.payload, selectedCardIndex: cardIndex },
        }))
        setViewingDiscard(null)

        // Set targeting mode for adjacent empty cells
        if (abilityMode?.sourceCoords) {
          const neighbors = [
            { r: abilityMode.sourceCoords.row - 1, c: abilityMode.sourceCoords.col },
            { r: abilityMode.sourceCoords.row + 1, c: abilityMode.sourceCoords.col },
            { r: abilityMode.sourceCoords.row, c: abilityMode.sourceCoords.col - 1 },
            { r: abilityMode.sourceCoords.row, c: abilityMode.sourceCoords.col + 1 },
          ]
          const validTargets = neighbors
            .filter(nb =>
              nb.r >= 0 && nb.r < gameState.activeGridSize &&
              nb.c >= 0 && nb.c < gameState.activeGridSize &&
              !gameState.board[nb.r][nb.c].card
            )
            .map(nb => ({ row: nb.r, col: nb.c }))

          if (validTargets.length > 0) {
            setTargetingMode(abilityMode, gameState.activePlayerId ?? localPlayerId ?? 1, abilityMode.sourceCoords, validTargets)
          }
        }
      }
    }
  }

  const handleDiscardContextMenu = (e: React.MouseEvent, cardIndex: number) => {
    if (!viewingDiscard || !viewingDiscardPlayer) {
      return
    }

    // Determine source type for context menu logic
    const isDeck = viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck
    const type = isDeck ? 'deckCard' : 'discardCard'

    const pile = isDeck ? viewingDiscardPlayer.deck : viewingDiscardPlayer.discard
    const card = pile[cardIndex]

    if (card) {
      openContextMenu(e, type, {
        card,
        player: viewingDiscardPlayer,
        cardIndex,
      })
    }
  }

  const renderedContextMenu = useMemo(() => {
    // ... (Context menu logic same as original)
    if (!contextMenuProps || localPlayerId === null || !gameState) {
      return null
    }
    const { type, data, x, y } = contextMenuProps
    let items: ContextMenuItem[] = []
    if (type === 'emptyBoardCell') {
      // Empty context menu for empty cells
    } else if (type === 'boardItem' || type === 'announcedCard') {
      const isBoardItem = type === 'boardItem'
      let card = isBoardItem ? gameState.board[data.boardCoords.row][data.boardCoords.col].card : data.card
      let player = isBoardItem ? null : data.player
      if (!isBoardItem && player) {
        const currentPlayer = gameState.players?.find(p => p.id === player.id)
        if (currentPlayer) {
          player = currentPlayer; card = currentPlayer.announcedCard || card
        }
      }
      if (!card) {
        setContextMenuProps(null); return null
      }
      const owner = card.ownerId ? gameState.players?.find(p => p.id === card.ownerId) : undefined
      const isOwner = card.ownerId === localPlayerId
      const isDummyCard = !!owner?.isDummy
      const canControl = isOwner || isDummyCard
      const isRevealedByRequest = card.statuses?.some((s: any) => s.type === 'Revealed' && (s.addedByPlayerId === localPlayerId))
      const isVisible = !card.isFaceDown || card.revealedTo === 'all' || (Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId)) || isRevealedByRequest
      // View option: only shown if card is visible (face-up or revealed)
      // Face-down cards show card back to everyone, including owner (owner sees tooltip on hover instead)
      if (isVisible) {
        items.push({ label: t('view'), isBold: true, onClick: () => setViewingCard({ card, player: owner }) })
      }
      if (!isBoardItem && canControl && card.deck === DeckType.Command) {
        items.push({ label: t('play'), isBold: true, onClick: () => {
          playCommandCard(card, { card, source: 'announced', playerId: player!.id })
        } })
      }
      if (isBoardItem && canControl) {
        if (card.isFaceDown) {
          items.push({ label: t('flipUp'), isBold: true, onClick: () => flipBoardCard(data.boardCoords) })
        } else {
          items.push({ label: t('flipDown'), onClick: () => flipBoardCardFaceDown(data.boardCoords) })
        }
      }
      const sourceItem: DragItem = isBoardItem ? { card, source: 'board', boardCoords: data.boardCoords } : { card, source: 'announced', playerId: player!.id }
      const ownerId = card.ownerId
      const isSpecialItem = card?.deck === DeckType.Tokens || card?.deck === 'counter'
      if (isBoardItem) {
        if (canControl && card.isFaceDown) {
          items.push({ label: t('revealToAll'), onClick: () => revealBoardCard(data.boardCoords, 'all') })
        }
        if (!isOwner && !isVisible) {
          items.push({ label: t('requestReveal'), onClick: () => requestCardReveal({ source: 'board', ownerId: card.ownerId!, boardCoords: data.boardCoords }, localPlayerId) })
        }
      }
      if (items.length > 0) {
        items.push({ isDivider: true })
      }
      // Movement options: owner can move their cards even if face-down
      // Dummy cards can be moved by all players (canControl = true for dummies)
      if (canControl && (isVisible || card.isFaceDown)) {
        items.push({ label: t('toHand'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'hand', playerId: ownerId }) })
        if (ownerId) {
          const discardLabel = isSpecialItem ? t('remove') : t('toDiscard')
          items.push({ label: discardLabel, onClick: () => moveItem(sourceItem, { target: 'discard', playerId: ownerId }) })
          items.push({ label: t('toDeckTop'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'deck', playerId: ownerId, deckPosition: 'top' }) })
          items.push({ label: t('toDeckBottom'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'deck', playerId: ownerId, deckPosition: 'bottom' }) })
        }
      }
      if (isBoardItem) {
        items.push({ isDivider: true })
      }
      if (isVisible && (canControl || isBoardItem)) {
        const allStatusTypes = ['Aim', 'Exploit', 'Stun', 'Shield', 'Support', 'Threat', 'Revealed']
        const visibleStatusItems: ContextMenuItem[] = []
        allStatusTypes.forEach(status => {
          const currentCount = card.statuses?.filter((s: any) => s.type === status).length || 0
          if (currentCount > 0) {
            visibleStatusItems.push({
              type: 'statusControl',
              label: status,
              onAdd: () => isBoardItem ? addBoardCardStatus(data.boardCoords, status, localPlayerId) : addAnnouncedCardStatus(player.id, status, localPlayerId),
              onRemove: () => isBoardItem ? removeBoardCardStatus(data.boardCoords, status) : removeAnnouncedCardStatus(player.id, status),
              removeDisabled: false,
            })
          }
        })
        if (visibleStatusItems.length > 0) {
          if (items.length > 0 && !('isDivider' in items[items.length - 1])) {
            items.push({ isDivider: true })
          }
          items.push(...visibleStatusItems)
        }
        if (items.length > 0 && !('isDivider' in items[items.length - 1])) {
          items.push({ isDivider: true })
        }
        items.push({
          type: 'statusControl',
          label: t('power'),
          onAdd: () => isBoardItem ? modifyBoardCardPower(data.boardCoords, 1) : modifyAnnouncedCardPower(player.id, 1),
          onRemove: () => isBoardItem ? modifyBoardCardPower(data.boardCoords, -1) : modifyAnnouncedCardPower(player.id, -1),
          removeDisabled: false,
        })
      }
    } else if (type === 'token_panel_item') {
      const { card } = data
      const sourceItem: DragItem = { card, source: 'token_panel' }
      items.push({ label: t('view'), isBold: true, onClick: () => setViewingCard({ card }) })
      items.push({ isDivider: true })
      items.push({ label: t('play'), isBold: true, onClick: () => {
        closeAllModals(); setPlayMode({ card, sourceItem, faceDown: false })
      } })
      items.push({ label: t('playFaceDown'), onClick: () => {
        closeAllModals(); setPlayMode({ card, sourceItem, faceDown: true })
      } })
    } else if (['handCard', 'discardCard', 'deckCard'].includes(type)) {
      let { card, player } = data
      const { boardCoords, cardIndex } = data
      const currentPlayer = gameState.players?.find(p => p.id === player.id)
      if (currentPlayer) {
        player = currentPlayer
        if (type === 'handCard') {
          card = currentPlayer.hand[cardIndex] || card
        } else if (type === 'discardCard') {
          card = currentPlayer.discard[cardIndex] || card
        } else if (type === 'deckCard') {
          card = currentPlayer.deck[cardIndex] || card
        }
      }
      const canControl = player.id === localPlayerId || !!player.isDummy
      const localP = gameState.players?.find(p => p.id === localPlayerId)
      const isTeammate = localP !== undefined && localP.teamId !== null && player.teamId === localP.teamId
      const isRevealedToMe = card.revealedTo === 'all' || (Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId))
      const isRevealedByRequest = card.statuses?.some((s: any) => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)
      const isVisible = (() => {
        if (type !== 'handCard') {
          return true
        }
        return player.id === localPlayerId || isTeammate || !!player.isDummy || !!player.isDisconnected || isRevealedToMe || isRevealedByRequest
      })()
      let source: DragItem['source']
      if (type === 'handCard') {
        source = 'hand'
      } else if (type === 'discardCard') {
        source = 'discard'
      } else {
        source = 'deck'
      }
      const sourceItem: DragItem = { card, source, playerId: player?.id, cardIndex, boardCoords }
      const ownerId = card.ownerId
      const isSpecialItem = card?.deck === DeckType.Tokens || card?.deck === 'counter'

      // Show View option if visible to local player
      if (isVisible) {
        const owner = card.ownerId ? gameState?.players?.find(p => p.id === card.ownerId) : undefined
        items.push({ label: t('view'), isBold: true, onClick: () => setViewingCard({ card, player: owner }) })
      }

      if (canControl) {
        // Command cards: use playCommandCard (goes to announced + modal), no playFaceDown option
        if (card.deck === DeckType.Command) {
          // Only for hand and deck view, NOT for discard
          if (!['discardCard'].includes(type)) {
            items.push({ label: t('play'), isBold: true, onClick: () => {
              closeAllModals(); playCommandCard(card, sourceItem)
            } })
          }
        } else if (type === 'handCard') {
          // Non-command hand cards: play and playFaceDown
          items.push({ label: t('play'), isBold: true, onClick: () => {
            closeAllModals(); setPlayMode({ card, sourceItem, faceDown: false })
          } })
          items.push({ label: t('playFaceDown'), onClick: () => {
            closeAllModals(); setPlayMode({ card, sourceItem, faceDown: true })
          } })
        } else if (isVisible && type === 'deckCard') {
          // Non-command deck cards: play and playFaceDown
          items.push({ label: t('play'), isBold: true, onClick: () => {
            closeAllModals(); setPlayMode({ card, sourceItem, faceDown: false })
          } })
          items.push({ label: t('playFaceDown'), onClick: () => {
            closeAllModals(); setPlayMode({ card, sourceItem, faceDown: true })
          } })
        }
        if (items.length > 0) {
          items.push({ isDivider: true })
        }
        if (type === 'handCard') {
          items.push({ label: t('revealToAll'), onClick: () => revealHandCard(player.id, cardIndex, 'all') })
        }
        if (items.length > 0 && !('isDivider' in items[items.length - 1])) {
          items.push({ isDivider: true })
        }
        if (type === 'discardCard') {
          // Use ownerId if set, otherwise fall back to the player who owns the discard pile
          const targetPlayerId = ownerId ?? player.id
          items.push({ label: t('toHand'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'hand', playerId: targetPlayerId }) })
        } else if (type === 'handCard') {
          items.push({ label: t('toDiscard'), onClick: () => moveItem(sourceItem, { target: 'discard', playerId: ownerId }) })
        }
        if (['handCard', 'discardCard'].includes(type)) {
          // Use ownerId if set, otherwise fall back to the player who owns the pile
          const targetPlayerId = ownerId ?? player.id
          items.push({ label: t('toDeckTop'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'deck', playerId: targetPlayerId, deckPosition: 'top' }) })
          items.push({ label: t('toDeckBottom'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'deck', playerId: targetPlayerId, deckPosition: 'bottom' }) })
        }
        if (type === 'deckCard') {
          items.push({ label: t('toHand'), disabled: isSpecialItem, onClick: () => moveItem(sourceItem, { target: 'hand', playerId: player.id }) })
          items.push({ label: t('toDiscard'), onClick: () => moveItem(sourceItem, { target: 'discard', playerId: player.id }) })
        }
        if (type === 'handCard') {
          const revealedCount = card.statuses?.filter((s: CardStatus) => s.type === 'Revealed').length || 0
          if (revealedCount > 0) {
            if (items.length > 0 && !('isDivider' in items[items.length - 1])) {
              items.push({ isDivider: true })
            }
            items.push({ type: 'statusControl', label: t('revealed'), onAdd: () => addHandCardStatus(player.id, cardIndex, 'Revealed', localPlayerId), onRemove: () => removeHandCardStatus(player.id, cardIndex, 'Revealed'), removeDisabled: false })
          }
        }
      } else if (type === 'handCard' && !isVisible) {
        // If it's an opponent's card and NOT visible, allow request reveal.
        items.push({ label: t('requestReveal'), onClick: () => requestCardReveal({ source: 'hand', ownerId: player.id, cardIndex }, localPlayerId) })
      }
    } else if (type === 'deckPile') {
      const { player } = data
      const canControl = player.id === localPlayerId || !!player.isDummy
      if (canControl) {
        items.push({ label: t('drawCard'), onClick: () => drawCardWithLogging(player.id) })
        items.push({ label: t('drawStartingHand'), onClick: () => {
          for (let i = 0; i < 6; i++) {
            drawCardWithLogging(player.id)
          }
        } })
        items.push({ label: t('viewTopCards'), onClick: () => {
          // Request full deck data for viewing opponent's deck in P2P mode
          if (player.id !== localPlayerId) {
            requestDeckView(player.id)
          }
          setTopDeckViewState({ targetPlayerId: player.id, isLocked: false, initialCount: 1 })
        } })
        items.push({ label: t('shuffle'), onClick: () => shufflePlayerDeckWithLogging(player.id) })
      }
      items.push({ label: t('view'), onClick: () => handleViewDeck(player) })
    } else if (type === 'discardPile') {
      const { player } = data
      items.push({ label: t('view'), onClick: () => handleViewDiscard(player) })
    }
    items = items.filter((item, index) => {
      if (!('isDivider' in item)) {
        return true
      }
      if (index === 0 || index === items.length - 1) {
        return false
      }
      if ('isDivider' in items[index - 1]) {
        return false
      }
      return true
    })
    return <ContextMenu x={x} y={y} items={items} onClose={closeContextMenu} />
  }, [gameState, localPlayerId, moveItem, handleTriggerHighlight, addBoardCardStatus, removeBoardCardStatus, modifyBoardCardPower, addAnnouncedCardStatus, removeAnnouncedCardStatus, modifyAnnouncedCardPower, addHandCardStatus, removeHandCardStatus, drawCard, shufflePlayerDeck, flipBoardCard, flipBoardCardFaceDown, revealHandCard, revealBoardCard, requestCardReveal, t, playCommandCard, contextMenuProps, closeAllModals, closeContextMenu, handleViewDeck, handleViewDiscard])

  useEffect(() => {
    window.addEventListener('click', closeContextMenu)
    const handleContextMenu = () => {
      // Always close existing context menu when a new contextmenu event occurs
      // This allows right-clicking on another item to replace the current menu
      closeContextMenu()
    }
    window.addEventListener('contextmenu', handleContextMenu)
    return () => {
      window.removeEventListener('click', closeContextMenu)
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [closeContextMenu])

  useEffect(() => {
    if (draggedItem) {
      closeContextMenu()
    }
  }, [draggedItem, closeContextMenu])

  const handleOpenTokensModal = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (modalsState.isTokensModalOpen) {
      setModalsState(prev => ({ ...prev, isTokensModalOpen: false }))
      setModalAnchors(prev => ({ ...prev, tokensModalAnchor: null }))
    } else {
      setModalsState(prev => ({ ...prev, isTokensModalOpen: true, isCountersModalOpen: false }))
      const rect = event.currentTarget.getBoundingClientRect()
      setModalAnchors({
        tokensModalAnchor: { top: rect.top, left: rect.left },
        countersModalAnchor: null,
      })
    }
  }, [modalsState.isTokensModalOpen])

  const handleOpenCountersModal = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (modalsState.isCountersModalOpen) {
      setModalsState(prev => ({ ...prev, isCountersModalOpen: false }))
      setModalAnchors(prev => ({ ...prev, countersModalAnchor: null }))
    } else {
      setModalsState(prev => ({ ...prev, isCountersModalOpen: true, isTokensModalOpen: false }))
      const rect = event.currentTarget.getBoundingClientRect()
      setModalAnchors({
        countersModalAnchor: { top: rect.top, left: rect.left },
        tokensModalAnchor: null,
      })
    }
  }, [modalsState.isCountersModalOpen])

  // Only show MainMenu if not in game
  if (!isGameActive) {
    return (
      <>
        <MainMenu
        handleCreateGame={handleCreateGame}
        handleJoinGame={handleJoinGame}
        gamesList={gamesList}
        requestGamesList={requestGamesList}
        setViewingCard={setViewingCard}
        handleSaveSettings={handleSaveSettings}
        viewingCard={viewingCard}
        gameState={gameState}
        imageRefreshVersion={imageRefreshVersion}
        t={t}
        connectionStatus={connectionStatus}
        forceReconnect={forceReconnect}
        gameId={gameState.gameId}
        isGameStarted={gameState.isGameStarted}
        isPrivate={gameState.isPrivate}
        hostId={webrtcHostId}
        onClearImageCache={handleClearImageCache}
        createLocalGame={createLocalGame}
      />
      <ModalsRenderer />
      </>
    )
  }

  return (
    <>
      <div className={`relative w-screen h-screen overflow-hidden ${cursorStack ? 'cursor-none cursor-stack-active' : ''}`}>
      <Header
        gameId={gameState.gameId}
        isGameStarted={gameState.isGameStarted}
        onResetGame={resetGame}
        onPlayerReady={playerReady}
        players={gameState.players}
        localPlayerId={localPlayerId}
        activeGridSize={gameState.activeGridSize}
        onGridSizeChange={setActiveGridSize}
        dummyPlayerCount={gameState.dummyPlayerCount}
        onDummyPlayerCountChange={setDummyPlayerCount}
        realPlayerCount={realPlayerCount}
        connectionStatus={connectionStatus}
        onExitGame={exitGame}
        onOpenTokensModal={handleOpenTokensModal}
        onOpenCountersModal={handleOpenCountersModal}
        gameMode={gameState.gameMode}
        onGameModeChange={setGameMode}
        isPrivate={gameState.isPrivate}
        onPrivacyChange={setGamePrivacy}
        isHost={isHost}
        hostId={webrtcHostId}
        onSyncGame={handleSyncAndRefresh}
        currentPhase={gameState.currentPhase}
        onSetPhase={setPhase}
        onNextPhase={nextPhase}
        onPrevPhase={prevPhase}
        activePlayerId={gameState.activePlayerId}
        playerColorMap={playerColorMap}
        isAutoAbilitiesEnabled={isAutoAbilitiesEnabled}
        onToggleAutoAbilities={setIsAutoAbilitiesEnabled}
        isAutoDrawEnabled={isAutoDrawEnabled}
        onToggleAutoDraw={(enabled) => {
          if (localPlayerId) {
            toggleAutoDraw(localPlayerId, enabled)
          }
        }}
        hideDummyCards={hideDummyCards}
        onToggleHideDummyCards={setHideDummyCards}
        currentRound={gameState.currentRound}
        turnNumber={gameState.turnNumber}
        isScoringStep={gameState.isScoringStep}
        hasLastPlayedCard={checkHasLastPlayedCard(gameState)}
        isReconnecting={isReconnecting}
        reconnectProgress={reconnectProgress}
        connectToSignalling={connectToSignalling}
        isConnectedToSignalling={isConnectedToSignalling}
        onOpenGameLog={() => setIsGameLogOpen(true)}
      />

      {/* Reconnection Modal - Shows when WebRTC connection is lost and attempting to reconnect */}
      <ReconnectingModal
        isOpen={isReconnecting}
      />

      {/* New unified modal renderer - gradually replacing individual modals */}
      <ModalsRenderer />

      {gameState.isRoundEndModalOpen && (
        <RoundEndModal
          gameState={gameState}
          onContinueGame={closeRoundEndModalOnly}
          onStartNextRound={closeRoundEndModal}
          onExit={exitGame}
        />
      )}

      {modalsState.isTeamAssignOpen && (
        <TeamAssignmentModal
          players={gameState.players}
          gameMode={gameState.gameMode}
          onCancel={() => setModalsState(prev => ({ ...prev, isTeamAssignOpen: false }))}
          onConfirm={handleTeamAssignment}
        />
      )}

      {/* Reveal Request Modal - Rendered if there is a pending request for local player */}
      {pendingRevealRequest && (
        <RevealRequestModal
          fromPlayer={gameState.players.find(p => p.id === pendingRevealRequest.fromPlayerId)!}
          cardCount={pendingRevealRequest.cardIdentifiers.length}
          onAccept={() => respondToRevealRequest(pendingRevealRequest.fromPlayerId, true)}
          onDecline={() => respondToRevealRequest(pendingRevealRequest.fromPlayerId, false)}
        />
      )}

      {commandModalCard && (
        <CommandModal
          isOpen={!!commandModalCard}
          card={commandModalCard}
          playerColorMap={new Map(gameState.players.map(p => [p.id, p.color])) as any}
          onConfirm={(index) => handleCommandConfirmWithLogging(index, commandModalCard)}
          onCancel={() => {
            setCommandModalCard(null); setActionQueue([]); setCommandContext({})
          }}
        />
      )}

      {counterSelectionData && (
        <CounterSelectionModal
          isOpen={!!counterSelectionData}
          data={counterSelectionData}
          onConfirm={(count) => handleCounterSelectionConfirm(count, counterSelectionData)}
          onCancel={() => {
            setCounterSelectionData(null); setAbilityMode(null)
          }}
        />
      )}

      {topDeckViewState && topDeckPlayer && (
        <TopDeckView
          isOpen={!!topDeckViewState}
          player={topDeckPlayer}
          onClose={handleTopDeckClose}
          onReorder={handleTopDeckReorder}
          onMoveToBottom={handleTopDeckMoveToBottom}
          onViewCard={(card) => setViewingCard({ card })}
          onMoveToHand={handleTopDeckMoveToHand}
          onMoveToDiscard={handleTopDeckMoveToDiscard}
          onPlayCard={handleTopDeckPlay}
          playerColorMap={playerColorMap}
          localPlayerId={localPlayerId}
          imageRefreshVersion={imageRefreshVersion}
          initialCount={topDeckViewState.initialCount}
          isLocked={topDeckViewState.isLocked}
        />
      )}

      {viewingCard && (
        <CardDetailModal
          card={viewingCard.card}
          ownerPlayer={viewingCard.player}
          onClose={() => setViewingCard(null)}
          statusDescriptions={STATUS_DESCRIPTIONS}
          allPlayers={sortedPlayers}
          imageRefreshVersion={imageRefreshVersion}
        />
      )}

      {/* MODALS RE-ADDED TO RENDER TREE */}
      {viewingDiscard && viewingDiscardPlayer && (
        <DeckViewModal
          isOpen={!!viewingDiscard}
          onClose={handleDeckViewClose}
          title={viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck ? (viewingDiscard.pickConfig ? t('selectCardFromDeck') : t('deckView')) : (viewingDiscard.pickConfig ? t('selectCardFromDiscard') : t('discardView'))}
          player={viewingDiscardPlayer}
          cards={viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck ? viewingDiscardPlayer.deck : viewingDiscardPlayer.discard}
          setDraggedItem={setDraggedItem}
          canInteract={!!viewingDiscard.pickConfig || viewingDiscardPlayer.id === localPlayerId || !!viewingDiscardPlayer.isDummy}
          onCardClick={handleDiscardCardClick}
          onCardDoubleClick={handleDiscardCardClick}
          onCardContextMenu={handleDiscardContextMenu}
          onReorder={(playerId, newCards) => {
            const source = viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck ? 'deck' : 'discard'
            reorderCards(playerId, newCards, source)
          }}
          isDeckView={viewingDiscard.isDeckView || viewingDiscard.pickConfig?.isDeck}
          playerColorMap={playerColorMap}
          localPlayerId={localPlayerId}
          imageRefreshVersion={imageRefreshVersion}
          highlightFilter={highlightFilter}
          cursorStack={cursorStack}
          disableDrag={!!viewingDiscard.pickConfig}
        />
      )}

      <TokensModal
        isOpen={modalsState.isTokensModalOpen}
        onClose={() => setModalsState(prev => ({ ...prev, isTokensModalOpen: false }))}
        setDraggedItem={setDraggedItem}
        openContextMenu={openContextMenu}
        canInteract={!!localPlayerId && !isSpectator}
        anchorEl={modalAnchors.tokensModalAnchor}
        imageRefreshVersion={imageRefreshVersion}
        localPlayerId={localPlayerId}
        activePlayerId={gameState.activePlayerId}
        players={gameState.players}
        playerColorMap={playerColorMap}
        activeGridSize={gameState.activeGridSize}
      />

      <CountersModal
        isOpen={modalsState.isCountersModalOpen}
        onClose={() => setModalsState(prev => ({ ...prev, isCountersModalOpen: false }))}
        canInteract={!!localPlayerId && !isSpectator}
        anchorEl={modalAnchors.countersModalAnchor}
        imageRefreshVersion={imageRefreshVersion}
        onCounterMouseDown={handleCounterMouseDown}
        cursorStack={cursorStack}
      />

      {renderedContextMenu}

      {/* Cursor Follower for Token Stacks */}
      {cursorStack && (
        <div
          ref={cursorFollowerRef}
          className="fixed top-0 left-0 pointer-events-none z-[99999] flex items-center justify-center"
          style={{ willChange: 'transform' }}
        >
          {(() => {
            // Determine token owner color based on active player
            // Rule: If active player is dummy, tokens belong to dummy
            // Otherwise, tokens belong to local player
            const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
            const tokenOwnerId = (activePlayer?.isDummy && gameState.activePlayerId !== null)
              ? gameState.activePlayerId
              : localPlayerId ?? 1
            const tokenOwnerColor = playerColorMap.get(tokenOwnerId)
            const tokenColorRgb = tokenOwnerColor ? PLAYER_COLOR_RGB[tokenOwnerColor] : null
            const bgColor = tokenColorRgb
              ? `rgba(${tokenColorRgb.r}, ${tokenColorRgb.g}, ${tokenColorRgb.b}, 0.75)`
              : 'rgba(107, 114, 128, 0.75)'

            return (
              <div
                className="rounded-full border-2 border-white flex items-center justify-center relative shadow-lg"
                style={{
                  backgroundColor: bgColor,
                  width: 'calc(45 * var(--vu-base))',
                  height: 'calc(45 * var(--vu-base))'
                }}
              >
            {STATUS_ICONS[cursorStack.type] ? (
              <img
                src={`${STATUS_ICONS[cursorStack.type]}${imageRefreshVersion ? `?v=${imageRefreshVersion}` : ''}`}
                alt={cursorStack.type}
                className="object-contain"
                style={{ width: 'calc(35 * var(--vu-base))', height: 'calc(35 * var(--vu-base))' }}
              />
            ) : (
              <span className={`font-bold text-white drop-shadow-md ${cursorStack.type.startsWith('Power') ? 'text-sm' : 'text-lg'}`}>
                {cursorStack.type.startsWith('Power') ? cursorStack.type : cursorStack.type.charAt(0)}
              </span>
            )}

            {cursorStack.count > 1 && (
              <div className="absolute bg-red-600 text-white font-bold flex items-center justify-center rounded-full border-2 border-white shadow-sm z-10"
                style={{
                  top: 'calc(-12 * var(--vu-base))',
                  right: 'calc(-12 * var(--vu-base))',
                  width: 'calc(24 * var(--vu-base))',
                  height: 'calc(24 * var(--vu-base))',
                  fontSize: 'calc(12 * var(--vu-base))'
                }}>
                {cursorStack.count}
              </div>
            )}
          </div>
            )
          })()}
        </div>
      )}

      <div className="relative h-full w-full pt-14 overflow-hidden bg-gray-900">
        {localPlayer && (
          <div
            ref={leftPanelRef}
            className="absolute left-0 top-vu-header bottom-vu-min z-30 bg-panel-bg shadow-xl flex flex-col w-fit min-w-0 pl-vu-min py-vu-min pr-0 transition-all duration-100 overflow-hidden"
            style={{ width: sidePanelWidth }}
          >
            <PlayerPanel
              key={`${localPlayer.id}-hideDummyCards-${hideDummyCards}`}
              player={localPlayer}
              isLocalPlayer={true}
              localPlayerId={localPlayerId}
              isSpectator={isSpectator}
              isGameStarted={gameState.isGameStarted}
              onNameChange={(name) => updatePlayerName(localPlayer.id, name)}
              onColorChange={(color) => changePlayerColor(localPlayer.id, color)}
              onScoreChange={(delta) => updatePlayerScoreWithLogging(localPlayer.id, delta)}
              onDeckChange={(deckType) => changePlayerDeck(localPlayer.id, deckType)}
              onLoadCustomDeck={(deckFile) => loadCustomDeck(localPlayer.id, deckFile)}
              onDrawCard={(playerId) => drawCardWithLogging(playerId)}
              handleDrop={handleDropWithLogging}
              draggedItem={draggedItem}
              setDraggedItem={setDraggedItem}
              openContextMenu={openContextMenu}
              onHandCardDoubleClick={handleDoubleClickHandCard}
              playerColorMap={playerColorMap}
              allPlayers={sortedPlayers}
              localPlayerTeamId={localPlayer?.teamId}
              activePlayerId={gameState.activePlayerId}
              _onToggleActivePlayer={toggleActivePlayer}
              imageRefreshVersion={imageRefreshVersion}
              layoutMode="list-local"
              onCardClick={handleHandCardClick}
              onCommandPlayClick={handleCommandPlayClick}
              validHandTargets={validHandTargets}
              onAnnouncedCardDoubleClick={handleAnnouncedCardDoubleClick}
              currentPhase={gameState.currentPhase}
              disableActiveHighlights={isTargetingMode}
              preserveDeployAbilities={justAutoTransitioned}
              roundWinners={gameState.roundWinners}
              startingPlayerId={gameState.startingPlayerId}
              currentRound={gameState.currentRound}
              onDeckClick={handleDeckClick}
              isDeckSelectable={abilityMode?.mode === 'SELECT_DECK' || gameState.targetingMode?.isDeckSelectable === true}
              hideDummyCards={hideDummyCards}
              deckSelections={latestDeckSelections}
              handCardSelections={latestHandCardSelections}
              cursorStack={cursorStack}
              targetingMode={gameState.targetingMode}
              highlightOwnerId={highlightOwnerId}
              onCancelAllModes={handleCancelAllModes}
              clickWaves={clickWaves}
              triggerClickWave={triggerClickWave}
            />
          </div>
        )}

        <div
          className="absolute top-14 bottom-0 z-10 flex items-center justify-center pointer-events-none w-full left-0"
        >
          <div
            ref={boardContainerRef}
            className="pointer-events-auto h-full aspect-square flex items-center justify-center py-vu-min"
          >
            <GameBoard
              board={gameState.board}
              isGameStarted={gameState.isGameStarted}
              activeGridSize={gameState.activeGridSize}
              handleDrop={handleDropWithLogging}
              draggedItem={draggedItem}
              setDraggedItem={setDraggedItem}
              openContextMenu={openContextMenu}
              playMode={playMode}
              setPlayMode={setPlayMode}
              highlight={highlight as HighlightData | null}
              playerColorMap={playerColorMap}
              localPlayerId={localPlayerId}
              onCardDoubleClick={handleDoubleClickBoardCard}
              onEmptyCellDoubleClick={handleDoubleClickEmptyCell}
              imageRefreshVersion={imageRefreshVersion}
              cursorStack={cursorStack}
              setCursorStack={setCursorStack}
              currentPhase={gameState.currentPhase}
              activePlayerId={gameState.activePlayerId}
              onCardClick={handleBoardCardClick}
              onEmptyCellClick={handleEmptyCellClickWithScoring}
              validTargets={validTargets}
              targetingMode={gameState.targetingMode}
              noTargetOverlay={noTargetOverlay}
              disableActiveHighlights={isTargetingMode}
              preserveDeployAbilities={justAutoTransitioned}
              activeFloatingTexts={activeFloatingTexts as FloatingTextData[]}
              abilitySourceCoords={abilityMode?.sourceCoords || null}
              abilityCheckKey={abilityCheckKey}
              abilityMode={abilityMode}
              scoringLines={gameState.scoringLines || []}
              activePlayerIdForScoring={gameState.activePlayerId}
              clickWaves={clickWaves as any}
              triggerClickWave={triggerClickWave}
              visualEffects={gameState.visualEffects}
              onCancelAllModes={handleCancelAllModes}
              players={gameState.players}
              hideDummyCards={hideDummyCards}
            />
          </div>
        </div>

        <div
          className="absolute right-0 top-vu-header bottom-vu-min z-30 bg-panel-bg shadow-xl flex flex-col min-w-0 pr-vu-min py-vu-min pl-0 transition-all duration-100 overflow-hidden"
          style={{ width: sidePanelWidth }}
        >
          <div className="flex flex-col h-full w-full">
            {sortedPlayers
              .filter(p => p.id !== localPlayerId)
              .map(player => (
                <div key={player.id} className="w-full flex-1 min-h-0 flex flex-col">
                  <PlayerPanel
                    key={`${player.id}-hideDummyCards-${hideDummyCards}`}
                    player={player}
                    isLocalPlayer={false}
                    localPlayerId={localPlayerId}
                    isSpectator={isSpectator}
                    isGameStarted={gameState.isGameStarted}
                    onNameChange={(name) => updatePlayerName(player.id, name)}
                    onColorChange={(color) => changePlayerColor(player.id, color)}
                    onScoreChange={(delta) => updatePlayerScoreWithLogging(player.id, delta)}
                    onDeckChange={(deckType) => changePlayerDeck(player.id, deckType)}
                    onLoadCustomDeck={(deckFile) => loadCustomDeck(player.id, deckFile)}
                    onDrawCard={(playerId) => drawCardWithLogging(playerId)}
                    handleDrop={handleDropWithLogging}
                    draggedItem={draggedItem}
                    setDraggedItem={setDraggedItem}
                    openContextMenu={openContextMenu}
                    onHandCardDoubleClick={handleDoubleClickHandCard}
                    playerColorMap={playerColorMap}
                    allPlayers={sortedPlayers}
                    localPlayerTeamId={localPlayer?.teamId}
                    activePlayerId={gameState.activePlayerId}
                    _onToggleActivePlayer={toggleActivePlayer}
                    imageRefreshVersion={imageRefreshVersion}
                    layoutMode="list-remote"
                    onCardClick={handleHandCardClick}
                    onCommandPlayClick={handleCommandPlayClick}
                    currentPhase={gameState.currentPhase}
                    validHandTargets={validHandTargets}
                    onAnnouncedCardDoubleClick={handleAnnouncedCardDoubleClick}
                    disableActiveHighlights={isTargetingMode}
                    preserveDeployAbilities={justAutoTransitioned}
                    roundWinners={gameState.roundWinners}
                    startingPlayerId={gameState.startingPlayerId}
                    currentRound={gameState.currentRound}
                    onDeckClick={handleDeckClick}
                    isDeckSelectable={abilityMode?.mode === 'SELECT_DECK' || gameState.targetingMode?.isDeckSelectable === true}
                    hideDummyCards={hideDummyCards}
                    deckSelections={latestDeckSelections}
                    handCardSelections={latestHandCardSelections}
                    cursorStack={cursorStack}
                    targetingMode={gameState.targetingMode}
                    highlightOwnerId={highlightOwnerId}
                    onCancelAllModes={handleCancelAllModes}
                    clickWaves={clickWaves}
                    triggerClickWave={triggerClickWave}
                  />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>

    {/* VU Test Panel - Development only */}
    {import.meta.env.DEV && (
      <VUTestPanel enabled={import.meta.env.VITE_SHOW_VU_PANEL === 'true'} />
    )}

    {/* Game Log Modal */}
    <GameLogModal
      isOpen={isGameLogOpen}
      onClose={() => setIsGameLogOpen(false)}
      logs={gameLogHook.logs}
      players={gameState.players.map(p => ({ id: p.id, name: p.name, color: p.color }))}
      isHost={isHost}
      currentRound={gameState.currentRound}
      currentTurn={gameState.turnNumber}
      currentPhase={gameState.currentPhase}
      gameState={gameState}
      onRewind={gameLogHook.rewindToLog}
      onBackward={gameLogHook.backwardLog}
      onForward={gameLogHook.forwardLog}
      canRewind={gameLogHook.canRewind}
      canForward={gameLogHook.canForward}
      currentLogIndex={gameLogHook.currentLogIndex}
      maxRewindIndex={gameLogHook.currentLogIndex}
    />
    </>
  )
}

// Helper function to check if active player has a LastPlayed card
function checkHasLastPlayedCard(gameState: GameState): boolean {
  const activePlayerId = gameState.activePlayerId
  if (!activePlayerId) {
    return false
  }

  const activePlayer = gameState.players.find(p => p.id === activePlayerId)
  const isDummyPlayer = activePlayer?.isDummy ?? false

  for (let r = 0; r < gameState.board.length; r++) {
    for (let c = 0; c < gameState.board[r].length; c++) {
      const card = gameState.board[r]?.[c]?.card
      if (card?.ownerId === activePlayerId) {
        // For dummy players, check if card has LastPlayed status (any player could have added it)
        // For real players, only count if they added it themselves
        if (isDummyPlayer) {
          if (card?.statuses?.some((s: CardStatus) => s.type === 'LastPlayed')) {
            return true
          }
        } else {
          if (card?.statuses?.some((s: CardStatus) => s.type === 'LastPlayed' && s.addedByPlayerId === activePlayerId)) {
            return true
          }
        }
      }
    }
  }
  return false
}

// Wrapper component with ModalsProvider
const App = memo(function App() {
  return (
    <ModalsProvider>
      <AppInner />
    </ModalsProvider>
  )
})

export default App
