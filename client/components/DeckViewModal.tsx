import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import type { Player, Card as CardType, DragItem, PlayerColor, CursorStackState } from '@/types'
import { Card } from './Card'
import { useLanguage } from '@/contexts/LanguageContext'
import { isCloudinaryUrl, getThumbnailImageUrl, addCacheBust } from '@/utils/imageOptimization'

/**
 * DeckViewCard - Optimized card component for DeckViewModal
 * Uses progressive loading: tiny (50px) for instant preview -> optimal (130px) for display
 * The preview stays visible until target image is fully loaded (no white flash)
 */
const DeckViewCard: React.FC<{
  card: CardType;
  playerColorMap: Map<number, PlayerColor>;
  localPlayerId: number | null;
  imageRefreshVersion?: number;
  disableActiveHighlights?: boolean;
}> = memo(({ card, playerColorMap, localPlayerId, imageRefreshVersion, disableActiveHighlights }) => {
  // Target size: card-small (112px) display with margin, increased 1.5x for Deck modal
  const TARGET_SIZE = 130 * 1.5
  const PREVIEW_SIZE = 100 * 1.5  // Larger preview for better quality in modal

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
      disableActiveHighlights={disableActiveHighlights}
      // Don't pass imageRefreshVersion - URL already has version
    />
  )
})

interface DeckViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  player: Player;
  cards: CardType[];
  setDraggedItem: (item: DragItem | null) => void;
  onCardContextMenu?: (e: React.MouseEvent, cardIndex: number) => void;
  onCardDoubleClick?: (cardIndex: number) => void;
  onCardClick?: (cardIndex: number) => void;
  onReorder?: (playerId: number, newCards: CardType[]) => void; // Callback for reordering cards
  canInteract: boolean;
  isDeckView?: boolean; // If true, the source of dragged cards is 'deck' instead of 'discard'.
  playerColorMap: Map<number, PlayerColor>;
  localPlayerId: number | null;
  imageRefreshVersion?: number;
  highlightFilter?: (card: CardType) => boolean; // Optional filter to highlight certain cards (e.g. Units)
  cursorStack?: CursorStackState | null;
  disableDrag?: boolean; // If true, disable dragging cards (e.g., when opened for card pick/search ability)
}

export const DeckViewModal: React.FC<DeckViewModalProps> = ({
  isOpen,
  onClose,
  title,
  player,
  cards,
  setDraggedItem,
  onCardContextMenu,
  onCardDoubleClick,
  onCardClick,
  onReorder,
  canInteract,
  isDeckView = false,
  playerColorMap,
  localPlayerId,
  imageRefreshVersion,
  highlightFilter,
  cursorStack = null,
  disableDrag = false,
}) => {
  const { t } = useLanguage()
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [localCards, setLocalCards] = useState<CardType[]>(cards)
  const [droppedOutside, setDroppedOutside] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const draggedCardRef = useRef<CardType | null>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setDraggedCardId(null)
      setDraggedIndex(null)
      setDragOverIndex(null)
      setLocalCards(cards)
      setDroppedOutside(false)
      setIsDragging(false)
      draggedCardRef.current = null
    }
  }, [isOpen, cards])

  // Set data attribute to hide tooltips during drag
  useEffect(() => {
    if (isDragging) {
      document.body.setAttribute('data-dragging-card', 'true')
    } else {
      document.body.removeAttribute('data-dragging-card')
    }
    return () => {
      document.body.removeAttribute('data-dragging-card')
    }
  }, [isDragging])

  // Track drag on document level for more reliable outside detection
  useEffect(() => {
    if (!isDragging || !isOpen || droppedOutside) {
      return
    }

    const handleDocumentDragOver = (e: DragEvent) => {
      if (!modalRef.current || droppedOutside) {
        return
      }

      const rect = modalRef.current.getBoundingClientRect()
      const x = e.clientX
      const y = e.clientY

      // If cursor is outside modal bounds, close modal and set up draggedItem
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        const card = draggedCardRef.current
        if (!card) {
          return
        }
        const index = draggedIndex ?? 0

        setDraggedItem({
          card,
          source: isDeckView ? 'deck' : 'discard',
          playerId: player.id,
          cardIndex: index,
        })

        setDroppedOutside(true)
        setIsDragging(false)

        // Close modal immediately so drop can happen on underlying elements
        onClose()
      }
    }

    const handleDocumentDragEnd = () => {
      setIsDragging(false)
    }

    document.addEventListener('dragover', handleDocumentDragOver)
    document.addEventListener('dragend', handleDocumentDragEnd)

    return () => {
      document.removeEventListener('dragover', handleDocumentDragOver)
      document.removeEventListener('dragend', handleDocumentDragEnd)
    }
  }, [isDragging, isOpen, droppedOutside, draggedIndex, isDeckView, player.id, setDraggedItem, onClose])

  // Determine which cards to display (with reordering applied if drag is active)
  const displayCards = useMemo(() => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      const reordered = [...localCards]
      const [movedCard] = reordered.splice(draggedIndex, 1)
      reordered.splice(dragOverIndex, 0, movedCard)
      return reordered
    }
    return localCards
  }, [localCards, draggedIndex, dragOverIndex])

  const handleDragStart = useCallback((card: CardType, index: number) => {
    if (!canInteract || disableDrag) {
      return
    }

    setDraggedIndex(index)
    setDraggedCardId(card.id)
    draggedCardRef.current = card
    setDroppedOutside(false)
    setIsDragging(true)
  }, [canInteract, disableDrag])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }, [dragOverIndex])

  const handleDragEnd = useCallback(() => {
    // Only cleanup if we didn't drop outside (outside case is handled by document dragover)
    if (!droppedOutside) {
      setDraggedCardId(null)
      setDraggedIndex(null)
      setDragOverIndex(null)
    }
    setIsDragging(false)
    draggedCardRef.current = null
  }, [droppedOutside])

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    e.stopPropagation()

    // If drop happened but we already marked as outside, ignore
    if (droppedOutside) {
      return
    }

    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null)
      setDraggedCardId(null)
      setDragOverIndex(null)
      return
    }

    // Reorder the cards
    const newCards = [...localCards]
    const [movedCard] = newCards.splice(draggedIndex, 1)
    newCards.splice(targetIndex, 0, movedCard)

    setLocalCards(newCards)

    // Notify parent of reorder
    if (onReorder) {
      onReorder(player.id, newCards)
    }

    setDraggedIndex(null)
    setDraggedCardId(null)
    setDragOverIndex(null)
  }, [draggedIndex, localCards, onReorder, player.id, droppedOutside])

  const rowCount = Math.ceil(cards.length / 5)
  const shouldScroll = rowCount > 5
  const heightFor5Rows = 'calc(5 * var(--vu-card-small) + 4 * var(--vu-gap-md) + var(--vu-gap-lg))'

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 pointer-events-auto"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-800 rounded-vu-5 p-vu-lg shadow-xl flex flex-col"
        style={{ width: 'calc(var(--vu-modal-xl) * 1.5)', maxWidth: 'calc(var(--vu-modal-xl) * 1.5)' }}>
        <div className="flex justify-between items-center mb-vu-md flex-shrink-0">
          <div className="flex flex-col">
            <h2 className="text-vu-3xl font-bold">{title}</h2>
            {!disableDrag && (
              <p className="text-gray-400 text-vu-14">{t('dragCardsReorder')}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="py-vu-md px-vu-lg rounded-vu-2 font-bold transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
            style={{ fontSize: 'var(--vu-text-14)' }}
          >
            {t('close')}
          </button>
        </div>
        <div
          className={`bg-gray-900 rounded p-vu-md ${shouldScroll ? 'overflow-y-auto' : ''}`}
          style={shouldScroll ? { height: heightFor5Rows } : {}}
        >
          <div className="grid grid-cols-5 gap-vu-md">
            {displayCards.map((card, index) => {
              // Find original index for this card in case of reordering
              const originalIndex = localCards.findIndex(c => c.id === card.id)

              const isMatchingFilter = highlightFilter ? highlightFilter(card) : true
              const isHighlighted = isMatchingFilter
              const isBeingDragged = draggedCardId === card.id
              const isDragTarget = dragOverIndex === index && draggedIndex !== index
              const isInteractive = canInteract && isMatchingFilter && !cursorStack
              const canDragThisCard = isInteractive && !disableDrag

              const opacity = isBeingDragged ? 0.5 : (isMatchingFilter ? 1 : 1)
              const grayscaleFilter = isMatchingFilter ? 'none' : 'saturate(0.5)'
              const brightnessFilter = isMatchingFilter ? 'none' : 'brightness(0.4)'

              return (
                <div
                  key={`${card.id}-${index}`}
                  draggable={canDragThisCard}
                  onDragStart={() => handleDragStart(card, originalIndex)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop(e, index)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (onCardContextMenu) {
                      onCardContextMenu(e, originalIndex)
                    }
                  }}
                  onClick={() => isInteractive && onCardClick?.(originalIndex)}
                  onDoubleClick={() => isInteractive && onCardDoubleClick?.(originalIndex)}
                  data-interactive={isInteractive}
                  className={`relative transition-all rounded-vu-5
                    ${canDragThisCard ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}
                    ${isDragTarget ? 'scale-105 z-10' : ''}
                    ${isBeingDragged ? 'scale-95' : (!disableDrag ? 'hover:scale-105' : '')}
                  `}
                  style={{ width: 'calc(var(--vu-card-small) * 1.5)', height: 'calc(var(--vu-card-small) * 1.5)', filter: `${grayscaleFilter} ${brightnessFilter}`, opacity }}
                >
                  <div className={`w-full h-full ${isHighlighted && highlightFilter && isMatchingFilter ? 'ring-vu-md ring-cyan-400 rounded-vu-5' : ''}`}>
                    <DeckViewCard
                      card={card}
                      playerColorMap={playerColorMap}
                      localPlayerId={localPlayerId}
                      imageRefreshVersion={imageRefreshVersion}
                      disableActiveHighlights={!isMatchingFilter}
                    />
                  </div>
                </div>
              )
            })}
            {displayCards.length === 0 && <p className="col-span-5 w-full text-center text-gray-400 py-vu-xl">{t('empty')}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
