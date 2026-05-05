import React, { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Card as CardType, PlayerColor, Player, ContextMenuItem, DragItem } from '@/types'
import { Card } from './Card'
import { ContextMenu } from './ContextMenu'
import { useLanguage } from '@/contexts/LanguageContext'
import { isCloudinaryUrl, getThumbnailImageUrl, addCacheBust } from '@/utils/imageOptimization'

/**
 * TopDeckCard - Optimized card component for TopDeckView
 * Uses progressive loading: preview (100px) for instant preview -> optimal (150px) for display
 * The preview stays visible until target image is fully loaded (no white flash)
 */
const TopDeckCard: React.FC<{
  card: CardType;
  playerColorMap: Map<number, PlayerColor>;
  localPlayerId: number | null;
  imageRefreshVersion?: number;
}> = memo(({ card, playerColorMap, localPlayerId, imageRefreshVersion }) => {
  // Target size: 128x128 display, so 150px gives some margin
  const TARGET_SIZE = 150
  const PREVIEW_SIZE = 100  // Larger preview for better quality in modal

  // Track which URL to display - only update when target is loaded
  const [displayUrl, setDisplayUrl] = useState<string>(() => {
    // Initialize with original URL or preview
    if (!card.imageUrl) {
      return card.imageUrl
    }
    const previewUrl = isCloudinaryUrl(card.imageUrl)
      ? getThumbnailImageUrl(card.imageUrl, PREVIEW_SIZE)
      : card.imageUrl
    return addCacheBust(previewUrl, imageRefreshVersion)
  })

  useEffect(() => {
    if (!card.imageUrl) {
      return
    }

    if (!isCloudinaryUrl(card.imageUrl)) {
      // Non-Cloudinary images - use as-is with cache bust
      setDisplayUrl(addCacheBust(card.imageUrl, imageRefreshVersion))
      return
    }

    // Get optimized URLs
    const previewUrl = getThumbnailImageUrl(card.imageUrl, PREVIEW_SIZE)
    const targetUrl = getThumbnailImageUrl(card.imageUrl, TARGET_SIZE)

    // Add cache-busting parameter
    const previewWithVersion = addCacheBust(previewUrl, imageRefreshVersion)
    const targetWithVersion = addCacheBust(targetUrl, imageRefreshVersion)

    // Show preview immediately
    setDisplayUrl(previewWithVersion)

    // Load target image in background, only show when loaded
    const img = new Image()

    const handleLoad = () => {
      setDisplayUrl(targetWithVersion)
    }

    img.onload = handleLoad
    img.onerror = () => {
      // If target fails to load, keep preview
    }

    // Set src first, then check if already loaded
    img.src = targetWithVersion

    // Check if image is already cached/loaded (must be AFTER setting src)
    if (img.complete && img.naturalWidth > 0) {
      // Image already loaded (from cache)
      handleLoad()
    }
  }, [card.imageUrl, card.id, imageRefreshVersion])

  // Create optimized card with current image source
  const optimizedCard = useMemo(() => ({
    ...card,
    imageUrl: displayUrl,
  }), [card, displayUrl])

  return (
    <Card
      card={optimizedCard}
      isFaceUp={true}
      playerColorMap={playerColorMap}
      localPlayerId={localPlayerId}
      loadPriority="high"
      // Don't pass imageRefreshVersion - URL already has version
    />
  )
})

interface TopDeckViewProps {
    isOpen: boolean;
    player: Player;
    onClose: () => void;
    onReorder: (playerId: number, newTopCards: CardType[]) => void;
    onMoveToBottom: (cardIndex: number) => void;
    onMoveToHand: (cardIndex: number) => void;
    onMoveToDiscard: (cardIndex: number) => void;
    onPlayCard: (cardIndex: number) => void;
    onViewCard: (card: CardType) => void;
    setDraggedItem?: (item: DragItem | null) => void;
    playerColorMap: Map<number, PlayerColor>;
    localPlayerId: number | null;
    imageRefreshVersion?: number;
    initialCount?: number;
    isLocked?: boolean;
}

const TopDeckView: React.FC<TopDeckViewProps> = memo(({
  isOpen,
  player,
  onClose,
  onReorder,
  onMoveToBottom,
  onMoveToHand,
  onMoveToDiscard,
  onPlayCard,
  onViewCard,
  setDraggedItem,
  playerColorMap,
  localPlayerId,
  imageRefreshVersion,
  initialCount = 3,
  isLocked = false,
}) => {
  const { t } = useLanguage()
  const [viewCount, setViewCount] = useState(initialCount)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, cardIndex: number } | null>(null)
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [localVisibleCards, setLocalVisibleCards] = useState<CardType[]>([])
  const [droppedOutside, setDroppedOutside] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const draggedCardRef = useRef<CardType | null>(null)

  useEffect(() => {
    if (isOpen) {
      setViewCount(initialCount)
      setDraggedCardId(null)
      setDraggedIndex(null)
      setDragOverIndex(null)
      setDroppedOutside(false)
      draggedCardRef.current = null
    }
  }, [isOpen, initialCount])

  // Update local visible cards when player deck or view count changes
  // Show TOP cards from deck (beginning of array), in the same order
  // deck[0] = top card (drawn first), deck[length-1] = bottom card
  useEffect(() => {
    // Take first N cards from deck (the top of deck)
    const cards = player.deck.slice(0, Math.min(viewCount, player.deck.length))
    setLocalVisibleCards(cards)
  }, [player.deck, viewCount])

  // Determine which cards to display (with reordering applied if drag is active)
  const displayCards = useMemo(() => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const reordered = [...localVisibleCards]
      const [movedCard] = reordered.splice(draggedIndex, 1)
      reordered.splice(dragOverIndex, 0, movedCard)
      return reordered
    }
    return localVisibleCards
  }, [localVisibleCards, draggedIndex, dragOverIndex])

  const handleContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, cardIndex: index })
  }, [])

  const handleCloseMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleIncrement = useCallback(() => {
    if (!isLocked && viewCount < player.deck.length) {
      setViewCount(prev => prev + 1)
    }
  }, [isLocked, viewCount, player.deck.length])

  const handleDecrement = useCallback(() => {
    if (!isLocked && viewCount > 0) {
      setViewCount(prev => prev - 1)
    }
  }, [isLocked, viewCount])

  const handleDragStart = useCallback((card: CardType, index: number) => {
    setDraggedIndex(index)
    setDraggedCardId(card.id)
    draggedCardRef.current = card
    setDroppedOutside(false)
    // Dispatch event to hide tooltips globally
    window.dispatchEvent(new CustomEvent('cardDragStart'))
    document.body.setAttribute('data-dragging-card', 'true')
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }, [dragOverIndex])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!draggedCardRef.current || !modalRef.current) {return}

    const rect = modalRef.current.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY

    // If cursor is outside modal bounds, set up draggedItem for external drop
    // Do NOT close the modal - only clicking outside should close it
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      const card = draggedCardRef.current
      const index = draggedIndex ?? 0

      if (setDraggedItem) {
        setDraggedItem({
          card,
          source: 'deck',
          playerId: player.id,
          cardIndex: index,
        })
      }

      setDroppedOutside(true)
      // Note: Modal stays open so player can continue working with top deck
    }
  }, [draggedIndex, player.id, setDraggedItem])

  const handleDragEnd = useCallback(() => {
    // Dispatch event to show tooltips again
    window.dispatchEvent(new CustomEvent('cardDragEnd'))
    document.body.removeAttribute('data-dragging-card')

    // Only cleanup if we didn't drop outside (outside case is handled by dragLeave)
    if (!droppedOutside) {
      setDraggedCardId(null)
      setDraggedIndex(null)
      setDragOverIndex(null)
    }
    draggedCardRef.current = null
  }, [droppedOutside])

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverIndex(null)

    // If drop happened but we already marked as outside, ignore
    if (droppedOutside) {return}

    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      setDraggedCardId(null)
      return
    }

    // Reorder the visible cards
    const newCards = [...localVisibleCards]
    const [movedCard] = newCards.splice(draggedIndex, 1)
    newCards.splice(targetIndex, 0, movedCard)

    setLocalVisibleCards(newCards)
    onReorder(player.id, newCards)
    setDraggedIndex(null)
    setDraggedCardId(null)
  }, [draggedIndex, localVisibleCards, onReorder, player.id, droppedOutside])

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu) {
      return []
    }

    return [
      { label: t('view'), isBold: true, onClick: () => onViewCard(displayCards[contextMenu.cardIndex]) },
      { label: t('play'), disabled: isLocked, onClick: () => {
        onPlayCard(contextMenu.cardIndex)
      } },
      { label: t('moveToBottom'), onClick: () => {
        onMoveToBottom(contextMenu.cardIndex)
        // Decrease view count by 1 after moving card to bottom
        if (viewCount > 0) {
          setViewCount(prev => Math.max(0, prev - 1))
        }
      } },
      { isDivider: true },
      { label: t('toHand'), disabled: isLocked, onClick: () => {
        onMoveToHand(contextMenu.cardIndex)
      } },
      { label: t('toDiscard'), disabled: isLocked, onClick: () => {
        onMoveToDiscard(contextMenu.cardIndex)
      } },
    ]
  }, [displayCards, isLocked, onViewCard, onPlayCard, onMoveToBottom, onMoveToHand, onMoveToDiscard, contextMenu, t, viewCount])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[250] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        onDragLeave={handleDragLeave}
        className="bg-gray-800 rounded-vu-5 p-6 shadow-xl w-auto max-w-5xl border border-gray-600 relative flex flex-col items-center"
        onClick={e => e.stopPropagation()}
      >

        <h2 className="text-2xl font-bold text-white mb-2 text-center">{t('topDeckView')}</h2>

        <div className="flex items-center gap-4 mb-4 bg-gray-900 p-2 rounded-full border border-gray-700">
          <button
            onClick={handleDecrement}
            disabled={isLocked || viewCount <= 0}
            className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-red-600 rounded-full text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
                        -
          </button>
          <span className="text-xl font-mono font-bold text-indigo-400 w-8 text-center">{viewCount}</span>
          <button
            onClick={handleIncrement}
            disabled={isLocked || viewCount >= player.deck.length}
            className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-green-600 rounded-full text-white font-bold disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
                        +
          </button>
        </div>

        <p className="text-gray-400 text-xs mb-6 text-center">
          {t('dragToReorder')} {t('rightClickForActions')}
        </p>

        <div className="flex justify-center flex-wrap gap-4 mb-8 min-h-[140px] px-4">
          {displayCards.length === 0 ? (
            <p className="text-gray-500 italic">{t('deckEmpty')}</p>
          ) : (
            displayCards.map((card, index) => {
              // Find original index in localVisibleCards (for drag-drop)
              const originalIndex = localVisibleCards.findIndex(c => c.id === card.id)
              // Find actual index in player.deck (for context menu actions)
              const deckIndex = player.deck.findIndex(c => c.id === card.id)
              const isDragTarget = dragOverIndex === index && draggedIndex !== index
              const isDragging = draggedCardId === card.id

              return (
                <div
                  key={card.id || index}
                  draggable={true}
                  onDragStart={() => handleDragStart(card, originalIndex)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop(e, index)}
                  onContextMenu={(e) => handleContextMenu(e, deckIndex)}
                  className="w-32 h-32 relative rounded-vu-5 flex items-center justify-center cursor-grab active:cursor-grabbing hover:scale-105 transition-transform"
                  style={{
                    opacity: isDragging ? 0.5 : 1,
                    zIndex: isDragTarget ? 10 : 0,
                    transform: isDragTarget ? 'scale(1.05)' : (isDragging ? 'scale(0.95)' : 'scale(1)'),
                  }}
                >
                  <div className="absolute -top-3 -left-2 z-20 bg-gray-900 text-gray-400 text-xs font-bold px-2 py-0.5 rounded-full border border-gray-600 shadow-md">
                                        #{index + 1}
                  </div>

                  <div className="w-full h-full flex items-center justify-center">
                    <TopDeckCard
                      card={card}
                      playerColorMap={playerColorMap}
                      localPlayerId={localPlayerId}
                      imageRefreshVersion={imageRefreshVersion}
                    />
                  </div>

                  {/* Move to bottom button - positioned at bottom center */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onMoveToBottom(deckIndex)
                      // Decrease view count by 1 after moving card to bottom (same as context menu)
                      if (viewCount > 0) {
                        setViewCount(prev => Math.max(0, prev - 1))
                      }
                    }}
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 border-2 border-white shadow-lg flex items-center justify-center z-30 transition-colors"
                    title={t('moveToBottom')}
                  >
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </button>
                </div>
              )
            })
          )}
        </div>

        <p className="text-gray-400 text-xs mb-4 text-center">
          {t('dragOutsideToMove')}
        </p>

        <div className="flex justify-center">
          <button
            onClick={onClose}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-8 rounded shadow-lg transition-colors"
          >
            {t('done')}
          </button>
        </div>
      </div>

      {contextMenu && (
        <div className="fixed inset-0 z-[255]" onClick={handleCloseMenu} />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseMenu}
          items={contextMenuItems}
        />
      )}
    </div>
  )
})

export { TopDeckView }
