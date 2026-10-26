import { create } from 'zustand'
import type { PokemonBase } from '@/lib/parser/core/PokemonBase'
import type { SaveData } from '@/lib/parser/core/types'
import { calculateTotalStats, natures } from '@/lib/parser/core/utils'
import type { UIPokemonBox, UIPokemonData } from '../types'
import { beginEmulatorWrite, endEmulatorWrite, useEmulatorStore } from './useEmulatorStore'
import { useHistoryStore } from './useHistoryStore'
import { useSaveFileStore } from './useSaveFileStore'

// Constants
const MAX_EV_PER_STAT = 252
const MAX_TOTAL_EVS = 508

/**
 * Write a Pokemon's raw bytes back to emulator memory at the correct party slot address.
 * No-op if not connected to an emulator.
 */
function syncPokemonToEmulator(pokemon: PokemonBase, partyList: UIPokemonData[]): void {
  const { client, status } = useEmulatorStore.getState()
  if (!client || (status !== 'connected' && status !== 'watching')) return

  const { parser } = useSaveFileStore.getState()
  const layout = parser?.getMemoryLayout()
  if (!layout) return

  const slotIndex = partyList.findIndex(p => p.data === pokemon)
  if (slotIndex === -1) return

  const address = layout.partyData + slotIndex * layout.pokemonSize
  beginEmulatorWrite()
  client
    .writeBytes(address, pokemon.rawBytes)
    .catch(err => {
      console.error('Failed to write Pokemon to emulator:', err)
    })
    .finally(endEmulatorWrite)
}

/**
 * Write all party Pokemon to emulator memory (used after reordering).
 * Concatenates all slots into a single write for efficiency.
 */
function syncFullPartyToEmulator(partyList: UIPokemonData[]): void {
  const { client, status } = useEmulatorStore.getState()
  if (!client || (status !== 'connected' && status !== 'watching')) return

  const { parser } = useSaveFileStore.getState()
  const layout = parser?.getMemoryLayout()
  if (!layout) return

  const fullBuffer = new Uint8Array(partyList.length * layout.pokemonSize)
  for (let i = 0; i < partyList.length; i++) {
    fullBuffer.set(partyList[i]!.data.rawBytes, i * layout.pokemonSize)
  }

  beginEmulatorWrite()
  client
    .writeBytes(layout.partyData, fullBuffer)
    .catch(err => {
      console.error('Failed to write party to emulator:', err)
    })
    .finally(endEmulatorWrite)
}

export interface PokemonState {
  activePokemonId: number
  partyList: UIPokemonData[]
  boxList: UIPokemonBox[]
  storageView: 'party' | 'boxes'
  activeBoxIndex: number
  megaPreview: Record<number, { enabled: boolean; form?: string }>
  // UI identity management (stable across reorders/undo within a session)
  nextUiId: number
  pendingIdsBySlot: number[] | null
}

export interface PokemonActions {
  setActivePokemonId: (id: number) => void
  setPartyList: (partyList: UIPokemonData[]) => void
  setBoxList: (boxList: UIPokemonBox[]) => void
  setStorageView: (view: 'party' | 'boxes') => void
  setActiveBoxIndex: (index: number) => void
  setEvIndex: (pokemonId: number, statIndex: number, evValue: number) => void
  setIvIndex: (pokemonId: number, statIndex: number, ivValue: number) => void
  setNature: (pokemonId: number, nature: string) => void
  setAbilitySlot: (pokemonId: number, slot: number) => void
  setItemId: (pokemonId: number, itemId: number | null) => void
  setMegaPreviewEnabled: (pokemonId: number, enabled: boolean) => void
  setMegaPreviewForm: (pokemonId: number, form: string | undefined) => void
  getRemainingEvs: (pokemonId: number) => number
  resetPokemonData: () => void
  clearPokemonDetails: () => void
  resetUiIdentities: () => void
  setPendingIdsBySlot: (ids: number[] | null) => void
  commitPartyReorder: (newOrder: UIPokemonData[], previousIds?: number[]) => void
}

export type PokemonStore = PokemonState & PokemonActions

// Box ids are tied to their saved location, so undo/redo retains the selection.
const BOX_ID_BASE = 1_000_000

export function findPokemon(state: PokemonState, id: number): UIPokemonData | undefined {
  const partyPokemon = state.partyList.find(p => p.id === id)
  if (partyPokemon) return partyPokemon
  for (const box of state.boxList) {
    const pokemon = box.pokemon.find(p => p?.id === id)
    if (pokemon) return pokemon
  }
  return undefined
}

export function selectActivePokemon(state: PokemonState): UIPokemonData | undefined {
  return findPokemon(state, state.activePokemonId)
}

function updatePokemon(state: PokemonState, id: number, update: (pokemon: UIPokemonData) => UIPokemonData): Partial<PokemonState> {
  const partyIndex = state.partyList.findIndex(p => p.id === id)
  if (partyIndex !== -1) {
    const previous = state.partyList[partyIndex]!
    const next = update(previous)
    return next === previous ? {} : { partyList: state.partyList.map(p => (p.id === id ? next : p)) }
  }
  const boxIndex = state.boxList.findIndex(box => box.pokemon.some(p => p?.id === id))
  if (boxIndex === -1) return {}
  const box = state.boxList[boxIndex]!
  const previous = box.pokemon.find(p => p?.id === id)!
  const next = update(previous)
  return next === previous
    ? {}
    : {
        boxList: state.boxList.map((entry, index) => (index === boxIndex ? { ...entry, pokemon: entry.pokemon.map(p => (p?.id === id ? next : p)) } : entry)),
      }
}

export const usePokemonStore = create<PokemonStore>((set, get) => ({
  // Initial state
  activePokemonId: -1,
  partyList: [],
  boxList: [],
  storageView: 'party',
  activeBoxIndex: 0,
  megaPreview: {},
  nextUiId: 1,
  pendingIdsBySlot: null,

  // Actions
  setActivePokemonId: (id: number) => {
    set({ activePokemonId: id })
  },

  setPartyList: (partyList: UIPokemonData[]) => {
    set({ partyList })
  },

  setBoxList: (boxList: UIPokemonBox[]) => {
    set({ boxList })
  },

  setStorageView: (storageView: 'party' | 'boxes') => {
    set(state => {
      const candidates = storageView === 'party' ? state.partyList : (state.boxList[state.activeBoxIndex]?.pokemon ?? [])
      const activePokemonId = candidates.some(p => p?.id === state.activePokemonId) ? state.activePokemonId : (candidates.find(p => p)?.id ?? -1)
      return { storageView, activePokemonId }
    })
  },

  setActiveBoxIndex: (activeBoxIndex: number) => {
    set(state => {
      if (!Number.isInteger(activeBoxIndex) || activeBoxIndex < 0 || activeBoxIndex >= state.boxList.length) return {}
      return { activeBoxIndex, storageView: 'boxes', activePokemonId: state.boxList[activeBoxIndex]?.pokemon.find(p => p)?.id ?? -1 }
    })
  },

  setEvIndex: (pokemonId: number, statIndex: number, evValue: number) => {
    set(state =>
      updatePokemon(state, pokemonId, p => {
        if (p.id !== pokemonId || !p.details) return p

        // Validate EV constraints
        const clampedEvValue = Math.max(0, Math.min(MAX_EV_PER_STAT, evValue))

        // Calculate current total EVs excluding the stat being changed
        const currentEvs = p.data.evs
        const otherEvsTotal = currentEvs.reduce((sum, ev, index) => (index === statIndex ? sum : sum + ev), 0)

        // Ensure total EVs don't exceed limit
        const maxAllowedForThisStat = Math.min(MAX_EV_PER_STAT, MAX_TOTAL_EVS - otherEvsTotal)
        const step = p.data.evStep ?? 1
        const finalEvValue = Math.floor(Math.max(0, Math.min(clampedEvValue, maxAllowedForThisStat)) / step) * step

        // Only update if the value actually changed
        if (currentEvs[statIndex] === finalEvValue) return p
        useHistoryStore.getState().queueSnapshot()

        // Directly mutate the class instance
        p.data.setEvByIndex(statIndex, finalEvValue)
        p.data.setStats(calculateTotalStats(p.data, p.details.baseStats))
        syncPokemonToEmulator(p.data, state.partyList)
        // Return a new object reference for React to detect change
        return { ...p }
      })
    )
  },

  setIvIndex: (pokemonId: number, statIndex: number, ivValue: number) => {
    set(state =>
      updatePokemon(state, pokemonId, p => {
        if (p.id !== pokemonId || !p.details) return p

        // Only update if the value actually changed
        if (p.data.ivs[statIndex] === ivValue) return p
        useHistoryStore.getState().queueSnapshot()

        // Directly mutate the class instance
        p.data.setIvByIndex(statIndex, ivValue)
        p.data.setStats(calculateTotalStats(p.data, p.details.baseStats))
        syncPokemonToEmulator(p.data, state.partyList)
        // Return a new object reference for React to detect change
        return { ...p }
      })
    )
  },

  setNature: (pokemonId: number, nature: string) => {
    set(state =>
      updatePokemon(state, pokemonId, p => {
        const natureValue = natures.indexOf(nature)
        if (p.id !== pokemonId || !p.details) return p
        // Only update if the value actually changed
        if (p.data.natureRaw === natureValue) return p
        useHistoryStore.getState().queueSnapshot()
        p.data.setNatureRaw(natureValue)
        // Optionally, recalculate stats if needed
        p.data.setStats(calculateTotalStats(p.data, p.details.baseStats))
        syncPokemonToEmulator(p.data, state.partyList)
        return { ...p }
      })
    )
  },

  setAbilitySlot: (pokemonId: number, slot: number) => {
    set(state =>
      updatePokemon(state, pokemonId, p => {
        if (p.id !== pokemonId || !p.details) return p
        const desired = Math.max(0, Math.min(p.data.maxAbilityNumber ?? 2, slot - 1))
        if (p.data.abilityNumber === desired) return p
        useHistoryStore.getState().queueSnapshot()
        p.data.abilityNumber = desired
        syncPokemonToEmulator(p.data, state.partyList)
        return { ...p }
      })
    )
  },

  setItemId: (pokemonId: number, itemId: number | null) => {
    set(state =>
      updatePokemon(state, pokemonId, p => {
        if (p.id !== pokemonId) return p
        // Skip if same item
        const desired = itemId ?? 0
        // PokemonBase.item is mapped external id
        // If equal, no change
        if (p.data.item === desired) return p
        useHistoryStore.getState().queueSnapshot()
        p.data.setItem(desired)
        syncPokemonToEmulator(p.data, state.partyList)
        // Update details immediately for name (description will refetch separately elsewhere)
        const idName = p.data.itemIdName
        if (p.details) {
          const prettyName = idName ? idName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'None'
          const newDetails = {
            ...p.details,
            item: idName
              ? {
                  name: prettyName,
                  description: p.details.item?.description ?? 'No description available.',
                }
              : undefined,
          }
          return { ...p, details: newDetails }
        }
        return { ...p }
      })
    )
  },

  setMegaPreviewEnabled: (pokemonId: number, enabled: boolean) => {
    set(state => ({
      megaPreview: {
        ...state.megaPreview,
        [pokemonId]: { ...(state.megaPreview[pokemonId] ?? { enabled: false }), enabled },
      },
    }))
  },

  setMegaPreviewForm: (pokemonId: number, form: string | undefined) => {
    set(state => ({
      megaPreview: {
        ...state.megaPreview,
        [pokemonId]: { ...(state.megaPreview[pokemonId] ?? { enabled: false }), form },
      },
    }))
  },

  getRemainingEvs: (pokemonId: number) => {
    const pokemon = findPokemon(get(), pokemonId)
    if (!pokemon) return MAX_TOTAL_EVS
    const totalEvs = pokemon.data.evs.reduce((sum, ev) => sum + ev, 0)
    return Math.max(0, MAX_TOTAL_EVS - totalEvs)
  },

  resetPokemonData: () => {
    set({
      activePokemonId: -1,
      partyList: [],
      boxList: [],
      storageView: 'party',
      activeBoxIndex: 0,
    })
  },

  clearPokemonDetails: () => {
    set(state => ({
      partyList: state.partyList.map(p => ({ ...p, details: undefined })),
      boxList: state.boxList.map(box => ({ ...box, pokemon: box.pokemon.map(p => (p ? { ...p, details: undefined } : null)) })),
    }))
  },

  resetUiIdentities: () => {
    set({ nextUiId: 1, pendingIdsBySlot: null, megaPreview: {}, storageView: 'party', activeBoxIndex: 0 })
  },

  setPendingIdsBySlot: (ids: number[] | null) => {
    set({ pendingIdsBySlot: ids })
  },

  commitPartyReorder: (newOrder: UIPokemonData[], previousIds?: number[]) => {
    set({ partyList: newOrder })
    try {
      useHistoryStore.getState().queueSnapshot(350, previousIds)
    } catch {}
    try {
      const bases = newOrder.map(p => p.data)
      useSaveFileStore.getState().updatePartyOrder(bases)
    } catch {}
    syncFullPartyToEmulator(newOrder)
  },
}))

function createUiPokemon(data: PokemonBase, id: number): UIPokemonData {
  const shinyPath = data.isShiny || data.isRadiant ? '/shiny' : ''
  return {
    id,
    spriteUrl: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon${shinyPath}/${data.speciesId}.png`,
    spriteAniUrl: `/sprites${shinyPath}/${data.nameId}.gif`,
    data,
  }
}

// Helper function to build party list from save data
export const buildPartyListFromSaveData = (saveData: SaveData): UIPokemonData[] => {
  const { partyList: prevList, pendingIdsBySlot: pending, nextUiId: startingNextId } = usePokemonStore.getState()

  const usedIds = new Set<number>()
  let nextUiId = startingNextId

  const party = saveData.party_pokemon.map((parsedPokemon: PokemonBase, index: number) => {
    let uiId: number | undefined = Array.isArray(pending) ? pending[index] : undefined
    if (uiId && usedIds.has(uiId)) uiId = undefined

    if (!uiId && prevList[index] && !usedIds.has(prevList[index]!.id)) {
      uiId = prevList[index]!.id
    }

    if (!uiId) {
      uiId = nextUiId
      nextUiId += 1
    }

    usedIds.add(uiId)
    return createUiPokemon(parsedPokemon, uiId!)
  })

  usePokemonStore.setState(state => ({
    pendingIdsBySlot: null,
    nextUiId: Math.max(state.nextUiId, nextUiId),
  }))

  return party
}

export const buildBoxListFromSaveData = (saveData: SaveData): UIPokemonBox[] => {
  return (saveData.boxes ?? []).map((box, boxIndex) => ({
    name: box.name,
    pokemon: box.pokemon.map((data, slot) => (data ? createUiPokemon(data, BOX_ID_BASE + boxIndex * 30 + slot) : null)),
  }))
}
