import React, { useState, useEffect } from 'react'
import type { CounterSelectionData } from '@/types'
import { STATUS_ICONS } from '@/constants'

interface CounterSelectionModalProps {
    isOpen: boolean;
    data: CounterSelectionData;
    onConfirm: (counts: Record<string, number>, data: CounterSelectionData) => void;
    onCancel: () => void;
}

// Helper function to compute status counts
const computeStatusCounts = (statuses: any[]): Record<string, number> => {
  const availableStatuses = statuses.filter(s =>
    s.type !== 'Support' &&
          s.type !== 'Threat' &&
          s.type !== 'LastPlayed' &&
          s.type !== 'REMOVE_COMMIT' &&
          s.type !== 'RESET_DEPLOY' &&
          s.type !== 'REDEPLOY' &&
          s.type !== 'readyDeploy' &&
          s.type !== 'readyCommit' &&
          s.type !== 'readySetup' &&
          s.type !== 'deployUsedThisTurn' &&
          s.type !== 'setupUsedThisTurn' &&
          s.type !== 'commitUsedThisTurn',
  )
  return availableStatuses.reduce((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)
}

export const CounterSelectionModal: React.FC<CounterSelectionModalProps> = ({ isOpen, data, onConfirm, onCancel }) => {
  // Map of Status Type -> REMAINING amount on card
  // We initialize this with the current counts on the card.
  const [remainingCounts, setRemainingCounts] = useState<Record<string, number>>(() =>
    computeStatusCounts(data.card.statuses || []),
  )

  // Store initial max counts to prevent adding more than existed
  const [initialCounts, setInitialCounts] = useState<Record<string, number>>(() =>
    computeStatusCounts(data.card.statuses || []),
  )

  // Reset counts when card data changes or modal opens
  useEffect(() => {
    if (isOpen && data.card) {
      const newCounts = computeStatusCounts(data.card.statuses || [])
      setRemainingCounts(newCounts)
      setInitialCounts(newCounts)
    }
  }, [isOpen, data.card])

  if (!isOpen) {
    return null
  }

  const types = Object.keys(initialCounts)

  // Decrease remaining count (Remove a token)
  const handleDecrement = (type: string) => {
    const current = remainingCounts[type] || 0
    if (current > 0) {
      setRemainingCounts({ ...remainingCounts, [type]: current - 1 })
    }
  }

  // Increase remaining count (Restore a token, up to max)
  const handleIncrement = (type: string) => {
    const current = remainingCounts[type] || 0
    const max = initialCounts[type]
    if (current < max) {
      setRemainingCounts({ ...remainingCounts, [type]: current + 1 })
    }
  }

  // Calculate total removed
  const totalRemoved = types.reduce((acc, type) => {
    return acc + (initialCounts[type] - remainingCounts[type])
  }, 0)

  const handleConfirmClick = () => {
    // Calculate the difference to pass back as "removed counts"
    const removedCounts: Record<string, number> = {}
    types.forEach(type => {
      const diff = initialCounts[type] - remainingCounts[type]
      if (diff > 0) {
        removedCounts[type] = diff
      }
    })
    onConfirm(removedCounts, data)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[250]">
      <div className="bg-gray-800 rounded-vu-2 p-6 shadow-xl w-96 border border-gray-600">
        <h3 className="text-xl font-bold text-white mb-4 text-center">Remove Counters</h3>
        <p className="text-gray-400 text-sm mb-6 text-center">
                    Adjust counters on <strong>{data.card.name}</strong>.<br/>
          <span className="text-xs text-gray-500">Press (-) to remove, (+) to keep.</span>
        </p>

        <div className="space-y-3 mb-6 bg-gray-900 p-3 rounded-vu-2 max-h-[300px] overflow-y-auto">
          {types.length === 0 && <p className="text-center text-gray-500 italic py-4">No removable counters found.</p>}

          {types.map(type => {
            const current = remainingCounts[type]
            const max = initialCounts[type]
            const iconUrl = STATUS_ICONS[type]

            return (
              <div key={type} className="flex items-center justify-between bg-gray-800 border border-gray-700 p-3 rounded">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 flex items-center justify-center bg-gray-700 rounded-vu-2">
                    {iconUrl ? <img src={iconUrl} className="w-6 h-6 object-contain" alt={`${type} icon`} /> : <span className="font-bold text-white">{type[0]}</span>}
                  </div>
                  <div>
                    <div className="text-gray-200 font-medium leading-none">{type}</div>
                  </div>
                </div>

                <div className="flex items-center bg-gray-700 rounded border border-gray-600">
                  <button
                    onClick={() => handleDecrement(type)}
                    disabled={current === 0}
                    className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  >
                                        -
                  </button>
                  <div className="w-8 text-center font-bold text-white select-none">{current}</div>
                  <button
                    onClick={() => handleIncrement(type)}
                    disabled={current >= max}
                    className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  >
                                        +
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-gray-700">
          <div>
            <span className="text-gray-400 text-sm">Total Removed:</span>
            <span className="text-indigo-400 font-bold text-xl ml-2">{totalRemoved}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm font-medium transition-colors">Cancel</button>
            <button
              onClick={handleConfirmClick}
              className="px-4 py-2 rounded bg-green-600 hover:bg-green-500 font-bold text-sm text-white shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={totalRemoved === 0}
            >
                            Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
