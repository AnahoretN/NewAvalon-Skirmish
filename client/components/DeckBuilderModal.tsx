import React, { useState, useMemo, useRef, useEffect } from 'react'
import { DeckType } from '@/types'
import type { CustomDeckFile, Player, Card, PlayerColor } from '@/types'
import { getAllCards, getSelectableDecks, getCardDefinition, commandCardIds, getCardDatabaseMap } from '@/content'
import { Card as CardComponent } from './Card'
import { useLanguage } from '@/contexts/LanguageContext'
import { parseTextDeckFormat, exportToTextDeckFormat } from '@/utils/textDeckFormat'
import { FACTION_COLORS } from '@/constants'

interface DeckBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  setViewingCard: React.Dispatch<React.SetStateAction<{ card: Card; player?: Player; } | null>>;
  imageRefreshVersion?: number;
}

// Faction resource limits configuration
const FACTION_RESOURCE_LIMITS: Record<string, { cost: number; loyalty: number; discipline: number }> = {
  'SynchroTech': { cost: 46, loyalty: 26, discipline: 33 },
  'Hoods': { cost: 24, loyalty: 55, discipline: 26 },
  'Optimates': { cost: 32, loyalty: 26, discipline: 47 },
  'Fusion': { cost: 19, loyalty: 48, discipline: 38 },
}

export const DeckBuilderModal: React.FC<DeckBuilderModalProps> = ({ isOpen, onClose, setViewingCard, imageRefreshVersion }) => {
  const { getCardTranslation, t } = useLanguage()

  // Faction selection state
  const [selectedFaction1, setSelectedFaction1] = useState<string>('')
  const [selectedFaction2, setSelectedFaction2] = useState<string>('')

  // Calculate dynamic resource limits based on selected factions
  const resourceLimits = useMemo(() => {
    if (!selectedFaction1) {
      return { cost: 0, loyalty: 0, discipline: 0 }
    }

    const faction1Limits = FACTION_RESOURCE_LIMITS[selectedFaction1]
    if (!faction1Limits) {
      return { cost: 0, loyalty: 0, discipline: 0 }
    }

    // If only Faction 1 is selected, use its limits directly
    if (!selectedFaction2) {
      return faction1Limits
    }

    // If both factions are selected, calculate average and subtract 2 from each
    const faction2Limits = FACTION_RESOURCE_LIMITS[selectedFaction2]
    if (!faction2Limits) {
      return faction1Limits
    }

    return {
      cost: Math.ceil((faction1Limits.cost + faction2Limits.cost) / 2) - 2,
      loyalty: Math.ceil((faction1Limits.loyalty + faction2Limits.loyalty) / 2) - 2,
      discipline: Math.ceil((faction1Limits.discipline + faction2Limits.discipline) / 2) - 2,
    }
  }, [selectedFaction1, selectedFaction2])

  const MAX_COST = resourceLimits.cost
  const MAX_LOYALTY = resourceLimits.loyalty
  const MAX_DISCIPLINE = resourceLimits.discipline

  // Get cards dynamically - they will be loaded from server
  // Use cardDatabase size as dependency to trigger re-render when data is loaded
  const [, setCardCount] = useState(0)

  // Force re-render when card data is loaded
  useEffect(() => {
    const checkData = () => {
      const db = getCardDatabaseMap()
      if (db.size > 0) {
        setCardCount(db.size)
        return undefined
      } else {
        // If empty, check again after a delay (waiting for fetch)
        const timer = setTimeout(checkData, 100)
        return () => clearTimeout(timer)
      }
    }
    const cleanup = checkData()
    return cleanup
  }, [])

  const allCards = useMemo(() => {
    return getAllCards().filter(({ card }) => card.allowedPanels?.includes('DECK_BUILDER'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getCardDatabaseMap().size])

  const selectableFactions = getSelectableDecks()
  const [deckName, setDeckName] = useState('My Custom Deck')
  const [currentDeck, setCurrentDeck] = useState<Map<string, number>>(new Map())
  const [selectedFactionFilter, setSelectedFactionFilter] = useState<string>('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [powerFilter, setPowerFilter] = useState<number | ''>('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false)

  const textFileInputRef = useRef<HTMLInputElement>(null)
  const typeDropdownRef = useRef<HTMLDivElement>(null)

  // Get faction color for power circles based on card faction
  const getFactionColor = (faction?: string): PlayerColor | undefined => {
    if (!faction) return undefined
    return FACTION_COLORS[faction] || FACTION_COLORS['Neutral']
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(event.target as Node)) {
        setIsTypeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const availableTypes = useMemo(() => {
    const types = new Set<string>()
    allCards.forEach(({ card }) => card.types?.forEach(t => types.add(t)))
    return Array.from(types).sort()
  }, [allCards])

  // Check if card can be added based on selected factions
  const isCardAddable = (cardId: string, cardFaction?: string) => {
    // Block ALL cards if Faction 1 is not selected
    if (!selectedFaction1) {
      return false
    }

    const isCommand = commandCardIds.has(cardId)
    const isNeutral = cardFaction === 'Neutral'
    const isFaction1 = selectedFaction1 && cardFaction === selectedFaction1
    const isFaction2 = selectedFaction2 && cardFaction === selectedFaction2

    return isFaction1 || isFaction2 || isNeutral || isCommand
  }

  // Remove cards from deck when faction selection changes
  useEffect(() => {
    if (currentDeck.size === 0) return

    const newDeck = new Map<string, number>()
    let removedAny = false

    currentDeck.forEach((qty, cardId) => {
      const cardDef = getCardDefinition(cardId)
      if (!cardDef) return

      // Check if card is still addable with current faction selection
      if (isCardAddable(cardId, cardDef.faction)) {
        newDeck.set(cardId, qty)
      } else {
        removedAny = true
      }
    })

    // If any cards were removed due to faction incompatibility, update the deck
    if (removedAny) {
      setCurrentDeck(newDeck)
    }
  }, [selectedFaction1, selectedFaction2])

  const filteredCards = useMemo(() => {
    const cards = allCards

    return cards.filter(({ id, card }) => {
      const localized = getCardTranslation(id)
      const name = localized?.name || card.name
      const ability = localized?.abilityText || card.abilityText || ''

      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (!name.toLowerCase().includes(query) && !ability.toLowerCase().includes(query)) {
          return false
        }
      }

      if (powerFilter !== '') {
        if (card.power !== Number(powerFilter)) {
          return false
        }
      }

      if (selectedTypes.length > 0) {
        const cardTypes = card.types || []
        const hasAllTypes = selectedTypes.every(t => cardTypes.includes(t))
        if (!hasAllTypes) {
          return false
        }
      }

      // Faction filter for visibility
      if (selectedFactionFilter !== 'All') {
        if (selectedFactionFilter === 'Command') {
          return commandCardIds.has(id) || card.types?.includes('Command')
        }
        if (selectedFactionFilter === 'Neutral') {
          return card.faction === 'Neutral'
        }
        if (card.faction !== selectedFactionFilter) {
          return false
        }
      }

      return true
    })
  }, [allCards, selectedFactionFilter, searchQuery, powerFilter, selectedTypes, getCardTranslation])

  const totalCards = useMemo(() => {
    let total = 0
    currentDeck.forEach(qty => total += qty)
    return total
  }, [currentDeck])

  const { totalCost, totalLoyalty, totalDiscipline } = useMemo(() => {
    let cost = 0
    let loyalty = 0
    let discipline = 0
    currentDeck.forEach((qty, cardId) => {
      const cardDef = getCardDefinition(cardId)
      if (cardDef) {
        cost += (cardDef.cost ?? 2) * qty
        loyalty += (cardDef.loyalty ?? 2) * qty
        discipline += (cardDef.discipline ?? 2) * qty
      }
    })
    return { totalCost: cost, totalLoyalty: loyalty, totalDiscipline: discipline }
  }, [currentDeck])

  const handleAddCard = (cardId: string) => {
    const cardDef = getCardDefinition(cardId)
    if (!cardDef) return

    // Check if card can be added based on selected factions
    if (!isCardAddable(cardId, cardDef.faction)) {
      const factionName = selectableFactions.find(f => f.id === cardDef.faction)?.name || cardDef.faction
      if (!selectedFaction1) {
        alert(t('selectFaction1First'))
      } else {
        alert(t('cardFactionNotSelected').replace('{faction}', factionName))
      }
      return
    }

    // Check cost limit
    const cardCost = cardDef?.cost ?? 2
    if (totalCost + cardCost > MAX_COST) {
      alert(`Adding this card would exceed Cost limit (${MAX_COST}).`)
      return
    }

    // Check loyalty limit
    const cardLoyalty = cardDef?.loyalty ?? 2
    if (totalLoyalty + cardLoyalty > MAX_LOYALTY) {
      alert(`Adding this card would exceed Loyalty limit (${MAX_LOYALTY}).`)
      return
    }

    // Check discipline limit
    const cardDiscipline = cardDef?.discipline ?? 2
    if (totalDiscipline + cardDiscipline > MAX_DISCIPLINE) {
      alert(`Adding this card would exceed Discipline limit (${MAX_DISCIPLINE}).`)
      return
    }

    const isHero = cardDef?.types?.includes('Hero')
    const isRarity = cardDef?.types?.includes('Rarity')
    const isCommand = commandCardIds.has(cardId) || cardDef?.types?.includes('Command')

    const limit = (isHero || isRarity) ? 1 : (isCommand ? 2 : 3)

    setCurrentDeck(prev => {
      const newDeck = new Map(prev)
      const currentQty = newDeck.get(cardId) || 0

      if (currentQty >= limit) {
        return newDeck
      }

      newDeck.set(cardId, currentQty + 1)
      return newDeck
    })
  }

  const handleRemoveCard = (cardId: string) => {
    setCurrentDeck(prev => {
      const newDeck = new Map(prev)
      const currentQty = newDeck.get(cardId) || 0
      if (currentQty > 1) {
        newDeck.set(cardId, currentQty - 1)
      } else {
        newDeck.delete(cardId)
      }
      return newDeck
    })
  }

  const handleClearDeck = () => {
    if (confirm('Are you sure you want to clear the current deck?')) {
      setCurrentDeck(new Map())
      setDeckName('My Custom Deck')
    }
  }

  const handlePowerChange = (delta: number) => {
    setPowerFilter(prev => {
      const current = prev === '' ? 0 : prev
      const next = current + delta
      return next < 0 ? 0 : next
    })
  }

  const handleTypeToggle = (type: string) => {
    setSelectedTypes(prev => {
      if (prev.includes(type)) {
        return prev.filter(t => t !== type)
      } else {
        if (prev.length >= 10) {
          return prev
        }
        return [...prev, type]
      }
    })
  }

  const handleSaveAsText = () => {
    if (totalCards === 0) {
      alert(t('cannotSaveEmptyDeck') || 'Cannot save an empty deck.')
      return
    }

    const deckData: CustomDeckFile = {
      deckName: deckName.trim() || 'Untitled Deck',
      cards: Array.from(currentDeck.entries()).map(([cardId, quantity]) => ({ cardId, quantity })),
    }

    const textContent = exportToTextDeckFormat(deckData)
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${deckData.deckName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleLoadTextDeckClick = () => {
    textFileInputRef.current?.click()
  }

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const validation = parseTextDeckFormat(text)

        if (!validation.isValid) {
          alert((validation as { error: string }).error)
          return
        }

        const { deckFile } = validation
        setDeckName(deckFile.deckName)
        const newDeck = new Map<string, number>()
        deckFile.cards.forEach(c => newDeck.set(c.cardId, c.quantity))
        setCurrentDeck(newDeck)

      } catch (err) {
        alert(t('failedToParseDeckFile') || 'Failed to parse deck file.')
      } finally {
        if (event.target) {
          event.target.value = ''
        }
      }
    }
    reader.readAsText(file)
  }

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="bg-gray-900 w-full h-full md:w-[95vw] md:h-[90vh] md:rounded-vu-2 flex flex-col overflow-hidden shadow-2xl border border-gray-700">
        <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center flex-shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-white">{t('deckBuilding')}</h2>
            <input
              type="text"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              className="bg-gray-700 text-white px-3 py-1 rounded border border-gray-600 focus:outline-none focus:border-indigo-500 font-bold"
              placeholder="Deck Name"
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleClearDeck} className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded text-sm font-bold transition-colors">{t('clear')}</button>
            <button onClick={handleLoadTextDeckClick} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-bold transition-colors">{t('loadDeckFile')}</button>
            <input type="file" ref={textFileInputRef} onChange={handleFileSelected} accept=".txt" className="hidden" />
            <button onClick={handleSaveAsText} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-bold transition-colors">{t('saveDeck')}</button>
            <div className="w-px h-8 bg-gray-600 mx-2"></div>
            <button
              onClick={onClose}
              className="py-vu-md px-vu-lg rounded-vu-2 font-bold transition-colors bg-gray-700 hover:bg-gray-600 text-white"
              style={{ fontSize: 'var(--vu-text-14)' }}
            >
              {t('close')}
            </button>
          </div>
        </div>

        <div className="flex flex-grow overflow-hidden">
          <div className="flex-grow flex flex-col p-4 overflow-hidden border-r border-gray-700 bg-gray-900/50">
            <div className="mb-4 flex flex-wrap items-center gap-4 bg-gray-800 p-2 rounded-vu-2 border border-gray-700 relative z-40">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="pl-8 pr-6 py-1 bg-gray-700 text-white border border-gray-600 rounded text-sm focus:outline-none focus:border-indigo-500 w-32 md:w-48"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute inset-y-0 right-0 pr-2 flex items-center text-gray-400 hover:text-white"
                    title="Clear Search"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm font-bold">Power:</span>
                <div className="flex items-center bg-gray-700 rounded border border-gray-600 overflow-hidden">
                  <button
                    onClick={() => handlePowerChange(-1)}
                    className="px-2 py-1 hover:bg-gray-600 text-white font-bold border-r border-gray-600 active:bg-gray-500"
                  >
                                   -
                  </button>
                  <div className="w-8 text-center text-sm font-bold text-white select-none">
                    {powerFilter === '' ? '*' : powerFilter}
                  </div>
                  <button
                    onClick={() => handlePowerChange(1)}
                    className="px-2 py-1 hover:bg-gray-600 text-white font-bold border-l border-gray-600 active:bg-gray-500"
                  >
                                   +
                  </button>
                </div>
                {powerFilter !== '' && (
                  <button
                    onClick={() => setPowerFilter('')}
                    className="p-1 bg-gray-700 hover:bg-red-600 text-gray-400 hover:text-white rounded transition-colors"
                    title="Reset Power Filter"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1">
                <div className="relative" ref={typeDropdownRef}>
                  <button
                    onClick={() => setIsTypeDropdownOpen(!isTypeDropdownOpen)}
                    className={`px-3 py-1 bg-gray-700 text-white border border-gray-600 rounded text-sm flex items-center gap-2 focus:outline-none hover:bg-gray-600 ${selectedTypes.length > 0 ? 'border-indigo-500 text-indigo-300' : ''}`}
                  >
                    <span>Types {selectedTypes.length > 0 ? `(${selectedTypes.length})` : ''}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {isTypeDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-gray-800 border border-gray-600 rounded shadow-xl z-50 max-h-60 overflow-y-auto p-1">
                      <div className="px-2 py-1 text-xs text-gray-400 border-b border-gray-700 mb-1">Match ALL selected</div>
                      {availableTypes.map(cardType => (
                        <label key={cardType} className="flex items-center px-2 py-1.5 hover:bg-gray-700 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedTypes.includes(cardType)}
                            onChange={() => handleTypeToggle(cardType)}
                            className="form-checkbox h-4 w-4 text-indigo-600 rounded border-gray-500 bg-gray-700 focus:ring-indigo-500"
                          />
                          <span className="ml-2 text-sm text-gray-200">{cardType}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {selectedTypes.length > 0 && (
                  <button
                    onClick={() => setSelectedTypes([])}
                    className="p-1 bg-gray-700 hover:bg-red-600 text-gray-400 hover:text-white rounded transition-colors"
                    title="Clear Types"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1">
                <select
                  value={selectedFactionFilter}
                  onChange={(e) => setSelectedFactionFilter(e.target.value)}
                  className={`bg-gray-700 text-white border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-500 max-w-[140px] ${selectedFactionFilter !== 'All' ? 'border-indigo-500 text-indigo-300' : ''}`}
                >
                  <option value="All">All Factions</option>
                  {selectableFactions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  <option value="Neutral">Neutral</option>
                  <option value="Command">Command Cards</option>
                </select>
                {selectedFactionFilter !== 'All' && (
                  <button
                    onClick={() => setSelectedFactionFilter('All')}
                    className="p-1 bg-gray-700 hover:bg-red-600 text-gray-400 hover:text-white rounded transition-colors"
                    title="Reset Faction"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>

              <span className="ml-auto text-gray-500 text-xs hidden xl:inline">Right-click to view card details</span>
            </div>

            <div className="flex-grow overflow-y-auto pr-2">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2">
                {filteredCards.map(({ id, card }) => {
                  const displayCard: Card = {
                    ...card,
                    id: id,
                    baseId: id,
                    deck: (card.faction === 'Neutral' ? DeckType.Neutral : (card.faction as DeckType || DeckType.Custom)),
                    ownerId: 0,
                  }

                  const factionColor = getFactionColor(card.faction)
                  const canAdd = isCardAddable(id, card.faction)

                  return (
                    <div
                      key={id}
                      className={`relative group ${canAdd ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                      onClick={() => canAdd && handleAddCard(id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setViewingCard({ card: displayCard })
                      }}
                    >
                      <div className="w-full aspect-square transition-transform duration-100 hover:scale-105 hover:shadow-lg hover:z-[100]">
                        <CardComponent
                          card={displayCard}
                          isFaceUp={true}
                          playerColorMap={new Map()}
                          playerColor={factionColor}
                          extraPowerSpacing={true}
                          showDeckBuilderBadges={true}
                          imageRefreshVersion={imageRefreshVersion}
                        />
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white text-[10px] text-center py-0.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none truncate px-1">
                        {canAdd ? t('clickToAdd') : t('cardNotAvailable')}
                      </div>
                    </div>
                  )
                })}
                {filteredCards.length === 0 && (
                  <div className="col-span-full text-center text-gray-500 py-10">
                                   No cards match your filters.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="w-80 md:w-96 bg-gray-800 flex flex-col border-l border-gray-700 flex-shrink-0">
            <div className="pt-4 px-4 pb-3 bg-gray-800 border-b border-gray-600">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-bold text-gray-400 mb-1">{t('faction1Required')}</label>
                  <select
                    value={selectedFaction1}
                    onChange={(e) => setSelectedFaction1(e.target.value)}
                    className="w-full bg-gray-700 text-white border border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">{t('selectFaction')}</option>
                    {selectableFactions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-bold text-gray-400 mb-1">{t('faction2Optional')}</label>
                  <select
                    value={selectedFaction2}
                    onChange={(e) => setSelectedFaction2(e.target.value)}
                    disabled={!selectedFaction1}
                    className="w-full bg-gray-700 text-white border border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">{t('noSecondFaction')}</option>
                    {selectableFactions.filter(f => f.id !== selectedFaction1).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-600">
                <p className="text-sm font-bold text-indigo-400">
                  {totalCards} Cards
                </p>
                <div className="flex gap-1 mt-[5px]">
                  <div style={{ height: 'calc(30 * var(--vu-base))' }} className={`flex-1 text-center text-xs font-bold px-1 flex items-center justify-center rounded ${
                    MAX_COST === 0 ? 'bg-gray-800 text-gray-500' :
                    totalCost > MAX_COST ? 'bg-red-900 text-red-400' : 'bg-blue-900 bg-opacity-50 text-blue-300'
                  }`}>
                    Cost: {totalCost} / {MAX_COST || 0}
                  </div>
                  <div style={{ height: 'calc(30 * var(--vu-base))' }} className={`flex-1 text-center text-xs font-bold px-1 flex items-center justify-center rounded ${
                    MAX_LOYALTY === 0 ? 'bg-gray-800 text-gray-500' :
                    totalLoyalty > MAX_LOYALTY ? 'bg-red-900 text-red-400' : 'bg-purple-900 bg-opacity-50 text-purple-300'
                  }`}>
                    Loyalty: {totalLoyalty} / {MAX_LOYALTY || 0}
                  </div>
                  <div style={{ height: 'calc(30 * var(--vu-base))' }} className={`flex-1 text-center text-xs font-bold px-1 flex items-center justify-center rounded ${
                    MAX_DISCIPLINE === 0 ? 'bg-gray-800 text-gray-500' :
                    totalDiscipline > MAX_DISCIPLINE ? 'bg-red-900 text-red-400' : 'bg-red-900 bg-opacity-50 text-red-300'
                  }`}>
                    Discipline: {totalDiscipline} / {MAX_DISCIPLINE || 0}
                  </div>
                </div>
                {!selectedFaction1 && (
                  <p className="text-xs text-gray-500 mt-1 italic">{t('selectFaction1First') || 'Select Faction 1 to enable deck building'}</p>
                )}
              </div>
            </div>
            <div className="flex-grow overflow-y-auto p-2 space-y-2">
              {currentDeck.size === 0 && (
                <div className="text-center text-gray-500 mt-10">
                  <p>{t('emptyDeck')}</p>
                  <p className="text-xs mt-2">{t('clickToAdd')}</p>
                </div>
              )}
              {Array.from(currentDeck.entries()).map(([cardId, quantity]) => {
                const cardDef = getCardDefinition(cardId)
                if (!cardDef) {
                  return null
                }

                const displayCard: Card = {
                  ...cardDef,
                  id: cardId,
                  baseId: cardId,
                  deck: (cardDef.faction === 'Neutral' ? DeckType.Neutral : (cardDef.faction as DeckType || DeckType.Custom)),
                  ownerId: 0,
                }

                const translation = getCardTranslation(cardId)
                const displayName = translation ? translation.name : cardDef.name
                const isHero = cardDef.types?.includes('Hero')
                const isRarity = cardDef.types?.includes('Rarity')
                const isCommand = commandCardIds.has(cardId) || cardDef.types?.includes('Command')
                const limit = (isHero || isRarity) ? 1 : (isCommand ? 2 : 3)
                const limitTitle = (isHero || isRarity) ? 'Max 1 (Rarity/Hero)' : (isCommand ? 'Max 2 (Command)' : 'Max 3')

                const factionColor = getFactionColor(cardDef.faction)

                return (
                  <div key={cardId} className="flex items-center bg-gray-700 rounded p-2 group hover:bg-gray-600 transition-colors select-none">
                    <div
                      className="w-12 h-12 flex-shrink-0 mr-3 cursor-pointer"
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setViewingCard({ card: displayCard })
                      }}
                    >
                      <CardComponent card={displayCard} isFaceUp={true} playerColorMap={new Map()} playerColor={factionColor} hidePower={true} showDeckBuilderBadges={false} imageRefreshVersion={imageRefreshVersion} />
                    </div>
                    <div className="flex-grow min-w-0">
                      <div className="font-bold text-sm text-white truncate">{displayName}</div>
                      <div className="text-xs whitespace-nowrap leading-none tracking-[0.1vu]">
                        {(cardDef.cost ?? 2) > 0 && <span className="text-blue-400 font-bold align-baseline">{cardDef.cost ?? 2}</span>}
                        {(cardDef.cost ?? 2) > 0 && ((cardDef.loyalty ?? 2) > 0 || (cardDef.discipline ?? 2) > 0) && <span className="text-white font-bold align-baseline"> / </span>}
                        {(cardDef.loyalty ?? 2) > 0 && <span className="text-purple-400 font-bold align-baseline">{cardDef.loyalty ?? 2}</span>}
                        {(cardDef.loyalty ?? 2) > 0 && (cardDef.discipline ?? 2) > 0 && <span className="text-white font-bold align-baseline"> / </span>}
                        {(cardDef.discipline ?? 2) > 0 && <span className="text-red-400 font-bold align-baseline">{cardDef.discipline ?? 2}</span>}
                        {(cardDef.cost ?? 2) > 0 || (cardDef.loyalty ?? 2) > 0 || (cardDef.discipline ?? 2) > 0 ? <span className="mx-1 text-gray-400 align-baseline">|</span> : null}
                        {cardDef.types?.map((type, i) => {
                          const isSpecial = type === 'Hero' || type === 'Rarity'
                          return (
                            <span key={type} className={`${isSpecial ? 'text-yellow-400' : 'text-gray-400'} align-baseline`}>
                              {type}{i < cardDef.types.length - 1 ? ', ' : ''}
                            </span>
                          )
                        }) || null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <button
                        onClick={() => handleRemoveCard(cardId)}
                        className="w-6 h-6 flex items-center justify-center bg-gray-800 hover:bg-red-900 text-gray-300 rounded text-sm font-bold"
                        title="Remove one"
                      >
                                           -
                      </button>
                      <span className="font-bold text-white w-4 text-center">{quantity}</span>
                      <button
                        onClick={() => handleAddCard(cardId)}
                        className="w-6 h-6 flex items-center justify-center bg-gray-800 hover:bg-green-900 text-gray-300 rounded text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                        title={limitTitle}
                        disabled={quantity >= limit}
                      >
                                           +
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
