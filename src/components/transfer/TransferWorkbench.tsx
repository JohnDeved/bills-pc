import { ArrowLeft, ArrowRight, Check, Copy, ShieldCheck } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { TransferFileCard, transferActionClassName } from './TransferParts'
import { TransferComplete, TransferReview } from './TransferReview'
import { TransferSelection } from './TransferSelection'
import type { TransferController, TransferStep } from './types'

const steps: { id: TransferStep; label: string; title: string; description: string }[] = [
  { id: 'files', label: 'Saves', title: 'Choose your two saves', description: 'Bring your original Emerald Pokémon into the Quetzal adventure you’re continuing.' },
  { id: 'choose', label: 'Pokémon', title: 'Choose who comes along', description: 'Pick Pokémon from your Emerald party or PC, then choose a Quetzal box with room for them.' },
  { id: 'review', label: 'Review', title: 'Review your transfer', description: 'Check each destination and the details Quetzal will store differently.' },
  { id: 'complete', label: 'Download', title: 'Transfer complete', description: 'Your Pokémon have a new home. Download the new save to continue your journey.' },
]

export function TransferWorkbench({ controller, onClose }: { controller: TransferController; onClose: () => void }) {
  const currentIndex = steps.findIndex(step => step.id === controller.step)
  const current = steps[currentIndex]!
  const heading = useRef<HTMLDivElement>(null)
  const previousStep = useRef(controller.step)
  const busy = controller.loadingRole !== null || controller.creating
  let filesStatus = controller.canChoose ? 'Both saves are ready.' : 'Choose both saves to continue.'
  if (busy) filesStatus = 'Reading your save…'

  useEffect(() => {
    if (previousStep.current !== controller.step) {
      previousStep.current = controller.step
      heading.current?.focus({ preventScroll: true })
      heading.current?.scrollIntoView({ block: 'start' })
    }
  }, [controller.step])

  return (
    <main className="geist-font mx-auto w-full max-w-6xl space-y-5 text-foreground">
      <header className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest">
              <span className="text-emerald-700 dark:text-emerald-300">Emerald</span>
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="text-cyan-800 dark:text-cyan-200">Quetzal</span>
            </p>
            <h1 className="font-pixel text-base leading-8 sm:text-xl">Transfer Pokémon</h1>
          </div>
          <Button type="button" variant="ghost" className="h-10 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground" disabled={busy} onClick={onClose}>
            <ArrowLeft className="size-4" aria-hidden />
            Back to Bill’s PC
          </Button>
        </div>
        <ol aria-label="Transfer progress" className="grid grid-cols-4 gap-1 rounded-xl border border-border/60 bg-card/40 p-1.5 sm:gap-2">
          {steps.map((step, index) => {
            let buttonClassName = 'text-muted-foreground'
            let numberClassName = 'bg-muted'
            if (index === currentIndex) {
              buttonClassName = 'bg-cyan-500/10 font-semibold text-cyan-800 dark:text-cyan-200'
              numberClassName = 'bg-cyan-600 text-white dark:bg-cyan-300 dark:text-zinc-950'
            } else if (index < currentIndex) {
              buttonClassName = 'text-foreground hover:bg-accent/50'
              numberClassName = 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            }
            return (
              <li key={step.id} aria-current={index === currentIndex ? 'step' : undefined}>
                <button
                  type="button"
                  disabled={busy || index >= currentIndex || controller.step === 'complete'}
                  onClick={() => controller.setStep(step.id)}
                  className={`flex min-h-11 w-full flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-cyan-500 sm:flex-row sm:gap-2 sm:text-sm ${buttonClassName}`}
                >
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ${numberClassName}`}>{index < currentIndex ? <Check className="size-3" strokeWidth={2.5} aria-hidden /> : index + 1}</span>
                  {step.label}
                </button>
              </li>
            )
          })}
        </ol>
      </header>

      <div ref={heading} tabIndex={-1} className="scroll-mt-4 space-y-2 outline-none" aria-labelledby="transfer-step-title">
        <h2 id="transfer-step-title" className="text-xl font-semibold tracking-tight sm:text-2xl">
          {current.title}
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{current.description}</p>
      </div>
      {controller.error && (
        <p role="alert" className="rounded-xl border border-rose-600/25 bg-rose-500/5 p-4 text-sm leading-6 text-rose-800 dark:text-rose-300">
          {controller.error}
        </p>
      )}

      {controller.step === 'files' && (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <TransferFileCard role="source" save={controller.source} error={controller.sourceError} loading={controller.loadingRole === 'source'} disabled={busy} onLoad={controller.loadSource} />
            <TransferFileCard role="destination" save={controller.destination} error={controller.destinationError} loading={controller.loadingRole === 'destination'} disabled={busy} onLoad={controller.loadDestination} />
          </div>
          <div className="grid gap-3 rounded-xl border border-border/60 bg-background/30 p-4 text-sm leading-6 sm:grid-cols-2 sm:p-5">
            <p className="flex items-start gap-2.5">
              <Copy className="mt-1 size-4 shrink-0 text-cyan-700 dark:text-cyan-300" aria-hidden />
              <span>Pokémon are copied into empty PC slots. You’ll review their new locations before transferring.</span>
            </p>
            <p className="flex items-start gap-2.5">
              <ShieldCheck className="mt-1 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
              <span>Your original files stay unchanged. The result is a separate Quetzal save download.</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground" role="status">
              {filesStatus}
            </p>
            <Button type="button" className={`${transferActionClassName} w-full sm:w-auto`} disabled={!controller.canChoose || busy} onClick={() => controller.setStep('choose')}>
              Continue to Pokémon <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        </>
      )}
      {controller.step === 'choose' && <TransferSelection controller={controller} />}
      {controller.step === 'review' && <TransferReview controller={controller} />}
      {controller.step === 'complete' && <TransferComplete controller={controller} />}
    </main>
  )
}
