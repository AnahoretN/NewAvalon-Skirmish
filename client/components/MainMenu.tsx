import React, { memo, useState, useEffect } from 'react'
import { CardDetailModal } from './CardDetailModal'
import type { GameState, Card, Player } from '@/types'
import { STATUS_DESCRIPTIONS } from '@/constants'
import { APP_VERSION } from 'virtual:version'
import type { ConnectionStatus } from '@/hooks/useGameState'
import { useJoinGameModal, useDeckBuilderModal, useSettingsModal, useRulesModal } from '@/hooks/useModals.tsx'
import { getWebRTCEnabled } from '@/hooks/useWebRTCEnabled'

interface MainMenuProps {
    handleCreateGame: () => void;
    handleJoinGame: (gameId: string) => void;
    gamesList: { gameId: string; playerCount: number }[];
    requestGamesList: () => void;
    setViewingCard: React.Dispatch<React.SetStateAction<{ card: Card; player?: Player } | null>>;
    handleSaveSettings: (url: string) => void;
    viewingCard: { card: Card; player?: Player } | null;
    gameState: GameState;
    imageRefreshVersion: number;
    t: (key: any) => string;
    connectionStatus: ConnectionStatus;
    forceReconnect: () => void;
    gameId?: string | null;
    isGameStarted?: boolean;
    isPrivate?: boolean;
    onClearImageCache?: () => void;
    hostId?: string | null;
    // WebRTC props
    connectAsGuest?: (hostId: string) => Promise<boolean>;
    // NEW: Local game creation (without PeerJS)
    createLocalGame?: () => string;
}

export const MainMenu: React.FC<MainMenuProps> = memo(({
  handleCreateGame,
  handleJoinGame,
  gamesList,
  requestGamesList,
  setViewingCard,
  handleSaveSettings,
  viewingCard,
  gameState,
  imageRefreshVersion,
  t,
  connectionStatus,
  forceReconnect,
  gameId = null,
  isGameStarted = false,
  isPrivate = false,
  onClearImageCache,
  hostId = null,
  createLocalGame,
}) => {
  const [isInitializingHost, setIsInitializingHost] = useState(false)

  // New modal system hooks
  const joinGameModal = useJoinGameModal()
  const deckBuilderModal = useDeckBuilderModal()
  const settingsModal = useSettingsModal()
  const rulesModal = useRulesModal()

  // Check actual WebRTC mode from localStorage (source of truth)
  const actualWebrtcEnabled = getWebRTCEnabled()

  // Sync old props-based calls to new modal system
  useEffect(() => {
    if (joinGameModal.isOpen) {
      // Request games list when modal opens
      requestGamesList()
    }
  }, [joinGameModal.isOpen, requestGamesList])

  const openJoinModal = () => {
    joinGameModal.open({
      games: gamesList,
      onJoin: handleJoinGame,
      onRefreshGames: requestGamesList
    })
  }

  const openDeckBuilder = () => {
    deckBuilderModal.open({
      setViewingCard,
      imageRefreshVersion
    })
  }

  const openSettings = () => {
    settingsModal.open({
      connectionStatus,
      onReconnect: forceReconnect,
      onSave: handleSaveSettings,
      gameId,
      isGameStarted,
      isPrivate,
      hostId,
      onClearImageCache
    })
  }

  const openRules = () => {
    rulesModal.open({})
  }

  const handleHostGame = async () => {
    if (!createLocalGame) {return}
    setIsInitializingHost(true)
    try {
      // Create local game WITHOUT connecting to PeerJS
      // This allows player to set up their game without using server resources
      createLocalGame()
      // Note: createLocalGame already creates the game and sets localPlayerId
      // No need to call handleCreateGame again
    } catch (err) {
    } finally {
      setIsInitializingHost(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white relative overflow-hidden">
      <div className="z-10 text-center p-8 bg-black bg-opacity-60 rounded-vu-2 shadow-2xl border border-gray-700 max-w-md w-full">
        {/* Cyberpunk Neon Title */}
        <div className="mb-6">
          <h1
            className="font-black tracking-wider"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: '2.5rem',
              lineHeight: '1',
              color: '#FFFFFF',
              textShadow: `
                0 0 7px #A300FF,
                0 0 13px #A300FF,
                0 0 27px #A300FF,
                0 0 53px #A300FF,
                -2px -2px 0 #000033,
                2px -2px 0 #000033,
                -2px 2px 0 #000033,
                2px 2px 0 #000033,
                -2px 0 0 #000033,
                2px 0 0 #000033,
                0 -2px 0 #000033,
                0 2px 0 #000033
              `,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale'
            }}
          >
            NEW AVALON
          </h1>
          <div className="flex items-center justify-center gap-3 mt-2">
            <h2
              className="font-bold tracking-[0.3em]"
              style={{
                fontFamily: "'Orbitron', sans-serif",
                fontSize: '1.5rem',
                color: '#FFFFFF',
                textShadow: `
                  0 0 3px #A300FF,
                  0 0 7px #A300FF,
                  0 0 13px #A300FF,
                  -1px -1px 0 #000033,
                  1px -1px 0 #000033,
                  -1px 1px 0 #000033,
                  1px 1px 0 #000033
                `,
                textTransform: 'uppercase'
              }}
            >
                SKIRMISH
            </h2>
            {/* Connection Status Indicator */}
            <span className={`relative flex h-3 w-3`}>
              {/* WebRTC P2P mode - magenta indicator (same as title glow) */}
              {actualWebrtcEnabled && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: '#A300FF' }}></span>
                  <span className="relative inline-flex rounded-full h-3 w-3" style={{ backgroundColor: '#A300FF' }}></span>
                </>
              )}
              {/* Standard server mode - green/yellow/red based on status */}
              {!actualWebrtcEnabled && connectionStatus === 'Connected' && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </>
              )}
              {!actualWebrtcEnabled && connectionStatus === 'Connecting' && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span>
                </>
              )}
              {!actualWebrtcEnabled && connectionStatus === 'Disconnected' && (
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              )}
            </span>
          </div>
        </div>

        <div className="space-y-2 w-full">
          {/* Host Game Button */}
          <button
            onClick={actualWebrtcEnabled ? handleHostGame : handleCreateGame}
            disabled={
              !actualWebrtcEnabled && connectionStatus !== 'Connected'
            }
            className={`w-full font-bold py-3 px-6 rounded-vu-2 shadow-lg transition-all transform flex items-center justify-center gap-2 ${
              (actualWebrtcEnabled && !isInitializingHost) || (!actualWebrtcEnabled && connectionStatus === 'Connected')
                ? 'text-white hover:scale-105'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
            style={
              (actualWebrtcEnabled && !isInitializingHost) || (!actualWebrtcEnabled && connectionStatus === 'Connected')
                ? {
                    backgroundColor: '#A300FF'
                  }
                : {}
            }
            onMouseEnter={(e) => {
              if ((actualWebrtcEnabled && !isInitializingHost) || (!actualWebrtcEnabled && connectionStatus === 'Connected')) {
                e.currentTarget.style.backgroundColor = '#8A00D6'
              }
            }}
            onMouseLeave={(e) => {
              if ((actualWebrtcEnabled && !isInitializingHost) || (!actualWebrtcEnabled && connectionStatus === 'Connected')) {
                e.currentTarget.style.backgroundColor = '#A300FF'
              }
            }}
          >
            {actualWebrtcEnabled ? (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                {isInitializingHost ? t('connecting') + '...' : t('hostGame')}
              </>
            ) : (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                {t('startGame')}
              </>
            )}
          </button>

          {/* Join Game Button - only for server mode */}
          <button
            onClick={openJoinModal}
            disabled={actualWebrtcEnabled || connectionStatus !== 'Connected'}
            className={`w-full font-bold py-3 px-6 rounded-vu-2 shadow-lg transition-all transform flex items-center justify-center gap-2 ${
              !actualWebrtcEnabled && connectionStatus === 'Connected'
                ? 'bg-gray-700 hover:bg-gray-600 text-white hover:scale-105'
                : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
            title={actualWebrtcEnabled ? 'Join via invite link in WebRTC mode' : ''}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
            {t('joinGame')}
          </button>

          <button
            disabled
            className="w-full bg-gray-800 text-gray-500 font-bold py-3 px-6 rounded-vu-2 shadow-inner flex items-center justify-center gap-2 cursor-not-allowed border border-gray-700"
            title={t('comingSoon')}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            {t('storyMode')}
          </button>

          <button
            disabled
            className="w-full bg-gray-800 text-gray-500 font-bold py-3 px-6 rounded-vu-2 shadow-inner flex items-center justify-center gap-2 cursor-not-allowed border border-gray-700"
            title={t('comingSoon')}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            {t('puzzles')}
          </button>

          <button
            onClick={openDeckBuilder}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-vu-2 shadow-lg transition-all transform hover:scale-105 flex items-center justify-center gap-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            {t('deckBuilding')}
          </button>

          <button
            onClick={openRules}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-vu-2 shadow-lg transition-all transform hover:scale-105 flex items-center justify-center gap-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            {t('rules')}
          </button>

          <button
            onClick={openSettings}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-2 px-6 rounded-vu-2 shadow transition-all flex items-center justify-center gap-2 border border-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            {t('settings')}
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-700 flex justify-center gap-6">
          <a href="https://t.me/NeurohoretApp" target="_blank" rel="noopener noreferrer" className="transition-transform hover:scale-110" title="Telegram">
            <img src="https://res.cloudinary.com/dxxh6meej/image/upload/v1764190409/Telegram_logo.svg_rnhkud.webp" alt="Telegram" className="w-8 h-8" />
          </a>
          <a href="https://discord.gg/U5zKADsZZY" target="_blank" rel="noopener noreferrer" className="transition-transform hover:scale-110" title="Discord">
            <img src="https://res.cloudinary.com/dxxh6meej/image/upload/v1764190408/discord-icon_nhgjyx.svg" alt="Discord" className="w-8 h-8" />
          </a>
          <a href="https://www.donationalerts.com/r/anahoret" target="_blank" rel="noopener noreferrer" className="transition-transform hover:scale-110" title="DonationAlerts">
            <img src="https://res.cloudinary.com/dxxh6meej/image/upload/v1764190414/donationalerts_hpjtbe.png" alt="DonationAlerts" className="w-8 h-8 rounded" />
          </a>
          <a href="https://www.patreon.com/c/AnchoriteComics" target="_blank" rel="noopener noreferrer" className="transition-transform hover:scale-110" title="Patreon">
            <img src="https://res.cloudinary.com/dxxh6meej/image/upload/v1764190408/Patreon_logo.svg_ala7gn.png" alt="Patreon" className="w-8 h-8" />
          </a>
        </div>
      </div>

      <div className="absolute bottom-4 text-gray-500 text-xs">
                v{APP_VERSION}
      </div>

      {/* CardDetailModal is kept here as it's used across the app, not just in MainMenu */}
      {viewingCard && (
        <CardDetailModal
          card={viewingCard.card}
          ownerPlayer={viewingCard.player}
          onClose={() => setViewingCard(null)}
          statusDescriptions={STATUS_DESCRIPTIONS}
          allPlayers={gameState.players}
          imageRefreshVersion={imageRefreshVersion}
        />
      )}
    </div>
  )
})
