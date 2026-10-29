import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PokemonSaveParser } from '@/lib/parser/core/PokemonSaveParser'
import type { PokemonBase } from '@/lib/parser/core/PokemonBase'
import type { SaveData } from '@/lib/parser/core/types'
import { useEmulatorStore } from '@/stores/useEmulatorStore'
import { useHistoryStore } from '@/stores/useHistoryStore'
import { useSaveFileStore } from '@/stores/useSaveFileStore'

vi.mock('@/lib/mgba/websocket-client', () => ({
  MgbaWebSocketClient: class {
    async connect() {}
    async getGameTitle() {
      return 'POKEMON EMER'
    }
    disconnect() {}
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function save(name: string): SaveData {
  return { player_name: name, party_pokemon: [], boxes: [], play_time: { hours: 0, minutes: 0, seconds: 0 }, active_slot: 0 }
}

describe('save lifecycle isolation', () => {
  beforeEach(() => {
    useSaveFileStore.getState().clearSaveFile()
    useHistoryStore.getState().clear()
    useEmulatorStore.setState({ status: 'disconnected', client: null, error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useSaveFileStore.getState().clearSaveFile()
    useHistoryStore.getState().clear()
    useEmulatorStore.setState({ status: 'disconnected', client: null })
  })

  it('keeps the newer file when an older read completes afterward', async () => {
    const old = deferred<SaveData>()
    const latest = save('NEW')
    vi.spyOn(PokemonSaveParser.prototype, 'parse').mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest)
    const stale = useSaveFileStore
      .getState()
      .parse(new ArrayBuffer(1))
      .catch(error => error)
    await useSaveFileStore.getState().parse(new ArrayBuffer(2))
    const { parser } = useSaveFileStore.getState()
    old.resolve(save('OLD'))
    expect(await stale).toMatchObject({ name: 'AbortError' })
    expect(useSaveFileStore.getState()).toMatchObject({ saveData: latest, parser, error: null, lastParseFailed: false, isLoading: false })
  })

  it('does not replace a successful new load with the error from an older read', async () => {
    const old = deferred<SaveData>()
    const latest = save('NEW')
    vi.spyOn(PokemonSaveParser.prototype, 'parse').mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest)
    const stale = useSaveFileStore
      .getState()
      .parse(new ArrayBuffer(1))
      .catch(error => error)
    await useSaveFileStore.getState().parse(new ArrayBuffer(2))
    old.reject(new Error('Old file failed'))
    expect(await stale).toMatchObject({ name: 'AbortError' })
    expect(useSaveFileStore.getState()).toMatchObject({ saveData: latest, error: null, lastParseFailed: false })
  })

  it('does not resurrect a file after the user clears it during a read', async () => {
    const old = deferred<SaveData>()
    vi.spyOn(PokemonSaveParser.prototype, 'parse').mockReturnValueOnce(old.promise)
    const stale = useSaveFileStore
      .getState()
      .parse(new ArrayBuffer(1))
      .catch(error => error)
    useSaveFileStore.getState().clearSaveFile()
    old.resolve(save('OLD'))
    expect(await stale).toMatchObject({ name: 'AbortError' })
    expect(useSaveFileStore.getState()).toMatchObject({ saveData: null, parser: null, hasFile: false, error: null, isLoading: false })
  })

  it('still reports a real failure from the newest request and preserves the prior active save', async () => {
    const current = save('CURRENT')
    const parser = new PokemonSaveParser()
    useSaveFileStore.setState({ saveData: current, parser, hasFile: true })
    vi.spyOn(PokemonSaveParser.prototype, 'parse').mockRejectedValueOnce(new Error('Invalid save checksum'))
    await expect(useSaveFileStore.getState().parse(new ArrayBuffer(1))).rejects.toThrow('Invalid save checksum')
    expect(useSaveFileStore.getState()).toMatchObject({ saveData: current, parser, error: 'Invalid save checksum', lastParseFailed: true })
  })

  it.each(['undo', 'redo', 'reset'] as const)('cancels stale %s and starts history from the newly loaded save', async action => {
    const old = deferred<SaveData>()
    const latest = save('NEW')
    vi.spyOn(PokemonSaveParser.prototype, 'reconstructSaveFile').mockImplementation(function (this: PokemonSaveParser) {
      return new Uint8Array([this === useSaveFileStore.getState().parser && useSaveFileStore.getState().saveData === latest ? 9 : 1])
    })
    vi.spyOn(PokemonSaveParser.prototype, 'parse').mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest)
    useSaveFileStore.setState({ saveData: save('OLD'), parser: new PokemonSaveParser(), hasFile: true })
    const snapshot = { bytes: new Uint8Array([1]), idsBySlot: [] }
    useHistoryStore.setState({ past: [snapshot], future: [snapshot], initial: snapshot, isApplying: false })
    const applying = useHistoryStore.getState()[action]()
    await useSaveFileStore.getState().parse(new ArrayBuffer(2))
    old.resolve(save('STALE HISTORY'))
    await expect(applying).resolves.toBeUndefined()
    expect(useSaveFileStore.getState().saveData).toBe(latest)
    expect(useHistoryStore.getState()).toMatchObject({ past: [], future: [], isApplying: false, initial: { bytes: new Uint8Array([9]) } })
  })

  it('ignores a previous emulator watcher after a new save is opened', async () => {
    vi.spyOn(PokemonSaveParser.prototype, 'parse').mockResolvedValueOnce(save('EMULATOR')).mockResolvedValueOnce(save('TRANSFER'))
    const watch = vi.spyOn(PokemonSaveParser.prototype, 'watch').mockResolvedValue()
    await useEmulatorStore.getState().connect()
    const onPartyChange = watch.mock.calls[0]?.[0]?.onPartyChange
    expect(onPartyChange).toBeTypeOf('function')
    const emulatorPokemon = { marker: 'emulator' } as unknown as PokemonBase
    onPartyChange!([emulatorPokemon])
    expect(useSaveFileStore.getState().saveData?.party_pokemon).toEqual([emulatorPokemon])
    const transferred = await useSaveFileStore.getState().parse(new ArrayBuffer(2))
    const { parser } = useSaveFileStore.getState()
    onPartyChange!([emulatorPokemon])
    expect(useSaveFileStore.getState()).toMatchObject({ saveData: transferred, parser, lastUpdateTransient: false })
    expect(transferred.party_pokemon).toEqual([])
  })
})
