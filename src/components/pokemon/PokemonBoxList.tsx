import { ArrowDownRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Inbox } from 'lucide-react'
import { useState } from 'react'
import { Card } from '@/components/common'
import { Button } from '@/components/ui/button'
import { useGifFrame } from '@/hooks/useGifFrame'
import { usePokemonStore } from '@/stores'
import type { UIPokemonData } from '@/types'

interface PokemonBoxListProps {
  onPokemonHover?: (id: number) => void
}

const PokemonBoxSprite: React.FC<{ pokemon: UIPokemonData; isSelected: boolean }> = ({ pokemon, isSelected }) => {
  const { staticFrameSrc } = useGifFrame(pokemon.spriteAniUrl)
  const [failedSources, setFailedSources] = useState<string[]>([])
  const preferred = isSelected ? pokemon.spriteAniUrl : staticFrameSrc
  const source = [preferred, staticFrameSrc, pokemon.spriteUrl].find(src => src && !failedSources.includes(src))
  if (!source) return <CircleHelp className="size-9 sm:size-11 max-w-full text-muted-foreground/60" strokeWidth={1} aria-hidden />

  return <img key={source} src={source} alt="" className="size-9 sm:size-11 max-w-full object-contain image-pixelate" draggable={false} onError={() => setFailedSources(failed => (failed.includes(source) ? failed : [...failed, source]))} />
}

export const PokemonBoxList: React.FC<PokemonBoxListProps> = ({ onPokemonHover }) => {
  const boxList = usePokemonStore(s => s.boxList)
  const activeBoxIndex = usePokemonStore(s => s.activeBoxIndex)
  const activePokemonId = usePokemonStore(s => s.activePokemonId)
  const setActiveBoxIndex = usePokemonStore(s => s.setActiveBoxIndex)
  const setActivePokemonId = usePokemonStore(s => s.setActivePokemonId)
  const box = boxList[activeBoxIndex]
  if (!box) return null

  const occupied = box.pokemon.filter(Boolean).length
  const selectedSlot = box.pokemon.findIndex(pokemon => pokemon?.id === activePokemonId)
  const selectedPokemon = box.pokemon[selectedSlot]

  return (
    <Card id="pc-storage" tabIndex={-1} aria-label="PC storage" className="flex h-full flex-col overflow-hidden scroll-mt-4 outline-none">
      <div className="shrink-0 space-y-3 border-b border-border/60 p-3 sm:p-4">
        <div className="geist-font flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="font-medium tracking-wide">
            Box {activeBoxIndex + 1} of {boxList.length}
          </span>
          <span className="tabular-nums">
            <span className="font-semibold text-foreground">{occupied}</span> / {box.pokemon.length} Pokémon
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="size-11 rounded-lg disabled:opacity-30" aria-label="Previous box" disabled={activeBoxIndex === 0} onClick={() => setActiveBoxIndex(activeBoxIndex - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <div className="relative flex h-11 min-w-0 flex-1 items-center rounded-lg border border-border bg-background/50 pl-3 pr-9 transition-colors hover:bg-accent/50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cyan-500">
            <span className="pointer-events-none truncate text-xs sm:text-sm" aria-hidden>
              {box.name}
            </span>
            {/* Keep the native picker for touch and keyboard use, with richer labels in its menu. */}
            <select aria-label="PC box" value={activeBoxIndex} onChange={event => setActiveBoxIndex(Number(event.target.value))} className="geist-font absolute inset-0 h-full w-full cursor-pointer text-sm opacity-0">
              {boxList.map((entry, index) => (
                <option key={index} value={index} className="bg-background text-foreground">
                  {index + 1}. {entry.name} ({entry.pokemon.filter(Boolean).length}/{entry.pokemon.length})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          </div>
          <Button variant="outline" size="icon" className="size-11 rounded-lg disabled:opacity-30" aria-label="Next box" disabled={activeBoxIndex === boxList.length - 1} onClick={() => setActiveBoxIndex(activeBoxIndex + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-6 gap-1 bg-background/30 p-3 sm:gap-2 sm:p-4" role="group" aria-label={`${box.name} Pokémon`}>
        {box.pokemon.map((pokemon, slot) => {
          const isSelected = !!pokemon && pokemon.id === activePokemonId
          let slotStyle = 'border-dashed border-border/60 bg-transparent'
          if (pokemon) slotStyle = 'border-border/80 bg-card/60 hover:border-muted-foreground/50 hover:bg-accent/60 cursor-pointer'
          if (isSelected) slotStyle = 'border-cyan-600 bg-cyan-500/10 ring-1 ring-inset ring-cyan-600 dark:border-cyan-400 dark:ring-cyan-400 dark:bg-cyan-400/10'
          return (
            <button
              key={slot}
              type="button"
              disabled={!pokemon}
              aria-label={`Box ${activeBoxIndex + 1}, slot ${slot + 1}: ${pokemon?.data.nickname ?? 'Empty'}`}
              aria-pressed={pokemon ? isSelected : undefined}
              title={pokemon ? `${pokemon.data.nickname} · Slot ${slot + 1}` : `Empty slot ${slot + 1}`}
              onClick={() => pokemon && setActivePokemonId(pokemon.id)}
              onMouseEnter={() => pokemon && onPokemonHover?.(pokemon.id)}
              onFocus={() => pokemon && onPokemonHover?.(pokemon.id)}
              className={`group relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-0.5 pt-4 pb-2 min-h-20 sm:min-h-24 transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-600 dark:focus-visible:outline-cyan-300 ${slotStyle}`}
            >
              <span className={`geist-font absolute top-1 left-1.5 text-[10px] leading-none tabular-nums ${isSelected ? 'text-cyan-700 dark:text-cyan-300' : 'text-muted-foreground/80'}`}>{String(slot + 1).padStart(2, '0')}</span>
              {isSelected && <Check className="absolute right-1 top-1 size-3 text-cyan-700 dark:text-cyan-300" strokeWidth={2.5} aria-hidden />}
              {pokemon ? (
                <>
                  <PokemonBoxSprite key={pokemon.spriteAniUrl} pokemon={pokemon} isSelected={isSelected} />
                  <span className={`geist-font w-full truncate text-center text-[10px] sm:text-xs font-medium leading-4 ${isSelected ? 'text-cyan-800 dark:text-cyan-100' : 'text-foreground/85'}`}>{pokemon.data.nickname}</span>
                </>
              ) : (
                <span className="size-1 rounded-full bg-muted-foreground/25" aria-hidden />
              )}
            </button>
          )
        })}
      </div>
      <div className="flex min-h-20 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/30 p-3 sm:px-4">
        {selectedPokemon ? (
          <>
            <div className="min-w-0" role="status">
              <p className="geist-font mb-1 text-xs text-muted-foreground">Selected · Slot {selectedSlot + 1}</p>
              <p className="break-all text-[10px] leading-5 sm:text-xs">{selectedPokemon.data.nickname}</p>
            </div>
            <Button asChild variant="outline" className="geist-font h-11 gap-1.5 rounded-lg border-cyan-600/30 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-800 hover:bg-cyan-500/20 dark:text-cyan-200 lg:hidden">
              <a href="#pokemon-editor">
                Edit Pokémon <ArrowDownRight className="size-4" aria-hidden />
              </a>
            </Button>
            <span className="geist-font hidden text-xs text-muted-foreground lg:block">Select a slot to edit</span>
          </>
        ) : (
          <div className="geist-font flex items-center gap-3">
            <Inbox className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-sm font-medium">{occupied ? 'Choose a Pokémon' : 'This box is empty'}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{occupied ? 'Select a slot to open the editor.' : 'Choose another box using the arrows or box menu.'}</p>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
