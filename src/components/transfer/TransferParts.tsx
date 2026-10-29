import { Check, CircleHelp, FileUp, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useRef, useState } from 'react'
import { Card } from '@/components/common'
import { Button } from '@/components/ui/button'
import type { TransferNotice, TransferPokemonView, TransferSaveView } from './types'

export const transferActionClassName = 'h-11 rounded-lg bg-cyan-700 px-5 text-white hover:bg-cyan-800 dark:bg-cyan-400 dark:text-zinc-950 dark:hover:bg-cyan-300'
export const transferFieldClassName = 'h-11 min-w-0 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-cyan-500'

export function TransferSprite({ pokemon, className = 'size-10' }: { pokemon: TransferPokemonView; className?: string }) {
  const [fallback, setFallback] = useState(0)
  const source = fallback === 0 ? pokemon.spriteUrl : pokemon.spriteFallbackUrl
  if (!source || fallback > 1) return <CircleHelp className={`${className} shrink-0 text-muted-foreground/60`} strokeWidth={1} aria-hidden />
  return <img src={source} className={`${className} shrink-0 object-contain image-pixelate`} alt="" draggable={false} onError={() => setFallback(value => value + 1)} />
}

export function TransferNoticeList({ notices }: { notices: readonly TransferNotice[] }) {
  if (!notices.length) return null
  return (
    <ul className="space-y-2 text-sm leading-6">
      {notices.map((notice, index) => (
        <li key={`${notice.code ?? notice.message}-${index}`} className="flex items-start gap-2">
          <TriangleAlert className={`mt-1 size-4 shrink-0 ${notice.severity === 'error' ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`} aria-hidden />
          <span>{notice.message}</span>
        </li>
      ))}
    </ul>
  )
}

interface TransferFileCardProps {
  role: 'source' | 'destination'
  save: TransferSaveView | null
  error: string | null
  loading: boolean
  disabled: boolean
  onLoad: (file: File) => Promise<void>
}

export function TransferFileCard({ role, save, error, loading, disabled, onLoad }: TransferFileCardProps) {
  const input = useRef<HTMLInputElement>(null)
  const source = role === 'source'
  const game = source ? 'Emerald' : 'Quetzal'
  const label = source ? 'Copy from' : 'Copy into'
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</p>
          <h3 className="font-pixel text-sm leading-6">{game}</h3>
        </div>
        <span className={`flex size-11 items-center justify-center rounded-xl border ${source ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-cyan-600/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'}`}>
          {save ? <Check className="size-5" aria-hidden /> : <FileUp className="size-5" aria-hidden />}
        </span>
      </div>
      <div className="space-y-4 p-5">
        {save ? (
          <div className="min-h-28 space-y-3">
            <p className="break-all text-base font-semibold">{save.filename}</p>
            <p className="text-sm text-muted-foreground">
              Trainer <span className="font-medium text-foreground">{save.trainerName || 'Unknown'}</span> · {save.pokemonCount} Pokémon · {save.boxCount} boxes
            </p>
            {save.fromCurrentSave && <span className="inline-flex rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">From your open save, including edits</span>}
          </div>
        ) : (
          <div className="min-h-28 space-y-2">
            <p className="text-base font-medium">{source ? 'Your original Hoenn adventure' : 'The adventure you’re continuing'}</p>
            <p className="text-sm leading-6 text-muted-foreground">{source ? 'Choose the Emerald save containing the Pokémon you want to bring over.' : 'Choose your existing Quetzal save. Copies will go into empty PC slots.'}</p>
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept=".sav,.sa2,.srm"
          aria-label={`${game} ${role} save`}
          className="hidden"
          disabled={disabled}
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void onLoad(file)
          }}
        />
        <Button type="button" variant="outline" className="h-11 w-full rounded-lg" disabled={disabled} onClick={() => input.current?.click()}>
          {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FileUp className="size-4" aria-hidden />}
          {loading ? `Reading ${game} save…` : `${save ? 'Change' : 'Choose'} ${game} save`}
        </Button>
        {error && (
          <p role="alert" className="rounded-lg border border-rose-600/25 bg-rose-500/5 p-3 text-sm leading-6 text-rose-800 dark:text-rose-300">
            {error}
          </p>
        )}
        {save?.notices?.map(notice => (
          <p key={notice} className="text-sm leading-6 text-amber-800 dark:text-amber-300">
            {notice}
          </p>
        ))}
      </div>
    </Card>
  )
}
