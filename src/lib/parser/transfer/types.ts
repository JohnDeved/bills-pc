import type { PokemonBase } from '../core/PokemonBase'
import type { SaveData } from '../core/types'

export type TransferGame = 'emerald' | 'quetzal'

export interface TransferIssue {
  readonly code: string
  readonly severity: 'warning' | 'error'
  readonly message: string
  readonly sourceId?: string
}

export interface TransferCandidate {
  /** Stable physical location in this source snapshot; indices are zero based. */
  readonly id: string
  readonly groupId: string
  readonly location: string
  readonly boxIndex?: number
  readonly slotIndex: number
  readonly pokemon: PokemonBase
  readonly level: number
  readonly nickname: string
  readonly speciesId: number
  readonly speciesName: string
  readonly blockingReason?: string
}

/** Display data only. Original bytes and the trusted parser live in a private session. */
export interface TransferSession {
  readonly game: TransferGame
  readonly fileName: string
  readonly playerName: string
  readonly saveData: SaveData
  readonly candidates: readonly TransferCandidate[]
}

export interface TransferEntry {
  readonly sourceId: string
  readonly sourceLabel: string
  readonly nickname: string
  readonly speciesId: number
  readonly speciesName: string
  readonly level: number
  readonly boxIndex: number
  readonly slotIndex: number
  readonly changes: readonly TransferIssue[]
}

export interface TransferPlan {
  readonly canTransfer: boolean
  readonly entries: readonly TransferEntry[]
  readonly issues: readonly TransferIssue[]
  readonly emptySlots: number
  readonly selectedCount: number
  readonly destinationBoxIndex: number
  readonly destinationBoxName: string
  readonly requiresAcknowledgement: boolean
}

export interface TransferResult {
  readonly bytes: Uint8Array
  readonly fileName: string
  readonly plan: TransferPlan
  readonly verification: {
    readonly sourceUnchanged: true
    readonly destinationUnchanged: true
    readonly existingPokemonUnchanged: true
    readonly outputReparsed: true
  }
}
