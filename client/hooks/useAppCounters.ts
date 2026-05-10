import { useRef, useEffect, useLayoutEffect } from 'react'
import { flushSync } from 'react-dom'
import type { CursorStackState, GameState, AbilityAction, DragItem, DropTarget, CommandContext } from '@/types'
import { validateTarget } from '@shared/utils/targeting'
import { createTokenCursorStack } from '@/utils/tokenTargeting'

interface UseAppCountersProps {
    gameState: GameState;
    localPlayerId: number | null;
    handleDrop: (item: DragItem, target: DropTarget) => void;
    markAbilityUsed: (coords: { row: number; col: number }, isDeployAbility?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void;
    requestCardReveal: (data: any, playerId: number) => void;
    interactionLock: React.MutableRefObject<boolean>;
    setCommandContext: React.Dispatch<React.SetStateAction<CommandContext>>;
    onAction: (action: AbilityAction, sourceCoords: { row: number, col: number }) => void;
    cursorStack: CursorStackState | null;
    setCursorStack: React.Dispatch<React.SetStateAction<CursorStackState | null>>;
    setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>;
    triggerClickWave: (location: 'board' | 'hand' | 'deck', boardCoords?: { row: number; col: number }, handTarget?: { playerId: number; cardIndex: number }) => void;
  clearTargetingMode: () => void;
  setActionQueue: React.Dispatch<React.SetStateAction<AbilityAction[]>>;
  setValidHandTargets?: React.Dispatch<React.SetStateAction<{playerId: number, cardIndex: number}[]>>;
  setTargetingMode?: (action: AbilityAction, playerId: number, sourceCoords?: { row: number; col: number }, boardTargets?: {row: number, col: number}[], commandContext?: CommandContext, handTargets?: {playerId: number, cardIndex: number}[]) => void;
  abilityMode?: AbilityAction | null;
}

export const useAppCounters = ({
  gameState,
  localPlayerId,
  handleDrop,
  markAbilityUsed,
  requestCardReveal,
  interactionLock,
  setCommandContext,
  onAction,
  cursorStack,
  setCursorStack,
  setAbilityMode,
  triggerClickWave,
  clearTargetingMode,
  setActionQueue,
  setValidHandTargets,
  setTargetingMode,
  abilityMode,
}: UseAppCountersProps) => {
  const cursorFollowerRef = useRef<HTMLDivElement>(null)
  const mousePos = useRef({ x: 0, y: 0 })
  // CRITICAL: Track when cursorStack was just created for hand-targeting to prevent premature clearing
  // This fixes Data Interception/Enhanced Interrogation where new Revealed cursorStack
  // is created but old useEffect sees previous cursorStack and clears it
  const handTargetingCursorStackJustCreated = useRef(false)

  // Initial positioning layout effect
  useLayoutEffect(() => {
    if (cursorStack && cursorFollowerRef.current) {
      const { x, y } = mousePos.current
      // Center the 48x48 (w-12 h-12) element on the cursor
      cursorFollowerRef.current.style.transform = `translate(${x - 24}px, ${y - 24}px)`
    }
  }, [cursorStack])

  // Mouse movement tracking for custom cursor
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY }
      if (cursorFollowerRef.current) {
        // Center the 48x48 (w-12 h-12) element on the cursor
        cursorFollowerRef.current.style.transform = `translate(${e.clientX - 24}px, ${e.clientY - 24}px)`
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Handle dropping counters (global mouse up)
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) {
        return
      } // Prevent action on right-click
      if (!cursorStack) {
        return
      }
      const target = document.elementFromPoint(e.clientX, e.clientY)

      // Determine who is performing the action (Effective Actor)
      let effectiveActorId = localPlayerId

      // CRITICAL: If active player is dummy, ALL actions should be attributed to the dummy player
      // This ensures tokens/statuses belong to the dummy player, not the player controlling them
      if (gameState.activePlayerId) {
        const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
        if (activePlayer?.isDummy) {
          effectiveActorId = activePlayer.id
        }
      }

      // Otherwise, try to get actor from originalOwnerId (preserves command card ownership)
      // Only use these if active player is NOT dummy
      if (effectiveActorId === localPlayerId && cursorStack.originalOwnerId !== undefined) {
        effectiveActorId = cursorStack.originalOwnerId
      } else if (effectiveActorId === localPlayerId && cursorStack.sourceCard?.ownerId) {
        effectiveActorId = cursorStack.sourceCard.ownerId
      } else if (effectiveActorId === localPlayerId && cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
        const { row, col } = cursorStack.sourceCoords
        // Validate bounds before accessing board
        if (
          row >= 0 &&
          row < gameState.board.length &&
          col >= 0 &&
          col < gameState.board[row]?.length
        ) {
          const sourceCard = gameState.board[row][col].card
          if (sourceCard) {
            effectiveActorId = sourceCard.ownerId || localPlayerId
          }
        }
      }

      // Check if target itself has data-hand-card attribute OR if it's a parent of an element with data-hand-card
      let handCard = target?.closest('[data-hand-card]')

      // If closest didn't find it, the target might be a parent container wrapping elements with data-hand-card
      // We need to find which hand card element is actually under the cursor
      if (!handCard && target) {
        // Check if the target itself or any of its descendants has data-hand-card attribute
        // First check target itself
        if (target.getAttribute('data-hand-card')) {
          handCard = target as HTMLElement
        } else {
          // Check all descendants of target (not just first-level children)
          const allWithAttr = target.querySelectorAll('[data-hand-card]')
          if (allWithAttr.length > 0) {
            // Find the closest one to the cursor position by checking bounding boxes
            let closestDist = Infinity
            let closestElem: HTMLElement | null = null
            const cursorX = e.clientX
            const cursorY = e.clientY

            for (const elem of Array.from(allWithAttr) as HTMLElement[]) {
              const rect = elem.getBoundingClientRect()
              // Check if cursor is inside the element's bounding box
              if (cursorX >= rect.left && cursorX <= rect.right && cursorY >= rect.top && cursorY <= rect.bottom) {
                // Calculate distance to center of element
                const centerX = rect.left + rect.width / 2
                const centerY = rect.top + rect.height / 2
                const dist = Math.hypot(cursorX - centerX, cursorY - centerY)
                if (dist < closestDist) {
                  closestDist = dist
                  closestElem = elem
                }
              }
            }
            handCard = closestElem
          }
        }
      }

      if (handCard) {
        const attr = handCard.getAttribute('data-hand-card')
        if (attr) {
          const [playerIdStr, cardIndexStr] = attr.split(',')
          const playerId = parseInt(playerIdStr, 10)
          const cardIndex = parseInt(cardIndexStr, 10)
          const targetPlayer = gameState.players.find(p => p.id === playerId)
          const targetCard = targetPlayer?.hand[cardIndex]

          if (targetPlayer && targetCard) {
            // Special handling for Revealed tokens on hand cards
            // Rules: Can place on opponent or dummy hand cards, NOT on own hand cards
            const isRevealedToken = cursorStack.type === 'Revealed'

            if (isRevealedToken) {
              // CRITICAL: Cannot place Revealed on own hand cards (left panel)
              // excludeOwnerId is set to token owner's ID in tokenTargeting.ts
              const tokenOwnerId = cursorStack.originalOwnerId ?? cursorStack.sourceCard?.ownerId ?? effectiveActorId
              if (playerId === tokenOwnerId) {
                // Attempting to place on own hand card - do nothing, keep cursor stack active
                return
              }

              // Check if card already has Revealed from this player (unique constraint)
              const alreadyHasRevealed = targetCard.statuses?.some(s => s.type === 'Revealed' && s.addedByPlayerId === effectiveActorId)
              if (alreadyHasRevealed) {
                // Card already revealed to this player - keep cursor stack active
                return
              }

              // CRITICAL: Check targetOwnerId constraint (for False Orders Option 1, Recon Drone Commit)
              // If targetOwnerId is set, only allow placing on that specific player's hand cards
              if (cursorStack.targetOwnerId !== undefined && cursorStack.targetOwnerId !== null && cursorStack.targetOwnerId > 0) {
                if (playerId !== cursorStack.targetOwnerId) {
                  // Not the target opponent - keep cursor stack active to allow retry
                  return
                }
              }

              // CRITICAL: Clear targeting mode BEFORE handleDrop to ensure
              // the state update doesn't include the stale targetingMode
              // This fixes the issue where other players see persistent targeting highlights
              if (cursorStack.count === 1) {
                // CRITICAL: Don't execute chainedAction directly - add to actionQueue
                // This will be handled after the token is placed and cursorStack is cleared
                // The chainedAction will be processed when useAppAbilities handles cursorStack completion
              }

              // Allow placing Revealed token on opponent or dummy hand cards
              handleDrop({
                card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', types: [] },
                source: 'counter_panel',
                ownerId: cursorStack.originalOwnerId ?? cursorStack.sourceCard?.ownerId ?? effectiveActorId ?? undefined,
                statusType: cursorStack.type,
                count: 1,
              }, { target: 'hand', playerId, cardIndex, boardCoords: undefined })
              if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
                markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
              }

              // Calculate remaining count AFTER this drop
              const remainingCount = cursorStack.count - 1

              // CRITICAL: Update targeting mode to exclude the card that just received Revealed token
              // This ensures the placed card is no longer highlighted as a valid target for all players
              if (setTargetingMode && remainingCount > 0 && gameState.targetingMode) {
                // Get current hand targets and filter out the card that just received the token
                const currentHandTargets = gameState.targetingMode.handTargets || []
                const updatedHandTargets = currentHandTargets.filter(t => !(t.playerId === playerId && t.cardIndex === cardIndex))

                // Call setTargetingMode with updated hand targets to re-sync highlights across all players
                // Use current targetingMode.action and other properties
                setTargetingMode(
                  gameState.targetingMode.action,
                  gameState.targetingMode.playerId,
                  gameState.targetingMode.sourceCoords,
                  gameState.targetingMode.boardTargets,
                  undefined, // commandContext
                  updatedHandTargets
                )
              }

              if (remainingCount > 0) {
                setCursorStack(prev => prev ? ({ ...prev, count: remainingCount }) : null)
              } else {
                // Stack is now empty - clear it and execute chained action
                // CRITICAL: Clear cursorStack IMMEDIATELY before adding chained action
                flushSync(() => {
                  setAbilityMode(null)
                  setCursorStack(null)
                })
                clearTargetingMode()
                if (cursorStack.chainedAction) {
                  const chained = { ...cursorStack.chainedAction }
                  // CRITICAL: Add chainedAction to actionQueue AFTER clearing cursorStack
                  if (setActionQueue) {
                    // Add unique ID to prevent duplicate processing
                    if (!chained._uniqueId) {
                      chained._uniqueId = `${chained.type}_${Date.now()}_${Math.random()}`
                    }
                    setActionQueue(prev => {
                      // Check if this action is already in the queue
                      if (prev.some(a => (a as any)._uniqueId === chained._uniqueId)) {
                        return prev
                      }
                      return [...prev, chained]
                    })
                  } else {
                    onAction(chained, { row: -1, col: -1 })
                  }
                } else if (cursorStack._autoStepsContext) {
                  // CRITICAL: For CREATE_STACK actions, currentStepIndex points to the NEXT step (nextStepIndex + 1)
                  // We need to decrement it to get the COMPLETED step index for handleContinueAutoSteps
                  const autoStepsContext = { ...cursorStack._autoStepsContext }
                  const completedStepIndex = autoStepsContext.currentStepIndex > 0 ? autoStepsContext.currentStepIndex - 1 : 0
                  const continueAction: any = {
                    type: 'CONTINUE_AUTO_STEPS',
                    sourceCard: cursorStack.sourceCard,
                    sourceCoords: cursorStack.sourceCoords,
                    isDeployAbility: cursorStack.isDeployAbility,
                    readyStatusToRemove: cursorStack.readyStatusToRemove,
                    payload: {
                      _autoStepsContext: {
                        ...autoStepsContext,
                        currentStepIndex: completedStepIndex,
                      },
                      stepContext: {
                        targetCoords: { row: -1, col: -1 },
                        targetCard: null,
                        // CRITICAL: Pass sourceOwnerId for False Orders Option 1
                        // This ensures Revealed tokens target the correct player's hand
                        sourceOwnerId: playerId, // Use the player whose hand card was targeted
                      }
                    }
                  }
                  onAction(continueAction, { row: -1, col: -1 })
                }
              }

              interactionLock.current = true
              setTimeout(() => {
                interactionLock.current = false
              }, 300)
              return
            }

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
              { card: targetCard, ownerId: playerId, location: 'hand' },
              constraints,
              effectiveActorId,
              gameState.players,
              cursorStack.originalOwnerId, // CRITICAL: Pass token owner ID for command cards
            )

            if (!isValid) {
              // Invalid target - keep cursor stack active to allow retry
              // Don't close selection mode on invalid target
              return
            }

            // NOTE: Previous 'Request Reveal' check removed to allow immediate token drop.
            // Dropping the token via handleDrop will add the status, revealing the card.

            if (cursorStack.count === 1) {
              // CRITICAL: Don't execute chainedAction directly here
              // It will be handled by useAppAbilities when cursorStack completes
              // Just clear targeting mode - cursorStack will be cleared after token placement
              clearTargetingMode()
            }

            handleDrop({
              card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', types: [] },
              source: 'counter_panel',
              ownerId: cursorStack.originalOwnerId ?? cursorStack.sourceCard?.ownerId, // Use originalOwnerId (command card owner) for status ownership
              statusType: cursorStack.type,
              replaceStatusType: cursorStack.replaceStatus ? cursorStack.requiredTargetStatus : undefined, // For status replacement
              count: 1,
            }, { target: 'hand', playerId, cardIndex, boardCoords: undefined })
            if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
              markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
            }

            // Calculate remaining count AFTER this drop
            const remainingCount = cursorStack.count - 1

            if (remainingCount > 0) {
              setCursorStack(prev => prev ? ({ ...prev, count: remainingCount }) : null)
            } else {
              // Stack is now empty - clear it and execute chained action
              // CRITICAL: Clear cursorStack IMMEDIATELY before adding chained action
              flushSync(() => {
                setAbilityMode(null)
                setCursorStack(null)
              })
              clearTargetingMode()
              if (cursorStack.chainedAction) {
                const chained = { ...cursorStack.chainedAction }
                // CRITICAL: Add chainedAction to actionQueue AFTER clearing cursorStack
                if (setActionQueue) {
                  // Add unique ID to prevent duplicate processing
                  if (!chained._uniqueId) {
                    chained._uniqueId = `${chained.type}_${Date.now()}_${Math.random()}`
                  }
                  setActionQueue(prev => {
                    // Check if this action is already in the queue
                    if (prev.some(a => (a as any)._uniqueId === chained._uniqueId)) {
                      return prev
                    }
                    return [...prev, chained]
                  })
                } else {
                  onAction(chained, { row: -1, col: -1 })
                }
              } else if (cursorStack._autoStepsContext) {
                // CRITICAL: For CREATE_STACK actions, currentStepIndex points to the NEXT step (nextStepIndex + 1)
                // We need to decrement it to get the COMPLETED step index for handleContinueAutoSteps
                const autoStepsContext = { ...cursorStack._autoStepsContext }
                const completedStepIndex = autoStepsContext.currentStepIndex > 0 ? autoStepsContext.currentStepIndex - 1 : 0
                const continueAction: any = {
                  type: 'CONTINUE_AUTO_STEPS',
                  sourceCard: cursorStack.sourceCard,
                  sourceCoords: cursorStack.sourceCoords,
                  isDeployAbility: cursorStack.isDeployAbility,
                  readyStatusToRemove: cursorStack.readyStatusToRemove,
                  payload: {
                    _autoStepsContext: {
                      ...autoStepsContext,
                      currentStepIndex: completedStepIndex,
                    },
                    stepContext: {
                      targetCoords: { row: -1, col: -1 },
                      targetCard: null,
                      // CRITICAL: Pass sourceOwnerId for False Orders Option 1
                      // This ensures Revealed tokens target the correct player's hand
                      sourceOwnerId: playerId, // Use the player whose hand card was targeted
                    }
                  }
                }
                onAction(continueAction, { row: -1, col: -1 })
              }
            }

            interactionLock.current = true
            setTimeout(() => {
              interactionLock.current = false
            }, 300)
            return
          }
        }
      }

      if (!handCard) {
        // Not a hand card - check if it's a board cell
        const boardCell = target?.closest('[data-board-coords]')
        if (boardCell) {
          const coords = boardCell.getAttribute('data-board-coords')
          if (coords) {
            const [rowStr, colStr] = coords.split(',')
            const row = parseInt(rowStr, 10)
            const col = parseInt(colStr, 10)
            // Add bounds check before accessing board
            if (
              !isNaN(row) && !isNaN(col) &&
              row >= 0 && row < gameState.board.length &&
              gameState.board[row] &&
              col >= 0 && col < gameState.board[row].length &&
              gameState.board[row][col]
            ) {
              const targetCard = gameState.board[row][col].card

              if (targetCard?.ownerId !== undefined) {
                const constraints = {
                  targetOwnerId: cursorStack.targetOwnerId,
                  excludeOwnerId: cursorStack.excludeOwnerId,
                  onlyOpponents: cursorStack.onlyOpponents || (cursorStack.targetOwnerId === -1),
                  onlyFaceDown: cursorStack.onlyFaceDown,
                  targetType: cursorStack.targetType,
                  requiredTargetStatus: cursorStack.requiredTargetStatus,
                  mustBeAdjacentToSource: cursorStack.mustBeAdjacentToSource,
                  mustBeInLineWithSource: cursorStack.mustBeInLineWithSource,
                  maxDistanceFromSource: cursorStack.maxDistanceFromSource,
                  maxOrthogonalDistance: cursorStack.maxOrthogonalDistance,
                  sourceCoords: cursorStack.sourceCoords,
                  tokenType: cursorStack.type,
                }

                const isValid = validateTarget(
                  { card: targetCard, ownerId: targetCard.ownerId, location: 'board', boardCoords: { row, col } },
                  constraints,
                  effectiveActorId,
                  gameState.players,
                  cursorStack.originalOwnerId, // CRITICAL: Pass token owner ID for command cards
                )

                if (!isValid) {
                  // Invalid target - keep cursor stack active to allow retry
                  // Don't close selection mode on invalid target
                  return
                }

                // const targetPlayer = gameState.players.find(p => p.id === targetCard.ownerId) // @ts-ignore - Unused but kept for future use

                // For Revealed tokens on opponent's face-down board cards:
                // Skip the old requestCardReveal system - use unified handleDrop instead
                // The status will be added and card will be revealed to token owner
              }

              if (targetCard) {
                const amountToDrop = cursorStack.placeAllAtOnce ? cursorStack.count : 1

                handleDrop({
                  card: { id: 'stack', deck: 'counter', name: '', imageUrl: '', fallbackImage: '', power: 0, abilityText: '', types: [] },
                  source: 'counter_panel',
                  ownerId: cursorStack.originalOwnerId ?? cursorStack.sourceCard?.ownerId, // Use originalOwnerId (command card owner) for status ownership
                  statusType: cursorStack.type,
                  replaceStatusType: cursorStack.replaceStatus ? cursorStack.requiredTargetStatus : undefined, // For Censor: Exploit -> Stun
                  count: amountToDrop,
                }, { target: 'board', boardCoords: { row, col } })
                // Trigger target selection effect
                triggerClickWave('board', { row, col })

                // CRITICAL: Store info about the just-placed token for commands like Data Interception
                // This allows the next step (SELECT_UNIT_FOR_MOVE) to see the token even before gameState updates
                const effectiveActorId = (gameState.players.find(p => p.id === gameState.activePlayerId)?.isDummy && gameState.activePlayerId !== null)
                  ? gameState.activePlayerId
                  : (cursorStack.originalOwnerId ?? localPlayerId ?? 0)

                // CRITICAL: Create lastPlacedToken object BEFORE updating commandContext
                // This ensures we can pass it to CONTINUE_AUTO_STEPS immediately
                const lastPlacedToken = {
                  cardId: targetCard.id,
                  tokenType: cursorStack.type,
                  addedByPlayerId: effectiveActorId,
                  boardCoords: { row, col },
                }

                setCommandContext(prev => ({
                  ...prev,
                  lastPlacedToken,
                  ...(cursorStack.recordContext ? {
                    lastMovedCardCoords: { row, col },
                    lastMovedCardId: targetCard.id,
                    // CRITICAL: Store target card's owner ID for False Orders Option 1
                    // This allows Revealed tokens to target the correct player's hand
                    sourceOwnerId: targetCard.ownerId,
                  } : {}),
                }))

                if (cursorStack.sourceCoords && cursorStack.sourceCoords.row >= 0) {
                  markAbilityUsed(cursorStack.sourceCoords, cursorStack.isDeployAbility)
                }
                // Calculate remaining count AFTER this drop
                const remainingCount = cursorStack.count - amountToDrop

                if (remainingCount > 0) {
                  setCursorStack(prev => prev ? ({ ...prev, count: remainingCount }) : null)
                } else {
                  // Stack is now empty - clear it and execute chained action
                  if (cursorStack.chainedAction) {
                    const chained = { ...cursorStack.chainedAction }
                    if (cursorStack.recordContext) {
                      if (chained.mode === 'SELECT_CELL') {
                        chained.sourceCard = targetCard
                        chained.sourceCoords = { row, col }
                        chained.recordContext = true
                      }
                      // For GLOBAL_AUTO_APPLY (e.g., Temporary Shelter REMOVE_ALL_AIM_FROM_CONTEXT)
                      // Update sourceCoords AND sourceCard to point to the target card where token was placed
                      if (chained.type === 'GLOBAL_AUTO_APPLY') {
                        chained.sourceCoords = { row, col }
                        chained.sourceCard = targetCard
                      }
                      // For CREATE_STACK (e.g., False Orders Reveal), update sourceCoords but NOT sourceCard
                      // The sourceCard should remain the command card (False Orders), not the moved card
                      if (chained.type === 'CREATE_STACK') {
                        chained.sourceCoords = { row, col }
                        // Only update sourceCard if originalOwnerId is not set (preserve command card ownership)
                        if (!chained.originalOwnerId) {
                          chained.sourceCard = targetCard
                        }
                      }
                      // ZIUS_LINE_SELECT: use target card coords as anchor point (where Exploit was placed)
                      if (chained.mode === 'ZIUS_LINE_SELECT') {
                        chained.sourceCoords = { row, col }
                      }
                    }
                    // CRITICAL: Set _sourceOwnerId for False Orders Option 1 chainedAction
                    // This ensures Revealed tokens target the correct player's hand when chainedAction is executed
                    if (cursorStack.recordContext && targetCard.ownerId !== undefined) {
                      chained._sourceOwnerId = targetCard.ownerId
                    }
                    // For CREATE_STACK chained actions (e.g., False Orders Reveal), clear abilityMode to remove board highlights
                    if (chained.type === 'CREATE_STACK') {
                      setAbilityMode(null)
                    }
                    // CRITICAL: Clear cursorStack IMMEDIATELY before adding chainedAction
                    // This prevents the infinite loop bug where the last token can be placed repeatedly
                    // because cursorStack remains active after chainedAction is scheduled
                    flushSync(() => {
                      setAbilityMode(null)
                      setCursorStack(null)
                    })
                    clearTargetingMode()

                    // CRITICAL FIX: Add chainedAction to actionQueue AFTER clearing abilityMode and cursorStack
                    // This ensures the actionQueue useEffect can process the chained action immediately
                    // Also ensures cleanupCommand stays at the end
                    if (setActionQueue) {
                      // Add unique ID to prevent duplicate processing
                      if (!chained._uniqueId) {
                        chained._uniqueId = `${chained.type}_${Date.now()}_${Math.random()}`
                      }

                      // CRITICAL: If this is part of AUTO_STEPS, also add CONTINUE_AUTO_STEPS after chainedAction
                      // This ensures command cards are discarded after all steps complete
                      const actionsToQueue: any[] = [chained]
                      if (cursorStack._autoStepsContext) {
                        // CRITICAL: For CREATE_STACK actions, currentStepIndex points to the NEXT step (nextStepIndex + 1)
                        // We need to decrement it to get the COMPLETED step index for handleContinueAutoSteps
                        const autoStepsContext = { ...cursorStack._autoStepsContext }
                        const completedStepIndex = autoStepsContext.currentStepIndex > 0 ? autoStepsContext.currentStepIndex - 1 : 0
                        const continueAction: any = {
                          type: 'CONTINUE_AUTO_STEPS',
                          sourceCard: cursorStack.sourceCard,
                          sourceCoords: cursorStack.sourceCoords,
                          isDeployAbility: cursorStack.isDeployAbility,
                          readyStatusToRemove: cursorStack.readyStatusToRemove,
                          payload: {
                            _autoStepsContext: {
                              ...autoStepsContext,
                              currentStepIndex: completedStepIndex,
                            },
                            stepContext: {
                              targetCoords: { row, col },
                              targetCard: targetCard,
                              lastPlacedToken: lastPlacedToken, // CRITICAL: Pass lastPlacedToken for next step
                              // CRITICAL: Pass sourceOwnerId for False Orders Option 1
                              // This ensures Revealed tokens target the correct player's hand
                              sourceOwnerId: targetCard.ownerId,
                            }
                          }
                        }
                        actionsToQueue.push(continueAction)
                      }

                      setActionQueue(prev => {
                        // Check if this action is already in the queue
                        if (prev.some(a => (a as any)._uniqueId === chained._uniqueId)) {
                          return prev
                        }
                        const cleanupActions = prev.filter(a => a.payload?.cleanupCommand)
                        const otherActions = prev.filter(a => !a.payload?.cleanupCommand)
                        return [...otherActions, ...actionsToQueue, ...cleanupActions]
                      })
                    } else {
                      // Fallback: execute directly if setActionQueue not available
                      // CRITICAL: Add sourceOwnerId to chainedAction for False Orders Option 1
                      // This ensures Revealed tokens target the correct player's hand
                      if (cursorStack.recordContext && targetCard.ownerId !== undefined) {
                        chained._sourceOwnerId = targetCard.ownerId
                      }
                      onAction(chained, { row, col })
                      // Also continue AUTO_STEPS if applicable
                      if (cursorStack._autoStepsContext) {
                        // CRITICAL: For CREATE_STACK actions, currentStepIndex points to the NEXT step (nextStepIndex + 1)
                        // We need to decrement it to get the COMPLETED step index for handleContinueAutoSteps
                        const autoStepsContext = { ...cursorStack._autoStepsContext }
                        const completedStepIndex = autoStepsContext.currentStepIndex > 0 ? autoStepsContext.currentStepIndex - 1 : 0
                        const continueAction: any = {
                          type: 'CONTINUE_AUTO_STEPS',
                          sourceCard: cursorStack.sourceCard,
                          sourceCoords: cursorStack.sourceCoords,
                          isDeployAbility: cursorStack.isDeployAbility,
                          readyStatusToRemove: cursorStack.readyStatusToRemove,
                          payload: {
                            _autoStepsContext: {
                              ...autoStepsContext,
                              currentStepIndex: completedStepIndex,
                            },
                            stepContext: {
                              targetCoords: { row, col },
                              targetCard: targetCard,
                              lastPlacedToken: lastPlacedToken, // CRITICAL: Pass lastPlacedToken for next step
                              // CRITICAL: Pass sourceOwnerId for False Orders Option 1
                              // This ensures Revealed tokens target the correct player's hand
                              sourceOwnerId: targetCard.ownerId,
                            }
                          }
                        }
                        onAction(continueAction, { row, col })
                      }
                    }
                  } else if (cursorStack._autoStepsContext) {
                    // AUTO_STEPS continuation after cursorStack completes (Zius Setup, Centurion Commit, etc.)
                    // CRITICAL: For CREATE_STACK actions, currentStepIndex points to the NEXT step (nextStepIndex + 1)
                    // We need to decrement it to get the COMPLETED step index for handleContinueAutoSteps
                    const autoStepsContext = { ...cursorStack._autoStepsContext }
                    const originalStepIndex = autoStepsContext.currentStepIndex
                    // Use currentStepIndex - 1 as the completed step index for CREATE_STACK
                    // This fixes Enhanced Interrogation Option 2 where step index wasn't advancing
                    const completedStepIndex = autoStepsContext.currentStepIndex > 0 ? autoStepsContext.currentStepIndex - 1 : 0

                    // CRITICAL: Check if there's a chainedAction from the current step that needs to execute
                    // This fixes Temporary Shelter where REMOVE_ALL_AIM_FROM_CONTEXT must execute after Shield placement
                    // before continuing to the next AUTO_STEPS step (CLEANUP_COMMAND)
                    const hasChainedAction = !!cursorStack.chainedAction
                    const chainedActionType = cursorStack.chainedAction?.type
                    const chainedActionPayloadCustomAction = cursorStack.chainedAction?.payload?.customAction

                    // Create CONTINUE_AUTO_STEPS action with stepContext (where the token was placed)
                    // CRITICAL: Pass completedStepIndex as currentStepIndex for handleContinueAutoSteps
                    const continueAction: any = {
                      type: 'CONTINUE_AUTO_STEPS',
                      sourceCard: cursorStack.sourceCard,
                      sourceCoords: cursorStack.sourceCoords,
                      isDeployAbility: cursorStack.isDeployAbility,
                      readyStatusToRemove: cursorStack.readyStatusToRemove,
                      payload: {
                        _autoStepsContext: {
                          ...autoStepsContext,
                          currentStepIndex: completedStepIndex,
                        },
                        stepContext: {
                          targetCoords: { row, col },
                          targetCard: targetCard,
                          lastPlacedToken: lastPlacedToken, // CRITICAL: Pass lastPlacedToken for next step
                          // CRITICAL: Pass sourceOwnerId for False Orders Option 1
                          // This ensures Revealed tokens target the correct player's hand
                          sourceOwnerId: targetCard.ownerId,
                        }
                      }
                    }

                    // CRITICAL: Pass chainedAction so modeHandlers can execute it before advancing to next step
                    // This fixes Temporary Shelter where chainedAction (REMOVE_ALL_AIM_FROM_CONTEXT) must execute
                    if (cursorStack.chainedAction) {
                      continueAction.chainedAction = cursorStack.chainedAction
                    }
                    onAction(continueAction, { row, col })
                  }
                  // Clear targeting mode when cursor stack is fully consumed
                  // This handles cases like GAWAIN_DEPLOY_SHIELD_AIM where no chained action exists
                  // CRITICAL: Check if there are more AUTO_STEPS before clearing abilityMode
                  // If there are more steps (e.g., SELECT_UNIT_FOR_MOVE after CREATE_STACK), don't clear yet
                  const hasMoreAutoSteps = cursorStack._autoStepsContext &&
                    cursorStack._autoStepsContext.currentStepIndex < (cursorStack._autoStepsContext.steps?.length || 0)
                  // CRITICAL: Clear abilityMode AND cursorStack SYNCHRONOUSLY to prevent
                  // useEffect in App.tsx from restoring targetingMode
                  // BUT ONLY if there are no more AUTO_STEPS to process
                  if (!hasMoreAutoSteps) {
                    flushSync(() => {
                      setAbilityMode(null)
                      setCursorStack(null)
                    })
                    clearTargetingMode()
                  } else {
                    // Still have more AUTO_STEPS
                    // CRITICAL: Use setTimeout to give React time to update cursorStack state
                    // This fixes Data Interception/Enhanced Interrogation where new Revealed cursorStack
                    // is created but immediate check sees old cursorStack (Exploit) and clears it
                    setTimeout(() => {
                      // Check the NEW cursorStack after React state update
                      setCursorStack(currentStack => {
                        if (!currentStack) {
                          return null
                        }
                        const isHandTargeting = currentStack.targetOwnerId === -1 ||
                          (currentStack.onlyOpponents && currentStack.onlyFaceDown)
                        if (isHandTargeting) {
                          // For hand targeting, keep cursorStack so user can place tokens
                          return currentStack
                        } else {
                          // For board targeting, clear cursorStack
                          clearTargetingMode()
                          return null
                        }
                      })
                    }, 0)
                  }
                }
                interactionLock.current = true
                setTimeout(() => {
                  interactionLock.current = false
                }, 300)
              }
            }
          }
        } else {
          const isOverModal = target?.closest('.counter-modal-content')
          const isOverGameBoard = target?.closest('[data-board-coords]') !== null
          const isOverHandCard = target?.closest('[data-hand-card]') !== null

          if (cursorStack.isDragging) {
            if (isOverModal) {
              setCursorStack(prev => prev ? { ...prev, isDragging: false } : null)
            } else {
              // Only close if not clicking on game board or hand cards
              // This allows retrying token placement on valid targets
              if (!isOverGameBoard && !isOverHandCard) {
                // CRITICAL: Clear abilityMode AND cursorStack SYNCHRONOUSLY to prevent
                // useEffect in App.tsx from restoring targetingMode
                flushSync(() => {
                  setAbilityMode(null)
                  setCursorStack(null)
                })
                clearTargetingMode()
              }
            }
          } else {
            // Only close if clicking outside modal and outside game areas
            if (!isOverModal && !isOverGameBoard && !isOverHandCard) {
              // CRITICAL: Clear abilityMode AND cursorStack SYNCHRONOUSLY to prevent
              // useEffect in App.tsx from restoring targetingMode
              flushSync(() => {
                setAbilityMode(null)
                setCursorStack(null)
              })
              clearTargetingMode()
            }
          }
        }
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [cursorStack, handleDrop, gameState, localPlayerId, requestCardReveal, markAbilityUsed, interactionLock, setCommandContext, onAction, setCursorStack, setAbilityMode, triggerClickWave])

  // Handle right-click to cancel token placement mode
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      if (!cursorStack) {
        return
      }
      // Right-click cancels token placement mode
      e.preventDefault()
      // CRITICAL: Clear abilityMode AND cursorStack SYNCHRONOUSLY to prevent
      // useEffect in App.tsx from restoring targetingMode
      // CRITICAL: Use force=true for clearTargetingMode to ensure it works for all players
      flushSync(() => {
        setAbilityMode(null)
        setCursorStack(null)
      })
      // Pass force=true to ensure targetingMode is cleared regardless of ownership
      clearTargetingMode(true)
    }
    window.addEventListener('contextmenu', handleGlobalContextMenu, { capture: true })
    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu, { capture: true })
    }
  }, [cursorStack, setCursorStack, setAbilityMode, clearTargetingMode])

  const handleCounterMouseDown = (type: string, e: React.MouseEvent) => {
    mousePos.current = { x: e.clientX, y: e.clientY }

    // Determine token owner: if active player is dummy, tokens belong to dummy
    // Otherwise, tokens belong to local player
    const activePlayer = gameState.players.find(p => p.id === gameState.activePlayerId)
    const tokenOwnerId = (activePlayer?.isDummy && gameState.activePlayerId !== null)
      ? gameState.activePlayerId
      : localPlayerId ?? 0

    // Use universal token targeting system to create cursorStack
    setCursorStack(prev => {
      return createTokenCursorStack(type, tokenOwnerId, prev)
    })
  }

  return {
    cursorFollowerRef,
    handleCounterMouseDown,
  }
}
