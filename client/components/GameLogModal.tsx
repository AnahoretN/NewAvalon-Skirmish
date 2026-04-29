import React, { useState, useMemo, useRef, useEffect } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { PlayerColor, GameLogEntry, GameLogActionType } from '@/types'
import { PLAYER_COLORS } from '@/constants'

const getVuSize = (vu: number) => {
  const vuPixels = window.innerHeight / 1000
  return vu * vuPixels
}

interface GameLogModalProps {
  isOpen: boolean
  onClose: () => void
  logs: GameLogEntry[]
  players: Array<{ id: number; name: string; color: PlayerColor }>
  isHost: boolean
  currentRound: number
  currentTurn: number
  currentPhase: number
  gameState: any
  onRewind?: (entryId: string) => void
  canRewind: boolean
  canForward: boolean
  currentLogIndex: number
  onBackward?: () => void
  onForward?: () => void
  maxRewindIndex?: number // Entries after this index are "overwritten"
}

const GameLogModal: React.FC<GameLogModalProps> = ({
  isOpen,
  onClose,
  logs,
  players,
  isHost,
  currentRound,
  currentTurn,
  currentPhase,
  currentLogIndex,
  onRewind,
  maxRewindIndex = logs.length - 1,
}) => {
  const { t } = useLanguage()
  // Helper for translations that might not be in the type system
  const tr = (key: string) => (t as any)(key)
  const [filter, setFilter] = useState<GameLogActionType | 'ALL'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  // Initialize with the latest log entry, not currentLogIndex (which might be after rewind)
  const [selectedLogIndex, setSelectedLogIndex] = useState(() => logs.length > 0 ? logs.length - 1 : -1)
  const [restoreEnabled, setRestoreEnabled] = useState(false)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const rPressCountRef = useRef(0)
  const rPressTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Update selectedLogIndex when logs change (if not in rewind mode)
  useEffect(() => {
    // Only sync if we're in rewind mode (not at the latest entry)
    const isRewindMode = currentLogIndex >= 0 && currentLogIndex < logs.length - 1
    if (isRewindMode) {
      setSelectedLogIndex(currentLogIndex)
    } else if (logs.length > 0 && selectedLogIndex < 0) {
      // If we have logs but no selection, select the latest
      setSelectedLogIndex(logs.length - 1)
    }
    // If in live mode, keep the last entry selected (or user's manual selection)
  }, [currentLogIndex, logs.length, selectedLogIndex])

  // Handle triple R press to enable restore button
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r' && isOpen) {
        e.preventDefault()
        rPressCountRef.current += 1

        // Clear existing timeout
        if (rPressTimeoutRef.current) {
          clearTimeout(rPressTimeoutRef.current)
        }

        // Check if we've reached 3 presses
        if (rPressCountRef.current >= 3) {
          setRestoreEnabled(true)
          rPressCountRef.current = 0
        } else {
          // Reset count after 2 seconds
          rPressTimeoutRef.current = setTimeout(() => {
            rPressCountRef.current = 0
          }, 2000)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (rPressTimeoutRef.current) {
        clearTimeout(rPressTimeoutRef.current)
      }
    }
  }, [isOpen])

  // Reset restoreEnabled when modal closes
  useEffect(() => {
    if (!isOpen) {
      setRestoreEnabled(false)
      rPressCountRef.current = 0
      if (rPressTimeoutRef.current) {
        clearTimeout(rPressTimeoutRef.current)
      }
    }
  }, [isOpen])

  // Filter and search logs
  const filteredLogs = useMemo(() => {
    let result = logs

    // Apply type filter
    if (filter !== 'ALL') {
      result = result.filter(log => log.type === filter)
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(log =>
        log.playerName.toLowerCase().includes(query) ||
        log.details.cardName?.toLowerCase().includes(query) ||
        log.details.abilityText?.toLowerCase().includes(query) ||
        log.details.targetPlayerName?.toLowerCase().includes(query) ||
        log.details.targetCardName?.toLowerCase().includes(query) ||
        log.details.commandOption?.toLowerCase().includes(query)
      )
    }

    return result
  }, [logs, filter, searchQuery])

  // Group logs by round for better organization
  const groupedLogs = useMemo(() => {
    const groups: Record<number, GameLogEntry[]> = {}
    filteredLogs.forEach(log => {
      const round = log.round || 1
      if (!groups[round]) {
        groups[round] = []
      }
      groups[round].push(log)
    })
    return groups
  }, [filteredLogs])

  // Get phase name
  const getPhaseName = (phase: number): string => {
    const phases = ['', 'Setup', 'Main', 'Commit', 'Scoring']
    return phases[phase] || `Phase ${phase}`
  }

  // Get action description
  const getActionDescription = (log: GameLogEntry): string => {
    const { type, details } = log

    switch (type) {
      case 'GAME_START':
        return tr('gameStarted') || 'Game started'
      case 'ROUND_START':
        return `${t('round')} ${log.round} ${tr('started') || 'started'}`
      case 'ROUND_WIN': {
        const winnerNames = details.winners?.map(id => {
          const player = players.find(p => p.id === id)
          return player?.name || tr('player')
        }).join(', ') || (details.winnerName || tr('player'))
        return `${tr('player')} ${winnerNames} ${tr('wonRound') || 'won the round'}`
      }
      case 'MATCH_WIN':
        return `${details.winnerName || tr('player')} ${tr('wonMatch') || 'won the match'}`
      case 'TURN_START':
        return `${tr('turn')} ${log.turn} ${tr('started') || 'started'}`
      case 'PHASE_CHANGE':
        return `${t('phase')}: ${getPhaseName(details.phase || log.phase || 1)}`
      case 'DRAW_CARD':
        return `${tr('drew')} ${details.cardName || tr('aCard')}`
      case 'DRAW_MULTIPLE_CARDS': {
        const count = details.count || details.amount || 1
        return `${tr('drew')} ${count} ${tr('gl_cards')}`
      }
      case 'PLAY_CARD': {
        const coords = details.coords ? ` (${details.coords.row + 1}, ${details.coords.col + 1})` : ''
        return `${tr('played')} ${details.cardName}${coords}`
      }
      case 'ANNOUNCE_CARD': {
        const module = details.commandModule ? ` (${tr('gl_module')} ${details.commandModule})` : ''
        return `${tr('gl_announced')} ${details.cardName}${module}`
      }
      case 'MOVE_CARD': {
        const from = details.fromCoords ? `(${details.fromCoords.row + 1}, ${details.fromCoords.col + 1})` : (details.from || tr('unknown'))
        const to = details.toCoords ? `(${details.toCoords.row + 1}, ${details.toCoords.col + 1})` : (details.to || tr('unknown'))
        return `${tr('moved')} ${details.cardName} ${tr('gl_from')} ${from} ${tr('gl_to')} ${to}`
      }
      case 'DESTROY_CARD':
        return `${tr('destroyed')} ${details.cardName}`
      case 'RETURN_TO_HAND':
        return `${tr('returned')} ${details.cardName} ${tr('gl_toHand')}`
      case 'DISCARD_CARD':
        return `${tr('discarded')} ${details.cardName}`
      case 'DISCARD_FROM_BOARD':
        return `${details.cardName} ${tr('movedToDiscard') || 'moved to discard'}`
      case 'ACTIVATE_ABILITY': {
        let abilityDesc = `${details.cardName}: ${details.abilityText || tr('gl_ability')}`
        if (details.targetLocation) {
          const locationMap: Record<string, string> = {
            board: tr('battlefield') || 'battlefield',
            hand: tr('gl_hand') || 'hand',
            discard: tr('gl_discard') || 'discard',
            deck: tr('gl_deck') || 'deck',
            showcase: tr('gl_showcase') || 'showcase'
          }
          abilityDesc += ` → ${locationMap[details.targetLocation] || details.targetLocation}`
        }
        if (details.targetPlayerName) {
          abilityDesc += ` (${details.targetPlayerName})`
        }
        if (details.toCoords) {
          abilityDesc += ` [${details.toCoords.row + 1}, ${details.toCoords.col + 1}]`
        }
        return abilityDesc
      }
      case 'PLACE_TOKEN':
        return `${tr('placed')} ${details.abilityText} ${tr('gl_on')} ${details.targetCardName || tr('target')}`
      case 'PLACE_TOKEN_ON_CARD': {
        let tokenDesc = `${tr('placed')} ${details.abilityText || tr('token')}`
        if (details.targetPlayerName) {
          tokenDesc += ` ${tr('gl_on')} ${details.targetPlayerName}'s`
        }
        if (details.targetCardName) {
          tokenDesc += ` ${details.targetCardName}`
        }
        if (details.toCoords) {
          tokenDesc += ` [${details.toCoords.row + 1}, ${details.toCoords.col + 1}]`
        } else if (details.targetLocation === 'hand') {
          tokenDesc += ` (${tr('gl_inHand') || 'in hand'})`
        }
        return tokenDesc
      }
      case 'REMOVE_STATUS':
        return `${tr('removed')} ${details.abilityText} ${tr('gl_from')} ${details.cardName}`
      case 'ADD_STATUS':
        return `${tr('added')} ${details.abilityText} ${tr('gl_to')} ${details.cardName}`
      case 'SCORE_POINTS': {
        const points = details.amount || 0
        const newScore = details.newScore || 0
        return `${tr('scored')} ${points} ${tr('gl_points')} (${tr('gl_total')}: ${newScore})`
      }
      case 'SHUFFLE_DECK':
        return tr('shuffledDeck') || 'Shuffled deck'
      case 'PLAYER_JOIN':
        return `${details.targetPlayerName || log.playerName} ${tr('joined') || 'joined'}`
      case 'PLAYER_LEAVE':
        return `${details.targetPlayerName || log.playerName} ${tr('left') || 'left'}`
      case 'GAME_END':
        return tr('gameEnded') || 'Game ended'
      case 'COMMAND_OPTION':
        return `${details.cardName}: ${details.commandOption || tr('selectedOption')}`
      default:
        return type
    }
  }

  // Get action icon
  const getActionIcon = (type: GameLogActionType): string => {
    switch (type) {
      case 'GAME_START':
      case 'ROUND_START':
      case 'TURN_START':
        return '🎮'
      case 'ROUND_WIN':
        return '🏆'
      case 'MATCH_WIN':
        return '👑'
      case 'PHASE_CHANGE':
        return '🔄'
      case 'DRAW_CARD':
      case 'DRAW_MULTIPLE_CARDS':
        return '🎴'
      case 'PLAY_CARD':
        return ''
      case 'ANNOUNCE_CARD':
        return '📢'
      case 'MOVE_CARD':
        return '↔️'
      case 'DESTROY_CARD':
        return '💥'
      case 'RETURN_TO_HAND':
        return '🤚'
      case 'DISCARD_CARD':
      case 'DISCARD_FROM_BOARD':
        return '🗑️'
      case 'ACTIVATE_ABILITY':
        return '⚡'
      case 'PLACE_TOKEN':
      case 'PLACE_TOKEN_ON_CARD':
        return '📍'
      case 'REMOVE_STATUS':
        return '➖'
      case 'ADD_STATUS':
        return ''
      case 'SCORE_POINTS':
        return '⭐'
      case 'SHUFFLE_DECK':
        return '🔀'
      case 'PLAYER_JOIN':
        return '👋'
      case 'PLAYER_LEAVE':
        return '🚪'
      case 'GAME_END':
        return '🏁'
      case 'COMMAND_OPTION':
        return '📋'
      default:
        return '•'
    }
  }

  // Handle log entry click - only selects the entry, does NOT rewind
  // Rewind only happens when user clicks the "Restore" button
  const handleLogClick = (_log: GameLogEntry, index: number) => {
    if (!isHost) {
      return
    }
    setSelectedLogIndex(index)
    // Removed: onRewind call - should only happen via "Restore" button
  }

  // Handle save log
  const handleSaveLog = () => {
    // Create a text version of the log
    let logText = `New Avalon: Skirmish - Game Log\n`
    logText += `Date: ${new Date().toLocaleString()}\n`
    logText += `${'='.repeat(50)}\n\n`

    // Add player info
    logText += `Players:\n`
    players.forEach(p => {
      logText += `  - ${p.name} (${p.color})\n`
    })
    logText += `\n${'='.repeat(50)}\n\n`

    // Add logs
    Object.entries(groupedLogs).forEach(([round, roundLogs]) => {
      logText += `\n--- Round ${round} ---\n\n`
      roundLogs.forEach(log => {
        const time = new Date(log.timestamp).toLocaleTimeString()
        logText += `[${time}] ${log.playerName}: ${getActionDescription(log)}\n`
      })
    })

    // Create and download file
    const blob = new Blob([logText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `game_log_${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Handle save JSON
  const handleSaveJSON = () => {
    const data = {
      timestamp: new Date().toISOString(),
      players,
      logs,
      finalState: {
        round: currentRound,
        turn: currentTurn,
        phase: currentPhase,
      }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `game_log_${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Handle restore to selected log entry
  const handleRestoreToSelected = () => {
    if (selectedLogIndex < 0 || selectedLogIndex >= logs.length) {
      return
    }
    const selectedLog = logs[selectedLogIndex]
    if (selectedLog && onRewind) {
      onRewind(selectedLog.id)
    }
  }

  // Get filter options
  const filterOptions: { value: GameLogActionType | 'ALL'; label: string }[] = [
    { value: 'ALL', label: tr('allActions') || 'All Actions' },
    { value: 'DRAW_CARD', label: t('drawCard') || 'Draw Card' },
    { value: 'PLAY_CARD', label: t('play') || 'Play Card' },
    { value: 'MOVE_CARD', label: t('move') || 'Move' },
    { value: 'ACTIVATE_ABILITY', label: tr('activateAbility') || 'Ability' },
    { value: 'SCORE_POINTS', label: t('score') || 'Score' },
    { value: 'DESTROY_CARD', label: t('destroy') || 'Destroy' },
  ]

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black bg-opacity-70 p-vu-lg">
      <div
        className="bg-gray-800 rounded-vu-2 shadow-2xl border border-gray-700 flex flex-col"
        style={{
          width: `${getVuSize(900)}px`,
          maxHeight: `${getVuSize(850)}px`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-vu-md border-b border-gray-700">
          <h2 className="text-white font-bold flex items-center gap-vu-2" style={{ fontSize: `${getVuSize(24)}px` }}>
            <span>{tr('gameLog') || 'Game Log'}</span>
          </h2>
          <div className="flex items-center gap-vu-base">
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
              style={{ fontSize: `${getVuSize(36)}px` }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="p-vu-md border-b border-gray-700 flex flex-wrap gap-vu-base items-center">
          {/* Filter dropdown */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as GameLogActionType | 'ALL')}
            className="bg-gray-700 border border-gray-600 text-white rounded px-vu-md py-vu-base"
            style={{ fontSize: `${getVuSize(15)}px` }}
          >
            {filterOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {/* Search input */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tr('searchLog') || 'Search...'}
            className="bg-gray-700 border border-gray-600 text-white rounded px-vu-md py-vu-base"
            style={{ fontSize: `${getVuSize(15)}px`, width: `${getVuSize(360)}px` }}
          />

          {/* Host-only controls */}
          {isHost && (
            <div className="flex items-center gap-vu-base ml-auto">
              <button
                onClick={handleRestoreToSelected}
                disabled={!restoreEnabled || selectedLogIndex < 0}
                className={`px-vu-md py-vu-base rounded font-bold transition-colors ${
                  restoreEnabled && selectedLogIndex >= 0
                    ? 'bg-purple-600 hover:bg-purple-700 text-white'
                    : 'bg-gray-800 text-gray-600 cursor-not-allowed'
                }`}
                style={{ fontSize: `${getVuSize(15)}px` }}
                title={tr('restoreToSelected') || 'Restore to selected'}
              >
                {tr('restore') || 'Restore'}
              </button>
              <div className="w-px h-6 bg-gray-600" />
              <button
                onClick={handleSaveLog}
                className="px-vu-md py-vu-base rounded font-bold bg-green-600 hover:bg-green-700 text-white transition-colors"
                style={{ fontSize: `${getVuSize(15)}px` }}
                title={tr('saveLog') || 'Save Log'}
              >
                {t('saveText') || 'Save'}
              </button>
              <button
                onClick={handleSaveJSON}
                className="px-vu-md py-vu-base rounded font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                style={{ fontSize: `${getVuSize(15)}px` }}
                title={t('saveJson') || 'Save JSON'}
              >
                JSON
              </button>
            </div>
          )}
        </div>

        {/* Log entries */}
        <div
          ref={logContainerRef}
          className="flex-1 overflow-y-auto p-vu-md"
          style={{ fontSize: `${getVuSize(12)}px` }}
        >
          {Object.entries(groupedLogs).length === 0 ? (
            <div className="text-gray-500 text-center py-vu-lg">
              {searchQuery || filter !== 'ALL'
                ? (tr('noLogsFound') || 'No logs found matching your criteria.')
                : (tr('noLogsYet') || 'No game actions logged yet.')}
            </div>
          ) : (
            Object.entries(groupedLogs)
              .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
              .map(([round, roundLogs]) => (
                <div key={round} style={{ marginBottom: `${getVuSize(11)}px` }}>
                  {/* Round header */}
                  <div className="text-yellow-500 font-bold sticky top-0 bg-gray-800 py-vu-base border-b border-gray-700" style={{ marginBottom: `${getVuSize(5)}px` }}>
                    {t('round')} {round}
                  </div>

                  {/* Log entries for this round */}
                  {roundLogs.map((log, _index) => {
                    const globalIndex = logs.findIndex(l => l.id === log.id)
                    const isSelected = globalIndex === selectedLogIndex
                    // Only mark as overwritten if we're in rewind mode (not at the latest entry)
                    // maxRewindIndex = -1 means no logs yet or not in rewind mode
                    const isRewindMode = maxRewindIndex >= 0 && maxRewindIndex < logs.length - 1
                    const isOverwritten = isRewindMode && globalIndex > maxRewindIndex
                    const colorClass = PLAYER_COLORS[log.playerColor as keyof typeof PLAYER_COLORS]
                    const bgColorClass = isSelected ? 'bg-indigo-900' : (isOverwritten ? 'bg-gray-800' : 'bg-gray-750')
                    const cursorClass = isHost ? 'cursor-pointer hover:bg-gray-700' : ''
                    const textClass = isOverwritten ? 'text-gray-600' : ''

                    return (
                      <div
                        key={log.id}
                        onClick={() => handleLogClick(log, globalIndex)}
                        className={`flex items-start gap-vu-base p-vu-base rounded ${bgColorClass} ${cursorClass} transition-colors overflow-hidden`}
                        style={{ marginLeft: `${getVuSize(8)}px`, marginBottom: `${getVuSize(5)}px`, opacity: isOverwritten ? 0.5 : 1 }}
                      >
                        {/* Icon */}
                        <span className={`text-vu-base flex-shrink-0 ${textClass}`}>{getActionIcon(log.type)}</span>

                        {/* Player color indicator */}
                        <span
                          className="w-vu-min h-vu-min mt-vu-1 flex-shrink-0"
                          style={{ backgroundColor: colorClass?.bg || '#888', opacity: isOverwritten ? 0.3 : 1 }}
                        />

                        {/* Player name and action */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <div className="flex items-center gap-vu-base flex-wrap">
                            <span className={`font-medium whitespace-nowrap ${isOverwritten ? 'text-gray-600' : 'text-white'}`}>{log.playerName}</span>
                            <span className={`${isOverwritten ? 'text-gray-600' : 'text-gray-400'} break-words`}>{getActionDescription(log)}</span>
                            {isOverwritten && (
                              <span className="text-vu-8 text-gray-500 italic">({tr('overwritten') || 'overwritten'})</span>
                            )}
                          </div>

                          {/* Additional details */}
                          {log.details.abilityText && log.type === 'ACTIVATE_ABILITY' && (
                            <div className={`text-vu-8 mt-vu-min italic break-words ${isOverwritten ? 'text-gray-600' : 'text-gray-400'}`}>
                              "{log.details.abilityText}"
                            </div>
                          )}

                          {/* Target info */}
                          {log.details.targetPlayerName && (
                            <div className={`text-vu-8 break-words ${isOverwritten ? 'text-gray-600' : 'text-gray-400'}`}>
                              → {log.details.targetPlayerName}
                              {log.details.targetCardName && ` (${log.details.targetCardName})`}
                            </div>
                          )}
                        </div>

                        {/* Phase indicator */}
                        {log.phase && log.phase > 0 && (
                          <span className={`text-vu-8 flex-shrink-0 whitespace-nowrap ${isOverwritten ? 'text-gray-600' : 'text-gray-500'}`}>
                            {getPhaseName(log.phase)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))
          )}
        </div>

        {/* Footer with stats */}
        <div className="p-vu-md border-t border-gray-700 flex items-center justify-between text-vu-8 text-gray-400">
          <div>
            {tr('totalActions') || 'Total actions'}: {logs.length}
            {searchQuery || filter !== 'ALL' ? (
              <span className="ml-vu-2">
                ({tr('filtered') || 'filtered'}: {filteredLogs.length})
              </span>
            ) : null}
          </div>
          {isHost && (
            <div className="text-vu-8">
              {selectedLogIndex >= 0 && selectedLogIndex < logs.length ? (
                <span>
                  {tr('viewing') || 'Viewing'}: {selectedLogIndex + 1} / {logs.length}
                </span>
              ) : (
                <span>{tr('live') || 'Live'}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default GameLogModal
