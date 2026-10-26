import { Suspense, useRef } from 'react'
import { Card } from './components/common'
import { AppMenubar } from './components/app/AppMenubar'
import { PWAInstallPrompt } from './components/common/PWAInstallPrompt'
import { ShaderBackground } from './components/common/ShaderBackground'
import { PokemonHeader, PokemonMovesSection, PokemonStatDisplay, PokemonTraitsSection, SaveFileDropzone } from './components/pokemon'
import { PokemonStorage } from './components/pokemon/PokemonStorage'
import { Toaster } from './components/ui/sonner'
import { useAutoRestore, useHistorySync, usePokemonData, useThemeSync, useUndoRedoShortcuts } from './hooks'
import { useSaveFileStore, useSettingsStore } from './stores'
import { useHistoryStore } from './stores/useHistoryStore'

export const App: React.FC = () => {
  const { partyList, boxList, activePokemon, preloadPokemonDetails } = usePokemonData()
  const commitHash = typeof __COMMIT_HASH__ === 'string' ? __COMMIT_HASH__ : 'dev'
  const defaultTitle = "Bill's PC - Edit Pokémon Save Files Online"

  const parse = useSaveFileStore(s => s.parse)
  const error = useSaveFileStore(s => s.error)
  const hasFile = useSaveFileStore(s => s.hasFile)
  const lastParseFailed = useSaveFileStore(s => s.lastParseFailed)
  const saveFileName = useSaveFileStore(s => s.parser?.saveFileName)
  const suppressAutoRestore = useSettingsStore(s => s.suppressAutoRestore)
  const shaderEnabled = useSettingsStore(s => s.shaderEnabled)
  const theme = useSettingsStore(s => s.theme)

  const undo = useHistoryStore(s => s.undo)
  const redo = useHistoryStore(s => s.redo)

  const attemptingRestore = useAutoRestore({ parse, suppressAutoRestore })
  useThemeSync({ theme, hasFile, saveFileName, defaultTitle })
  useUndoRedoShortcuts({ undo, redo })
  useHistorySync()

  const hasSaveData = hasFile && (partyList.length > 0 || boxList.length > 0)
  const shouldShowDropzone = !hasSaveData && !lastParseFailed && !attemptingRestore
  const filePickerRef = useRef<() => void>(null)
  const canSaveAs = typeof showSaveFilePicker === 'function'

  const backgroundByTheme: Record<'zinc' | 'slate' | 'light', string> = {
    slate:
      'bg-slate-900 bg-[linear-gradient(to_bottom,theme(colors.slate.900)_20%,transparent),radial-gradient(theme(colors.slate.700)_1px,transparent_1px),radial-gradient(theme(colors.slate.700)_1px,transparent_1px)] [background-size:100%_100%,16px_16px,16px_16px] [background-position:0_0,0_0,8px_8px]',
    light:
      'bg-zinc-100 bg-[linear-gradient(to_bottom,theme(colors.zinc.100)_20%,transparent),radial-gradient(theme(colors.zinc.300)_1px,transparent_1px),radial-gradient(theme(colors.zinc.300)_1px,transparent_1px)] [background-size:100%_100%,16px_16px,16px_16px] [background-position:0_0,0_0,8px_8px]',
    zinc: 'bg-zinc-900 bg-[linear-gradient(to_bottom,theme(colors.zinc.900)_20%,transparent),radial-gradient(theme(colors.zinc.700)_1px,transparent_1px),radial-gradient(theme(colors.zinc.700)_1px,transparent_1px)] [background-size:100%_100%,16px_16px,16px_16px] [background-position:0_0,0_0,8px_8px]',
  }

  const backgroundClass = backgroundByTheme[theme]

  return (
    <>
      <div className={`fixed inset-0 z-[-2] ${backgroundClass}`} />
      {shaderEnabled && (
        <Suspense fallback={null}>
          <ShaderBackground inverted={theme === 'light'} />
        </Suspense>
      )}
      <Toaster richColors position="bottom-center" />
      <div className="min-h-screen flex items-center justify-center p-4 font-pixel text-foreground">
        <SaveFileDropzone
          onFileLoad={parse}
          error={error}
          showDropzone={shouldShowDropzone}
          onOpenFilePicker={fn => {
            filePickerRef.current = fn
          }}
        />
        {hasSaveData && (
          <main className="w-full max-w-6xl mx-auto z-10 gap-4 flex flex-col">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 z-10">
              <div className="min-w-0 flex flex-col gap-4">
                <AppMenubar
                  onRequestOpenFile={() => {
                    filePickerRef.current?.()
                  }}
                  canSaveAs={canSaveAs}
                  commitHash={commitHash}
                />
                <PokemonStorage onPokemonHover={preloadPokemonDetails} />
              </div>
              {activePokemon ? (
                <div className="min-w-0 grid grid-rows-[auto_auto_1fr] gap-4">
                  <Card className="z-30">
                    <PokemonHeader />
                    <PokemonMovesSection />
                  </Card>
                  <Card className="z-20">
                    <PokemonStatDisplay />
                  </Card>
                  <Card className="z-10 min-h-64">
                    <PokemonTraitsSection />
                  </Card>
                </div>
              ) : (
                <Card className="min-h-64 p-6 flex flex-col items-center justify-center text-center gap-3">
                  <h2 className="text-lg">Select a Pokémon to edit</h2>
                  <p className="text-sm text-muted-foreground">Choose another PC box or return to your party.</p>
                </Card>
              )}
            </div>
          </main>
        )}
      </div>
      <PWAInstallPrompt />
    </>
  )
}
