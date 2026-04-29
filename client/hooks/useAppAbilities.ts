import { useCallback, useEffect, useRef } from 'react'
import type { Card, GameState, AbilityAction, CommandContext, DragItem, Player, CounterSelectionData, CursorStackState, FloatingTextData } from '@/types'
import { validateTarget, calculateValidTargets } from '@shared/utils/targeting'
import { hasReadyAbilityInCurrentPhase } from '@/utils/autoAbilities'
import { getWebRTCEnabled } from './useWebRTCEnabled'
import { logger } from '@/utils/logger'

// Import extracted handler modules
import {
  activateAbility as activateAbilityModule,
  handleLineSelection as handleLineSelectionModule,
  handleHandCardClick,
  handleAnnouncedCardDoubleClick,
  handleActionExecution as handleActionExecutionModule,
  handleModeCardClick as handleModeCardClickModule,
  handleEmptyCellClick as handleEmptyCellClickModule,
} from './abilities/index.js'

interface UseAppAbilitiesProps {
    gameState: GameState;
    getFreshGameState: () => GameState; // Функция для получения свежего состояния
    localPlayerId: number | null;
    abilityMode: AbilityAction | null;
    setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>;
    cursorStack: CursorStackState | null;
    setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>;
    commandContext: CommandContext;
    setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>;
    setViewingDiscard: React.Dispatch<React.SetStateAction<any>>;
    triggerNoTarget: (coords: { row: number; col: number }) => void;
    triggerClickWave: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number, cardIndex: number }) => void;
    playMode: { card: Card; sourceItem: DragItem; faceDown?: boolean } | null;
    setPlayMode: React.Dispatch<React.SetStateAction<any>>;
    setCounterSelectionData: React.Dispatch<React.SetStateAction<CounterSelectionData | null>>;
    interactionLock: React.MutableRefObject<boolean>;
    onAbilityComplete?: () => void;

    // Actions from useGameState
    updateState: (stateOrFn: GameState | ((prevState: GameState) => GameState)) => void;
    moveItem: (item: DragItem, target: any) => void;
    destroyCard: (card: Card, boardCoords: { row: number; col: number }) => void;
    drawCard: (playerId: number) => void;
    drawCardsBatch: (playerId: number, count: number) => void;
    updatePlayerScore: (playerId: number, delta: number) => void;
    markAbilityUsed: (coords: { row: number, col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void;
    applyGlobalEffect: (source: any, targets: any[], type: string, pid: number, isDeploy: boolean) => void;
    swapCards: (c1: any, c2: any) => void;
    transferStatus: (from: any, to: any, type: string) => void;
    transferAllCounters: (from: any, to: any) => void;
    transferAllStatusesWithoutException: (from: any, to: any) => void;
    resurrectDiscardedCard: (pid: number, idx: number, coords: any) => void;
    spawnToken: (coords: any, name: string, ownerId: number) => void;
    scoreLine: (r1: number, c1: number, r2: number, c2: number, pid: number) => void;
    nextPhase: () => void;
    modifyBoardCardPower: (coords: any, delta: number) => void;
    addBoardCardStatus: (coords: any, status: string, pid: number, count?: number) => void;
    removeBoardCardStatus: (coords: any, status: string) => void;
    removeBoardCardStatusByOwner: (coords: any, status: string, pid: number) => void;
    resetDeployStatus: (coords: { row: number; col: number }) => void;
    scoreDiagonal: (r1: number, c1: number, r2: number, c2: number, pid: number, bonusType?: 'point_per_support' | 'draw_per_support') => void;
    removeStatusByType: (coords: { row: number; col: number }, type: string) => void;
    triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void;
    triggerHandCardSelection: (playerId: number, cardIndex: number, selectedByPlayerId: number) => void;
    triggerDeckSelection: (playerId: number, selectedByPlayerId: number) => void;
    clearValidTargets: () => void;
    setTargetingMode: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, preCalculatedTargets?: {row: number, col: number}[], commandContext?: CommandContext) => void;
    clearTargetingMode: () => void;
    validTargets?: {row: number, col: number}[];
    sendAction?: (action: string, data?: any) => void;
    setActionQueue?: React.Dispatch<React.SetStateAction<AbilityAction[]>>;
    pendingChainedActionRef?: React.MutableRefObject<boolean>;
    addLogEntry: (type: string, details: any, playerId?: number) => void;
}

/**
 * Main hook for handling card abilities
 *
 * This hook provides functions for:
 * - Activating abilities on cards
 * - Executing ability actions
 * - Handling clicks on board cards, empty cells, and hand cards
 * - Managing line selection for scoring abilities
 */
export const useAppAbilities = ({
  gameState,
  getFreshGameState, // Функция для получения свежего состояния
  localPlayerId,
  abilityMode,
  setAbilityMode,
  cursorStack,
  setCursorStack,
  commandContext,
  setCommandContext,
  setViewingDiscard,
  triggerNoTarget,
  triggerClickWave,
  triggerDeckSelection,
  playMode,
  setPlayMode,
  setCounterSelectionData,
  interactionLock,
  onAbilityComplete,
  updateState,
  moveItem,
  destroyCard,
  // drawCard, // @ts-ignore - Unused but kept for future use
  drawCardsBatch,
  updatePlayerScore,
  markAbilityUsed,
  applyGlobalEffect,
  swapCards,
  transferStatus,
  transferAllCounters,
  transferAllStatusesWithoutException,
  resurrectDiscardedCard,
  spawnToken,
  scoreLine,
  nextPhase,
  modifyBoardCardPower,
  addBoardCardStatus,
  removeBoardCardStatus,
  removeBoardCardStatusByOwner,
  resetDeployStatus,
  scoreDiagonal,
  removeStatusByType,
  triggerFloatingText,
  triggerHandCardSelection,
  clearValidTargets,
  setTargetingMode,
  clearTargetingMode,
  validTargets,
  sendAction,
  setActionQueue,
  pendingChainedActionRef,
  addLogEntry,
}: UseAppAbilitiesProps) => {

  // Store handleLineSelection ref to avoid circular dependency
  const lineSelectionRef = useRef<(coords: { row: number; col: number }) => void>(() => {})

  // Store abilityMode in ref to always have access to current value
  // This avoids stale closure issues in event handlers
  const abilityModeRef = useRef<AbilityAction | null>(abilityMode)
  useEffect(() => {
    abilityModeRef.current = abilityMode
  }, [abilityMode])

  /**
   * Handle line selection for scoring abilities
   * Defined BEFORE handleActionExecution to avoid circular dependency
   */
  const handleLineSelection = useCallback((coords: { row: number; col: number }) => {
    handleLineSelectionModule(coords, {
      gameState,
      localPlayerId,
      abilityMode,
      interactionLock,
      setAbilityMode,
      markAbilityUsed,
      updatePlayerScore,
      triggerFloatingText,
      nextPhase,
      modifyBoardCardPower,
      scoreLine,
      scoreDiagonal,
      commandContext,
    })
  }, [abilityMode, gameState, localPlayerId, interactionLock, setAbilityMode, markAbilityUsed, updatePlayerScore, triggerFloatingText, nextPhase, modifyBoardCardPower, scoreLine, scoreDiagonal, commandContext])

  // Update ref whenever handleLineSelection changes
  lineSelectionRef.current = handleLineSelection

  /**
   * Execute ability actions using modular handler
   */
  const handleActionExecution = useCallback((action: AbilityAction, sourceCoords: { row: number, col: number }) => {
    handleActionExecutionModule(action, sourceCoords, {
      gameState,
      getFreshGameState,
      localPlayerId,
      abilityMode,
      setAbilityMode,
      cursorStack,
      setCursorStack,
      commandContext,
      setCommandContext,
      playMode: null,
      setPlayMode,
      draggedItem: null,
      setDraggedItem: () => {},
      openContextMenu: () => {},
      markAbilityUsed,
      triggerNoTarget,
      triggerClickWave,
      handleActionExecution,
      interactionLock,
      moveItem,
      swapCards,
      transferStatus,
      transferAllCounters,
      transferAllStatusesWithoutException,
      destroyCard,
      spawnToken,
      modifyBoardCardPower,
      addBoardCardStatus,
      removeBoardCardStatus,
      removeBoardCardStatusByOwner,
      removeStatusByType,
      resetDeployStatus,
      updatePlayerScore,
      triggerFloatingText,
      setCounterSelectionData,
      setViewingDiscard,
      validTargets,
      handleLineSelection: lineSelectionRef.current,
      onAbilityComplete,
      applyGlobalEffect,
      drawCardsBatch,
      setTargetingMode,
      clearTargetingMode,
      sendAction,
      pendingChainedActionRef,
      setActionQueue,
    })
  }, [
    gameState,
    getFreshGameState,
    localPlayerId,
    abilityMode,
    setAbilityMode,
    cursorStack,
    setCursorStack,
    commandContext,
    setCommandContext,
    setPlayMode,
    markAbilityUsed,
    triggerNoTarget,
    // Note: handleActionExecution is intentionally excluded from deps to avoid circular dependency
    // It's stable due to useCallback and will have the correct reference when called recursively
    interactionLock,
    moveItem,
    destroyCard,
    swapCards,
    transferStatus,
    transferAllCounters,
    transferAllStatusesWithoutException,
    spawnToken,
    modifyBoardCardPower,
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    removeStatusByType,
    resetDeployStatus,
    updatePlayerScore,
    triggerFloatingText,
    setCounterSelectionData,
    setViewingDiscard,
    validTargets,
    // handleLineSelection intentionally excluded - defined after this callback
    onAbilityComplete,
    applyGlobalEffect,
    drawCardsBatch,
    setTargetingMode,
    clearTargetingMode,
    sendAction,
    pendingChainedActionRef,
    setActionQueue,
  ])

  // Auto-Execute GLOBAL_AUTO_APPLY actions when they appear in abilityMode
  useEffect(() => {
    if (abilityMode?.type === 'GLOBAL_AUTO_APPLY') {
      handleActionExecution(abilityMode, abilityMode.sourceCoords || { row: -1, col: -1 })
      setAbilityMode(null)
    }
  }, [abilityMode, handleActionExecution, setAbilityMode])

  // Sync targeting mode with abilityMode for P2P visual effects
  // CRITICAL: DON'T auto-clear targetingMode when abilityMode becomes null
  // Targeting mode should only be cleared explicitly (e.g., when token is placed)
  // NOTE: Removed automatic clearTargetingMode() call to prevent premature clearing
  // Targeting mode is now managed explicitly in handCardHandlers.ts and modeHandlers.ts

  /**
   * Activate a card's ability
   */
  const activateAbility = useCallback((card: Card, boardCoords: { row: number, col: number }) => {
    activateAbilityModule(card, boardCoords, {
      gameState,
      getFreshGameState,
      localPlayerId,
      abilityMode,
      cursorStack,
      handleActionExecution,
      markAbilityUsed,
      addBoardCardStatus,
      setAbilityMode,
      addLogEntry,
    })
  }, [gameState, getFreshGameState, localPlayerId, abilityMode, cursorStack, handleActionExecution, markAbilityUsed, addBoardCardStatus, setAbilityMode, addLogEntry])
  /**
   * Handle click on board card
   */
  const handleBoardCardClick = useCallback((card: Card, boardCoords: { row: number; col: number }) => {
    // 1. Handle cursorStack (token placement from Aim, Revealed, etc.)
    if (cursorStack && setPlayMode !== null && setPlayMode !== undefined) {
      const constraints = {
        targetOwnerId: cursorStack.targetOwnerId,
        excludeOwnerId: cursorStack.excludeOwnerId,
        onlyOpponents: cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1),
        onlyFaceDown: cursorStack.onlyFaceDown,
        targetType: cursorStack.targetType,
        requiredTargetStatus: cursorStack.requiredTargetStatus,
        tokenType: cursorStack.type,
      }

      const isValid = validateTarget(
        { card, ownerId: card.ownerId ?? 0, location: 'board' },
        constraints,
        gameState.activePlayerId,
        gameState.players,
        cursorStack.originalOwnerId // CRITICAL: Pass token owner ID for command cards
      )


      if (isValid) {
        // Handle Revealed token with duplicate check - prevent duplicate placement
        if (cursorStack.type === 'Revealed') {
          const effectiveActorId = cursorStack.sourceCard?.ownerId ?? gameState.activePlayerId ?? localPlayerId ?? 1
          const hasRevealed = card.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === effectiveActorId)

          if (hasRevealed) {
            // Already has Revealed from this player, silently ignore
            return
          }
        }
        // NOTE: Token placement is handled by useAppCounters.ts (global mouseup handler)
        // This prevents duplication - the token is only placed once via handleDrop
      }
      return
    }

    if (interactionLock.current) {
      return
    }

    // 2. Activate ability on click if card has ready ability and no mode is active
    if (!abilityMode && !cursorStack && gameState.isGameStarted) {
      const canActivate = hasReadyAbilityInCurrentPhase(card, gameState)
      if (canActivate) {
        activateAbility(card, boardCoords)
        return
      }
    }

    // 3. Handle line selection modes that use handleLineSelection directly
    // NOTE: SELECT_DIAGONAL is NOT included here - it's handled by handleModeCardClickModule below
    // This ensures consistent behavior for both empty and occupied cells
    // CRITICAL: Only the active player can click to select lines
    if (abilityMode && (
      abilityMode.mode === 'SCORE_LAST_PLAYED_LINE' ||
      abilityMode.mode === 'SELECT_LINE_END'
    )) {
      // Check if local player is the active player
      const canScore = localPlayerId === gameState.activePlayerId

      if (canScore) {
        handleLineSelection(boardCoords)
      } else {
      }
      return
    }

    // 4. Handle ability modes with modular handler
    if (abilityMode?.type === 'ENTER_MODE') {
      const isWebRTCMode = getWebRTCEnabled()
      // Use ref to get current abilityMode value, avoiding stale closure issues
      const currentAbilityMode = abilityModeRef.current
      const handled = handleModeCardClickModule(card, boardCoords, {
        gameState,
        getFreshGameState,
        localPlayerId,
        abilityMode: currentAbilityMode,
        setAbilityMode,
        cursorStack,
        setCursorStack,
        commandContext,
        setCommandContext,
        playMode: null,
        setPlayMode,
        draggedItem: null,
        setDraggedItem: () => {},
        openContextMenu: () => {},
        markAbilityUsed,
        triggerNoTarget,
        triggerClickWave,
        triggerDeckSelection,
        handleActionExecution,
        interactionLock,
        moveItem,
        swapCards,
        transferStatus,
        transferAllCounters,
        transferAllStatusesWithoutException,
        destroyCard,
        spawnToken,
        modifyBoardCardPower,
        addBoardCardStatus,
        removeBoardCardStatus,
        removeBoardCardStatusByOwner,
        removeStatusByType,
        resetDeployStatus,
        updatePlayerScore,
        triggerFloatingText,
        setCounterSelectionData,
        setViewingDiscard,
        clearValidTargets,
        validTargets,
        handleLineSelection,
        setTargetingMode,
        clearTargetingMode,
        calculateValidTargets,
        updateState,
        nextPhase,
        scoreLine,
        scoreDiagonal,
        isWebRTCMode,
      })
      if (handled) {return}
    }

    // 5. Default: activate ability if no mode
    if (!abilityMode && !cursorStack) {
      activateAbility(card, boardCoords)
    }
  }, [
    cursorStack,
    setPlayMode,
    gameState,
    localPlayerId,
    interactionLock,
    abilityMode,
    handleLineSelection,
    moveItem,
    destroyCard,
    markAbilityUsed,
    setCursorStack,
    handleActionExecution,
    setAbilityMode,
    setCommandContext,
    setCounterSelectionData,
    setViewingDiscard,
    spawnToken,
    swapCards,
    transferStatus,
    transferAllCounters,
    modifyBoardCardPower,
    addBoardCardStatus,
    removeBoardCardStatus,
    removeBoardCardStatusByOwner,
    removeStatusByType,
    resetDeployStatus,
    updatePlayerScore,
    triggerFloatingText,
    triggerNoTarget,
    triggerClickWave,
    triggerDeckSelection,
    validTargets,
    clearTargetingMode,
    activateAbility,
    setTargetingMode,
    updateState,
    nextPhase,
    scoreLine,
    scoreDiagonal,
    setActionQueue,
  ])

  /**
   * Handle click on empty cell
   */
  const handleEmptyCellClick = useCallback((boardCoords: { row: number; col: number }) => {
    const isWebRTCMode = getWebRTCEnabled()

    // Use modular handler
    handleEmptyCellClickModule(boardCoords, {
      gameState,
      getFreshGameState,
      localPlayerId,
      abilityMode,
      setAbilityMode,
      clearTargetingMode,
      cursorStack,
      commandContext,
      setCommandContext,
      playMode,
      draggedItem: null,
      interactionLock,
      handleActionExecution,
      handleDrop: moveItem,
      moveItem,
      setCursorStack,
      triggerNoTarget,
      markAbilityUsed,
      spawnToken,
      resurrectDiscardedCard,
      updatePlayerScore,
      triggerFloatingText,
      handleLineSelection,
      addBoardCardStatus,
      updateState,
      nextPhase,
      modifyBoardCardPower,
      scoreLine,
      scoreDiagonal,
      openContextMenu: () => {},
      triggerDeckSelection: () => {},
      isWebRTCMode,
    })

    // All empty cell handling is now done in the modular handler
  }, [
    gameState,
    getFreshGameState,
    localPlayerId,
    abilityMode,
    setAbilityMode,
    cursorStack,
    commandContext,
    setCommandContext,
    playMode,
    interactionLock,
    handleActionExecution,
    moveItem,
    setCursorStack,
    triggerNoTarget,
    markAbilityUsed,
    spawnToken,
    resurrectDiscardedCard,
    updatePlayerScore,
    triggerFloatingText,
    handleLineSelection,
    updateState,
    nextPhase,
    modifyBoardCardPower,
    scoreLine,
    scoreDiagonal,
  ])

  /**
   * Handle click on hand card
   */
  const handleHandCardClickCallback = useCallback((player: Player, card: Card, cardIndex: number) => {
    handleHandCardClick(player, card, cardIndex, {
      gameState,
      getFreshGameState,
      localPlayerId,
      abilityMode,
      cursorStack,
      interactionLock,
      setCommandContext,
      setAbilityMode,
      moveItem,
      markAbilityUsed,
      handleActionExecution,
      triggerHandCardSelection,
      setCursorStack,
      clearTargetingMode,
      clearValidTargets,
      setPlayMode,
      setActionQueue,
      onAction: handleActionExecution,
      activateAbility: (c, coords) => activateAbilityModule(c, coords, {
        gameState,
        getFreshGameState,
        localPlayerId,
        abilityMode,
        cursorStack,
        handleActionExecution,
        markAbilityUsed,
        addBoardCardStatus,
        addLogEntry,
      }),
    })
  }, [abilityMode, cursorStack, gameState, getFreshGameState, localPlayerId, handleActionExecution, markAbilityUsed, addBoardCardStatus, addLogEntry, setAbilityMode, setCommandContext, triggerHandCardSelection, moveItem, setCursorStack, clearTargetingMode, clearValidTargets, setPlayMode, setActionQueue, interactionLock])

  /**
   * Handle double click on announced card
   */
  const handleAnnouncedCardDoubleClickCallback = useCallback((player: Player, card: Card) => {
    handleAnnouncedCardDoubleClick(player, card, {
      gameState,
      getFreshGameState,
      localPlayerId,
      abilityMode,
      cursorStack,
      interactionLock,
      setCommandContext,
      setAbilityMode,
      setCursorStack,
      moveItem,
      markAbilityUsed,
      handleActionExecution,
      triggerHandCardSelection,
      clearTargetingMode,
      clearValidTargets,
      activateAbility: (c, coords) => activateAbilityModule(c, coords, {
        gameState,
        getFreshGameState,
        localPlayerId,
        abilityMode,
        cursorStack,
        handleActionExecution,
        markAbilityUsed,
        addBoardCardStatus,
        addLogEntry,
      }),
    })
  }, [abilityMode, cursorStack, gameState, getFreshGameState, localPlayerId, handleActionExecution, markAbilityUsed, addBoardCardStatus, addLogEntry, setAbilityMode, setCommandContext, triggerHandCardSelection, moveItem, setCursorStack, clearTargetingMode, clearValidTargets, interactionLock])

  return {
    activateAbility,
    executeAction: handleActionExecution,
    handleLineSelection,
    handleBoardCardClick,
    handleEmptyCellClick,
    handleHandCardClick: handleHandCardClickCallback,
    handleAnnouncedCardDoubleClick: handleAnnouncedCardDoubleClickCallback,
  }
}
