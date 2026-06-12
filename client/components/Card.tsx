import React, { memo, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { DeckType } from '@/types'
import type { Card as CardType, PlayerColor } from '@/types'
import { DECK_THEMES, PLAYER_COLORS, STATUS_ICONS, PLAYER_COLOR_RGB } from '@/constants'
import { Tooltip, CardTooltipContent } from './Tooltip'
import { hasReadyAbilityInCurrentPhase } from '@/utils/autoAbilities'
import { useLanguage } from '@/contexts/LanguageContext'
import { getOptimizedImageUrl, getThumbnailImageUrl, addCacheBust, isCloudinaryUrl } from '@/utils/imageOptimization'
import { globalImageLoader } from '@/utils/imageLoader'
import { backgroundLoader } from '@/utils/backgroundImageLoader'

// Вычисляем VU размер для элементов динамически
const getVuSize = (vu: number) => {
  const vuPixels = window.innerHeight / 1000
  return vu * vuPixels
}

// Split props to prevent unnecessary rerenders when only display props change
interface CardCoreProps {
  card: CardType;
  isFaceUp: boolean;
  playerColorMap: Map<number, PlayerColor>;
  imageRefreshVersion?: number;
  smallStatusIcons?: boolean;
  extraPowerSpacing?: boolean;
  hidePower?: boolean;
  loadPriority?: 'high' | 'low'; // Loading priority: high for visible cards, low for remote cards (default: high)
  disableImageTransition?: boolean; // Disable opacity transition for board cards (default: false)
  playerColor?: PlayerColor; // Direct player color (used in PlayerPanel to avoid lookup issues)
  showCommandPlayButton?: boolean; // Show Play button for command cards (only for local player's hand)
  smallPowerDisplay?: boolean; // Use smaller power circle and font (for right panel opponents)
  showDeckBuilderBadges?: boolean; // Show Cost (blue) and Loyalty (purple) badges in deck builder
}

interface CardInteractionProps {
  localPlayerId?: number | null;
  disableTooltip?: boolean;
  activePhaseIndex?: number;
  activePlayerId?: number | null; // Aligned with GameState type (null when no active player)
  disableActiveHighlights?: boolean;
  preserveDeployAbilities?: boolean;
  activeAbilitySourceCoords?: { row: number, col: number } | null; // Source of currently active ability
  boardCoords?: { row: number, col: number } | null; // This card's position on board
  abilityCheckKey?: number; // Incremented to recheck ability readiness after ability completion
  onCardClick?: (card: CardType, boardCoords: { row: number, col: number }) => void; // Called when card is clicked
  onCommandPlayClick?: (card: CardType) => void; // Called when command Play button is clicked
  targetingMode?: boolean; // Whether targeting mode is active (hides ready statuses)
  triggerClickWave?: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void; // Trigger click wave effect
  playerId?: number; // Player who owns this card (for wave triggering)
  cardIndex?: number; // Card index in hand (for wave triggering)
  players?: any[]; // Players array for checking dummy status
}

// Extracted outside CardCore to preserve React.memo optimization
interface StatusIconProps {
  type: string;
  playerId: number;
  count: number;
  refreshVersion?: number;
  playerColorMap: Map<number, PlayerColor>;
  smallStatusIcons?: boolean;
  isNegative?: boolean; // true for negative tokens (top), false for positive tokens (bottom)
}

const StatusIcon: React.FC<StatusIconProps> = ({ type, playerId, count, refreshVersion, playerColorMap }) => {
  const statusColorName = playerColorMap.get(playerId)
  const statusBg = (statusColorName && PLAYER_COLORS[statusColorName]) ? PLAYER_COLORS[statusColorName].bg : 'bg-gray-500'

  const [iconLoadState, setIconLoadState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  const [currentIconUrl, setCurrentIconUrl] = useState<string | null>(null)

  // Force re-render on window resize to update VU-based sizes
  const [, forceUpdate] = useState({})
  useEffect(() => {
    const handleResize = () => {
      forceUpdate({})
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Direct function to get icon URL - reads fresh from STATUS_ICONS every time
  const getIconUrl = useCallback(() => {
    let url = STATUS_ICONS[type]
    if (url) {
      // Apply Cloudinary optimizations for status icons (VU-based sizing)
      url = getOptimizedImageUrl(url, { width: 80 }) // VU icon-md size
      const separator = url.includes('?') ? '&' : '?'
      url = `${url}${separator}v=${refreshVersion}`
    }
    return url
  }, [type, refreshVersion])

  // Update icon URL when type or refreshVersion changes
  useEffect(() => {
    const url = getIconUrl()
    setCurrentIconUrl(url)
    setIconLoadState('loading')
  }, [getIconUrl])

  const handleIconLoad = useCallback(() => {
    setIconLoadState('loaded')
  }, [])

  const handleIconError = useCallback(() => {
    const maxRetries = 2
    const currentAttempts = globalImageLoader.incrementAttempts(currentIconUrl || '')

    if (currentAttempts <= maxRetries) {
      const delay = Math.min(500 * Math.pow(2, currentAttempts - 1), 2000)
      setTimeout(() => {
        if (currentIconUrl) {
          const separator = currentIconUrl.includes('?') ? '&' : '?'
          setCurrentIconUrl(`${currentIconUrl}${separator}retry=${Date.now()}`)
        }
      }, delay)
    } else {
      setIconLoadState('failed')
    }
  }, [currentIconUrl])

  // Resurrected should only show once per card (like Support, Threat, etc.)
  const isSingleInstance = ['Support', 'Threat', 'Revealed', 'LastPlayed', 'Resurrected'].includes(type)
  const showCount = !isSingleInstance && count > 1

  // Fixed padding for all icons to avoid size inconsistencies
  const iconPaddingClass = '' // Временно убираем padding для теста

  // Size logic: VU-based sizing for status icons (используем inline styles для точности)
  const vuPixels = window.innerHeight / 1000
  const iconSize = 32 * vuPixels // Fixed 35vu size for all tokens
  const sizeStyle = {
    width: `${iconSize}px`,
    height: `${iconSize}px`,
    minWidth: `${iconSize}px`,
    maxWidth: `${iconSize}px`
  }
  const fontSizeClass = showCount ? 'text-vu-xs' : 'text-vu-sm'

  const countBadgeStyle = { fontSize: 'calc(15 * var(--vu-base))' } // 15 VU для числа количества

  return (
    <div
      className={`relative flex items-center justify-center ${statusBg} bg-opacity-80 rounded-vu-2 flex-shrink-0`}
      style={sizeStyle}
      title={`${type} (Player ${playerId}) ${!isSingleInstance && count > 0 ? `x${count}` : ''}`}
    >
      {currentIconUrl && iconLoadState !== 'failed' ? (
        <img
          src={currentIconUrl}
          onLoad={handleIconLoad}
          onError={handleIconError}
          alt={type}
          className={`object-contain w-full h-full transition-all duration-150 ${iconPaddingClass}`}
        />
      ) : (
        <span className={`text-white font-black transition-all duration-150 ${fontSizeClass}`} style={{ textShadow: '0 0 2px black' }}>
          {type.charAt(0)}
        </span>
      )}

      {showCount && (
        <span
          className="absolute top-0 right-0.5 text-white font-extrabold leading-none"
          style={{ textShadow: '0 0 4px black', ...countBadgeStyle }}
        >
          {count}
        </span>
      )}
    </div>
  )
}

const CardCore: React.FC<CardCoreProps & CardInteractionProps> = memo(({
  card,
  isFaceUp,
  playerColorMap,
  localPlayerId,
  imageRefreshVersion,
  disableTooltip = false,
  smallStatusIcons = false,
  activePhaseIndex,
  activePlayerId, // Used for ability highlighting and arePropsEqual comparison
  disableActiveHighlights = false,
  extraPowerSpacing = false,
  hidePower = false,
  loadPriority = 'high', // Default to high priority for immediate loading
  disableImageTransition = false, // Disable opacity transition for board cards
  playerColor, // Direct player color (used in PlayerPanel to avoid lookup issues)
  showCommandPlayButton = false, // Only show Play button for local player's hand
  smallPowerDisplay = false, // Use smaller power display (for right panel)
  showDeckBuilderBadges = false, // Show Cost/Loyalty badges in deck builder
  preserveDeployAbilities: _preserveDeployAbilities = false, // Used in arePropsEqual comparison
  activeAbilitySourceCoords = null,
  boardCoords = null,
  abilityCheckKey,
  onCardClick,
  onCommandPlayClick,
  targetingMode = false,
  triggerClickWave,
  players,
}) => {
  const { getCardTranslation } = useLanguage()
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const tooltipTimeoutRef = useRef<number | null>(null)

  const [isShining, setIsShining] = useState(false)

  // Progressive image loading: show preview first, then load to full size
  // VU-based sizing for progressive loading
  // Right panels (opponents): VU preview → VU target
  // Left panel & board: VU preview → VU target
  const isHighQuality = loadPriority === 'high'
  const TARGET_SIZE = isHighQuality ? 400 : 130 // VU card-large / card-small
  const PREVIEW_SIZE = isHighQuality ? 130 : 70 // VU card-small / optimized

  // Track which URL to display - only update when target is loaded
  // Use ref to track the last loaded target URL to prevent unnecessary updates
  const lastLoadedTargetUrlRef = useRef<string | null>(null)
  const [displayUrl, setDisplayUrl] = useState<string>(() => {
    if (!card.imageUrl) {
      return card.imageUrl || ''
    }
    // For Cloudinary images, start with preview
    const previewUrl = isCloudinaryUrl(card.imageUrl)
      ? getThumbnailImageUrl(card.imageUrl, PREVIEW_SIZE)
      : card.imageUrl
    return addCacheBust(previewUrl, imageRefreshVersion)
  })

  const [imageLoadState, setImageLoadState] = useState<'loading' | 'loaded' | 'failed'>(() => {
    const url = addCacheBust(card.imageUrl || '', imageRefreshVersion)
    if (url && globalImageLoader.isLoaded(url)) {
      return 'loaded'
    }
    if (url && globalImageLoader.hasFailed(url)) {
      return 'failed'
    }
    return 'loading'
  })

  const retryTimeoutRef = useRef<number | null>(null)

  const [highlightDismissed, setHighlightDismissed] = useState(false)
  const localized = card.baseId ? getCardTranslation(card.baseId) : undefined
  const displayCard = localized ? { ...card, ...localized } : card

  useEffect(() => {
    setHighlightDismissed(false)
  }, [activePhaseIndex, abilityCheckKey])

  // Force re-render on window resize to update VU-based sizes
  const [, forceUpdate] = useState({})
  useEffect(() => {
    const handleResize = () => {
      forceUpdate({})
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Hide tooltip when any card drag starts
  useEffect(() => {
    const handleDragStart = () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current)
        tooltipTimeoutRef.current = null
      }
      setTooltipVisible(false)
    }

    const checkDraggingAttribute = () => {
      if (document.body.getAttribute('data-dragging-card') === 'true') {
        if (tooltipTimeoutRef.current) {
          clearTimeout(tooltipTimeoutRef.current)
          tooltipTimeoutRef.current = null
        }
        setTooltipVisible(false)
      }
    }

    window.addEventListener('cardDragStart', handleDragStart)
    // Also check periodically when hovering (using mousemove as proxy)
    window.addEventListener('mousemove', checkDraggingAttribute)

    return () => {
      window.removeEventListener('cardDragStart', handleDragStart)
      window.removeEventListener('mousemove', checkDraggingAttribute)
    }
  }, [])

  useEffect(() => {
    if (!disableActiveHighlights) {
      setHighlightDismissed(false)
    }
  }, [disableActiveHighlights])

  // Progressive loading effect
  useEffect(() => {
    if (!card.imageUrl) {
      return
    }

    if (!isCloudinaryUrl(card.imageUrl)) {
      // Non-Cloudinary images - direct load
      const directUrl = addCacheBust(card.imageUrl, imageRefreshVersion)
      setDisplayUrl(prev => prev === directUrl ? prev : directUrl)
      setImageLoadState('loaded')
      lastLoadedTargetUrlRef.current = directUrl
      return
    }

    // For Cloudinary images, use progressive loading
    const previewUrl = getThumbnailImageUrl(card.imageUrl, PREVIEW_SIZE)
    const targetUrl = getThumbnailImageUrl(card.imageUrl, TARGET_SIZE)

    const previewWithVersion = addCacheBust(previewUrl, imageRefreshVersion)
    const targetWithVersion = addCacheBust(targetUrl, imageRefreshVersion)

    // Check if target image is already loaded (in memory cache or globalImageLoader)
    const isAlreadyLoaded = globalImageLoader.isLoaded(targetWithVersion) ||
                            lastLoadedTargetUrlRef.current === targetWithVersion

    const handleLoad = () => {
      // Only update if URL actually changed to prevent flash
      setDisplayUrl(prev => prev === targetWithVersion ? prev : targetWithVersion)
      setImageLoadState('loaded')
      lastLoadedTargetUrlRef.current = targetWithVersion
      if (targetWithVersion) {
        globalImageLoader.markLoaded(targetWithVersion)
      }
    }

    // If already loaded (either in cache or we loaded it before), show target immediately without flash
    if (isAlreadyLoaded) {
      setDisplayUrl(prev => prev === targetWithVersion ? prev : targetWithVersion)
      setImageLoadState('loaded')
      lastLoadedTargetUrlRef.current = targetWithVersion
      return
    }

    // Show preview first for progressive loading
    // Only update if current URL is not already target or preview
    setDisplayUrl(prev => {
      // If we already have the target URL, keep it
      if (prev === targetWithVersion) {
        return prev
      }
      // If we already have the preview URL, keep it
      if (prev === previewWithVersion) {
        return prev
      }
      // Otherwise show preview
      return previewWithVersion
    })

    // Load target image
    const img = new Image()

    img.onload = handleLoad
    img.onerror = () => {
      // If target fails, keep preview visible
      setImageLoadState('loaded')
    }

    img.src = targetWithVersion

    // Check if already cached in browser
    if (img.complete && img.naturalWidth > 0) {
      handleLoad()
    }

    // Cleanup
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [card.imageUrl, card.id, imageRefreshVersion, loadPriority, isHighQuality, TARGET_SIZE, PREVIEW_SIZE])

  const currentImageSrc = displayUrl

  const handleImageLoad = useCallback(() => {
    setImageLoadState('loaded')
    if (currentImageSrc) {
      globalImageLoader.markLoaded(currentImageSrc)
    }
  }, [currentImageSrc])

  const handleImageError = useCallback(() => {
    const maxRetries = 3
    const currentAttempts = globalImageLoader.incrementAttempts(currentImageSrc)

    if (currentAttempts <= maxRetries) {
      // Retry with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, currentAttempts - 1), 5000)

      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }

      retryTimeoutRef.current = window.setTimeout(() => {
        // Force reload by adding timestamp
        const separator = currentImageSrc.includes('?') ? '&' : '?'
        setDisplayUrl(`${currentImageSrc}${separator}retry=${Date.now()}`)
      }, delay)
    } else {
      // Max retries reached, try fallback
      let fallback = card.fallbackImage
      if (imageRefreshVersion && fallback) {
        fallback = addCacheBust(fallback, imageRefreshVersion)
      }

      if (currentImageSrc !== fallback && fallback) {
        setDisplayUrl(fallback)
        globalImageLoader.reset(fallback)
      } else {
        setImageLoadState('failed')
        globalImageLoader.markFailed(currentImageSrc)
      }
    }
  }, [currentImageSrc, card.fallbackImage, imageRefreshVersion])

  // Cleanup retry timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
      }
    }
  }, [])

  const isHero = card.types?.includes('Hero')

  useEffect(() => {
    if (!isHero || !isFaceUp) {
      setIsShining(false)
      return
    }

    let shineTimer: number | undefined
    let resetTimer: number | undefined

    const scheduleShine = () => {
      const delay = 3000 + Math.random() * 500

      shineTimer = window.setTimeout(() => {
        setIsShining(true)

        resetTimer = window.setTimeout(() => {
          setIsShining(false)
          scheduleShine()
        }, 750)
      }, delay)
    }

    scheduleShine()

    return () => {
      if (shineTimer !== undefined) {
        window.clearTimeout(shineTimer)
      }
      if (resetTimer !== undefined) {
        window.clearTimeout(resetTimer)
      }
    }
  }, [isHero, isFaceUp])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!disableTooltip) {
      if (e.clientX !== 0 || e.clientY !== 0) {
        setTooltipPos({ x: e.clientX, y: e.clientY })
      }
      if (!tooltipVisible && !tooltipTimeoutRef.current) {
        tooltipTimeoutRef.current = window.setTimeout(() => {
          setTooltipVisible(true)
        }, 250)
      }
    }
  }, [disableTooltip, tooltipVisible])

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (disableTooltip) {
      return
    }
    if (e.clientX !== 0 || e.clientY !== 0) {
      setTooltipPos({ x: e.clientX, y: e.clientY })
    }

    // Preload full-size image for card detail view
    if (card.imageUrl && isCloudinaryUrl(card.imageUrl)) {
      // Use normal priority for hover preloading since user is likely to click
      const fullSizeUrl = getOptimizedImageUrl(card.imageUrl, { width: 320 }) // VU modal-lg
      const urlWithVersion = addCacheBust(fullSizeUrl, imageRefreshVersion)
      backgroundLoader.preload(urlWithVersion, 'normal')
    }

    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
    }
    tooltipTimeoutRef.current = window.setTimeout(() => {
      setTooltipVisible(true)
    }, 250)
  }, [disableTooltip, card.imageUrl, imageRefreshVersion])

  const handleMouseLeave = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
    setTooltipVisible(false)
  }, [])

  const handleMouseDown = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current)
      tooltipTimeoutRef.current = null
    }
    setTooltipVisible(false)
  }, [])

  // Check if card should show ready ability highlighting based on:
  // 1. Card's owner is the active player
  // 2. Card has a ready status that matches the current phase
  const hasReadyAbility = hasReadyAbilityInCurrentPhase(
    card,
    activePhaseIndex ?? 0,
    activePlayerId
  )

  // Check if this card is currently executing an ability
  const isExecutingAbility = boardCoords && activeAbilitySourceCoords &&
    boardCoords.row === activeAbilitySourceCoords.row &&
    boardCoords.col === activeAbilitySourceCoords.col

  // Highlight if:
  // 1. Has a ready ability usable in current phase and by active player ONLY
  // 2. NOT currently executing an ability
  // 3. Not dismissed and not disabled
  // 4. NOT in targeting mode (ready abilities hidden during targeting)
  // IMPORTANT: Only show ready effect for active player's cards!
  const shouldHighlight = !disableActiveHighlights && !highlightDismissed && hasReadyAbility && !isExecutingAbility && !targetingMode

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    // Stop propagation to prevent double-triggering from parent GameBoard cell
    // Only stop if we have a handler or highlight, otherwise let parent handle the click (e.g., DeckViewModal)
    if (onCardClick || shouldHighlight) {
      e.stopPropagation()
    }
    // Trigger click wave for board cards
    if (triggerClickWave && boardCoords && localPlayerId !== null) {
      triggerClickWave('board', boardCoords)
    }
    // Check if card belongs to a dummy player (for ability activation)
    const cardOwner = players?.find(p => p.id === card.ownerId)
    const isDummyCard = cardOwner?.isDummy

    // Only card owner can activate abilities, OR anyone can activate dummy player cards
    const canActivateAbility = localPlayerId === card.ownerId || isDummyCard

    // If card has a ready ability and user clicks it, dismiss highlight and trigger ability
    if (shouldHighlight && canActivateAbility) {
      setHighlightDismissed(true)
    }
    // Call the parent's onCardClick handler if provided
    // IMPORTANT: During targeting mode, allow clicking on ANY card (for targeting mode)
    // Note: Hand cards are handled by the parent component's onClick, not here
    if (onCardClick && boardCoords && (canActivateAbility || targetingMode)) {
      onCardClick(card, boardCoords)
    }
  }, [shouldHighlight, localPlayerId, card, onCardClick, boardCoords, triggerClickWave, players, targetingMode])

  // Aggregate statuses by TYPE and PLAYER ID to allow separate icons for different players.
  // Hidden statuses: readyDeploy, readySetup, readyCommit, deployUsedThisTurn, setupUsedThisTurn, commitUsedThisTurn
  const statusGroups = useMemo(() => {
    // Statuses that should be hidden from display (internal ability system statuses)
    const hiddenStatusTypes: string[] = [
      'readyDeploy',
      'readySetup',
      'readyCommit',
      'deployUsedThisTurn',
      'setupUsedThisTurn',
      'commitUsedThisTurn'
    ]
    const groups = (card.statuses ?? []).reduce((acc, status) => {
      // Skip hidden statuses
      if (hiddenStatusTypes.includes(status.type)) {
        return acc
      }
      const key = `${status.type}_${status.addedByPlayerId}`
      if (!acc[key]) {
        acc[key] = { type: status.type, playerId: status.addedByPlayerId, count: 0 }
      }
      acc[key].count++
      return acc
    }, {} as Record<string, { type: string, playerId: number, count: number }>)

    return groups
  }, [card.statuses, card.id])

  // Memoized values (must be called before any conditional returns)
  const ownerColorData = useMemo(() => {
    // Priority: playerColor (from PlayerPanel) > playerColorMap lookup by card.ownerId
    // This ensures guest/remote player cards get correct color from their player.color
    let colorData: typeof PLAYER_COLORS[keyof typeof PLAYER_COLORS] | null = null

    // First try: playerColor from props (direct from PlayerPanel)
    if (playerColor) {
      colorData = PLAYER_COLORS[playerColor]
    }

    // Second try: lookup by card.ownerId in playerColorMap
    if (!colorData && card.ownerId) {
      const ownerColorName = playerColorMap.get(card.ownerId)
      if (ownerColorName) {
        colorData = PLAYER_COLORS[ownerColorName]
      } else {
        // Debug: log when ownerId exists but not in playerColorMap
      }
    }

    // Debug: log if colorData is still null (for troubleshooting)
    // This should rarely happen as all players should have colors assigned
    return colorData
  }, [card.ownerId, playerColorMap, playerColor])

  const uniqueStatusGroups = useMemo(() => {
    return Object.values(statusGroups).sort((a, b) => {
      // Priority: LastPlayed > Support > others (alphabetically)
      const priorityOrder = ['LastPlayed', 'Support']
      const aPriority = priorityOrder.indexOf(a.type)
      const bPriority = priorityOrder.indexOf(b.type)

      // If both have priority (not -1), sort by priority
      if (aPriority !== -1 && bPriority !== -1) {
        return aPriority - bPriority
      }
      // If only one has priority, it comes first
      if (aPriority !== -1) {
        return -1
      }
      if (bPriority !== -1) {
        return 1
      }

      // No priority for either - sort alphabetically by type, then by playerId
      if (a.type !== b.type) {
        return a.type.localeCompare(b.type)
      }
      return a.playerId - b.playerId
    })
  }, [statusGroups])

  const { currentPower, powerTextColor, isCommandCard, powerCircleSize, powerFontSize } = useMemo(() => {
    const modifier = (card.powerModifier || 0) + (card.bonusPower || 0)
    const power = Math.max(0, card.power + modifier)
    let textColor = 'text-white'
    if (modifier > 0) {
      textColor = 'text-green-400'
    } else if (modifier < 0) {
      textColor = 'text-red-500'
    }
    // Check if this is a Command card
    const isCommand = card.deck === 'Command' || card.types?.includes('Command') || card.faction === 'Command'

    // Power display sizes: normal (left panel + board) or small (right panel)
    const isSmallPowerDisplay = smallPowerDisplay || false // Use smallPowerDisplay prop if provided, otherwise default to false
    const circleSize = isSmallPowerDisplay ? 27 : 35 // 35 VU normal, 27 VU small (right panel)
    const fontSize = isSmallPowerDisplay ? 17 : 20 // 20 VU normal, 17 VU small (right panel)

    return { currentPower: power, powerTextColor: textColor, isCommandCard: isCommand, powerCircleSize: circleSize, powerFontSize: fontSize }
  }, [card.power, card.powerModifier, card.bonusPower, card.deck, card.types, card.faction, smallPowerDisplay])

  const showTooltip = useMemo(() =>
    tooltipVisible && isFaceUp && !disableTooltip && (tooltipPos.x > 0 && tooltipPos.y > 0),
  [tooltipVisible, isFaceUp, disableTooltip, tooltipPos.x, tooltipPos.y],
  )

  // Special rendering for 'counter' type cards.
  if (card.deck === 'counter') {
    return (
      <div
        title={displayCard.name}
        className={`w-full h-full ${card.color} shadow-md`}
        style={{ clipPath: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)' }}
      ></div>
    )
  }

  const powerPositionClass = 'bottom-[3%] right-[3%]'

  return (
    <>
      {!isFaceUp ? (
        // --- CARD BACK ---
        (() => {
          // CRITICAL: Card back color MUST come from playerColorMap by card.ownerId
          // This ensures guest player cards have correct colored back for all viewers
          let backColorClass = 'bg-gray-600'  // Default fallback
          let borderColorClass = 'border-blue-300'  // Default border

          // PRIMARY: Get color from playerColorMap by card owner ID
          if (card.ownerId) {
            const ownerColorName = playerColorMap.get(card.ownerId)
            if (ownerColorName) {
              const colorData = PLAYER_COLORS[ownerColorName]
              if (colorData) {
                backColorClass = colorData.bg
                borderColorClass = colorData.border
              } else {
                // DEBUG: ownerColorName exists but not in PLAYER_COLORS
                backColorClass = 'bg-red-600'  // RED means ownerColorName not found!
              }
            } else {
              // DEBUG: ownerId not in playerColorMap
              backColorClass = 'bg-blue-600'  // BLUE means playerColorMap doesn't have ownerId!
            }
          }

          // FALLBACK: Try ownerColorData if playerColorMap didn't work
          if (backColorClass === 'bg-gray-600' && ownerColorData) {
            backColorClass = ownerColorData.bg
            borderColorClass = ownerColorData.border
          }

          const lastPlayedGroup = uniqueStatusGroups.find(g => g.type === 'LastPlayed')
          const revealedGroups = uniqueStatusGroups.filter(g => g.type === 'Revealed')

          return (
            <div
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              className={`relative w-full h-full ${backColorClass} rounded-vu-5 shadow-md border-2 ${borderColorClass} flex-shrink-0 ${shouldHighlight ? 'z-10' : ''}`}
            >
              {revealedGroups.length > 0 && (
                <div className="absolute top-vu-effect-sm left-vu-effect-sm flex flex-wrap gap-vu-min pointer-events-none">
                  {revealedGroups.map(group => (
                    <StatusIcon key={group.type + '_' + group.playerId} type={group.type} playerId={group.playerId} count={group.count} refreshVersion={imageRefreshVersion} playerColorMap={playerColorMap} smallStatusIcons={smallStatusIcons} isNegative={true} />
                  ))}
                </div>
              )}
              {lastPlayedGroup && (
                <div className="absolute bottom-vu-effect-sm left-vu-effect-sm pointer-events-none">
                  <StatusIcon type={lastPlayedGroup.type} playerId={lastPlayedGroup.playerId} count={lastPlayedGroup.count} refreshVersion={imageRefreshVersion} playerColorMap={playerColorMap} smallStatusIcons={smallStatusIcons} isNegative={false} />
                </div>
              )}
            </div>
          )
        })()
      ) : (
        // --- CARD FACE ---
        (() => {
          // Theme color priority: owner's player color > card color > deck theme > dark gray (visible)
          // ownerColorData is null if card.ownerId is missing or not found in playerColorMap
          // IMPORTANT: Always ensure themeColor is set to avoid invisible borders
          const themeColor = ownerColorData
            ? ownerColorData.border
            : (DECK_THEMES[card.deck]?.color || 'border-gray-600')

          // Background priority:
          // 1. Token cards use their color
          // 2. Placeholder cards (with card.color set) use player's color for fill
          // 3. Regular cards use bg-card-face
          const cardBg = card.deck === DeckType.Tokens
            ? (typeof card.color === 'string' ? card.color : 'bg-gray-500')
            : (typeof card.color === 'string' ? card.color : 'bg-card-face')

          const textColor = card.deck === DeckType.Tokens ? 'text-black' : 'text-black'

          const positiveStatusTypesList = ['Support', 'Shield']
          const positiveGroups = uniqueStatusGroups.filter(g => positiveStatusTypesList.includes(g.type))
          const negativeGroups = uniqueStatusGroups.filter(g => !positiveStatusTypesList.includes(g.type) && g.type !== 'LastPlayed')
          const lastPlayedGroup = uniqueStatusGroups.find(g => g.type === 'LastPlayed')

          const combinedPositiveGroups = lastPlayedGroup
            ? [lastPlayedGroup, ...positiveGroups]
            : positiveGroups

          // Border: Always use base width, white border for ready ability is now at cell level
          const borderClass = 'border-[calc(4*var(--vu-base))]'

          // Inner glow effect with owner's color when ready
          // Note: White border is now applied at cell level in GameBoard to avoid overflow clipping
          const ownerColorName = card.ownerId ? playerColorMap.get(card.ownerId) : null
          // Fallback to white/blue glow if color is missing from PLAYER_COLOR_RGB
          const colorRgb = ownerColorName ? (PLAYER_COLOR_RGB[ownerColorName] || { r: 255, g: 255, b: 255 }) : null
          // Glow color 30% brighter than owner color, 50% transparent
          const glowRgb = colorRgb ? {
            r: Math.min(255, Math.round(colorRgb.r * 1.3)),
            g: Math.min(255, Math.round(colorRgb.g * 1.3)),
            b: Math.min(255, Math.round(colorRgb.b * 1.3)),
          } : null
          // Inner glow and radial gradient overlay (no white border here)
          const innerGlowStyle = shouldHighlight && colorRgb ? {
            background: `radial-gradient(circle at center, transparent 20%, rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.5) 100%)`,
            boxShadow: glowRgb ? `inset 0 0 12px rgba(${glowRgb.r}, ${glowRgb.g}, ${glowRgb.b}, 0.5)` : undefined,
          } : {}

          // Semi-transparent colored filter overlay for cards with ready abilities
          // Gradient from center (0% opacity) to edges (50% opacity), 35% brighter than owner color
          const readyAbilityOverlay = shouldHighlight && colorRgb ? (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(circle at center, transparent 37.5%, rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.5) 100%)`,
                mixBlendMode: 'normal',
                filter: 'brightness(1.35)',
              }}
            />
          ) : null

          return (
            <div
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onClick={handleCardClick}
              style={innerGlowStyle}
              className={`relative w-full h-full ${cardBg} rounded-vu-5 shadow-md ${borderClass} ${themeColor} ${textColor} select-none overflow-hidden ${shouldHighlight ? 'z-10' : ''}`}
            >
              {currentImageSrc ? (
                <>
                  {imageLoadState === 'failed' ? (
                    // Show fallback visual when image failed to load
                    <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center p-2">
                      <div className="text-center">
                        <div className="text-xs text-gray-400 mb-1">{card.deck}</div>
                        <span className="text-center text-sm font-bold text-white break-words">
                          {displayCard.name}
                        </span>
                        {card.power > 0 && !hidePower && (
                          <div className="text-lg font-bold text-white mt-1">{card.power}</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <img
                      key={card.id} // Stable key to prevent React from recreating img element
                      src={currentImageSrc}
                      onLoad={handleImageLoad}
                      onError={handleImageError}
                      alt={displayCard.name}
                      className={`absolute inset-0 w-full h-full object-cover ${
                        disableImageTransition ? 'opacity-100' : (imageLoadState === 'loading' ? 'opacity-0' : 'opacity-100')
                      }`}
                      style={disableImageTransition ? undefined : { transition: 'opacity 0.15s ease-out' }}
                    />
                  )}
                  {readyAbilityOverlay}
                  {isHero && <div className={`absolute inset-0 hero-foil-overlay ${isShining ? 'animating' : ''}`}></div>}
                </>
              ) : (
                <div className="w-full h-full p-1 flex items-center justify-center">
                  <span className="text-center text-sm font-bold">
                    {displayCard.name}
                  </span>
                </div>
              )}

              {/* Deck Builder Badges: Cost (blue), Loyalty (purple), Discipline (red) */}
              {showDeckBuilderBadges && isFaceUp && (
                <div className="absolute top-1 left-1 flex flex-row gap-1 z-10 pointer-events-none">
                  {(card.cost ?? 2) > 0 && (
                    <div className="bg-blue-600 border border-blue-400 rounded w-6 h-6 flex items-center justify-center shadow-md" title={`Cost: ${card.cost ?? 2}`}>
                      <span className="text-white font-black text-xs" style={{ textShadow: '0 0 2px black' }}>{card.cost ?? 2}</span>
                    </div>
                  )}
                  {(card.loyalty ?? 2) > 0 && (
                    <div className="bg-purple-600 border border-purple-400 rounded w-6 h-6 flex items-center justify-center shadow-md" title={`Loyalty: ${card.loyalty ?? 2}`}>
                      <span className="text-white font-black text-xs" style={{ textShadow: '0 0 2px black' }}>{card.loyalty ?? 2}</span>
                    </div>
                  )}
                  {(card.discipline ?? 2) > 0 && (
                    <div className="bg-red-600 border border-red-400 rounded w-6 h-6 flex items-center justify-center shadow-md" title={`Discipline: ${card.discipline ?? 2}`}>
                      <span className="text-white font-black text-xs" style={{ textShadow: '0 0 2px black' }}>{card.discipline ?? 2}</span>
                    </div>
                  )}
                </div>
              )}

              {uniqueStatusGroups.length > 0 && (
                <>
                  <div className="absolute top-vu-effect-sm left-vu-effect-sm right-vu-effect-sm flex flex-row-reverse flex-wrap justify-start items-start z-10 pointer-events-none">
                    {negativeGroups.map((group) => (
                      <StatusIcon key={`${group.type}_${group.playerId}`} type={group.type} playerId={group.playerId} count={group.count} refreshVersion={imageRefreshVersion} playerColorMap={playerColorMap} smallStatusIcons={smallStatusIcons} isNegative={true} />
                    ))}
                  </div>

                  <div className="absolute bottom-vu-effect-sm left-vu-effect-sm right-vu-md flex flex-row flex-wrap-reverse content-end items-end z-10 pointer-events-none" style={{ maxWidth: 'calc(100% - var(--vu-btn-lg) - var(--vu-gap-base))' }}>
                    {combinedPositiveGroups.map((group) => (
                      <StatusIcon key={`${group.type}_${group.playerId}`} type={group.type} playerId={group.playerId} count={group.count} refreshVersion={imageRefreshVersion} playerColorMap={playerColorMap} smallStatusIcons={smallStatusIcons} isNegative={false} />
                    ))}
                  </div>
                </>
              )}

              {isCommandCard && showCommandPlayButton && !hidePower ? (
                // Command card: Show Play button (rounded square with triangle) - ONLY for local player
                <div
                  className={`absolute ${powerPositionClass} rounded-vu-5 ${ownerColorData ? ownerColorData.bg : 'bg-gray-600'} border-vu-base border-white flex items-center justify-center z-20 shadow-md cursor-pointer hover:scale-110 transition-transform`}
                  style={{ width: `${getVuSize(powerCircleSize)}px`, height: `${getVuSize(powerCircleSize)}px` }}
                  onClick={(e) => {
                    e.stopPropagation() // Prevent card click
                    if (onCommandPlayClick) {
                      onCommandPlayClick(card)
                    }
                  }}
                  title="Play this command"
                >
                  {/* Play triangle icon */}
                  <svg
                    width={powerFontSize >= 14 ? "14" : "10"}
                    height={powerFontSize >= 14 ? "14" : "10"}
                    viewBox="0 0 24 24"
                    fill="white"
                    style={{ marginLeft: '1px' }} // Visual offset to center the triangle
                  >
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                </div>
              ) : card.power > 0 && !hidePower ? (
                // Regular card: Show power circle
                <div
                  className={`absolute ${powerPositionClass} rounded-full ${ownerColorData ? ownerColorData.bg : 'bg-gray-600'} border-vu-base border-white flex items-center justify-center z-20 shadow-md`}
                  style={{ width: `${getVuSize(powerCircleSize)}px`, height: `${getVuSize(powerCircleSize)}px` }}
                >
                  <span className={`${powerTextColor} font-bold leading-none`} style={{ fontSize: `${getVuSize(powerFontSize)}px`, textShadow: '0 0 2px black' }}>{currentPower}</span>
                </div>
              ) : null}
            </div>
          )
        })()
      )}

      {showTooltip && (
        <Tooltip x={tooltipPos.x} y={tooltipPos.y}>
          <CardTooltipContent card={displayCard} />
        </Tooltip>
      )}
    </>
  )
})

// Custom comparison function to prevent unnecessary rerenders
const arePropsEqual = (prevProps: CardCoreProps & CardInteractionProps, nextProps: CardCoreProps & CardInteractionProps) => {
  // Core props that affect rendering
  if (prevProps.card.id !== nextProps.card.id) {
    return false
  }
  if (prevProps.isFaceUp !== nextProps.isFaceUp) {
    return false
  }

  // Card properties that affect rendering
  if (prevProps.card.imageUrl !== nextProps.card.imageUrl) {
    return false
  }
  if (prevProps.card.fallbackImage !== nextProps.card.fallbackImage) {
    return false
  }
  if (prevProps.card.name !== nextProps.card.name) {
    return false
  }
  if (prevProps.card.deck !== nextProps.card.deck) {
    return false
  }
  if (prevProps.card.color !== nextProps.card.color) {
    return false
  }
  if (prevProps.card.baseId !== nextProps.card.baseId) {
    return false
  }

  // Check types array (shallow comparison)
  const prevTypes = prevProps.card.types || []
  const nextTypes = nextProps.card.types || []
  if (prevTypes.length !== nextTypes.length) {
    return false
  }
  for (let i = 0; i < prevTypes.length; i++) {
    if (prevTypes[i] !== nextTypes[i]) {
      return false
    }
  }
  if (prevProps.imageRefreshVersion !== nextProps.imageRefreshVersion) {
    return false
  }
  if (prevProps.smallStatusIcons !== nextProps.smallStatusIcons) {
    return false
  }
  if (prevProps.extraPowerSpacing !== nextProps.extraPowerSpacing) {
    return false
  }
  if (prevProps.hidePower !== nextProps.hidePower) {
    return false
  }
  if (prevProps.loadPriority !== nextProps.loadPriority) {
    return false
  }
  if (prevProps.disableImageTransition !== nextProps.disableImageTransition) {
    return false
  }
  if (prevProps.showCommandPlayButton !== nextProps.showCommandPlayButton) {
    return false
  }
  if (prevProps.showDeckBuilderBadges !== nextProps.showDeckBuilderBadges) {
    return false
  }

  // Interaction props - only check if they actually affect the visual state
  if (prevProps.disableTooltip !== nextProps.disableTooltip) {
    return false
  }
  if (prevProps.disableActiveHighlights !== nextProps.disableActiveHighlights) {
    return false
  }
  if (prevProps.preserveDeployAbilities !== nextProps.preserveDeployAbilities) {
    return false
  }

  // Context props that affect ability activation and highlighting
  if (prevProps.activePhaseIndex !== nextProps.activePhaseIndex) {
    return false
  }
  if (prevProps.activePlayerId !== nextProps.activePlayerId) {
    return false
  }
  if (prevProps.localPlayerId !== nextProps.localPlayerId) {
    return false
  }
  if (prevProps.activeAbilitySourceCoords?.row !== nextProps.activeAbilitySourceCoords?.row ||
      prevProps.activeAbilitySourceCoords?.col !== nextProps.activeAbilitySourceCoords?.col) {
    return false
  }
  if (prevProps.boardCoords?.row !== nextProps.boardCoords?.row ||
      prevProps.boardCoords?.col !== nextProps.boardCoords?.col) {
    return false
  }
  // Check abilityCheckKey for rechecking ability readiness
  if (prevProps.abilityCheckKey !== nextProps.abilityCheckKey) {
    return false
  }
  // Check targetingMode - affects ready status visibility and highlighting
  if (prevProps.targetingMode !== nextProps.targetingMode) {
    return false
  }

  // Performance critical: deep comparison only for status and power changes
  // IMPORTANT: Compare statuses as sets, not arrays, because recalculateBoardStatuses
  // may reorder statuses without actually changing them
  const prevStatuses = prevProps.card.statuses || []
  const nextStatuses = nextProps.card.statuses || []
  if (prevStatuses.length !== nextStatuses.length) {
    return false
  }

  // Check if statuses are the same (order-independent comparison)
  // Create a map of {type_addedByPlayerId} for efficient comparison
  const prevStatusMap = new Map<string, boolean>()
  for (const s of prevStatuses) {
    prevStatusMap.set(`${s.type}_${s.addedByPlayerId}`, true)
  }
  for (const s of nextStatuses) {
    const key = `${s.type}_${s.addedByPlayerId}`
    if (!prevStatusMap.has(key)) {
      return false  // New or different status
    }
    prevStatusMap.delete(key)
  }
  if (prevStatusMap.size > 0) {
    return false  // Some statuses were removed
  }

  // Check power-related changes
  if (prevProps.card.power !== nextProps.card.power) {
    return false
  }
  if (prevProps.card.powerModifier !== nextProps.card.powerModifier) {
    return false
  }
  if (prevProps.card.bonusPower !== nextProps.card.bonusPower) {
    return false
  }

  // Check ownerId changes (including to/from undefined)
  if (prevProps.card.ownerId !== nextProps.card.ownerId) {
    return false
  }

  // Check player color map changes if both have owners
  if (prevProps.card.ownerId && nextProps.card.ownerId && prevProps.playerColorMap.get(prevProps.card.ownerId) !== nextProps.playerColorMap.get(nextProps.card.ownerId)) {
    return false
  }

  // Check direct playerColor prop (used in PlayerPanel)
  if (prevProps.playerColor !== nextProps.playerColor) {
    return false
  }
  // Check smallPowerDisplay prop
  if (prevProps.smallPowerDisplay !== nextProps.smallPowerDisplay) {
    return false
  }

  return true
}

const Card = memo(CardCore, arePropsEqual)

export { Card }
