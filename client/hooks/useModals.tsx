/**
 * useModals - Centralized modal management using React Context
 *
 * Provides a single source of truth for all modal state
 * Replaces scattered useState for modal visibility
 */

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react'

// All modal types in the application
export type ModalType =
  | 'deckView'
  | 'cardDetail'
  | 'tokens'
  | 'counters'
  | 'teamAssignment'
  | 'readyCheck'
  | 'rules'
  | 'settings'
  | 'command'
  | 'counterSelection'
  | 'revealRequest'
  | 'roundEnd'
  | 'joinGame'
  | 'deckBuilder'
  | 'mulligan'

// Modal size options
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

// Modal state interface
interface ModalState {
  // Currently open modal (null if none)
  openModal: ModalType | null
  // Data passed to the modal
  modalData: Record<string, any>
  // Modal size preference
  modalSize: ModalSize

  // Actions
  open: (type: ModalType, data?: Record<string, any>, size?: ModalSize) => void
  close: () => void
  isOpen: (type: ModalType) => boolean
  getData: <T = Record<string, any>>() => T
  getSize: () => ModalSize
}

// Create context
const ModalsContext = createContext<ModalState | null>(null)

// Provider component
export const ModalsProvider = ({ children }: { children: ReactNode }) => {
  const [openModal, setOpenModal] = useState<ModalType | null>(null)
  const [modalData, setModalData] = useState<Record<string, any>>({})
  const [modalSize, setModalSize] = useState<ModalSize>('lg')

  const open = useCallback((type: ModalType, data: Record<string, any> = {}, size: ModalSize = 'lg') => {
    setOpenModal(type)
    setModalData(data)
    setModalSize(size)
  }, [])

  const close = useCallback(() => {
    setOpenModal(null)
    setModalData({})
    setModalSize('lg')
  }, [])

  const isOpen = useCallback((type: ModalType) => openModal === type, [openModal])

  const getData = useCallback(<T = Record<string, any>>() => modalData as T, [modalData])

  const getSize = useCallback(() => modalSize, [modalSize])

  // CRITICAL: Memoize value to prevent infinite re-renders
  // Without this, consumers re-render on every parent render
  const value: ModalState = useMemo(() => ({
    openModal,
    modalData,
    modalSize,
    open,
    close,
    isOpen,
    getData,
    getSize,
  }), [openModal, modalData, modalSize, open, close, isOpen, getData, getSize])

  return <ModalsContext.Provider value={value}>{children}</ModalsContext.Provider>
}

// Hook to use the modals context
export const useModals = (): ModalState => {
  const context = useContext(ModalsContext)
  if (!context) {
    throw new Error('useModals must be used within ModalsProvider')
  }
  return context
}

// Convenience hooks for specific modals
export const useDeckViewModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('deckView'),
    open: (data?: Record<string, any>) => open('deckView', data, 'xl'),
    close,
    getData: () => getData<DeckViewModalData>(),
  }
}

export const useCardDetailModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('cardDetail'),
    open: (data?: CardDetailModalData) => open('cardDetail', data, 'md'),
    close,
    getData: () => getData<CardDetailModalData>(),
  }
}

export const useRulesModal = () => {
  const { open, close, isOpen } = useModals()

  return {
    isOpen: isOpen('rules'),
    open: (data?: Record<string, any>) => open('rules', data, 'full'),
    close,
  }
}

export const useSettingsModal = () => {
  const { open, close, isOpen } = useModals()

  return {
    isOpen: isOpen('settings'),
    open: (data?: Record<string, any>) => open('settings', data, 'md'),
    close,
  }
}

export const useJoinGameModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('joinGame'),
    open: (data?: JoinGameModalData) => open('joinGame', data, 'lg'),
    close,
    getData: () => getData<JoinGameModalData>(),
  }
}

export const useDeckBuilderModal = () => {
  const { open, close, isOpen } = useModals()

  return {
    isOpen: isOpen('deckBuilder'),
    open: (data?: Record<string, any>) => open('deckBuilder', data, 'full'),
    close,
  }
}

export const useTokensModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('tokens'),
    open: (data?: TokensModalData) => open('tokens', data, 'lg'),
    close,
    getData: () => getData<TokensModalData>(),
  }
}

export const useCountersModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('counters'),
    open: (data?: CountersModalData) => open('counters', data, 'lg'),
    close,
    getData: () => getData<CountersModalData>(),
  }
}

export const useTeamAssignmentModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('teamAssignment'),
    open: (data?: TeamAssignmentModalData) => open('teamAssignment', data, 'lg'),
    close,
    getData: () => getData<TeamAssignmentModalData>(),
  }
}

export const useCommandModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('command'),
    open: (data?: CommandModalData) => open('command', data, 'md'),
    close,
    getData: () => getData<CommandModalData>(),
  }
}

export const useCounterSelectionModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('counterSelection'),
    open: (data?: CounterSelectionModalData) => open('counterSelection', data, 'sm'),
    close,
    getData: () => getData<CounterSelectionModalData>(),
  }
}

export const useRevealRequestModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('revealRequest'),
    open: (data?: RevealRequestModalData) => open('revealRequest', data, 'md'),
    close,
    getData: () => getData<RevealRequestModalData>(),
  }
}

export const useRoundEndModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('roundEnd'),
    open: (data?: RoundEndModalData) => open('roundEnd', data, 'lg'),
    close,
    getData: () => getData<RoundEndModalData>(),
  }
}

// Type definitions for modal data
export interface DeckViewModalData {
  player?: any
  cards?: any[]
  setDraggedItem?: (item: any) => void
  onCardContextMenu?: (e: React.MouseEvent, card: any, source: string) => void
  onCardDoubleClick?: (card: any, source: string) => void
  onCardClick?: (card: any, source: string) => void
  canInteract?: boolean
  isDeckView?: boolean
  playerColorMap?: Map<number, any>
  localPlayerId?: number | null
  imageRefreshVersion?: number
  highlightFilter?: (card: any) => boolean
}

export interface CardDetailModalData {
  card: any | null
  ownerPlayer: any | null
  statusDescriptions: Record<string, string>
  allPlayers: any[]
  imageRefreshVersion?: number
}

export interface JoinGameModalData {
  games: any[]
  onJoin?: (gameId: string) => void
  onRefreshGames?: () => void
}

export interface TokensModalData {
  setDraggedItem?: (item: any) => void
  openContextMenu?: (e: React.MouseEvent, type: string, data: any) => void
  canInteract?: boolean
  anchorEl?: { top: number; left: number } | null
  imageRefreshVersion?: number
}

export interface CountersModalData {
  canInteract?: boolean
  anchorEl?: { top: number; left: number } | null
  imageRefreshVersion?: number
  onCounterMouseDown?: (counter: any) => void
  cursorStack?: { type: string; count: number } | null
}

export interface TeamAssignmentModalData {
  players: any[]
  gameMode: any
}

export interface CommandModalData {
  card: any
  playerColorMap: Map<number, any>
}

export interface CounterSelectionModalData {
  data: any
}

export interface RevealRequestModalData {
  fromPlayer: any
  cardCount: number
}

export interface RoundEndModalData {
  gameState: any
  localPlayerId: number | null
}

export interface MulliganModalData {
  players: any[]
  localPlayerId: number | null
  playerColorMap?: Map<number, string>
  imageRefreshVersion?: number
  onConfirm?: (newHand: any[]) => void
  onExchangeCard?: (cardIndex: number) => void
  gameState?: any  // Pass entire gameState for fresh data access
}

export const useMulliganModal = () => {
  const { open, close, isOpen, getData } = useModals()

  return {
    isOpen: isOpen('mulligan'),
    open: (data?: MulliganModalData) => open('mulligan', data, 'xl'),
    close,
    getData: () => getData<MulliganModalData>(),
  }
}
