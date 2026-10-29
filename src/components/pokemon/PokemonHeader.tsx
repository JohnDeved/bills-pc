import { FaHashtag } from 'react-icons/fa6'
import { useRef } from 'react'
import { ArrowUpLeft, LayoutGrid, List, MousePointerClick } from 'lucide-react'
import { Skeleton } from '@/components/common'
import { PokemonTypeBadge } from '@/components/pokemon/PokemonTypeBadge'
import { useActivePokemonLoading, useMegaPreview } from '@/hooks'
import { selectActivePokemon, usePokemonStore } from '@/stores'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Button } from '../ui/button'
import { CursorFollowHint } from '@/components/common/CursorFollowHint'
// Nature editing moved to Traits section's Nature tab

export const PokemonHeader: React.FC = () => {
  const isLoading = useActivePokemonLoading()
  const pokemon = usePokemonStore(selectActivePokemon)
  const location = usePokemonStore(state => {
    const partySlot = state.partyList.findIndex(entry => entry.id === state.activePokemonId)
    if (partySlot !== -1) return `Party · Slot ${partySlot + 1}`
    const box = state.boxList[state.activeBoxIndex]
    const slot = box?.pokemon.findIndex(entry => entry?.id === state.activePokemonId) ?? -1
    return box && slot >= 0 ? `${box.name} · Slot ${slot + 1}` : null
  })
  const megaAnchorRef = useRef<HTMLElement | null>(null)
  const { supportsMega, hasMegaForms, megaPreviewEnabled, setMegaPreviewEnabled, forms, selectedForm, setSelectedForm, statsLoading, megaTypes } = useMegaPreview()
  return (
    <Skeleton.LoadingProvider loading={isLoading}>
      <div className="p-3 border-b border-border">
        <div className="geist-font mb-3 flex min-h-8 items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5" title={location ?? undefined}>
            {pokemon?.data.isBoxed ? <LayoutGrid className="size-3.5 shrink-0" aria-hidden /> : <List className="size-3.5 shrink-0" aria-hidden />}
            <span className="truncate">{location ?? 'Select a Pokémon'}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {supportsMega && hasMegaForms && forms && forms.length > 1 && (
              <Select value={selectedForm} onValueChange={val => setSelectedForm(val)} disabled={!megaPreviewEnabled || statsLoading}>
                <SelectTrigger size="sm" aria-label="Mega form" title={forms.find(form => form.value === selectedForm)?.label} className="geist-font w-24 text-xs">
                  <SelectValue placeholder="Form" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {forms.map((form: { value: string; label: string }) => (
                      <SelectItem key={form.value} value={form.value} className="geist-font text-xs">
                        {form.label.replace(/^.* Mega/, 'Mega')}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
            <a href={pokemon?.data.isBoxed ? '#pc-storage' : '#pokemon-storage'} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md text-cyan-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500 dark:text-cyan-300 lg:hidden">
              <ArrowUpLeft className="size-3.5" aria-hidden />
              Back to {pokemon?.data.isBoxed ? 'box' : 'party'}
            </a>
          </div>
        </div>
        {/* Row 1: Name (+ Mega controls) and Dex ID */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 min-h-7 xl:min-h-[30px]">
            <h2 title={pokemon?.data.nickname} className="min-w-0 truncate font-pixel text-base sm:text-lg xl:text-xl text-foreground leading-normal">
              {pokemon?.data.nickname}
              {/* Shiny/Radiant icons temporarily disabled */}
            </h2>
            {supportsMega && (
              <span ref={megaAnchorRef} className="relative inline-flex size-7 shrink-0 overflow-visible">
                {hasMegaForms ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-full size-7 p-0"
                    aria-pressed={megaPreviewEnabled}
                    aria-label={megaPreviewEnabled ? 'Disable Mega Preview' : 'Enable Mega Preview'}
                    onClick={() => !statsLoading && setMegaPreviewEnabled(!megaPreviewEnabled)}
                    disabled={statsLoading}
                  >
                    <img src="/mega.svg" alt="Mega Evolution" className={`w-4 h-4 transition-[filter,opacity] ${megaPreviewEnabled ? '' : 'filter grayscale contrast-75 brightness-90 opacity-70'}`} draggable={false} />
                  </Button>
                ) : (
                  <span className="inline-block size-7 rounded-full opacity-0" aria-hidden />
                )}
                <CursorFollowHint anchorRef={megaAnchorRef} enabled={!statsLoading && hasMegaForms} once={false} requireOverflow={false} label={megaPreviewEnabled ? 'Mega Preview: On' : 'Mega Preview: Off'} icon={<MousePointerClick className="w-3.5 h-3.5" strokeWidth={2} />} />
              </span>
            )}
          </div>
          <div className="dark:bg-cyan-900/50 bg-cyan-100 dark:text-cyan-300 text-cyan-800 text-[10px] sm:text-xs px-2 py-1 rounded-md flex shrink-0 items-center gap-1.5 border dark:border-cyan-800 border-cyan-300">
            <FaHashtag size={12} />
            <span>{String(pokemon?.data.speciesId).padStart(3, '0')}</span>
          </div>
        </div>
        {/* Row 2: Typing */}
        <div className="flex items-center justify-between mt-2 min-h-[25px]">
          <Skeleton.Container className="flex items-center gap-2 min-w-8">
            {isLoading && <PokemonTypeBadge type="UNKNOWN" isLarge />}
            {(megaPreviewEnabled && megaTypes && megaTypes.length ? megaTypes : pokemon?.details?.types || []).map(type => (
              <PokemonTypeBadge key={type} type={type} isLarge />
            ))}
          </Skeleton.Container>
          <div className="flex items-center gap-2 min-w-8">{pokemon?.data.isBoxed && <span className="text-xs text-muted-foreground">{pokemon.data.level > 0 ? `Lv.${pokemon.data.level}` : 'Level…'}</span>}</div>
        </div>
      </div>
    </Skeleton.LoadingProvider>
  )
}
