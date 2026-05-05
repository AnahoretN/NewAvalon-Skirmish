import React, { memo, useMemo, useCallback, useRef, useState } from 'react'
import type { Board, GridSize, DragItem, DropTarget, Card as CardType, PlayerColor, HighlightData, FloatingTextData, TargetingModeData, ClickWave, CursorStackState, AbilityAction, VisualEffect, VisualEffectsState, FloatingTextEffect, ClickWaveEffect, ScoringLineData, Player } from '@/types'
import { ClickWave as ClickWaveComponent } from './ClickWave'
import { Card } from './Card'
import { PLAYER_COLORS, FLOATING_TEXT_COLORS, PLAYER_COLOR_RGB } from '@/constants'
import { hasReadyAbilityInCurrentPhase } from '@/utils/autoAbilities'
import { TIMING } from '@/utils/common'

interface GameBoardProps {
  board: Board;
  isGameStarted: boolean;
  activeGridSize: GridSize;
  handleDrop: (item: DragItem, target: DropTarget) => void;
  draggedItem: DragItem | null;
  setDraggedItem: (item: DragItem | null) => void;
  openContextMenu: (e: React.MouseEvent, type: 'boardItem' | 'emptyBoardCell', data: any) => void;
  playMode: { card: CardType; sourceItem: DragItem; faceDown?: boolean } | null;
  setPlayMode: (mode: null) => void;
  highlight: HighlightData | null;
  playerColorMap: Map<number, PlayerColor>;
  localPlayerId: number | null;
  onCardDoubleClick: (card: CardType, boardCoords: { row: number; col: number }) => void;
  onEmptyCellDoubleClick: (boardCoords: { row: number; col: number }) => void;
  imageRefreshVersion?: number;
  cursorStack: { type: string; count: number } | null;
  currentPhase?: number;
  activePlayerId?: number | null; // Aligned with GameState type (null when no active player)
  onCardClick?: (card: CardType, boardCoords: { row: number; col: number }) => void;
  onEmptyCellClick?: (boardCoords: { row: number; col: number }) => void;
  validTargets?: {row: number, col: number}[];
  noTargetOverlay?: {row: number, col: number} | null;
  disableActiveHighlights?: boolean;
  preserveDeployAbilities?: boolean;
  activeFloatingTexts?: FloatingTextData[];
  abilitySourceCoords?: { row: number, col: number } | null;
  abilityCheckKey?: number;
  targetingMode?: TargetingModeData | null; // Shared targeting mode from gameState
  abilityMode?: AbilityAction | null; // For line selection mode highlight color
  scoringLines?: ScoringLineData[]; // Lines available for scoring during Scoring phase
  activePlayerIdForScoring?: number | null; // Player who is scoring (for correct color)
  clickWaves?: ClickWave[]; // Reserved for future use
  triggerClickWave?: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void;
  // NEW: ID-based visual effects
  visualEffects?: VisualEffectsState;
  // Mode cancellation props (right-click to cancel)
  setCursorStack?: (value: CursorStackState | null) => void;
  onCancelAllModes?: () => void;
  // Players array for checking dummy status
  players?: Player[];
  // Hide dummy cards setting
  hideDummyCards?: boolean;
}

// Helper to check if an ability mode is a line selection mode
const isLineSelectionMode = (mode: string | undefined): boolean => {
  return mode === 'SCORE_LAST_PLAYED_LINE' ||
         mode === 'SELECT_LINE_END' ||
         mode === 'ZIUS_LINE_SELECT' ||
         mode === 'SELECT_LINE_FOR_EXPLOIT_SCORING' ||
         mode === 'SELECT_LINE_FOR_SUPPORT_COUNTERS' ||
         mode === 'SELECT_LINE_FOR_THREAT_COUNTERS' ||
         mode === 'SELECT_DIAGONAL'
};

interface GridCellProps {
  row: number;
  col: number;
  cell: { card: CardType | null };
  isGameStarted: boolean;
  activeGridSize: GridSize;
  handleDrop: (item: DragItem, target: DropTarget) => void;
  draggedItem: DragItem | null;
  setDraggedItem: (item: DragItem | null) => void;
  openContextMenu: (e: React.MouseEvent, type: 'boardItem' | 'emptyBoardCell', data: any) => void;
  playMode: { card: CardType; sourceItem: DragItem; faceDown?: boolean } | null;
  setPlayMode: (mode: null) => void;
  playerColorMap: Map<number, PlayerColor>;
  localPlayerId: number | null;
  onCardDoubleClick: (card: CardType, boardCoords: { row: number; col: number }) => void;
  onEmptyCellDoubleClick: (boardCoords: { row: number; col: number }) => void;
  imageRefreshVersion?: number;
  cursorStack: { type: string; count: number } | null;
  currentPhase?: number;
  activePlayerId?: number | null; // Aligned with GameState type (null when no active player)
  onCardClick?: (card: CardType, boardCoords: { row: number; col: number }) => void;
  onEmptyCellClick?: (boardCoords: { row: number; col: number }) => void;
  isValidTarget?: boolean;
  isTargetingModeValidTarget?: boolean;
  targetingModePlayerId?: number;
  targetingModeOriginalOwnerId?: number; // The command card owner (for correct highlight color)
  targetingModeActionMode?: string | undefined; // The mode from targetingMode.action.mode
  targetingMode?: TargetingModeData | null; // Full targeting mode object for checking if active
  showNoTarget?: boolean;
  disableActiveHighlights?: boolean;
  preserveDeployAbilities?: boolean;
  abilitySourceCoords?: { row: number, col: number } | null;
  abilityCheckKey?: number;
  abilityMode?: AbilityAction | null; // For line selection mode highlight color
  scoringLines?: ScoringLineData[]; // Lines available for scoring
  activePlayerIdForScoring?: number | null; // Player who is scoring
  setCursorStack?: (value: CursorStackState | null) => void;
  onCancelAllModes?: () => void;
  triggerClickWave?: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void;
  players?: Player[]; // Players array for checking dummy status
  hoveredCell: { row: number; col: number } | null; // State-based hover tracking for drag highlight
  setHoveredCell: (cell: { row: number; col: number } | null) => void; // Setter for hover state
  hideDummyCards?: boolean; // Hide dummy cards setting
}

const GridCell = memo((props: GridCellProps) => {
  const {
      row, col, cell, isGameStarted, activeGridSize, handleDrop, draggedItem, setDraggedItem,
      openContextMenu, playMode, setPlayMode, playerColorMap, localPlayerId,
      onCardDoubleClick, onEmptyCellDoubleClick, imageRefreshVersion, cursorStack,
      currentPhase, activePlayerId, onCardClick, onEmptyCellClick,
      isValidTarget, isTargetingModeValidTarget, targetingModePlayerId,
      targetingModeOriginalOwnerId, targetingModeActionMode,
      targetingMode,
      showNoTarget, disableActiveHighlights, preserveDeployAbilities,
      abilitySourceCoords, abilityCheckKey, abilityMode, scoringLines, activePlayerIdForScoring,
      setCursorStack: _setCursorStack, onCancelAllModes,
      triggerClickWave, players,
      hoveredCell, setHoveredCell, // NEW: State-based hover tracking
      hideDummyCards = false, // Hide dummy cards setting
  } = props

  // Track previous card state to detect when card is removed during ability
  const prevCardRef = useRef(cell.card)

  // Clear drag highlight if card was removed from this cell (e.g., during sacrifice ability)
  if (prevCardRef.current && !cell.card && hoveredCell?.row === row && hoveredCell?.col === col) {
    setHoveredCell(null)
  }
  // Update prev card for next render
  prevCardRef.current = cell.card

      // Scoring lines highlight - show cells that are part of scoring lines
      // MUST be declared before handleClick since handleClick uses it
      const scoringLineInfo = useMemo(() => {
        if (!scoringLines || scoringLines.length === 0) {return null}
        // CRITICAL: Convert full board coordinates to active grid coordinates
        // The active grid is centered in the full board
        // board is available in parent scope, use fixed size 7 for consistency
        const totalSize = 7  // Board is always 7x7
        const offset = Math.floor((totalSize - activeGridSize) / 2)
        const activeRow = row - offset
        const activeCol = col - offset

        // Check if this cell is part of any scoring line (only row and col for now)
        for (const line of scoringLines) {
          const inLine =
            (line.lineType === 'row' && line.lineIndex === activeRow) ||
            (line.lineType === 'col' && line.lineIndex === activeCol)
          if (inLine) {
            return { line, score: line.score }
          }
        }
        return null
      }, [scoringLines, row, col, activeGridSize])
      const showScoringHighlight = scoringLineInfo !== null

// Random delay for ready ability animation - only depends on card ID to avoid unnecessary recalculations
const readyAbilityDelay = useMemo(() => Math.random() * 0.25, [cell.card?.id])

      const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()

        if (draggedItem) {
          handleDrop(draggedItem, { target: 'board', boardCoords: { row, col } })
        }
        setHoveredCell(null)
      }, [draggedItem, handleDrop, row, col, setHoveredCell])

      const handleClick = useCallback(() => {
        // Check if we're in line selection mode (for abilities) - check FIRST before other modes
        // This ensures abilities like Zius, Unwavering Integrator, Logistics Chain work correctly
        const isInLineSelectionMode = abilityMode && isLineSelectionMode(abilityMode.mode)

        // Trigger click wave for empty cells
        if (!cell.card && triggerClickWave && localPlayerId !== null) {
          triggerClickWave('board', { row, col })
        }

        // Priority 1: Line selection modes (abilities like Zius, Unwavering Integrator, Logistics Chain)
        if (isInLineSelectionMode && onEmptyCellClick) {
          // In line selection mode, treat any cell click as line selection (even if occupied)
          onEmptyCellClick({ row, col })
          return
        }

        // Priority 2: Scoring line selection (during Scoring phase)
        if (showScoringHighlight && scoringLineInfo && onEmptyCellClick) {
          onEmptyCellClick({ row, col })
          return
        }

        // Priority 3: Play mode (dragging card from hand)
        if (playMode) {
          const itemToDrop: DragItem = {
            ...playMode.sourceItem,
            card: { ...playMode.sourceItem.card },
          }
          itemToDrop.card.isFaceDown = !!playMode.faceDown
          handleDrop(itemToDrop, { target: 'board', boardCoords: { row, col } })
          setPlayMode(null)
          return
        }

        // Priority 4: Card click
        if (cell.card && onCardClick) {
          onCardClick(cell.card, { row, col })
          return
        }

        // Priority 5: Empty cell click (default)
        if (!cell.card && onEmptyCellClick) {
          onEmptyCellClick({ row, col })
        }
      }, [showScoringHighlight, scoringLineInfo, onEmptyCellClick, playMode, cell.card, onCardClick, handleDrop, setPlayMode, row, col, triggerClickWave, localPlayerId, abilityMode])

      // Drag handlers - immediate update for responsive feedback
      const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation() // Prevent bubbling to parent cells
        const isCounter = draggedItem?.source === 'counter_panel'
        const isBoardCardMove = draggedItem?.source === 'board'
        const cellIsEmpty = !cell.card
        const canDrop = cellIsEmpty || (cell.card && isCounter) || (cell.card && isBoardCardMove)

        if (canDrop) {
          // Set immediately for instant visual feedback - using state to trigger re-render
          setHoveredCell({ row, col })
          e.dataTransfer.dropEffect = 'move'
        } else {
          // Cell is occupied - remove highlight
          if (hoveredCell?.row === row && hoveredCell?.col === col) {
            setHoveredCell(null)
          }
          e.dataTransfer.dropEffect = 'none'
        }
      }, [draggedItem, cell.card, row, col, hoveredCell, setHoveredCell, activeGridSize])

      const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        // Only clear if we're actually leaving this cell (not entering a child element)
        // Use relatedTarget to check if the drag is moving to a child or staying within the cell
        const relatedTarget = e.relatedTarget as Element
        const currentTarget = e.currentTarget

        // If relatedTarget is null (left the window) or not contained within currentTarget, we're leaving
        if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
          setHoveredCell(null)
        }
      }, [setHoveredCell])

      const handleContextMenu = useCallback((e: React.MouseEvent) => {
        // Prevent browser context menu
        e.preventDefault()
        e.stopPropagation()

        // Check if any mode was active BEFORE cancelling (to prevent context menu from opening)
        const wasCursorStackActive = !!cursorStack
        const wasPlayModeActive = !!playMode
        const wasAbilityModeActive = !!abilityMode
        const wasTargetingModeActive = !!targetingMode || !!targetingModeActionMode

        // Right-click cancels all targeting/ability modes for all players
        if (onCancelAllModes) {
          onCancelAllModes()
        }
        // Only open context menu if no mode was active
        if (!cell.card && !wasCursorStackActive && !wasPlayModeActive && !wasAbilityModeActive && !wasTargetingModeActive) {
          openContextMenu(e, 'emptyBoardCell', { boardCoords: { row, col } })
        }
      }, [cell.card, openContextMenu, row, col, onCancelAllModes, cursorStack, playMode, abilityMode, targetingMode, targetingModeActionMode])

      const handleDoubleClick = useCallback(() => {
        if (!cell.card) {
          onEmptyCellDoubleClick({ row, col })
        }
      }, [cell.card, onEmptyCellDoubleClick, row, col])

      const handleCardDragStart = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        // Block dragging when cursorStack is active (has a token)
        if (cursorStack) {
          e.preventDefault()
          return
        }
        if (cell.card) {
          setDraggedItem({
            card: cell.card,
            source: 'board',
            boardCoords: { row, col },
            isManual: true,
            bypassOwnershipCheck: true,
          })
          // Set custom drag image to only include the card element, not the tooltip
          // Find the card element within the dragged container
          const cardElement = e.currentTarget.querySelector('[data-card-element]')
          if (cardElement) {
            e.dataTransfer.setDragImage(cardElement as Element, 20, 20)
          }
        }
      }, [cell.card, setDraggedItem, row, col, cursorStack, activeGridSize])

      // Handle drag over card - bubble to parent cell for proper highlighting
      const handleCardDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()
        const isCounter = draggedItem?.source === 'counter_panel'
        const isBoardCardMove = draggedItem?.source === 'board'
        const cellIsEmpty = !cell.card
        const canDrop = cellIsEmpty || (cell.card && isCounter) || (cell.card && isBoardCardMove)

        if (canDrop) {
          setHoveredCell({ row, col })
          e.dataTransfer.dropEffect = 'move'
        } else {
          e.dataTransfer.dropEffect = 'none'
        }
      }, [draggedItem, cell.card, row, col, setHoveredCell])

      // Handle drag leave from card element
      const handleCardDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        const relatedTarget = e.relatedTarget as Element
        const currentTarget = e.currentTarget

        // Only clear if we're actually leaving the cell
        if (!relatedTarget || !currentTarget.parentElement?.contains(relatedTarget)) {
          setHoveredCell(null)
        }
      }, [setHoveredCell])

      // Handle drop on card - delegate to parent cell's drop handler
      const handleCardDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        e.stopPropagation()

        if (draggedItem) {
          handleDrop(draggedItem, { target: 'board', boardCoords: { row, col } })
        }
        setHoveredCell(null)
      }, [draggedItem, handleDrop, row, col, setHoveredCell])

      const handleCardContextMenu = useCallback((e: React.MouseEvent) => {
        // Prevent browser context menu
        e.preventDefault()
        e.stopPropagation()

        // Check if any mode was active BEFORE cancelling (to prevent context menu from opening)
        const wasCursorStackActive = !!cursorStack
        const wasPlayModeActive = !!playMode
        const wasAbilityModeActive = !!abilityMode
        const wasTargetingModeActive = !!targetingMode || !!targetingModeActionMode

        // Right-click cancels all targeting/ability modes for all players
        if (onCancelAllModes) {
          onCancelAllModes()
        }
        // Only open context menu if no mode was active
        if (cell.card && !wasCursorStackActive && !wasPlayModeActive && !wasAbilityModeActive && !wasTargetingModeActive) {
          openContextMenu(e, 'boardItem', { card: cell.card, boardCoords: { row, col } })
        }
      }, [cell.card, openContextMenu, row, col, onCancelAllModes, cursorStack, playMode, abilityMode, targetingMode, targetingModeActionMode])

      const handleCardDoubleClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        if (!cursorStack && cell.card) {
          onCardDoubleClick(cell.card, { row, col })
        } else {
          handleClick()
        }
      }, [cursorStack, cell.card, onCardDoubleClick, handleClick, row, col])

      const isInPlayMode = !!playMode
      const isStackMode = !!cursorStack
      const isOccupied = !!cell.card

      // Check if card has ready ability (for activation) - ONLY for active player's cards
      const hasReadyAbility = cell.card && hasReadyAbilityInCurrentPhase(
        cell.card,
        currentPhase ?? 0,
        activePlayerId
      )
      const hasActiveEffect = isValidTarget || hasReadyAbility

      // Remove overflow-hidden when there are active effects to allow highlights to show outside cell bounds
      const baseClasses = `w-full h-full min-w-0 min-h-0 rounded-vu-5 border border-gray-600 border-opacity-30 transition-colors duration-200 flex items-center justify-center relative ${hasActiveEffect ? '' : 'overflow-hidden'}`

      // Check if dragged item is from hand/deck/discard/board (cards that can be played/moved)
      const isDraggingCard = draggedItem && ['hand', 'deck', 'discard', 'board'].includes(draggedItem.source)

      // Interactive for click handling, but visual highlight comes from shared highlights
      const isInteractive = isValidTarget || (isInPlayMode && !isOccupied) || (isStackMode && isValidTarget)
      // Card has active effects (highlight, selection, or ready ability) - should appear above other cards

      // Visual highlights:
      // 1. For drag: only highlight when cursor is over the cell
      // Using state-based tracking for reactivity
      const showDragHighlight = !isOccupied && isDraggingCard &&
                                hoveredCell?.row === row && hoveredCell?.col === col &&
                                localPlayerId !== null
      // 2. For play mode: highlight all empty cells as valid targets
      const showPlayModeHighlight = !isOccupied && isInPlayMode && localPlayerId !== null
      // 3. Scoring lines highlight - show cells that are part of scoring lines (declared earlier before handleClick)
      // scoringLineInfo and showScoringHighlight are now declared above to avoid TDZ error

      // Only add cursor pointer for interactive cells - visual highlight comes from shared highlights
      const targetClasses = isInteractive ? 'cursor-pointer z-10' : ''
      // Always use board-cell-active background - drag highlight is just a border overlay
      const cellClasses = `bg-board-cell-active ${isInPlayMode && isOccupied ? 'cursor-not-allowed' : ''} ${targetClasses}`

      const isFaceUp: boolean = useMemo(() => {
        const card = cell.card
        if (!card) {
          return false
        }

        // Face-down cards show card back to EVERYONE (including owner)
        // Only revealed cards show face-up
        const isRevealedToAll = card.revealedTo === 'all'
        const isRevealedToMeExplicitly = localPlayerId !== null && Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId)
        const hasRevealedStatus = localPlayerId !== null && (card.statuses ?? []).some(s => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)

        return (!card.isFaceDown) || isRevealedToAll || !!isRevealedToMeExplicitly || !!hasRevealedStatus
      }, [cell.card, localPlayerId])

      // Tooltip and context menu visibility for face-down cards
      // Only owner sees tooltip on face-down cards, unless it's a dummy player's card
      const shouldDisableTooltip = useMemo(() => {
        const card = cell.card
        if (!card || !card.isFaceDown) {
          return false // Face-up cards always show tooltip
        }
        // Check if card is revealed to this player via token
        const hasRevealedStatus = localPlayerId !== null && (card.statuses ?? []).some(s => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)
        if (hasRevealedStatus) {
          return false // Revealed cards show tooltip
        }
        // Check if card is revealed to this player explicitly
        const isRevealedToMeExplicitly = localPlayerId !== null && Array.isArray(card.revealedTo) && card.revealedTo.includes(localPlayerId)
        if (isRevealedToMeExplicitly) {
          return false // Explicitly revealed cards show tooltip
        }
        // Check if owner is dummy player (dummy cards hide tooltip when hideDummyCards is true)
        const owner = players?.find(p => p.id === card.ownerId)
        if (owner?.isDummy) {
          return hideDummyCards // Hide tooltip when hideDummyCards=true, show when false
        }
        // Check if local player is the owner (owner sees tooltip on their own face-down cards)
        const isOwner = card.ownerId === localPlayerId
        if (isOwner) {
          return false // Owner sees tooltip on their own face-down cards
        }
        // Face-down cards hide tooltip for non-owners
        return true
      }, [cell.card, localPlayerId, players, hideDummyCards])

      return (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onDoubleClick={handleDoubleClick}
          className={`${baseClasses} ${cellClasses}`}
          data-interactive={!cell.card}
          data-board-coords={`${row},${col}`}
        >
          {/* Drag highlight - only when cursor is over the cell */}
          {showDragHighlight && (() => {
            // Use the dragged card's owner color, not local player color
            const draggedCardOwnerId = draggedItem?.card?.ownerId ?? draggedItem?.playerId ?? localPlayerId!
            const draggedCardOwner = players?.find(p => p.id === draggedCardOwnerId)
            const playerColor = draggedCardOwner ? playerColorMap.get(draggedCardOwnerId) : playerColorMap.get(localPlayerId!)
            const rgb = playerColor && PLAYER_COLOR_RGB[playerColor]
              ? PLAYER_COLOR_RGB[playerColor]
              : { r: 37, g: 99, b: 235 }

            return (
              <>
                {/* Cell border with owner's color - no background, just thick border */}
                <div
                  className="absolute inset-0 rounded-vu-5 pointer-events-none"
                  style={{
                    zIndex: 40,
                    borderWidth: 'var(--vu-border-md)',
                    borderStyle: 'solid',
                    borderColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                    background: 'transparent',
                    boxSizing: 'border-box',
                    boxShadow: `0 0 calc(2 * var(--vu-effect-md)) rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`,
                  }}
                />
              </>
            )
          })()}

          {/* Play mode highlight - all empty cells are valid targets */}
          {showPlayModeHighlight && (() => {
            const playerColor = playerColorMap.get(localPlayerId!)
            const rgb = playerColor && PLAYER_COLOR_RGB[playerColor]
              ? PLAYER_COLOR_RGB[playerColor]
              : { r: 37, g: 99, b: 235 }
            return (
              <div
                className="absolute inset-0 rounded-vu-5 pointer-events-none animate-pulse"
                style={{
                  zIndex: 35,
                  boxShadow: `0 0 calc(2.5 * var(--vu-effect-md)) rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75)`,
                  borderWidth: 'var(--vu-border-base)',
                  borderStyle: 'solid',
                  borderColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                  background: `radial-gradient(circle at center, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4) 100%)`,
                }}
              />
            )
          })()}

          {/* Scoring line highlight - shows cells that are part of available scoring lines */}
          {showScoringHighlight && scoringLineInfo && (() => {
            const playerColor = activePlayerIdForScoring !== undefined
              ? playerColorMap.get(activePlayerIdForScoring!)
              : playerColorMap.get(localPlayerId!)
            const rgb = playerColor && PLAYER_COLOR_RGB[playerColor]
              ? PLAYER_COLOR_RGB[playerColor]
              : { r: 255, g: 215, b: 0 }  // Gold color for scoring
            return (
              <div
                className="absolute inset-0 rounded-vu-5 pointer-events-none animate-glow-pulse"
                style={{
                  zIndex: 45,
                  boxShadow: `0 0 calc(2.5 * var(--vu-effect-md)) rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75)`,
                  borderWidth: 'var(--vu-border-md)',
                  borderStyle: 'solid',
                  borderColor: 'white',
                  background: `radial-gradient(circle at center, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75) 100%)`,
                }}
              >
                {/* Score badge removed - only showing highlight now */}
              </div>
            )
          })()}

          {showNoTarget && (
            <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
              <img
                src="https://res.cloudinary.com/dxxh6meej/image/upload/v1771365317/no_tarket_lndzoc.webp"
                alt="No Target"
                className="w-vu-card-normal h-vu-card-normal object-contain animate-fade-out drop-shadow-[0_0_5px_rgba(255,0,0,0.8)]"
              />
            </div>
          )}

          {/* Targeting mode highlight - shows valid targets from another player's targeting mode */}
          {/* NOT shown for line selection modes - they have their own highlight below */}
          {(isTargetingModeValidTarget || isValidTarget) && (targetingModePlayerId || targetingModeOriginalOwnerId) && !isLineSelectionMode(targetingModeActionMode) && !isLineSelectionMode(abilityMode?.mode) && (() => {
            // Prefer originalOwnerId (command card owner) for highlight color, fallback to playerId
            const highlightOwnerId = targetingModeOriginalOwnerId ?? targetingModePlayerId
            const targetingPlayerColor = highlightOwnerId !== undefined ? playerColorMap.get(highlightOwnerId) : undefined
            const rgb = targetingPlayerColor && PLAYER_COLOR_RGB[targetingPlayerColor]
              ? PLAYER_COLOR_RGB[targetingPlayerColor]
              : { r: 37, g: 99, b: 235 }
            return (
              <div
                key={`targeting-mode-${highlightOwnerId}`}
                className="absolute inset-0 rounded-vu-5 pointer-events-none animate-glow-pulse"
                style={{
                  zIndex: 50,
                  boxShadow: `0 0 10px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75)`,
                  border: '4px solid',
                  borderColor: 'white',
                  background: `radial-gradient(circle at center, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75) 100%)`,
                }}
              />
            )
          })()}

          {/* Line selection modes highlight - solid border for all line selection systems */}
          {/* Shows highlight for: SELECT_LINE_FOR_EXPLOIT_SCORING, SELECT_LINE_FOR_SUPPORT_COUNTERS, SELECT_LINE_FOR_THREAT_COUNTERS, SELECT_DIAGONAL, etc. */}
          {(isLineSelectionMode(abilityMode?.mode) || isLineSelectionMode(targetingModeActionMode)) && isValidTarget && (() => {
            const highlightOwnerId = activePlayerId ?? localPlayerId ?? targetingModePlayerId
            const targetingPlayerColor = highlightOwnerId !== undefined ? playerColorMap.get(highlightOwnerId) : undefined
            const rgb = targetingPlayerColor && PLAYER_COLOR_RGB[targetingPlayerColor]
              ? PLAYER_COLOR_RGB[targetingPlayerColor]
              : { r: 37, g: 99, b: 235 }
            return (
              <div
                key={`line-selection-${row}-${col}`}
                className="absolute inset-0 rounded-vu-5 pointer-events-none animate-glow-pulse"
                style={{
                  zIndex: 45,
                  boxShadow: `0 0 calc(2.5 * var(--vu-effect-md)) rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75)`,
                  borderWidth: 'var(--vu-border-md)',
                  borderStyle: 'solid',
                  borderColor: 'white',
                  background: `radial-gradient(circle at center, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75) 100%)`,
                }}
              />
            )
          })()}

          {cell.card && (
            <div
              key={cell.card.id}
              draggable={isGameStarted && !cursorStack}
              onDragStart={handleCardDragStart}
              onDragOver={handleCardDragOver}
              onDragLeave={handleCardDragLeave}
              onDrop={handleCardDrop}
              onDragEnd={() => {
                // Don't reset here - let the drop handler do it
                // Fallback: clear after delay if no drop happened
                setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK)
                // Clear hover state
                setHoveredCell(null)
              }}
              onContextMenu={handleCardContextMenu}
              onDoubleClick={handleCardDoubleClick}
              className={`w-full h-full min-w-0 min-h-0 ${isGameStarted && !cursorStack ? 'cursor-grab' : 'cursor-default'} relative flex-shrink overflow-hidden ${hasActiveEffect ? 'z-40' : 'z-30'}`}
              data-interactive="true"
            >
              {/* Wrapper for custom drag image - prevents tooltip from being included in drag */}
              <div data-card-element="true" className="w-full h-full min-w-0 min-h-0 overflow-hidden flex items-center justify-center">
                <Card
                  card={cell.card}
                  isFaceUp={isFaceUp}
                  playerColorMap={playerColorMap}
                  localPlayerId={localPlayerId}
                  imageRefreshVersion={imageRefreshVersion}
                  loadPriority="high"
                  disableImageTransition={true}
                  activePhaseIndex={currentPhase}
                  activePlayerId={activePlayerId}
                  disableActiveHighlights={disableActiveHighlights}
                  preserveDeployAbilities={preserveDeployAbilities}
                  activeAbilitySourceCoords={abilitySourceCoords}
                  boardCoords={{ row: row, col: col }}
                  abilityCheckKey={abilityCheckKey}
                  onCardClick={onCardClick}
                  targetingMode={!!targetingModePlayerId}
                  triggerClickWave={triggerClickWave}
                  disableTooltip={shouldDisableTooltip}
                  players={players}
                />
              </div>
            </div>
          )}

          {/* Ready ability highlight - targeting-style highlight without fill or pulse, with entrance animation */}
          {hasReadyAbility && !disableActiveHighlights && !targetingModePlayerId && (() => {
            // Check if this card is currently executing an ability
            const isExecutingAbility = abilitySourceCoords &&
              abilitySourceCoords.row === row &&
              abilitySourceCoords.col === col;

            // Don't show highlight if card is executing ability
            if (isExecutingAbility) {
              return null;
            }

            // Get card owner's color for glow effect
            const cardOwnerId = cell.card?.ownerId;
            const ownerColorName = cardOwnerId ? playerColorMap.get(cardOwnerId) : null;
            const colorRgb = ownerColorName ? (PLAYER_COLOR_RGB[ownerColorName] || { r: 255, g: 255, b: 255 }) : null;

            return (
              <div
                className="absolute inset-0 rounded-vu-5 pointer-events-none"
                style={{
                  zIndex: 45, // Above drag highlight (40), below scoring overlay (60)
                  opacity: 0, // Start invisible until animation begins
                  animation: `ready-ability-entrance 0.7s ease-out forwards`,
                  animationDelay: `${readyAbilityDelay}s`, // Delay before animation starts
                  transformOrigin: 'center center',
                  boxShadow: colorRgb ? `0 0 calc(12 * var(--vu-base)) rgba(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b}, 0.75)` : undefined, // 12vu glow
                  border: 'calc(5 * var(--vu-base)) solid', // 5vu border
                  borderColor: 'white',
                  background: 'transparent', // No fill
                }}
                title="Ready to activate ability"
              />
            )
          })()}

          {/* Scoring line clickable overlay - captures clicks on cards during scoring */}
          {showScoringHighlight && scoringLineInfo && (
            <div
              onClick={handleClick}
              className="absolute inset-0 rounded-vu-5 cursor-pointer"
              style={{ zIndex: 60 }}
              title={`Click to score this line (${scoringLineInfo.score} points)`}
            />
          )}
        </div>
      )
    })

GridCell.displayName = 'GridCell'

// Use only grid-cols-N, let rows auto-generate for better responsiveness
const gridSizeClasses: { [key in GridSize]: string } = {
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
}

const FloatingTextOverlay = memo<{ textData: FloatingTextData; playerColorMap: Map<number, PlayerColor>; }>(({ textData, playerColorMap }) => {
  const colorClass = useMemo(() => {
    const playerColor = playerColorMap.get(textData.playerId)
    return (playerColor && FLOATING_TEXT_COLORS[playerColor]) ? FLOATING_TEXT_COLORS[playerColor] : 'text-white'
  }, [playerColorMap, textData.playerId])

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[60] animate-float-up">
      <span className={`text-vu-35 font-black ${colorClass}`} style={{ WebkitTextStroke: '1px white' }}>
        {textData.text}
      </span>
    </div>
  )
})

FloatingTextOverlay.displayName = 'FloatingTextOverlay'

/**
 * VisualEffectOverlay - Renders ID-based visual effects
 * Supports: highlight, floatingText, noTarget, clickWave, targetingMode
 */
const VisualEffectOverlay = memo<{ effect: VisualEffect; playerColorMap: Map<number, PlayerColor>; }>(({ effect, playerColorMap }) => {
  const playerColor = playerColorMap.get(effect.playerId)
  const colorRgb = playerColor ? PLAYER_COLOR_RGB[playerColor] : '255, 255, 255'

  switch (effect.type) {
    case 'floatingText': {
      const ft = effect as FloatingTextEffect
      return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[60] animate-float-up">
          <span
            className="text-vu-35 font-black"
            style={{
              color: ft.color || `rgb(${colorRgb})`,
              WebkitTextStroke: '1px white'
            }}
          >
            {ft.text}
          </span>
        </div>
      )
    }

    case 'noTarget': {
      return (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[50]">
          <div className="text-vu-xl font-black text-red-500" style={{ textShadow: '2px 2px 0 #000' }}>
            ✕
          </div>
        </div>
      )
    }

    case 'clickWave': {
      const cw = effect as ClickWaveEffect
      return (
        <ClickWaveComponent
          timestamp={cw.createdAt}
          playerColor={playerColor || 'blue' as PlayerColor}
        />
      )
    }

    case 'highlight':
      // Highlights are handled at row/column level, not cell level
      return null

    case 'targetingMode':
      // Targeting mode is handled via targetingMode prop
      return null

    default:
      return null
  }
})

VisualEffectOverlay.displayName = 'VisualEffectOverlay'

export const GameBoard = memo<GameBoardProps>(({
  board,
  isGameStarted,
  activeGridSize,
  handleDrop,
  draggedItem,
  setDraggedItem,
  openContextMenu,
  playMode,
  setPlayMode,
  highlight,
  playerColorMap,
  localPlayerId,
  onCardDoubleClick,
  onEmptyCellDoubleClick,
  imageRefreshVersion,
  cursorStack,
  currentPhase,
  activePlayerId,
  onCardClick,
  onEmptyCellClick,
  validTargets,
  noTargetOverlay,
  disableActiveHighlights,
  preserveDeployAbilities = false,
  activeFloatingTexts,
  abilitySourceCoords = null,
  abilityCheckKey,
  targetingMode,
  abilityMode = null,
  scoringLines = [],
  activePlayerIdForScoring = null,
  clickWaves: _clickWaves, // Reserved for future use
  visualEffects,
  setCursorStack,
  onCancelAllModes,
  triggerClickWave,
  players,
  hideDummyCards = false,
}) => {

  const activeBoard = useMemo(() => {
    const totalSize = board.length
    const offset = Math.floor((totalSize - activeGridSize) / 2)

    const sliced = board
      .slice(offset, offset + activeGridSize)
      .map(row => row.slice(offset, offset + activeGridSize))

    return sliced
  }, [board, activeGridSize])

  // Track which cell is being hovered during drag - using state to trigger re-renders
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null)

  const HighlightContent = useMemo(() => {
    if (!highlight) {
      return null
    }

    const { type, row, col, playerId } = highlight
    const playerColor = playerColorMap.get(playerId)
    const outlineClass = (playerColor && PLAYER_COLORS[playerColor]) ? PLAYER_COLORS[playerColor].outline : 'outline-yellow-400'
    const baseClasses = `outline outline-vu-lg ${outlineClass} rounded-vu-5`
    const totalSize = board.length
    const offset = Math.floor((totalSize - activeGridSize) / 2)

    if (type === 'row' && row !== undefined && row >= offset && row < offset + activeGridSize) {
      const gridRow = row - offset + 1
      return (
        <div
          className={baseClasses}
          style={{
            gridArea: `${gridRow} / 1 / ${gridRow + 1} / ${activeGridSize + 1}`,
          }}
        />
      )
    }

    if (type === 'col' && col !== undefined && col >= offset && col < offset + activeGridSize) {
      const gridCol = col - offset + 1
      return (
        <div
          className={baseClasses}
          style={{
            gridArea: `1 / ${gridCol} / ${activeGridSize + 1} / ${gridCol + 1}`,
          }}
        />
      )
    }

    if (type === 'cell' && row !== undefined && col !== undefined && row >= offset && row < offset + activeGridSize && col >= offset && col < offset + activeGridSize) {
      const gridRow = row - offset + 1
      const gridCol = col - offset + 1
      return (
        <div
          className={baseClasses}
          style={{
            gridArea: `${gridRow} / ${gridCol} / ${gridRow + 1} / ${gridCol + 1}`,
          }}
        />
      )
    }

    return null
  }, [highlight, playerColorMap, activeGridSize, board.length])

  // PERFORMANCE: Pre-compute target sets separately to avoid recalculation on every render
  const validTargetsSet = useMemo(() => {
    const validTargetsArray = Array.isArray(validTargets) ? validTargets : []
    return new Set(validTargetsArray.map((t: {row: number, col: number}) => `${t.row}-${t.col}`))
  }, [validTargets])

  const targetingModeTargetsSet = useMemo(() => {
    const boardTargetsArray = Array.isArray(targetingMode?.boardTargets) ? targetingMode.boardTargets : []
    return new Set(boardTargetsArray.map((t: {row: number, col: number}) => `${t.row}-${t.col}`))
  }, [targetingMode?.boardTargets])

  // PERFORMANCE: Pre-compute visual effects maps separately
  const floatingTextsMap = useMemo(() => {
    const map = new Map<string, any[]>()

    if (activeFloatingTexts) {
      for (const ft of activeFloatingTexts) {
        const key = `${ft.row}-${ft.col}`
        if (!map.has(key)) { map.set(key, []) }
        map.get(key)!.push(ft)
      }
    }

    return map
  }, [activeFloatingTexts])

  const visualEffectsArray = useMemo(() => {
    return visualEffects ? Array.from(visualEffects.values()) : []
  }, [visualEffects])

  const processedCells = useMemo(() => {
    const totalSize = board.length
    const offset = Math.floor((totalSize - activeGridSize) / 2)

    // Helper to check if ability mode is a line selection mode
    const isLineSelectionModeAbility = abilityMode?.mode && (
      abilityMode.mode === 'SELECT_LINE_FOR_EXPLOIT_SCORING' ||
      abilityMode.mode === 'SELECT_LINE_FOR_SUPPORT_COUNTERS' ||
      abilityMode.mode === 'SELECT_LINE_FOR_THREAT_COUNTERS' ||
      abilityMode.mode === 'SELECT_LINE_START' ||
      abilityMode.mode === 'SELECT_LINE_END' ||
      abilityMode.mode === 'SELECT_DIAGONAL' ||
      abilityMode.mode === 'ZIUS_LINE_SELECT' ||
      abilityMode.mode === 'SCORE_LAST_PLAYED_LINE'
    )

    // Get target coords from ability mode for line selection
    const lineSelectionTargetCoords = isLineSelectionModeAbility ? (abilityMode?.payload?.targetCoords || abilityMode?.payload?.firstCoords) : null

    // A cell is valid if it's in GLOBAL targeting mode targets OR line selection mode OR ability mode targets
    // NO LOCAL effects - all highlights must be synchronized across all players
    const isValidTargetCell = (row: number, col: number) => {
      // For line selection modes (including SELECT_DIAGONAL), skip GLOBAL targeting mode check
      // because these modes have their own highlighting logic
      if (!isLineSelectionModeAbility && targetingModeTargetsSet.has(`${row}-${col}`)) {
        return true
      }

      // CRITICAL: Also check abilityMode for AUTO_STEPS compatibility
      // In AUTO_STEPS, abilityMode is set with the mode, and targetingMode is set with boardTargets
      // This ensures highlights work correctly for modes like SELECT_UNIT_FOR_MOVE
      if (!isLineSelectionModeAbility && abilityMode?.mode &&
          (abilityMode.mode === 'SELECT_TARGET' ||
           abilityMode.mode === 'SELECT_UNIT_FOR_MOVE' ||
           abilityMode.mode === 'SWAP_POSITIONS' ||
           abilityMode.mode === 'SWAP_ADJACENT' ||
           abilityMode.mode === 'PUSH' ||
           abilityMode.mode === 'PUSH_MOVE' ||
           abilityMode.mode === 'PATROL_MOVE' ||
           abilityMode.mode === 'RIOT_PUSH' ||
           abilityMode.mode === 'REVEAL_ENEMY' ||
           abilityMode.mode === 'TRANSFER_STATUS_SELECT' ||
           abilityMode.mode === 'CREATE_STACK') &&
          targetingModeTargetsSet.has(`${row}-${col}`)) {
        return true
      }

      // For line selection modes, check if cell is in the same row or column as target coords
      if (isLineSelectionModeAbility) {
        // SELECT_LINE_FOR_EXPLOIT_SCORING without targetCoords (Unwavering Integrator)
        // Highlight row and column through source coords
        if (abilityMode?.mode === 'SELECT_LINE_FOR_EXPLOIT_SCORING' && !lineSelectionTargetCoords && abilityMode?.sourceCoords) {
          return row === abilityMode.sourceCoords.row || col === abilityMode.sourceCoords.col
        }

        // SELECT_LINE_FOR_SUPPORT_COUNTERS without targetCoords (Signal Prophet Deploy)
        // Highlight row and column through source coords
        if (abilityMode?.mode === 'SELECT_LINE_FOR_SUPPORT_COUNTERS' && !lineSelectionTargetCoords && abilityMode?.sourceCoords) {
          return row === abilityMode.sourceCoords.row || col === abilityMode.sourceCoords.col
        }

        // SELECT_LINE_FOR_THREAT_COUNTERS without targetCoords (Code Keeper Deploy)
        // Highlight row and column through source coords
        if (abilityMode?.mode === 'SELECT_LINE_FOR_THREAT_COUNTERS' && !lineSelectionTargetCoords && abilityMode?.sourceCoords) {
          return row === abilityMode.sourceCoords.row || col === abilityMode.sourceCoords.col
        }

        // For SELECT_DIAGONAL:
        // - First click: all cells in ACTIVE GRID are valid (to select center)
        // - After first click: highlight only diagonals through the selected center (payload.firstCoords)
        //   within the ACTIVE GRID bounds
        if (abilityMode?.mode === 'SELECT_DIAGONAL') {
          // First, check if current cell is within active grid bounds
          const inActiveGrid = row >= offset && row < offset + activeGridSize &&
                               col >= offset && col < offset + activeGridSize
          if (!inActiveGrid) {
            return false
          }

          // If firstCoords exists, highlight only diagonals through it
          if (abilityMode?.payload?.firstCoords) {
            const firstCoords = abilityMode.payload.firstCoords
            const onMainDiagonal = (row - firstCoords.row) === (col - firstCoords.col)
            const onAntiDiagonal = (row + col) === (firstCoords.row + firstCoords.col)
            return onMainDiagonal || onAntiDiagonal
          }
          // First click - all cells in active grid are valid to select as center
          return true
        }

        // Other line selection modes need targetCoords
        if (!lineSelectionTargetCoords) {
          return false
        }

        const isSameRow = row === lineSelectionTargetCoords.row
        const isSameCol = col === lineSelectionTargetCoords.col

        // SELECT_LINE_END requires checking against firstCoords
        if (abilityMode?.mode === 'SELECT_LINE_END' && abilityMode?.payload?.firstCoords) {
          const firstCoords = abilityMode.payload.firstCoords
          return (row === firstCoords.row && col === lineSelectionTargetCoords.col) ||
                 (col === firstCoords.col && row === lineSelectionTargetCoords.row)
        }

        // For SELECT_LINE_START and similar, highlight row and column through source coords
        if (abilityMode?.mode === 'SELECT_LINE_START' && abilityMode?.sourceCoords) {
          return row === abilityMode.sourceCoords.row || col === abilityMode.sourceCoords.col
        }

        // Default line selection: same row or column as target coords
        return isSameRow || isSameCol
      }

      return false
    }

    const cells = activeBoard.map((rowItems, rowIndex) =>
      rowItems.map((cell, colIndex) => {
        const originalRowIndex = rowIndex + offset
        const originalColIndex = colIndex + offset
        const cellKey = `${originalRowIndex}-${originalColIndex}`

        const isTargetingModeValidTarget = targetingModeTargetsSet.has(cellKey)

        // Filter new ID-based visual effects for this cell
        const cellVisualEffects = visualEffectsArray.filter(effect => {
          if (effect.type === 'floatingText' || effect.type === 'noTarget') {
            return effect.row === originalRowIndex && effect.col === originalColIndex
          }
          if (effect.type === 'clickWave') {
            return effect.location === 'board' && effect.row === originalRowIndex && effect.col === originalColIndex
          }
          return false
        })

        return {
          cellKey,
          originalRowIndex,
          originalColIndex,
          cell,
          isValidTarget: isValidTargetCell(originalRowIndex, originalColIndex),
          isTargetingModeValidTarget,
          targetingModeActionMode: targetingMode?.action?.mode,
          isNoTarget: noTargetOverlay?.row === originalRowIndex && noTargetOverlay.col === originalColIndex,
          cellFloatingTexts: floatingTextsMap.get(cellKey) || [],
          cellVisualEffects,
        }
      }),
    )

    return cells
  }, [activeBoard, board.length, activeGridSize, validTargetsSet, targetingModeTargetsSet, targetingMode?.action?.mode, noTargetOverlay, floatingTextsMap, visualEffectsArray, abilityMode, abilityMode?.payload?.firstCoords])

  return (
    <div className="relative p-vu-board bg-board-bg rounded-vu-5 h-full aspect-square transition-all duration-300">
      <div
        className={`grid ${gridSizeClasses[activeGridSize]} gap-vu-board h-full w-full`}
        style={{
          gridTemplateRows: `repeat(${activeGridSize}, 1fr)`,
          gridTemplateColumns: `repeat(${activeGridSize}, 1fr)`
        }}
        data-grid-size={activeGridSize}
        data-total-cells={processedCells.reduce((sum, row) => sum + row.length, 0)}
      >
        {processedCells.map((rowCells) =>
          rowCells.map(({
            cellKey, originalRowIndex, originalColIndex, cell, isValidTarget,
            isTargetingModeValidTarget, targetingModeActionMode, isNoTarget, cellFloatingTexts,
            cellVisualEffects,
          }) => (
            <div key={cellKey} className="relative w-full h-full min-w-0 min-h-0" data-row={originalRowIndex} data-col={originalColIndex}>
              <GridCell
                row={originalRowIndex}
                col={originalColIndex}
                cell={cell}
                isGameStarted={isGameStarted}
                activeGridSize={activeGridSize}
                handleDrop={handleDrop}
                draggedItem={draggedItem}
                setDraggedItem={setDraggedItem}
                openContextMenu={openContextMenu}
                playMode={playMode}
                setPlayMode={setPlayMode}
                playerColorMap={playerColorMap}
                localPlayerId={localPlayerId}
                onCardDoubleClick={onCardDoubleClick}
                onEmptyCellDoubleClick={onEmptyCellDoubleClick}
                imageRefreshVersion={imageRefreshVersion}
                cursorStack={cursorStack}
                currentPhase={currentPhase}
                activePlayerId={activePlayerId}
                onCardClick={onCardClick}
                onEmptyCellClick={onEmptyCellClick}
                isValidTarget={isValidTarget}
                isTargetingModeValidTarget={isTargetingModeValidTarget}
                targetingModePlayerId={targetingMode?.playerId}
                targetingModeOriginalOwnerId={targetingMode?.originalOwnerId}
                targetingModeActionMode={targetingModeActionMode}
                targetingMode={targetingMode}
                showNoTarget={isNoTarget}
                disableActiveHighlights={disableActiveHighlights}
                preserveDeployAbilities={preserveDeployAbilities}
                abilitySourceCoords={abilitySourceCoords}
                abilityCheckKey={abilityCheckKey}
                abilityMode={abilityMode}
                scoringLines={scoringLines}
                activePlayerIdForScoring={activePlayerIdForScoring}
                setCursorStack={setCursorStack}
                onCancelAllModes={onCancelAllModes}
                triggerClickWave={triggerClickWave}
                players={players}
                hoveredCell={hoveredCell}
                setHoveredCell={setHoveredCell}
                hideDummyCards={hideDummyCards}
              />
              {/* Legacy floating texts (for backward compatibility) */}
              {cellFloatingTexts.map(ft => (
                <FloatingTextOverlay
                  key={ft.id || `${ft.row}-${ft.col}-${ft.timestamp}`}
                  textData={ft}
                  playerColorMap={playerColorMap}
                />
              ))}
              {/* NEW: ID-based visual effects */}
              {cellVisualEffects.map(effect => (
                <VisualEffectOverlay
                  key={effect.id}
                  effect={effect}
                  playerColorMap={playerColorMap}
                />
              ))}
            </div>
          )),
        )}
{/* Temporary highlight for flash effects */}      {highlight && (        <div className={`absolute top-vu-board right-vu-board bottom-vu-board left-vu-board grid ${gridSizeClasses[activeGridSize]} gap-vu-board pointer-events-none z-20`}>          {HighlightContent}        </div>      )}
      </div>

    </div>
  )
})

GameBoard.displayName = 'GameBoard'
