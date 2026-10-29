import { ArrowRight, Check, CheckCheck, Download, FileCheck2, LoaderCircle, Pencil, ShieldCheck } from 'lucide-react'
import { Card } from '@/components/common'
import { Button } from '@/components/ui/button'
import { transferActionClassName, TransferNoticeList, TransferSprite } from './TransferParts'
import type { TransferController } from './types'

function TransferRoute({ controller }: { controller: TransferController }) {
  const box = controller.destinationBoxes.find(entry => entry.index === controller.destinationBoxIndex)
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 bg-background/30 p-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:p-5">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">From Emerald</p>
        <p className="break-all text-sm font-medium">{controller.source?.filename}</p>
        <p className="mt-1 text-xs text-muted-foreground">Trainer {controller.source?.trainerName || 'Unknown'}</p>
      </div>
      <ArrowRight className="hidden size-5 text-muted-foreground sm:block" aria-hidden />
      <div className="min-w-0 border-t border-border/60 pt-3 sm:border-0 sm:pt-0">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-cyan-800 dark:text-cyan-200">Into Quetzal</p>
        <p className="break-all text-sm font-medium">{controller.destination?.filename}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Box {controller.destinationBoxIndex + 1} · {box?.name}
        </p>
      </div>
    </div>
  )
}

export function TransferReview({ controller }: { controller: TransferController }) {
  const { plan } = controller
  const globalMessages = new Set(plan?.notices.map(notice => notice.message))
  const box = controller.destinationBoxes.find(entry => entry.index === controller.destinationBoxIndex)
  return (
    <>
      <TransferRoute controller={controller} />
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="min-w-0 self-start overflow-hidden">
          <div className="border-b border-border/60 p-4 sm:p-5">
            <h3 className="font-semibold">{controller.selectedIds.length} Pokémon ready to copy</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Each copy has a reserved empty slot in {box?.name}.</p>
          </div>
          <ol className="custom-scrollbar divide-y divide-border/60 lg:max-h-[38rem] lg:overflow-y-auto lg:overscroll-contain">
            {plan?.placements.map(placement => {
              const pokemon = controller.candidates.find(candidate => candidate.id === placement.candidateId)
              if (!pokemon) return null
              const notices = pokemon.notices.filter(notice => !globalMessages.has(notice.message))
              return (
                <li key={pokemon.id} className="p-4 sm:px-5">
                  <div className="flex items-center gap-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/30">
                      <TransferSprite key={pokemon.spriteUrl} pokemon={pokemon} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-semibold">{pokemon.nickname}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pokemon.speciesName}
                        {pokemon.level ? ` · Lv.${pokemon.level}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{pokemon.location}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-cyan-500/10 px-2 py-1.5 text-xs font-medium text-cyan-800 dark:text-cyan-200">
                      <ArrowRight className="size-3" aria-hidden />
                      Slot {placement.slot + 1}
                    </span>
                  </div>
                  {notices.length > 0 && (
                    <details open className="mt-3 rounded-lg border border-amber-600/20 bg-amber-500/5 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-amber-900 focus-visible:outline-2 focus-visible:outline-cyan-500 dark:text-amber-200">
                        Review {notices.length} {notices.length === 1 ? 'change' : 'changes'} for {pokemon.nickname}
                      </summary>
                      <div className="mt-3">
                        <TransferNoticeList notices={notices} />
                      </div>
                    </details>
                  )}
                </li>
              )
            })}
          </ol>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="p-4 sm:p-5">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <CheckCheck className="size-5 text-emerald-700 dark:text-emerald-300" aria-hidden />
              What carries over
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">Species, level, IVs, nature, moves, gender and shininess. Compatible abilities and held items are mapped to Quetzal. Nicknames carry over when your destination save supports them; any changes are listed below.</p>
          </Card>
          {Boolean(plan?.notices.length) && (
            <Card className="border-amber-600/25 p-4 sm:p-5">
              <h3 className="mb-2 font-semibold">What Quetzal changes</h3>
              <p className="mb-4 text-sm leading-6 text-muted-foreground">Quetzal stores boxed Pokémon differently. Review these details before continuing.</p>
              <TransferNoticeList notices={plan?.notices ?? []} />
            </Card>
          )}
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-600/20 bg-emerald-500/5 p-4 text-sm leading-6">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
            <p>Your Emerald Pokémon stay in their original save. Existing Quetzal Pokémon stay in place.</p>
          </div>
        </div>
      </div>
      <Card className="space-y-4 p-4 sm:p-5">
        {plan?.requiresAcknowledgement && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-600/25 bg-amber-500/5 p-4 text-sm leading-6">
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-cyan-700 dark:accent-cyan-400" checked={controller.acknowledged} disabled={controller.creating} onChange={event => controller.setAcknowledged(event.target.checked)} />
            <span>I’ve reviewed the Quetzal changes above, including the changes for individual Pokémon.</span>
          </label>
        )}
        {plan?.error && (
          <p role="alert" className="text-sm text-rose-800 dark:text-rose-300">
            {plan.error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-muted-foreground">Create a new Quetzal save file, ready to download.</p>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button type="button" variant="outline" className="h-11 rounded-lg" disabled={controller.creating} onClick={() => controller.setStep('choose')}>
              Back
            </Button>
            <Button type="button" className={`${transferActionClassName} flex-1 sm:flex-none`} disabled={!controller.canCreate || controller.creating} onClick={() => void controller.createTransfer()}>
              {controller.creating ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <FileCheck2 className="size-4" aria-hidden />}
              {controller.creating ? 'Creating save…' : 'Create Quetzal save'}
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}

export function TransferComplete({ controller }: { controller: TransferController }) {
  const { result } = controller
  if (!result) return null
  return (
    <Card className="mx-auto max-w-3xl overflow-hidden">
      <div className="flex flex-col items-center gap-4 border-b border-border/60 p-6 text-center sm:p-8">
        <span className="flex size-16 items-center justify-center rounded-2xl border border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          <Check className="size-8" strokeWidth={2} aria-hidden />
        </span>
        <h3 className="font-pixel text-sm leading-7 sm:text-base">Your Quetzal save is ready</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">{result.pokemonCount} Pokémon</span> copied into <span className="font-semibold text-foreground">{result.boxName}</span>.
        </p>
        <div className="flex max-w-full items-center gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-sm">
          <FileCheck2 className="size-4 shrink-0 text-cyan-700 dark:text-cyan-300" aria-hidden />
          <span className="min-w-0 break-all">{result.filename}</span>
        </div>
        <Button type="button" className={`${transferActionClassName} mt-1 w-full sm:w-auto`} onClick={controller.downloadResult}>
          <Download className="size-4" aria-hidden />
          Download new Quetzal save
        </Button>
        <p className="max-w-lg text-xs leading-5 text-muted-foreground">Load this file with the same version of Quetzal that created your destination save. Keep your original files as backups.</p>
      </div>
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start gap-2.5 text-sm leading-6">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
          <p>Both original save files are unchanged. The transfer is in your new download.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" className="h-11 rounded-lg sm:flex-1" aria-describedby={controller.editorBackupName ? 'editor-backup-note' : undefined} disabled={controller.creating} onClick={() => void controller.openResult()}>
            <Pencil className="size-4" aria-hidden />
            {controller.editorBackupName ? 'Back up current save & open' : 'Open result in editor'}
          </Button>
          {controller.downloadSource && (
            <Button type="button" variant="outline" className="h-11 rounded-lg sm:flex-1" onClick={controller.downloadSource}>
              <Download className="size-4" aria-hidden />
              Download Emerald backup
            </Button>
          )}
        </div>
        {controller.editorBackupName && (
          <p id="editor-backup-note" className="text-xs leading-5 text-muted-foreground">
            Opening the result first downloads <span className="break-all font-medium text-foreground">{controller.editorBackupName}</span>, including your edits from when this transfer started, before replacing the open save in the editor.
          </p>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-4">
          <p className="text-xs leading-5 text-muted-foreground">To copy another batch, open this result in the editor first.</p>
          <button type="button" className="min-h-9 shrink-0 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-cyan-500" onClick={controller.reset}>
            Start over
          </button>
        </div>
      </div>
    </Card>
  )
}
