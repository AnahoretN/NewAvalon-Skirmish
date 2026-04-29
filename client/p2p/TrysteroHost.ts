/**
 * TrysteroHost
 *
 * Trystero-based host implementation.
 * Uses BitTorrent trackers for P2P signaling instead of centralized server.
 */

import { joinRoom, selfId } from '@trystero-p2p/torrent'
import type { GameState, AbilityAction, Card } from '../types'
import type {
  ActionMessage,
  StateMessage,
  PersonalizedState,
  SimpleHostConfig
} from './SimpleP2PTypes'
import { applyAction } from './SimpleGameLogic'
import { logger } from '../utils/logger'
import { createDeck, createInitialState } from '../hooks/core/gameCreators'
import { getDecksData } from '../content'
import type { DeckType } from '../types'
import { getRandomHostColor, assignUniqueRandomColor } from '../utils/colorAssigner'

/**
 * Helper function to sanitize AbilityAction for P2P transmission
 */
function sanitizeActionForP2P(action: AbilityAction): any {
  const sanitized: any = {
    type: action.type,
    mode: action.mode,
    tokenType: action.tokenType,
    count: action.count,
    dynamicCount: action.dynamicCount,
    onlyFaceDown: action.onlyFaceDown,
    onlyOpponents: action.onlyOpponents,
    targetOwnerId: action.targetOwnerId,
    excludeOwnerId: action.excludeOwnerId,
    targetType: action.targetType,
    sourceCoords: action.sourceCoords,
    payload: action.payload ? { ...action.payload } : undefined,
    isDeployAbility: action.isDeployAbility,
    recordContext: action.recordContext,
    contextCheck: action.contextCheck,
    requiredTargetStatus: action.requiredTargetStatus,
    requireStatusFromSourceOwner: action.requireStatusFromSourceOwner,
    mustBeAdjacentToSource: action.mustBeAdjacentToSource,
    mustBeInLineWithSource: action.mustBeInLineWithSource,
    maxDistanceFromSource: action.maxDistanceFromSource,
    maxOrthogonalDistance: action.maxOrthogonalDistance,
    placeAllAtOnce: action.placeAllAtOnce,
  }

  if (sanitized.payload) {
    delete sanitized.payload.filter
    delete sanitized.payload.filterFn
    delete (sanitized.payload as any).cost?.filter
  }

  if (action.sourceCard) {
    sanitized.sourceCard = sanitizeCardForP2P(action.sourceCard)
  }

  if (action.chainedAction) {
    sanitized.chainedAction = sanitizeActionForP2P(action.chainedAction)
  }

  return sanitized
}

function sanitizeCardForP2P(card: Card): any {
  return {
    id: card.id,
    baseId: card.baseId,
    deck: card.deck,
    name: card.name,
    imageUrl: card.imageUrl,
    power: card.power,
    abilityText: card.abilityText,
    ownerId: card.ownerId,
    ownerName: card.ownerName,
    types: card.types,
    faction: card.faction,
  }
}

function sanitizeTargetingModeForP2P(targetingMode: any): any {
  if (!targetingMode) {
    return null
  }

  const sanitized: any = {
    playerId: targetingMode.playerId,
    action: sanitizeActionForP2P(targetingMode.action),
    sourceCoords: targetingMode.sourceCoords,
    timestamp: targetingMode.timestamp,
    boardTargets: targetingMode.boardTargets,
    handTargets: targetingMode.handTargets,
    isDeckSelectable: targetingMode.isDeckSelectable,
    originalOwnerId: targetingMode.originalOwnerId,
    ownerId: targetingMode.ownerId,
  }

  if (targetingMode.chainedAction) {
    sanitized.chainedAction = sanitizeActionForP2P(targetingMode.chainedAction)
  }

  return sanitized
}

/**
 * TrysteroHost configuration
 */
export interface TrysteroHostConfig extends SimpleHostConfig {
  appId?: string  // Unique app ID for Trystero
  trackers?: string[]  // Custom BitTorrent trackers
}

/**
 * TrysteroHost - Trystero-based host
 */
export class TrysteroHost {
  private room: any = null
  private peerIdToTrysteroId: Map<number, string> = new Map()
  private trysteroIdToPlayerId: Map<string, number> = new Map()
  private playerIdCounter: number

  // Game state
  private state: GameState
  private version: number = 0

  // Reconnection timers
  private reconnectTimers: Map<number, NodeJS.Timeout> = new Map()

  // Configuration
  private config: TrysteroHostConfig

  // Actions
  private sendState: ((data: any, target?: string | string[]) => Promise<void>) | null = null
  private sendAction: ((data: any, target?: string | string[]) => Promise<void>) | null = null
  private sendVisual: ((data: any, target?: string | string[]) => Promise<void>) | null = null

  constructor(initialState: GameState, config: TrysteroHostConfig = {}) {
    this.state = initialState
    this.config = config

    const maxPlayerId = initialState.players.length > 0
      ? Math.max(...initialState.players.map(p => p.id))
      : 1
    this.playerIdCounter = maxPlayerId + 1
  }

  /**
   * Get random deck type
   */
  private getRandomDeckType(): DeckType {
    const decksData = getDecksData()
    const deckKeys = Object.keys(decksData) as DeckType[]
    const playableDeckKeys = deckKeys.filter(deckType => {
      const deck = decksData[deckType]
      return deck && deck.length >= 20
    })

    if (playableDeckKeys.length === 0) {
      return 'SynchroTech' as DeckType
    }

    return playableDeckKeys[Math.floor(Math.random() * playableDeckKeys.length)]
  }

  /**
   * Create deck for player
   */
  private createPlayerDeck(playerId: number, playerName: string, deckType: DeckType): any[] {
    return createDeck(deckType, playerId, playerName)
  }

  /**
   * Generate unique token for player
   */
  private generatePlayerToken(): string {
    return Math.random().toString(36).substring(2, 18) + Date.now().toString(36)
  }

  /**
   * Generate gameId
   */
  private generateGameId(): string {
    return Math.random().toString(36).substring(2, 18).toUpperCase()
  }

  /**
   * Initialize host
   */
  async initialize(roomId?: string): Promise<string> {
    const appId = this.config.appId || 'newavalon-skirmish'
    const actualRoomId = roomId || this.generateGameId()

    return new Promise((resolve, reject) => {
      try {
        const trysteroConfig: any = { appId }

        if (this.config.trackers) {
          trysteroConfig.relayUrls = this.config.trackers
        }

        this.room = joinRoom(trysteroConfig, actualRoomId)

        // Set up state broadcast action
        const [sendState, getState] = this.room.makeAction('STATE')
        this.sendState = sendState

        getState((data: StateMessage, trysteroId: string) => {
          // Host doesn't receive state from others
        })

        // Set up action receive
        const [sendAction, getAction] = this.room.makeAction('ACTION')
        this.sendAction = sendAction

        getAction((data: ActionMessage, trysteroId: string) => {
          this.handleAction(data, trysteroId)
        })

        // Set up join request
        const [_sendJoinRequest, getJoinRequest] = this.room.makeAction('JOIN_REQUEST')
        getJoinRequest((data: any, trysteroId: string) => {
          this.handleJoinRequest(data, trysteroId)
        })

        // Set up reconnect
        const [_sendReconnect, getReconnect] = this.room.makeAction('RECONNECT')
        getReconnect((data: any, trysteroId: string) => {
          this.handleReconnect(data, trysteroId)
        })

        // Set up visual effects
        const [sendVisual, getVisual] = this.room.makeAction('VISUAL')
        this.sendVisual = sendVisual
        getVisual((data: any, trysteroId: string) => {
          this.handleVisualEffect(data, trysteroId)
        })

        // Initialize host player
        const hostToken = this.generatePlayerToken()
        const hostDeckType = this.getRandomDeckType()
        const hostDeck = this.createPlayerDeck(1, localStorage.getItem('player_name') || 'Host', hostDeckType)
        const hostColor = getRandomHostColor()

        this.state = {
          ...this.state,
          gameId: actualRoomId,
          players: [
            {
              id: 1,
              name: localStorage.getItem('player_name') || 'Host',
              score: 0,
              hand: [],
              deck: hostDeck,
              discard: [],
              announcedCard: null,
              selectedDeck: hostDeckType,
              color: hostColor,
              isDummy: false,
              isDisconnected: false,
              isReady: false,
              boardHistory: [],
              autoDrawEnabled: true,
              playerToken: hostToken
            }
          ]
        }

        localStorage.setItem('player_token', hostToken)

        // Notify about initial state
        this.notifyStateUpdate()

        logger.info('[TrysteroHost] Initialized', { roomId: actualRoomId, peerId: selfId })
        resolve(actualRoomId)

      } catch (e) {
        reject(e)
      }
    })
  }

  /**
   * Handle action from player
   */
  private handleAction(actionMsg: ActionMessage, trysteroId: string): void {
    const { playerId, action, data } = actionMsg

    // Verify playerId matches trysteroId
    const expectedTrysteroId = this.getTrysteroIdForPlayer(playerId)
    if (expectedTrysteroId !== trysteroId) {
      return
    }

    // Handle special actions
    if (action === 'TARGETING_MODE') {
      const sanitizedTargetingMode = sanitizeTargetingModeForP2P(data)
      if (sanitizedTargetingMode.handTargets && sanitizedTargetingMode.handTargets.length > 0) {
        console.log('[DISCARD_FROM_HAND] TrysteroHost received TARGETING_MODE with handTargets:', {
          playerId: sanitizedTargetingMode.playerId,
          actionType: sanitizedTargetingMode.action?.payload?.actionType,
          handTargetsCount: sanitizedTargetingMode.handTargets.length,
          handTargets: sanitizedTargetingMode.handTargets,
        })
      }
      this.state = {
        ...this.state,
        targetingMode: sanitizedTargetingMode
      }
      this.version++
      this.broadcastAll()
      return
    }

    if (action === 'CLEAR_TARGETING_MODE') {
      this.state = {
        ...this.state,
        targetingMode: null
      }
      this.version++
      this.broadcastAll()
      return
    }

    if (action === 'EXIT_GAME') {
      const timer = this.reconnectTimers.get(playerId)
      if (timer) {
        clearTimeout(timer)
        this.reconnectTimers.delete(playerId)
      }

      this.state = {
        ...this.state,
        players: this.state.players.map(p =>
          p.id === playerId
            ? {
                ...p,
                isDummy: true,
                isDisconnected: false,
                disconnectTimestamp: undefined,
                reconnectionDeadline: undefined,
                playerToken: undefined
              }
            : p
        )
      }

      this.peerIdToTrysteroId.delete(playerId)
      this.trysteroIdToPlayerId.delete(trysteroId)

      this.version++
      this.broadcastAll()
      this.config.onPlayerLeave?.(playerId)
      return
    }

    if (action === 'HOST_EXIT_GAME') {
      this.broadcast({
        type: 'HOST_ENDED_GAME',
        data: { reason: 'host_ended_game' }
      })
      this.config.onHostEndedGame?.()
      return
    }

    // Normal action flow
    const oldState = this.state
    const newState = applyAction(oldState, playerId, action, data)

    if (newState !== oldState) {
      this.state = newState

      const maxPlayerId = newState.players.length > 0
        ? Math.max(...newState.players.map(p => p.id))
        : 0
      if (maxPlayerId >= this.playerIdCounter) {
        this.playerIdCounter = maxPlayerId + 1
      }
      this.version++
      this.broadcastAll()
    }
  }

  /**
   * Handle join request
   */
  private handleJoinRequest(data: any, trysteroId: string): void {
    const { playerName, playerToken } = data

    logger.info('[TrysteroHost] JOIN_REQUEST received:', {
      trysteroId,
      playerName,
      hasToken: !!playerToken
    })

    // Check for reconnection
    if (playerToken) {
      const existingPlayerId = this.findPlayerByToken(playerToken)
      if (existingPlayerId) {
        logger.info('[TrysteroHost] Reconnecting existing player:', existingPlayerId)

        const timer = this.reconnectTimers.get(existingPlayerId)
        if (timer) {
          clearTimeout(timer)
          this.reconnectTimers.delete(existingPlayerId)
        }

        const oldTrysteroId = this.getTrysteroIdForPlayer(existingPlayerId)
        if (oldTrysteroId && oldTrysteroId !== trysteroId) {
          this.trysteroIdToPlayerId.delete(oldTrysteroId)
        }

        this.trysteroIdToPlayerId.set(trysteroId, existingPlayerId)
        this.peerIdToTrysteroId.set(existingPlayerId, trysteroId)

        this.state = {
          ...this.state,
          players: this.state.players.map(p =>
            p.id === existingPlayerId
              ? { ...p, isDisconnected: false, disconnectTimestamp: undefined, reconnectionDeadline: undefined }
              : p
          )
        }

        this.version++

        const personalizedState = this.personalizeForPlayer(existingPlayerId)

        this.sendAction?.({
          type: 'JOIN_ACCEPT',
          playerId: existingPlayerId,
          state: personalizedState,
          version: this.version
        }, trysteroId)

        this.broadcastAll()
        return
      }
    }

    // New player
    const newPlayerId = this.playerIdCounter++
    const randomDeckType = this.getRandomDeckType()
    const newPlayerDeck = this.createPlayerDeck(newPlayerId, playerName || `Player ${newPlayerId}`, randomDeckType)

    const existingColors = this.state.players.map(p => p.color)
    const newPlayerColor = assignUniqueRandomColor(existingColors)

    this.state = {
      ...this.state,
      players: [
        ...this.state.players,
        {
          id: newPlayerId,
          name: playerName || `Player ${newPlayerId}`,
          score: 0,
          hand: [],
          deck: newPlayerDeck,
          discard: [],
          selectedDeck: randomDeckType,
          color: newPlayerColor,
          isDummy: false,
          isDisconnected: false,
          isReady: false,
          boardHistory: [],
          playerToken: playerToken || this.generatePlayerToken()
        }
      ]
    }

    this.trysteroIdToPlayerId.set(trysteroId, newPlayerId)
    this.peerIdToTrysteroId.set(newPlayerId, trysteroId)

    this.version++

    const personalizedState = this.personalizeForPlayer(newPlayerId)

    this.sendAction?.({
      type: 'JOIN_ACCEPT',
      playerId: newPlayerId,
      state: personalizedState,
      version: this.version
    }, trysteroId)

    this.broadcastAll()
    this.notifyStateUpdate()
    this.config.onPlayerJoin?.(newPlayerId)
  }

  /**
   * Handle reconnection
   */
  private handleReconnect(data: any, trysteroId: string): void {
    const { playerId } = data

    const player = this.state.players.find(p => p.id === playerId)
    if (!player || player.isDummy) {
      this.sendAction?.({ type: 'RECONNECT_REJECTED', reason: player?.isDummy ? 'Player converted to dummy' : 'Player not found' }, trysteroId)
      return
    }

    const timer = this.reconnectTimers.get(playerId)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(playerId)
    }

    this.trysteroIdToPlayerId.set(trysteroId, playerId)

    this.state = {
      ...this.state,
      players: this.state.players.map(p =>
        p.id === playerId
          ? { ...p, isDisconnected: false, disconnectTimestamp: undefined, reconnectionDeadline: undefined }
          : p
      )
    }

    this.version++

    this.sendAction?.({
      type: 'STATE',
      version: this.version,
      state: this.personalizeForPlayer(playerId),
      timestamp: Date.now()
    }, trysteroId)

    this.broadcastAll()
  }

  /**
   * Handle visual effect from guest
   */
  private handleVisualEffect(data: any, trysteroId: string): void {
    // Broadcast to all other guests
    this.broadcastVisual(data, trysteroId)
  }

  /**
   * Broadcast state to all players
   */
  private broadcastAll(): void {
    const message: Omit<StateMessage, 'timestamp'> = {
      type: 'STATE',
      version: this.version,
      state: this.state as any
    }

    this.notifyStateUpdate()

    this.trysteroIdToPlayerId.forEach((playerId, trysteroId) => {
      const personalized = this.personalizeForPlayer(playerId)
      this.sendAction?.({
        ...message,
        state: personalized,
        timestamp: Date.now()
      }, trysteroId)
    })

    if (this.state.floatingTexts && this.state.floatingTexts.length > 0) {
      this.state = {
        ...this.state,
        floatingTexts: []
      }
    }
  }

  /**
   * Broadcast visual effect to all players except sender
   */
  private broadcastVisual(data: any, excludeTrysteroId?: string): void {
    this.trysteroIdToPlayerId.forEach((playerId, trysteroId) => {
      if (trysteroId !== excludeTrysteroId) {
        this.sendVisual?.(data, trysteroId)
      }
    })
  }

  /**
   * Personalize state for player
   */
  private personalizeForPlayer(localPlayerId: number): PersonalizedState {
    const baseState = this.state

    const visualEffectsObj: Record<string, any> = {}
    if (baseState.visualEffects instanceof Map) {
      for (const [key, value] of baseState.visualEffects.entries()) {
        visualEffectsObj[key] = value
      }
    }

    const getColorBgClass = (colorName: string): string => {
      const colorMap: Record<string, string> = {
        blue: 'bg-blue-600',
        purple: 'bg-purple-600',
        red: 'bg-red-600',
        green: 'bg-green-600',
        yellow: 'bg-yellow-500',
        orange: 'bg-orange-500',
        pink: 'bg-pink-500',
        brown: 'bg-[#8B4513]'
      }
      return colorMap[colorName] || 'bg-gray-600'
    }

    const result = {
      ...baseState,
      visualEffects: visualEffectsObj,
      players: baseState.players.map(player => {
        const isLocalPlayer = player.id === localPlayerId
        const isDummy = player.isDummy
        const playerBgClass = getColorBgClass(player.color)

        if (isLocalPlayer || isDummy) {
          return {
            id: player.id,
            name: player.name,
            score: player.score,
            color: player.color,
            isDummy: player.isDummy,
            isDisconnected: player.isDisconnected,
            isReady: player.isReady,
            teamId: player.teamId,
            autoDrawEnabled: player.autoDrawEnabled,
            isSpectator: player.isSpectator,
            position: player.position,
            selectedDeck: player.selectedDeck,
            playerToken: player.playerToken,
            hand: player.hand,
            deck: player.deck,
            discard: player.discard,
            announcedCard: player.announcedCard ? { ...player.announcedCard } : null,
            boardHistory: player.boardHistory,
            lastPlayedCardId: player.lastPlayedCardId || null,
            hasMulliganed: player.hasMulliganed,
            mulliganAttempts: player.mulliganAttempts,
            disconnectTimestamp: player.disconnectTimestamp,
            reconnectionDeadline: player.reconnectionDeadline
          }
        }

        // Opponents - placeholder cards
        const placeholderHand = (player.hand || []).map((card: any) => {
          const isRevealedToMe = card.revealedTo?.includes(localPlayerId) ||
            (card.statuses || []).some((s: any) => s.type === 'Revealed' && s.ownerId === localPlayerId)

          if (isRevealedToMe) {
            return { ...card, _isPlaceholder: false }
          }

          return {
            _isPlaceholder: true,
            id: card.id,
            baseId: card.baseId,
            ownerId: card.ownerId || player.id,
            statuses: card.statuses || [],
            revealedTo: card.revealedTo,
            deck: '' as const,
            name: '',
            power: 0,
            abilityText: '',
            types: [],
            imageUrl: '',
            fallbackImage: '',
            color: playerBgClass
          }
        })

        return {
          id: player.id,
          name: player.name,
          score: player.score,
          color: player.color,
          isDummy: player.isDummy,
          isDisconnected: player.isDisconnected,
          isReady: player.isReady,
          teamId: player.teamId,
          autoDrawEnabled: player.autoDrawEnabled,
          isSpectator: player.isSpectator,
          position: player.position,
          selectedDeck: player.selectedDeck,
          hand: placeholderHand,
          handSize: player.hand?.length || 0,
          deckSize: player.deck?.length || 0,
          discardSize: player.discard?.length || 0,
          announcedCard: player.announcedCard ? { ...player.announcedCard } : null,
          lastPlayedCardId: player.lastPlayedCardId || null,
          hasMulliganed: player.hasMulliganed,
          mulliganAttempts: player.mulliganAttempts,
          disconnectTimestamp: player.disconnectTimestamp,
          reconnectionDeadline: player.reconnectionDeadline
        }
      }) as any
    }

    return result as PersonalizedState
  }

  /**
   * Get trysteroId for player
   */
  private getTrysteroIdForPlayer(playerId: number): string | null {
    return this.peerIdToTrysteroId.get(playerId) || null
  }

  /**
   * Find player by token
   */
  private findPlayerByToken(token: string): number | null {
    const player = this.state.players.find(p => p.playerToken === token)
    return player?.id || null
  }

  /**
   * Notify about state change
   */
  private notifyStateUpdate(): void {
    if (this.config.onStateUpdate) {
      const hostState = this.personalizeForPlayer(1)
      this.config.onStateUpdate(hostState)
    }
  }

  /**
   * Execute action from host
   */
  hostAction(action: string, data?: any): void {
    this.handleAction({
      type: 'ACTION',
      playerId: 1,
      action: action as any,
      data,
      timestamp: Date.now()
    }, selfId)
  }

  /**
   * Get current state
   */
  getState(): PersonalizedState {
    return this.personalizeForPlayer(1)
  }

  /**
   * Get room ID (equivalent to peerId in PeerJS)
   */
  getPeerId(): string | null {
    return this.room ? selfId : null
  }

  /**
   * Get current state version
   */
  getVersion(): number {
    return this.version
  }

  /**
   * Broadcast visual effect message to all guests
   */
  broadcast(message: any): void {
    this.trysteroIdToPlayerId.forEach((playerId, trysteroId) => {
      this.sendVisual?.({
        ...message,
        timestamp: Date.now()
      }, trysteroId)
    })
  }

  /**
   * Export current state for session restoration
   */
  exportSession(): { roomId: string; state: GameState; timestamp: number } | null {
    if (!this.state.gameId) {
      return null
    }

    return {
      roomId: this.state.gameId,
      state: JSON.parse(JSON.stringify(this.state)) as GameState,
      timestamp: Date.now()
    }
  }

  /**
   * Get raw game state
   */
  getRawState(): GameState {
    return this.state
  }

  /**
   * Set targeting mode
   */
  setTargetingMode(targetingMode: any): void {
    const sanitizedTargetingMode = sanitizeTargetingModeForP2P(targetingMode)
    this.state = {
      ...this.state,
      targetingMode: sanitizedTargetingMode
    }
    this.version++
    this.broadcastAll()
  }

  /**
   * Clear targeting mode
   */
  clearTargetingMode(): void {
    this.state = {
      ...this.state,
      targetingMode: null
    }
    this.version++
    this.broadcastAll()
  }

  /**
   * Shutdown
   */
  destroy(): void {
    if (this.room) {
      this.room.leave()
      this.room = null
    }
    this.trysteroIdToPlayerId.clear()
    this.peerIdToTrysteroId.clear()
  }
}

/**
 * Create TrysteroHost from saved session data
 */
export function createHostFromSavedSession(
  savedData: { roomId: string; state: GameState; timestamp: number },
  config: TrysteroHostConfig = {}
): TrysteroHost {
  const maxAge = 60 * 60 * 1000
  if (Date.now() - savedData.timestamp > maxAge) {
    logger.warn('[createHostFromSavedSession] Saved session is too old, creating fresh host')
    return new TrysteroHost(createInitialState(), config)
  }

  logger.info('[createHostFromSavedSession] Restoring host with roomId:', savedData.roomId)
  return new TrysteroHost(savedData.state, config)
}

export default TrysteroHost
