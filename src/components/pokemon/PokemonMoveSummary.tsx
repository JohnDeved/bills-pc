import { Skeleton } from '@/components/common'
import type { PokemonType } from '@/types'
import { PokemonTypeBadge } from './PokemonTypeBadge'

interface PokemonMoveSummaryProps {
  name: string
  type: PokemonType
  pp: string
  ppTitle?: string
  loading?: boolean
  empty?: boolean
}

// The named container is the whole move slot, outside its border and padding.
// Use the same rows while loading and for empty slots, so metadata cannot move the editor.
export const PokemonMoveSummary: React.FC<PokemonMoveSummaryProps> = ({ name, type, pp, ppTitle, loading = false, empty = false }) => (
  <>
    <Skeleton.Text loading={loading} className={`block min-w-0 w-full truncate text-sm ${empty ? 'font-semibold text-muted-foreground' : 'text-foreground'}`}>
      {name}
    </Skeleton.Text>
    <div className="mt-2 grid grid-cols-1 items-center gap-x-2 gap-y-1 max-lg:@min-[10.25rem]/move:grid-cols-[max-content_1fr] lg:@min-[12.125rem]/move:grid-cols-[max-content_1fr]">
      <div className="h-5" aria-hidden={empty || loading || undefined}>
        {loading ? <Skeleton.Box loading className="h-5 w-20" /> : !empty && <PokemonTypeBadge type={type} />}
      </div>
      <span className="justify-self-end whitespace-nowrap text-xs leading-4 text-muted-foreground max-lg:[font-family:Geist,sans-serif] max-lg:antialiased" title={ppTitle}>
        <Skeleton.Text loading={loading}>{pp}</Skeleton.Text>
      </span>
    </div>
  </>
)
