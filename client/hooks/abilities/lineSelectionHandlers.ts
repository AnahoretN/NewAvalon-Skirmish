/**
 * Line Selection Handlers
 *
 * Handles line selection for abilities like Integrator, Zius, Centurion
 */

import type { AbilityAction, FloatingTextData } from '@/types'
import { TIMING } from '@/utils/common'
import { calculateActiveBounds } from '@shared/utils/lineSelection'

// Import advanceToNextStepWithCoords from modeHandlers
// Note: This creates a circular dependency, but it's safe because we only use the function
// We'll pass it as a prop instead to avoid the circular dependency

export interface LineSelectionProps {
  gameState: any
  localPlayerId: number | null
  abilityMode: AbilityAction | null
  interactionLock: React.MutableRefObject<boolean>
  setAbilityMode: React.Dispatch<React.SetStateAction<AbilityAction | null>>
  markAbilityUsed: (coords: { row: number; col: number }, isDeploy?: boolean, setDeployAttempted?: boolean, readyStatusToRemove?: string) => void
  updatePlayerScore: (playerId: number, delta: number) => void
  triggerFloatingText: (data: Omit<FloatingTextData, 'timestamp'> | Omit<FloatingTextData, 'timestamp'>[]) => void
  nextPhase: (forceTurnPass?: boolean) => void
  modifyBoardCardPower: (coords: { row: number; col: number }, delta: number) => void
  scoreLine: (r1: number, c1: number, r2: number, c2: number, pid: number) => void
  scoreDiagonal: (r1: number, c1: number, r2: number, c2: number, pid: number, bonusType?: 'point_per_support' | 'draw_per_support') => void
  commandContext: any
  isWebRTCMode?: boolean  // Whether WebRTC P2P mode is enabled
  // CRITICAL: Props for AUTO_STEPS continuation (for command cards like Logistics Chain)
  continueAutoSteps?: (currentStepIndex: number) => void  // Callback to continue to next AUTO_STEPS
}

/**
 * Handle line selection for various ability modes
 * Returns true if the selection was handled, false otherwise
 */
export function handleLineSelection(
  coords: { row: number; col: number },
  props: LineSelectionProps
): boolean {
  const {
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
    isWebRTCMode = false,
    continueAutoSteps,
  } = props

  if (!abilityMode) {
    return false
  }

  const { mode, sourceCard, sourceCoords, payload, isDeployAbility, readyStatusToRemove } = abilityMode

  // SCORE_LAST_PLAYED_LINE (Integrator)
  if (mode === 'SCORE_LAST_PLAYED_LINE' && abilityMode.sourceCoords) {
    // Prevent multiple clicks
    if (interactionLock.current) {
      return true
    }

    const { row: r1, col: c1 } = abilityMode.sourceCoords
    const { row: r2, col: c2 } = coords

    // DEBUG: Log what we're clicking on
    console.log('[SCORE_LAST_PLAYED_LINE] Click coords:', { r1, c1, r2, c2, isSame: r1 === r2 && c1 === c2 })

    // CRITICAL: Cannot click on the last played card itself
    // Player must click on another cell in the same row or column to select the line
    if (r1 === r2 && c1 === c2) {
      // Clicked on the same cell as the last played card - ignore
      console.log('[SCORE_LAST_PLAYED_LINE] Blocked: clicked on same cell')
      return true
    }

    // Ignore clicks that are not in the same row or column
    if (r1 !== r2 && c1 !== c2) {
      console.log('[SCORE_LAST_PLAYED_LINE] Blocked: not in same row or column')
      return true
    }

    console.log('[SCORE_LAST_PLAYED_LINE] Proceeding with scoring')

    // Lock interaction to prevent multiple clicks
    interactionLock.current = true

    // Check if this is WebRTC guest mode
    const hasWebrtcGlobal = typeof window !== 'undefined' && (window as any).webrtcManager
    const isHostFlag = hasWebrtcGlobal ? (window as any).webrtcIsHost : true
    const isWebRTCGuest = isWebRTCMode && hasWebrtcGlobal && !isHostFlag

    if (isWebRTCGuest) {
      // Guest: Calculate score locally, then send result to host
      const playerId = localPlayerId ?? gameState.activePlayerId!
      const gridSize = gameState.board.length
      // CRITICAL FIX: Use active grid boundaries, not full board boundaries
      // When activeGridSize < gridSize, the active grid is centered with an offset
      const { minBound, maxBound } = calculateActiveBounds(gridSize, gameState.activeGridSize)
      let rStart = r1, rEnd = r1, cStart = c1, cEnd = c1
      if (r1 === r2) {
        // Horizontal line: same row, iterate through active grid columns
        rStart = r1; rEnd = r1
        cStart = minBound; cEnd = maxBound
      } else if (c1 === c2) {
        // Vertical line: same column, iterate through active grid rows
        cStart = c2; cEnd = c2
        rStart = minBound; rEnd = maxBound
      } else {
        interactionLock.current = false
        return true
      }

      // Check for Data Liberator (allows scoring opponent's cards with Exploit)
      const hasActiveLiberator = gameState.board.some((row: any[]) =>
        row.some((cell: any) =>
          cell.card?.ownerId === playerId &&
          cell.card.name.toLowerCase().includes('data liberator') &&
          cell.card.statuses?.some((s: any) => s.type === 'Support'),
        ),
      )

      // Calculate score
      let totalScore = 0
      const scoreEvents: { row: number; col: number; text: string; playerId: number }[] = []

      for (let r = rStart; r <= rEnd; r++) {
        for (let c = cStart; c <= cEnd; c++) {
          const cell = gameState.board[r][c]
          const card = cell.card
          if (card && !card.statuses?.some((s: any) => s.type === 'Stun')) {
            const isOwner = card.ownerId === playerId
            const hasExploit = card.statuses?.some((s: any) => s.type === 'Exploit' && s.addedByPlayerId === playerId)
            if (isOwner || (hasActiveLiberator && hasExploit && card.ownerId !== playerId)) {
              const points = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
              if (points > 0) {
                totalScore += points
                scoreEvents.push({ row: r, col: c, text: `+${points}`, playerId })
              }
            }
          }
        }
      }

      // Show floating texts locally (guest sees them immediately)
      if (scoreEvents.length > 0) {
        triggerFloatingText(scoreEvents)
      }

      // Update local score immediately so guest sees the updated score in their panel
      const webrtcManager = (window as any).webrtcManager
      if (totalScore > 0) {
        // Get current player score from gameState
        const currentPlayer = gameState.players.find((p: any) => p.id === playerId)
        const currentScore = currentPlayer?.score ?? 0
        const newScore = currentScore + totalScore

        // Update local state with new score
        updatePlayerScore(playerId, totalScore)

        // Send new total score to host (host will broadcast to other guests)
        // We send the NEW total score, not the delta, to avoid double-counting
        webrtcManager.sendMessageToHost({
          type: 'SCORING_LINE_SELECTED',
          senderId: webrtcManager.getPeerId?.() ?? undefined,
          playerId: localPlayerId ?? undefined,
          data: {
            sourceCoords: { row: r1, col: c1 },
            selectedCoords: { row: r2, col: c2 },
            mode: 'SCORE_LAST_PLAYED_LINE',
            newScore,  // Send new total score, not delta
            scoreEvents,
          },
          timestamp: Date.now()
        })
      } else {
        // Even with zero score, send the message to close scoring mode
        const currentPlayer = gameState.players.find((p: any) => p.id === playerId)
        const currentScore = currentPlayer?.score ?? 0

        webrtcManager.sendMessageToHost({
          type: 'SCORING_LINE_SELECTED',
          senderId: webrtcManager.getPeerId?.() ?? undefined,
          playerId: localPlayerId ?? undefined,
          data: {
            sourceCoords: { row: r1, col: c1 },
            selectedCoords: { row: r2, col: c2 },
            mode: 'SCORE_LAST_PLAYED_LINE',
            newScore: currentScore,  // Current score (no change)
            scoreEvents: [],
          },
          timestamp: Date.now()
        })
      }

      // Close mode immediately
      setAbilityMode(null)

      // Request pass turn - host will transition to next player with Preparation phase
      // This is done after sending the score so host has the updated score
      setTimeout(() => {
        webrtcManager.sendMessageToHost({
          type: 'REQUEST_PASS_TURN',
          senderId: webrtcManager.getPeerId?.() ?? undefined,
          playerId: localPlayerId ?? undefined,
          timestamp: Date.now()
        })
      }, 50) // Small delay to ensure score update is processed first

      // Unlock after delay
      setTimeout(() => {
        interactionLock.current = false
      }, TIMING.MODE_CLEAR_DELAY)

      return true
    }

    // Host (or non-WebRTC): Process scoring locally
    const playerId = gameState.activePlayerId!
    const gridSize = gameState.board.length
    // CRITICAL FIX: Use active grid boundaries, not full board boundaries
    // When activeGridSize < gridSize, the active grid is centered with an offset
    const { minBound, maxBound } = calculateActiveBounds(gridSize, gameState.activeGridSize)
    let rStart = r1, rEnd = r1, cStart = c1, cEnd = c1
    if (r1 === r2) {
      // Horizontal line: same row, iterate through active grid columns
      rStart = r1; rEnd = r1
      cStart = minBound; cEnd = maxBound
    } else if (c1 === c2) {
      // Vertical line: same column, iterate through active grid rows
      cStart = c2; cEnd = c2
      rStart = minBound; rEnd = maxBound
    } else {
      interactionLock.current = false
      return true
    }

    const hasActiveLiberator = gameState.board.some((row: any[]) =>
      row.some((cell: any) =>
        cell.card?.ownerId === playerId &&
        cell.card.name.toLowerCase().includes('data liberator') &&
        cell.card.statuses?.some((s: any) => s.type === 'Support'),
      ),
    )

    let totalScore = 0
    const scoreEvents: Omit<FloatingTextData, 'timestamp'>[] = []

    for (let r = rStart; r <= rEnd; r++) {
      for (let c = cStart; c <= cEnd; c++) {
        const cell = gameState.board[r][c]
        const card = cell.card
        if (card && !card.statuses?.some((s: any) => s.type === 'Stun')) {
          const isOwner = card.ownerId === playerId
          const hasExploit = card.statuses?.some((s: any) => s.type === 'Exploit' && s.addedByPlayerId === playerId)
          if (isOwner || (hasActiveLiberator && hasExploit && card.ownerId !== playerId)) {
            const points = Math.max(0, card.power + (card.powerModifier || 0) + (card.bonusPower || 0))
            if (points > 0) {
              totalScore += points
              scoreEvents.push({ row: r, col: c, text: `+${points}`, playerId })
            }
          }
        }
      }
    }

    // Send floating texts for all players to see
    if (scoreEvents.length > 0) {
      triggerFloatingText(scoreEvents)
    }

    // For WebRTC host: use updatePlayerScore to update UI immediately
    // updatePlayerScore will call through to HostManager's updateHostPlayerScore
    if (isWebRTCMode && (window as any).webrtcIsHost) {
      if (totalScore > 0) {
        // This will update UI and broadcast to guests
        updatePlayerScore(playerId, totalScore)
      }

      // Broadcast ability mode clear to guests
      const webrtcManager = (window as any).webrtcManager
      if (webrtcManager?.broadcastToGuests) {
        webrtcManager.broadcastToGuests({
          type: 'ABILITY_MODE_CLEARED',
          senderId: webrtcManager.getPeerId?.() ?? undefined,
          data: {
            mode: 'SCORE_LAST_PLAYED_LINE',
            playerId,
            scoreEvents,
          },
          timestamp: Date.now()
        })
      }

      // CRITICAL: For host, delay nextPhase to allow React state update to propagate
      // This ensures the score update is visible before the phase changes
      if (nextPhase) {
        setTimeout(() => {
          nextPhase(true) // forceTurnPass=true to pass to next player
        }, 50) // Small delay to let React render the updated score
      }
    } else {
      // Non-WebRTC mode: use standard updatePlayerScore
      if (totalScore > 0) {
        updatePlayerScore(playerId, totalScore)
      }

      // Pass turn after scoring
      if (nextPhase) {
        nextPhase(true) // forceTurnPass=true to pass to next player
      }
    }

    // Mark ability as used and close mode (same pattern as other modes)
    if (sourceCoords && sourceCoords.row >= 0) {
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    }

    // Clear mode with standard delay (like all other ability modes)
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)

    // Unlock interaction after a short delay
    setTimeout(() => {
      interactionLock.current = false
    }, TIMING.MODE_CLEAR_DELAY + 100)

    return true
  }

  // SELECT_LINE_START
  if (mode === 'SELECT_LINE_START') {
    setAbilityMode({
      type: 'ENTER_MODE',
      mode: 'SELECT_LINE_END',
      sourceCard,
      sourceCoords,
      isDeployAbility,
      payload: { ...payload, firstCoords: coords },
    })
    return true
  }

  // SELECT_LINE_END
  if (mode === 'SELECT_LINE_END' && payload?.firstCoords) {
    const { row: r1, col: c1 } = payload.firstCoords
    const { row: r2, col: c2 } = coords

    // CRITICAL: Cannot select the same point as the starting point
    // Player must click on a different cell in the same row or column
    if (r1 === r2 && c1 === c2) {
      // Clicked on the same cell as the starting point - ignore
      return true
    }

    // Ignore clicks that are not in the same row or column
    if (r1 !== r2 && c1 !== c2) {
      return true
    }
    const actionType = payload.actionType

    const actorId = sourceCard?.ownerId ?? (gameState.players.find((p: any) => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : (localPlayerId || gameState.activePlayerId))

    // ZIUS_SCORING
    if (actionType === 'ZIUS_SCORING') {
      // Validate that the selected line passes through the target card (where Exploit was placed)
      const targetCoords = commandContext.lastMovedCardCoords

      if (targetCoords) {
        // Check if targetCoords is on the selected line
        const isOnRow = r1 === r2 && targetCoords.row === r1
        const isOnCol = c1 === c2 && targetCoords.col === c1

        if (!isOnRow && !isOnCol) {
          // Selected line does NOT pass through the target card - invalid selection
          return true
        }
      }

      const gridSize = gameState.board.length
      // CRITICAL FIX: Use active grid boundaries, not full board boundaries
      const { minBound, maxBound } = calculateActiveBounds(gridSize, gameState.activeGridSize)
      let startR = minBound, endR = maxBound
      let startC = minBound, endC = maxBound

      if (r1 === r2) {
        startR = endR = r1
      } else if (c1 === c2) {
        startC = endC = c1
      } else {
        return true
      }

      let exploitCount = 0
      for (let r = startR; r <= endR; r++) {
        for (let c = startC; c <= endC; c++) {
          const cell = gameState.board[r][c]
          if (cell.card) {
            exploitCount += cell.card.statuses?.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
          }
        }
      }

      if (exploitCount > 0 && actorId) {
        if (sourceCoords) {
          triggerFloatingText({
            row: sourceCoords.row,
            col: sourceCoords.col,
            text: `+${exploitCount}`,
            playerId: actorId,
          })
        }
        updatePlayerScore(actorId, exploitCount)
      }
      if (sourceCoords && sourceCoords.row >= 0) {
        markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
      }
    }
    // CENTURION_BUFF
    else if (actionType === 'CENTURION_BUFF' && sourceCard && sourceCoords && actorId) {
      const gridSize = gameState.board.length
      // CRITICAL FIX: Use active grid boundaries, not full board boundaries
      const { minBound, maxBound } = calculateActiveBounds(gridSize, gameState.activeGridSize)
      let startR = minBound, endR = maxBound
      let startC = minBound, endC = maxBound
      if (r1 === r2) {
        startR = endR = r1
      } else {
        startC = endC = c1
      }
      for (let r = startR; r <= endR; r++) {
        for (let c = startC; c <= endC; c++) {
          const targetCard = gameState.board[r][c].card
          if (targetCard) {
            const isSelf = targetCard.id === sourceCard.id
            const isOwner = targetCard.ownerId === actorId
            const activePlayer = gameState.players.find((p: any) => p.id === actorId)
            const targetPlayer = gameState.players.find((p: any) => p.id === targetCard.ownerId)
            const isTeammate = activePlayer?.teamId !== null && targetPlayer?.teamId !== null && activePlayer.teamId === targetPlayer.teamId
            if (!isSelf && (isOwner || isTeammate)) {
              modifyBoardCardPower({ row: r, col: c }, 1)
            }
          }
        }
      }
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    }
    // SCORE_LINE or generic
    else if (actionType === 'SCORE_LINE' || !actionType) {
      scoreLine(r1, c1, r2, c2, actorId!)
      // Advance phase after scoring, unless skipNextPhase is set (e.g., Logistics Chain)
      if (!payload.skipNextPhase) {
        nextPhase()
      }
    }
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    return true
  }

  // SELECT_DIAGONAL (Logistics Chain)
  // Two-step selection: first click selects center, second click selects diagonal endpoint
  if (mode === 'SELECT_DIAGONAL') {
    // CRITICAL: Check if this is part of AUTO_STEPS (command card)
    const autoStepsContext = (payload as any)?._autoStepsContext
    const isCommandCard = !!(autoStepsContext?.steps && autoStepsContext.currentStepIndex !== undefined)

    // Step 1: First click - select center point
    // Use functional state update to avoid stale closure issues
    if (!payload?.firstCoords) {
      setAbilityMode(prev => {
        if (!prev || prev.mode !== 'SELECT_DIAGONAL') {
          return prev
        }
        return { ...prev, payload: { ...(prev.payload || {}), firstCoords: coords } }
      })
      return true
    }

    // Second click - validate diagonal and execute
    const { row: r1, col: c1 } = payload.firstCoords
    const { row: r2, col: c2 } = coords

    // Check if second point is on either diagonal through first point
    const onMainDiagonal = (r1 - c1) === (r2 - c2)
    const onAntiDiagonal = (r1 + c1) === (r2 + c2)

    if (!onMainDiagonal && !onAntiDiagonal) {
      // Invalid selection - clicked cell not on diagonal through center
      // Don't reset firstCoords, let player try again
      return true
    }

    // CRITICAL: Use sourceCard.ownerId for command cards (the player who owns the command card)
    // This fixes dummy player control in P2P mode
    const ownerId = payload?.playerId ?? sourceCard?.ownerId ?? localPlayerId ?? 0
    const bonusType = payload?.bonusType || 'point_per_support'

    // Execute diagonal scoring via scoreDiagonal action
    if (scoreDiagonal) {
      scoreDiagonal(r1, c1, r2, c2, ownerId, bonusType)
    }

    // CRITICAL: Do NOT advance phase for command cards (AUTO_STEPS)
    // Command cards should stay in the same phase after execution
    if (!isCommandCard && !payload.skipNextPhase) {
      nextPhase()
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    } else if (isCommandCard && continueAutoSteps) {
      // For command cards, continue to next step (CLEANUP_COMMAND)
      // Continue to next step (CLEANUP_COMMAND)
      continueAutoSteps(autoStepsContext.currentStepIndex + 1)
    } else {
      // Clear ability mode
      setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)
    }
    return true
  }

  // SELECT_LINE_FOR_EXPLOIT_SCORING (Zius Setup second step, Unwavering Integrator Setup)
  // Single-click line selection: player clicks any cell in the line they want to score
  // - Zius Setup: The line must pass through the target card (where Exploit was placed in step 1)
  // - Unwavering Integrator: Can select ANY row or column (first click determines the line)
  if (mode === 'SELECT_LINE_FOR_EXPLOIT_SCORING') {
    // Prevent multiple clicks
    if (interactionLock.current) {
      return true
    }

    // Use payload.targetCoords (synchronous) as priority, fallback to commandContext.lastMovedCardCoords (async)
    // For Unwavering Integrator, targetCoords will be undefined - player can select any row/column
    const targetCoords = payload?.targetCoords || commandContext.lastMovedCardCoords

    const { row: clickedRow, col: clickedCol } = coords

    // DEBUG: Log what we're clicking on
    console.log('[SELECT_LINE_FOR_EXPLOIT_SCORING] Click coords:', { clickedRow, clickedCol, targetCoords, sourceCoords })

    let isSameRow = false
    let isSameCol = false
    let selectedRow = clickedRow
    let selectedCol = clickedCol

    if (targetCoords) {
      // Zius Setup: Must select line through the target card
      const { row: targetRow, col: targetCol } = targetCoords

      // CRITICAL: Cannot click on the target card itself
      // Player must click on another cell in the same row or column to select the line
      if (clickedRow === targetRow && clickedCol === targetCol) {
        // Clicked on the same cell as the target card - ignore
        console.log('[SELECT_LINE_FOR_EXPLOIT_SCORING] Blocked: clicked on target card')
        return true
      }

      isSameRow = clickedRow === targetRow
      isSameCol = clickedCol === targetCol

      if (!isSameRow && !isSameCol) {
        // Clicked cell is not in the same row or column as target - invalid
        return true
      }
    } else {
      // Unwavering Integrator: Can select any row or column
      // The clicked cell determines which line to score
      // Use sourceCoords (Unwavering Integrator) as reference
      // Fall back to payload.sourceRow/payload.sourceCol if sourceCoords is not set
      const sourceRowFromCoords = sourceCoords?.row ?? payload?.sourceRow
      const sourceColFromCoords = sourceCoords?.col ?? payload?.sourceCol

      // CRITICAL FIX: Check if we have valid source coords before using them
      // This fixes Unwavering Integrator line selection not working when clicking empty cells
      const hasValidSourceCoords = sourceRowFromCoords !== null && sourceColFromCoords !== undefined

      if (hasValidSourceCoords) {
        // CRITICAL: Cannot click on the Unwavering Integrator card itself
        if (clickedRow === sourceRowFromCoords && clickedCol === sourceColFromCoords) {
          console.log('[SELECT_LINE_FOR_EXPLOIT_SCORING] Blocked: clicked on source card')
          return true
        }

        // We have valid source coords - check if clicked cell is in same row or column
        isSameRow = clickedRow === sourceRowFromCoords
        isSameCol = clickedCol === sourceColFromCoords
        // Player must click on another cell in the same row or column to select the line
        if (clickedRow === sourceRowFromCoords && clickedCol === sourceColFromCoords) {
          // Clicked on the same cell as Unwavering Integrator - ignore
          return true
        }

        // We have valid source coords - check if clicked cell is in same row or column
        isSameRow = clickedRow === sourceRowFromCoords
        isSameCol = clickedCol === sourceColFromCoords

        // Only proceed if in same row OR same column (not both, since we already excluded that case)
      } else {
        // No valid source coords - first click determines the line (row or column)
        // Default to row for consistency
        isSameRow = true
        isSameCol = false
      }

      // Use the clicked row/col as the selected line
      selectedRow = clickedRow
      selectedCol = clickedCol
    }

    // Lock interaction to prevent multiple clicks
    interactionLock.current = true

    const actorId = sourceCard?.ownerId ?? (gameState.players.find((p: any) => p.id === gameState.activePlayerId)?.isDummy ? gameState.activePlayerId : (localPlayerId || gameState.activePlayerId))
    const gridSize = gameState.board.length

    // CRITICAL FIX: Use active grid boundaries, not full board boundaries
    const { minBound, maxBound } = calculateActiveBounds(gridSize, gameState.activeGridSize)

    // Determine the line boundaries based on whether row or column was selected
    let startR = minBound, endR = maxBound
    let startC = minBound, endC = maxBound

    if (isSameRow) {
      // Scoring the entire row
      startR = endR = selectedRow
    } else {
      // Scoring the entire column
      startC = endC = selectedCol
    }

    // Count Exploit counters in the selected line and track which cards have them
    let exploitCount = 0
    const cardsWithExploit: { row: number; col: number }[] = []

    for (let r = startR; r <= endR; r++) {
      for (let c = startC; c <= endC; c++) {
        const cell = gameState.board[r][c]
        if (cell.card) {
          const exploits = cell.card.statuses?.filter((s: any) => s.type === 'Exploit' && s.addedByPlayerId === actorId).length || 0
          if (exploits > 0) {
            exploitCount += exploits
            cardsWithExploit.push({ row: r, col: c })
          }
        }
      }
    }

    // Award points with floating text
    if (exploitCount > 0 && actorId) {
      // Show only ONE total floating text over the card that performed the ability
      // Zius: total over Zius card (sourceCoords)
      // Unwavering Integrator: total over source card (the card itself)
      if (sourceCoords) {
        // Show total over the card that activated the ability (Zius or Unwavering Integrator)
        triggerFloatingText({
          row: sourceCoords.row,
          col: sourceCoords.col,
          text: `+${exploitCount}`,
          playerId: actorId,
        })
      }

      updatePlayerScore(actorId, exploitCount)
    }

    // Mark ability as used
    if (sourceCoords && sourceCoords.row >= 0) {
      markAbilityUsed(sourceCoords, isDeployAbility, false, readyStatusToRemove)
    }

    // Clear mode after delay
    setTimeout(() => setAbilityMode(null), TIMING.MODE_CLEAR_DELAY)

    // Unlock interaction
    setTimeout(() => {
      interactionLock.current = false
    }, TIMING.MODE_CLEAR_DELAY + 100)

    return true
  }

  return false
}
