import { ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { Card } from '@/components/common'
import { Button } from '@/components/ui/button'
import { usePokemonStore } from '@/stores'
import type { UIPokemonData } from '@/types'

interface PokemonBoxListProps {
  onPokemonHover?: (id: number) => void
}

const PokemonBoxSprite: React.FC<{ pokemon: UIPokemonData }> = ({ pokemon }) => {
  const [sourceIndex, setSourceIndex] = useState(0)
  if (sourceIndex >= 2) return <CircleHelp className="size-10 max-w-full text-muted-foreground/50" strokeWidth={1} aria-hidden />

  return <img src={sourceIndex === 0 ? pokemon.spriteAniUrl : pokemon.spriteUrl} alt="" className="size-10 max-w-full object-contain image-pixelate" draggable={false} onError={() => setSourceIndex(sourceIndex + 1)} />
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

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Previous box" disabled={activeBoxIndex === 0} onClick={() => setActiveBoxIndex(activeBoxIndex - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <select aria-label="PC box" value={activeBoxIndex} onChange={event => setActiveBoxIndex(Number(event.target.value))} className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-cyan-500">
          {boxList.map((entry, index) => (
            <option key={index} value={index}>
              {index + 1}. {entry.name} ({entry.pokemon.filter(Boolean).length}/{entry.pokemon.length})
            </option>
          ))}
        </select>
        <Button variant="ghost" size="icon" aria-label="Next box" disabled={activeBoxIndex === boxList.length - 1} onClick={() => setActiveBoxIndex(activeBoxIndex + 1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Box {activeBoxIndex + 1} of {boxList.length}
        </span>
        <span>
          {occupied}/{box.pokemon.length} Pokémon
        </span>
      </div>
      <div className="grid grid-cols-6 gap-1.5" role="group" aria-label={`${box.name} Pokémon`}>
        {box.pokemon.map((pokemon, slot) => {
          let slotStyle = 'border-dashed border-border/60 bg-background/20'
          if (pokemon) slotStyle = 'border-border bg-card/40 hover:bg-card/80 cursor-pointer'
          if (pokemon?.id === activePokemonId) slotStyle = 'border-cyan-400 bg-cyan-500/10 ring-1 ring-cyan-400'
          return (
            <button
              key={slot}
              type="button"
              disabled={!pokemon}
              aria-label={`Box ${activeBoxIndex + 1}, slot ${slot + 1}: ${pokemon?.data.nickname ?? 'Empty'}`}
              aria-pressed={pokemon ? pokemon.id === activePokemonId : undefined}
              title={pokemon ? `${pokemon.data.nickname} · Slot ${slot + 1}` : `Empty slot ${slot + 1}`}
              onClick={() => pokemon && setActivePokemonId(pokemon.id)}
              onMouseEnter={() => pokemon && onPokemonHover?.(pokemon.id)}
              onFocus={() => pokemon && onPokemonHover?.(pokemon.id)}
              className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 pt-3 pb-2 min-h-20 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 ${slotStyle}`}
            >
              <span className="absolute top-1 left-1 text-[9px] text-muted-foreground/60">{slot + 1}</span>
              {pokemon ? (
                <>
                  <PokemonBoxSprite key={pokemon.spriteAniUrl} pokemon={pokemon} />
                  <span className="w-full truncate text-center text-[9px] leading-3">{pokemon.data.nickname}</span>
                </>
              ) : (
                <span className="text-[10px] text-muted-foreground/40">—</span>
              )}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{occupied ? 'Select a Pokémon to edit its stats, nature, ability or held item.' : 'This box is empty. Choose another box to find your Pokémon.'}</p>
    </Card>
  )
}
