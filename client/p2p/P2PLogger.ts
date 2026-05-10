/**
 * P2P Logger
 *
 * Structured logging for WebRTC P2P connections.
 * Logs only major events to keep console clean.
 */

type LogLevel = 'info' | 'success' | 'warn' | 'error'

const PREFIX = '[P2P]'
const EMOJI: Record<LogLevel, string> = {
  info: '',
  success: '',
  warn: '',
  error: ''
}

/**
 * Get STUN/TURN servers summary for logging
 */
function formatIceServers(servers: Array<{ urls: string[] }>): string {
  const count = servers.length
  return `${count} STUN servers`
}

/**
 * Get PeerJS server info for logging
 */
function formatPeerJSServer(options: any): string {
  if (options.host) {
    return `${options.secure ? 'wss://' : 'ws://'}${options.host}:${options.port}${options.path || '/peerjs'}`
  }
  return '0.peerjs.com (default)'
}

/**
 * Log with timestamp and emoji
 */
function log(level: LogLevel, message: string, data?: any): void {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const prefix = `${EMOJI[level]} ${PREFIX} [${timestamp}]`

  switch (level) {
    case 'success':
      console.log(`%c${prefix} ${message}`, 'color: #22c55e; font-weight: 500')
      break
    case 'info':
      console.log(`%c${prefix} ${message}`, 'color: #3b82f6')
      break
    case 'warn':
      console.warn(`${prefix} ${message}`)
      break
    case 'error':
      console.error(`${prefix} ${message}`, data || '')
      break
  }

  if (data && level !== 'error') {
    console.log('  ', data)
  }
}

// ============================================================
// HOST LOGS
// ============================================================

export function logHostInitializing(peerId?: string): void {
  log('info', `Creating host${peerId ? ` (peerId: ${peerId.slice(0, 8)}...)` : ''}`)
}

export function logHostSignallingConnected(peerId: string, options: any): void {
  log('success', `Connected to signalling server: ${formatPeerJSServer(options)}`, { peerId })
}

export function logHostSignallingDisconnected(): void {
  log('info', 'Disconnected from signalling server (P2P connections active)')
}

export function logHostPlayerJoined(playerId: number, playerName: string, peerId: string): void {
  log('success', `Player joined: ${playerName} (ID: ${playerId})`, { peerId: peerId.slice(0, 12) + '...' })
}

export function logHostPlayerDisconnected(playerId: number, playerName: string): void {
  log('warn', `Player disconnected: ${playerName} (ID: ${playerId}). Awaiting reconnection (30s)`)
}

export function logHostPlayerReconnected(playerId: number, playerName: string): void {
  log('success', `Player reconnected: ${playerName} (ID: ${playerId})`)
}

export function logHostPlayerConvertedToDummy(playerId: number, playerName: string): void {
  log('warn', `Player converted to dummy: ${playerName} (ID: ${playerId})`)
}

export function logHostIceServers(servers: Array<{ urls: string[] }>): void {
  log('info', `ICE configuration: ${formatIceServers(servers)}`)
}

export function logHostError(message: string, error?: any): void {
  log('error', message, error)
}

// ============================================================
// GUEST LOGS
// ============================================================

export function logGuestConnecting(hostPeerId: string): void {
  log('info', `Connecting to host...`, { hostPeerId: hostPeerId.slice(0, 12) + '...' })
}

export function logGuestConnected(hostPeerId: string, playerId: number, playerName: string): void {
  log('success', `Connected to host. Your ID: ${playerId}`, { hostPeerId: hostPeerId.slice(0, 12) + '...', playerName })
}

export function logGuestDisconnected(): void {
  log('warn', 'Disconnected from host')
}

export function logGuestReconnecting(hostPeerId: string): void {
  log('info', 'Reconnecting to host...', { hostPeerId: hostPeerId.slice(0, 12) + '...' })
}

export function logGuestReconnected(): void {
  log('success', 'Successfully reconnected to host')
}

export function logGuestSignallingDisconnected(): void {
  log('info', 'Disconnected from signalling server (P2P connection active)')
}

export function logGuestError(message: string, error?: any): void {
  log('error', message, error)
}

// ============================================================
// CONNECTION MANAGER LOGS
// ============================================================

export function logManagerStrategy(strategy: 'peerjs' | 'trystero'): void {
  const name = strategy === 'peerjs' ? 'PeerJS' : 'Trystero'
  log('info', `Connection strategy: ${name}`)
}

export function logManagerPeerJSAttempt(serverIndex: number, totalServers: number): void {
  log('info', `Attempting PeerJS server ${serverIndex + 1}/${totalServers}`)
}

export function logManagerPeerJSFailed(serverIndex: number, nextServer: number): void {
  log('warn', `PeerJS server ${serverIndex + 1} unavailable. Trying server ${nextServer + 1}`)
}

export function logManagerAllServersFailed(): void {
  log('error', 'All PeerJS servers unavailable')
}

export function logManagerConnected(strategy: 'peerjs' | 'trystero', id: string): void {
  log('success', `Connected (${strategy === 'peerjs' ? 'PeerJS' : 'Trystero'})`, { id: id.slice(0, 12) + '...' })
}

export function logManagerLocalOnly(gameId: string): void {
  log('info', `Local game created (ID: ${gameId})`)
}

export function logManagerConnectingToSignalling(): void {
  log('info', 'Connecting to signalling server...')
}

// ============================================================
// PEERJS LOADER LOGS
// ============================================================

export function logPeerJSLoading(): void {
  log('info', 'Loading PeerJS...')
}

export function logPeerJSLoaded(): void {
  log('success', 'PeerJS loaded')
}
