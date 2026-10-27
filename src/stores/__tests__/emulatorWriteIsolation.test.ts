import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MgbaWebSocketClient } from '@/lib/mgba/websocket-client'
import { PokemonSaveParser } from '@/lib/parser/core/PokemonSaveParser'
import { buildPartyListFromSaveData, usePokemonStore } from '@/stores/usePokemonStore'
import { isEmulatorWritePending, useEmulatorStore } from '@/stores/useEmulatorStore'
import { useHistoryStore } from '@/stores/useHistoryStore'
import { useSaveFileStore } from '@/stores/useSaveFileStore'
import { readSaveFixture, type BoxGame } from '../../__tests__/box-fixtures'

const originalQueueSnapshot = useHistoryStore.getState().queueSnapshot

function connectedClient() {
  const writeBytes = vi.fn().mockResolvedValue(undefined)
  const disconnect = vi.fn()
  const client = { writeBytes, disconnect } as unknown as MgbaWebSocketClient
  useEmulatorStore.setState({ client, status: 'watching' })
  return { client, writeBytes, disconnect }
}

async function openFile(game: BoxGame) {
  const parser = new PokemonSaveParser()
  const saveData = await parser.parse(readSaveFixture(game).buffer)
  const party = buildPartyListFromSaveData(saveData)
  expect(party.length).toBeGreaterThan(0)
  useSaveFileStore.setState({ parser, saveData, hasFile: true })
  usePokemonStore.setState({ partyList: party })
  return { parser, party }
}

async function finishWrites() {
  // Drain the write promise's catch/finally chain before checking suppression.
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(isEmulatorWritePending()).toBe(false)
}

describe('outgoing emulator writes belong to the active memory session', () => {
  beforeEach(() => {
    useSaveFileStore.getState().clearSaveFile()
    usePokemonStore.getState().resetPokemonData()
    useEmulatorStore.setState({ client: null, status: 'disconnected' })
    useHistoryStore.setState({ queueSnapshot: vi.fn() })
  })

  afterEach(async () => {
    await finishWrites()
    vi.restoreAllMocks()
    useHistoryStore.setState({ queueSnapshot: originalQueueSnapshot })
    useSaveFileStore.getState().clearSaveFile()
    usePokemonStore.getState().resetPokemonData()
    useEmulatorStore.setState({ client: null, status: 'disconnected' })
  })

  it.each(['emerald', 'quetzal'] as const)('keeps %s file party edits local when an older emulator remains connected', async game => {
    const { parser, party } = await openFile(game)
    const { writeBytes } = connectedClient()
    expect(parser.getMemoryLayout()).not.toBeNull() // An address alone is not authorization to write.
    expect(parser.isInMemoryMode()).toBe(false)
    const target = party[0]!
    const before = target.data.rawBytes
    usePokemonStore.getState().setItemId(target.id, target.data.item === 13 ? 14 : 13)
    expect(target.data.rawBytes).not.toEqual(before)
    await finishWrites()
    expect(writeBytes).not.toHaveBeenCalled()
  })

  it('keeps file party reorders local when an older emulator remains connected', async () => {
    const { party } = await openFile('quetzal')
    expect(party.length).toBeGreaterThan(1)
    const { writeBytes } = connectedClient()
    const reordered = [...party].reverse()
    usePokemonStore.getState().commitPartyReorder(reordered)
    expect(useSaveFileStore.getState().saveData?.party_pokemon).toEqual(reordered.map(pokemon => pokemon.data))
    await finishWrites()
    expect(writeBytes).not.toHaveBeenCalled()
  })

  it.each(['edit', 'reorder'] as const)('rejects a %s write when the memory parser belongs to a different client', async action => {
    const { parser, party } = await openFile('quetzal')
    const { client: oldClient, writeBytes } = connectedClient()
    const otherClient = { writeBytes: vi.fn() } as unknown as MgbaWebSocketClient
    vi.spyOn(parser, 'isInMemoryMode').mockReturnValue(true)
    vi.spyOn(parser, 'getWebSocketClient').mockReturnValue(otherClient)
    expect(parser.getWebSocketClient()).not.toBe(oldClient)
    if (action === 'edit') usePokemonStore.getState().setItemId(party[1]!.id, party[1]!.data.item === 13 ? 14 : 13)
    else usePokemonStore.getState().commitPartyReorder([...party].reverse())
    await finishWrites()
    expect(writeBytes).not.toHaveBeenCalled()
  })

  it('still writes the edited slot for the matching active memory client', async () => {
    const { parser, party } = await openFile('quetzal')
    const { client, writeBytes } = connectedClient()
    vi.spyOn(parser, 'isInMemoryMode').mockReturnValue(true)
    vi.spyOn(parser, 'getWebSocketClient').mockReturnValue(client)
    const layout = parser.getMemoryLayout()!
    const target = party[1]!
    usePokemonStore.getState().setItemId(target.id, target.data.item === 13 ? 14 : 13)
    await finishWrites()
    expect(writeBytes).toHaveBeenCalledExactlyOnceWith(layout.partyData + layout.pokemonSize, target.data.rawBytes)
  })

  it('still writes the reordered full party for the matching active memory client', async () => {
    const { parser, party } = await openFile('quetzal')
    const { client, writeBytes } = connectedClient()
    vi.spyOn(parser, 'isInMemoryMode').mockReturnValue(true)
    vi.spyOn(parser, 'getWebSocketClient').mockReturnValue(client)
    const layout = parser.getMemoryLayout()!
    const reordered = [...party].reverse()
    usePokemonStore.getState().commitPartyReorder(reordered)
    const expected = new Uint8Array(reordered.flatMap(pokemon => [...pokemon.data.rawBytes]))
    await finishWrites()
    expect(writeBytes).toHaveBeenCalledExactlyOnceWith(layout.partyData, expected)
  })

  it('keeps an edited file open when disconnecting its previous emulator client', async () => {
    const { parser, party } = await openFile('quetzal')
    const { writeBytes, disconnect } = connectedClient()
    const target = party[0]!
    const original = target.data.rawBytes
    usePokemonStore.getState().setItemId(target.id, target.data.item === 13 ? 14 : 13)
    const edited = target.data.rawBytes
    expect(edited).not.toEqual(original)
    const { saveData } = useSaveFileStore.getState()
    useEmulatorStore.getState().disconnect()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(writeBytes).not.toHaveBeenCalled()
    expect(useSaveFileStore.getState()).toMatchObject({ parser, saveData, hasFile: true })
    expect(target.data.rawBytes).toEqual(edited)
    expect(useEmulatorStore.getState()).toMatchObject({ status: 'disconnected', client: null })
  })

  it('still stops watching and clears the editor when its own memory client disconnects', async () => {
    const { parser } = await openFile('quetzal')
    const { client, disconnect } = connectedClient()
    vi.spyOn(parser, 'isInMemoryMode').mockReturnValue(true)
    vi.spyOn(parser, 'getWebSocketClient').mockReturnValue(client)
    vi.spyOn(parser, 'isWatching').mockReturnValue(true)
    const stop = vi.spyOn(parser, 'stopWatching').mockResolvedValue()
    useEmulatorStore.getState().disconnect()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(useSaveFileStore.getState()).toMatchObject({ parser: null, saveData: null, hasFile: false })
  })
})
