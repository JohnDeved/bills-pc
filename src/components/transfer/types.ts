export type TransferStep = 'files' | 'choose' | 'review' | 'complete'

export interface TransferNotice {
  code?: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

export interface TransferPokemonView {
  id: string
  nickname: string
  speciesName: string
  spriteUrl: string
  spriteFallbackUrl?: string
  level?: number
}

export interface TransferCandidateView extends TransferPokemonView {
  groupId: string
  location: string
  canTransfer: boolean
  notices: readonly TransferNotice[]
}

export interface TransferSourceGroup {
  id: string
  name: string
  count: number
}

export interface TransferSaveView {
  filename: string
  gameName: string
  trainerName: string
  pokemonCount: number
  boxCount: number
  fromCurrentSave?: boolean
  notices?: readonly string[]
}

export interface TransferDestinationBox {
  index: number
  name: string
  pokemon: readonly (TransferPokemonView | null)[]
}

export interface TransferPlacementView {
  candidateId: string
  boxIndex: number
  /** Zero-based slot in the chosen destination box. */
  slot: number
}

export interface TransferPlanView {
  canTransfer: boolean
  placements: readonly TransferPlacementView[]
  notices: readonly TransferNotice[]
  requiresAcknowledgement: boolean
  /** Optional concise explanation when selection or capacity prevents review. */
  error?: string
}

export interface TransferResultView {
  filename: string
  pokemonCount: number
  boxName: string
  placements: readonly TransferPlacementView[]
}

/** The workbench displays snapshots; all save mutation and validity live in its controller. */
export interface TransferController {
  step: TransferStep
  source: TransferSaveView | null
  destination: TransferSaveView | null
  sourceError: string | null
  destinationError: string | null
  error: string | null
  loadingRole: 'source' | 'destination' | null
  creating: boolean
  candidates: readonly TransferCandidateView[]
  sourceGroups: readonly TransferSourceGroup[]
  selectedIds: readonly string[]
  destinationBoxes: readonly TransferDestinationBox[]
  destinationBoxIndex: number
  plan: TransferPlanView | null
  acknowledged: boolean
  result: TransferResultView | null
  editorBackupName?: string
  canChoose: boolean
  canReview: boolean
  canCreate: boolean
  loadSource: (file: File) => Promise<void>
  loadDestination: (file: File) => Promise<void>
  setSelectedIds: (ids: string[]) => void
  setDestinationBoxIndex: (index: number) => void
  setAcknowledged: (acknowledged: boolean) => void
  setStep: (step: TransferStep) => void
  createTransfer: () => Promise<void>
  downloadResult: () => void
  downloadSource?: () => void
  openResult: () => Promise<void>
  reset: () => void
}
