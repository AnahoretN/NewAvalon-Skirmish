/**
 * TrysteroGuest
 *
 * Trystero-based guest implementation.
 * Connects to host room using BitTorrent trackers for signaling.
 */

import { joinRoom, selfId } from '@trystero-p2p/torrent'
import type { PersonalizedState, SimpleGuestConfig, P2PMessage } from './SimpleP2PTypes'

// Public BitTorrent trackers for signaling
const DEFAULT_TRACKERS = [
  'wss://tracker.btorrent.xyz',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.fastcast.nz',
  'wss://tracker.files.fm:443/announce'
]

/**
 * TrysteroGuest configuration
 */
export interface TrysteroGuestConfig extends SimpleGuestConfig {
  appId?: string
  trackers?: string[]
}

/**
 * TrysteroGuest - Trystero-based guest
 */
export class TrysteroGuest {
  private room: any = null
  private config: TrysteroGuestConfig
  private localPlayerId: number
  private hostTrysteroId: string | null = null
  private isHostFound: boolean = false

  // Trystero actions (prefixed to avoid conflict with class methods)
  private _trysteroSendAction: ((data: any, target?: string | string[]) => Promise<void>) | null = null
  private _trysteroSendJoinRequest: ((data: any, target?: string | string[]) => Promise<void>) | null = null
  private _trysteroSendReconnect: ((data: any, target?: string | string[]) => Promise<void>) | null = null
  private _trysteroSendVisual: ((data: any, target?: string | string[]) => Promise<void>) | null = null

  // Current state
  private currentState: PersonalizedState | null = null

  constructor(config: TrysteroGuestConfig) {
    this.config = config
    this.localPlayerId = config.localPlayerId
  }

  /**
   * Connect to host room
   */
  async connect(roomId: string, playerName: string, playerToken?: string): Promise<void> {
    const appId = this.config.appId || 'newavalon-skirmish'

    return new Promise((resolve, reject) => {
      try {
        const trysteroConfig: any = { appId }

        if (this.config.trackers) {
          trysteroConfig.relayUrls = this.config.trackers
        }

        this.room = joinRoom(trysteroConfig, roomId)

        // Set up action send/receive
        const [sendAction, getAction] = this.room.makeAction('ACTION')
        this._trysteroSendAction = sendAction

        getAction((data: P2PMessage, trysteroId: string) => {
          this.handleMessage(data, trysteroId)
        })

        // Set up join request
        const [sendJoinRequest, getJoinRequest] = this.room.makeAction('JOIN_REQUEST')
        this._trysteroSendJoinRequest = sendJoinRequest

        getJoinRequest((data: any) => {
          // Host doesn't send join requests
        })

        // Set up reconnect
        const [sendReconnect, getReconnect] = this.room.makeAction('RECONNECT')
        this._trysteroSendReconnect = sendReconnect

        getReconnect((data: any) => {
          // Host doesn't send reconnect
        })

        // Set up visual effects
        const [sendVisual, getVisual] = this.room.makeAction('VISUAL')
        this._trysteroSendVisual = sendVisual

        getVisual((data: any) => {
          this.handleVisualEffect(data)
        })

        // Listen for peer join (host joining)
        this.room.onPeerJoin((trysteroId: string) => {

          // If we haven't found the host yet, send join request
          if (!this.isHostFound) {
            this.hostTrysteroId = trysteroId
            this.sendJoinRequest?.({
              playerName,
              playerToken: playerToken || this.generatePlayerToken()
            }, trysteroId)
          }
        })

        // Listen for peer leave
        this.room.onPeerLeave((trysteroId: string) => {

          if (trysteroId === this.hostTrysteroId) {
            this.isHostFound = false
            this.hostTrysteroId = null
            this.config.onDisconnected?.()
          }
        })

        // Wait a bit for host to be found, then resolve
        setTimeout(() => {
          if (!this.isHostFound) {
            // Try to find existing peers
            const peers = this.room.getPeers()
            if (peers && Object.keys(peers).length > 0) {
              const hostId = Object.keys(peers)[0]
              this.hostTrysteroId = hostId
              this.isHostFound = true
              this.sendJoinRequest?.({
                playerName,
                playerToken: playerToken || this.generatePlayerToken()
              }, hostId)
            }
          }
          resolve()
        }, 100)

      } catch (e) {
        reject(e)
      }
    })
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: P2PMessage, trysteroId: string): void {
    // Only accept messages from host
    if (this.hostTrysteroId && trysteroId !== this.hostTrysteroId) {
      return
    }

    switch (data.type) {
      case 'STATE':
        this.currentState = data.state
        this.config.onStateUpdate?.(data.state)
        break

      case 'JOIN_ACCEPT':
        this.isHostFound = true
        this.localPlayerId = data.playerId
        this.currentState = data.state
        this.config.onStateUpdate?.(data.state)
        this.config.onConnected?.()
        break

      case 'RECONNECT_REJECTED':
        this.config.onReconnectRejected?.(data.reason)
        break

      case 'HOST_ENDED_GAME':
        this.config.onHostEndedGame?.()
        break

      default:
        // Handle other message types if needed
        break
    }
  }

  /**
   * Handle visual effect
   */
  private handleVisualEffect(data: any): void {
    if (!data) {
      return
    }

    switch (data.type) {
      case 'HIGHLIGHT':
        this.config.onHighlight?.(data.data)
        break

      case 'FLOATING_TEXT':
        this.config.onFloatingText?.(data.data.batch)
        break

      case 'TARGETING_MODE':
        this.config.onTargetingMode?.(data.data.targetingMode)
        break

      case 'CLEAR_TARGETING_MODE':
        this.config.onClearTargetingMode?.()
        break

      case 'NO_TARGET':
        this.config.onNoTarget?.(data.data.coords)
        break

      case 'DECK_SELECTION':
        this.config.onDeckSelection?.(data.data.playerId, data.data.selectedByPlayerId)
        break

      case 'HAND_CARD_SELECTION':
        this.config.onHandCardSelection?.(data.data.playerId, data.data.cardIndex, data.data.selectedByPlayerId)
        break

      case 'CLICK_WAVE':
        this.config.onClickWave?.(data.data)
        break
    }
  }

  /**
   * Send action to host
   */
  async sendAction(action: string, data?: any): Promise<void> {
    if (!this._trysteroSendAction || !this.hostTrysteroId) {
      throw new Error('Not connected to host')
    }

    this._trysteroSendAction({
      type: 'ACTION',
      playerId: this.localPlayerId,
      action: action as any,
      data,
      timestamp: Date.now()
    }, this.hostTrysteroId)
  }

  /**
   * Send join request
   */
  async sendJoinRequest(playerName: string, playerToken?: string): Promise<void> {
    if (!this._trysteroSendJoinRequest || !this.hostTrysteroId) {
      throw new Error('Not connected to host')
    }

    this._trysteroSendJoinRequest({
      playerName,
      playerToken: playerToken || this.generatePlayerToken()
    }, this.hostTrysteroId)
  }

  /**
   * Request reconnect
   */
  async requestReconnect(): Promise<void> {
    if (!this._trysteroSendReconnect || !this.hostTrysteroId) {
      throw new Error('Not connected to host')
    }

    this._trysteroSendReconnect({
      playerId: this.localPlayerId
    }, this.hostTrysteroId)
  }

  /**
   * Send visual effect to host (for broadcasting)
   */
  async sendVisualEffect(data: any): Promise<void> {
    if (!this._trysteroSendVisual || !this.hostTrysteroId) {
      return
    }

    this._trysteroSendVisual(data, this.hostTrysteroId)
  }

  /**
   * Get current state
   */
  getState(): PersonalizedState | null {
    return this.currentState
  }

  /**
   * Get local player ID
   */
  getLocalPlayerId(): number {
    return this.localPlayerId
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.isHostFound && this.hostTrysteroId !== null
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.room) {
      this.room.leave()
      this.room = null
    }
    this.isHostFound = false
    this.hostTrysteroId = null
  }

  /**
   * Shutdown - alias for disconnect()
   */
  destroy(): void {
    this.disconnect()
  }

  /**
   * Generate player token
   */
  private generatePlayerToken(): string {
    return Math.random().toString(36).substring(2, 18) + Date.now().toString(36)
  }
}

export default TrysteroGuest
