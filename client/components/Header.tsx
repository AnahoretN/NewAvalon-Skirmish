
import React, { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { GameMode } from '@/types'
import type { GridSize } from '@/types'
import type { ConnectionStatus } from '@/hooks/useGameState'
import type { Player } from '@/types'
import { TURN_PHASES, MAX_PLAYERS, PLAYER_COLORS } from '@/constants'
import { useLanguage } from '@/contexts/LanguageContext'
import type { TranslationResource } from '@/locales/types'
import { generateInviteLink } from '@/utils/inviteLinks'
import { getWebRTCEnabled } from '@/hooks/useWebRTCEnabled'

// Вычисляем VU размер для шрифтов динамически
const getVuSize = (vu: number) => {
  const vuPixels = window.innerHeight / 1000
  return vu * vuPixels
}

interface HeaderProps {
  gameId: string | null;
  isGameStarted: boolean;
  onResetGame?: () => void;
  onPlayerReady?: () => void;
  players?: Player[];
  localPlayerId?: number | null;
  activeGridSize: GridSize;
  onGridSizeChange: (size: GridSize) => void;
  dummyPlayerCount: number;
  onDummyPlayerCountChange: (count: number) => void;
  realPlayerCount: number;
  connectionStatus: ConnectionStatus;
  onExitGame: () => void;
  onOpenTokensModal: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpenCountersModal: (event: React.MouseEvent<HTMLButtonElement>) => void;
  gameMode: GameMode;
  onGameModeChange: (mode: GameMode) => void;
  isPrivate: boolean;
  onPrivacyChange: (isPrivate: boolean) => void;
  isHost: boolean;
  hostId?: string | null;
  onSyncGame: () => void;
  currentPhase: number;
  onSetPhase: (index: number) => void;
  onNextPhase: () => void;
  onPrevPhase: () => void;
  activePlayerId: number | null;
  playerColorMap: Map<number, string>;
  isAutoAbilitiesEnabled: boolean;
  onToggleAutoAbilities: (enabled: boolean) => void;
  isAutoDrawEnabled: boolean;
  onToggleAutoDraw: (enabled: boolean) => void;
  hideDummyCards: boolean;
  onToggleHideDummyCards: (enabled: boolean) => void;
  currentRound?: number;
  turnNumber?: number;
  isScoringStep?: boolean;
  hasLastPlayedCard?: boolean;
  // Reconnection props
  isReconnecting?: boolean;
  reconnectProgress?: { attempt: number; maxAttempts: number; timeRemaining: number } | null;
  // NEW: Signalling control props
  connectToSignalling?: () => Promise<string>;
  isConnectedToSignalling?: () => boolean;
  // Game Log props
  onOpenGameLog?: () => void;
}

const StatusIndicator = memo<{
  connectionStatus: ConnectionStatus
  isReconnecting?: boolean
  reconnectProgress?: { attempt: number; maxAttempts: number; timeRemaining: number } | null
}>(({ connectionStatus, isReconnecting, reconnectProgress }) => {
  // Check if WebRTC P2P mode is enabled
  const isWebRTCMode = getWebRTCEnabled()

  return (
    <div className="flex items-center" style={{ gap: `${getVuSize(5)}px` }}>
      <span className="relative flex w-vu-status h-vu-status" title={isWebRTCMode ? 'WebRTC P2P' : connectionStatus}>
        {/* WebRTC P2P mode - blue indicator */}
        {isWebRTCMode && (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full w-vu-status h-vu-status bg-blue-500"></span>
          </>
        )}
        {/* Standard server mode - green/yellow/red based on status */}
        {!isWebRTCMode && connectionStatus === 'Connected' && !isReconnecting && (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full w-vu-status h-vu-status bg-green-500"></span>
          </>
        )}
        {!isWebRTCMode && (connectionStatus === 'Connecting' || isReconnecting) && (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full w-vu-status h-vu-status bg-yellow-500"></span>
          </>
        )}
        {!isWebRTCMode && connectionStatus === 'Disconnected' && !isReconnecting && (
          <span className="relative inline-flex rounded-full w-vu-status h-vu-status bg-red-500"></span>
        )}
      </span>
      {isReconnecting && reconnectProgress && (
        <span className="text-yellow-400 animate-pulse" style={{ fontSize: `${getVuSize(13)}px` }}>
          Reconnecting ({Math.round(reconnectProgress.timeRemaining / 1000)}s)
        </span>
      )}
    </div>
  )
})

StatusIndicator.displayName = 'StatusIndicator'

const RoundTracker = memo<{
  currentRound: number;
  turnNumber: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  showTooltip: boolean;
  isGameStarted: boolean;
  t: (key: keyof TranslationResource['ui']) => string;
  }>(({ currentRound, turnNumber, onMouseEnter, onMouseLeave, showTooltip, isGameStarted, t }) => {
    const threshold = useMemo(() => (currentRound * 10) + 10, [currentRound])

    // Force re-render on window resize to update VU-based text sizes
    const [, forceUpdate] = useState({})
    useEffect(() => {
      const handleResize = () => {
        forceUpdate({})
      }
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }, [])

    return (
      <div className="relative">
        <div
          className={`flex items-center bg-gray-800 rounded-vu-2 px-vu-md py-vu-md ${isGameStarted ? 'cursor-help' : 'opacity-50'}`}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <span className="text-yellow-500 font-bold" style={{ fontSize: `${getVuSize(13)}px` }}>{t('round').toUpperCase()} {currentRound}</span>
          <span className="text-gray-500 mx-vu-3" style={{ fontSize: `${getVuSize(13)}px` }}>|</span>
          <span className="text-gray-300 font-bold" style={{ fontSize: `${getVuSize(13)}px` }}> {t('turn').toUpperCase()} {turnNumber}</span>
        </div>

        {showTooltip && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-vu-min z-[100] bg-gray-900 text-white p-vu-md rounded-vu-2 shadow-xl whitespace-nowrap min-w-max">
            <div className="text-center">
              <p className="font-bold text-yellow-400 mb-vu-min whitespace-nowrap" style={{ fontSize: `${getVuSize(13)}px` }}>{t('round')} {currentRound} {t('roundVictoryCondition')}</p>
              <p className="whitespace-nowrap" style={{ fontSize: `${getVuSize(13)}px` }}>{t('reach')} <span className="font-bold text-white">{threshold} {t('scorePoints')}</span> {t('toWinRound')}</p>
              <p className="text-gray-400 mt-vu-min" style={{ fontSize: `${getVuSize(13)}px` }}>{t('checkedAtFirstPlayer')}</p>
            </div>
          </div>
        )}
      </div>
    )
  })

RoundTracker.displayName = 'RoundTracker'

// Game Settings Dropdown Menu
const GameSettingsMenu = memo<{
  isOpen: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  isAutoAbilitiesEnabled: boolean;
  onToggleAutoAbilities: (enabled: boolean) => void;
  isAutoDrawEnabled: boolean;
  onToggleAutoDraw: (enabled: boolean) => void;
  dummyPlayerCount: number;
  onDummyPlayerCountChange: (count: number) => void;
  realPlayerCount: number;
  activeGridSize: GridSize;
  onGridSizeChange: (size: GridSize) => void;
  gameMode: GameMode;
  onGameModeChange: (mode: GameMode) => void;
  isGameStarted: boolean;
  isHost: boolean;
  hideDummyCards: boolean;
  onToggleHideDummyCards: (enabled: boolean) => void;
  t: (key: keyof TranslationResource['ui']) => string;
}>(({
  isOpen,
  onClose,
  anchorEl,
  isAutoAbilitiesEnabled,
  onToggleAutoAbilities,
  isAutoDrawEnabled,
  onToggleAutoDraw,
  dummyPlayerCount,
  onDummyPlayerCountChange,
  realPlayerCount,
  activeGridSize,
  onGridSizeChange,
  gameMode,
  onGameModeChange,
  isGameStarted,
  isHost,
  hideDummyCards,
  onToggleHideDummyCards,
  t,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const dummyOptions = useMemo(() => [0, 1, 2, 3], [])

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) {return}

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) && !anchorEl?.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose, anchorEl])

  if (!isOpen || !anchorEl) {return null}

  const rect = anchorEl.getBoundingClientRect()

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-gray-800 rounded-vu-2 shadow-xl border border-gray-700 p-vu-md min-w-vu-settings"
      style={{ top: `calc(${rect.bottom}px + var(--vu-gap-min))`, left: `${rect.left}px` }}
    >
      {/* Auto-Abilities */}
      <div className="flex items-center justify-between" style={{ marginBottom: `${getVuSize(8)}px` }}>
        <span className="text-gray-300" style={{ fontSize: `${getVuSize(13)}px` }}>{t('autoAbilities')}</span>
        <button
          onClick={() => onToggleAutoAbilities(!isAutoAbilitiesEnabled)}
          disabled={!isHost}
          className={`px-vu-md rounded font-bold transition-colors ${
            isAutoAbilitiesEnabled
              ? 'bg-green-600 text-white'
              : 'bg-gray-600 text-gray-400'
          } ${!isHost ? 'opacity-50 cursor-not-allowed' : ''}`}
          style={{ fontSize: `${getVuSize(13)}px`, height: `${getVuSize(29)}px` }}
        >
          {isAutoAbilitiesEnabled ? t('on') : t('off')}
        </button>
      </div>

      {/* Auto-Draw */}
      <div className="flex items-center justify-between" style={{ marginBottom: `${getVuSize(8)}px` }}>
        <span className="text-gray-300" style={{ fontSize: `${getVuSize(13)}px` }}>{t('autoDraw')}</span>
        <button
          onClick={() => onToggleAutoDraw(!isAutoDrawEnabled)}
          className={`px-vu-md rounded font-bold transition-colors ${
            isAutoDrawEnabled
              ? 'bg-green-600 text-white'
              : 'bg-gray-600 text-gray-400'
          }`}
          style={{ fontSize: `${getVuSize(13)}px`, height: `${getVuSize(29)}px` }}
        >
          {isAutoDrawEnabled ? t('on') : t('off')}
        </button>
      </div>

      {/* Dummy Players */}
      <div className="flex items-center justify-between" style={{ marginBottom: `${getVuSize(8)}px` }}>
        <span className="text-gray-300" style={{ fontSize: `${getVuSize(13)}px` }}>{t('dummyPlayers')}</span>
        <div className="flex items-center" style={{ gap: `${getVuSize(3)}px` }}>
          {dummyOptions.map(option => (
            <button
              key={option}
              onClick={() => onDummyPlayerCountChange(option)}
              disabled={!isHost || isGameStarted || (realPlayerCount + option > MAX_PLAYERS)}
              className={`px-vu-md rounded font-bold transition-colors ${
                dummyPlayerCount === option
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              } ${!isHost || isGameStarted || (realPlayerCount + option > MAX_PLAYERS) ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ fontSize: `${getVuSize(13)}px`, height: `${getVuSize(29)}px` }}
            >
              {option}
            </button>
          ))}
          {/* Hide Dummy Cards toggle button */}
          <button
            onClick={() => onToggleHideDummyCards(!hideDummyCards)}
            className={`px-vu-md rounded font-bold transition-colors ${
              hideDummyCards
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
            title={t('hideDummyCardsTooltip')}
            style={{ fontSize: `${getVuSize(13)}px`, height: `${getVuSize(29)}px` }}
          >
            🙈
          </button>
        </div>
      </div>

      {/* Grid Size */}
      <div className="flex items-center justify-between" style={{ marginBottom: `${getVuSize(8)}px` }}>
        <span className="text-gray-300" style={{ fontSize: `${getVuSize(13)}px` }}>{t('gridSize')}</span>
        <div className="flex" style={{ gap: `${getVuSize(3)}px` }}>
          {[4, 5, 6, 7].map(size => (
            <button
              key={size}
              onClick={() => onGridSizeChange(size as GridSize)}
              disabled={!isHost || isGameStarted}
              className={`rounded font-bold transition-colors ${
                activeGridSize === size
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              } ${!isHost || isGameStarted ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ fontSize: `${getVuSize(13)}px`, height: `${getVuSize(29)}px`, paddingLeft: `${getVuSize(9)}px`, paddingRight: `${getVuSize(9)}px` }}
            >
              {size}x{size}
            </button>
          ))}
        </div>
      </div>

      {/* Game Mode */}
      <div className="flex items-center justify-between">
        <span className="text-gray-300" style={{ fontSize: `${getVuSize(13)}px` }}>{t('gameMode')}</span>
        <select
          value={gameMode}
          onChange={(e) => onGameModeChange(e.target.value as GameMode)}
          disabled={!isHost || isGameStarted}
          className="bg-gray-700 border border-gray-600 text-white rounded px-vu-min disabled:opacity-50"
          style={{ fontSize: `${getVuSize(13)}px`, height: `${getVuSize(29)}px` }}
        >
          <option value={GameMode.FreeForAll}>{t('ffa')}</option>
          <option value={GameMode.TwoVTwo}>{t('2v2')}</option>
          <option value={GameMode.ThreeVOne}>{t('3v1')}</option>
        </select>
      </div>
    </div>
  )
})

GameSettingsMenu.displayName = 'GameSettingsMenu'

// Invite Player Menu
interface InvitePlayerMenuProps {
  isOpen: boolean;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  gameId: string | null;
  isPrivate: boolean;
  onPrivacyChange: (isPrivate: boolean) => void;
  isHost: boolean;
  isGameStarted: boolean;
  hostId?: string | null;
  t: (key: keyof TranslationResource['ui'] | string) => string;
  connectToSignalling?: () => Promise<string>;
  isConnectedToSignalling?: () => boolean;
}

function InvitePlayerMenu({
  isOpen,
  onClose,
  anchorEl,
  gameId,
  isPrivate,
  onPrivacyChange,
  isHost,
  isGameStarted,
  hostId,
  t,
  connectToSignalling,
  isConnectedToSignalling,
}: InvitePlayerMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [gameIdCopySuccess, setGameIdCopySuccess] = useState(false)
  const [linkCopySuccess, setLinkCopySuccess] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) {return}

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) && !anchorEl?.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose, anchorEl])

  // Reset copy success states when menu closes
  useEffect(() => {
    if (!isOpen) {
      setGameIdCopySuccess(false)
      setLinkCopySuccess(false)
      setLinkError(null)
    }
  }, [isOpen])

  const handleCopyGameId = useCallback(() => {
    if (!gameId) {return}

    navigator.clipboard.writeText(gameId).then(() => {
      setGameIdCopySuccess(true)
      setTimeout(() => setGameIdCopySuccess(false), 1500)
    }).catch(() => {
    })
  }, [gameId])

  const handleCopyLink = useCallback(async () => {
    if (!gameId) {return}

    // Check if WebRTC mode is enabled
    const isWebRTCMode = getWebRTCEnabled()

    // For WebRTC mode, check if connected to signalling server
    // If not, connect first (this happens when player created local game)
    let actualHostId = hostId
    if (isWebRTCMode) {
      // Check if we need to connect to signalling
      // Safe check: only call isConnectedToSignalling if it's a function
      const needsConnection = !actualHostId && connectToSignalling && isConnectedToSignalling && typeof isConnectedToSignalling === 'function' && !isConnectedToSignalling()

      if (needsConnection) {
        setIsConnecting(true)
        setLinkError(null)
        try {
          actualHostId = await connectToSignalling()
          setIsConnecting(false)
        } catch (e) {
          setIsConnecting(false)
          setLinkCopySuccess(false)
          setLinkError('Failed to connect to PeerJS server. Please try again.')
          setTimeout(() => setLinkError(null), 3000)
          return
        }
      }

      // If still no hostId, show error
      if (!actualHostId) {
        setLinkCopySuccess(false)
        setLinkError('Host not ready')
        setTimeout(() => setLinkError(null), 3000)
        return
      }

      // WebRTC P2P mode - use host link
      const baseUrl = window.location.origin + window.location.pathname
      const inviteLink = `${baseUrl}#hostId=${encodeURIComponent(actualHostId)}`

      // Copy to clipboard
      navigator.clipboard.writeText(inviteLink).then(() => {
        setLinkCopySuccess(true)
        setTimeout(() => setLinkCopySuccess(false), 2000)
      }).catch(() => {
      })
    } else {
      // Standard server mode - use generateInviteLink
      const { url: link } = generateInviteLink(gameId, isGameStarted, isPrivate)

      // Copy to clipboard
      navigator.clipboard.writeText(link).then(() => {
        setLinkCopySuccess(true)
        setTimeout(() => setLinkCopySuccess(false), 2000)
      }).catch(() => {
      })
    }
  }, [gameId, isGameStarted, isPrivate, hostId, connectToSignalling, isConnectedToSignalling])

  if (!isOpen || !anchorEl) {return null}

  const rect = anchorEl.getBoundingClientRect()

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-gray-800 rounded-vu-2 shadow-xl border border-gray-700 p-vu-md min-w-vu-invite"
      style={{ top: `calc(${rect.bottom}px + var(--vu-gap-min))`, left: `max(var(--vu-gap-min), ${rect.right}px - var(--vu-invite))` }}
    >
      {/* Game ID */}
      <div style={{ marginBottom: `${getVuSize(8)}px` }}>
        <div className="bg-gray-900 rounded px-vu-md py-vu-md flex items-center justify-between" style={{ gap: `${getVuSize(2)}px` }}>
          <span className="font-mono text-indigo-300 truncate flex-1" style={{ fontSize: `${getVuSize(13)}px` }}>{gameId || '-'}</span>
          <button
            onClick={handleCopyGameId}
            disabled={!gameId}
            className={`px-vu-md flex items-center justify-center rounded transition-colors ${
              gameIdCopySuccess
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            } ${!gameId ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={t('copy')}
            style={{ height: `${getVuSize(29)}px` }}
          >
            {gameIdCopySuccess ? (
              <svg style={{ width: `${getVuSize(14)}px`, height: `${getVuSize(14)}px` }} viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
            ) : (
              <svg style={{ width: `${getVuSize(14)}px`, height: `${getVuSize(14)}px` }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Privacy Toggle */}
      <div className="flex items-center justify-between" style={{ marginBottom: `${getVuSize(8)}px` }}>
        <span className="text-gray-300" style={{ fontSize: `${getVuSize(13)}px` }}>{t('hiddenGame')}</span>
        <div className={`flex rounded overflow-hidden ${!isHost || isGameStarted ? 'opacity-50' : ''}`} style={{ gap: `${getVuSize(3)}px` }}>
          <button
            onClick={() => !isPrivate && onPrivacyChange(true)}
            disabled={!isHost || isGameStarted}
            className={`px-vu-md flex items-center justify-center transition-colors rounded font-bold ${
              isPrivate ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            } ${!isHost || isGameStarted ? 'cursor-not-allowed' : ''}`}
            title={t('private')}
            style={{ fontSize: `${getVuSize(13)}px`, height: `${getVuSize(29)}px`, width: `${getVuSize(50)}px` }}
          >
            <svg style={{ width: `${getVuSize(14)}px`, height: `${getVuSize(14)}px` }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M1 1l22 22"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            </svg>
          </button>
          <button
            onClick={() => isPrivate && onPrivacyChange(false)}
            disabled={!isHost || isGameStarted}
            className={`px-vu-md flex items-center justify-center transition-colors rounded font-bold ${
              !isPrivate ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            } ${!isHost || isGameStarted ? 'cursor-not-allowed' : ''}`}
            title={t('public')}
            style={{ fontSize: `${getVuSize(13)}px`, height: `${getVuSize(29)}px`, width: `${getVuSize(50)}px` }}
          >
            <svg style={{ width: `${getVuSize(14)}px`, height: `${getVuSize(14)}px` }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Copy Link Button */}
      <button
        onClick={handleCopyLink}
        disabled={!gameId || isConnecting}
        className={`w-full px-vu-md rounded font-bold transition-colors ${
          linkError
            ? 'bg-red-600 text-white'
            : linkCopySuccess
            ? 'bg-green-600 text-white'
            : isConnecting
            ? 'bg-yellow-600 text-white'
            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
        } ${!gameId || isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
        style={{ fontSize: `${getVuSize(13)}px`, height: `${getVuSize(44)}px` }}
      >
        {linkError || (isConnecting ? (t('connecting') || 'Connecting...') : (linkCopySuccess ? t('copied') : t('copyInviteLink')))}
      </button>
    </div>
  )
}

InvitePlayerMenu.displayName = 'InvitePlayerMenu'

const Header = memo<HeaderProps>(({
  gameId,
  isGameStarted,
  onResetGame,
  onPlayerReady,
  players,
  localPlayerId,
  activeGridSize,
  onGridSizeChange,
  dummyPlayerCount,
  onDummyPlayerCountChange,
  realPlayerCount,
  connectionStatus,
  onExitGame,
  onOpenTokensModal,
  onOpenCountersModal,
  gameMode,
  onGameModeChange,
  isPrivate,
  onPrivacyChange,
  isHost,
  hostId,
  onSyncGame: _onSyncGame, // Currently unused in UI but may be needed later
  currentPhase,
  onSetPhase,
  onNextPhase,
  onPrevPhase,
  activePlayerId,
  playerColorMap,
  isAutoAbilitiesEnabled,
  onToggleAutoAbilities,
  isAutoDrawEnabled,
  onToggleAutoDraw,
  hideDummyCards,
  onToggleHideDummyCards,
  currentRound = 1,
  turnNumber = 1,
  isScoringStep = false,
  hasLastPlayedCard = false,
  isReconnecting = false,
  reconnectProgress = null,
  connectToSignalling,
  isConnectedToSignalling,
  onOpenGameLog,
}) => {
  const { t } = useLanguage()
  const [showRoundTooltip, setShowRoundTooltip] = useState(false)

  // Game Settings Menu
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  // Invite Player Menu
  const [inviteMenuOpen, setInviteMenuOpen] = useState(false)
  const inviteButtonRef = useRef<HTMLButtonElement>(null)

  // Force re-render on window resize to update VU-based text sizes
  const [, forceUpdate] = useState({})
  useEffect(() => {
    const handleResize = () => {
      forceUpdate({})
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleRoundMouseEnter = useCallback(() => {
    setShowRoundTooltip(true)
  }, [])

  const handleRoundMouseLeave = useCallback(() => {
    setShowRoundTooltip(false)
  }, [])

  return (
    <>
      <header className="fixed top-0 left-0 right-0 h-vu-header bg-panel-bg bg-opacity-80 backdrop-blur-sm z-50 flex items-center justify-between px-vu-md shadow-lg" style={{ paddingLeft: `${getVuSize(10)}px`, paddingRight: `${getVuSize(10)}px` }}>
        {/* Left side: Connection indicator + divider + Game Settings + Invite Player + divider */}
        <div className="flex items-center gap-vu-header-md">
          <StatusIndicator connectionStatus={connectionStatus} isReconnecting={isReconnecting} reconnectProgress={reconnectProgress} />

          {/* Vertical divider after connection indicator */}
          <div className="w-vu-border h-vu-divider bg-gray-600 header-divider-spacer" />

          {/* Game Settings Button */}
          <button
            ref={settingsButtonRef}
            onClick={() => setSettingsMenuOpen(!settingsMenuOpen)}
            className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-vu-md px-vu-md rounded-vu-2 transition-colors"
            style={{ fontSize: `${getVuSize(13)}px` }}
          >
            {t('gameSettings')}
          </button>

          {/* Invite Player Button */}
          <button
            ref={inviteButtonRef}
            onClick={() => setInviteMenuOpen(!inviteMenuOpen)}
            disabled={isGameStarted}
            className={`font-medium py-vu-md px-vu-md rounded-vu-2 transition-colors ${
              isGameStarted
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            }`}
            style={{ fontSize: `${getVuSize(13)}px` }}
          >
            {t('invitePlayer')}
          </button>

          {/* Vertical divider */}
          <div className="w-vu-border h-vu-divider bg-gray-600 header-divider-spacer" />

          {/* Game Log Button */}
          <button
            onClick={onOpenGameLog}
            className="relative font-medium py-vu-md px-vu-md rounded-vu-2 transition-colors bg-gray-700 hover:bg-gray-600 text-white"
            style={{ fontSize: `${getVuSize(13)}px` }}
            title={t('gameLog') || 'Game Log'}
          >
            <span className="flex items-center gap-vu-1">
              <span>{t('log') || 'Log'}</span>
            </span>
          </button>
        </div>

        {/* Center-left: Round tracker (always visible, inactive until game starts) */}
        {/* Center: Round tracker + divider + Phase display + Tokens + Counters */}
        <div className="flex items-center gap-vu-header-md">
          <RoundTracker
            currentRound={currentRound}
            turnNumber={turnNumber}
            onMouseEnter={handleRoundMouseEnter}
            onMouseLeave={handleRoundMouseLeave}
            showTooltip={showRoundTooltip}
            isGameStarted={isGameStarted}
            t={t}
          />

          {/* Vertical divider */}
          <div className="w-vu-border h-vu-divider bg-gray-600 header-divider-spacer" />

          {/* Phase display with all 4 phases and navigation arrows (always visible) */}
          <div className={`flex items-stretch bg-gray-800 rounded-vu-2 px-vu-md ${!isGameStarted ? 'opacity-50' : ''} gap-vu-header-sm`}>
            <button
              onClick={() => onPrevPhase()}
              disabled={!isGameStarted}
              className="px-vu-md flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-700 rounded-vu-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6 L8 12 L15 18 Z" /></svg>
            </button>
            {TURN_PHASES.map((phase, index) => {
              // Phase mapping: TURN_PHASES indices (0-3) map to phases (1-4)
              // Preparation phase (0) is hidden and maps to Setup display (index 0)
              const visiblePhaseIndex = index + 1  // 1=Setup, 2=Main, 3=Commit, 4=Scoring
              const isCurrentPhase = currentPhase === visiblePhaseIndex || currentPhase === 0
              // Get active player's color for current phase highlight
              const activePlayerColor = activePlayerId !== null ? playerColorMap.get(activePlayerId) : undefined
              const colorClasses = activePlayerColor ? PLAYER_COLORS[activePlayerColor as keyof typeof PLAYER_COLORS]?.bg : 'bg-yellow-500'

              // Scoring phase (4) can only be clicked if:
              // - We're already in scoring mode (isScoringStep=true), OR
              // - Active player has a LastPlayed card
              const isScoringPhase = visiblePhaseIndex === 4
              const canClickScoring = isScoringPhase && (isScoringStep || hasLastPlayedCard)

              // Only show highlight color if game is started
              const bgClass = isGameStarted && isCurrentPhase ? `${colorClasses} text-white` : 'text-gray-400 hover:text-white'
              const isDisabled = !isGameStarted || (isScoringPhase && !canClickScoring && !isScoringStep)

              // When clicking on a phase, jump directly to that phase (skip intermediate phases)
              // Scoring mode initialization is handled in handleSetPhase
              const handlePhaseClick = () => {
                if (isDisabled) { return }
                onSetPhase(visiblePhaseIndex)
              }

              return (
                <div
                  key={phase}
                  onClick={handlePhaseClick}
                  className={`
                    px-vu-md py-vu-md font-bold uppercase transition-all duration-200 rounded-vu-2
                    ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                    ${!isDisabled && !isCurrentPhase ? 'hover:bg-gray-700' : ''}
                    ${bgClass}
                  `}
                  style={{ fontSize: `${getVuSize(13)}px` }}
                >
                  {phase}
                </div>
              )
            })}
            <button
              onClick={() => onNextPhase()}
              disabled={!isGameStarted}
              className="px-vu-md flex items-center justify-center text-gray-300 hover:text-white hover:bg-gray-700 rounded-vu-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 6 L16 12 L9 18 Z" /></svg>
            </button>
          </div>

          {/* Vertical divider */}
          <div className="w-vu-border h-vu-divider bg-gray-600 header-divider-spacer" />

          {/* Tokens button */}
          <button
            onClick={onOpenTokensModal}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-vu-md px-vu-md rounded-vu-2 transition-colors"
            style={{ fontSize: `${getVuSize(13)}px` }}
          >
            {t('tokens')}
          </button>

          {/* Counters button */}
          <button
            onClick={onOpenCountersModal}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-vu-md px-vu-md rounded-vu-2 transition-colors"
            style={{ fontSize: `${getVuSize(13)}px` }}
          >
            {t('counters')}
          </button>
        </div>

        {/* Right side: Ready/Reset + divider + Exit */}
        <div className="flex items-center gap-vu-header-md">
          {/* Ready button - shows I'm ready [x/y] when game not started */}
          {/* Reset Game button - shows when game is started (available to all players) */}
          {!isGameStarted && players && (
            <button
              onClick={onPlayerReady}
              disabled={localPlayerId === null}
              className={`font-bold py-vu-md px-vu-lg rounded-vu-2 ${
                localPlayerId !== null && players.some((p: Player) => p.id === localPlayerId && p.isReady)
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-green-600 hover:bg-green-700 animate-pulse'
              } disabled:bg-gray-600 disabled:opacity-70 disabled:cursor-not-allowed disabled:animate-none`}
              style={{ fontSize: `${getVuSize(13)}px` }}
            >
              {t("imReady")} [{players.filter((p: Player) => p.isReady).length}/{players.length}]
            </button>
          )}

          {isGameStarted && onResetGame && (
            <button
              onClick={onResetGame}
              disabled={!isHost}
              className={`font-bold py-vu-md px-vu-lg rounded-vu-2 ${
                isHost
                  ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              } disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed`}
              title={isHost ? "Reset game to lobby (keeps players and decks)" : "Only host can reset game"}
              style={{ fontSize: `${getVuSize(13)}px` }}
            >
              {t('resetGame')}
            </button>
          )}

          {/* Vertical divider */}
          <div className="w-vu-border h-vu-divider bg-gray-600 header-divider-spacer" />

          {/* Exit button */}
          <button
            onClick={onExitGame}
            className={`bg-${isGameStarted ? 'red' : 'gray'}-600 hover:bg-${isGameStarted ? 'red' : 'gray'}-700 text-white font-bold py-vu-md px-vu-lg rounded-vu-2 transition-colors`}
            style={{ fontSize: `${getVuSize(13)}px` }}
          >
            {t('exit')}
          </button>
        </div>
      </header>

      {/* Game Settings Menu */}
      <GameSettingsMenu
        isOpen={settingsMenuOpen}
        onClose={() => setSettingsMenuOpen(false)}
        anchorEl={settingsButtonRef.current}
        isAutoAbilitiesEnabled={isAutoAbilitiesEnabled}
        onToggleAutoAbilities={onToggleAutoAbilities}
        isAutoDrawEnabled={isAutoDrawEnabled}
        onToggleAutoDraw={onToggleAutoDraw}
        dummyPlayerCount={dummyPlayerCount}
        onDummyPlayerCountChange={onDummyPlayerCountChange}
        realPlayerCount={realPlayerCount}
        activeGridSize={activeGridSize}
        onGridSizeChange={onGridSizeChange}
        gameMode={gameMode}
        onGameModeChange={onGameModeChange}
        isGameStarted={isGameStarted}
        isHost={isHost}
        hideDummyCards={hideDummyCards}
        onToggleHideDummyCards={onToggleHideDummyCards}
        t={t}
      />

      {/* Invite Player Menu */}
      <InvitePlayerMenu
        isOpen={inviteMenuOpen}
        onClose={() => setInviteMenuOpen(false)}
        anchorEl={inviteButtonRef.current}
        gameId={gameId}
        isPrivate={isPrivate}
        onPrivacyChange={onPrivacyChange}
        isHost={isHost}
        isGameStarted={isGameStarted}
        hostId={hostId}
        t={t}
        connectToSignalling={connectToSignalling}
        isConnectedToSignalling={isConnectedToSignalling}
      />
    </>
  )
})

export { Header }
