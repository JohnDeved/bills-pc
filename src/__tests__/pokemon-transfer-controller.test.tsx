// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { saveAs } from 'file-saver'
import { StrictMode, useLayoutEffect, useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePokemonTransfer } from '@/hooks/usePokemonTransfer'
import { useSaveFileStore } from '@/stores/useSaveFileStore'
import { usePokemonStore } from '@/stores/usePokemonStore'
import { loadBoxSave } from './box-fixtures'

vi.mock('file-saver', () => ({ saveAs: vi.fn() }))

function file(bytes: Uint8Array, name: string, pending?: Promise<ArrayBuffer>): File {
  const result = new File([new Uint8Array(bytes)], name)
  // jsdom's File lacks the browser's arrayBuffer method.
  Object.defineProperty(result, 'arrayBuffer', { value: () => pending ?? Promise.resolve(new Uint8Array(bytes).buffer) })
  return result
}

function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(new Uint8Array(reader.result as ArrayBuffer)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsArrayBuffer(blob)
  })
}

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>

describe('transfer workbench session safety', () => {
  beforeEach(() => {
    useSaveFileStore.setState(useSaveFileStore.getInitialState(), true)
    usePokemonStore.setState(usePokemonStore.getInitialState(), true)
    vi.mocked(saveAs).mockClear()
  })
  afterEach(cleanup)

  it('ignores a late source upload after a newer choice and never opens either in the editor', async () => {
    const { result } = renderHook(() => usePokemonTransfer(vi.fn()), { wrapper: strict })
    let finish!: (bytes: ArrayBuffer) => void
    const delayed = new Promise<ArrayBuffer>(resolve => {
      finish = resolve
    })
    const bytes = loadBoxSave('emerald')
    let first!: Promise<void>
    act(() => {
      first = result.current.loadSource(file(bytes, 'old.sav', delayed))
    })
    await act(async () => {
      await result.current.loadSource(file(bytes, 'new.sav'))
    })
    expect(result.current.source?.filename).toBe('new.sav')
    await act(async () => {
      finish(bytes.buffer)
      await first
    })
    expect(result.current.source?.filename).toBe('new.sav')
    expect(result.current.sourceError).toBeNull()
    expect(useSaveFileStore.getState().hasFile).toBe(false)
  })

  it('ignores a pending upload after unmount', async () => {
    const { result, unmount } = renderHook(() => usePokemonTransfer(vi.fn()))
    let finish!: (bytes: ArrayBuffer) => void
    const delayed = new Promise<ArrayBuffer>(resolve => {
      finish = resolve
    })
    const bytes = loadBoxSave('emerald')
    let pending!: Promise<void>
    act(() => {
      pending = result.current.loadSource(file(bytes, 'late.sav', delayed))
    })
    unmount()
    await act(async () => {
      finish(bytes.buffer)
      await pending
    })
    const next = renderHook(() => usePokemonTransfer(vi.fn()))
    expect(next.result.current.source).toBeNull()
    expect(useSaveFileStore.getState().hasFile).toBe(false)
  })

  it('keeps an initial upload across StrictMode effect replay', async () => {
    let finish!: (bytes: ArrayBuffer) => void
    const delayed = new Promise<ArrayBuffer>(resolve => {
      finish = resolve
    })
    const bytes = loadBoxSave('emerald')
    const input = file(bytes, 'early.sav', delayed)
    const { result } = renderHook(
      () => {
        const controller = usePokemonTransfer(vi.fn())
        const started = useRef(false)
        useLayoutEffect(() => {
          if (started.current) return
          started.current = true
          void controller.loadSource(input)
        }, [controller])
        return controller
      },
      { reactStrictMode: true }
    )
    await act(async () => {
      finish(bytes.buffer)
    })
    await waitFor(() => expect(result.current.source?.filename).toBe('early.sav'))
    expect(result.current.sourceError).toBeNull()
  })

  it('snapshots unsaved Emerald edits once and keeps the editor and its write handle intact', async () => {
    await useSaveFileStore.getState().parse(loadBoxSave('emerald').buffer)
    const { parser, saveData } = useSaveFileStore.getState()
    parser!.saveFileName = 'my-emerald.sav'
    const handle = { name: 'my-emerald.sav' } as FileSystemFileHandle
    parser!.fileHandle = handle
    const pokemon = saveData!.boxes![0]!.pokemon[0]!
    pokemon.setIvByIndex(0, pokemon.ivs[0] === 31 ? 0 : 31)
    const edited = parser!.reconstructSaveFile(saveData!.party_pokemon, saveData!.boxes)
    const { result } = renderHook(() => usePokemonTransfer(vi.fn()), { wrapper: strict })
    await waitFor(() => expect(result.current.source?.fromCurrentSave).toBe(true))
    expect(result.current.source?.filename).toBe('my-emerald.sav')
    act(() => result.current.downloadSource?.())
    const [blob] = vi.mocked(saveAs).mock.calls[0]!
    expect(await readBlob(blob as Blob)).toEqual(edited)
    act(() => result.current.reset())
    expect(useSaveFileStore.getState().parser).toBe(parser)
    expect(useSaveFileStore.getState().saveData).toBe(saveData)
    expect(parser!.fileHandle).toBe(handle)
    expect(parser!.reconstructSaveFile(saveData!.party_pokemon, saveData!.boxes)).toEqual(edited)
  })

  it('requires a fresh review after selection, destination or file changes and guards double creation', async () => {
    const onOpen = vi.fn()
    const { result } = renderHook(() => usePokemonTransfer(onOpen))
    await act(async () => {
      await result.current.loadSource(file(loadBoxSave('emerald'), 'emerald.sav'))
      await result.current.loadDestination(file(loadBoxSave('quetzal'), 'quetzal.sav'))
    })
    const { id } = result.current.candidates.find(candidate => candidate.canTransfer)!
    act(() => {
      result.current.setSelectedIds([id])
      result.current.setStep('choose')
    })
    act(() => result.current.setStep('review'))
    expect(result.current.canCreate).toBe(false)
    act(() => result.current.setAcknowledged(true))
    expect(result.current.canCreate).toBe(true)
    act(() => result.current.setDestinationBoxIndex(result.current.destinationBoxIndex))
    expect(result.current.acknowledged).toBe(false)
    act(() => result.current.setAcknowledged(true))
    act(() => result.current.setSelectedIds([id]))
    expect(result.current.acknowledged).toBe(false)
    act(() => result.current.setAcknowledged(true))
    await act(async () => {
      await Promise.all([result.current.createTransfer(), result.current.createTransfer()])
    })
    expect(result.current.step).toBe('complete')
    expect(result.current.result?.pokemonCount).toBe(1)
    expect(onOpen).not.toHaveBeenCalled()
    expect(useSaveFileStore.getState().hasFile).toBe(false)
    await act(async () => {
      await result.current.loadSource(file(loadBoxSave('emerald'), 'replacement.sav'))
    })
    expect(result.current.step).toBe('files')
    expect(result.current.result).toBeNull()
    expect(result.current.acknowledged).toBe(false)
    expect(result.current.selectedIds).toEqual([])
  })

  it.each(['emerald', 'quetzal'] as const)('backs up the initial edited %s save even after both wizard files are replaced', async game => {
    await useSaveFileStore.getState().parse(loadBoxSave(game).buffer)
    const { parser, saveData } = useSaveFileStore.getState()
    parser!.saveFileName = `old-${game}.sav`
    const originalPokemon = saveData!.boxes![0]!.pokemon[0]!
    originalPokemon.setIvByIndex(0, originalPokemon.ivs[0] === 31 ? 0 : 31)
    const expectedBackup = parser!.reconstructSaveFile(saveData!.party_pokemon, saveData!.boxes)
    const onOpen = vi.fn(async () => {
      expect(saveAs, 'Download the editor snapshot before replacing the editor').toHaveBeenCalledOnce()
    })
    const { result } = renderHook(() => usePokemonTransfer(onOpen))
    await waitFor(() => expect(result.current.loadingRole).toBeNull())
    await act(async () => {
      await result.current.loadSource(file(loadBoxSave('emerald'), 'replacement-emerald.sav'))
      await result.current.loadDestination(file(loadBoxSave('quetzal'), 'replacement-quetzal.sav'))
    })
    expect(result.current.editorBackupName).toBe(`old-${game}-before-transfer.sav`)
    const { id } = result.current.candidates.find(candidate => candidate.canTransfer)!
    act(() => {
      result.current.setSelectedIds([id])
      result.current.setStep('choose')
    })
    act(() => result.current.setStep('review'))
    act(() => result.current.setAcknowledged(true))
    await act(async () => {
      await result.current.createTransfer()
    })
    await act(async () => {
      await result.current.openResult()
    })
    expect(onOpen).toHaveBeenCalledOnce()
    const [blob, filename] = vi.mocked(saveAs).mock.calls[0]!
    expect(filename).toBe(`old-${game}-before-transfer.sav`)
    expect(await readBlob(blob as Blob)).toEqual(expectedBackup)
    expect(useSaveFileStore.getState().parser).toBe(parser)
  })
})
