// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode, useLayoutEffect, useRef } from 'react'
import type { DropzoneOptions } from 'react-dropzone'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SaveFileDropzone } from '@/components/pokemon/SaveFileDropzone'
import type { SaveData } from '@/lib/parser/core/types'

const mock = vi.hoisted(() => ({ options: null as DropzoneOptions | null }))
vi.mock('react-dropzone', () => ({
  useDropzone: (options: DropzoneOptions) => {
    mock.options = options
    return { getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: vi.fn() }
  },
}))
vi.mock('@/components/pokemon/EmulatorConnect', () => ({ EmulatorConnect: () => null }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => {
    resolve = yes
  })
  return { promise, resolve }
}

function handle(getFile: () => Promise<File>): FileSystemFileHandle {
  return { getFile, createWritable: vi.fn(), name: 'emerald.sav', kind: 'file' } as unknown as FileSystemFileHandle
}

const loaded: SaveData = { player_name: 'ASH', party_pokemon: [], play_time: { hours: 0, minutes: 0, seconds: 0 }, active_slot: 0 }

describe('save file picker and polling lifecycle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('accepts a file selection immediately after commit, before passive mount effects', async () => {
    const onFileLoad = vi.fn().mockResolvedValue(loaded)
    const getFile = vi.fn().mockResolvedValue(new File([], 'emerald.sav'))
    const selected = handle(getFile)
    function ImmediateSelection() {
      useLayoutEffect(() => {
        void mock.options!.getFilesFromEvent!([selected] as never)
      }, [])
      return <SaveFileDropzone onFileLoad={onFileLoad} showDropzone={false} />
    }
    render(<ImmediateSelection />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(getFile).toHaveBeenCalledTimes(1)
    expect(onFileLoad).toHaveBeenCalledWith(selected)
  })

  it('keeps an initial deferred selection valid through StrictMode effect replay', async () => {
    const pending = deferred<File>()
    const onFileLoad = vi.fn().mockResolvedValue(loaded)
    const getFile = vi.fn().mockReturnValue(pending.promise)
    const selected = handle(getFile)
    let reading: Promise<unknown> | undefined
    function ImmediateSelection() {
      const selectedOnce = useRef(false)
      useLayoutEffect(() => {
        if (selectedOnce.current) return
        selectedOnce.current = true
        reading = Promise.resolve(mock.options!.getFilesFromEvent!([selected] as never))
      }, [])
      return <SaveFileDropzone onFileLoad={onFileLoad} showDropzone={false} />
    }
    render(
      <StrictMode>
        <ImmediateSelection />
      </StrictMode>
    )
    expect(getFile).toHaveBeenCalledTimes(1)
    expect(onFileLoad).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve(new File([], 'emerald.sav'))
      await reading
    })
    expect(onFileLoad).toHaveBeenCalledTimes(1)
    expect(onFileLoad).toHaveBeenCalledWith(selected)
  })

  it('does not start a parse when a picker read finishes after unmount', async () => {
    const pending = deferred<File>()
    const onFileLoad = vi.fn().mockResolvedValue(loaded)
    const view = render(<SaveFileDropzone onFileLoad={onFileLoad} showDropzone={false} />)
    const selected = handle(() => pending.promise)
    const reading = mock.options!.getFilesFromEvent!([selected] as never)
    view.unmount()
    pending.resolve(new File([new Uint8Array([1])], 'emerald.sav'))
    await reading
    expect(onFileLoad).not.toHaveBeenCalled()
  })

  it('ignores a picker selection delivered after its component has unmounted', async () => {
    const onFileLoad = vi.fn().mockResolvedValue(loaded)
    const view = render(<SaveFileDropzone onFileLoad={onFileLoad} showDropzone={false} />)
    const read = mock.options!.getFilesFromEvent!
    const getFile = vi.fn().mockResolvedValue(new File([], 'emerald.sav'))
    view.unmount()
    await read([handle(getFile)] as never)
    expect(getFile).not.toHaveBeenCalled()
    expect(onFileLoad).not.toHaveBeenCalled()
  })

  it('cancels a poll already waiting for file bytes when the wizard unmounts the dropzone', async () => {
    const pending = deferred<File>()
    const original = new File([], 'emerald.sav', { lastModified: 1 })
    const getFile = vi.fn().mockResolvedValueOnce(original).mockReturnValueOnce(pending.promise)
    const onFileLoad = vi.fn().mockResolvedValue(loaded)
    const view = render(<SaveFileDropzone onFileLoad={onFileLoad} showDropzone={false} />)
    await act(async () => {
      await mock.options!.getFilesFromEvent!([handle(getFile)] as never)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(getFile).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => {
      pending.resolve(new File([], 'emerald.sav', { lastModified: 2 }))
      await Promise.resolve()
    })
    expect(onFileLoad).toHaveBeenCalledTimes(1)
  })

  it('ignores an old poll when a different save is selected', async () => {
    const pending = deferred<File>()
    const getFile = vi
      .fn()
      .mockResolvedValueOnce(new File([], 'emerald.sav', { lastModified: 1 }))
      .mockReturnValueOnce(pending.promise)
    const onFileLoad = vi.fn().mockResolvedValue(loaded)
    render(<SaveFileDropzone onFileLoad={onFileLoad} showDropzone={false} />)
    await act(async () => {
      await mock.options!.getFilesFromEvent!([handle(getFile)] as never)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    const replacement = new File([], 'quetzal.sav', { lastModified: 3 })
    await act(async () => {
      mock.options!.onDrop!([replacement], [], new Event('drop'))
    })
    await act(async () => {
      pending.resolve(new File([], 'emerald.sav', { lastModified: 2 }))
      await Promise.resolve()
    })
    expect(onFileLoad).toHaveBeenCalledTimes(2)
    expect(onFileLoad).toHaveBeenLastCalledWith(replacement)
  })

  it('keeps initial file polling active while the first parse is still showing the landing screen', async () => {
    const getFile = vi
      .fn()
      .mockResolvedValueOnce(new File([], 'emerald.sav', { lastModified: 1 }))
      .mockResolvedValueOnce(new File([], 'emerald.sav', { lastModified: 2 }))
    const onFileLoad = vi.fn().mockResolvedValue(loaded)
    render(<SaveFileDropzone onFileLoad={onFileLoad} showDropzone />)
    await act(async () => {
      await mock.options!.getFilesFromEvent!([handle(getFile)] as never)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(onFileLoad).toHaveBeenCalledTimes(2)
  })

  it('disables transfer entry while the editor is parsing', () => {
    render(<SaveFileDropzone onFileLoad={vi.fn()} showDropzone onTransfer={vi.fn()} transferDisabled />)
    expect(screen.getByRole('button', { name: /Transfer Pokémon/ })).toBeDisabled()
  })
})
