// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { saveAs } from 'file-saver'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadBoxSave, pokemonApiResponse, type BoxGame } from '@/__tests__/box-fixtures'
import { useHistorySync } from '@/hooks/useHistorySync'
import { usePokemonData } from '@/hooks/usePokemonData'
import { PokemonSaveParser } from '@/lib/parser/core/PokemonSaveParser'
import { selectActivePokemon, usePokemonStore } from '@/stores/usePokemonStore'
import { useHistoryStore } from '@/stores/useHistoryStore'
import { useSaveFileStore } from '@/stores/useSaveFileStore'

vi.mock('file-saver', () => ({ saveAs: vi.fn() }))

async function openSave(game: BoxGame) {
  await act(async () => {
    await useSaveFileStore.getState().parse(loadBoxSave(game).buffer)
  })
  await waitFor(() => expect(usePokemonStore.getState().boxList.length).toBeGreaterThan(0))
}

async function selectBoxPokemon(box: number, slot: number) {
  act(() => {
    usePokemonStore.getState().setActiveBoxIndex(box)
    usePokemonStore.getState().setActivePokemonId(usePokemonStore.getState().boxList[box]!.pokemon[slot]!.id)
  })
  await waitFor(() => expect(selectActivePokemon(usePokemonStore.getState())?.details).toBeDefined())
  return selectActivePokemon(usePokemonStore.getState())!
}

async function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result as ArrayBuffer))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsArrayBuffer(blob)
  })
}

describe('boxed Pokémon editing with real save fixtures', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    useHistoryStore.getState().clear()
    usePokemonStore.setState(usePokemonStore.getInitialState(), true)
    useSaveFileStore.setState(useSaveFileStore.getInitialState(), true)
    vi.mocked(saveAs).mockClear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({ ok: true, json: async () => pokemonApiResponse(String(url)) }))
    )
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    renderHook(
      () => {
        const data = usePokemonData()
        useHistorySync()
        return data
      },
      { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children) }
    )
  })

  afterEach(() => {
    cleanup()
    useHistoryStore.getState().clear()
    queryClient.clear()
    usePokemonStore.setState(usePokemonStore.getInitialState(), true)
    useSaveFileStore.setState(useSaveFileStore.getInitialState(), true)
    vi.unstubAllGlobals()
  })

  it.each<BoxGame>(['emerald', 'quetzal'])('%s: edits and downloads a boxed Pokémon without changing the party or neighboring slots', async game => {
    await openSave(game)
    const original = useSaveFileStore.getState().saveData!
    const partyBefore = original.party_pokemon.map(pokemon => [...pokemon.rawBytes])
    const boxesBefore = original.boxes!.map(box => box.pokemon.map(pokemon => pokemon && [...pokemon.rawBytes]))
    const target = await selectBoxPokemon(0, 0)
    const expectedIv = target.data.ivs[0] === 31 ? 0 : 31
    const expectedEv = target.data.evs[0] === 4 ? 8 : 4
    const expectedNature = target.data.nature === 'Adamant' ? 'Modest' : 'Adamant'

    act(() => {
      const store = usePokemonStore.getState()
      store.setIvIndex(target.id, 0, expectedIv)
      store.setEvIndex(target.id, 0, expectedEv)
      store.setNature(target.id, expectedNature)
      store.setAbilitySlot(target.id, 2)
      store.setItemId(target.id, 17)
    })
    await act(async () => useSaveFileStore.getState().reconstructAndDownload())

    expect(saveAs).toHaveBeenCalledOnce()
    const blob = vi.mocked(saveAs).mock.calls[0]![0] as Blob
    const exported = await readBlob(blob)
    expect(exported.byteLength).toBe(loadBoxSave(game).byteLength)
    expect([...new Uint8Array(exported).subarray(-16)]).toEqual([...loadBoxSave(game).subarray(-16)])
    const restored = await new PokemonSaveParser().parse(exported)
    const edited = restored.boxes![0]!.pokemon[0]!
    expect(edited.isBoxed).toBe(true)
    expect(edited.ivs[0]).toBe(expectedIv)
    expect(edited.evs[0]).toBe(expectedEv)
    expect(edited.nature).toBe(expectedNature)
    expect(edited.abilityNumber).toBe(1)
    expect(edited.item).toBe(17)
    expect(restored.party_pokemon.map(pokemon => [...pokemon.rawBytes])).toEqual(partyBefore)
    for (const [boxIndex, box] of restored.boxes!.entries()) {
      for (const [slot, pokemon] of box.pokemon.entries()) {
        if (boxIndex === 0 && slot === 0) continue
        expect(pokemon && [...pokemon.rawBytes], `box ${boxIndex + 1}, slot ${slot + 1}`).toEqual(boxesBefore[boxIndex]![slot])
      }
    }
  })

  it.each<BoxGame>(['emerald', 'quetzal'])('%s: undo, redo and reset keep the selected boxed Pokémon and restore its saved data', async game => {
    await openSave(game)
    const boxes = usePokemonStore.getState().boxList
    const boxIndex = boxes.reduce((last, box, index) => (box.pokemon.some(Boolean) ? index : last), -1)
    const slot = boxes[boxIndex]!.pokemon.reduce((last, pokemon, index) => (pokemon ? index : last), -1)
    const target = await selectBoxPokemon(boxIndex, slot)
    const originalItem = target.data.item
    const editedItem = originalItem === 17 ? 18 : 17
    const partyIds = usePokemonStore.getState().partyList.map(pokemon => pokemon.id)

    act(() => usePokemonStore.getState().setItemId(target.id, editedItem))
    expect(selectActivePokemon(usePokemonStore.getState())?.data.item).toBe(editedItem)

    for (const [operation, expectedItem] of [
      ['undo', originalItem],
      ['redo', editedItem],
      ['reset', originalItem],
    ] as const) {
      await act(async () => useHistoryStore.getState()[operation]())
      await waitFor(() => expect(selectActivePokemon(usePokemonStore.getState())?.data.item).toBe(expectedItem))
      const state = usePokemonStore.getState()
      expect(state.storageView).toBe('boxes')
      expect(state.activeBoxIndex).toBe(boxIndex)
      expect(state.activePokemonId).toBe(target.id)
      expect(state.partyList.map(pokemon => pokemon.id)).toEqual(partyIds)
    }
  })

  it('clears boxed selections and details when another save is opened', async () => {
    await openSave('quetzal')
    await selectBoxPokemon(7, 25)
    await openSave('emerald')
    await waitFor(() => expect(usePokemonStore.getState().storageView).toBe('party'))
    expect(usePokemonStore.getState().boxList).toHaveLength(14)
    expect(selectActivePokemon(usePokemonStore.getState())?.data.nickname).toBe('TREECKO')
    const treecko = await selectBoxPokemon(13, 29)
    expect(treecko.data.nickname).toBe('TREECKO')
    expect(treecko.data.speciesId).toBe(252)
  })

  it('keeps the file handle through undo but clears it when a different file is opened', async () => {
    class TestFileHandle {
      name = 'emerald.sav'
      async getFile() {
        return new File([loadBoxSave('emerald')], this.name)
      }
    }
    vi.stubGlobal('FileSystemFileHandle', TestFileHandle)
    const handle = new TestFileHandle() as unknown as FileSystemFileHandle
    await act(async () => {
      await useSaveFileStore.getState().parse(handle)
    })
    const originalParser = useSaveFileStore.getState().parser!
    expect(originalParser.fileHandle).toBe(handle)
    const target = await selectBoxPokemon(0, 0)
    act(() => usePokemonStore.getState().setItemId(target.id, 17))
    await act(async () => useHistoryStore.getState().undo())
    expect(useSaveFileStore.getState().parser).toBe(originalParser)
    expect(originalParser.fileHandle).toBe(handle)

    await act(async () => {
      await useSaveFileStore.getState().parse(new File([loadBoxSave('quetzal')], 'quetzal-direct.sav'))
    })
    const nextParser = useSaveFileStore.getState().parser!
    expect(nextParser).not.toBe(originalParser)
    expect(nextParser.fileHandle).toBeNull()
    expect(nextParser.saveFileName).toBe('quetzal-direct.sav')
    expect(usePokemonStore.getState().boxList).toHaveLength(45)
  })

  it('preserves the current save, box selection and undo history if opening another file fails', async () => {
    await openSave('emerald')
    const target = await selectBoxPokemon(13, 29)
    act(() => usePokemonStore.getState().setItemId(target.id, 17))
    const previous = useSaveFileStore.getState()
    const previousSnapshot = useHistoryStore.getState().queuedSnapshot
    const previousBytes = previous.parser!.reconstructSaveFile(previous.saveData!.party_pokemon, previous.saveData!.boxes)

    await act(async () => {
      await expect(useSaveFileStore.getState().parse(new File([new Uint8Array(100)], 'invalid.sav'))).rejects.toThrow()
    })
    const current = useSaveFileStore.getState()
    expect(current.parser).toBe(previous.parser)
    expect(current.saveData).toBe(previous.saveData)
    expect(current.saveSessionId).toBe(previous.saveSessionId)
    expect(current.parser!.reconstructSaveFile(current.saveData!.party_pokemon, current.saveData!.boxes)).toEqual(previousBytes)
    expect(usePokemonStore.getState().activePokemonId).toBe(target.id)
    expect(usePokemonStore.getState().activeBoxIndex).toBe(13)
    expect(useHistoryStore.getState().queuedSnapshot).toBe(previousSnapshot)
    await act(async () => useHistoryStore.getState().undo())
    expect(selectActivePokemon(usePokemonStore.getState())?.data.item).toBe(0)
  })
})
