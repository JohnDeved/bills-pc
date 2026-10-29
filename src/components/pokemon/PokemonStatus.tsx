import { useEffect, useState } from 'react'
import { Card } from '@/components/common'
import { getItemSpriteUrl } from '@/lib/parser/core/utils'
import { cn } from '@/lib/utils'
import type { Pokemon } from '@/types'
import { useMegaPreview } from '@/hooks'
import { useGifFrame } from '@/hooks/useGifFrame'

// Health percentage thresholds for color coding
const HP_THRESHOLDS = {
  HIGH: 50,
  LOW: 20,
} as const

// Props for PokemonStatus
export interface PokemonStatusProps {
  pokemon: Pokemon
  isActive: boolean
}

// Sprite display component
const PokemonSprite: React.FC<{
  src: string
  fallbackSrc: string
  alt?: string
  paused?: boolean
  children?: React.ReactNode
}> = ({ src, fallbackSrc, alt, paused, children }) => {
  // Determine if the src is a GIF
  const isGif = src && src.toLowerCase().endsWith('.gif')
  // Use the useGifFrame hook only for GIFs
  const { staticFrameSrc } = useGifFrame(isGif ? src : '')
  // If paused and GIF, show static frame; else show src
  const displaySrc = paused && isGif ? (staticFrameSrc ?? fallbackSrc) : src
  const [imgSrc, setImgSrc] = useState(displaySrc)
  useEffect(() => setImgSrc(displaySrc), [displaySrc])
  const handleError = () => setImgSrc(fallbackSrc)

  return (
    <div className="w-20 h-20 flex-shrink-0 mr-2 flex items-center justify-center relative select-none">
      {/* Blurred background image, not upscaled */}
      <img src={imgSrc} className={cn('absolute z-0 opacity-80 blur-md object-contain', '[image-rendering:pixelated]', 'max-w-[96px] max-h-[96px]')} onError={handleError} aria-hidden="true" draggable={false} onDragStart={e => e.preventDefault()} />
      {/* Main sprite image, not upscaled */}
      <img src={imgSrc} className={cn('z-10 object-contain transition-transform duration-300', '[image-rendering:pixelated]', 'max-w-[96px] max-h-[96px]', 'drop-shadow-[2px_2px_2px_black]')} onError={handleError} alt={alt} draggable={false} onDragStart={e => e.preventDefault()} />
      {children}
    </div>
  )
}

// Component for a single Pokémon's status display on the left
export const PokemonStatus: React.FC<PokemonStatusProps> = ({ pokemon, isActive }) => {
  const hpPercentage = (pokemon.data.currentHp / pokemon.data.maxHp) * 100
  const { megaPreviewEnabled, megaSpriteAniUrl, megaSpritePngUrl } = useMegaPreview()

  // Fix nested ternary
  let hpColor: string
  if (hpPercentage > HP_THRESHOLDS.HIGH) {
    hpColor = 'from-green-400 to-emerald-500'
  } else if (hpPercentage > HP_THRESHOLDS.LOW) {
    hpColor = 'from-yellow-400 to-amber-500'
  } else {
    hpColor = 'from-red-500 to-rose-600'
  }

  const containerClasses = isActive ? 'bg-card/80 ring-2 ring-cyan-400 shadow-lg shadow-cyan-500/30' : 'hover:bg-card/80'

  return (
    <Card className={cn('flex items-center p-3 transition-[background-color,box-shadow] duration-300', containerClasses)}>
      <PokemonSprite src={isActive && megaPreviewEnabled && megaSpriteAniUrl ? megaSpriteAniUrl : pokemon.spriteAniUrl} fallbackSrc={isActive && megaPreviewEnabled && megaSpritePngUrl ? megaSpritePngUrl : pokemon.spriteUrl} alt={pokemon.data.nickname} paused={!isActive}>
        <img
          src={pokemon.data.itemIdName ? getItemSpriteUrl(pokemon.data.itemIdName) : '/pokemon_item_placeholder_32x32.png'}
          alt={pokemon.data.itemIdName ?? 'No item'}
          className="absolute bottom-0 right-0 z-20 w-5 h-5 rounded-sm border border-border shadow-md image-pixelate bg-card/80 select-none"
          draggable={false}
          onDragStart={e => e.preventDefault()}
          onError={e => {
            const img = e.currentTarget
            if (img.dataset.fallbackApplied === '1') return
            img.dataset.fallbackApplied = '1'
            img.src = '/pokemon_item_placeholder_32x32.png'
          }}
        />
      </PokemonSprite>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-1 text-[10px] sm:text-sm">
          <h3 className="min-w-0 break-all text-foreground">{pokemon.data.nickname}</h3>
          <span className="shrink-0 text-muted-foreground">Lv.{pokemon.data.level}</span>
        </div>
        <div className="w-full bg-background/30 border border-border border-x-2 rounded-sm h-2.5 mt-2 overflow-hidden">
          <div className={cn('bg-gradient-to-r h-full transition-[width] duration-500', hpColor)} style={{ width: `${hpPercentage}%` }} />
        </div>
        <p className="text-right text-xs mt-1 text-muted-foreground">
          {pokemon.data.currentHp}/{pokemon.data.maxHp}
        </p>
      </div>
    </Card>
  )
}
