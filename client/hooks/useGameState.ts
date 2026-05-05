/**
 * useGameState - Unified game state hook with Simple P2P
 *
 * Заменяет всю сложную систему WebRTC на упрощённую:
 * - 2 типа сообщений (ACTION, STATE)
 * - Один источник правды (хост)
 * - Фазовые переходы управляются хостом
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { GameState, Card, DragItem, HighlightData, FloatingTextData, DeckSelectionData, HandCardSelectionData } from '../types'
import { createInitialState, createDeck } from './core/gameCreators'
import { logger } from '../utils/logger'
import type { PersonalizedState } from '../p2p/SimpleP2PTypes'
import { SimpleHost, SimpleGuest, createHostFromSavedSession } from '../p2p'
import { HostConnectionManager, GuestConnectionManager, ConnectionStrategy } from '../p2p/ConnectionManager'
import { useVisualEffects } from './useVisualEffects'
import { triggerDirectClickWave } from './useDirectClickWave'
import { tokenDatabase } from '../content'
import { shuffleDeck } from '@shared/utils/array'
import { assignUniqueRandomColor } from '../utils/colorAssigner'
import { getDecksData } from '../content'
import { DeckType } from '../types'

// Export type for use in other files
export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected'

// Тип для совместимости с существующим кодом
interface UseGameStateResult {
  gameState: GameState
  localPlayerId: number
  setLocalPlayerId: (id: number) => void
  draggedItem: DragItem | null
  setDraggedItem: (item: DragItem | null) => void
  connectionStatus: 'Connecting' | 'Connected' | 'Disconnected'
  gamesList: any[]

  // Game creation
  createGame: () => Promise<string>
  joinGameViaModal: (gameCode: string) => Promise<number>
  joinAsInvite: (gameId: string, playerName?: string) => Promise<number>
  exitGame: () => void
  disconnectHostAndPeerJS: () => void  // Auto-disconnect host/PeerJS when returning to main menu
  // Additional WebRTC compatibility props (stubs)
  initializeWebrtcHost: () => Promise<string>
  connectAsGuest: (hostId: string) => Promise<boolean>
  sendFullDeckToHost: (playerId: number, deck: any[], deckLength: number) => void
  shareHostDeckWithGuests: (deck: any[], deckLength: number) => void
  getFreshGameState: () => GameState
  isReconnecting: boolean
  reconnectProgress: { attempt: number; maxAttempts: number; timeRemaining: number } | null
  setDummyPlayerCount: (count: number) => void

  // NEW: Local game and signalling control
  createLocalGame: () => string  // Creates local game without PeerJS connection
  connectToSignalling: () => Promise<string>  // Connects to PeerJS when ready to invite
  disconnectFromSignalling: () => void  // Disconnects from signalling (keeps P2P)
  isConnectedToSignalling: () => boolean  // Check if connected to signalling
  isGameInitialized: () => boolean  // Check if local game is created

  // Ready check
  playerReady: () => void

  // Settings
  setGameMode: (mode: any) => void
  setGamePrivacy: (isPrivate: boolean) => void
  setActiveGridSize: (size: any) => void
  assignTeams: (teams: any) => void

  // Player actions
  updatePlayerName: (playerId: number, name: string) => void
  changePlayerColor: (playerId: number, color: any) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  changePlayerDeck: (playerId: number, deck: any) => void
  loadCustomDeck: (playerId: number, deckFile: any) => void

  // Card actions
  drawCard: (playerId?: number) => void
  drawCardsBatch: (playerId: number, count: number) => void
  handleDrop: (item: DragItem, target: any) => void
  moveItem: (item: any, target: any) => void
  updateState: (stateOrFn: any) => void
  shufflePlayerDeck: (playerId?: number) => void
  sendAction: (action: string, data?: any) => void

  // Status effects
  addBoardCardStatus: (coords: any, status: any, playerId?: number, count?: number) => void
  removeBoardCardStatus: (coords: any, status: any) => void
  removeBoardCardStatusByOwner: (coords: any, status: any, ownerId: number) => void
  modifyBoardCardPower: (coords: any, delta: number) => void
  addAnnouncedCardStatus: (playerId: number, status: any, addedByPlayerId?: number) => void
  removeAnnouncedCardStatus: (playerId: number, status: any) => void
  modifyAnnouncedCardPower: (playerId: number, delta: number) => void
  addHandCardStatus: (playerId: number, cardIndex: number, status: any, addedByPlayerId?: number) => void
  removeHandCardStatus: (playerId: number, cardIndex: number, status: any) => void
  flipBoardCard: (coords: any) => void
  flipBoardCardFaceDown: (coords: any) => void
  revealHandCard: (playerId: number, cardIndex: number, to?: 'all' | number) => void
  revealBoardCard: (coords: any, to?: 'all' | number) => void
  requestCardReveal: (request: any, requesterPlayerId?: number) => void
  respondToRevealRequest: (requesterPlayerId: number, accept: boolean) => void

  // Game lifecycle
  syncGame: () => void
  toggleActivePlayer: () => void
  toggleAutoDraw: (playerId: number, enabled: boolean) => void
  forceReconnect: () => Promise<void>

  // Visual effects (accept union types for P2P compatibility)
  triggerHighlight: (highlight: Omit<HighlightData, 'timestamp'>) => void
  latestHighlight: HighlightData | { row: number; col: number; color: string; duration?: number; timestamp: number } | null
  triggerNoTarget: (coords: { row: number; col: number }) => void
  latestNoTarget: { coords: { row: number; col: number }; timestamp: number } | null
  triggerDeckSelection: (playerId: number, selectedByPlayerId: number) => void
  triggerHandCardSelection: (playerId: number, cardIndex: number, selectedByPlayerId: number) => void
  triggerClickWave: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }, effectOwnerId?: number) => void
  clickWaves: Array<{ timestamp: number; location: 'board' | 'hand' | 'deck'; boardCoords?: { row: number; col: number }; handTarget?: { playerId: number, cardIndex: number }; clickedByPlayerId: number; playerColor: string }>
  triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void
  latestFloatingTexts: FloatingTextData[] | { text: string; coords?: { row: number; col: number }; color: string; timestamp: number }[]
  latestDeckSelections: Array<{ playerId: number; selectedByPlayerId: number; timestamp: number }>
  latestHandCardSelections: Array<{ playerId: number; cardIndex: number; selectedByPlayerId: number; timestamp: number }>
  syncValidTargets: (options: { validHandTargets?: {playerId: number, cardIndex: number}[]; isDeckSelectable?: boolean }) => void

  // Targeting
  setTargetingMode: (action: any, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: any, preCalculatedHandTargets?: {playerId: number, cardIndex: number}[]) => void
  clearTargetingMode: (force?: boolean) => void

  // Phase management
  nextPhase: (forceTurnPass?: boolean) => void
  prevPhase: () => void
  setPhase: (phase: number) => void
  passTurn: () => void
  markAbilityUsed: (coords: any, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void

  // Scoring
  scoreLine: (r1: number, c1: number, r2: number, c2: number, playerId: number) => void
  scoreDiagonal: (r1: number, c1: number, r2: number, c2: number, playerId: number, bonusType?: 'point_per_support' | 'draw_per_support') => void
  selectScoringLine: (lineType: string, lineIndex?: number) => void
  closeRoundEndModal: () => void
  closeRoundEndModalOnly: () => void

  // Mulligan
  confirmMulligan: (newHand: any[]) => void
  exchangeMulliganCard: (cardIndex: number) => void

  // Card manipulation
  destroyCard: (card: Card, boardCoords: { row: number; col: number }) => void
  applyGlobalEffect: (source: any, targets: any[], type: string, playerId: number, isDeploy: boolean) => void
  swapCards: (c1: any, c2: any) => void
  transferStatus: (from: any, to: any, type: string) => void
  transferAllCounters: (from: any, to: any) => void
  transferAllStatusesWithoutException: (from: any, to: any) => void
  recoverDiscardedCard: (playerId: number, cardIndex: number) => void
  resurrectDiscardedCard: (playerId: number, cardIndex: number, boardCoords: { row: number; col: number }) => void
  spawnToken: (coords: { row: number; col: number }, name: string, ownerId: number) => void

  // Game reset
  resetGame: () => void
  resetDeployStatus: (coords: { row: number; col: number }) => void
  removeStatusByType: (coords: { row: number; col: number }, type: string) => void
  reorderTopDeck: (playerId: number, newTopCards: any[]) => void
  reorderCards: (playerId: number, newOrder: any[], source?: string) => void
  requestDeckView: (targetPlayerId: number) => void

  // WebRTC
  webrtcHostId: string | null
  webrtcIsHost: boolean

  // Legacy
  requestGamesList: () => void
}

/**
 * Конвертирует PersonalizedState в GameState
 * Локальный игрок получает полные данные, остальные - только размеры
 */
function personalToGameState(personal: PersonalizedState, localPlayerId: number): GameState {
  // Конвертируем visualEffects из объекта обратно в Map
  const visualEffectsMap = personal.visualEffects instanceof Map
    ? personal.visualEffects
    : new Map(Object.entries(personal.visualEffects || {}))

  const result = {
    ...personal,
    visualEffects: visualEffectsMap,
    players: personal.players.map(p => {
      // Локальный игрок или dummy - полные данные
      // Определяем по p.id === localPlayerId или p.isDummy, НЕ по deck.length!
      const isLocalPlayer = p.id === localPlayerId
      const isDummy = p.isDummy

      if (isLocalPlayer || isDummy) {
        // Локальный игрок всегда получает полные данные (hand, deck, discard, boardHistory)
        // Даже если deck пустой - это всё ещё локальный игрок
        return {
          ...p,
          hand: p.hand || [],
          deck: p.deck || [],
          discard: p.discard || [],
          boardHistory: p.boardHistory || [],
          announcedCard: p.announcedCard || null,
          handSize: (p.hand || []).length,
          deckSize: p.deck?.length || p.deckSize || 0,
          discardSize: p.discard?.length || p.discardSize || 0
        }
      } else if (p.deck && p.deck.length > 0) {
        // Deck view target - полный deck доступен для просмотра
        return {
          ...p,
          hand: p.hand || [],
          deck: p.deck,
          discard: p.discard || [],
          boardHistory: p.boardHistory || [],
          announcedCard: p.announcedCard || null,
          handSize: (p.hand || []).length,
          deckSize: p.deck.length,
          discardSize: p.discard?.length || 0
        }
      } else if (p.deckSize && p.deckSize > 0) {
        // Deck view target - есть deckSize но нет deck массива (placeholder)
        return {
          ...p,
          hand: p.hand || [],
          deck: [],
          discard: [],
          boardHistory: [],
          announcedCard: p.announcedCard || null,
          handSize: p.handSize || 0,
          deckSize: p.deckSize,
          discardSize: p.discardSize || 0
        }
      } else {
        // Для других игроков - placeholder cards с statuses (для Revealed token targeting)
        // Host sends placeholder cards with statuses for Revealed token targeting
        // If p.hand has data (placeholder cards), use it; otherwise empty array
        const opponentHand = p.hand || []
        return {
          ...p,
          hand: opponentHand,
          deck: [],
          discard: [],
          boardHistory: [],
          announcedCard: p.announcedCard || null,
          handSize: opponentHand.length > 0 ? opponentHand.length : (p.handSize || 0),
          deckSize: p.deckSize || 0,
          discardSize: p.discardSize || 0
        }
      }
    }),
    localPlayerId
  } as GameState

  return result
}

export function useGameState(_props: any = {}): UseGameStateResult {
  // Состояние игры
  const [gameState, setGameState] = useState<GameState>(createInitialState())
  const [localPlayerId, setLocalPlayerId] = useState<number>(1)
  const [connectionStatus, setConnectionStatus] = useState<'Connecting' | 'Connected' | 'Disconnected'>('Disconnected')

  // Reconnection state
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false)
  const [reconnectProgress, setReconnectProgress] = useState<{ attempt: number; maxAttempts: number; timeRemaining: number } | null>(null)

  // P2P менеджеры
  const hostRef = useRef<SimpleHost | null>(null)
  const guestRef = useRef<SimpleGuest | null>(null)
  const hostManagerRef = useRef<ReturnType<typeof HostConnectionManager> | null>(null)
  const guestManagerRef = useRef<ReturnType<typeof GuestConnectionManager> | null>(null)
  const isHostRef = useRef<boolean>(false)
  const connectionStrategyRef = useRef<ConnectionStrategy>('peerjs')

  // State for draggedItem (useState вместо useRef для реактивности)
  const [draggedItem, setDraggedItemState] = useState<DragItem | null>(null)

  // Local game settings - these can be set BEFORE host is created
  // They will be applied to the game state when host is initialized
  const [localGameSettings, setLocalGameSettings] = useState<{
    gameMode: any
    activeGridSize: number
    dummyPlayerCount: number
  }>({
    gameMode: 'FFA',
    activeGridSize: 5,
    dummyPlayerCount: 0
  })

  // Refs для useVisualEffects
  const gameStateRef = useRef(gameState)
  const localPlayerIdRef = useRef(localPlayerId)
  // CRITICAL: Track state version to prevent old states from overwriting newer ones
  // This fixes targetingMode being cleared when host broadcasts old state
  const stateVersionRef = useRef(0)
  // CRITICAL: Track when targetingMode was locally cleared to prevent host from overwriting
  const targetingModeLocallyClearedRef = useRef(false)

  // Update refs when state changes
  useEffect(() => {
    gameStateRef.current = gameState
    // Track state version from host broadcasts
    if (gameState.version !== undefined) {
      stateVersionRef.current = gameState.version
    }
  }, [gameState])
  useEffect(() => {
    localPlayerIdRef.current = localPlayerId
  }, [localPlayerId])

  // States for visual effects
  // Note: latestHighlight can be HighlightData (client) or P2P highlight format
  const [latestHighlight, setLatestHighlight] = useState<HighlightData | { row: number; col: number; color: string; duration?: number; timestamp: number } | null>(null)
  // Note: latestFloatingTexts can be FloatingTextData[] (client) or P2P batch format
  const [latestFloatingTexts, setLatestFloatingTexts] = useState<FloatingTextData[] | { text: string; coords?: { row: number; col: number }; color: string; timestamp: number }[] | null>(null)
  const [latestNoTarget, setLatestNoTarget] = useState<{ coords: { row: number; col: number }; timestamp: number } | null>(null)
  const [_latestDeckSelections, setLatestDeckSelections] = useState<Array<{ playerId: number; selectedByPlayerId: number; timestamp: number }>>([])
  const [_latestHandCardSelections, setLatestHandCardSelections] = useState<Array<{ playerId: number; cardIndex: number; selectedByPlayerId: number; timestamp: number }>>([])
  const [clickWaves, setClickWaves] = useState<Array<any>>([])

  // Refs для совместимости (остальные)
  const latestHighlightRef = useRef<HighlightData | { row: number; col: number; color: string; duration?: number; timestamp: number } | null>(null)
  const latestNoTargetRef = useRef<{ coords: any; timestamp: number } | null>(null)
  const clickWavesRef = useRef<any[]>([])
  const latestFloatingTextsRef = useRef<FloatingTextData[] | { text: string; coords?: { row: number; col: number }; color: string; timestamp: number }[]>([])
  const latestDeckSelectionsRef = useRef<DeckSelectionData[]>([])
  const latestHandCardSelectionsRef = useRef<HandCardSelectionData[]>([])

  // Update refs when state changes
  useEffect(() => {
    latestHighlightRef.current = latestHighlight
  }, [latestHighlight])
  useEffect(() => {
    latestFloatingTextsRef.current = latestFloatingTexts || []
  }, [latestFloatingTexts])
  useEffect(() => {
    latestNoTargetRef.current = latestNoTarget
  }, [latestNoTarget])
  useEffect(() => {
    clickWavesRef.current = clickWaves
  }, [clickWaves])

  // ============================================================================
  // Инициализация хоста
  // ============================================================================
  const createGame = useCallback(async () => {
    try {
      setConnectionStatus('Connecting')

      const hostConfig = {
        onStateUpdate: (personalState) => {
          // CRITICAL: Version check to prevent old states from overwriting newer ones
          // This fixes targetingMode being cleared immediately after being set
          if (personalState.version !== undefined) {
            if (personalState.version <= stateVersionRef.current) {
              return // Skip old state
            }
          }

          const fullState = personalToGameState(personalState, 1)
          // Defer state update to avoid flushSync during render cycle
          setTimeout(() => {
            setGameState(fullState)
            setLocalPlayerId(1)

            // CRITICAL: Sync local settings with host state
            // This ensures that settings are consistent even when changed by guests
            setLocalGameSettings(prev => ({
              ...prev,
              gameMode: personalState.gameMode || prev.gameMode,
              activeGridSize: personalState.activeGridSize ?? prev.activeGridSize,
              dummyPlayerCount: personalState.dummyPlayerCount ?? prev.dummyPlayerCount
            }))
          }, 0)

          // Auto-save session on state updates
          const manager = hostManagerRef.current
          if (manager) {
            const sessionData = manager.exportSession()
            if (sessionData) {
              localStorage.setItem('webrtc_host_session', JSON.stringify(sessionData))
            }
          }
        },
        onPlayerJoin: (playerId) => {
          // Player joined
        },
        onPlayerLeave: (playerId) => {
          // Player left
        },
        onClickWave: (wave) => {
          // INSTANT: Show wave via direct DOM manipulation
          triggerDirectClickWave(wave as any)
          // Defer React state update to avoid flushSync during render cycle
          setTimeout(() => {
            setClickWaves(prev => [...prev, wave])
          }, 0)
          // Auto-remove after animation completes (700ms to match ClickWave totalDuration)
          setTimeout(() => {
            setClickWaves(prev => prev.filter(w => w.timestamp !== wave.timestamp))
          }, 700)
        },
        onFloatingTextBatch: (events) => {
          const timestamp = Date.now()
          const batch = events.map((item, i) => ({
            row: item.row,
            col: item.col,
            text: item.text,
            playerId: item.playerId,
            timestamp: timestamp + i
          }))
          setLatestFloatingTexts(batch)
        }
      }

      const managerConfig = {
        preferredStrategy: 'peerjs' as ConnectionStrategy,
        enableTrysteroFallback: true,
        connectionTimeout: 15000,
        trysteroAppId: 'newavalon-skirmish'
      }

      const manager = new HostConnectionManager(createInitialState(), hostConfig, managerConfig)
      hostManagerRef.current = manager
      isHostRef.current = true

      const { peerId, strategy } = await manager.initialize()
      connectionStrategyRef.current = strategy

      // Get the actual host instance for direct access
      hostRef.current = (manager as any).activeHost

      setConnectionStatus('Connected')
      logger.info('[createGame] Connected via', strategy, 'peerId:', peerId)

      // Save initial session data
      const sessionData = manager.exportSession()
      if (sessionData) {
        localStorage.setItem('webrtc_host_session', JSON.stringify(sessionData))
      }

      return peerId
    } catch (e) {
      setConnectionStatus('Disconnected')
      logger.error('[createGame] Failed to create game:', e)
      throw e
    }
  }, [setClickWaves])

  // ============================================================================
  // Local game creation (without PeerJS connection)
  // ============================================================================
  const createLocalGame = useCallback(() => {
    try {
      // Create initial state with local settings applied
      const initialState = createInitialState()
      initialState.gameMode = localGameSettings.gameMode
      initialState.activeGridSize = localGameSettings.activeGridSize
      initialState.dummyPlayerCount = localGameSettings.dummyPlayerCount

      const hostConfig = {
        onStateUpdate: (personalState) => {
          // CRITICAL: Version check to prevent old states from overwriting newer ones
          // This fixes targetingMode being cleared immediately after being set
          if (personalState.version !== undefined) {
            if (personalState.version <= stateVersionRef.current) {
              return // Skip old state
            }
          }

          const fullState = personalToGameState(personalState, 1)
          // Defer state update to avoid flushSync during render cycle
          setTimeout(() => {
            setGameState(fullState)
            setLocalPlayerId(1)

            // CRITICAL: Sync local settings with host state
            // This ensures that settings are consistent even when changed by guests
            setLocalGameSettings(prev => ({
              ...prev,
              gameMode: personalState.gameMode || prev.gameMode,
              activeGridSize: personalState.activeGridSize ?? prev.activeGridSize,
              dummyPlayerCount: personalState.dummyPlayerCount ?? prev.dummyPlayerCount
            }))
          }, 0)

          // Auto-save session on state updates
          const manager = hostManagerRef.current
          if (manager) {
            const sessionData = manager.exportSession()
            if (sessionData) {
              localStorage.setItem('webrtc_host_session', JSON.stringify(sessionData))
            }
          }
        },
        onPlayerJoin: (playerId) => {
          // Player joined
        },
        onPlayerLeave: (playerId) => {
          // Player left
        },
        onClickWave: (wave) => {
          // INSTANT: Show wave via direct DOM manipulation
          triggerDirectClickWave(wave as any)
          // Defer React state update to avoid flushSync during render cycle
          setTimeout(() => {
            setClickWaves(prev => [...prev, wave])
          }, 0)
          // Auto-remove after animation completes (700ms to match ClickWave totalDuration)
          setTimeout(() => {
            setClickWaves(prev => prev.filter(w => w.timestamp !== wave.timestamp))
          }, 700)
        },
        onFloatingTextBatch: (events) => {
          const timestamp = Date.now()
          const batch = events.map((item, i) => ({
            row: item.row,
            col: item.col,
            text: item.text,
            playerId: item.playerId,
            timestamp: timestamp + i
          }))
          setLatestFloatingTexts(batch)
        }
      }

      const managerConfig = {
        preferredStrategy: 'peerjs' as ConnectionStrategy,
        enableTrysteroFallback: false,  // No fallback for local games
        connectionTimeout: 15000,
        trysteroAppId: 'newavalon-skirmish'
      }

      const manager = new HostConnectionManager(initialState, hostConfig, managerConfig)
      hostManagerRef.current = manager
      isHostRef.current = true
      connectionStrategyRef.current = 'peerjs'

      // Initialize local game WITHOUT connecting to PeerJS
      // This sets activeHost internally
      const gameId = manager.initializeLocal()

      // CRITICAL: Get the actual host instance AFTER initializeLocal()
      // initializeLocal() sets activeHost, so we must get it after calling the method
      hostRef.current = (manager as any).activeHost

      setConnectionStatus('Connected')  // Local game is "connected" to itself
      logger.info('[createLocalGame] Local game created, gameId:', gameId)

      return gameId
    } catch (e) {
      logger.error('[createLocalGame] Failed to create local game:', e)
      throw e
    }
  }, [setClickWaves, localGameSettings])

  // Connect to PeerJS signalling server (for inviting online players)
  const connectToSignalling = useCallback(async () => {
    const manager = hostManagerRef.current
    if (!manager) {
      throw new Error('No game session. Call createLocalGame() first.')
    }

    if (!manager.isInitialized()) {
      throw new Error('Game not initialized. Call createLocalGame() first.')
    }

    if (manager.isConnectedToSignalling()) {
      // Already connected, just return peerId
      const peerId = manager.getPeerId()
      if (peerId) {return peerId}
    }

    try {
      setConnectionStatus('Connecting')
      const { peerId } = await manager.connectToSignalling()
      setConnectionStatus('Connected')
      logger.info('[connectToSignalling] Connected to PeerJS, peerId:', peerId)
      return peerId
    } catch (e) {
      setConnectionStatus('Connected')  // Still "connected" to local game
      logger.error('[connectToSignalling] Failed to connect:', e)
      throw e
    }
  }, [])

  // Disconnect from signalling server (keeps P2P connections)
  const disconnectFromSignalling = useCallback(() => {
    const manager = hostManagerRef.current
    if (manager && manager.isConnectedToSignalling()) {
      manager.disconnectFromSignalling()
      logger.info('[disconnectFromSignalling] Disconnected from signalling server')
    }
  }, [])

  // Check if connected to signalling server
  const isConnectedToSignalling = useCallback((): boolean => {
    const manager = hostManagerRef.current
    return manager ? manager.isConnectedToSignalling() : false
  }, [])

  // Check if local game is initialized
  const isGameInitialized = useCallback((): boolean => {
    const manager = hostManagerRef.current
    return manager ? manager.isInitialized() : false
  }, [])

  // ============================================================================
  // Подключение как гость
  // ============================================================================
  const joinGameViaModal = useCallback(async (hostPeerId: string) => {
    try {
      logger.info('[joinGameViaModal] Starting guest connection:', {
        hostPeerId,
        currentLocalPlayerId: localPlayerId,
        isHost: isHostRef.current,
        existingGuest: !!guestRef.current
      })
      setConnectionStatus('Connecting')

      const guestConfig = {
        localPlayerId: 0,
        onStateUpdate: (personalState) => {
          // CRITICAL: Version check to prevent old states from overwriting newer ones
          // This fixes targetingMode being cleared immediately after being set
          if (personalState.version !== undefined && personalState.version <= stateVersionRef.current) {
            return // Skip old state
          }

          // Определяем localPlayerId из состояния или токена
          const token = localStorage.getItem('player_token')
          let myId = 0

          if (token) {
            const player = personalState.players.find((p: any) => p.playerToken === token)
            if (player) {
              myId = player.id
            }
          }

          // CRITICAL: If token not found, use guest manager's getLocalPlayerId() as fallback
          if (myId === 0 && guestManagerRef.current) {
            const guestId = guestManagerRef.current.getLocalPlayerId()
            if (guestId > 0) {
              myId = guestId
            }
          }

          const fullState = personalToGameState(personalState, myId)

          // CRITICAL: If targetingMode was cleared locally (right-click cancel), don't restore it from host
          // Check AFTER personalToGameState, delete from fullState
          if (targetingModeLocallyClearedRef.current && fullState.targetingMode) {
            delete fullState.targetingMode
          }

          // Defer state update to avoid flushSync during render cycle
          setTimeout(() => {
            // CRITICAL: Reset the flag AFTER state update (not before)
            // Using prevState callback to ensure flag is checked at update time
            setGameState((prev) => {
              // Double-check flag at the moment of state update
              if (targetingModeLocallyClearedRef.current) {
                // Keep targetingMode as null even if fullState has it
                targetingModeLocallyClearedRef.current = false
                return { ...fullState, targetingMode: null }
              }
              targetingModeLocallyClearedRef.current = false
              return fullState
            })
            setLocalPlayerId(myId)

            // CRITICAL: Sync local settings with host state
            // This ensures that guest's local settings match the host's current settings
            setLocalGameSettings(prev => ({
              ...prev,
              gameMode: personalState.gameMode || prev.gameMode,
              activeGridSize: personalState.activeGridSize ?? prev.activeGridSize,
              dummyPlayerCount: personalState.dummyPlayerCount ?? prev.dummyPlayerCount
            }))
          }, 0)
        },
        onConnected: () => {
          setConnectionStatus('Connected')
        },
        onDisconnected: () => {
          setConnectionStatus('Disconnected')
        },
        onError: (error) => {
          // Guest error
        },
        // Visual effect callbacks
        onHighlight: (data) => {
          setLatestHighlight({ ...data, timestamp: Date.now() })
        },
        onFloatingText: (batch) => {
          const timestamp = Date.now()
          const withTimestamp = batch.map((item, i) => ({ ...item, timestamp: timestamp + i }))
          setLatestFloatingTexts(withTimestamp)
        },
        // onTargetingMode and onClearTargetingMode removed to prevent race conditions
        // Targeting mode is now synced via onStateUpdate from host's broadcastAll()
        // which already includes targetingMode in the state
        onNoTarget: (coords) => {
          setLatestNoTarget({ coords, timestamp: Date.now() })
        },
        onDeckSelection: (playerId, selectedByPlayerId) => {
          const selection = { playerId, selectedByPlayerId, timestamp: Date.now() }
          setLatestDeckSelections(prev => [...prev, selection])
          setTimeout(() => {
            setLatestDeckSelections(prev => prev.filter(ds => ds.timestamp !== selection.timestamp))
          }, 1000)
        },
        onHandCardSelection: (playerId, cardIndex, selectedByPlayerId) => {
          const selection = { playerId, cardIndex, selectedByPlayerId, timestamp: Date.now() }
          setLatestHandCardSelections(prev => [...prev, selection])
          setTimeout(() => {
            setLatestHandCardSelections(prev => prev.filter(cs => cs.timestamp !== selection.timestamp))
          }, 1000)
        },
        onClickWave: (wave) => {
          // INSTANT: Show wave via direct DOM manipulation
          triggerDirectClickWave(wave as any)
          // Defer React state update to avoid flushSync during render cycle
          setTimeout(() => {
            setClickWaves(prev => [...prev, wave])
          }, 0)
          // Auto-remove after animation completes (700ms to match ClickWave totalDuration)
          setTimeout(() => {
            setClickWaves(prev => prev.filter(w => w.timestamp !== wave.timestamp))
          }, 700)
        },
        onReconnectRejected: (reason) => {
          // Clear reconnection state
          setIsReconnecting(false)
          setReconnectProgress(null)
          isReconnectingRef.current = false
          // Return to main menu
          setGameState(createInitialState())
          setConnectionStatus('Disconnected')
        },
        onHostEndedGame: () => {
          // Host has ended the game - return to main menu
          // Clear credentials to prevent reconnect
          localStorage.removeItem('webrtc_host_peer_id')
          localStorage.removeItem('player_token')
          guestRef.current = null
          guestManagerRef.current = null
          isHostRef.current = false
          setGameState(createInitialState())
          setConnectionStatus('Disconnected')
          setIsReconnecting(false)
          setReconnectProgress(null)
          isReconnectingRef.current = false
        }
      }

      const managerConfig = {
        preferredStrategy: 'peerjs' as ConnectionStrategy,
        enableTrysteroFallback: true,
        connectionTimeout: 15000,
        trysteroAppId: 'newavalon-skirmish'
      }

      const manager = new GuestConnectionManager(guestConfig, managerConfig)
      guestManagerRef.current = manager

      // CRITICAL: Set guestRef BEFORE connect() so onStateUpdate can access it
      // onStateUpdate may be called during connect() when JOIN_ACCEPT is received
      guestRef.current = (manager as any).activeGuest

      const { strategy } = await manager.connect(hostPeerId, localStorage.getItem('player_name') || 'Player')

      // CRITICAL: Update guestRef AFTER connection is established
      // The activeGuest may have changed during connection
      guestRef.current = (manager as any).activeGuest

      connectionStrategyRef.current = strategy
      isHostRef.current = false

      const playerId = manager.getLocalPlayerId()
      logger.info('[joinGameViaModal] Guest connected successfully:', {
        hostPeerId,
        strategy,
        assignedPlayerId: playerId,
        localPlayerId: localPlayerId
      })

      // CRITICAL: Update localPlayerId immediately after connection
      // This ensures that actions like PLAYER_READY are sent with the correct player ID
      setLocalPlayerId(playerId)

      return playerId
    } catch (e) {
      logger.error('[joinGameViaModal] Guest connection failed:', {
        hostPeerId,
        error: e instanceof Error ? e.message : String(e)
      })
      setConnectionStatus('Disconnected')
      throw e
    }
  }, [])

  const joinAsInvite = useCallback((gameId: string, _playerName?: string) => {
    // For invite join, we treat gameId as hostPeerId for now
    return joinGameViaModal(gameId)
  }, [joinGameViaModal])

  // Ref to track if reconnection is in progress (prevents duplicate attempts)
  const isReconnectingRef = useRef(false)

  // ============================================================================
  // Auto-reconnect on mount if credentials exist
  // ============================================================================
  useEffect(() => {
    // Only attempt auto-reconnect if we're a guest (not host) and disconnected
    if (isHostRef.current) { return }
    if (isReconnectingRef.current) { return } // Already reconnecting

    const hostPeerId = localStorage.getItem('webrtc_host_peer_id')
    const hasCredentials = hostPeerId && localStorage.getItem('player_token')

    if (hasCredentials && connectionStatus === 'Disconnected') {
      isReconnectingRef.current = true
      setIsReconnecting(true)
      setReconnectProgress({ attempt: 1, maxAttempts: 5, timeRemaining: 30 })

      joinGameViaModal(hostPeerId)
        .then(() => {
          setIsReconnecting(false)
          setReconnectProgress(null)
          isReconnectingRef.current = false
        })
        .catch(() => {
          setIsReconnecting(false)
          setReconnectProgress(null)
          isReconnectingRef.current = false
        })
    }
  }, [connectionStatus, joinGameViaModal])

  // ============================================================================
  // Monitor gameState for local player disconnection
  // ============================================================================
  useEffect(() => {
    if (!gameState || !gameState.players || localPlayerId === 0) { return }
    if (isReconnectingRef.current) { return } // Already reconnecting
    if (isHostRef.current) { return } // Host doesn't need to reconnect

    const localPlayer = gameState.players.find(p => p.id === localPlayerId)
    if (!localPlayer) { return }

    // If local player is disconnected, start reconnection
    if (localPlayer.isDisconnected) {
      const deadline = localPlayer.reconnectionDeadline
      if (deadline && deadline > Date.now()) {
        isReconnectingRef.current = true
        setIsReconnecting(true)
        const timeRemaining = Math.ceil((deadline - Date.now()) / 1000)
        setReconnectProgress({ attempt: 1, maxAttempts: 5, timeRemaining })

        // Attempt auto-reconnect
        const hostPeerId = localStorage.getItem('webrtc_host_peer_id')
        if (hostPeerId) {
          joinGameViaModal(hostPeerId)
            .then(() => {
              setIsReconnecting(false)
              setReconnectProgress(null)
              isReconnectingRef.current = false
            })
            .catch(() => {
              setIsReconnecting(false)
              setReconnectProgress(null)
              isReconnectingRef.current = false
            })
        }
      }
    } else if (!localPlayer.isDisconnected && isReconnecting) {
      // Player reconnected successfully
      setIsReconnecting(false)
      setReconnectProgress(null)
    }
  }, [gameState, localPlayerId, isReconnecting, joinGameViaModal])

  // ============================================================================
  // Countdown timer for reconnection progress
  // ============================================================================
  useEffect(() => {
    if (!reconnectProgress) { return }

    const interval = setInterval(() => {
      setReconnectProgress(prev => {
        if (!prev || prev.timeRemaining <= 1) {
          return null
        }
        return { ...prev, timeRemaining: prev.timeRemaining - 1 }
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [reconnectProgress ? reconnectProgress.attempt : 0])

  // ============================================================================
  // Auto-restore host session on mount (if page was refreshed)
  // ============================================================================
  useEffect(() => {
    // Check if there's a saved host session
    const savedSessionStr = localStorage.getItem('webrtc_host_session')
    if (!savedSessionStr) { return }
    if (isReconnectingRef.current) { return } // Already reconnecting

    try {
      const savedSession = JSON.parse(savedSessionStr)

      // Check if session is too old (more than 1 hour)
      const maxAge = 60 * 60 * 1000 // 1 hour
      if (Date.now() - savedSession.timestamp > maxAge) {
        localStorage.removeItem('webrtc_host_session')
        return
      }

      // Restore host session
      isReconnectingRef.current = true
      setIsReconnecting(true)
      setReconnectProgress({ attempt: 1, maxAttempts: 1, timeRemaining: 30 })

      const restoreHostSession = async () => {
        try {
          const host = createHostFromSavedSession(savedSession, {
            onStateUpdate: (personalState) => {
              // CRITICAL: Version check to prevent old states from overwriting newer ones
              if (personalState.version !== undefined && personalState.version <= stateVersionRef.current) {
                return // Skip old state
              }

              const fullState = personalToGameState(personalState, 1)
              // Defer state update to avoid flushSync during render cycle
              setTimeout(() => {
                setGameState(fullState)
                setLocalPlayerId(1)
              }, 0)

              // Continue saving session on state updates
              const sessionData = host.exportSession()
              if (sessionData) {
                localStorage.setItem('webrtc_host_session', JSON.stringify(sessionData))
              }
            },
            onPlayerJoin: (playerId) => {
              // Player joined restored session
            },
            onPlayerLeave: (playerId) => {
              // Player left restored session
            },
            onClickWave: (wave) => {
              triggerDirectClickWave(wave as any)
              setTimeout(() => {
                setClickWaves(prev => [...prev, wave])
              }, 0)
              setTimeout(() => {
                setClickWaves(prev => prev.filter(w => w.timestamp !== wave.timestamp))
              }, 700)
            },
            onFloatingTextBatch: (events) => {
              const timestamp = Date.now()
              const batch = events.map((item, i) => ({
                row: item.row,
                col: item.col,
                text: item.text,
                playerId: item.playerId,
                timestamp: timestamp + i
              }))
              setLatestFloatingTexts(batch)
            }
          })

          // Initialize with saved peerId (important for guests to reconnect)
          const peerId = await host.initialize(savedSession.peerId)
          hostRef.current = host
          isHostRef.current = true
          setConnectionStatus('Connected')

        } catch (error: any) {
          // Check if this is a PeerJS connection error
          const isPeerJSError = error?.message?.includes('PeerJS') || error?.message?.includes('WebSocket')

          if (isPeerJSError) {
            // Clear the session so it doesn't keep failing on page reload
            localStorage.removeItem('webrtc_host_session')
            // Don't show error - user can still use WebSocket mode
          } else {
            // Other errors - clear session
            localStorage.removeItem('webrtc_host_session')
          }
        } finally {
          setIsReconnecting(false)
          setReconnectProgress(null)
          isReconnectingRef.current = false
        }
      }

      restoreHostSession()
    } catch (error) {
      localStorage.removeItem('webrtc_host_session')
      setIsReconnecting(false)
      setReconnectProgress(null)
    }
  }, []) // Run once on mount

  // ============================================================================
  // Отправка действий
  // ============================================================================
  const sendAction = useCallback((action: string, data?: any) => {
    // Check both hostRef (old SimpleHost) and hostManagerRef (new HostConnectionManager)
    if (isHostRef.current) {
      if (hostRef.current) {
        hostRef.current.hostAction(action, data)
      } else if (hostManagerRef.current) {
        hostManagerRef.current.hostAction(action, data)
      }
    } else if (guestRef.current) {
      guestRef.current.sendAction(action, data)
    }
  }, [])

  // ============================================================================
  // Ready check
  // ============================================================================
  const playerReady = useCallback(() => {
    sendAction('PLAYER_READY')
  }, [sendAction])

  // ============================================================================
  // Настройки игры
  // ============================================================================
  const setGameMode = useCallback((mode: any) => {
    // Always update local settings (works before host is created)
    setLocalGameSettings(prev => ({ ...prev, gameMode: mode }))
    // Also update gameState for immediate UI feedback
    setGameState((prev: GameState) => ({ ...prev, gameMode: mode }))
    // If host exists, send action to apply to game state
    // Check both hostRef (old SimpleHost) and hostManagerRef (new HostConnectionManager)
    if (isHostRef.current) {
      if (hostRef.current) {
        hostRef.current.hostAction('SET_GAME_MODE', { mode })
      } else if (hostManagerRef.current) {
        hostManagerRef.current.hostAction('SET_GAME_MODE', { mode })
      }
    } else if (guestRef.current) {
      guestRef.current.sendAction('SET_GAME_MODE', { mode })
    }
  }, [])

  const setGamePrivacy = useCallback((isPrivate: boolean) => {
    // Update gameState for immediate UI feedback
    setGameState((prev: GameState) => ({ ...prev, isPrivate }))
    // If host exists, send action
    // Check both hostRef (old SimpleHost) and hostManagerRef (new HostConnectionManager)
    if (isHostRef.current) {
      if (hostRef.current) {
        hostRef.current.hostAction('SET_PRIVACY', { isPrivate })
      } else if (hostManagerRef.current) {
        hostManagerRef.current.hostAction('SET_PRIVACY', { isPrivate })
      }
    } else if (guestRef.current) {
      guestRef.current.sendAction('SET_PRIVACY', { isPrivate })
    }
  }, [])

  const setActiveGridSize = useCallback((size: any) => {
    // Always update local settings (works before host is created)
    setLocalGameSettings(prev => ({ ...prev, activeGridSize: size }))
    // Also update gameState for immediate UI feedback
    setGameState((prev: GameState) => ({ ...prev, activeGridSize: size }))
    // If host exists, send action to apply to game state
    // Check both hostRef (old SimpleHost) and hostManagerRef (new HostConnectionManager)
    if (isHostRef.current) {
      if (hostRef.current) {
        hostRef.current.hostAction('SET_GRID_SIZE', { size })
      } else if (hostManagerRef.current) {
        hostManagerRef.current.hostAction('SET_GRID_SIZE', { size })
      }
    } else if (guestRef.current) {
      guestRef.current.sendAction('SET_GRID_SIZE', { size })
    }
  }, [])

  const setDummyPlayerCount = useCallback((count: number) => {
    logger.info('[setDummyPlayerCount] Setting dummy player count:', count,
      'hostRef exists:', !!hostRef.current,
      'hostManagerRef exists:', !!hostManagerRef.current,
      'isHost:', isHostRef.current)

    // Always update local settings (works before host is created)
    setLocalGameSettings(prev => ({ ...prev, dummyPlayerCount: count }))

    // Optimistically update the players array for immediate UI feedback
    // This works both before host is created and during multiplayer
    setGameState((prev: GameState) => {
      const realPlayers = prev.players.filter(p => !p.isDummy)
      const currentDummies = prev.players.filter(p => p.isDummy)
      const numericCount = Number(count)

      // Validate count
      if (!Number.isFinite(numericCount) || numericCount < 0 || numericCount > 3) {
        return prev
      }

      // If count matches current number of dummies, just update the counter
      if (currentDummies.length === numericCount) {
        return { ...prev, dummyPlayerCount: numericCount }
      }

      // Keep existing dummies (preserve their name, color, deck)
      const newPlayers = [...realPlayers]
      const dummiesToKeep = Math.min(currentDummies.length, numericCount)

      // Add existing dummies (preserving their data)
      for (let i = 0; i < dummiesToKeep; i++) {
        newPlayers.push(currentDummies[i])
      }

      // Add NEW dummy players only if we need more
      if (numericCount > currentDummies.length) {
        let nextPlayerId = Math.max(...realPlayers.map(p => p.id), ...currentDummies.map(p => p.id), 0)
        for (let i = currentDummies.length; i < numericCount; i++) {
          nextPlayerId++
          const dummyName = `Dummy ${i + 1}`

          // Get random deck type for dummy player
          const decksData = getDecksData()
          const deckKeys = Object.keys(decksData).filter(key =>
            key !== 'Tokens' && key !== 'Commands' && key !== 'Custom'
          ) as DeckType[]
          const randomDeckType = deckKeys[Math.floor(Math.random() * deckKeys.length)] || DeckType.SynchroTech

          const dummyDeck = shuffleDeck(createDeck(randomDeckType, nextPlayerId, dummyName))

          // Assign random unique color (not already used by existing players)
          const existingColors = newPlayers.map(p => p.color)
          const dummyColor = assignUniqueRandomColor(existingColors)

          const dummyPlayer = {
            id: nextPlayerId,
            name: dummyName,
            score: 0,
            hand: [],
            deck: dummyDeck,
            discard: [],
            discardSize: 0,
            announcedCard: null,
            selectedDeck: randomDeckType,
            color: dummyColor,
            isDummy: true,
            isDisconnected: false,
            isReady: true,
            boardHistory: [],
            autoDrawEnabled: true,
          }
          newPlayers.push(dummyPlayer)
        }
      }

      return {
        ...prev,
        players: newPlayers,
        dummyPlayerCount: numericCount
      }
    })

    // If host exists, send action to apply to game state on server/host side
    // Check both hostRef (old SimpleHost) and hostManagerRef (new HostConnectionManager)
    if (isHostRef.current) {
      if (hostRef.current) {
        hostRef.current.hostAction('SET_DUMMY_PLAYER_COUNT', { count })
      } else if (hostManagerRef.current) {
        hostManagerRef.current.hostAction('SET_DUMMY_PLAYER_COUNT', { count })
      }
    } else if (guestRef.current) {
      guestRef.current.sendAction('SET_DUMMY_PLAYER_COUNT', { count })
    }
  }, [])

  const assignTeams = useCallback((teams: any) => {
    sendAction('ASSIGN_TEAMS', { teams })
  }, [sendAction])

  // ============================================================================
  // Игровые действия
  // ============================================================================
  const updatePlayerName = useCallback((playerId: number, name: string) => {
    sendAction('CHANGE_PLAYER_NAME', { playerId, name })
    // Локальное обновление для мгновенного отклика
    setGameState((prev: GameState) => ({
      ...prev,
      players: prev.players.map(p =>
        p.id === playerId ? { ...p, name } : p
      )
    }))
  }, [sendAction])

  const changePlayerColor = useCallback((playerId: number, color: any) => {
    sendAction('CHANGE_PLAYER_COLOR', { playerId, color })
  }, [sendAction])

  const updatePlayerScore = useCallback((playerId: number, delta: number) => {
    sendAction('UPDATE_SCORE', { playerId, delta })
  }, [sendAction])

  const changePlayerDeck = useCallback((playerId: number, deck: any) => {
    sendAction('CHANGE_PLAYER_DECK', { playerId, deck })
  }, [sendAction])

  const loadCustomDeck = useCallback((playerId: number, deckFile: any) => {
    sendAction('LOAD_CUSTOM_DECK', { playerId, deckFile })
  }, [sendAction])

  const drawCard = useCallback((playerId?: number) => {
    sendAction('DRAW_CARD', { targetPlayerId: playerId })
  }, [sendAction])

  const drawCardsBatch = useCallback((playerId: number, count: number) => {
    // Draw multiple cards for a player
    // Used by Tactical Maneuver, Inspiration, and other abilities
    console.log('[drawCardsBatch] Called:', { playerId, count, timestamp: Date.now() })
    sendAction('DRAW_CARDS_BATCH', { count, targetPlayerId: playerId })
  }, [sendAction])

  const handleDrop = useCallback((item: DragItem, target: any) => {
    if (target.target === 'board') {
      // Определяем действие по источнику карты
      let action = 'PLAY_CARD'
      let actionData: any = {
        cardIndex: item.cardIndex,
        boardCoords: target.boardCoords,
        faceDown: item.card?.isFaceDown,
        playerId: item.playerId // Owner of the card being played
      }

      if (item.source === 'counter_panel') {
        // Размещение жетона/статуса на карту с поля боя
        action = 'ADD_STATUS_TO_BOARD_CARD'
        actionData = {
          boardCoords: target.boardCoords,
          statusType: item.statusType,
          ownerId: item.ownerId,
          replaceStatusType: item.replaceStatusType,
          count: item.count || 1
        }
      } else if (item.source === 'token_panel') {
        // Check if this is a Command card - Command cards go through announced → discard flow
        const isCommandCard = item.card?.deck === 'Command' || item.card?.types?.includes('Command') || item.card?.faction === 'Command'

        if (isCommandCard && item.card) {
          // Send special action for command card from token panel
          // Client-side will handle opening modal, server-side moves card to announced
          sendAction('PLAY_COMMAND_FROM_TOKEN_PANEL', {
            card: item.card,
            ownerId: item.ownerId ?? item.playerId ?? localPlayerId ?? 0,
          })
          return // Early return - don't send PLAY_TOKEN_CARD action
        }

        // Regular token card (Unit, etc.)
        // Размещение карты-токена на пустую клетку поля боя
        // Токен НЕ удаляется из панели (может использоваться многократно)
        action = 'PLAY_TOKEN_CARD'
        actionData = {
          card: item.card,
          boardCoords: target.boardCoords,
          ownerId: item.ownerId // Владелец = разместивший или dummy
        }
      } else if (item.source === 'deck') {
        // Check if this is a Command card - Command cards go through announced → modal → discard flow
        const isCommandCard = item.card?.deck === 'Command' || item.card?.types?.includes('Command') || item.card?.faction === 'Command'

        if (isCommandCard && item.card) {
          // Send special action for command card from deck
          sendAction('PLAY_COMMAND_FROM_DECK', {
            card: item.card,
            cardIndex: item.cardIndex ?? 0,
            ownerId: item.playerId ?? localPlayerId ?? 0,
          })
          return // Early return - don't send PLAY_CARD_FROM_DECK action
        }

        // Regular card (Unit, etc.)
        action = 'PLAY_CARD_FROM_DECK'
        actionData.cardIndex = item.cardIndex ?? 0
        actionData.playerId = item.playerId
      } else if (item.source === 'discard') {
        // Check if this is a command card - command cards go to announced (showcase) first
        const isCommandCard = item.card?.deck === 'Command' || item.card?.types?.includes('Command') || item.card?.faction === 'Command'
        if (isCommandCard) {
          action = 'ANNOUNCE_CARD'
          actionData = {
            cardIndex: item.cardIndex,
            source: 'discard',
            playerId: item.playerId,
          }
        } else {
          action = 'PLAY_CARD_FROM_DISCARD'
          actionData.cardIndex = item.cardIndex
          actionData.playerId = item.playerId
        }
      } else if (item.source === 'announced') {
        // Перетаскивание из витрины на поле боя
        action = 'PLAY_ANNOUNCED_TO_BOARD'
        actionData = {
          row: target.boardCoords.row,
          col: target.boardCoords.col,
          faceDown: item.card?.isFaceDown,
          playerId: item.playerId
        }
      } else if (item.source === 'board') {
        // Перемещение карты с одной клетки поля боя на другую
        action = 'MOVE_CARD_ON_BOARD'
        actionData = {
          cardId: item.card?.id,
          fromCoords: item.boardCoords,
          toCoords: target.boardCoords,
          faceDown: item.card?.isFaceDown,
          playerId: item.playerId,
          // CRITICAL: Pass targeting mode for chained actions (Tactical Maneuver rewards)
          targetingMode: gameState.targetingMode,
        }
      }

      sendAction(action, actionData)
    } else if (target.target === 'hand') {
      // Перемещение в руку
      if (item.source === 'announced') {
        // Из витрины в руку
        sendAction('MOVE_ANNOUNCED_TO_HAND', {
          playerId: item.playerId
        })
      } else if (item.source === 'counter_panel') {
        // Размещение жетона/статуса на карту в руке (например, Revealed)
        sendAction('ADD_STATUS_TO_HAND_CARD', {
          playerId: target.playerId,
          cardIndex: target.cardIndex,
          statusType: item.statusType,
          ownerId: item.ownerId,
          count: item.count || 1
        })
      } else {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_HAND', {
            cardId,
            cardIndex: item.cardIndex, // Pass cardIndex for deck/discard sources
            source: item.source,
            playerId: item.playerId
          })
        }
      }
    } else if (target.target === 'deck') {
      // Перемещение в колоду
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DECK', {
          cardIndex: item.cardIndex,
          playerId: item.playerId
        })
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DECK', {
            cardId,
            source: 'board',
            playerId: item.playerId
          })
        }
      } else if (item.source === 'announced') {
        // Из витрины в колоду
        sendAction('MOVE_ANNOUNCED_TO_DECK', {
          playerId: item.playerId
        })
      } else if (item.source === 'discard') {
        // Из сброса в колоду
        sendAction('MOVE_CARD_TO_DECK', {
          cardIndex: item.cardIndex,
          source: 'discard',
          playerId: item.playerId
        })
      }
    } else if (target.target === 'discard') {
      // Перемещение в сброс
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DISCARD', {
          cardIndex: item.cardIndex,
          playerId: item.playerId
        })
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DISCARD', {
            cardId,
            source: 'board',
            playerId: item.playerId
          })
        }
      } else if (item.source === 'announced') {
        // Из витрины в сброс
        sendAction('MOVE_ANNOUNCED_TO_DISCARD', {
          playerId: item.playerId
        })
      } else if (item.source === 'deck') {
        // Из колоды в сброс
        sendAction('MOVE_CARD_TO_DISCARD', {
          cardIndex: item.cardIndex,
          source: 'deck',
          playerId: item.playerId
        })
      }
    } else if (target.target === 'announced') {
      // Перемещение в витрину (announce)
      sendAction('ANNOUNCE_CARD', {
        cardId: item.card?.id,
        source: item.source,
        cardIndex: item.cardIndex,
        playerId: item.playerId
      })
    }
  }, [sendAction])

  const moveItem = useCallback((item: DragItem, target: any) => {
    // Reuse handleDrop logic for moveItem
    if (target.target === 'board') {
      let action = 'PLAY_CARD'
      let actionData: any = {
        cardIndex: item.cardIndex,
        boardCoords: target.boardCoords,
        faceDown: item.card?.isFaceDown,
        playerId: item.playerId
      }

      if (item.source === 'counter_panel') {
        action = 'ADD_STATUS_TO_BOARD_CARD'
        actionData = {
          boardCoords: target.boardCoords,
          statusType: item.statusType,
          ownerId: item.ownerId,
          replaceStatusType: item.replaceStatusType,
          count: item.count || 1
        }
      } else if (item.source === 'token_panel') {
        action = 'PLAY_TOKEN_CARD'
        actionData = {
          card: item.card,
          boardCoords: target.boardCoords,
          ownerId: item.ownerId
        }
      } else if (item.source === 'deck') {
        action = 'PLAY_CARD_FROM_DECK'
        actionData.cardIndex = item.cardIndex ?? 0
        actionData.playerId = item.playerId
      } else if (item.source === 'discard') {
        // Check if this is a command card - command cards go to announced (showcase) first
        const isCommandCard = item.card?.deck === 'Command' || item.card?.types?.includes('Command') || item.card?.faction === 'Command'
        if (isCommandCard) {
          action = 'ANNOUNCE_CARD'
          actionData = {
            cardIndex: item.cardIndex,
            source: 'discard',
            playerId: item.playerId,
          }
        } else {
          action = 'PLAY_CARD_FROM_DISCARD'
          actionData.cardIndex = item.cardIndex
          actionData.playerId = item.playerId
        }
      } else if (item.source === 'announced') {
        action = 'PLAY_ANNOUNCED_TO_BOARD'
        actionData = {
          row: target.boardCoords.row,
          col: target.boardCoords.col,
          faceDown: item.card?.isFaceDown,
          playerId: item.playerId
        }
      } else if (item.source === 'board') {
        action = 'MOVE_CARD_ON_BOARD'
        // CRITICAL: For False Orders Stun x2, include contextCardId in action data
        // This is simpler than modifying targetingMode.chainedAction and works reliably
        const extraData: any = {
          cardId: item.card?.id,
          fromCoords: item.boardCoords,
          toCoords: target.boardCoords,
          faceDown: item.card?.isFaceDown,
          playerId: item.playerId,
          targetingMode: gameState.targetingMode,
        }

        // Add contextCardId if available in target.chainedAction.payload
        if (target.chainedAction?.payload?.contextCardId) {
          extraData.contextCardId = target.chainedAction.payload.contextCardId
        }

        actionData = extraData
      }

      sendAction(action, actionData)
    } else if (target.target === 'hand') {
      if (item.source === 'announced') {
        sendAction('MOVE_ANNOUNCED_TO_HAND', {
          playerId: item.playerId
        })
      } else {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_HAND', {
            cardId,
            cardIndex: item.cardIndex,
            source: item.source,
            playerId: item.playerId
          })
        }
      }
    } else if (target.target === 'deck') {
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DECK', {
          cardIndex: item.cardIndex,
          playerId: item.playerId
        })
      } else if (item.source === 'deck') {
        // Reordering within deck (e.g., move card to bottom)
        // Get the player's deck to calculate new order
        const player = gameState.players.find(p => p.id === item.playerId)
        if (player && player.deck && item.cardIndex !== undefined) {
          const cardToMove = player.deck[item.cardIndex]
          if (cardToMove) {
            // Create new deck order with card moved to bottom
            const newDeck = player.deck.filter((_, i) => i !== item.cardIndex)
            newDeck.push(cardToMove) // Add to bottom
            sendAction('REORDER_CARDS', {
              playerId: item.playerId,
              newOrder: newDeck
            })
          }
        }
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DECK', {
            cardId,
            source: 'board',
            playerId: item.playerId
          })
        }
      } else if (item.source === 'announced') {
        sendAction('MOVE_ANNOUNCED_TO_DECK', {
          playerId: item.playerId
        })
      } else if (item.source === 'discard') {
        // Из сброса в колоду
        sendAction('MOVE_CARD_TO_DECK', {
          cardIndex: item.cardIndex,
          source: 'discard',
          playerId: item.playerId
        })
      }
    } else if (target.target === 'discard') {
      if (item.source === 'hand') {
        sendAction('MOVE_HAND_CARD_TO_DISCARD', {
          cardIndex: item.cardIndex,
          playerId: item.playerId
        })
      } else if (item.source === 'board') {
        const cardId = item.card?.id
        if (cardId) {
          sendAction('MOVE_CARD_TO_DISCARD', {
            cardId,
            source: 'board',
            playerId: item.playerId
          })
        }
      } else if (item.source === 'announced') {
        sendAction('MOVE_ANNOUNCED_TO_DISCARD', {
          playerId: item.playerId
        })
      } else if (item.source === 'deck') {
        // Из колоды в сброс
        sendAction('MOVE_CARD_TO_DISCARD', {
          cardIndex: item.cardIndex,
          source: 'deck',
          playerId: item.playerId
        })
      }
    } else if (target.target === 'announced') {
      sendAction('ANNOUNCE_CARD', {
        cardId: item.card?.id,
        source: item.source,
        cardIndex: item.cardIndex,
        playerId: item.playerId
      })
    }
  }, [sendAction, gameState])


  const updateState = useCallback((_stateOrFn: any) => {
    if (isHostRef.current) {
      // Хост может обновлять состояние напрямую
      // TODO: интегрировать с applyAction
    }
  }, [])

  const shufflePlayerDeck = useCallback((playerId?: number) => {
    sendAction('SHUFFLE_DECK', { playerId })
  }, [sendAction])

  // ============================================================================
  // Фазовые действия
  // ============================================================================
  const nextPhase = useCallback((forceTurnPass?: boolean) => {
    sendAction('NEXT_PHASE', { forceTurnPass })
  }, [sendAction])

  const prevPhase = useCallback(() => {
    sendAction('PREVIOUS_PHASE')
  }, [sendAction])

  const setPhase = useCallback((phase: number) => {
    sendAction('SET_PHASE', { phase })
  }, [sendAction])

  const passTurn = useCallback(() => {
    sendAction('PASS_TURN', { reason: 'manual' })
  }, [sendAction])

  // ============================================================================
  // Счёт
  // ============================================================================
  const scoreLine = useCallback((r1: number, c1: number, r2: number, c2: number, playerId: number) => {
    sendAction('SELECT_SCORING_LINE', { r1, c1, r2, c2, playerId })
  }, [sendAction])

  const selectScoringLine = useCallback((lineType: string, lineIndex?: number) => {
    sendAction('SELECT_SCORING_LINE', { lineType, lineIndex })
  }, [sendAction])

  const scoreDiagonal = useCallback((r1: number, c1: number, r2: number, c2: number, playerId: number, bonusType?: 'point_per_support' | 'draw_per_support') => {
    sendAction('SCORE_DIAGONAL', { r1, c1, r2, c2, playerId, bonusType })
  }, [sendAction])

  const closeRoundEndModal = useCallback(() => {
    sendAction('START_NEXT_ROUND')
  }, [sendAction])

  const closeRoundEndModalOnly = useCallback(() => {
    // TODO
  }, [])

  const confirmMulligan = useCallback((newHand: any[]) => {
    sendAction('CONFIRM_MULLIGAN', { newHand })
  }, [sendAction])

  const exchangeMulliganCard = useCallback((cardIndex: number) => {
    sendAction('EXCHANGE_MULLIGAN_CARD', { cardIndex })
  }, [sendAction])

  // ============================================================================
  // Visual effects - using useVisualEffects hook
  // ============================================================================

  // Initialize visual effects with simpleHost if available
  // Pass getter functions instead of direct values to ensure updates are captured
  const visualEffects = useVisualEffects({
    simpleHost: () => hostRef.current,
    simpleGuest: () => guestRef.current,
    gameStateRef,
    localPlayerIdRef,
    setLatestHighlight,
    setLatestFloatingTexts,
    setLatestNoTarget,
    setLatestDeckSelections,
    setLatestHandCardSelections,
    setClickWaves,
    setGameState,
    targetingModeLocallyClearedRef,
  })

  const {
    triggerHighlight,
    triggerNoTarget,
    triggerDeckSelection,
    triggerHandCardSelection,
    triggerClickWave,
    triggerFloatingText,
    setTargetingMode,
    clearTargetingMode,
  } = visualEffects

  const syncValidTargets = useCallback((_options: { validHandTargets?: {playerId: number, cardIndex: number}[]; isDeckSelectable?: boolean }) => {
    // Handled via targeting mode in P2P
  }, [])

  // ============================================================================
  // Status effects
  // ============================================================================
  const addBoardCardStatus = useCallback((coords: any, status: any, playerId?: number, count?: number) => {
    const ownerId = playerId ?? localPlayerId ?? 0
    const actualCount = count || 1

    // CRITICAL: Optimistic update - update local gameState immediately
    // This fixes chainedAction not seeing tokens added in previous steps
    setGameState((prev: GameState) => {
      if (!prev.board[coords.row]?.[coords.col]) {
        return prev
      }

      const updatedBoard = prev.board.map((row, rIdx) =>
        row.map((cell, cIdx) => {
          if (rIdx === coords.row && cIdx === coords.col && cell.card) {
            const newStatus = {
              type: status,
              addedByPlayerId: ownerId,
              id: `${status}_${ownerId}_${Date.now()}_${Math.random()}`
            }

            const existingStatuses = cell.card.statuses || []

            // Add the specified number of statuses
            const newStatuses = [...existingStatuses]
            for (let i = 0; i < actualCount; i++) {
              newStatuses.push({
                ...newStatus,
                id: `${status}_${ownerId}_${Date.now()}_${Math.random()}_${i}`
              })
            }

            return {
              ...cell,
              card: {
                ...cell.card,
                statuses: newStatuses
              }
            }
          }
          return cell
        })
      )

      return {
        ...prev,
        board: updatedBoard
      }
    })

    // Map to P2P action format
    sendAction('ADD_STATUS_TO_BOARD_CARD', {
      boardCoords: coords,
      statusType: status,
      ownerId: ownerId,
      count: actualCount
    })
  }, [sendAction, localPlayerId, setGameState])
  const removeBoardCardStatus = useCallback((coords: any, status: any) => {
    // Map to P2P action format - remove only 1 counter, not all
    sendAction('REMOVE_COUNTER_BY_TYPE', { coords, type: status })
  }, [sendAction])
  const removeBoardCardStatusByOwner = useCallback((coords: any, status: any, ownerId: number) => {
    // Remove status by type and owner (for removing counters added by specific player)
    sendAction('REMOVE_COUNTER_BY_TYPE', { coords, type: status, ownerId })
  }, [sendAction])
  const modifyBoardCardPower = useCallback((coords: any, delta: number) => {
    sendAction('MODIFY_CARD_POWER', { coords, delta })
  }, [sendAction])
  const addAnnouncedCardStatus = useCallback((playerId: number, status: any, addedByPlayerId?: number) => {
    sendAction('ADD_ANNOUNCED_STATUS', { playerId, status, addedByPlayerId })
  }, [sendAction])
  const removeAnnouncedCardStatus = useCallback((playerId: number, status: any) => {
    sendAction('REMOVE_ANNOUNCED_STATUS', { playerId, status })
  }, [sendAction])
  const modifyAnnouncedCardPower = useCallback(() => {}, [])
  const addHandCardStatus = useCallback(() => {}, [])
  const removeHandCardStatus = useCallback(() => {}, [])
  const flipBoardCard = useCallback((coords: any) => {
    if (!coords) { return }
    sendAction('FLIP_CARD', { boardCoords: coords, faceDown: false })
  }, [sendAction])

  const flipBoardCardFaceDown = useCallback((coords: any) => {
    if (!coords) { return }
    sendAction('FLIP_CARD', { boardCoords: coords, faceDown: true })
  }, [sendAction])
  const revealHandCard = useCallback(() => {}, [])
  const revealBoardCard = useCallback(() => {}, [])
  const requestCardReveal = useCallback((request: any, requesterPlayerId?: number) => {
    sendAction('REQUEST_CARD_REVEAL', { request, requesterPlayerId })
  }, [sendAction])
  const respondToRevealRequest = useCallback((requesterPlayerId: number, accept: boolean) => {
    sendAction('RESPOND_REVEAL_REQUEST', { requesterPlayerId, accept })
  }, [sendAction])

  // ============================================================================
  // Game lifecycle
  // ============================================================================
  const syncGame = useCallback(() => {}, [])
  const toggleActivePlayer = useCallback(() => {}, [])
  const toggleAutoDraw = useCallback((playerId: number, enabled: boolean) => {
    sendAction('TOGGLE_AUTO_DRAW', { playerId, enabled })
  }, [sendAction])
  const forceReconnect = useCallback(async () => {
    // SimpleGuest has reconnect(), TrysteroGuest has requestReconnect()
    if (guestRef.current) {
      if (typeof guestRef.current.reconnect === 'function') {
        await guestRef.current.reconnect()
      } else if (typeof (guestRef.current as any).requestReconnect === 'function') {
        await (guestRef.current as any).requestReconnect()
      }
    }
  }, [])

  // ============================================================================
  // Card manipulation
  // ============================================================================
  const destroyCard = useCallback((card: Card, boardCoords: { row: number; col: number }) => {
    sendAction('DESTROY_CARD', { cardId: card.id, boardCoords })
  }, [sendAction])

  const applyGlobalEffect = useCallback(() => {}, [])
  const swapCards = useCallback((coords1: {row: number, col: number}, coords2: {row: number, col: number}) => {
    sendAction('SWAP_CARDS', { coords1, coords2 })
  }, [sendAction])
  const transferStatus = useCallback(() => {}, [])
  const transferAllCounters = useCallback(() => {}, [])
  const transferAllStatusesWithoutException = useCallback((fromCoords: {row: number, col: number}, toCoords: {row: number, col: number}) => {
    sendAction('TRANSFER_ALL_STATUSES', { fromCoords, toCoords })
  }, [sendAction])
  const recoverDiscardedCard = useCallback((playerId: number, cardIndex: number) => {
    sendAction('RECOVER_DISCARDED', { playerId, cardIndex })
  }, [sendAction])
  const resurrectDiscardedCard = useCallback((playerId: number, cardIndex: number, boardCoords: {row: number, col: number}) => {
    sendAction('RESURRECT_DISCARDED', { cardOwnerId: playerId, cardIndex, boardCoords })
  }, [sendAction])
  const spawnToken = useCallback((coords: {row: number, col: number}, name: string, ownerId: number) => {
    // Get token data from tokenDatabase
    const tokenDef = tokenDatabase.get(name)
    const tokenData = tokenDef ? {
      baseId: name,
      name: tokenDef.name,
      imageUrl: tokenDef.imageUrl,
      fallbackImage: tokenDef.fallbackImage,
      power: tokenDef.power,
      abilityText: tokenDef.abilityText,
      types: tokenDef.types || []
    } : null

    sendAction('SPAWN_TOKEN', { coords, tokenName: name, ownerId, tokenData })
  }, [sendAction])

  // ============================================================================
  // Game reset
  // ============================================================================
  const resetGame = useCallback(() => {
    sendAction('RESET_GAME')
  }, [sendAction])
  const resetDeployStatus = useCallback((coords: { row: number; col: number }) => {
    // Remove deployUsedThisTurn status from the card at coords
    // This allows the card to use its Deploy ability again (Experimental Stimulants)
    sendAction('REMOVE_ALL_COUNTERS_BY_TYPE', { coords, type: 'deployUsedThisTurn' })
  }, [sendAction])
  const removeStatusByType = useCallback((coords: { row: number; col: number }, type: string) => {
    sendAction('REMOVE_ALL_COUNTERS_BY_TYPE', { coords, type })
  }, [sendAction])
  const reorderTopDeck = useCallback((playerId: number, newTopCards: any[]) => {
    sendAction('REORDER_TOP_DECK', { playerId, newTopCards })
  }, [sendAction])
  const reorderCards = useCallback((playerId: number, newOrder: any[]) => {
    sendAction('REORDER_CARDS', { playerId, newOrder })
  }, [sendAction])
  const requestDeckView = useCallback((targetPlayerId: number) => {
    sendAction('REQUEST_DECK_VIEW', { targetPlayerId })
  }, [sendAction])

  const markAbilityUsed = useCallback((coords: any, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => {
    sendAction('MARK_ABILITY_USED', { coords, isDeploy, setDeployAttempted, readyStatusToRemove })
  }, [sendAction])

  // ============================================================================
  // Legacy
  // ============================================================================
  const requestGamesList = useCallback(() => {}, [])

  const exitGame = useCallback(() => {
    // Clear saved credentials and session to prevent auto-reconnect
    localStorage.removeItem('webrtc_host_peer_id')
    localStorage.removeItem('player_token')
    localStorage.removeItem('webrtc_host_session') // Clear host session data

    // CRITICAL: Different behavior for host vs guests
    if (isHostRef.current) {
      // Host is exiting - notify all guests and end game for everyone
      try {
        if (hostRef.current) {
          hostRef.current.hostAction('HOST_EXIT_GAME', {})
        } else if (hostManagerRef.current) {
          hostManagerRef.current.hostAction('HOST_EXIT_GAME', {})
        }
      } catch (e) {
        // Failed to send HOST_EXIT message
      }
    } else if (guestRef.current && !isHostRef.current) {
      // Guest is exiting - notify host so we become dummy (no reconnection)
      try {
        guestRef.current.sendAction('EXIT_GAME', {})
      } catch (e) {
        // Failed to send EXIT message
      }
    }

    // Destroy connections (this will disconnect from signalling servers)
    hostRef.current?.destroy()
    guestRef.current?.destroy()
    hostManagerRef.current?.destroy()
    guestManagerRef.current?.destroy()
    hostRef.current = null
    guestRef.current = null
    hostManagerRef.current = null
    guestManagerRef.current = null
    isHostRef.current = false

    // Reset state
    setGameState(createInitialState())
    setConnectionStatus('Disconnected')
    setIsReconnecting(false)
    setReconnectProgress(null)
  }, [])

  // Disconnect host and PeerJS when returning to main menu
  // Called automatically when MainMenu is opened
  const disconnectHostAndPeerJS = useCallback(() => {
    // Destroy host connections
    if (hostRef.current) {
      hostRef.current.destroy()
      hostRef.current = null
    }
    if (hostManagerRef.current) {
      // Disconnect from signalling server first
      if (hostManagerRef.current.isConnectedToSignalling()) {
        hostManagerRef.current.disconnectFromSignalling()
      }
      hostManagerRef.current.destroy()
      hostManagerRef.current = null
    }

    // Destroy guest connections too
    if (guestRef.current) {
      guestRef.current.destroy()
      guestRef.current = null
    }
    if (guestManagerRef.current) {
      guestManagerRef.current.destroy()
      guestManagerRef.current = null
    }

    // Clear host flags
    isHostRef.current = false

    // Clear saved credentials
    localStorage.removeItem('webrtc_host_peer_id')
    localStorage.removeItem('webrtc_host_session')

    logger.info('[disconnectHostAndPeerJS] Host mode and PeerJS disconnected')
  }, [])

  // ============================================================================
  // Вспомогательные
  // ============================================================================
  const setDraggedItem = useCallback((item: DragItem | null) => {
    setDraggedItemState(item)
    // Dispatch custom event to hide tooltips when drag starts
    if (item !== null) {
      window.dispatchEvent(new CustomEvent('cardDragStart'))
    } else {
      window.dispatchEvent(new CustomEvent('cardDragEnd'))
    }
  }, [])

  // ============================================================================
  // WebRTC свойства
  // ============================================================================
  // Check both hostRef (old SimpleHost) and hostManagerRef (new HostConnectionManager)
  const webrtcHostId = hostRef.current?.getPeerId() || hostManagerRef.current?.getPeerId() || null
  const webrtcIsHost = isHostRef.current

  // ============================================================================
  // Очистка при размонтировании
  // ============================================================================
  useEffect(() => {
    // Cleanup on component unmount
    const cleanup = () => {
      hostRef.current?.destroy()
      hostManagerRef.current?.destroy()
      guestRef.current?.destroy()
    }

    // Also cleanup on page unload to ensure PeerJS connections are closed
    const handleBeforeUnload = () => {
      // Send EXIT_GAME if connected as guest to let host know we're leaving
      if (guestRef.current && !isHostRef.current) {
        try {
          guestRef.current.sendAction('EXIT_GAME', {})
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
      // Destroy connections
      cleanup()
    }

    // Handle visibility change - when user returns to the tab, ensure connection is alive
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // User returned to the tab - trigger reconnection if needed
        // The existing reconnection logic in handlePeerMessage will handle this
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      cleanup()
    }
  }, [])

  // ============================================================================
  // Функция для получения свежего состояния из host/guest
  // Это необходимо для случаев когда React state еще не обновился
  // ============================================================================
  const getFreshGameState = useCallback((): GameState => {
    if (hostRef.current) {
      // For host, get state directly from SimpleHost
      return personalToGameState(hostRef.current.state, 1)
    }
    if (guestRef.current) {
      // For guest, get state from SimpleGuest
      const myId = localPlayerId || 0
      return personalToGameState(guestRef.current.state, myId)
    }
    // Fallback to React state
    return gameState
  }, [gameState, localPlayerId])

  // ============================================================================
  // Результат
  // ============================================================================
  return {
    gameState,
    getFreshGameState, // Функция для получения свежего состояния из host/guest
    localPlayerId,
    setLocalPlayerId,
    draggedItem,
    setDraggedItem,
    connectionStatus,
    gamesList: [],

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
    triggerHighlight,
    latestHighlight: latestHighlightRef.current,
    triggerNoTarget,
    latestNoTarget: latestNoTargetRef.current,
    triggerDeckSelection,
    triggerHandCardSelection,
    triggerClickWave,
    clickWaves: clickWavesRef.current,
    syncValidTargets,
    setTargetingMode,
    clearTargetingMode,
    nextPhase,
    prevPhase,
    setPhase,
    passTurn,
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
    scoreDiagonal,
    selectScoringLine,
    closeRoundEndModal,
    closeRoundEndModalOnly,
    confirmMulligan,
    exchangeMulliganCard,
    resetGame,
    resetDeployStatus,
    removeStatusByType,
    reorderTopDeck,
    reorderCards,
    requestDeckView,
    triggerFloatingText,
    latestFloatingTexts,
    latestDeckSelections: latestDeckSelectionsRef.current,
    latestHandCardSelections: latestHandCardSelectionsRef.current,
    sendAction,
    moveItem,
    requestGamesList,
    exitGame,
    disconnectHostAndPeerJS,

    // WebRTC
    webrtcHostId,
    webrtcIsHost,

    // Compatibility aliases
    initializeWebrtcHost: createGame,
    connectAsGuest: useCallback(async (hostId: string) => {
      try {
        await joinGameViaModal(hostId)
        return true
      } catch {
        return false
      }
    }, [joinGameViaModal]),

    // Additional WebRTC compatibility props (stubs for now)
    sendFullDeckToHost: (_playerId: number, _deck: any[], _deckLength: number) => {},
    shareHostDeckWithGuests: (_deck: any[], _deckLength: number) => {},
    isReconnecting,
    reconnectProgress,

    // NEW: Local game and signalling control
    createLocalGame,
    connectToSignalling,
    disconnectFromSignalling,
    isConnectedToSignalling,
    isGameInitialized,
  }
}

export default useGameState
