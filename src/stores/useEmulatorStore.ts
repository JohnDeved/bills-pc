import { toast } from 'sonner'
import { create } from 'zustand'
import { MgbaWebSocketClient } from '@/lib/mgba/websocket-client'
import type { PokemonBase } from '@/lib/parser/core/PokemonBase'
import { useSaveFileStore } from './useSaveFileStore'

export type EmulatorStatus = 'disconnected' | 'connecting' | 'connected' | 'watching' | 'error'

/** Module-level counter so writes from usePokemonStore can suppress watch updates. */
let pendingWrites = 0
export function beginEmulatorWrite(): void {
  pendingWrites++
}
export function endEmulatorWrite(): void {
  pendingWrites = Math.max(0, pendingWrites - 1)
}
export function isEmulatorWritePending(): boolean {
  return pendingWrites > 0
}

export interface EmulatorState {
  status: EmulatorStatus
  error: string | null
  url: string
  gameTitle: string | null
  client: MgbaWebSocketClient | null
}

export interface EmulatorActions {
  setUrl: (url: string) => void
  connect: () => Promise<void>
  disconnect: () => void
}

export type EmulatorStore = EmulatorState & EmulatorActions

export const useEmulatorStore = create<EmulatorStore>((set, get) => ({
  status: 'disconnected',
  error: null,
  url: 'ws://localhost:7102/ws',
  gameTitle: null,
  client: null,

  setUrl: (url: string) => set({ url }),

  connect: async () => {
    const { status, url } = get()
    if (status === 'connecting' || status === 'connected' || status === 'watching') return

    set({ status: 'connecting', error: null })

    const client = new MgbaWebSocketClient(url)

    try {
      await client.connect()
      set({ status: 'connected', client })

      // Parse initial data through the save file store
      const { parse } = useSaveFileStore.getState()
      await parse(client)

      // Get game title for display
      try {
        const title = await client.getGameTitle()
        // Strip extra quotes from the double-stringify bug
        const cleanTitle = title.replace(/^"+|"+$/g, '')
        set({ gameTitle: cleanTitle })
      } catch {
        // Non-critical, continue without title
      }

      set({ status: 'watching' })

      // Start watch mode for real-time updates
      const { parser } = useSaveFileStore.getState()
      if (parser) {
        await parser.watch({
          onPartyChange: (partyPokemon: PokemonBase[]) => {
            // Skip watch updates while a write is in flight to avoid partial-read corruption
            if (isEmulatorWritePending()) return
            // Update saveData in the store to trigger reactive UI updates
            useSaveFileStore.setState(state => {
              if (!state.saveData) return state
              return {
                saveData: { ...state.saveData, party_pokemon: partyPokemon },
                lastUpdateTransient: true,
              }
            })
          },
          onError: (error: Error) => {
            console.error('Watch mode error:', error)
            toast.error(`Emulator watch error: ${error.message}`, {
              position: 'bottom-center',
              duration: 5000,
            })
          },
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect'
      set({ status: 'error', error: message, client: null })
      client.disconnect()
      throw error
    }
  },

  disconnect: () => {
    const { client } = get()
    if (client) {
      const { parser } = useSaveFileStore.getState()
      if (parser?.isWatching()) {
        parser.stopWatching().catch(console.error)
      }
      client.disconnect()
    }
    useSaveFileStore.getState().clearSaveFile()
    set({ status: 'disconnected', error: null, client: null, gameTitle: null })
  },
}))
