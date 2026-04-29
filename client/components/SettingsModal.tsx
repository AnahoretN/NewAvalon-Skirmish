import React, { useState, useEffect } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { AVAILABLE_LANGUAGES, LANGUAGE_NAMES } from '@/locales'
import type { LanguageCode } from '@/locales/types'
import type { ConnectionStatus } from '@/hooks/useGameState'
import { generateInviteLink } from '@/utils/inviteLinks'
import { globalImageLoader } from '@/utils/imageLoader'
import {
  getCustomSignalingServers,
  addCustomSignalingServer,
  removeCustomSignalingServer,
  getAllSignalingServers,
  isTrysteroEnabled,
  type CustomSignalingServer
} from '@/p2p/rtcConfig'

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (url: string) => void;
  connectionStatus: ConnectionStatus;
  onReconnect: () => void;
  gameId?: string | null;
  isGameStarted?: boolean;
  isPrivate?: boolean;
  hostId?: string | null;
  webrtcEnabled?: boolean;
  onWebrtcToggle?: (enabled: boolean) => void;
  onClearImageCache?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSave: _onSave, // Unused - save is handled internally
  connectionStatus,
  onReconnect,
  gameId = null,
  hostId = null,
  isGameStarted = false,
  isPrivate = false,
  webrtcEnabled = false,
  onWebrtcToggle,
  onClearImageCache,
}) => {
  const { language, setLanguage, t } = useLanguage()
  const [serverUrl, setServerUrl] = useState('')
  const [linkCopySuccess, setLinkCopySuccess] = useState(false)
  const [linkCopyError, setLinkCopyError] = useState(false)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [cacheClearing, setCacheClearing] = useState(false)
  const [localWebrtcEnabled, setLocalWebrtcEnabled] = useState(webrtcEnabled)
  const [serverSettingsExpanded, setServerSettingsExpanded] = useState(false)
  const [peerjsServerExpanded, setPeerjsServerExpanded] = useState(false)
  const [customServers, setCustomServers] = useState<CustomSignalingServer[]>([])
  const [allServers, setAllServers] = useState<ReturnType<typeof getAllSignalingServers>>([])
  const [newServerUrl, setNewServerUrl] = useState('')
  const [trysteroEnabled, setTrysteroEnabled] = useState(false)

  const isConnected = connectionStatus === 'Connected'

  // Use allServers to prevent unused variable warning (it's used for tracking server list)
  void allServers

  // Update local state when prop changes
  useEffect(() => {
    setLocalWebrtcEnabled(webrtcEnabled)
  }, [webrtcEnabled])

  // Load WebRTC setting from localStorage on mount
  useEffect(() => {
    if (isOpen) {
      const savedWebrtc = localStorage.getItem('webrtc_enabled')
      setLocalWebrtcEnabled(savedWebrtc === 'true')
      // Load custom servers
      const custom = getCustomSignalingServers()
      setCustomServers(custom)
      setAllServers(getAllSignalingServers())
      // Load Trystero setting
      setTrysteroEnabled(isTrysteroEnabled())
    }
  }, [isOpen])

  // Track when connection is established to update unsaved changes
  useEffect(() => {
    if (isConnected) {
      // Only clear unsaved changes if the current URL matches what we're connected to
      const currentCustomUrl = localStorage.getItem('custom_ws_url') || ''
      if (serverUrl.trim() === currentCustomUrl) {
        setHasUnsavedChanges(false)
      }
    }
  }, [isConnected, connectionStatus, serverUrl])

  useEffect(() => {
    if (isOpen) {
      const savedUrl = localStorage.getItem('custom_ws_url') || ''
      setServerUrl(savedUrl)
      setLinkCopySuccess(false)
      setIsReconnecting(false)
      setHasUnsavedChanges(false)
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const handleSave = () => {
    const trimmedUrl = serverUrl.trim()
    // Save to localStorage and reconnect
    localStorage.setItem('custom_ws_url', trimmedUrl)
    setHasUnsavedChanges(false)
    onReconnect()
    onClose()
  }

  const handleReconnect = () => {
    // Save current input value and reconnect without closing
    const trimmedUrl = serverUrl.trim()
    localStorage.setItem('custom_ws_url', trimmedUrl)
    setHasUnsavedChanges(false)
    setIsReconnecting(true)
    onReconnect()
    setTimeout(() => setIsReconnecting(false), 2000)
  }

  const handleUrlChange = (value: string) => {
    setServerUrl(value)
    // Mark as having unsaved changes when input changes
    setHasUnsavedChanges(true)
  }

  const handleCopyGameLink = () => {
    // Generate invite link based on current mode
    let inviteLink: string

    // Check if WebRTC mode is enabled
    const isWebRTCMode = localStorage.getItem('webrtc_enabled') === 'true'

    if (isWebRTCMode) {
      if (hostId) {
        // WebRTC P2P mode - use host link
        const baseUrl = window.location.origin + window.location.pathname
        inviteLink = `${baseUrl}#hostId=${encodeURIComponent(hostId)}`
      } else {
        // WebRTC mode but host not ready - show error
        setLinkCopyError(true)
        setTimeout(() => setLinkCopyError(false), 3000)
        return
      }
    } else {
      // Standard server mode - use generateInviteLink
      const { url: link } = generateInviteLink(gameId, isGameStarted, isPrivate)
      inviteLink = link
    }

    // Copy to clipboard
    navigator.clipboard.writeText(inviteLink).then(() => {
      setLinkCopySuccess(true)
      setTimeout(() => setLinkCopySuccess(false), 2000)
    }).catch(() => {
      // Ignore clipboard errors
    })
  }

  const handleClearCache = () => {
    setCacheClearing(true)

    // Increment image refresh version FIRST (before reload)
    if (onClearImageCache && typeof onClearImageCache === 'function') {
      onClearImageCache()
    }

    // Clear all localStorage and sessionStorage
    localStorage.clear()
    sessionStorage.clear()

    // Clear image cache from globalImageLoader
    if (globalImageLoader && typeof globalImageLoader.clear === 'function') {
      globalImageLoader.clear()
    }

    // Clear browser image cache by forcing reload with timestamp
    // This will cause all images to be reloaded with new URLs
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name))
      })
    }

    // Show feedback then reload
    setTimeout(() => {
      // Force hard reload to bypass all caches
      window.location.reload()
    }, 1000)
  }

  const handleWebrtcToggle = (enabled: boolean) => {
    setLocalWebrtcEnabled(enabled)
    localStorage.setItem('webrtc_enabled', enabled.toString())
    if (onWebrtcToggle) {
      onWebrtcToggle(enabled)
    }
  }

  const handleClearWebRTCSession = () => {
    // Clear all WebRTC-related data
    localStorage.removeItem('webrtc_host_session')
    localStorage.removeItem('webrtc_host_peer_id')
    localStorage.removeItem('webrtc_guest_peer_id')
    localStorage.removeItem('peerjs_server_index')
    // Force reload to clear any in-memory WebRTC state
    window.location.reload()
  }

  const handleAddCustomServer = () => {
    const trimmedUrl = newServerUrl.trim()
    if (!trimmedUrl) {
      return
    }

    // Add protocol if missing
    let urlToValidate = trimmedUrl
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      urlToValidate = `https://${trimmedUrl}`
    }

    try {
      new URL(urlToValidate) // Validate URL
      addCustomSignalingServer(urlToValidate)
      const updated = getCustomSignalingServers()
      setCustomServers(updated)
      setAllServers(getAllSignalingServers())
      setNewServerUrl('')
    } catch {
      // Invalid URL - silently ignore
    }
  }

  const handleRemoveCustomServer = (id: string) => {
    removeCustomSignalingServer(id)
    const updated = getCustomSignalingServers()
    setCustomServers(updated)
    setAllServers(getAllSignalingServers())
  }

  const handleTrysteroToggle = (enabled: boolean) => {
    setTrysteroEnabled(enabled)
    setTrysteroEnabled(enabled)
  }

  // Check if there's a WebRTC session to clear
  const hasWebRTCSession = !!(
    localStorage.getItem('webrtc_host_session') ||
    localStorage.getItem('webrtc_host_peer_id') ||
    localStorage.getItem('webrtc_guest_peer_id')
  )

  // Button is only enabled when connected, no unsaved changes, AND server URL is not empty
  const canCopyLink = isConnected && !hasUnsavedChanges && serverUrl.trim().length > 0

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-vu-2 p-8 shadow-xl w-full max-w-xl">
        <div className="space-y-9">
          <div>
            <label htmlFor="language-select" className="block text-sm font-medium text-gray-300 mb-1">
              {t('language')}
            </label>
            <select
              id="language-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              className="w-full bg-gray-700 border border-gray-600 text-white font-sans rounded-vu-2 p-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {AVAILABLE_LANGUAGES.map((code) => (
                <option key={code} value={code}>{LANGUAGE_NAMES[code]}</option>
              ))}
            </select>
          </div>

          {/* WebRTC Mode Toggle */}
          <div>
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {t('webrtcMode')}
                </label>
                <p className="text-xs text-gray-400">
                  {t('webrtcModeDesc')}
                </p>
              </div>
              <button
                onClick={() => handleWebrtcToggle(!localWebrtcEnabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  localWebrtcEnabled ? 'bg-indigo-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    localWebrtcEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Signaling Server Settings - only shown when WebRTC is enabled */}
          {localWebrtcEnabled && (
            <div className="bg-gray-750 rounded-vu-2">
              <button
                onClick={() => setPeerjsServerExpanded(!peerjsServerExpanded)}
                className="w-full flex items-center justify-between p-3 text-left cursor-pointer hover:bg-gray-700"
              >
                <span className="text-sm font-medium text-gray-300">{t('signalingServerSettings')}</span>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${
                    peerjsServerExpanded ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {peerjsServerExpanded && (
                <div className="p-3 pt-0 space-y-4">
                  {/* Trystero Torrent Trackers Toggle */}
                  <div className="flex items-center justify-between pb-2 border-b border-gray-700">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        {t('trysteroTrackers')}
                      </label>
                      <p className="text-xs text-gray-400">
                        {t('trysteroTrackersDesc')}
                      </p>
                    </div>
                    <button
                      onClick={() => handleTrysteroToggle(!trysteroEnabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        trysteroEnabled ? 'bg-indigo-600' : 'bg-gray-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          trysteroEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Custom Servers */}
                  <div>
                    <p className="text-xs text-gray-400 mb-2">{t('customServers')}</p>
                    <div className="space-y-1 mb-2">
                      {customServers.length === 0 ? (
                        <p className="text-xs text-gray-500 italic">{t('noCustomServers')}</p>
                      ) : (
                        customServers.map((server) => (
                          <div key={server.id} className="flex items-center justify-between text-sm bg-gray-700 rounded p-2">
                            <span className="text-gray-300 truncate flex-1 mr-2" title={server.url}>
                              {server.name || server.url}
                            </span>
                            <button
                              onClick={() => handleRemoveCustomServer(server.id)}
                              className="text-red-400 hover:text-red-300 transition-colors p-1"
                              title={t('remove')}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    {/* Add Server Input */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newServerUrl}
                        onChange={(e) => setNewServerUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCustomServer()}
                        placeholder={t('addServerPlaceholder')}
                        className="flex-1 bg-gray-700 border border-gray-600 text-white font-mono text-sm rounded p-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                      <button
                        onClick={handleAddCustomServer}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded px-3 transition-colors"
                      >
                        {t('addServer')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Collapsible Server Settings Container */}
          <div
            className={`rounded-vu-2 transition-all ${
              localWebrtcEnabled
                ? 'bg-gray-800 opacity-50 cursor-not-allowed'
                : 'bg-gray-750'
            }`}
          >
            <button
              onClick={() => !localWebrtcEnabled && setServerSettingsExpanded(!serverSettingsExpanded)}
              disabled={localWebrtcEnabled}
              className={`w-full flex items-center justify-between p-3 text-left ${
                localWebrtcEnabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gray-700'
              }`}
            >
              <span className="text-sm font-medium text-gray-300">{t('serverSettings')}</span>
              <svg
                className={`w-5 h-5 text-gray-400 transition-transform ${
                  serverSettingsExpanded ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {serverSettingsExpanded && (
              <div className="p-3 pt-0 space-y-6">
                {/* Server URL input with reconnect button and connection status */}
                <div>
                  <label htmlFor="server-url" className="block text-sm font-medium text-gray-300 mb-1">
                    {t('serverAddress')}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="server-url"
                      type="text"
                      value={serverUrl}
                      onChange={(e) => handleUrlChange(e.target.value)}
                      placeholder="wss://your-server.ngrok-free.app"
                      className="flex-1 bg-gray-700 border border-gray-600 text-white font-mono rounded-vu-2 p-2 focus:ring-indigo-500 focus:border-indigo-500"
                      onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    />
                    {/* Reconnect button */}
                    <button
                      onClick={handleReconnect}
                      className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
                        isReconnecting
                          ? 'bg-green-600 text-white animate-pulse'
                          : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                      }`}
                      title={t('reconnect')}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                      </svg>
                    </button>
                    {/* Connection status indicator */}
                    <div
                      className={`w-10 h-10 flex items-center justify-center rounded bg-gray-900 border border-gray-700 ${
                        connectionStatus === 'Connected' ? 'cursor-help' : ''
                      }`}
                      title={connectionStatus}
                    >
                      <span className="relative flex h-3 w-3">
                        {connectionStatus === 'Connected' && (
                          <>
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                          </>
                        )}
                        {connectionStatus === 'Connecting' && (
                          <>
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                          </>
                        )}
                        {connectionStatus === 'Disconnected' && (
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                        )}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Game server WebSocket URL (ws:// or wss://)
                  </p>
                </div>

                {/* Copy Game Link Button - only active when connected AND no unsaved changes */}
                <div className="-mt-2">
                  <button
                    onClick={handleCopyGameLink}
                    disabled={!canCopyLink}
                    className={`w-full py-3 rounded text-sm font-bold transition-colors ${
                      !canCopyLink
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : linkCopyError
                          ? 'bg-red-600 text-white'
                          : linkCopySuccess
                            ? 'bg-green-600 text-white'
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    }`}
                  >
                    {linkCopyError ? 'Host not ready' : (linkCopySuccess ? t('copied') : t('copyGameLink'))}
                  </button>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('copyGameLinkDesc')}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Clear Cache Button */}
          <div className="-mt-3">
            <button
              onClick={handleClearCache}
              disabled={cacheClearing}
              className={`w-full py-3 rounded text-sm font-bold transition-colors ${
                cacheClearing
                  ? 'bg-orange-600 text-white'
                  : 'bg-red-700 hover:bg-red-600 text-white'
              }`}
            >
              {cacheClearing ? t('cacheCleared') : t('clearCache')}
            </button>
            <p className="text-xs text-gray-400 mt-1">
              {t('clearCacheDesc')}
            </p>
          </div>

          {/* Clear WebRTC Session Button - only show if there's a WebRTC session */}
          {hasWebRTCSession && (
            <div className="-mt-3">
              <button
                onClick={handleClearWebRTCSession}
                className="w-full py-3 rounded text-sm font-bold transition-colors bg-yellow-700 hover:bg-yellow-600 text-white"
              >
                Clear WebRTC Session
              </button>
              <p className="text-xs text-gray-400 mt-1">
                Clear saved WebRTC session data (fixes connection issues)
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end mt-8 space-x-3">
          <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-4 rounded">
            {t('cancel')}
          </button>
          <button
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded transition-colors"
          >
            {t('saveApply')}
          </button>
        </div>
      </div>
    </div>
  )
}
