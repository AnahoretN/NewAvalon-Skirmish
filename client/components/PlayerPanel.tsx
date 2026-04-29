/**
 * ===============================================================================
 * IMPORTANT GAME RULES - DO NOT MODIFY WITHOUT THOROUGH TESTING
 * ===============================================================================
 *
 * 1. CARD MOVEMENT RULE
 * --------------------
 * Cards can be moved ANYWHERE at ANY TIME during gameplay:
 * - From hand to deck, discard, showcase (announced), or battlefield
 * - From battlefield back to hand
 * - Between any valid drop targets
 *
 * This flexibility is intentional and essential for game mechanics.
 * NEVER modify drag/drop handlers in a way that restricts this movement.
 *
 * DropZone components handle card movement via handleDrop callback.
 * The draggedItem contains: { card, source, playerId, cardIndex?, isManual? }
 *
 * 2. DECK SELECTION VISUAL FEEDBACK RULE
 * ---------------------------------------
 * When player selects a deck from dropdown, it MUST update VISUALLY IMMEDIATELY:
 * - The dropdown must show the selected deck name highlighted
 * - No page reload required
 * - User must see their selection is confirmed
 *
 * REQUIREMENTS:
 * a) Memo function MUST include `player.selectedDeck` in comparison
 *    Without this, component won't re-render when deck changes
 *
 * b) Server merge logic (gameManagement.ts) MUST include `selectedDeck`
 *    In both trustClientCards=true and trustClientCards=false branches
 *
 * c) selectableDecks MUST use useMemo with deckFiles dependency
 *    Ensures component re-renders when deck database loads
 *
 * d) Dropdown should only render when selectableDecks.length > 0
 *    Prevents empty dropdown from breaking on first render
 *
 * 3. MEMO FUNCTION RULES
 * ----------------------
 * The memo comparison function MUST check all props that affect rendering:
 * - player.selectedDeck (CRITICAL for deck selection feedback)
 * - player.hand.length, deck.length, discard.length
 * - player.announcedCard?.id
 * - draggedItem (for drag/drop visual feedback)
 * - cursorStack (for targeting mode visual feedback)
 * - imageRefreshVersion, currentRound, etc.
 *
 * When adding new props that affect rendering, ALWAYS add them to memo comparison!
 *
 * 4. LOAD BUTTON POSITIONING RULE
 * -------------------------------
 * When Custom deck is selected, Load button appears:
 * - To the LEFT of the dropdown (not below)
 * - Gray style: bg-transparent border border-gray-500 hover:bg-gray-700
 * - File input should be hidden and triggered by button click
 *
 * ===============================================================================
 */

import React, { memo, useRef, useState, useEffect, useMemo, useCallback } from 'react'
import { DeckType as DeckTypeEnum } from '@/types'
import type { Player, PlayerColor, Card as CardType, DragItem, DropTarget, CustomDeckFile, ContextMenuParams, CursorStackState, TargetingModeData } from '@/types'
import { PLAYER_COLORS, GAME_ICONS } from '@/constants'
import { deckFiles } from '@/content'
import { Card as CardComponent } from './Card'
import { CardTooltipContent } from './Tooltip'
import { useLanguage } from '@/contexts/LanguageContext'
import { parseTextDeckFormat } from '@/utils/textDeckFormat'
import { calculateGlowColor, rgba, getPlayerColorRgbOrDefault, TIMING } from '@/utils/common'

// Вычисляем VU размер для шрифтов динамически
const getVuSize = (vu: number) => {
  const vuPixels = window.innerHeight / 1000
  return vu * vuPixels
}

// Track deck change deltas for each player
const deckChangeDeltas = new Map<number, { delta: number, timerId: NodeJS.Timeout }>()

type ContextMenuData =
  | { player: Player }
  | { card: CardType; player: Player }
  | { card: CardType; player: Player; cardIndex: number }

interface PlayerPanelProps {
  player: Player;
  isLocalPlayer: boolean;
  localPlayerId: number | null;
  isSpectator: boolean;
  isGameStarted: boolean;
  onNameChange: (name: string) => void;
  onColorChange: (color: PlayerColor) => void;
  onScoreChange: (delta: number) => void;
  onDeckChange: (deckType: DeckTypeEnum) => void;
  onLoadCustomDeck: (deckFile: CustomDeckFile) => void;
  onDrawCard: (playerId?: number) => void;
  handleDrop: (item: DragItem, target: DropTarget) => void;
  draggedItem: DragItem | null;
  setDraggedItem: (item: DragItem | null) => void;
  openContextMenu: (e: React.MouseEvent, type: ContextMenuParams['type'], data: ContextMenuData) => void;
  onHandCardDoubleClick: (player: Player, card: CardType, index: number) => void;
  playerColorMap: Map<number, PlayerColor>;
  allPlayers: Player[];
  localPlayerTeamId?: number;
  activePlayerId?: number | null; // Aligned with GameState type (null when no active player)
  _onToggleActivePlayer?: (playerId: number) => void;
  imageRefreshVersion: number;
  layoutMode: 'list-local' | 'list-remote';
  onCardClick?: (player: Player, card: CardType, index: number) => void;
  onCommandPlayClick?: (player: Player, card: CardType, index: number) => void; // New handler for command Play button
  validHandTargets?: { playerId: number, cardIndex: number }[];
  onAnnouncedCardDoubleClick?: (player: Player, card: CardType) => void;
  currentPhase: number;
  disableActiveHighlights?: boolean;
  preserveDeployAbilities?: boolean;
  roundWinners?: Record<number, number[]>;
  startingPlayerId?: number | null; // Aligned with GameState type (null when not set)
  currentRound?: number; // Force re-render when round changes
  onDeckClick?: (playerId: number) => void;
  isDeckSelectable?: boolean;
  hideDummyCards?: boolean; // If true, hide dummy player cards like real players
  deckSelections?: { playerId: number; selectedByPlayerId: number; timestamp: number }[];
  handCardSelections?: { playerId: number; cardIndex: number; selectedByPlayerId: number; timestamp: number }[];
  cursorStack?: CursorStackState | null;
  // Targeting mode from gameState (synchronized across all players)
  targetingMode?: TargetingModeData | null;
  highlightOwnerId?: number; // The owner of the current ability/mode (for correct highlight color)
  onCancelAllModes?: () => void; // Right-click to cancel all modes
  clickWaves?: any[]; // Click wave effects to display
  triggerClickWave?: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void;
}

const ColorPicker: React.FC<{ player: Player, canEditSettings: boolean, selectedColors: Set<PlayerColor>, onColorChange: (c: PlayerColor) => void, compact?: boolean }> = memo(({ player, canEditSettings, selectedColors, onColorChange, compact = false }) => {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const sizeClass = compact ? 'w-vu-btn-sm h-vu-btn-sm' : 'w-vu-icon-lg h-vu-icon-lg'
  const roundedClass = compact ? 'rounded-vu-2' : 'rounded-vu-2'
  const borderClass = compact ? 'border' : 'border-2'
  const borderColorClass = compact ? 'border-white/40' : 'border-gray-600'
  const paddingClass = compact ? 'p-0' : 'p-0'

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => canEditSettings && setIsOpen(!isOpen)}
        className={`${sizeClass} ${paddingClass} ${roundedClass} ${PLAYER_COLORS[player.color].bg} ${borderClass} ${borderColorClass} ${canEditSettings ? 'hover:border-white cursor-pointer' : 'cursor-default'} transition-all shadow-md flex items-center justify-center group flex-shrink-0`}
        title={canEditSettings ? "Change Color" : player.color}
      >
        {!compact && canEditSettings && (
          <svg className={`w-vu-btn-md h-vu-btn-md text-white/60 group-hover:text-white transition-colors drop-shadow-md`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-vu-md p-vu-md bg-gray-800 border border-gray-600 rounded-vu-2 shadow-xl z-50 grid grid-cols-4 gap-vu-md w-max animate-fade-in">
          {Object.keys(PLAYER_COLORS).map((colorKey) => {
            const color = colorKey as PlayerColor
            const isTaken = selectedColors.has(color) && player.color !== color
            const isCurrent = player.color === color

            return (
              <button
                key={color}
                onClick={() => {
                  if (!isTaken) {
                    onColorChange(color)
                    setIsOpen(false)
                  }
                }}
                disabled={isTaken}
                className={`w-vu-icon-lg h-vu-icon-lg rounded-vu-2 ${PLAYER_COLORS[color].bg} border-vu-base ${
                  isCurrent ? 'border-white ring-1 ring-white scale-110' :
                    isTaken ? 'border-transparent opacity-20 cursor-not-allowed' :
                      'border-transparent hover:border-white hover:scale-110 hover:shadow-lg'
                } transition-all duration-150`}
                title={color}
              />
            )
          })}
        </div>
      )}
    </div>
  )
})

const DropZone: React.FC<{ onDrop: () => void, className?: string, isOverClassName?: string, children: React.ReactNode, onContextMenu?: (e: React.MouseEvent) => void }> = ({ onDrop, className, isOverClassName, children, onContextMenu }) => {
  const [isOver, setIsOver] = useState(false)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsOver(true)
      }}
      onDragLeave={(e) => {
        e.stopPropagation()
        setIsOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setIsOver(false)
        onDrop()
      }}
      onContextMenu={onContextMenu}
      className={`${className || ''} ${isOver ? `relative z-10 ${isOverClassName || ''}` : ''}`}
    >
      {children}
    </div>
  )
}

const RemoteScore: React.FC<{ score: number, onChange: (delta: number) => void, canEdit: boolean }> = ({ score, onChange, canEdit }) => {
  // Local state for immediate feedback effect
  const [pendingDelta, setPendingDelta] = useState(0)
  const [effectKey, setEffectKey] = useState(0)  // Key for triggering re-renders
  const [externalDelta, setExternalDelta] = useState(0)  // Server-initiated changes
  const pendingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const pendingDeltaRef = useRef(0)  // Ref to preserve value through server updates
  const prevScoreRef = useRef(score)
  const expectingServerUpdateRef = useRef(false)  // Flag to track if we're waiting for server response

  // Use effectKey to prevent unused variable warning (it's used to trigger re-renders)
  void effectKey

  // Detect score changes from server (scoring effects)
  useEffect(() => {
    if (prevScoreRef.current !== score) {
      const delta = score - prevScoreRef.current
      let cleanupTimer: NodeJS.Timeout | undefined

      // Only show external delta if we're not expecting a response from manual changes
      if (!expectingServerUpdateRef.current) {
        setExternalDelta(delta)
        setEffectKey(prev => prev + 1)
        // Clear external delta effect after animation
        cleanupTimer = setTimeout(() => {
          setExternalDelta(0)
        }, 1500)
      } else {
        // We were expecting this update from our manual changes
        expectingServerUpdateRef.current = false
      }

      // Always update prevScoreRef
      prevScoreRef.current = score

      // Return cleanup if timer was set
      if (cleanupTimer) {
        return () => clearTimeout(cleanupTimer)
      }
    }
    return undefined
  }, [score])

  const handleScoreChange = (delta: number) => {
    if (!canEdit) {return;}

    // Immediately update local accumulation (shown separately, not added to main score)
    const newDelta = pendingDeltaRef.current + delta
    pendingDeltaRef.current = newDelta
    setPendingDelta(newDelta)
    setEffectKey(prev => prev + 1)

    // Clear existing timer
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current)
    }

    // Start new timer - after 250ms of no clicks, send to server and clear delta
    pendingTimerRef.current = setTimeout(() => {
      const finalDelta = pendingDeltaRef.current
      if (finalDelta !== 0) {
        expectingServerUpdateRef.current = true  // Mark that we're expecting server response
        onChange(finalDelta)
      }
      // Clear both state and ref
      pendingDeltaRef.current = 0
      setPendingDelta(0)
    }, 250)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current)
      }
    }
  }, [])

  // Show pending delta or external delta
  const showDelta = pendingDelta !== 0 || externalDelta !== 0
  const deltaToShow = externalDelta !== 0 ? externalDelta : pendingDelta

  return (
    <div className="w-full h-full aspect-square bg-gray-800 rounded-vu-5 flex flex-col items-center text-white select-none overflow-hidden">
      <button
        onClick={() => handleScoreChange(1)}
        disabled={!canEdit}
        className="h-1/3 w-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 active:bg-gray-500 transition-colors font-bold disabled:opacity-50 disabled:cursor-default leading-none"
        style={{ fontSize: `${getVuSize(20)}px` }}
      >
        +
      </button>
      <div className="h-1/3 flex items-center justify-center font-bold w-full px-px">
        <div className="relative">
          <span className="font-bold relative inline-block" style={{ fontSize: `${getVuSize(20)}px` }}>{score}</span>
          {showDelta && (
            <span className="absolute font-bold" style={{ fontSize: `${getVuSize(20)}px`, marginLeft: `${getVuSize(2)}px`, left: '100%', top: '0', bottom: '0', margin: 'auto 0 0 0' }}>
              {deltaToShow > 0 ? `+${deltaToShow}` : deltaToShow}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => handleScoreChange(-1)}
        disabled={!canEdit}
        className="h-1/3 w-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 active:bg-gray-500 transition-colors font-bold disabled:opacity-50 disabled:cursor-default leading-none"
        style={{ fontSize: `${getVuSize(20)}px` }}
      >
        -
      </button>
    </div>
  )
}

const RemotePile: React.FC<{ label: string, count: number, onClick?: () => void, children?: React.ReactNode, className?: string, style?: React.CSSProperties, delta?: number | null, dataDeck?: number }> = ({ label, count, onClick, children, className, style, delta, dataDeck }) => (
  <div
    onClick={onClick}
    data-deck={dataDeck}
    className={`w-full h-full rounded flex items-center justify-center cursor-pointer hover:ring-2 ring-indigo-400 transition-all shadow-sm select-none text-white border border-gray-600 relative overflow-hidden ${className || ''}`}
    style={style}
  >
    {children ? children : (
      <div className="flex flex-col items-center">
        <span className="font-bold mb-vu-3 opacity-80 uppercase tracking-tighter text-vu-16">{label}</span>
        <div className="relative">
          <span className="font-bold relative inline-block text-vu-20">{count}</span>
          {delta !== null && delta !== undefined && (
            <span className="absolute font-bold text-vu-20 ml-vu-min" style={{ left: '100%', top: '0', bottom: '0', margin: 'auto 0 0 0' }}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
          )}
        </div>
      </div>
    )}
  </div>
)

const PlayerPanel: React.FC<PlayerPanelProps> = memo(({
  player,
  isLocalPlayer,
  localPlayerId,
  isGameStarted,
  onNameChange,
  onColorChange,
  onScoreChange,
  onDeckChange,
  onLoadCustomDeck,
  onDrawCard,
  handleDrop,
  draggedItem,
  setDraggedItem,
  openContextMenu,
  onHandCardDoubleClick,
  playerColorMap,
  allPlayers,
  localPlayerTeamId,
  activePlayerId,
  // _onToggleActivePlayer is reserved for future use but not yet implemented
  imageRefreshVersion,
  layoutMode,
  onCardClick,
  onCommandPlayClick,
  onAnnouncedCardDoubleClick,
  currentPhase,
  disableActiveHighlights,
  preserveDeployAbilities = false,
  roundWinners,
  startingPlayerId,
  onDeckClick,
  isDeckSelectable,
  deckSelections = [],
  handCardSelections = [],
  cursorStack = null,
  targetingMode = null,
  highlightOwnerId,
  onCancelAllModes,
  clickWaves = [],
  triggerClickWave,
  hideDummyCards = false,
}) => {
  const { t, resources } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Helper: Handle context menu with mode cancellation
  const handleContextMenuWithCancel = useCallback((e: React.MouseEvent, type: ContextMenuParams['type'], data: ContextMenuData) => {
    // Right-click cancels all targeting/ability modes for all players
    if (onCancelAllModes) {
      onCancelAllModes()
    }
    openContextMenu(e, type, data)
  }, [openContextMenu, onCancelAllModes])

  // Helper: Get effective deck size
  // Use deckSize metadata for WebRTC optimized states where deck array may not be populated
  const getDeckSize = useCallback((): number => {
    // If deck array exists and is populated (has cards), use its length (source of truth for local player)
    if (player.deck && player.deck.length > 0) {
      return player.deck.length
    }
    // Otherwise use deckSize metadata (for remote players in WebRTC)
    if (player.deckSize !== undefined) {
      return player.deckSize
    }
    return 0
  }, [player.deck, player.deckSize])

  // Helper: Get effective discard size
  // Use discardSize metadata for WebRTC optimized states where discard array may not be populated
  const getDiscardSize = useCallback((): number => {
    // If discard array exists and is populated (has cards), use its length (source of truth for local player)
    if (player.discard && player.discard.length > 0) {
      return player.discard.length
    }
    // Otherwise use discardSize metadata (for remote players in WebRTC)
    if (player.discardSize !== undefined) {
      return player.discardSize
    }
    return 0
  }, [player.discard, player.discardSize])

  const prevDeckLengthRef = useRef<number>(getDeckSize())

  // State for deck change indicator (+/- number)
  const [deckChangeDelta, setDeckChangeDelta] = useState<number | null>(null)
  // Key for forcing re-render of delta animation (resets opacity to 100%)
  const [deckChangeKey, setDeckChangeKey] = useState(0)

  const canPerformActions: boolean = isLocalPlayer || !!player.isDummy

  // Use deckChangeKey to prevent unused variable warning (it's used to trigger re-renders)
  void deckChangeKey
  const canDrag: boolean = canPerformActions && !cursorStack

  const isPlayerActive = activePlayerId === player.id
  // FIX: Check localPlayerTeamId is NOT null/undefined to avoid treating all players as teammates in FFA
  // In FFA mode, all players have teamId: undefined, which would make isTeammate true for everyone
  const isTeammate = localPlayerTeamId !== null && player.teamId === localPlayerTeamId && !isLocalPlayer
  const isDisconnected = !!player.isDisconnected

  // Helper: Handle command Play button click
  const handleCommandPlayClick = useCallback((card: CardType, index: number) => {
    if (onCommandPlayClick && canPerformActions) {
      onCommandPlayClick(player, card, index)
    }
  }, [onCommandPlayClick, player, canPerformActions])

  // Reconnection countdown timer state
  const [reconnectTimeLeft, setReconnectTimeLeft] = useState<number>(0)

  // Update countdown timer every second when player is disconnected
  useEffect(() => {
    if (!isDisconnected || !player.reconnectionDeadline) {
      setReconnectTimeLeft(0)
      return
    }

    // Initial calculation
    const calculateTimeLeft = () => {
      return Math.max(0, Math.ceil((player.reconnectionDeadline! - Date.now()) / 1000))
    }

    setReconnectTimeLeft(calculateTimeLeft())

    // Update every second
    const interval = setInterval(() => {
      const timeLeft = calculateTimeLeft()
      setReconnectTimeLeft(timeLeft)
      if (timeLeft <= 0) {
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [isDisconnected, player.reconnectionDeadline])

  // deckFiles dependency is intentional - re-renders when deck database loads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selectableDecks = useMemo(() => deckFiles.filter(df => df.isSelectable), [deckFiles])
  const selectedColors = useMemo(() => new Set(allPlayers.map(p => p.color)), [allPlayers])

  const winCount = roundWinners ? Object.values(roundWinners).filter(winners => winners.includes(player.id)).length : 0
  const isFirstPlayer = startingPlayerId === player.id
  const firstPlayerIconUrl = GAME_ICONS.FIRST_PLAYER
  const ROUND_WIN_MEDAL_URL = GAME_ICONS.ROUND_WIN_MEDAL

  // Track deck count changes and show delta indicator
  useEffect(() => {
    const prevLength = prevDeckLengthRef.current
    const currentLength = getDeckSize()

    if (prevLength !== currentLength) {
      const delta = currentLength - prevLength
      prevDeckLengthRef.current = currentLength

      // Accumulate delta if there's already a pending change (within 500ms)
      const existing = deckChangeDeltas.get(player.id)
      if (existing) {
        clearTimeout(existing.timerId)
        const newDelta = existing.delta + delta
        setDeckChangeDelta(newDelta)
        setDeckChangeKey(prev => prev + 1) // Reset animation
        const timerId = setTimeout(() => {
          setDeckChangeDelta(null)
          deckChangeDeltas.delete(player.id)
        }, 500)
        deckChangeDeltas.set(player.id, { delta: newDelta, timerId })
      } else {
        setDeckChangeDelta(delta)
        setDeckChangeKey(prev => prev + 1) // Reset animation
        const timerId = setTimeout(() => {
          setDeckChangeDelta(null)
          deckChangeDeltas.delete(player.id)
        }, 500)
        deckChangeDeltas.set(player.id, { delta, timerId })
      }
    }
  }, [player.deck.length, player.id, getDeckSize])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const existingDeck = deckChangeDeltas.get(player.id)
      if (existingDeck) {
        clearTimeout(existingDeck.timerId)
        deckChangeDeltas.delete(player.id)
      }
    }
  }, [player.id])

  // Force re-render on window resize to update VU-based sizes
  const [, forceUpdate] = useState({})
  useEffect(() => {
    const handleResize = () => {
      forceUpdate({})
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleDeckSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onDeckChange(e.target.value as DeckTypeEnum)
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string

        // Try text deck format
        const validation = parseTextDeckFormat(text)
        if (!validation.isValid) {
          alert((validation as { error: string }).error)
          return
        }

        const { deckFile } = validation
        onLoadCustomDeck(deckFile)

      } catch (err) {
        alert('Failed to parse deck file.')
      }
    }
    reader.readAsText(file)
  }

  const handleLoadDeckClick = () => {
    fileInputRef.current?.click()
  }

  const handleDeckInteraction = () => {
    if (isDeckSelectable && onDeckClick) {
      onDeckClick(player.id)
    } else if (canPerformActions) {
      // For dummy players, pass their ID so they draw the card
      // For local player, don't pass ID - they will draw for themselves
      if (player.isDummy) {
        onDrawCard(player.id)
      } else {
        onDrawCard()
      }
    }
  }

  if (layoutMode === 'list-local') {
    const borderClass = isPlayerActive ? 'border-yellow-400' : 'border-gray-700'

    return (
      <div className={`w-full h-full flex flex-col p-vu-panel bg-panel-bg border-2 ${borderClass} rounded-vu-5 shadow-2xl ${isDisconnected ? 'opacity-60' : ''} relative`}>
        {/* Header: ColorPicker + Name + Win Medals + First Player Star + ActiveIndicator (name takes all available space) */}
        <div className="flex items-center gap-vu-md mb-vu-min flex-shrink-0">
          <ColorPicker player={player} canEditSettings={!isGameStarted && canPerformActions} selectedColors={selectedColors} onColorChange={onColorChange} />
          <div className="flex-grow relative flex items-center min-w-0">
            <input type="text" value={player.name} onChange={(e) => onNameChange(e.target.value)} readOnly={isGameStarted || !canPerformActions} className="bg-transparent font-bold text-vu-2xl p-vu-min flex-grow focus:bg-gray-800 rounded focus:outline-none border-b border-gray-600 text-white truncate" />
          </div>
          {/* Win medals - between name and first player star */}
          {winCount > 0 && Array.from({ length: winCount }).map((_, i) => (
            <img key={`win-${i}`} src={ROUND_WIN_MEDAL_URL} alt="Round Winner" className="drop-shadow-md flex-shrink-0" title="Round Winner" style={{ width: `${getVuSize(32)}px`, height: `${getVuSize(32)}px` }} />
          ))}
          {/* First player star - between win medals and active indicator */}
          {isFirstPlayer && (
            <img src={firstPlayerIconUrl} alt="First Player" className="drop-shadow-md flex-shrink-0" title="First Player" style={{ width: `${getVuSize(32)}px`, height: `${getVuSize(32)}px` }} />
          )}
          {/* Active Player Indicator */}
          <div
            className="flex-shrink-0 transition-all duration-200"
            title={isPlayerActive ? "Active Player" : "Inactive Player"}
          >
            <svg
              style={{ width: `${getVuSize(32)}px`, height: `${getVuSize(32)}px` }}
              viewBox="0 0 28 28"
              className={`transition-all duration-200 ${
                isPlayerActive
                  ? 'drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]'
                  : 'opacity-40'
              }`}
            >
              {/* Outer ring */}
              <circle
                cx="14"
                cy="14"
                r="12"
                fill="none"
                strokeWidth="2.5"
                className={isPlayerActive ? 'stroke-yellow-400' : 'stroke-gray-500'}
              />
              {/* Inner circle */}
              <circle
                cx="14"
                cy="14"
                r="6"
                className={isPlayerActive ? 'fill-yellow-400' : 'fill-gray-600'}
              />
              {/* Glow effect when active */}
              {isPlayerActive && (
                <circle
                  cx="14"
                  cy="14"
                  r="9"
                  fill="none"
                  stroke="rgba(250, 204, 21, 0.5)"
                  strokeWidth="2"
                  className="stroke-yellow-300 opacity-50 animate-pulse"
                />
              )}
            </svg>
          </div>
        </div>

        <div className="bg-gray-800 p-vu-min rounded-vu-5 mb-1 flex-shrink-0">
          <div className="grid grid-cols-4 gap-vu-min sm:gap-vu-md">
            {/* Deck */}
            <DropZone className="relative" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'deck', playerId: player.id, deckPosition: 'top' })} onContextMenu={(e) => handleContextMenuWithCancel(e, 'deckPile', { player })} isOverClassName="rounded-vu-5 ring-2 ring-white">
              {(() => {
                // Check if deck is selectable (either from local player or from targetingMode)
                const isLocalDeckSelectable = isDeckSelectable
                const isTargetingModeDeckSelectable = targetingMode?.isDeckSelectable ?? false
                const isDeckSelectableActive = isLocalDeckSelectable || isTargetingModeDeckSelectable

                // Use targeting player's color for the selection effect
                // If targetingMode is active, use that player's color, otherwise use activePlayerId
                const targetPlayerId = targetingMode?.playerId ?? activePlayerId
                const activePlayerColorName = targetPlayerId !== null && targetPlayerId !== undefined ? playerColorMap.get(targetPlayerId) : null
                const rgb = getPlayerColorRgbOrDefault(activePlayerColorName, { r: 37, g: 99, b: 235 })
                const deckHighlightStyle = isDeckSelectableActive ? {
                  boxShadow: `0 0 12px 2px ${rgba(calculateGlowColor(rgb), 0.5)}`,
                  border: '3px solid rgb(255, 255, 255)',
                } : {}

                // Find recent deck selection for this player (within last 1 second)
                const now = Date.now()
                const recentSelection = deckSelections?.find(
                  ds => ds.playerId === player.id && (now - ds.timestamp) < 1000
                )
                // Use the selecting player's color for the ripple
                const selectionColorName = recentSelection?.selectedByPlayerId
                  ? playerColorMap.get(recentSelection.selectedByPlayerId)
                  : null
                const selectionRgb = getPlayerColorRgbOrDefault(selectionColorName, rgb)

                return (
                  <div className="relative aspect-square">
                    {/* Highlight overlay - doesn't interfere with deck visibility */}
                    {isDeckSelectableActive && (
                      <div
                        className="absolute inset-0 rounded-vu-5 pointer-events-none animate-glow-pulse"
                        style={{
                          zIndex: 10,
                          background: `radial-gradient(circle at center, transparent 30%, ${rgba(rgb, 0.4)} 100%)`,
                        }}
                      />
                    )}
                    {/* Ripple effect when deck is selected */}
                    {recentSelection && (
                      <div
                        className="absolute inset-0 rounded-vu-5 pointer-events-none animate-deck-selection"
                        style={{
                          zIndex: 15,
                          border: '3px solid',
                          borderColor: `rgb(${selectionRgb.r}, ${selectionRgb.g}, ${selectionRgb.b})`,
                          background: `radial-gradient(circle at center, transparent 20%, ${rgba(selectionRgb, 0.6)} 100%)`,
                        }}
                      />
                    )}
                    <div
                      onClick={handleDeckInteraction}
                      data-deck={player.id}
                      className={`absolute inset-0 rounded-vu-5 flex items-center justify-center cursor-pointer hover:ring-2 ring-indigo-400 transition-all shadow-md select-none text-white ${PLAYER_COLORS[player.color]?.bg || 'bg-card-back'}`}
                      style={deckHighlightStyle}
                    >
                      <div className="flex flex-col items-center relative z-20">
                        <span className="font-bold mb-vu-3 uppercase tracking-tight text-vu-16">{t('deck')}</span>
                        <div className="relative">
                          <span className="font-bold relative inline-block text-vu-20">{getDeckSize()}</span>
                          {deckChangeDelta !== null && (
                            <span className="absolute font-bold z-40 text-vu-20 ml-vu-min" style={{ left: '100%', top: '0', bottom: '0', margin: 'auto 0 0 0' }}>
                              {deckChangeDelta > 0 ? `+${deckChangeDelta}` : deckChangeDelta}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </DropZone>

            {/* Discard */}
            <DropZone onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'discard', playerId: player.id })} onContextMenu={(e) => handleContextMenuWithCancel(e, 'discardPile', { player })} isOverClassName="rounded-vu-5 ring-2 ring-white">
              <div className="aspect-square bg-gray-700 rounded-vu-5 flex items-center justify-center cursor-pointer hover:bg-gray-600 transition-all shadow-md border border-gray-600 select-none text-white">
                <div className="flex flex-col items-center">
                  <span className="font-bold mb-vu-3 text-gray-400 uppercase tracking-tight text-vu-16">{t('discard')}</span>
                  <span className="font-bold text-vu-20">{getDiscardSize()}</span>
                </div>
              </div>
            </DropZone>

            {/* Showcase */}
            <div className="aspect-square relative">
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'announced', playerId: player.id })} isOverClassName="rounded-vu-5 ring-2 ring-white">
                <div className="w-full h-full bg-gray-800 border border-dashed border-gray-600 rounded-vu-5 flex items-center justify-center relative overflow-hidden">
                  {player.announcedCard ? (
                    <div
                      className="w-full h-full p-1 cursor-pointer"
                      draggable={canDrag}
                      onDragStart={(e) => {
                        if (canDrag) {
                          setDraggedItem({
                            card: player.announcedCard!,
                            source: 'announced',
                            playerId: player.id,
                            isManual: true
                          })
                          // Set custom drag image to only include the card, not tooltip
                          const cardElement = e.currentTarget.querySelector('[data-card-image]')
                          if (cardElement) {
                            e.dataTransfer.setDragImage(cardElement as Element, 20, 20)
                          }
                        }
                      }}
                      onDragEnd={() => { setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK) }}
                      onContextMenu={(e) => canPerformActions && player.announcedCard && handleContextMenuWithCancel(e, 'announcedCard', {
                        card: player.announcedCard,
                        player
                      })}
                      onDoubleClick={() => onAnnouncedCardDoubleClick?.(player, player.announcedCard!)}
                    >
                      <div data-card-image="true" className="w-full h-full">
                        <CardComponent
                        card={player.announcedCard}
                        isFaceUp={true}
                        playerColorMap={playerColorMap}
                        playerColor={player.color}
                        imageRefreshVersion={imageRefreshVersion}
                        loadPriority={isLocalPlayer ? 'high' : 'low'}
                        activePhaseIndex={currentPhase}
                        activePlayerId={activePlayerId}
                        disableActiveHighlights={disableActiveHighlights}
                        preserveDeployAbilities={preserveDeployAbilities}
                        disableImageTransition={true}
                        />
                      </div>
                    </div>
                  ) : <span className="font-bold text-gray-500 select-none uppercase tracking-tight text-vu-16">{t('showcase')}</span>}
                </div>
              </DropZone>
            </div>

            {/* Score */}
            <RemoteScore
              score={player.score}
              onChange={onScoreChange}
              canEdit={canPerformActions}
            />
          </div>
        </div>

        {!isGameStarted && canPerformActions && selectableDecks.length > 0 && (
          <div className="mb-[3px] flex-shrink-0 text-white">
            <input type="file" ref={fileInputRef} onChange={handleFileSelected} accept=".txt" className="hidden" />
            {player.selectedDeck === DeckTypeEnum.Custom ? (
              <div className="flex gap-2">
                <button onClick={handleLoadDeckClick} className="bg-transparent border border-gray-500 hover:bg-gray-700 px-4 py-1.5 rounded font-bold">{t('loadDeck')}</button>
                <select value={player.selectedDeck} onChange={handleDeckSelectChange} className="flex-grow bg-gray-700 border border-gray-600 rounded p-1">
                  {selectableDecks.map((deck: { id: DeckTypeEnum; name: string; isSelectable: boolean }) => <option key={deck.id} value={deck.id}>{resources.deckNames[deck.id as keyof typeof resources.deckNames] || deck.name}</option>)}
                  <option value={DeckTypeEnum.Custom}>{player.customDeckName || t('customDeck')}</option>
                </select>
              </div>
            ) : (
              <select value={player.selectedDeck} onChange={handleDeckSelectChange} className="w-full bg-gray-700 border border-gray-600 rounded p-2 mb-2">
                {selectableDecks.map((deck: { id: DeckTypeEnum; name: string; isSelectable: boolean }) => <option key={deck.id} value={deck.id}>{resources.deckNames[deck.id as keyof typeof resources.deckNames] || deck.name}</option>)}
                <option value={DeckTypeEnum.Custom}>{player.customDeckName || t('customDeck')}</option>
              </select>
            )}
          </div>
        )}

        <div className="flex-grow flex flex-col min-h-0">
          <DropZone onDrop={() => {
            if (draggedItem) {
              handleDrop(draggedItem, { target: 'hand', playerId: player.id })
              setDraggedItem(null)
            }
          }} className="flex-grow bg-gray-800 rounded-vu-5 p-2 overflow-y-scroll custom-scrollbar">
            <div className="flex flex-col gap-[2px]">
              {(() => {
                // For local players, use actual hand cards
                // For remote players in WebRTC mode, hand is now populated with baseId data from CARD_STATE
                // so we can use player.hand directly
                const cardsToRender = player.hand || []

                // OPTIMIZATION: Create lookup Map for click waves instead of filtering for each card
                // Changes complexity from O(cards * waves) to O(waves) + O(cards)
                const clickWavesMap = new Map<string, any[]>()
                if (clickWaves) {
                  for (const wave of clickWaves) {
                    if (wave.location === 'hand' && wave.handTarget?.playerId === player.id) {
                      const key = `${player.id}-${wave.handTarget.cardIndex}`
                      if (!clickWavesMap.has(key)) {
                        clickWavesMap.set(key, [])
                      }
                      clickWavesMap.get(key)!.push(wave)
                    }
                  }
                }

                return cardsToRender.map((card, index) => {
                  // Check if this card is a valid target from GLOBAL targetingMode only
                  // NO LOCAL effects - all highlights must be synchronized across all players
                  const isTarget = targetingMode?.handTargets?.some(t => t.playerId === player.id && t.cardIndex === index)

                  // Use targeting player's color for the highlight
                  // If targetingMode is active, use that player's color, otherwise use highlightOwnerId or activePlayerId
                  const targetPlayerId = targetingMode?.playerId ?? (highlightOwnerId ?? activePlayerId)
                  const activePlayerColorName = targetPlayerId !== null && targetPlayerId !== undefined ? playerColorMap.get(targetPlayerId) : null
                  const rgb = getPlayerColorRgbOrDefault(activePlayerColorName, { r: 37, g: 99, b: 235 })

                  // Find recent hand card selection for this card (within last 1 second)
                  const now = Date.now()
                  const recentSelection = handCardSelections?.find(
                    cs => cs.playerId === player.id && cs.cardIndex === index && (now - cs.timestamp) < 1000
                  )

                  // OPTIMIZATION: Use Map lookup instead of filtering - O(1) instead of O(n)
                  // NOTE: cardClickWaves is currently unused (React wave disabled, using instant direct DOM approach only)
                  // const cardClickWaves = clickWavesMap.get(`${player.id}-${index}`) || []

                  // Card container style with highlight if target
                  const cardContainerStyle = isTarget ? {
                    boxShadow: `0 0 12px 2px ${rgba(calculateGlowColor(rgb), 0.5)}`,
                    border: '3px solid rgb(255, 255, 255)',
                  } : {}

                  const isPlaceholder = (card as any)._isPlaceholder
                  const isRealCard = !isPlaceholder
                  const realCard = card as CardType

                  // Card visibility logic for Revealed status
                  const isRevealedToAll = realCard.revealedTo === 'all'
                  const isRevealedToMe = localPlayerId !== null &&
                    Array.isArray(realCard.revealedTo) &&
                    realCard.revealedTo.includes(localPlayerId)
                  const isRevealedByStatus = isRealCard && localPlayerId !== null &&
                    realCard.statuses?.some((s: any) => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)

                  const isOwner = isLocalPlayer || localPlayerId === card.ownerId

                  // Visibility rules:
                  // - Owner sees their own cards face-up
                  // - Player who placed Revealed token sees the card face-up
                  // - Everyone else sees card back (colored by card owner)
                  // - Dummy player cards: HIDDEN (face-down) when hideDummyCards is true, regardless of other rules
                  //   Otherwise visible to all players when hideDummyCards setting is off
                  const isVisible: boolean = (player.isDummy && hideDummyCards) ? false :
                    (isOwner || isTeammate || !!isRevealedToAll || !!isRevealedToMe || !!isRevealedByStatus ||
                    (!hideDummyCards && !!player.isDummy))

                  return (
                    <div
                      key={`card-${card.id}-${index}`}
                      className="relative"
                      data-hand-card={`${player.id},${index}`}
                    >
                      {/* Highlight overlay - doesn't interfere with card visibility */}
                      {isTarget && (
                        <div
                          className="absolute inset-0 rounded-vu-5 pointer-events-none animate-glow-pulse"
                          style={{
                            zIndex: 10,
                            background: `radial-gradient(circle at center, transparent 30%, ${rgba(rgb, 0.4)} 100%)`,
                          }}
                        />
                      )}
                      {/* Ripple effect when card is selected */}
                      {recentSelection && (
                        <div
                          className="absolute inset-0 rounded-vu-5 pointer-events-none animate-deck-selection"
                          style={{
                            zIndex: 15,
                            border: '3px solid',
                            borderColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                            background: `radial-gradient(circle at center, transparent 20%, ${rgba(rgb, 0.6)} 100%)`,
                          }}
                        />
                      )}
                      <div
                        className={`flex items-center bg-gray-900 rounded-vu-5 p-2 min-w-0`}
                        style={cardContainerStyle}
                        draggable={canDrag && !isPlaceholder}
                        onDragStart={(e) => {
                          if (canDrag && !isPlaceholder) {
                            setDraggedItem({
                              card,
                              source: 'hand',
                              playerId: player.id,
                              cardIndex: index,
                              isManual: true
                            })
                            // Set custom drag image to only include the card, not tooltip
                            const cardElement = e.currentTarget.querySelector('[data-card-image]')
                            if (cardElement) {
                              e.dataTransfer.setDragImage(cardElement as Element, 20, 20)
                            }
                          }
                        }}
                        onDragEnd={() => { setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK) }}
                        onContextMenu={(e) => canPerformActions && !isPlaceholder && handleContextMenuWithCancel(e, 'handCard', {
                          card,
                          player,
                          cardIndex: index
                        })}
                        onDoubleClick={() => !isPlaceholder && onHandCardDoubleClick(player, card, index)}
                        onClick={() => {
                          if (!isPlaceholder) {
                            // Trigger click wave for hand cards
                            if (triggerClickWave && localPlayerId !== null) {
                              triggerClickWave('hand', undefined, { playerId: player.id, cardIndex: index })
                            }
                            onCardClick?.(player, card, index)
                          }
                        }}
                        data-hand-card={`${player.id},${index}`}
                        data-interactive="true"
                      >
                        <div className="aspect-square flex-shrink-0 mr-3 w-[28.75%] max-w-[230px] min-w-[40px] overflow-hidden rounded-vu-5">
                          <div data-card-image="true" className="w-full h-full">
                            {isPlaceholder ? (
                              // Show card back for placeholder cards (remote players in WebRTC)
                              // CRITICAL: Preserve card.ownerId so Card component can get correct color from playerColorMap
                              <CardComponent
                              card={{
                                ...card,
                                id: card.id,
                                baseId: card.baseId,
                                name: card.name || '',  // Use placeholder name (empty string), not 'Hidden Card'
                                ownerId: card.ownerId || player.id,  // Preserve real card owner, fallback to player id
                                deck: card.deck || (DeckTypeEnum.Random as const),
                                imageUrl: card.imageUrl || '',
                                abilityText: card.abilityText || '',
                              }}
                              isFaceUp={isVisible}
                              playerColorMap={playerColorMap}
                              localPlayerId={localPlayerId}
                              imageRefreshVersion={imageRefreshVersion}
                              loadPriority="low"
                              disableTooltip={true}
                              disableActiveHighlights={true}
                              preserveDeployAbilities={false}
                              disableImageTransition={true}
                              playerColor={player.color}
                              showCommandPlayButton={false} // Never show for placeholder/remote cards
                              onCommandPlayClick={() => handleCommandPlayClick(card, index)}
                            />
                          ) : (
                            <CardComponent
                              card={card}
                              isFaceUp={isVisible}
                              playerColorMap={playerColorMap}
                              localPlayerId={localPlayerId}
                              imageRefreshVersion={imageRefreshVersion}
                              loadPriority={isLocalPlayer ? 'high' : 'low'}
                              disableTooltip={true}
                              disableActiveHighlights={disableActiveHighlights}
                              preserveDeployAbilities={preserveDeployAbilities}
                              disableImageTransition={true}
                              playerColor={player.color}
                              showCommandPlayButton={isLocalPlayer} // Only show for local player's hand
                              onCommandPlayClick={() => handleCommandPlayClick(card, index)}
                            />
                          )}
                          </div>
                        </div>
                        <div className="flex-grow min-w-0">
                          {!isPlaceholder && (
                            <CardTooltipContent
                              card={card}
                              className="relative flex flex-col text-left w-full h-full justify-start whitespace-normal break-words"
                              hideOwner={card.ownerId === player.id}
                            />
                          )}
                        </div>
                      </div>
                      {/* React wave disabled - using instant direct DOM approach only */}
                      {/* {cardClickWaves.map(wave => (
                        <ClickWaveComponent
                          key={wave.timestamp}
                          timestamp={wave.timestamp}
                          playerColor={wave.playerColor}
                        />
                      ))} */}
                    </div>
                  )
                })
              })()}
            </div>
          </DropZone>
        </div>

        {/* Reconnection Overlay */}
        {isDisconnected && player.reconnectionDeadline && (
          <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center z-40 rounded-vu-5">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-2"></div>
              <div className="text-white font-bold">{t('reconnecting')}</div>
              <div className="text-gray-300 text-sm">
                {reconnectTimeLeft}s
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (layoutMode === 'list-remote') {
    const borderClass = isPlayerActive ? 'border-yellow-400' : 'border-gray-700'
    return (
      <div className={`w-full h-full flex flex-col p-1 pt-[3px] bg-panel-bg border-2 ${borderClass} rounded-vu-2 shadow-xl ${isDisconnected ? 'opacity-60' : ''} relative`}>
        {/* Header: Color + Name + Deck Select + Status Icons - all in one row */}
        <div className="flex items-center gap-1 px-1 min-h-[20px] mt-[2px] relative z-10">
          {/* Color picker - compact for remote panels */}
          <ColorPicker player={player} canEditSettings={!isGameStarted && canPerformActions} selectedColors={selectedColors} onColorChange={onColorChange} compact={true} />
          {/* Name - larger font */}
          <span className="font-bold text-white text-[14px] truncate leading-tight flex-1 min-w-0 relative z-10">{player.name}</span>
          {/* Status icons and deck select - aligned right */}
          <div className="flex items-center gap-[2px] flex-shrink-0">
            {/* Deck select with Load button for Custom deck - shown before status icons */}
            {!isGameStarted && canPerformActions && selectableDecks.length > 0 && (
              player.selectedDeck === DeckTypeEnum.Custom ? (
                <>
                  <input type="file" ref={fileInputRef} onChange={handleFileSelected} accept=".txt" className="hidden" />
                  <button onClick={handleLoadDeckClick} className="text-[11px] bg-transparent border border-gray-500 hover:bg-gray-700 text-white rounded px-1 py-0 h-5 flex-shrink-0">{t('loadDeck')}</button>
                  <select
                    value={player.selectedDeck}
                    onChange={handleDeckSelectChange}
                    className="text-[11px] bg-gray-700 text-white border border-gray-600 rounded px-1 py-0 h-5 w-[90px] focus:outline-none truncate flex-shrink-0"
                  >
                    {selectableDecks.map((deck: { id: DeckTypeEnum; name: string; isSelectable: boolean }) => <option key={deck.id} value={deck.id}>{resources.deckNames[deck.id as keyof typeof resources.deckNames] || deck.name}</option>)}
                    <option value={DeckTypeEnum.Custom}>{player.customDeckName || t('customDeck')}</option>
                  </select>
                </>
              ) : (
                <select
                  value={player.selectedDeck}
                  onChange={handleDeckSelectChange}
                  className="text-[11px] bg-gray-700 text-white border border-gray-600 rounded px-1 py-0 h-5 w-[110px] focus:outline-none truncate flex-shrink-0"
                >
                  {selectableDecks.map((deck: { id: DeckTypeEnum; name: string; isSelectable: boolean }) => <option key={deck.id} value={deck.id}>{resources.deckNames[deck.id as keyof typeof resources.deckNames] || deck.name}</option>)}
                  <option value={DeckTypeEnum.Custom}>{player.customDeckName || t('customDeck')}</option>
                </select>
              )
            )}
            {/* Win medal */}
            {winCount > 0 && <img src={ROUND_WIN_MEDAL_URL} alt="Round Winner" className="flex-shrink-0 mt-vu-min" title="Round Winner" style={{ width: `${getVuSize(17)}px`, height: `${getVuSize(17)}px` }} />}
            {/* First player star */}
            {isFirstPlayer && <img src={firstPlayerIconUrl} className="flex-shrink-0" title="First Player" style={{ width: `${getVuSize(17)}px`, height: `${getVuSize(17)}px` }} />}
            {/* Active player indicator - clickable to toggle (DISABLED) */}
            {/* <div
              onClick={() => canPerformActions && onToggleActivePlayer(player.id)}
              className={`flex-shrink-0 cursor-pointer transition-all duration-200 ${
                !canPerformActions ? 'cursor-not-allowed' : ''
              }`}
              title={isPlayerActive ? "Active Player - Click to deactivate" : "Inactive Player - Click to activate"}
            > */}
            <div
              className="flex-shrink-0 transition-all duration-200"
              title={isPlayerActive ? "Active Player" : "Inactive Player"}
            >
              <svg
                style={{ width: `${getVuSize(17)}px`, height: `${getVuSize(17)}px` }}
                viewBox="0 0 28 28"
                className={`transition-all duration-200 ${
                  isPlayerActive
                    ? 'drop-shadow-[0_0_6px_rgba(250,204,21,0.8)]'
                    : 'opacity-40'
                }`}
              >
                {/* Outer ring */}
                <circle
                  cx="14"
                  cy="14"
                  r="12"
                  fill="none"
                  strokeWidth="2.5"
                  className={isPlayerActive ? 'stroke-yellow-400' : 'stroke-gray-500'}
                />
                {/* Inner circle */}
                <circle
                  cx="14"
                  cy="14"
                  r="6"
                  className={isPlayerActive ? 'fill-yellow-400' : 'fill-gray-600'}
                />
                {/* Glow effect when active */}
                {isPlayerActive && (
                  <circle
                    cx="14"
                    cy="14"
                    r="9"
                    fill="none"
                    strokeWidth="1"
                    className="stroke-yellow-300 opacity-50 animate-pulse"
                  />
                )}
              </svg>
            </div>
            {/* </div> */}
          </div>
        </div>

        {/* Main Vertical Layout */}
        <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">

          {/* Combined: Resources + Hand with gap-1 spacing */}
          <div className="flex flex-col flex-1 min-h-0 gap-1 px-1 mt-[4px]">
            {/* Row 1: Resources (Deck, Discard, Showcase) + Score at right edge - same size as hand cards */}
            <div className="grid grid-cols-6 gap-1 flex-shrink-0 scale-[0.975] origin-left">
            {/* Deck */}
            <div className="aspect-square relative">
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'deck', playerId: player.id, deckPosition: 'top' })} onContextMenu={(e) => handleContextMenuWithCancel(e, 'deckPile', { player })} isOverClassName="rounded ring-2 ring-white">
                {(() => {
                  // Check if deck is selectable (from local isDeckSelectable or targetingMode)
                  const isLocalDeckSelectable = isDeckSelectable
                  const isTargetingModeDeckSelectable = targetingMode?.isDeckSelectable ?? false
                  const isDeckSelectableActive = isLocalDeckSelectable || isTargetingModeDeckSelectable

                  // Use targeting player's color for the selection effect
                  const targetPlayerId = targetingMode?.playerId ?? activePlayerId
                  const activePlayerColorName = targetPlayerId !== null && targetPlayerId !== undefined ? playerColorMap.get(targetPlayerId) : null
                  const rgb = getPlayerColorRgbOrDefault(activePlayerColorName, { r: 37, g: 99, b: 235 })
                  const deckHighlightStyle = isDeckSelectableActive ? {
                    boxShadow: `0 0 12px 2px ${rgba(calculateGlowColor(rgb), 0.5)}`,
                    border: '3px solid rgb(255, 255, 255)',
                  } : {}

                  // Find recent deck selection for this player (within last 1 second)
                  const now = Date.now()
                  const recentSelection = deckSelections?.find(
                    ds => ds.playerId === player.id && (now - ds.timestamp) < 1000
                  )
                  // Use the selecting player's color for the ripple
                  const selectionColorName = recentSelection?.selectedByPlayerId
                    ? playerColorMap.get(recentSelection.selectedByPlayerId)
                    : null
                  const selectionRgb = getPlayerColorRgbOrDefault(selectionColorName, rgb)

                  return (
                    <div className="relative w-full h-full">
                      {/* Highlight overlay - doesn't interfere with deck visibility */}
                      {isDeckSelectableActive && (
                        <div
                          className="absolute inset-0 rounded-vu-5 pointer-events-none animate-glow-pulse"
                          style={{
                            zIndex: 10,
                            background: `radial-gradient(circle at center, transparent 30%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4) 100%)`,
                          }}
                        />
                      )}
                      {/* Ripple effect when deck is selected */}
                      {recentSelection && (
                        <div
                          className="absolute inset-0 rounded-vu-5 pointer-events-none animate-deck-selection"
                          style={{
                            zIndex: 15,
                            border: '3px solid',
                            borderColor: `rgb(${selectionRgb.r}, ${selectionRgb.g}, ${selectionRgb.b})`,
                            background: `radial-gradient(circle at center, transparent 20%, rgba(${selectionRgb.r}, ${selectionRgb.g}, ${selectionRgb.b}, 0.6) 100%)`,
                          }}
                        />
                      )}
                      <RemotePile
                        label={t('deck')}
                        count={getDeckSize()}
                        onClick={handleDeckInteraction}
                        className={PLAYER_COLORS[player.color]?.bg || 'bg-card-back'}
                        style={deckHighlightStyle}
                        delta={deckChangeDelta}
                        dataDeck={player.id}
                      />
                    </div>
                  )
                })()}
              </DropZone>
            </div>

            {/* Discard */}
            <div className="aspect-square relative">
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'discard', playerId: player.id })} onContextMenu={(e) => handleContextMenuWithCancel(e, 'discardPile', { player })} isOverClassName="rounded-vu-5 ring-2 ring-white">
                <RemotePile
                  label={t('discard')}
                  count={getDiscardSize()}
                  className="bg-gray-700"
                />
              </DropZone>
            </div>

            {/* Showcase */}
            <div className="aspect-square relative">
              <DropZone className="w-full h-full" onDrop={() => draggedItem && handleDrop(draggedItem, { target: 'announced', playerId: player.id })} isOverClassName="rounded-vu-5 ring-2 ring-white">
                <div className="w-full h-full bg-gray-800 border border-dashed border-gray-600 rounded-vu-5 flex items-center justify-center relative overflow-hidden">
                  {player.announcedCard ? (
                    <div
                      className="w-full h-full"
                      draggable={canDrag}
                      onDragStart={(e) => {
                        if (canDrag) {
                          setDraggedItem({
                            card: player.announcedCard!,
                            source: 'announced',
                            playerId: player.id,
                            isManual: true
                          })
                          // Set custom drag image to only include the card, not tooltip
                          const cardElement = e.currentTarget.querySelector('[data-card-image]')
                          if (cardElement) {
                            e.dataTransfer.setDragImage(cardElement as Element, 20, 20)
                          }
                        }
                      }}
                      onDragEnd={() => { setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK) }}
                      onContextMenu={(e) => player.announcedCard && handleContextMenuWithCancel(e, 'announcedCard', {
                        card: player.announcedCard,
                        player
                      })}
                      onDoubleClick={() => onAnnouncedCardDoubleClick?.(player, player.announcedCard!)}
                    >
                      <div data-card-image="true" className="w-full h-full">
                        <CardComponent
                        card={player.announcedCard}
                        isFaceUp={true}
                        playerColorMap={playerColorMap}
                        imageRefreshVersion={imageRefreshVersion}
                        loadPriority={isLocalPlayer ? 'high' : 'low'}
                        disableTooltip={false}
                        disableActiveHighlights={disableActiveHighlights}
                        preserveDeployAbilities={preserveDeployAbilities}
                        disableImageTransition={true}
                        playerColor={player.color}
                        smallPowerDisplay={true}
                      />
                      </div>
                    </div>
                  ) : <span className="font-bold text-gray-500 select-none uppercase opacity-80 tracking-tighter text-vu-16">SHOW</span>}
                </div>
              </DropZone>
            </div>

            {/* Empty cells for spacing */}
            <div className="aspect-square"></div>
            <div className="aspect-square"></div>

            {/* Score Counter - at right edge */}
            <div className="aspect-square">
              <RemoteScore
                score={player.score}
                onChange={onScoreChange}
                canEdit={canPerformActions}
              />
            </div>
          </div>

          {/* Row 2: Hand Cards - Grid 6 cols - Scrollable with ALWAYS VISIBLE SCROLLBAR */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (draggedItem) {
                handleDrop(draggedItem, { target: 'hand', playerId: player.id })
              }
            }}
            className="grid grid-cols-6 gap-1 overflow-y-scroll custom-scrollbar flex-grow content-start min-h-[30px]"
          >
            {(() => {
              // For local players, use actual hand cards
              // For remote players in WebRTC mode, hand may be empty but handSize tells us how many cards they have
              const cardsToRender = isLocalPlayer || player.hand.length > 0
                ? player.hand
                : Array.from({ length: player.handSize || 0 }, (_, i) => ({
                    id: `hidden-${player.id}-${i}`,
                    baseId: 'hidden',
                    name: '',  // Empty name, not 'Hidden Card'
                    ownerId: player.id,
                    ownerName: player.name,
                    power: 0,
                    deck: DeckTypeEnum.Random,
                    imageUrl: '',
                    abilityText: '',
                    isFaceDown: true,
                    // Marker to indicate this is a placeholder
                    _isPlaceholder: true
                  }))

              // OPTIMIZATION: Create lookup Map for click waves instead of filtering for each card
              const clickWavesMap = new Map<string, any[]>()
              if (clickWaves) {
                for (const wave of clickWaves) {
                  if (wave.location === 'hand' && wave.handTarget?.playerId === player.id) {
                    const key = `${player.id}-${wave.handTarget.cardIndex}`
                    if (!clickWavesMap.has(key)) {
                      clickWavesMap.set(key, [])
                    }
                    clickWavesMap.get(key)!.push(wave)
                  }
                }
              }

              return cardsToRender.map((card, index) => {
                // Check if this card is a valid target from GLOBAL targetingMode only
                // NO LOCAL effects - all highlights must be synchronized across all players
                const isTarget = targetingMode?.handTargets?.some(t => t.playerId === player.id && t.cardIndex === index)

                // Use targeting player's color for the highlight
                const targetPlayerId = targetingMode?.playerId ?? (highlightOwnerId ?? activePlayerId)
                const activePlayerColorName = targetPlayerId !== null && targetPlayerId !== undefined ? playerColorMap.get(targetPlayerId) : null
                const rgb = getPlayerColorRgbOrDefault(activePlayerColorName, { r: 37, g: 99, b: 235 })

                // Find recent hand card selection for this card (within last 1 second)
                const now = Date.now()
                const recentSelection = handCardSelections?.find(
                  cs => cs.playerId === player.id && cs.cardIndex === index && (now - cs.timestamp) < 1000
                )

                // OPTIMIZATION: Use Map lookup instead of filtering - O(1) instead of O(n)
                // NOTE: cardClickWaves is currently unused (React wave disabled, using instant direct DOM approach only)
                // const cardClickWaves = clickWavesMap.get(`${player.id}-${index}`) || []

                // Card container style with highlight if target
                const cardHighlightStyle = isTarget ? {
                  boxShadow: `0 0 12px 2px ${rgba(calculateGlowColor(rgb), 0.5)}`,
                  border: '3px solid rgb(255, 255, 255)',
                } : {}

                const isPlaceholder = (card as any)._isPlaceholder
                const isRealCard = !isPlaceholder
                const realCard = card as CardType

                // Check if card is revealed to all players
                const isRevealedToAll = realCard.revealedTo === 'all'

                // Check if card is revealed to local player via revealedTo property
                // Works for both real cards and placeholder cards (opponent hands in WebRTC)
                const isRevealedToMe = localPlayerId !== null &&
                  Array.isArray(realCard.revealedTo) &&
                  realCard.revealedTo.includes(localPlayerId)

                // Check if card has Revealed status added by local player
                const isRevealedByStatus = isRealCard && localPlayerId !== null &&
                  realCard.statuses?.some((s: any) => s.type === 'Revealed' && s.addedByPlayerId === localPlayerId)

                // Card belongs to local player if they are the card owner (card.ownerId === localPlayerId)
                // OR if this is the local player's own panel (isLocalPlayer)
                // CRITICAL: Do NOT include `localPlayerId === player.id` - that causes host to see white cards in remote panels
                const isOwner = isLocalPlayer || localPlayerId === realCard.ownerId

                // CARDS IN OTHER PLAYERS' HANDS should be FACE-DOWN by default
                // Only exceptions: owner, teammate (rare), Revealed to all, or Revealed by token owner
                // CRITICAL: Cards with Revealed status are shown FACE-DOWN with colored back + Revealed icon
                // The card face is only shown to the player who placed the Revealed token (isRevealedByStatus)
                // Dummy player cards: HIDDEN (face-down) when hideDummyCards is true, regardless of other rules
                //   Otherwise visible to all players when hideDummyCards setting is off (all players control dummies)
                const isVisible: boolean = (player.isDummy && hideDummyCards) ? false :
                  (isOwner || isTeammate || !!isRevealedToAll || !!isRevealedToMe || !!isRevealedByStatus ||
                  (!hideDummyCards && !!player.isDummy))

                return (
                  <div
                    key={`${player.id}-hand-${index}-${card.id}`}
                    className="aspect-square relative"
                    data-hand-card={`${player.id},${index}`}
                    draggable={canDrag && !isPlaceholder}
                    onDragStart={(e) => {
                      if (canDrag && !isPlaceholder) {
                        setDraggedItem({ card, source: 'hand', playerId: player.id, cardIndex: index, isManual: true })
                        // Set custom drag image to only include the card, not tooltip
                        const cardElement = e.currentTarget.querySelector('[data-card-image]')
                        if (cardElement) {
                          e.dataTransfer.setDragImage(cardElement as Element, 20, 20)
                        }
                      }
                    }}
                    onDragEnd={() => { setTimeout(() => setDraggedItem(null), TIMING.DRAG_END_FALLBACK) }}
                    onContextMenu={(e) => {
                      if (!isPlaceholder) {
                        e.preventDefault()
                        e.stopPropagation()
                        handleContextMenuWithCancel(e, 'handCard', { card, player, cardIndex: index })
                      }
                    }}
                    onDoubleClick={() => !isPlaceholder && onHandCardDoubleClick(player, card, index)}
                    onClick={() => {
                      if (!isPlaceholder) {
                        // Trigger click wave for hand cards
                        if (triggerClickWave && localPlayerId !== null) {
                          triggerClickWave('hand', undefined, { playerId: player.id, cardIndex: index })
                        }
                        onCardClick?.(player, card, index)
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (draggedItem && !isPlaceholder) {
                        // If dropping on same player's hand, insert at this index
                        if (draggedItem.playerId === player.id && draggedItem.source === 'hand') {
                          handleDrop(draggedItem, { target: 'hand', playerId: player.id, cardIndex: index })
                        } else {
                          // Different source or player, append to end
                          handleDrop(draggedItem, { target: 'hand', playerId: player.id })
                        }
                      }
                    }}
                    data-interactive="true"
                  >
                    {/* Highlight overlay - doesn't interfere with card visibility */}
                    {isTarget && (
                      <div
                        className="absolute inset-0 rounded-vu-5 pointer-events-none animate-glow-pulse"
                        style={{
                          zIndex: 10,
                          background: `radial-gradient(circle at center, transparent 30%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4) 100%)`,
                        }}
                      />
                    )}
                    {/* Ripple effect when card is selected */}
                    {recentSelection && (
                      <div
                        className="absolute inset-0 rounded-vu-5 pointer-events-none animate-deck-selection"
                        style={{
                          zIndex: 15,
                          border: '3px solid',
                          borderColor: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
                          background: `radial-gradient(circle at center, transparent 20%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6) 100%)`,
                        }}
                      />
                    )}
                    <div className="w-full h-full rounded-vu-5" style={cardHighlightStyle}>
                      <div data-card-image="true" className="w-full h-full">
                        {isPlaceholder ? (
                          // Show card back for placeholder cards (remote players in WebRTC)
                          // CRITICAL: Preserve card.ownerId so Card component can get correct color from playerColorMap
                          <CardComponent
                            card={{
                              ...card,
                              id: card.id,
                              baseId: card.baseId,
                              name: card.name || '',
                              ownerId: card.ownerId || player.id,  // Preserve real card owner, fallback to player id
                              deck: card.deck || (DeckTypeEnum.Random as const),
                              imageUrl: card.imageUrl || '',
                              abilityText: card.abilityText || '',
                            }}
                            isFaceUp={isVisible}
                            playerColorMap={playerColorMap}
                            playerColor={player.color}
                            localPlayerId={localPlayerId}
                            imageRefreshVersion={imageRefreshVersion}
                            loadPriority="low"
                            disableTooltip={true}
                            disableActiveHighlights={true}
                            smallStatusIcons={false}
                            preserveDeployAbilities={false}
                            disableImageTransition={true}
                            smallPowerDisplay={true}
                          />
                        ) : (
                          <CardComponent
                            card={card}
                            isFaceUp={isVisible}
                            playerColorMap={playerColorMap}
                            localPlayerId={localPlayerId}
                            imageRefreshVersion={imageRefreshVersion}
                            loadPriority={isLocalPlayer ? 'high' : 'low'}
                            disableTooltip={!isVisible}
                            disableActiveHighlights={disableActiveHighlights}
                            smallStatusIcons={true}
                            preserveDeployAbilities={preserveDeployAbilities}
                            disableImageTransition={true}
                            playerColor={player.color}
                            smallPowerDisplay={true}
                          />
                        )}
                      </div>
                    </div>
                    {/* React wave disabled - using instant direct DOM approach only */}
                    {/* {cardClickWaves.map(wave => (
                      <ClickWaveComponent
                        key={wave.timestamp}
                        timestamp={wave.timestamp}
                        playerColor={wave.playerColor}
                      />
                    ))} */}
                  </div>
                )
              })
            })()}
          </div>
          </div>
        </div>

        {/* Reconnection Overlay */}
        {isDisconnected && player.reconnectionDeadline && (
          <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center z-40 rounded-vu-5">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-white border-t-transparent mx-auto mb-1"></div>
              <div className="text-white font-bold text-sm">{t('reconnecting')}</div>
              <div className="text-gray-300 text-xs">
                {reconnectTimeLeft}s
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Should never reach here since layoutMode is always 'list-local' or 'list-remote'
  return null
}, (prevProps, nextProps) => {
  // Custom comparison for PlayerPanel memo
  // Re-render if important props change
  const cursorStackEqual = (
    (prevProps.cursorStack === null && nextProps.cursorStack === null) ||
    (prevProps.cursorStack !== null && nextProps.cursorStack !== null &&
     prevProps.cursorStack!.type === nextProps.cursorStack!.type &&
     prevProps.cursorStack!.count === nextProps.cursorStack!.count)
  )
  // DraggedItem comparison - check if card or source changed
  const draggedItemEqual = (
    prevProps.draggedItem === nextProps.draggedItem ||
    (prevProps.draggedItem?.card.id === nextProps.draggedItem?.card.id &&
     prevProps.draggedItem?.source === nextProps.draggedItem?.source &&
     prevProps.draggedItem?.playerId === nextProps.draggedItem?.playerId)
  )
  // Helper to get deck size for comparison (use deckSize if available)
  const getDeckSizeForCompare = (p: Player): number => {
    if (p.deck.length > 0) {
      return p.deck.length
    }
    return p.deckSize ?? 0
  }

  const getHandSizeForCompare = (p: Player): number => {
    if (p.hand.length > 0) {
      return p.hand.length
    }
    return p.handSize ?? 0
  }

  const getDiscardSizeForCompare = (p: Player): number => {
    if (p.discard.length > 0) {
      return p.discard.length
    }
    return p.discardSize ?? 0
  }

  // CRITICAL: Compare targetingMode - prevents unnecessary re-renders when targetingMode hasn't changed
  // Only check key properties that affect rendering: playerId and action.mode
  // This ensures P2P guests still re-render when targetingMode actually changes
  const targetingModeEqual = (
    (prevProps.targetingMode?.playerId === nextProps.targetingMode?.playerId) &&
    (prevProps.targetingMode?.action?.mode === nextProps.targetingMode?.action?.mode) &&
    (prevProps.targetingMode?.action?.payload?.actionType === nextProps.targetingMode?.action?.payload?.actionType) &&
    // CRITICAL: Also check handTargets existence and contents, not just length
    // This fixes DISCARD_FROM_HAND visual effect not showing when handTargets change
    (!prevProps.targetingMode?.handTargets === !nextProps.targetingMode?.handTargets) &&
    JSON.stringify(prevProps.targetingMode?.handTargets) === JSON.stringify(nextProps.targetingMode?.handTargets)
  )

  return (
    prevProps.player.id === nextProps.player.id &&
    prevProps.player.score === nextProps.player.score &&
    prevProps.player.color === nextProps.player.color &&
    prevProps.player.name === nextProps.player.name &&
    prevProps.player.selectedDeck === nextProps.player.selectedDeck &&
    getHandSizeForCompare(prevProps.player) === getHandSizeForCompare(nextProps.player) &&
    getDeckSizeForCompare(prevProps.player) === getDeckSizeForCompare(nextProps.player) &&
    getDiscardSizeForCompare(prevProps.player) === getDiscardSizeForCompare(nextProps.player) &&
    prevProps.player.announcedCard?.id === nextProps.player.announcedCard?.id &&
    prevProps.isGameStarted === nextProps.isGameStarted &&
    prevProps.activePlayerId === nextProps.activePlayerId &&
    prevProps.currentPhase === nextProps.currentPhase &&
    prevProps.imageRefreshVersion === nextProps.imageRefreshVersion &&
    prevProps.currentRound === nextProps.currentRound &&
    prevProps.validHandTargets === nextProps.validHandTargets &&
    prevProps.allPlayers.length === nextProps.allPlayers.length &&
    prevProps.allPlayers.map(p => p.id).join(',') === nextProps.allPlayers.map(p => p.id).join(',') &&
    cursorStackEqual &&
    draggedItemEqual &&
    targetingModeEqual &&
    // CRITICAL: Check if hand card statuses changed (for Revealed tokens on dummy cards)
    // Compare JSON string of hand cards - if any status changed, re-render
    JSON.stringify(prevProps.player.hand.map(c => ({ id: c.id, statuses: c.statuses }))) ===
    JSON.stringify(nextProps.player.hand.map(c => ({ id: c.id, statuses: c.statuses })))
  )
})

export { PlayerPanel }
