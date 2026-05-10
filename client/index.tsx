
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { LanguageProvider } from './contexts/LanguageContext'

// Parse URL parameters for invite links
// Support both query parameters (?game=...) and hash parameters (#game=...)
const urlParams = new URLSearchParams(window.location.search)
const hashParams = new URLSearchParams(window.location.hash.slice(1))

const inviteGameId = urlParams.get('game') || hashParams.get('game')
const inviteServerUrl = urlParams.get('server') || hashParams.get('server')
const encodedServerUrl = urlParams.get('s') || hashParams.get('s')
const inviteHostId = urlParams.get('hostId') || hashParams.get('hostId')
// const autoJoin = urlParams.get('autojoin') || hashParams.get('autojoin') // Reserved for future auto-join functionality


// Store invite data in sessionStorage for App to use
if (inviteGameId) {
  // Only store gameId if NOT in WebRTC mode
  // WebRTC mode uses hostId parameter instead
  const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'
  if (!isWebRTCMode) {
    sessionStorage.setItem('invite_game_id', inviteGameId)
    sessionStorage.setItem('invite_auto_join', 'true')
  } else {
  }
  // If WebRTC mode is enabled, ignore gameId parameter
  // The host should share #hostId=... link instead
}

// Handle WebRTC hostId invite link
if (inviteHostId) {
  sessionStorage.setItem('invite_host_id', inviteHostId)
  sessionStorage.setItem('invite_auto_join', 'true')
  // Enable WebRTC mode if not already enabled
  localStorage.setItem('webrtc_enabled', 'true')

  // CRITICAL: Clear any saved host session to prevent guest from becoming host
  // When joining via invite link, the user should be a guest, not restore a previous host session
  localStorage.removeItem('webrtc_host_session')
  localStorage.removeItem('webrtc_host_peer_id')
  localStorage.removeItem('player_token')

}

if (inviteServerUrl) {
  // Auto-configure server URL from invite link (legacy parameter)
  localStorage.setItem('websocket_url', inviteServerUrl)
}
// Handle new encoded server URL parameter
if (encodedServerUrl) {
  try {
    // Decode base64 and then URI decode
    const decodedServerUrl = decodeURIComponent(atob(encodedServerUrl))
    // Validate it's a safe WebSocket URL
    if (decodedServerUrl && (decodedServerUrl.startsWith('ws://') || decodedServerUrl.startsWith('wss://'))) {
      localStorage.setItem('websocket_url', decodedServerUrl)
      // Also save to custom_ws_url so getWebSocketURL() can use it for connection
      localStorage.setItem('custom_ws_url', decodedServerUrl)
    }
  } catch (e) {
  }
}

// Clear URL parameters for security (so they don't persist in browser history)
if (inviteGameId || inviteServerUrl || encodedServerUrl || inviteHostId) {
  window.history.replaceState({}, '', window.location.pathname)
}

// Set default WebRTC mode to enabled if not set
if (localStorage.getItem('webrtc_enabled') === null) {
  localStorage.setItem('webrtc_enabled', 'true')
}

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  constructor(props: {children: React.ReactNode}) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(_error: any) {
    return { hasError: true }
  }

  componentDidCatch(error: any, errorInfo: any) {
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white p-4 text-center">
          <h1 className="text-3xl font-bold mb-4">Something went wrong</h1>
          <p className="mb-6 text-gray-400">The application encountered an unexpected error.</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-indigo-600 px-6 py-3 rounded-vu-2 hover:bg-indigo-700 transition font-bold shadow-lg"
          >
            Reload Game
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Could not find root element to mount to')
}

const root = ReactDOM.createRoot(rootElement)
root.render(
  <ErrorBoundary>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </ErrorBoundary>,
)
