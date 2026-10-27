import { fromEvent } from 'file-selector'
import { ArrowRight, ArrowRightLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { PokemonSaveParser } from '@/lib/parser/core/PokemonSaveParser'
import { cn } from '@/lib/utils'
import { EmulatorConnect } from './EmulatorConnect'

interface SaveFileDropzoneProps {
  onFileLoad: PokemonSaveParser['parse']
  error?: string | null
  showDropzone: boolean
  onOpenFilePicker?: (fn: () => void) => void
  onTransfer?: () => void
  transferDisabled?: boolean
}

function isFsFileHandle(obj: unknown): obj is FileSystemFileHandle {
  if (!obj || typeof obj !== 'object') return false
  const anyObj = obj as { getFile?: unknown; createWritable?: unknown }
  return typeof anyObj.getFile === 'function' && typeof anyObj.createWritable === 'function'
}

export const SaveFileDropzone: React.FC<SaveFileDropzoneProps> = ({ onFileLoad, error = null, showDropzone, onOpenFilePicker, onTransfer, transferDisabled = false }) => {
  const [watchedFile, setWatchedFile] = useState<{ handle: FileSystemFileHandle; version: number } | null>(null)
  const fileHandle = watchedFile?.handle ?? null
  const pollInterval = useRef<NodeJS.Timeout | null>(null)
  const lastModifiedRef = useRef<number | null>(null)
  // The input can receive a selection immediately after commit, before passive
  // effects run. Only teardown should mark its callbacks as inactive.
  const mounted = useRef(true)
  const versions = useRef({ read: 0, watch: 0 })
  const previousShowDropzone = useRef(showDropzone)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Do not invalidate read tokens here: StrictMode replays this effect
      // while a legitimate first selection may already be awaiting bytes.
      // A real unmount stays inactive; selecting a newer file changes tokens.
    }
  }, [])

  const loadFile = (input: File | FileSystemFileHandle) => {
    // The store presents real parse failures through `error`; cancelled reads
    // must not become unhandled promise rejections after leaving the editor.
    void onFileLoad(input).catch(() => {})
  }

  const globalScope = typeof globalThis === 'object' ? (globalThis as Window & typeof globalThis) : undefined
  const supportsFsAccessApi = Boolean(globalScope && 'showOpenFilePicker' in globalScope)

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    getFilesFromEvent: async event => {
      if (!mounted.current) return []
      const version = ++versions.current.read
      const active = () => mounted.current && versions.current.read === version
      if (Array.isArray(event)) {
        // Handle file system access API
        const [handle] = event
        if (!isFsFileHandle(handle)) {
          toast.error('Invalid file handle. Please try again.', {
            position: 'bottom-center',
            duration: 3000,
          })
          return []
        }
        try {
          const file = await handle.getFile()
          if (!active()) return []
          lastModifiedRef.current = file.lastModified
          setWatchedFile({ handle, version: ++versions.current.watch })
          loadFile(handle)
        } catch (error) {
          if (active()) toast.error(error instanceof Error ? error.message : 'Could not open this save file.')
        }
        return [] // we dont need to return files here, as we handle the file directly
      }

      // Fallback to default behavior for regular file drops
      const files = await fromEvent(event)
      return active() ? files : []
    },
    onDrop: acceptedFiles => {
      if (!mounted.current) return
      const [file] = acceptedFiles
      if (typeof file !== 'undefined') {
        versions.current.read++
        versions.current.watch++
        setWatchedFile(null)
        lastModifiedRef.current = file.lastModified ?? null
        loadFile(file)
      }
    },
    accept: {
      'application/octet-stream': ['.sav', '.sa2'],
    },
    maxFiles: 1,
    noKeyboard: true,
    noClick: true,
    useFsAccessApi: supportsFsAccessApi,
  })

  // Poll for file changes if fileHandle is available
  useEffect(() => {
    if (!watchedFile) return
    const { handle, version } = watchedFile
    let cancelled = false
    let polling = false

    const refreshHandle = async () => {
      if (polling) return
      polling = true
      try {
        const file = await handle.getFile()
        if (cancelled || !mounted.current || versions.current.watch !== version) return
        const nextModified = file.lastModified
        if (lastModifiedRef.current !== nextModified) {
          lastModifiedRef.current = nextModified
          void onFileLoad(file).catch(() => {})
        }
      } catch (pollError) {
        if (!cancelled) console.warn('Failed to poll file changes:', pollError)
      } finally {
        polling = false
      }
    }

    pollInterval.current = setInterval(() => {
      void refreshHandle()
    }, 300)

    return () => {
      cancelled = true
      if (pollInterval.current) clearInterval(pollInterval.current)
      pollInterval.current = null
    }
  }, [watchedFile, onFileLoad])

  // Clear handle and polling state when dropzone becomes active again (e.g., after unload)
  useEffect(() => {
    const becameActive = showDropzone && !previousShowDropzone.current
    previousShowDropzone.current = showDropzone
    if (!becameActive) return
    if (pollInterval.current) {
      clearInterval(pollInterval.current)
      pollInterval.current = null
    }
    if (fileHandle) {
      versions.current.watch++
      setWatchedFile(null)
    }
    lastModifiedRef.current = null
  }, [showDropzone, fileHandle])

  // Provide open to parent for external triggering, only if function changes
  useEffect(() => {
    if (onOpenFilePicker) {
      onOpenFilePicker(open)
    }
  }, [onOpenFilePicker, open])

  // Show error toast if error prop changes
  useEffect(() => {
    if (error) {
      toast.error(error, {
        position: 'bottom-center',
        duration: 5000,
      })
    }
  }, [error])

  const shouldShowOverlay = isDragActive || showDropzone

  // Define reusable style constants
  const overlayClasses = cn('fixed inset-0 z-50 flex items-center justify-center overflow-y-auto transition-colors duration-200', isDragActive ? 'bg-black/20' : 'bg-transparent', showDropzone ? 'p-4 sm:p-8' : 'p-0', !showDropzone && !isDragActive && 'pointer-events-none')

  const dropzoneBaseClasses = 'group my-auto w-full max-w-2xl flex flex-col items-center justify-center rounded-2xl cursor-pointer transition-all duration-300 ease-in-out border-2 border-dashed'

  const dropzoneStateClasses = cn(
    dropzoneBaseClasses,
    // Visibility
    isDragActive || showDropzone ? 'opacity-100' : 'opacity-0',
    // Base styling
    showDropzone ? 'bg-background/50 border shadow-2xl' : 'bg-transparent border-transparent',
    // Active drag styling
    isDragActive && 'bg-background/80 border-cyan-400 ring-4 ring-cyan-300/60 shadow-[0_0_32px_8px_rgba(34,211,238,0.4)] backdrop-blur-xs',
    // Hover styling
    !isDragActive && showDropzone && 'hover:bg-background/70'
  )

  if (!shouldShowOverlay) {
    // Render a minimal root element to catch drag events globally
    // when the dropzone is not supposed to be visible.
    // input supports file open on browsers that do not support the File System Access API
    return (
      <div {...getRootProps()} className="hidden">
        <input {...getInputProps()} />
      </div>
    )
  }

  return (
    <div className={overlayClasses}>
      <div {...getRootProps({ onClick: showDropzone ? open : undefined })} className={dropzoneStateClasses}>
        <input {...getInputProps()} />
        <div className="text-center px-5 py-8 sm:p-10 flex w-full flex-col items-center">
          <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png" alt="Poké Ball" className="w-16 h-16 mb-6" style={{ imageRendering: 'pixelated' }} />
          <h2 className="text-sm leading-7 sm:text-xl font-bold text-foreground">{isDragActive ? 'Drop your Savegame to load!' : 'Drop your Savegame here'}</h2>
          {showDropzone && <span className="geist-font text-muted-foreground mt-3 text-sm">or click to browse and edit your Pokémon</span>}
          <p className="geist-font text-xs text-muted-foreground mt-2">Supported: .sav, .sa2</p>
          {showDropzone && !isDragActive && onTransfer && (
            <div className="geist-font mt-7 w-full rounded-xl border border-cyan-600/20 bg-cyan-500/5 p-4 text-left sm:p-5" onClick={event => event.stopPropagation()}>
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ArrowRightLeft className="size-4 text-cyan-700 dark:text-cyan-300" aria-hidden />
                Your Hoenn journey continues
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Copy Pokémon from your Emerald save into Quetzal, with a clear review before you download.</p>
              <Button type="button" onClick={onTransfer} disabled={transferDisabled} className="mt-4 min-h-11 w-full rounded-lg bg-cyan-700 text-white hover:bg-cyan-800 dark:bg-cyan-300 dark:text-zinc-950 dark:hover:bg-cyan-200">
                Transfer Pokémon <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          )}
          {showDropzone && !isDragActive && (
            <div className="mt-6" onClick={e => e.stopPropagation()}>
              <EmulatorConnect />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
