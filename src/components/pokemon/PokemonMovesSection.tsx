import React, { useEffect, useState } from 'react'
import { Skeleton } from '@/components/common'
import { PokemonMoveButton } from '@/components/pokemon/PokemonMoveButton'
import { PokemonMovePlaceholder } from '@/components/pokemon/PokemonMovePlaceholder'
import { PokemonMoveSummary } from '@/components/pokemon/PokemonMoveSummary'
import { useActivePokemonLoading } from '@/hooks'
import { selectActivePokemon, usePokemonStore } from '@/stores'
import type { MoveWithDetails } from '@/types'

const EMPTY_MOVE: MoveWithDetails = {
  id: 0,
  name: 'None',
  pp: 0,
  type: 'UNKNOWN' as const,
  description: 'No move assigned.',
  power: null,
  accuracy: null,
}

export const PokemonMovesSection: React.FC = () => {
  const pokemon = usePokemonStore(selectActivePokemon)
  const activePokemonId = pokemon?.id ?? -1
  const isLoading = useActivePokemonLoading()
  const moves = pokemon?.details?.moves ?? []

  const [expandedMoveIndex, setExpandedMoveIndex] = useState<number | null>(null)
  useEffect(() => {
    setExpandedMoveIndex(null)
  }, [activePokemonId])

  const totalSlots = 4
  return (
    <Skeleton.LoadingProvider loading={isLoading}>
      <div className="p-3 grid grid-cols-2 gap-2">
        {Array.from({ length: totalSlots }).map((_, i) => {
          const move = moves[i] ?? EMPTY_MOVE
          if (!isLoading && move.id === 0) {
            // Show placeholder for empty slot or move id 0
            return (
              <div key={i} className="@container/move group min-w-0 cursor-default">
                <PokemonMovePlaceholder />
              </div>
            )
          }
          return (
            <div key={i} className="@container/move group min-w-0">
              {isLoading ? (
                <div className="h-full w-full text-left p-3 rounded-lg bg-card/50 group-hover:bg-card/70 backdrop-blur-sm border shadow-lg transition-all duration-200">
                  <PokemonMoveSummary name="Move Name" type="UNKNOWN" pp="25/25" loading />
                </div>
              ) : (
                <PokemonMoveButton move={move} isExpanded={expandedMoveIndex === i} opensUpward={i < totalSlots / 2} onHoverStart={() => setExpandedMoveIndex(i)} onHoverEnd={() => setExpandedMoveIndex(null)} />
              )}
            </div>
          )
        })}
      </div>
    </Skeleton.LoadingProvider>
  )
}
