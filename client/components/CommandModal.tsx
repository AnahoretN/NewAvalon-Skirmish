import React from 'react'
import type { Card, PlayerColor } from '@/types'
import { Card as CardComponent } from './Card'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatAbilityText } from '@/utils/textFormatters'
import { getCommandOptions } from '@/utils/autoAbilities'

interface CommandModalProps {
    isOpen: boolean;
    card: Card;
    playerColorMap: Map<number, PlayerColor>;
    onConfirm: (optionIndex: number) => void;
    onCancel: () => void;
}

export const CommandModal: React.FC<CommandModalProps> = ({ isOpen, card, playerColorMap, onConfirm, onCancel }) => {
  const { getCardTranslation, t, resources } = useLanguage()
  const abilityKeywords = resources.abilityKeywords

  const localized = card.baseId ? getCardTranslation(card.baseId) : undefined
  const displayCard = localized ? { ...card, ...localized } : card

  // Get command options from contentDatabase using the new system
  // Note: baseId is already camelCase from database, don't convert to lowercase
  const commandOptions = React.useMemo(() => {
    const baseId = displayCard.baseId || displayCard.id.split('_')[1] || displayCard.id
    const options = getCommandOptions(baseId)
    return options
  }, [displayCard.baseId, displayCard.id])

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[200] backdrop-blur-sm">
      <div className="bg-gray-900 rounded-vu-2 border-vu-md border-yellow-500 shadow-2xl p-vu-xl w-full max-w-[calc(889.5*var(--vu-base))] flex gap-vu-xl">

        {/* Left: Card View - Square */}
        <div className="flex items-center justify-center">
          <div className="w-[calc(300*var(--vu-base))] h-[calc(300*var(--vu-base))] relative">
            <CardComponent card={displayCard} isFaceUp={true} playerColorMap={playerColorMap} disableTooltip={true} />
          </div>
        </div>

        {/* Right: Selection Interface */}
        <div className="flex-1 flex flex-col">
          <h3 className="text-vu-14 font-bold mb-vu-lg pb-vu-md">
            <span className="text-white">Select Module - </span>
            <span className="text-yellow-500">{displayCard.name}</span>
          </h3>

          <div className="flex flex-col gap-vu-md flex-grow justify-center overflow-y-auto max-h-[60vh] pr-vu-md">
            {commandOptions.map((option) => (
              <button
                key={option.optionIndex}
                onClick={() => onConfirm(option.optionIndex - 1)} // Convert 1-based to 0-based
                className="group relative bg-gray-800 hover:bg-indigo-900 border-[calc(4*var(--vu-base))] border-gray-600 hover:border-indigo-400 rounded-vu-2 p-vu-lg transition-all duration-200 text-left shadow-lg hover:shadow-indigo-500/20 flex items-center gap-vu-lg shrink-0"
              >
                <div className="bg-gray-700 text-gray-400 w-vu-icon-lg h-vu-icon-lg flex-shrink-0 flex items-center justify-center rounded-full font-bold text-vu-14 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                  {option.optionIndex}
                </div>
                <div className="text-gray-200 group-hover:text-white text-vu-14 font-medium leading-snug">
                  {formatAbilityText(option.optionText, abilityKeywords)}
                </div>
              </button>
            ))}
            {commandOptions.length === 0 && (
              <div className="text-gray-500 text-center italic text-vu-14">No selectable modules found on this card.</div>
            )}
          </div>

          <div className="flex justify-end pr-vu-md">
            <button
              onClick={onCancel}
              className="py-vu-md px-vu-lg rounded-vu-2 font-bold transition-colors bg-indigo-600 text-white hover:bg-indigo-700"
              style={{ fontSize: 'var(--vu-text-14)' }}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
