import { ArrowRight, Check, ChevronLeft, ChevronRight, Inbox, Search, X } from 'lucide-react'
import { useState } from 'react'
import { Card } from '@/components/common'
import { Button } from '@/components/ui/button'
import { transferActionClassName, transferFieldClassName, TransferNoticeList, TransferSprite } from './TransferParts'
import type { TransferController } from './types'

export function TransferSelection({ controller }: { controller: TransferController }) {
  const [groupId, setGroupId] = useState('all')
  const [query, setQuery] = useState('')
  const { candidates, selectedIds, sourceGroups, destinationBoxes, destinationBoxIndex, plan } = controller
  const selected = new Set(selectedIds)
  const visible = candidates.filter(candidate => (groupId === 'all' || candidate.groupId === groupId) && `${candidate.nickname} ${candidate.speciesName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const eligible = visible.filter(candidate => candidate.canTransfer)
  const blocked = visible.filter(candidate => !candidate.canTransfer)
  const box = destinationBoxes.find(entry => entry.index === destinationBoxIndex)
  const free = box?.pokemon.filter(pokemon => !pokemon).length ?? 0
  const placements = new Map(plan?.placements.filter(placement => placement.boxIndex === destinationBoxIndex).map(placement => [placement.slot, candidates.find(candidate => candidate.id === placement.candidateId)]))
  let selectionHint = 'Choose the Pokémon you want to bring to Quetzal.'
  if (selectedIds.length) selectionHint = plan?.error || 'Review the transfer before creating your new save.'

  function toggle(id: string) {
    controller.setSelectedIds(selected.has(id) ? selectedIds.filter(entry => entry !== id) : [...selectedIds, id])
  }

  return (
    <>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="min-w-0 overflow-hidden">
          <div className="space-y-4 border-b border-border/60 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">Choose your Pokémon</h3>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={controller.source?.filename}>
                  {controller.source?.filename}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-cyan-800 dark:text-cyan-200">{selectedIds.length} selected</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select aria-label="Source location" value={groupId} onChange={event => setGroupId(event.target.value)} className={`${transferFieldClassName} sm:w-1/2`}>
                <option value="all">All Pokémon ({candidates.length})</option>
                {sourceGroups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name} ({group.count})
                  </option>
                ))}
              </select>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden />
                <input aria-label="Search source Pokémon" placeholder="Name or species" value={query} onChange={event => setQuery(event.target.value)} className={`${transferFieldClassName} pl-9 pr-9`} />
                {query && (
                  <button type="button" aria-label="Clear Pokémon search" className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-cyan-500" onClick={() => setQuery('')}>
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">
                {visible.length} shown{blocked.length ? ` · ${blocked.length} unavailable` : ''}
              </span>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="min-h-8 rounded text-cyan-800 hover:underline focus-visible:outline-2 focus-visible:outline-cyan-500 disabled:opacity-40 dark:text-cyan-200"
                  disabled={!eligible.length || eligible.every(candidate => selected.has(candidate.id))}
                  onClick={() => controller.setSelectedIds([...new Set([...selectedIds, ...eligible.map(candidate => candidate.id)])])}
                >
                  Select visible
                </button>
                <button type="button" className="min-h-8 rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-cyan-500 disabled:opacity-40" disabled={!selectedIds.length} onClick={() => controller.setSelectedIds([])}>
                  Clear selection
                </button>
              </div>
            </div>
          </div>
          <div className="custom-scrollbar max-h-[28rem] min-h-72 overflow-y-auto overscroll-contain bg-background/20 p-2 sm:p-3">
            {visible.length ? (
              <div className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4 sm:grid-cols-5 lg:grid-cols-5" role="group" aria-label="Source Pokémon">
                {visible.map(candidate => {
                  const isSelected = selected.has(candidate.id)
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      aria-label={`Select ${candidate.nickname} from ${candidate.location}`}
                      aria-pressed={isSelected}
                      disabled={!candidate.canTransfer}
                      title={
                        candidate.canTransfer
                          ? `${candidate.nickname} · ${candidate.location}`
                          : candidate.notices
                              .filter(notice => notice.severity === 'error')
                              .map(notice => notice.message)
                              .join(' ')
                      }
                      onClick={() => toggle(candidate.id)}
                      className={`relative flex min-w-0 flex-col items-center rounded-lg border px-1 pb-2 pt-5 text-center transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500 disabled:cursor-not-allowed disabled:opacity-45 ${isSelected ? 'border-cyan-600 bg-cyan-500/10 ring-1 ring-inset ring-cyan-600 dark:border-cyan-400 dark:ring-cyan-400' : 'border-border/80 bg-card/60 hover:border-muted-foreground/50 hover:bg-accent/50'}`}
                    >
                      <span className={`absolute right-1.5 top-1.5 flex size-3.5 items-center justify-center rounded border ${isSelected ? 'border-cyan-700 bg-cyan-700 text-white dark:border-cyan-300 dark:bg-cyan-300 dark:text-zinc-950' : 'border-muted-foreground/40'}`} aria-hidden>
                        {isSelected && <Check className="size-3" strokeWidth={3} />}
                      </span>
                      {candidate.level !== undefined && candidate.level > 0 && <span className="absolute left-1.5 top-1.5 text-[9px] tabular-nums text-muted-foreground">Lv.{candidate.level}</span>}
                      <TransferSprite key={candidate.spriteUrl} pokemon={candidate} className="size-11" />
                      <span className="mt-1 w-full truncate text-xs font-medium">{candidate.nickname}</span>
                      <span className="mt-1 w-full truncate text-[10px] leading-4 text-muted-foreground">{candidate.canTransfer ? candidate.location : 'Unavailable'}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                <Search className="size-6 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">{query ? 'No Pokémon match your search' : 'No Pokémon in this location'}</p>
                <p className="text-xs text-muted-foreground">{query ? 'Try another name or clear the search.' : 'Choose another box or your party.'}</p>
              </div>
            )}
          </div>
          {blocked.length > 0 && (
            <details className="border-t border-border/60 px-4 py-3 text-sm">
              <summary className="cursor-pointer py-1 font-medium text-amber-800 focus-visible:outline-2 focus-visible:outline-cyan-500 dark:text-amber-300">
                Why {blocked.length} Pokémon {blocked.length === 1 ? 'is' : 'are'} unavailable
              </summary>
              <ul className="mt-3 space-y-4">
                {blocked.map(candidate => (
                  <li key={candidate.id}>
                    <p className="mb-1 font-medium">
                      {candidate.nickname} <span className="font-normal text-muted-foreground">· {candidate.location}</span>
                    </p>
                    <TransferNoticeList notices={candidate.notices.filter(notice => notice.severity === 'error')} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>

        <Card className="min-w-0 self-start overflow-hidden">
          <div className="space-y-4 border-b border-border/60 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">Choose their new box</h3>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={controller.destination?.filename}>
                  {controller.destination?.filename}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums text-muted-foreground">{free} free slots</span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="size-11 rounded-lg" aria-label="Previous destination box" disabled={destinationBoxIndex <= 0} onClick={() => controller.setDestinationBoxIndex(destinationBoxIndex - 1)}>
                <ChevronLeft className="size-4" aria-hidden />
              </Button>
              <select aria-label="Destination box" className={transferFieldClassName} value={destinationBoxIndex} onChange={event => controller.setDestinationBoxIndex(Number(event.target.value))}>
                {destinationBoxes.map(entry => (
                  <option key={entry.index} value={entry.index}>
                    {entry.index + 1}. {entry.name} · {entry.pokemon.filter(pokemon => !pokemon).length} free
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="icon" className="size-11 rounded-lg" aria-label="Next destination box" disabled={destinationBoxIndex >= destinationBoxes.length - 1} onClick={() => controller.setDestinationBoxIndex(destinationBoxIndex + 1)}>
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm border border-border bg-muted" aria-hidden />
                Existing
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm border border-dashed border-muted-foreground/60" aria-hidden />
                Empty
              </span>
              <span className="flex items-center gap-1.5 text-cyan-800 dark:text-cyan-200">
                <span className="size-2 rounded-sm bg-cyan-600 dark:bg-cyan-400" aria-hidden />
                Your copies
              </span>
            </div>
          </div>
          <div className="grid grid-cols-6 gap-1 bg-background/20 p-2 sm:gap-2 sm:p-3" role="group" aria-label="Destination box preview">
            {box?.pokemon.map((existing, slot) => {
              const incoming = placements.get(slot)
              const pokemon = existing ?? incoming
              let title = `Slot ${slot + 1}: Empty`
              let slotClassName = 'border-dashed border-border/70'
              if (existing) {
                title = `Slot ${slot + 1}: ${existing.nickname} (existing)`
                slotClassName = 'border-border/70 bg-card/40'
              } else if (incoming) {
                title = `Slot ${slot + 1}: ${incoming.nickname} (new copy)`
                slotClassName = 'border-cyan-600 bg-cyan-500/10 dark:border-cyan-400'
              }
              return (
                <div key={slot} title={title} className={`relative flex min-h-20 min-w-0 flex-col items-center justify-center rounded-lg border px-0.5 pb-1.5 pt-4 ${slotClassName}`}>
                  <span className={`absolute left-1 top-1 text-[9px] leading-none tabular-nums ${incoming ? 'text-cyan-800 dark:text-cyan-200' : 'text-muted-foreground'}`}>{String(slot + 1).padStart(2, '0')}</span>
                  {pokemon ? (
                    <>
                      <TransferSprite key={`${slot}-${pokemon.id}-${pokemon.spriteUrl}`} pokemon={pokemon} className={`size-9 max-w-full ${existing ? 'opacity-60' : ''}`} />
                      <span className={`w-full truncate text-center text-[9px] leading-4 sm:text-[10px] ${incoming ? 'font-medium text-cyan-800 dark:text-cyan-100' : 'text-muted-foreground'}`}>{pokemon.nickname}</span>
                    </>
                  ) : (
                    <span className="size-1 rounded-full bg-muted-foreground/30" aria-hidden />
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-start gap-2.5 border-t border-border/60 p-4 text-xs leading-5 text-muted-foreground">
            <Inbox className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{selectedIds.length ? 'Highlighted copies will fill empty slots in this box. Existing Pokémon stay in place.' : 'Choose Pokémon to preview their new slots. Existing Pokémon stay in place.'}</p>
          </div>
        </Card>
      </div>

      <div className="sticky bottom-3 z-20 rounded-xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur-lg sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm" role="status">
            <p className="font-semibold">
              {selectedIds.length} Pokémon selected <span className="font-normal text-muted-foreground">· {free} slots available</span>
            </p>
            <p className={`mt-1 text-xs leading-5 ${selectedIds.length && plan?.error ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground'}`}>{selectionHint}</p>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button type="button" variant="outline" className="h-11 rounded-lg" onClick={() => controller.setStep('files')}>
              Back
            </Button>
            <Button type="button" className={`${transferActionClassName} flex-1 sm:flex-none`} disabled={!controller.canReview} onClick={() => controller.setStep('review')}>
              Review transfer <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
