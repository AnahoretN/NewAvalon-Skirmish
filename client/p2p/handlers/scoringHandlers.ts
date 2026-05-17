/**
 * Scoring handlers for SimpleGameLogic
 *
 * Contains all scoring-related game logic:
 * - Starting scoring phase
 * - Selecting scoring lines
 * - Calculating line scores
 * - Round/match management
 */

import type { GameState, Player } from '../../types'
import { getCardDefinition } from '@/content'

/**
 * START_SCORING - start scoring phase
 */
export function handleStartScoring(state: GameState, playerId: number, enterScoringPhase: (state: GameState, playerId: number) => GameState): GameState {
  if (state.currentPhase !== 3) {return state}

  // Use enterScoringPhase for proper line calculation
  return enterScoringPhase(state, playerId)
}

/**
 * SELECT_SCORING_LINE - select line for scoring
 * CRITICAL: Does NOT pass turn here - turn is passed after floating texts are sent
 */
export function handleSelectScoringLine(state: GameState, playerId: number, data: any): GameState {
  if (!state.isScoringStep) {return state}

  // Check who can control scoring:
  // - Active player can always control their own scoring
  // - Any player can control scoring if active player is a dummy
  const activePlayer = state.players.find(p => p.id === state.activePlayerId)
  const isDummyPlayer = activePlayer?.isDummy ?? false

  if (state.activePlayerId !== playerId && !isDummyPlayer) {
    return state
  }

  const { lineType, lineIndex } = data || {}
  if (!lineType) {return state}

  // Score goes to the ACTIVE player (the dummy or the player whose turn it is)
  const scoringPlayerId = state.activePlayerId ?? 1  // Default to player 1 if null

  // Calculate points based on cards in line
  const points = calculateLineScore(state, scoringPlayerId, lineType, lineIndex)

  const newPlayers = state.players.map(p =>
    p.id === scoringPlayerId
      ? { ...p, score: p.score + points }
      : p
  )

  // CRITICAL: Do NOT pass turn here - just update scores and clear scoring step
  // Turn will be passed AFTER floating texts are sent (in SimpleHost)
  const newState = {
    ...state,
    players: newPlayers,
    isScoringStep: false,
    scoringLines: []  // Clear scoring lines
  }

  return newState
}

/**
 * Calculate points for line
 * lineType: 'row' | 'col' | 'diagonal' | 'anti-diagonal'
 * lineIndex: row/column number (0-based), or undefined for diagonals
 */
export function calculateLineScore(state: GameState, playerId: number, lineType: string, lineIndex?: number): number {
  const gridSize = state.activeGridSize
  const cellsToCheck: { row: number; col: number }[] = []

  // CRITICAL: Calculate offset to convert active grid coordinates to full board coordinates
  // The active grid is centered in the full board, so we need to add the offset
  const totalSize = state.board.length
  const offset = Math.floor((totalSize - gridSize) / 2)

  if (lineType === 'row' && lineIndex !== undefined) {
    // Horizontal line - convert lineIndex to full board coordinate
    const actualRow = lineIndex + offset
    for (let c = 0; c < gridSize; c++) {
      cellsToCheck.push({ row: actualRow, col: c + offset })
    }
  } else if (lineType === 'col' && lineIndex !== undefined) {
    // Vertical line - convert lineIndex to full board coordinate
    const actualCol = lineIndex + offset
    for (let r = 0; r < gridSize; r++) {
      cellsToCheck.push({ row: r + offset, col: actualCol })
    }
  } else if (lineType === 'diagonal') {
    // Main diagonal (top-left to bottom-right)
    for (let i = 0; i < gridSize; i++) {
      cellsToCheck.push({ row: i + offset, col: i + offset })
    }
  } else if (lineType === 'anti-diagonal') {
    // Anti-diagonal (top-right to bottom-left)
    for (let i = 0; i < gridSize; i++) {
      cellsToCheck.push({ row: i + offset, col: (gridSize - 1 - i) + offset })
    }
  }

  // Count sum of power of all player's cards in this line
  // Power includes: base power + powerModifier + bonusPower

  // Collect active scoring modifiers from cards with Support status
  // Scoring modifiers allow cards matching the filter to score for the modifier owner
  type ScoringModifier = {
    targetFilter: string
    requireTokenFromSourceOwner: boolean
    effect: string
    sourceOwnerId: number
  }
  const scoringModifiers: ScoringModifier[] = []

  for (let r = 0; r < state.board.length; r++) {
    for (let c = 0; c < state.board[r]?.length; c++) {
      const cell = state.board[r][c]
      if (!cell.card) {continue}

      const card = cell.card
      // Check if card is owned by this player
      if (card.ownerId !== playerId) {continue}

      // Check if card has Support status added by this player
      const hasSupport = card.statuses?.some((s: any) =>
        s.type === 'Support' && s.addedByPlayerId === playerId
      )
      if (!hasSupport) {continue}

      // Check if card has MODIFY_SCORING ability in its pass abilities
      if (!card.baseId) {continue}
      const cardDef = getCardDefinition(card.baseId)
      if (!cardDef) {continue}

      // ABILITIES is stored as uppercase in contentDatabase
      const abilities = (cardDef as any).ABILITIES
      if (!abilities) {continue}

      for (const ability of abilities) {
        if (ability.type === 'pass' && ability.action === 'MODIFY_SCORING') {
          const { targetFilter, requireTokenFromSourceOwner, effect } = ability.details || {}
          scoringModifiers.push({
            targetFilter: targetFilter || '',
            requireTokenFromSourceOwner: requireTokenFromSourceOwner ?? false,
            effect: effect || '',
            sourceOwnerId: playerId
          })
        }
      }
    }
  }

  let score = 0
  for (const { row, col } of cellsToCheck) {
    const cell = state.board[row]?.[col]
    if (!cell.card) {continue}

    const card = cell.card

    // Skip stunned cards
    if (card.statuses?.some((s: any) => s.type === 'Stun')) {
      continue
    }

    // Standard scoring: player's own cards
    if (card.ownerId === playerId) {
      const power = card.power || 0
      const powerModifier = card.powerModifier || 0
      const bonusPower = card.bonusPower || 0
      score += power + powerModifier + bonusPower
    }
    // Scoring modifiers: cards matching the modifier filter also score for the modifier owner
    else if (scoringModifiers.length > 0) {
      for (const modifier of scoringModifiers) {
        let shouldScore = false

        // Check based on targetFilter
        if (modifier.targetFilter === 'hasCounter_Exploit') {
          // Cards with Exploit tokens from the modifier owner score
          const hasExploitFromPlayer = (card.statuses || []).some((s: any) =>
            s.type === 'Exploit' && s.addedByPlayerId === modifier.sourceOwnerId
          )
          shouldScore = hasExploitFromPlayer
        }
        // Add more targetFilter cases here as needed

        if (shouldScore && modifier.effect === 'scoreForOwner') {
          const power = card.power || 0
          const powerModifier = card.powerModifier || 0
          const bonusPower = card.bonusPower || 0
          score += power + powerModifier + bonusPower
          break // Only apply one scoring modifier per card
        }
      }
    }
  }

  return score
}

/**
 * Find all lines containing player's card
 * Returns array of lines that can be highlighted for scoring
 */
export function findScoringLinesWithPlayerCard(
  state: GameState,
  playerId: number
): Array<{ type: string; index?: number; cells: { row: number; col: number }[] }> {
  const player = state.players.find(p => p.id === playerId)
  if (!player) {return []}

  // Find coordinates of last played card
  let lastPlayedCoords: { row: number; col: number } | null = null
  const boardSize = state.board.length  // Use full board size, not activeGridSize

  if (player.lastPlayedCardId) {
    // Search by lastPlayedCardId - search ENTIRE board, not just active area
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const cell = state.board[r]?.[c]
        if (cell.card?.id === player.lastPlayedCardId) {
          lastPlayedCoords = { row: r, col: c }
          break
        }
      }
      if (lastPlayedCoords) {break}
    }
  }

  // If last played not found, look for any card with enteredThisTurn
  if (!lastPlayedCoords) {
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const cell = state.board[r]?.[c]
        if (cell.card?.ownerId === playerId && cell.card.enteredThisTurn) {
          lastPlayedCoords = { row: r, col: c }
          break
        }
      }
      if (lastPlayedCoords) {break}
    }
  }

  // If no card found - no lines for scoring
  if (!lastPlayedCoords) {
    return []
  }

  const { row, col } = lastPlayedCoords

  // CRITICAL: Convert full board coordinates to active grid coordinates
  // The active grid is centered in the full board, so we subtract the offset
  const totalSize = state.board.length
  const offset = Math.floor((totalSize - state.activeGridSize) / 2)

  const lines: Array<{ type: string; index?: number; cells: { row: number; col: number }[] }> = []

  // Horizontal line (row)
  const rowCells: { row: number; col: number }[] = []
  for (let c = 0; c < state.activeGridSize; c++) {
    rowCells.push({ row, col: c })
  }
  // Convert full board coordinate to active grid coordinate for index
  lines.push({ type: 'row', index: row - offset, cells: rowCells })

  // Vertical line (col)
  const colCells: { row: number; col: number }[] = []
  for (let r = 0; r < state.activeGridSize; r++) {
    colCells.push({ row: r, col })
  }
  // Convert full board coordinate to active grid coordinate for index
  lines.push({ type: 'col', index: col - offset, cells: colCells })

  // Diagonal lines not currently used in scoring phase
  // (may be used in card abilities)

  return lines
}

/**
 * COMPLETE_ROUND - close round end modal
 */
export function handleCompleteRound(state: GameState): GameState {
  return { ...state, isRoundEndModalOpen: false }
}

/**
 * START_NEXT_ROUND - start next round
 * - Increments round number
 * - Resets all players' scores to 0
 * - Closes round end modal
 * - Clears game winner
 * - Starts Preparation phase for active player (auto-draw if enabled)
 * - Transitions to Setup phase
 */
export function handleStartNextRound(state: GameState): GameState {
  const newRound = (state.currentRound || 1) + 1

  const newPlayers = state.players.map(p => ({
    ...p,
    score: 0  // Reset score
  }))

  const activePlayerId = state.activePlayerId
  let finalPhase = 0  // Preparation phase

  // Execute Preparation phase for active player
  if (activePlayerId) {
    const player = newPlayers.find(p => p.id === activePlayerId)
    if (player && state.autoDrawEnabled && player.deck && player.deck.length > 0) {
      const drawnCard = player.deck.shift()
      if (drawnCard) {
        player.hand.push(drawnCard)
        player.handSize = player.hand.length
        player.deckSize = player.deck.length
      }
    }

    // Transition to Setup phase
    finalPhase = 1
  }

  const newState = {
    ...state,
    currentRound: newRound,
    players: newPlayers,
    isRoundEndModalOpen: false,
    gameWinner: null,
    currentPhase: finalPhase
  }

  // CRITICAL FIX: Clear processed triggers when starting new round
  delete (newState as any).processedTriggersThisTurn

  return newState
}

/**
 * START_NEW_MATCH - start new match
 */
export function handleStartNewMatch(state: GameState): GameState {
  const newState = {
    ...state,
    currentRound: 1,
    currentPhase: 1,  // Setup - can play cards immediately
    turnNumber: 1
  }

  // CRITICAL FIX: Clear processed triggers when starting new match
  delete (newState as any).processedTriggersThisTurn

  return newState
}

/**
 * Helper function to get active player IDs (not disconnected, not spectators)
 * Returns IDs in turn order starting from startingPlayerId
 */
export function getActivePlayerIds(state: GameState): number[] {
  const activePlayers = state.players.filter(p => !p.isDisconnected && !p.isSpectator)

  // Before game starts or no starting player, return in ID order
  if (!state.isGameStarted || state.startingPlayerId === undefined || state.startingPlayerId === null) {
    return activePlayers.map(p => p.id).sort((a, b) => a - b)
  }

  // Sort players by ID for consistent ordering
  const playersById = [...activePlayers].sort((a, b) => a.id - b.id)

  // Find starting player position
  const startingIndex = playersById.findIndex(p => p.id === state.startingPlayerId)

  // Create circular turn order starting from startingPlayerId
  const turnOrder = [
    ...playersById.slice(startingIndex),
    ...playersById.slice(0, startingIndex)
  ]

  return turnOrder.map(p => p.id)
}

/**
 * Check if round should end
 */
export function shouldRoundEnd(state: GameState): boolean {
  const threshold = 10 + (state.currentRound * 10)  // 20, 30, 40
  return state.players.some(p => p.score >= threshold)
}

/**
 * End round
 */
export function endRound(state: GameState): GameState {
  const maxScore = Math.max(...state.players.map(p => p.score))
  const winners = state.players.filter(p => p.score === maxScore).map(p => p.id)

  // Check match victory (2 rounds)
  const roundWins = Object.values(state.roundWinners || {})
  const matchWinner = checkMatchWinner(roundWins, winners)

  const newRoundWinners = {
    ...(state.roundWinners || {}),
    [state.currentRound]: winners
  }

  const newState = {
    ...state,
    roundWinners: newRoundWinners,
    isRoundEndModalOpen: true
  }

  if (matchWinner) {
    newState.gameWinner = matchWinner
  }

  return newState
}

/**
 * Check match winner (2 out of 3 rounds)
 */
function checkMatchWinner(existingWins: Record<number, number[]>, newWinners: number[]): number | null {
  const allWins = { ...existingWins }

  // Count wins for each round
  const winCounts: Record<number, number> = {}
  Object.values(allWins).flat().forEach(id => {
    winCounts[id] = (winCounts[id] || 0) + 1
  })
  newWinners.forEach(id => {
    winCounts[id] = (winCounts[id] || 0) + 1
  })

  // Check who won 2 rounds
  for (const [id, count] of Object.entries(winCounts)) {
    if (count >= 2) {return parseInt(id)}
  }

  return null
}

/**
 * SCORE_DIAGONAL - score a diagonal line for Logistics Chain ability
 * Used by Logistics Chain command card to:
 * 1. Gain points equal to the total power of your cards in the diagonal
 * 2. Then gain bonus (points or cards) based on Support tokens
 *
 * data: { r1, c1, r2, c2, playerId, bonusType }
 * - r1, c1: First point on diagonal (full board coordinates with offset)
 * - r2, c2: Second point on diagonal (must be on same diagonal: |r1-r2| == |c1-c2|)
 * - playerId: Player scoring the diagonal
 * - bonusType: 'point_per_support' (Logistics Chain option 1) or 'draw_per_support' (option 2)
 */
export function handleScoreDiagonal(state: GameState, _playerId: number, data: any): GameState {
  const { r1, c1, r2, c2, playerId: scoringPlayerId, bonusType = 'point_per_support' } = data || {}

  // Validate that points are on same diagonal
  if (Math.abs(r1 - r2) !== Math.abs(c1 - c2)) {
    return state
  }

  // Determine diagonal type based on the relationship between the two points
  // Main diagonal: row - col is constant (going top-left to bottom-right)
  // Anti-diagonal: row + col is constant (going top-right to bottom-left)
  const onMainDiagonal = (r1 - c1) === (r2 - c2)
  const onAntiDiagonal = (r1 + c1) === (r2 + c2)

  if (!onMainDiagonal && !onAntiDiagonal) {
    return state
  }

  // Get all cells on the diagonal between the two points (inclusive)
  const gridSize = state.activeGridSize
  const offset = Math.floor((state.board.length - gridSize) / 2)
  const diagonalCells: { row: number; col: number }[] = []

  if (onMainDiagonal) {
    // Main diagonal: cells where (row - col) is constant
    const diff = r1 - c1
    // Iterate from min row to max row
    const minR = Math.min(r1, r2)
    const maxR = Math.max(r1, r2)
    for (let r = minR; r <= maxR; r++) {
      const c = r - diff
      // Only include cells within the active grid bounds
      if (r >= offset && r < offset + gridSize && c >= offset && c < offset + gridSize) {
        diagonalCells.push({ row: r, col: c })
      }
    }
  } else {
    // Anti-diagonal: cells where (row + col) is constant
    const sum = r1 + c1
    // Iterate from min row to max row
    const minR = Math.min(r1, r2)
    const maxR = Math.max(r1, r2)
    for (let r = minR; r <= maxR; r++) {
      const c = sum - r
      // Only include cells within the active grid bounds
      if (r >= offset && r < offset + gridSize && c >= offset && c < offset + gridSize) {
        diagonalCells.push({ row: r, col: c })
      }
    }
  }

  const newPlayers = [...state.players]
  const playerIndex = newPlayers.findIndex(p => p.id === scoringPlayerId)

  if (playerIndex === -1) {
    return state
  }

  // Step 1: Count power from player's cards in the diagonal
  let powerScore = 0
  const powerScoreEvents: { row: number; col: number; power: number }[] = []

  for (const { row, col } of diagonalCells) {
    const cell = state.board[row]?.[col]
    if (!cell.card) {continue}

    const card = cell.card
    // Check if card belongs to scoring player
    if (card.ownerId === scoringPlayerId) {
      // Get effective power (base power + modifiers)
      const effectivePower = (card.power || 0) + (card.powerModifier || 0)
      powerScore += effectivePower
      powerScoreEvents.push({ row, col, power: effectivePower })
    }
  }

  // Step 2: Count Support tokens for bonus
  let supportCount = 0
  const supportBonusEvents: { row: number; col: number }[] = []

  for (const { row, col } of diagonalCells) {
    const cell = state.board[row]?.[col]
    if (!cell.card) {continue}

    const card = cell.card
    // Check if card belongs to scoring player and has Support from them
    const hasSupport = card.ownerId === scoringPlayerId && card.statuses?.some((s: any) =>
      s.type === 'Support' && s.addedByPlayerId === scoringPlayerId
    )

    if (hasSupport) {
      supportCount++
      supportBonusEvents.push({ row, col })
    }
  }

  // Apply power score
  let totalScoreGain = powerScore

  // Apply bonus based on bonusType
  if (bonusType === 'point_per_support') {
    // Option 1: Gain +1 point for each Support token
    totalScoreGain += supportCount
  } else if (bonusType === 'draw_per_support') {
    // Option 2: Draw 1 card for each Support token
    const player = newPlayers[playerIndex]
    const deck = [...(player.deck || [])]
    const hand = [...(player.hand || [])]
    const drawnCards: any[] = []

    for (let i = 0; i < supportCount && deck.length > 0; i++) {
      const card = deck.shift()!
      hand.push(card)
      drawnCards.push(card)
    }

    newPlayers[playerIndex] = {
      ...player,
      deck,
      hand,
      deckSize: deck.length,
      handSize: hand.length
    }
  }

  // Update player score
  const currentPlayer = newPlayers[playerIndex]
  newPlayers[playerIndex] = {
    ...currentPlayer,
    score: currentPlayer.score + totalScoreGain
  }

  // Create result state with temporary scoring data attached
  const resultState: any = {
    ...state,
    players: newPlayers,
    _diagonalScoringEvents: {
      powerScoreEvents,
      supportBonusEvents,
      powerScore,
      supportCount,
      totalScoreGain
    }
  }

  return resultState
}
