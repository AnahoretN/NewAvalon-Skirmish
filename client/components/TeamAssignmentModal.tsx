import React, { useState, useMemo } from 'react'
import { GameMode } from '@/types'
import type { Player } from '@/types'
import { PLAYER_COLORS } from '@/constants'
import { useLanguage } from '@/contexts/LanguageContext'

interface TeamAssignmentModalProps {
  players: Player[];
  gameMode: GameMode;
  onCancel: () => void;
  onConfirm: (assignments: Record<number, number[]>) => void;
}

const PlayerPill: React.FC<{ player: Player; onDragStart: (e: React.DragEvent, playerId: number) => void }> = ({ player, onDragStart }) => {
  const colorData = PLAYER_COLORS[player.color] || PLAYER_COLORS['blue']
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, player.id)}
      className="flex items-center gap-vu-md bg-gray-600 p-vu-md rounded-vu-2 cursor-grab active:cursor-grabbing"
    >
      <div className={`w-vu-icon-sm h-vu-icon-sm rounded-full ${colorData.bg} border border-white/50`}></div>
      <span className="font-medium">{player.name}</span>
    </div>
  )
}
const TeamSlot: React.FC<{
    teamId: number;
    teamName: string;
    players: Player[];
    capacity: number;
    onDrop: (e: React.DragEvent, teamId: number) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave?: (e: React.DragEvent) => void;
    onPlayerDragStart: (e: React.DragEvent, playerId: number) => void;
    isOver: boolean;
}> = ({ teamId, teamName, players, capacity, onDrop, onDragOver, onDragLeave, onPlayerDragStart, isOver }) => (
  <div
    onDrop={(e) => onDrop(e, teamId)}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    className={`bg-gray-800 p-vu-lg rounded-vu-2 border-vu-md ${isOver ? 'border-indigo-500' : 'border-gray-700'} transition-colors`}
  >
    <h3 className="text-vu-lg font-bold mb-vu-md border-b border-gray-700 pb-vu-md">{teamName} ({players.length}/{capacity})</h3>
    <div className="space-y-vu-md min-h-vu-team-slot">
      {players.map(p => <PlayerPill key={p.id} player={p} onDragStart={onPlayerDragStart} />)}
    </div>
  </div>
)


export const TeamAssignmentModal: React.FC<TeamAssignmentModalProps> = ({ players, gameMode, onCancel, onConfirm }) => {
  const { t } = useLanguage()
  const [unassigned, setUnassigned] = useState<Player[]>(players)
  const [team1, setTeam1] = useState<Player[]>([])
  const [team2, setTeam2] = useState<Player[]>([])
  const [draggedPlayerId, setDraggedPlayerId] = useState<number | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<number | 'unassigned' | null>(null)

  const { team1Capacity, team2Capacity } = useMemo(() => {
    if (gameMode === GameMode.TwoVTwo) {
      return { team1Capacity: 2, team2Capacity: 2 }
    }
    if (gameMode === GameMode.ThreeVOne) {
      return { team1Capacity: 3, team2Capacity: 1 }
    }
    // Unexpected gameMode - fall back to TwoVTwo capacities and log warning
    return { team1Capacity: 2, team2Capacity: 2 }
  }, [gameMode])

  const isReady = unassigned.length === 0 && team1.length === team1Capacity && team2.length === team2Capacity

  const handleDragStart = (e: React.DragEvent, playerId: number) => {
    e.dataTransfer.effectAllowed = 'move'
    setDraggedPlayerId(playerId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetTeamId: number | 'unassigned') => {
    e.preventDefault()
    if (draggedPlayerId === null) {
      return
    }

    const player = players.find(p => p.id === draggedPlayerId)
    if (!player) {
      return
    }

    // Create copies of state arrays
    const newUnassigned = [...unassigned]
    const newTeam1 = [...team1]
    const newTeam2 = [...team2]

    // Remove player from all lists
    const idxUnassigned = newUnassigned.findIndex(p => p.id === draggedPlayerId)
    if (idxUnassigned > -1) {
      newUnassigned.splice(idxUnassigned, 1)
    }
    const idxTeam1 = newTeam1.findIndex(p => p.id === draggedPlayerId)
    if (idxTeam1 > -1) {
      newTeam1.splice(idxTeam1, 1)
    }
    const idxTeam2 = newTeam2.findIndex(p => p.id === draggedPlayerId)
    if (idxTeam2 > -1) {
      newTeam2.splice(idxTeam2, 1)
    }

    // Add player to the target list
    if (targetTeamId === 1 && newTeam1.length < team1Capacity) {
      newTeam1.push(player)
    } else if (targetTeamId === 2 && newTeam2.length < team2Capacity) {
      newTeam2.push(player)
    } else {
      newUnassigned.push(player)
    }

    setUnassigned(newUnassigned)
    setTeam1(newTeam1)
    setTeam2(newTeam2)
    setDraggedPlayerId(null)
    setDragOverTarget(null)
  }

  const handleConfirm = () => {
    if (!isReady) {
      return
    }
    const assignments = {
      1: team1.map(p => p.id),
      2: team2.map(p => p.id),
    }
    onConfirm(assignments)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-vu-2 p-vu-xl shadow-xl w-full max-w-vu-team-modal">
        <h2 className="text-vu-3xl font-bold mb-vu-md">{t('assignTeams')}</h2>
        <p className="text-gray-400 mb-vu-xl">{t('dragToReorder')}</p>
        <div className="grid grid-cols-3 gap-vu-lg">
          {/* Unassigned Players */}
          <div
            onDrop={(e) => handleDrop(e, 'unassigned')}
            onDragOver={(e) => {
              handleDragOver(e); setDragOverTarget('unassigned')
            }}
            onDragLeave={() => setDragOverTarget(null)}
            className={`bg-gray-800 p-vu-lg rounded-vu-2 border-vu-md ${dragOverTarget === 'unassigned' ? 'border-indigo-500' : 'border-gray-700'} transition-colors`}
          >
            <h3 className="text-vu-lg font-bold mb-vu-md border-b border-gray-700 pb-vu-md">{t('unassigned')}</h3>
            <div className="space-y-vu-md">
              {unassigned.map(p => <PlayerPill key={p.id} player={p} onDragStart={handleDragStart} />)}
            </div>
          </div>

          {/* Team 1 */}
          <TeamSlot
            teamId={1}
            teamName={`${t('team')} 1`}
            players={team1}
            capacity={team1Capacity}
            onDrop={handleDrop}
            onDragOver={(e) => {
              handleDragOver(e); setDragOverTarget(1)
            }}
            onDragLeave={() => setDragOverTarget(null)}
            onPlayerDragStart={handleDragStart}
            isOver={dragOverTarget === 1}
          />

          {/* Team 2 */}
          <TeamSlot
            teamId={2}
            teamName={`${t('team')} 2`}
            players={team2}
            capacity={team2Capacity}
            onDrop={handleDrop}
            onDragOver={(e) => {
              handleDragOver(e); setDragOverTarget(2)
            }}
            onDragLeave={() => setDragOverTarget(null)}
            onPlayerDragStart={handleDragStart}
            isOver={dragOverTarget === 2}
          />
        </div>
        <div className="flex justify-end mt-vu-xl space-x-vu-lg">
          <button type="button" onClick={onCancel} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-vu-md px-vu-lg rounded">
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isReady}
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-vu-md px-vu-lg rounded disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"
          >
            {t('confirmTeams')}
          </button>
        </div>
      </div>
    </div>
  )
}
