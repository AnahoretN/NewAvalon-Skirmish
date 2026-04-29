
import React, { useRef, useState, useEffect, useMemo } from 'react'
import { DeckType } from '@/types'
import type { DragItem, Card as CardType, PlayerColor } from '@/types'
import { decksData } from '@/content'
import { Card } from './Card'
import { useLanguage } from '@/contexts/LanguageContext'

interface TokensModalProps {
  isOpen: boolean;
  onClose: () => void;
  setDraggedItem: (item: DragItem | null) => void;
  openContextMenu: (e: React.MouseEvent, type: 'token_panel_item', data: { card: CardType }) => void;
  canInteract: boolean;
  anchorEl: { top: number; left: number } | null;
  imageRefreshVersion?: number;
  localPlayerId: number | null; // The player who is dragging the token (becomes token owner)
  activePlayerId?: number | null; // The active player (may be dummy)
  players?: any[]; // All players to check if active is dummy
  playerColorMap?: Map<number, PlayerColor>; // Player colors for display
  activeGridSize?: 4 | 5 | 6 | 7; // Grid size from game board
}

export const TokensModal: React.FC<TokensModalProps> = ({ isOpen, onClose, setDraggedItem, openContextMenu, canInteract, anchorEl, imageRefreshVersion, localPlayerId, activePlayerId, players, playerColorMap }) => {
  const { t } = useLanguage()
  const [draggedTokenId, setDraggedTokenId] = useState<string | null>(null)
  const [droppedOutside, setDroppedOutside] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const draggedTokenRef = useRef<CardType | null>(null)

  // Create a minimal color map with just the token owner's color (moved outside map to fix hooks error)
  const tokenColorMap = useMemo(() => {
    if (!playerColorMap) {
      return new Map()
    }
    const activePlayer = players?.find(p => p.id === activePlayerId)
    const isDummy = activePlayer?.isDummy && activePlayerId !== null
    const ownerId = isDummy ? activePlayerId : localPlayerId
    if (!ownerId) {
      return new Map()
    }

    const colorName = playerColorMap.get(ownerId)
    return colorName ? new Map([[ownerId, colorName]]) : new Map()
  }, [playerColorMap, players, activePlayerId, localPlayerId])

  useEffect(() => {
    if (isOpen) {
      setDraggedTokenId(null)
      setDroppedOutside(false)
      draggedTokenRef.current = null
    }
  }, [isOpen])

  if (!isOpen || !anchorEl) {
    return null
  }

  const tokenCards = (decksData[DeckType.Tokens] || []).filter(token => {
    return !token.allowedPanels || token.allowedPanels.includes('TOKEN_PANEL')
  })

  const modalStyle: React.CSSProperties = {
    position: 'fixed',
    top: `${anchorEl.top}px`,
    left: `${anchorEl.left}px`,
    zIndex: 60,
  }

  const handleDragStart = (token: CardType) => {
    if (!canInteract) {
      return
    }

    setDraggedTokenId(token.id)
    draggedTokenRef.current = token
    setDroppedOutside(false)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!draggedTokenRef.current || !modalRef.current) {
      return
    }

    // Check if actually dragging (draggedTokenId is set)
    if (!draggedTokenId) {
      return
    }

    // Check if we're actually leaving the modal (not just moving to a child element)
    // e.currentTarget is the element with the handler, e.target is the element being left
    // e.relatedTarget is the element we're entering
    const relatedTarget = e.relatedTarget as HTMLElement
    const isLeavingModal = e.currentTarget === modalRef.current && !modalRef.current.contains(relatedTarget)

    if (isLeavingModal) {
      // Determine token owner: tokens belong to the active player (even if it's a dummy)
      // This ensures dummy player's tokens belong to the dummy, not the controlling player
      const activePlayer = players?.find(p => p.id === activePlayerId)
      const tokenOwnerId = (activePlayer?.isDummy && activePlayerId !== null)
        ? activePlayerId
        : (localPlayerId ?? undefined)

      setDraggedItem({
        card: draggedTokenRef.current,
        source: 'token_panel',
        ownerId: tokenOwnerId, // The active player owns the token (even if dummy)
      })

      setDroppedOutside(true)

      // Close modal immediately so drop can happen on underlying elements
      onClose()
    }
  }

  const handleDragEnd = () => {
    // Only cleanup if we didn't drop outside (outside case is handled by dragLeave)
    if (!droppedOutside) {
      setDraggedTokenId(null)
    }
    draggedTokenRef.current = null
  }

  return (
    <div
      style={modalStyle}
      className="pointer-events-auto"
      ref={modalRef}
      onDragLeave={handleDragLeave}
    >
      <div className="bg-gray-800 rounded-vu-5 p-vu-lg shadow-xl w-vu-modal-lg max-w-vu-modal-xl h-auto flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-vu-md">
          <div className="flex flex-col">
            <h2 className="text-vu-2xl font-bold">{t('tokens')}</h2>
            <p className="text-gray-400 text-vu-14">{t('dragOutsideToPlaceToken')}</p>
          </div>
          <button
            onClick={onClose}
            className="py-vu-md px-vu-lg rounded-vu-2 font-bold transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
            style={{ fontSize: 'var(--vu-text-14)' }}
          >
            {t('close')}
          </button>
        </div>
        <div className="flex-grow bg-gray-900 rounded p-vu-board overflow-y-auto">
          <div className="grid grid-cols-3 gap-1 overflow-y-scroll custom-scrollbar flex-grow content-start">
            {tokenCards.map((token) => {
              const isBeingDragged = draggedTokenId === token.id
              const opacity = isBeingDragged ? 0.5 : 1

              return (
                <div
                  key={token.id}
                  className="aspect-square relative"
                  style={{ opacity }}
                  draggable={canInteract}
                  onDragStart={() => handleDragStart(token)}
                  onDragEnd={handleDragEnd}
                  onContextMenu={(e) => canInteract && openContextMenu(e, 'token_panel_item', { card: token })}
                  data-interactive={canInteract}
                >
                  <div className="w-full h-full rounded-vu-5" data-token-image="true">
                    <Card card={token} isFaceUp={true} playerColorMap={tokenColorMap} imageRefreshVersion={imageRefreshVersion} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
