/**
 * @file Renders a modal for a detailed view of a single card.
 */
import React, { useMemo, useState, useEffect } from 'react'
import type { Card as CardType, Player } from '@/types'
import { PLAYER_COLORS, DECK_THEMES } from '@/constants'
import { formatAbilityText } from '@/utils/textFormatters'
import { useLanguage } from '@/contexts/LanguageContext'

interface CardDetailModalProps {
  card: CardType;
  ownerPlayer?: Player;
  onClose: () => void;
  statusDescriptions: Record<string, string>;
  allPlayers: Player[];
  imageRefreshVersion?: number;
}

/**
 * A modal that displays detailed information about a card.
 * @param {CardDetailModalProps} props The properties for the component.
 * @returns {React.ReactElement} The rendered modal.
 */
export const CardDetailModal: React.FC<CardDetailModalProps> = ({ card, ownerPlayer, onClose, statusDescriptions, allPlayers, imageRefreshVersion }) => {
  const { getCardTranslation, getCounterTranslation, resources } = useLanguage()
  const abilityKeywords = resources.abilityKeywords
  const [currentImageSrc, setCurrentImageSrc] = useState(card.imageUrl)

  const localized = card.baseId ? getCardTranslation(card.baseId) : undefined
  const displayCard = localized ? { ...card, ...localized } : card

  useEffect(() => {
    let src = card.imageUrl
    if (imageRefreshVersion && src) {
      const separator = src.includes('?') ? '&' : '?'
      src = `${src}${separator}v=${imageRefreshVersion}`
    }
    setCurrentImageSrc(src)
  }, [card.imageUrl, imageRefreshVersion])

  const handleImageError = () => {
    let fallback = card.fallbackImage
    if (imageRefreshVersion && fallback) {
      const separator = fallback.includes('?') ? '&' : '?'
      fallback = `${fallback}${separator}v=${imageRefreshVersion}`
    }

    if (currentImageSrc !== fallback) {
      setCurrentImageSrc(fallback ?? '')
    }
  }

  const ownerColorName = ownerPlayer?.color
  const themeColor = ownerColorName
    ? PLAYER_COLORS[ownerColorName]?.border || DECK_THEMES[card.deck as keyof typeof DECK_THEMES]?.color || 'border-gray-300'
    : DECK_THEMES[card.deck as keyof typeof DECK_THEMES]?.color || 'border-gray-300'

  const teamName = useMemo(() => {
    if (ownerPlayer?.teamId === undefined) {
      return null
    }
    return `Team ${ownerPlayer.teamId}`
  }, [ownerPlayer])

  // Aggregate statuses by type
  // Filter out internal statuses - they are invisible to players:
  // - readyDeploy, readySetup, readyCommit: control ability availability
  // - deployUsedThisTurn, setupUsedThisTurn, commitUsedThisTurn: track ability usage
  const hiddenStatusTypes = ['readyDeploy', 'readySetup', 'readyCommit', 'deployUsedThisTurn', 'setupUsedThisTurn', 'commitUsedThisTurn']
  const statusGroups: Record<string, number[]> = (card.statuses ?? []).reduce(
    (acc, status) => {
      // Skip readiness statuses - they should not be displayed
      if (hiddenStatusTypes.includes(status.type)) {
        return acc
      }
      if (!acc[status.type]) {
        acc[status.type] = []
      }
      acc[status.type].push(status.addedByPlayerId)
      return acc
    },
    {} as Record<string, number[]>,
  )

  return (
    <div onClick={onClose} className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[300]">
      <div onClick={e => e.stopPropagation()} className={`bg-gray-800 rounded-vu-5 shadow-2xl w-full ${themeColor} border-vu-5`} style={{ maxWidth: 'calc(var(--vu-modal-xl) * 2)', maxHeight: '90vh' }}>
        {/* Main Container: Image (left) + Text+Button (right) */}
        <div className="flex">
          {/* Left: Image Container - 3/5 width */}
          <div className="w-3/5 p-vu-lg">
            {currentImageSrc ? (
              <img src={currentImageSrc} onError={handleImageError} alt={displayCard.name} className="w-full h-auto object-contain rounded-vu-5 max-h-[85vh]" />
            ) : (
              <div className="w-full h-40 bg-gray-700 rounded-vu-5 flex items-center justify-center text-vu-3xl font-bold text-center p-vu-lg">{displayCard.name}</div>
            )}
          </div>

          {/* Right: Text Container + Close Button - 2/5 width */}
          <div className="w-2/5 flex flex-col p-vu-lg">
            {/* Scrollable text container */}
            <div className="flex flex-col gap-vu-min overflow-y-auto pr-vu-md flex-grow text-left">
              {/* Title & Deck + Power */}
              <div className="flex justify-between items-stretch gap-vu-md">
                <div className="flex-1">
                  <h2 className="text-vu-20 font-bold">{displayCard.name}</h2>
                  <p className="text-vu-14 text-gray-400 capitalize">{displayCard.types?.join(', ') || `${displayCard.deck} Card`}</p>
                </div>
                <div className="flex items-center bg-gray-900 px-vu-lg rounded-vu-2">
                  <span className="text-indigo-400 text-vu-16 font-bold">Power:</span> <span className="text-vu-20 font-black ml-vu-min">{displayCard.power}</span>
                </div>
              </div>

              {/* Core Stats */}
              <div className="bg-gray-900 p-vu-lg rounded-vu-5">
                <h3 className="text-indigo-400 text-vu-16 font-bold text-center mb-vu-min">Ability</h3>
                <div className="leading-[1.2] text-gray-200 text-vu-14">
                  {displayCard.abilityText?.split('\n').map((line, i) => (
                    <p key={i} className="mb-[1.1em] last:mb-0">{formatAbilityText(line, abilityKeywords)}</p>
                  ))}
                </div>
              </div>

              {/* Cost, Loyalty & Discipline */}
              <div className="flex gap-vu-md">
                {(displayCard.cost ?? 2) > 0 && (
                  <div className="flex-1 bg-blue-900 bg-opacity-30 p-vu-md rounded-vu-2 border border-blue-600">
                    <div className="text-center text-vu-16 font-bold text-white">
                      Cost: {displayCard.cost ?? 2}
                    </div>
                  </div>
                )}
                {(displayCard.loyalty ?? 2) > 0 && (
                  <div className="flex-1 bg-purple-900 bg-opacity-30 p-vu-md rounded-vu-2 border border-purple-600">
                    <div className="text-center text-vu-16 font-bold text-white">
                      Loyalty: {displayCard.loyalty ?? 2}
                    </div>
                  </div>
                )}
                {(displayCard.discipline ?? 2) > 0 && (
                  <div className="flex-1 bg-red-900 bg-opacity-30 p-vu-md rounded-vu-2 border border-red-600">
                    <div className="text-center text-vu-16 font-bold text-white">
                      Discipline: {displayCard.discipline ?? 2}
                    </div>
                  </div>
                )}
              </div>

              {/* Owner Info */}
              {ownerPlayer && (
                <div className="bg-gray-900 p-vu-lg rounded-vu-2 text-vu-14">
                  <p><strong className="text-indigo-400 text-vu-16">Owner:</strong> {ownerPlayer.name}</p>
                  {teamName && <p className="mt-vu-min"><strong className="text-indigo-400 text-vu-16">Team:</strong> {teamName}</p>}
                </div>
              )}

              {/* Statuses */}
              {card.statuses && card.statuses.length > 0 && (
                <div className="bg-gray-900 p-vu-lg rounded-vu-5">
                  <h3 className="text-indigo-400 text-vu-16 font-bold text-center mb-vu-min">Statuses</h3>
                  <ul className="space-y-vu-md text-vu-14 max-h-50 overflow-y-auto pr-vu-md">
                    {Object.entries(statusGroups).map(([type, owners]) => {
                      // Calculate counts per player
                      const playerCounts = owners.reduce((acc, playerId) => {
                        acc[playerId] = (acc[playerId] || 0) + 1
                        return acc
                      }, {} as Record<number, number>)

                      const breakdown = Object.entries(playerCounts).map(([pid, count]) => {
                        const pName = allPlayers.find(p => p.id === Number(pid))?.name || `Player ${pid}`
                        return `${pName} (x${count})`
                      }).join(', ')

                      const counterDef = getCounterTranslation(type)
                      const description = counterDef ? counterDef.description : (statusDescriptions[type] || 'No description available.')

                      return (
                        <li key={type}>
                          <strong className="text-gray-200">{type}</strong> <span className="text-gray-400 text-vu-14 ml-vu-min">- {breakdown}</span>
                          <p className="text-gray-400 text-vu-14 pl-vu-md mt-vu-min leading-[1.15]">{description}</p>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {/* Flavor Text */}
              {displayCard.flavorText && (
                <div className="bg-gray-900 p-vu-lg rounded-vu-5">
                  <h3 className="text-indigo-400 text-vu-16 font-bold text-center mb-vu-min">Flavor Text</h3>
                  <p className="italic text-vu-14 text-gray-400 leading-[1.15]">{displayCard.flavorText?.split('\n').map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}</p>
                </div>
              )}
            </div>

            {/* Close Button below text container */}
            <div className="mt-vu-md">
              <button
                onClick={onClose}
                className="w-full py-vu-md px-vu-lg rounded-vu-2 font-bold transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
                style={{ fontSize: 'var(--vu-text-14)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
