/**
 * ConnectionManager
 *
 * Manages P2P connection with automatic fallback:
 * 1. PeerJS Cloud (0.peerjs.com)
 * 2. Community PeerJS servers
 * 3. Trystero (BitTorrent trackers)
 */

import { loadPeerJS } from './PeerJSLoader'
import { getPeerJSOptions, tryNextPeerJSServer, ALTERNATIVE_PEERJS_SERVERS, isTrysteroEnabled, getAllSignalingServers, getServerCount } from './rtcConfig'
import SimpleHost from './SimpleHost'
import SimpleGuest from './SimpleGuest'
import TrysteroHost, { TrysteroHostConfig } from './TrysteroHost'
import TrysteroGuest, { TrysteroGuestConfig } from './TrysteroGuest'
import type { SimpleHostConfig, SimpleGuestConfig, PersonalizedState } from './SimpleP2PTypes'
import type { GameState } from '../types'
import {
  logManagerStrategy,
  logManagerPeerJSAttempt,
  logManagerPeerJSFailed,
  logManagerAllServersFailed,
  logManagerConnected,
  logManagerLocalOnly,
  logManagerConnectingToSignalling
} from './P2PLogger'

/**
 * Connection strategy types
 */
export type ConnectionStrategy = 'peerjs' | 'trystero'

/**
 * Connection status
 */
export type ConnectionStatus = 'disconnected' | 'connecting-peerjs' | 'connecting-trystero' | 'connected' | 'failed'

/**
 * Connection manager configuration
 */
export interface ConnectionManagerConfig {
  // Preferred strategy (default: 'peerjs')
  preferredStrategy?: ConnectionStrategy

  // Enable/disable Trystero fallback
  enableTrysteroFallback?: boolean

  // Connection timeout (ms)
  connectionTimeout?: number

  // Trystero configuration
  trysteroAppId?: string
  trysteroTrackers?: string[]
}

/**
 * ConnectionManager for host
 */
export class HostConnectionManager {
  private config: ConnectionManagerConfig
  private currentStrategy: ConnectionStrategy = 'peerjs'
  private status: ConnectionStatus = 'disconnected'

  // Host instances
  private peerjsHost: SimpleHost | null = null
  private trysteroHost: TrysteroHost | null = null

  // Active host (the one being used)
  private activeHost: SimpleHost | TrysteroHost | null = null

  // Configuration
  private hostConfig: SimpleHostConfig

  // Initial state
  private initialState: GameState

  constructor(initialState: GameState, hostConfig: SimpleHostConfig, managerConfig: ConnectionManagerConfig = {}) {
    this.initialState = initialState
    this.hostConfig = hostConfig
    this.config = {
      preferredStrategy: 'peerjs',
      enableTrysteroFallback: isTrysteroEnabled(),
      connectionTimeout: 15000,
      ...managerConfig
    }
  }

  /**
   * Initialize host with automatic fallback
   */
  async initialize(customPeerId?: string): Promise<{ peerId: string; strategy: ConnectionStrategy }> {
    this.status = 'connecting-peerjs'

    logManagerStrategy('peerjs')

    try {
      // Step 1: Try PeerJS with all servers
      const peerjsResult = await this.tryPeerJS(customPeerId)
      if (peerjsResult) {
        this.activeHost = this.peerjsHost
        this.currentStrategy = 'peerjs'
        this.status = 'connected'
        logManagerConnected('peerjs', peerjsResult)
        return { peerId: peerjsResult, strategy: 'peerjs' }
      }
    } catch (e) {
    }

    // Step 2: Try Trystero if enabled
    if (this.config.enableTrysteroFallback) {
      this.status = 'connecting-trystero'
      logManagerStrategy('trystero')
      try {
        const trysteroResult = await this.tryTrystero()
        if (trysteroResult) {
          this.activeHost = this.trysteroHost
          this.currentStrategy = 'trystero'
          this.status = 'connected'
          logManagerConnected('trystero', trysteroResult)
          return { peerId: trysteroResult, strategy: 'trystero' }
        }
      } catch (e) {
        // Trystero failed
      }
    }

    // All strategies failed
    this.status = 'failed'
    logManagerAllServersFailed()
    throw new Error('Failed to connect via PeerJS and Trystero')
  }

  /**
   * Try PeerJS connection with all servers
   */
  private async tryPeerJS(customPeerId?: string): Promise<string | null> {
    const maxRetries = getServerCount()

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      logManagerPeerJSAttempt(attempt, maxRetries)

      try {
        const options = getPeerJSOptions(customPeerId, attempt)

        this.peerjsHost = new SimpleHost(this.initialState, this.hostConfig)

        const peerId = await this.withTimeout(
          this.peerjsHost.initialize(customPeerId),
          this.config.connectionTimeout!
        )

        return peerId

      } catch (e: any) {
        logManagerPeerJSFailed(attempt, (attempt + 1) % maxRetries)

        // Try next server
        tryNextPeerJSServer()

        // Clean up failed host
        if (this.peerjsHost) {
          try {
            this.peerjsHost.destroy()
          } catch {}
          this.peerjsHost = null
        }
      }
    }

    return null
  }

  /**
   * Try Trystero connection
   */
  private async tryTrystero(): Promise<string | null> {
    try {
      const trysteroConfig: TrysteroHostConfig = {
        ...this.hostConfig,
        appId: this.config.trysteroAppId,
        trackers: this.config.trysteroTrackers
      }

      this.trysteroHost = new TrysteroHost(this.initialState, trysteroConfig)

      const roomId = await this.withTimeout(
        this.trysteroHost.initialize(),
        this.config.connectionTimeout!
      )

      return roomId

    } catch (e: any) {

      if (this.trysteroHost) {
        try {
          this.trysteroHost.destroy()
        } catch {}
        this.trysteroHost = null
      }

      return null
    }
  }

  /**
   * Wrap promise with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      )
    ])
  }

  /**
   * Delegate methods to active host
   */
  hostAction(action: string, data?: any): void {
    if (!this.activeHost) {
      throw new Error('No active host')
    }
    this.activeHost.hostAction(action, data)
  }

  getState(): PersonalizedState {
    if (!this.activeHost) {
      throw new Error('No active host')
    }
    return this.activeHost.getState()
  }

  getPeerId(): string | null {
    if (!this.activeHost) {
      return null
    }
    return this.activeHost.getPeerId()
  }

  getVersion(): number {
    if (!this.activeHost) {
      return 0
    }
    return this.activeHost.getVersion()
  }

  broadcast(message: any): void {
    if (!this.activeHost) {
      return
    }
    this.activeHost.broadcast(message)
  }

  exportSession(): { roomId: string; state: GameState; timestamp: number } | null {
    if (!this.activeHost) {
      return null
    }
    return this.activeHost.exportSession()
  }

  getRawState(): GameState {
    if (!this.activeHost) {
      return this.initialState
    }
    return this.activeHost.getRawState()
  }

  setTargetingMode(targetingMode: any): void {
    if (!this.activeHost) {
      return
    }
    this.activeHost.setTargetingMode(targetingMode)
  }

  clearTargetingMode(): void {
    if (!this.activeHost) {
      return
    }
    this.activeHost.clearTargetingMode()
  }

  /**
   * Get current connection strategy
   */
  getStrategy(): ConnectionStrategy {
    return this.currentStrategy
  }

  /**
   * Get connection status
   */
  getStatus(): ConnectionStatus {
    return this.status
  }

  /**
   * Initialize local game WITHOUT connecting to signalling servers
   * This allows players to set up their game (choose deck, settings) without using server resources
   * Call connectToSignalling() when ready to invite online players
   */
  initializeLocal(): string {
    this.status = 'local-only'

    // Create PeerJS host locally (no signalling connection)
    this.peerjsHost = new SimpleHost(this.initialState, this.hostConfig)
    const gameId = this.peerjsHost.initializeLocal()

    this.activeHost = this.peerjsHost
    this.currentStrategy = 'peerjs'

    logManagerLocalOnly(gameId)

    return gameId
  }

  /**
   * Connect to PeerJS signalling server
   * Call this when ready to accept online players (e.g., when copying invite link)
   * Only works if initializeLocal() was called first
   */
  async connectToSignalling(customPeerId?: string): Promise<{ peerId: string; strategy: ConnectionStrategy }> {
    if (!this.peerjsHost) {
      throw new Error('Must call initializeLocal() first')
    }

    this.status = 'connecting-peerjs'

    logManagerConnectingToSignalling()

    try {
      const peerId = await this.peerjsHost.connectToSignalling(customPeerId)
      this.status = 'connected'
      logManagerConnected('peerjs', peerId)
      return { peerId, strategy: 'peerjs' }
    } catch (e) {
      this.status = 'failed'
      throw e
    }
  }

  /**
   * Check if connected to signalling server
   */
  isConnectedToSignalling(): boolean {
    if (!this.peerjsHost) {
      return false
    }
    return this.peerjsHost.isConnectedToSignalling()
  }

  /**
   * Check if local game is initialized
   */
  isInitialized(): boolean {
    if (!this.peerjsHost) {
      return false
    }
    return this.peerjsHost.isInitialized()
  }

  /**
   * Disconnect from signalling server (keeps P2P connections active)
   */
  disconnectFromSignalling(): void {
    if (this.peerjsHost) {
      this.peerjsHost.disconnectFromSignalling()
    }
  }

  /**
   * Reconnect to signalling server
   */
  reconnectToSignalling(): void {
    if (this.peerjsHost) {
      this.peerjsHost.reconnectToSignalling()
    }
  }

  /**
   * Shutdown
   */
  destroy(): void {
    if (this.peerjsHost) {
      this.peerjsHost.destroy()
      this.peerjsHost = null
    }
    if (this.trysteroHost) {
      this.trysteroHost.destroy()
      this.trysteroHost = null
    }
    this.activeHost = null
    this.status = 'disconnected'
  }
}

/**
 * ConnectionManager for guest
 */
export class GuestConnectionManager {
  private config: ConnectionManagerConfig
  private currentStrategy: ConnectionStrategy = 'peerjs'
  private status: ConnectionStatus = 'disconnected'

  // Guest instances
  private peerjsGuest: SimpleGuest | null = null
  private trysteroGuest: TrysteroGuest | null = null

  // Active guest
  private activeGuest: SimpleGuest | TrysteroGuest | null = null

  // Configuration
  private guestConfig: SimpleGuestConfig

  constructor(guestConfig: SimpleGuestConfig, managerConfig: ConnectionManagerConfig = {}) {
    this.guestConfig = guestConfig
    this.config = {
      preferredStrategy: 'peerjs',
      enableTrysteroFallback: isTrysteroEnabled(),
      connectionTimeout: 15000,
      ...managerConfig
    }
  }

  /**
   * Connect to host with automatic fallback
   */
  async connect(hostId: string, playerName: string, playerToken?: string): Promise<{ strategy: ConnectionStrategy }> {
    this.status = 'connecting-peerjs'

    // Check if hostId looks like a Trystero room ID (shorter, different format)
    const isTrysteroRoom = this.isTrysteroRoomId(hostId)

    if (isTrysteroRoom) {
      // Skip PeerJS, go directly to Trystero
      return this.connectViaTrystero(hostId, playerName, playerToken)
    }

    try {
      // Step 1: Try PeerJS
      await this.connectViaPeerJS(hostId, playerName, playerToken)
      this.currentStrategy = 'peerjs'
      this.status = 'connected'
      return { strategy: 'peerjs' }

    } catch (e) {

      // Step 2: Try Trystero if enabled
      if (this.config.enableTrysteroFallback) {
        this.status = 'connecting-trystero'
        try {
          await this.connectViaTrystero(hostId, playerName, playerToken)
          this.currentStrategy = 'trystero'
          this.status = 'connected'
          return { strategy: 'trystero' }

        } catch (e2) {
          }
      }

      // All strategies failed
      this.status = 'failed'
      throw new Error('Failed to connect via PeerJS and Trystero')
    }
  }

  /**
   * Check if hostId is a Trystero room ID
   */
  private isTrysteroRoomId(hostId: string): boolean {
    // Trystero room IDs are typically shorter (16 chars) and alphanumeric
    // PeerJS IDs are typically longer and contain UUID-like patterns
    return /^[a-zA-Z0-9]{10,20}$/.test(hostId) && !hostId.includes('-')
  }

  /**
   * Connect via PeerJS
   */
  private async connectViaPeerJS(hostId: string, playerName: string, playerToken?: string): Promise<void> {
    this.peerjsGuest = new SimpleGuest(this.guestConfig)

    await this.withTimeout(
      this.peerjsGuest.connect(hostId, playerName, playerToken),
      this.config.connectionTimeout!
    )

    this.activeGuest = this.peerjsGuest
  }

  /**
   * Connect via Trystero
   */
  private async connectViaTrystero(roomId: string, playerName: string, playerToken?: string): Promise<void> {
    const trysteroConfig: TrysteroGuestConfig = {
      ...this.guestConfig,
      appId: this.config.trysteroAppId,
      trackers: this.config.trysteroTrackers
    }

    this.trysteroGuest = new TrysteroGuest(trysteroConfig)

    await this.withTimeout(
      this.trysteroGuest.connect(roomId, playerName, playerToken),
      this.config.connectionTimeout!
    )

    this.activeGuest = this.trysteroGuest
  }

  /**
   * Wrap promise with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), timeout)
      )
    ])
  }

  /**
   * Delegate methods to active guest
   */
  async sendAction(action: string, data?: any): Promise<void> {
    if (!this.activeGuest) {
      throw new Error('Not connected to host')
    }

    if (this.activeGuest instanceof SimpleGuest) {
      return this.activeGuest.sendAction(action, data)
    } else {
      return this.activeGuest.sendAction(action, data)
    }
  }

  getState(): PersonalizedState | null {
    if (!this.activeGuest) {
      return null
    }
    return this.activeGuest.getState()
  }

  getLocalPlayerId(): number {
    if (!this.activeGuest) {
      return this.guestConfig.localPlayerId
    }
    return this.activeGuest.getLocalPlayerId()
  }

  isConnected(): boolean {
    if (!this.activeGuest) {
      return false
    }
    return this.activeGuest.isConnected()
  }

  disconnect(): void {
    if (this.peerjsGuest) {
      this.peerjsGuest.destroy()
      this.peerjsGuest = null
    }
    if (this.trysteroGuest) {
      this.trysteroGuest.destroy()
      this.trysteroGuest = null
    }
    this.activeGuest = null
    this.status = 'disconnected'
  }

  /**
   * Get current connection strategy
   */
  getStrategy(): ConnectionStrategy {
    return this.currentStrategy
  }

  /**
   * Get connection status
   */
  getStatus(): ConnectionStatus {
    return this.status
  }

  /**
   * Send visual effect to host
   */
  async sendVisualEffect(data: any): Promise<void> {
    if (!this.activeGuest) {
      return
    }

    if (this.activeGuest instanceof TrysteroGuest) {
      return this.activeGuest.sendVisualEffect(data)
    }
  }

  /**
   * Shutdown - alias for disconnect()
   */
  destroy(): void {
    this.disconnect()
  }
}

export default { HostConnectionManager, GuestConnectionManager }
