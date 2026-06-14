import React, { useState, useCallback, useEffect, useMemo } from 'react'
import type { Card as CardType, Player as PlayerType } from '@/types'
import { Card } from './Card'
import { useLanguage } from '@/contexts/LanguageContext'

// Player color mapping for borders
const PLAYER_BORDER_COLORS: Record<string, string> = {
  blue: '#3b82f6',
  purple: '#a855f7',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
  pink: '#ec4899',
  brown: '#a16207',
  cyan: '#06b6d4',
}

// Вычисляем VU размер для элементов динамически
const getVuSize = (vu: number) => {
  const vuPixels = window.innerHeight / 1000
  return vu * vuPixels
}

interface MulliganModalProps {
  players: PlayerType[]
  localPlayerId: number | null
  onConfirm: (newHand: CardType[]) => void
  onExchangeCard?: (cardIndex: number) => void
  playerColorMap: Map<number, string>
  imageRefreshVersion?: number
  gameState?: any
}

const MAX_MULLIGAN_ATTEMPTS = 3

export const MulliganModal: React.FC<MulliganModalProps> = ({
  players,
  localPlayerId,
  onConfirm,
  onExchangeCard,
  playerColorMap,
  imageRefreshVersion,
  gameState,
}) => {
  const { t } = useLanguage()

  // Type-safe translation helper
  const tt = (key: string): string => {
    return t(key as any) as string
  }

  // Get player from gameState (fresh data)
  const freshPlayer = gameState?.players?.find((p: any) => p.id === localPlayerId)

  // Internal state - sync with fresh data from gameState
  const [hand, setHand] = useState<CardType[]>(freshPlayer?.hand || players.find(p => p.id === localPlayerId)?.hand || [])
  const [attempts, setAttempts] = useState<number>(freshPlayer?.mulliganAttempts ?? MAX_MULLIGAN_ATTEMPTS)
  const [exchangingIndex, setExchangingIndex] = useState<number | null>(null)

  // Sort hand so Hero card is always first (when starting hero mode is enabled)
  const displayHand = useMemo(() => {
    if (!gameState?.startingHeroEnabled) {
      return hand
    }

    const heroIndex = hand.findIndex(card => card.types && card.types.includes('Hero'))
    if (heroIndex === -1 || heroIndex === 0) {
      return hand // No hero or already first
    }

    // Move hero to first position
    const sortedHand = [...hand]
    const [heroCard] = sortedHand.splice(heroIndex, 1)
    sortedHand.unshift(heroCard)
    return sortedHand
  }, [hand, gameState?.startingHeroEnabled])

  // Get the original index for display hand (because we may have moved hero to front)
  const getOriginalIndex = (displayIndex: number) => {
    if (!gameState?.startingHeroEnabled) {
      return displayIndex
    }

    const heroIndex = hand.findIndex(card => card.types && card.types.includes('Hero'))
    if (heroIndex === -1) {
      return displayIndex
    }

    // If we're looking at the first card and it's the hero, return the hero's original index
    if (displayIndex === 0) {
      return heroIndex
    }

    // For cards after position 0, adjust for the shift
    const originalHand = hand.map((c, i) => ({ card: c, originalIndex: i }))
    const withoutHero = originalHand.filter((_, i) => i !== heroIndex)

    return withoutHero[displayIndex]?.originalIndex ?? displayIndex
  }

  // Check if a card at display index is the hero card
  const isHeroCard = (displayIndex: number) => {
    if (!gameState?.startingHeroEnabled) {
      return false
    }
    const card = displayHand[displayIndex]
    return card?.types && card.types.includes('Hero')
  }

  // Sync with gameState when it updates
  useEffect(() => {
    if (freshPlayer) {
      // Sync attempts
      const newAttempts = freshPlayer.mulliganAttempts ?? MAX_MULLIGAN_ATTEMPTS
      if (newAttempts !== attempts) {
        setAttempts(newAttempts)
      }

      // Sync hand
      if (freshPlayer.hand && freshPlayer.hand.length > 0) {
        const currentHandIds = hand.map((c: any) => c.id).join(',')
        const newHandIds = freshPlayer.hand.map((c: any) => c.id).join(',')
        if (currentHandIds !== newHandIds) {
          setHand(freshPlayer.hand)
        }
      }
    }
  }, [freshPlayer, attempts, hand])

  const canExchange = attempts > 0

  // Check player confirmation status - only count REAL players (dummy auto-confirm)
  const realPlayers = players.filter(p => !p.isDummy && !p.isSpectator)
  const confirmedCount = realPlayers.filter(p => p.hasMulliganed).length
  const totalPlayers = realPlayers.length

  const handleCardClick = useCallback((displayIndex: number) => {
    if (exchangingIndex !== null) {
      return // Already exchanging
    }
    if (!onExchangeCard) {
      return // No exchange handler provided
    }
    if (!canExchange) {
      return // No attempts left
    }

    // Convert display index to original index for the handler
    const originalIndex = getOriginalIndex(displayIndex)

    setExchangingIndex(displayIndex)
    onExchangeCard(originalIndex)

    // Reset exchanging state after a short delay
    setTimeout(() => {
      setExchangingIndex(null)
    }, 500)
  }, [exchangingIndex, onExchangeCard, canExchange, getOriginalIndex])

  const handleConfirm = useCallback(() => {
    onConfirm(hand)
  }, [hand, onConfirm])

  const canInteract = localPlayerId !== null && !freshPlayer?.hasMulliganed

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-vu-2 p-vu-xl max-w-vu-modal w-full max-h-vu-modal overflow-y-auto" style={{ padding: `${getVuSize(24)}px`, maxWidth: `${getVuSize(800)}px`, maxHeight: `${getVuSize(900)}px` }}>
        <div className="text-center mb-vu-min" style={{ marginBottom: `${getVuSize(8)}px` }}>
          <h2 className="font-bold text-white" style={{ fontSize: `${getVuSize(32)}px` }}>{tt('mulligan')}</h2>
        </div>
        <p className="text-gray-400 mb-vu-lg text-center" style={{ marginBottom: `${getVuSize(24)}px`, fontSize: `${getVuSize(18)}px` }}>{tt('mulliganInstruction')}</p>

        {/* Cards grid - 2 rows by 3 columns */}
        <div className="grid grid-cols-3 gap-vu-md mb-vu-lg mx-auto" style={{ gap: `${getVuSize(16)}px`, marginBottom: `${getVuSize(24)}px`, maxWidth: `${getVuSize(600)}px` }}>
          {displayHand.map((card, displayIndex) => {
            const isClickable = canInteract && canExchange
            const isHero = isHeroCard(displayIndex)
            const playerColor = freshPlayer?.color || 'blue'
            const borderColor = PLAYER_BORDER_COLORS[playerColor] || PLAYER_BORDER_COLORS.blue

            return (
              <div
                key={card.id}
                onClick={() => isClickable && handleCardClick(displayIndex)}
                className={`flex flex-col ${
                  isClickable ? 'cursor-pointer' : 'cursor-default'
                }`}
                style={isHero ? {
                  position: 'relative',
                  zIndex: 0
                } : undefined}
              >
                {/* Hero background frame - extends beyond card */}
                {isHero && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      width: 'calc(100% + 22px)',
                      height: 'calc(100% + 22px)',
                      padding: `${getVuSize(3)}px`,
                      background: `linear-gradient(135deg, ${borderColor}, ${borderColor}dd)`,
                      borderRadius: `${getVuSize(6)}px`,
                      boxShadow: `0 0 ${getVuSize(20)}px ${borderColor}88, inset 0 0 ${getVuSize(10)}px ${borderColor}44`,
                      transform: 'translate(-50%, -50%)',
                      zIndex: -1
                    }}
                  />
                )}
                {/* Card - normal size */}
                <div className="aspect-square w-full">
                  <div data-card-image="true" className="w-full h-full">
                    <Card
                      card={card}
                      isFaceUp={true}
                      playerColorMap={playerColorMap as any}
                      localPlayerId={localPlayerId}
                      imageRefreshVersion={imageRefreshVersion}
                      disableActiveHighlights={true}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Confirm button - always visible, updates with player count */}
        <div className="flex items-center justify-center gap-vu-md">
          <div className="bg-red-600 px-vu-lg py-vu-md rounded-vu-2 text-white font-bold hover:bg-red-700 transition-colors" style={{ fontSize: `${getVuSize(20)}px` }}>
            Attempts: {attempts}
          </div>
          <div className="w-vu-border h-vu-divider bg-white/30"></div>
          <button
            onClick={handleConfirm}
            disabled={!canInteract}
            className={`font-bold rounded-vu-2 transition-colors ${
              canInteract
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
            style={{ padding: `${getVuSize(12)}px ${getVuSize(32)}px`, fontSize: `${getVuSize(20)}px` }}
          >
            {tt('confirmHand')} [{confirmedCount}/{totalPlayers}]
          </button>
        </div>
      </div>
    </div>
  )
}
