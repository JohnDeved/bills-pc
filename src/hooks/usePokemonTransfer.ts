import { saveAs } from 'file-saver'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TransferController, TransferNotice, TransferPokemonView, TransferSaveView, TransferStep } from '@/components/transfer/types'
import type { PokemonBase } from '@/lib/parser/core/PokemonBase'
import { executeTransfer, loadTransferSave, planTransfer } from '@/lib/parser/transfer'
import type { TransferGame, TransferResult, TransferSession } from '@/lib/parser/transfer/types'
import { useSaveFileStore } from '@/stores'

type Role = 'source' | 'destination'
interface Snapshot {
  role: Role
  fileName: string
  bytes?: Uint8Array
  error?: string
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not read this save. Please choose a supported save file.'
}

/** Capture current edits once; the workbench never borrows the editor's parser or write handle. */
function currentSnapshot(): Snapshot | null {
  const { parser, saveData } = useSaveFileStore.getState()
  if (!parser || !saveData || parser.isInMemoryMode()) return null
  const game = parser.getGameConfig()?.name
  let role: Role | null = null
  if (game === 'Pokemon Emerald (Vanilla)') role = 'source'
  if (game === 'Pokemon Quetzal') role = 'destination'
  if (!role) return null
  const fileName = parser.saveFileName || (role === 'source' ? 'emerald.sav' : 'quetzal.sav')
  try {
    return { role, fileName, bytes: new Uint8Array(parser.reconstructSaveFile(saveData.party_pokemon, saveData.boxes)) }
  } catch (error) {
    return { role, fileName, error: message(error) }
  }
}

function pokemonView(pokemon: PokemonBase, id: string, level?: number, speciesName?: string): TransferPokemonView {
  const shiny = pokemon.isShiny ? '/shiny' : ''
  const name = pokemon.nameId ?? `pokemon-${pokemon.speciesId}`
  return {
    id,
    nickname: pokemon.nickname,
    speciesName: speciesName ?? name.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
    level: level ?? pokemon.level,
    spriteUrl: `/sprites${shiny}/${name}.gif`,
    spriteFallbackUrl: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon${shiny}/${pokemon.speciesId}.png`,
  }
}

function saveView(session: TransferSession | null, fromCurrentSave: boolean): TransferSaveView | null {
  if (!session) return null
  return {
    filename: session.fileName,
    gameName: session.game === 'emerald' ? 'Pokémon Emerald' : 'Pokémon Quetzal',
    trainerName: session.playerName,
    pokemonCount: session.saveData.party_pokemon.length + (session.saveData.boxes ?? []).reduce((count, box) => count + box.pokemon.filter(Boolean).length, 0),
    boxCount: session.saveData.boxes?.length ?? 0,
    fromCurrentSave,
  }
}

function download(bytes: Uint8Array, fileName: string) {
  saveAs(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }), fileName)
}

function backupName(fileName: string, suffix = 'backup'): string {
  return `${fileName.replace(/\.[^.]+$/, '') || 'pokemon-save'}-${suffix}.sav`
}

export function usePokemonTransfer(onOpenResult: (result: TransferResult) => Promise<void>): TransferController {
  const [initial] = useState(currentSnapshot)
  const [step, updateStep] = useState<TransferStep>('files')
  const [source, setSource] = useState<TransferSession | null>(null)
  const [destination, setDestination] = useState<TransferSession | null>(null)
  const [sourceFromEditor, setSourceFromEditor] = useState(false)
  const [destinationFromEditor, setDestinationFromEditor] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [destinationError, setDestinationError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState({ source: false, destination: false })
  const [selectedIds, updateSelectedIds] = useState<string[]>([])
  const [destinationBoxIndex, updateDestinationBoxIndex] = useState(0)
  const [acknowledged, updateAcknowledged] = useState(false)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<TransferResult | null>(null)
  const mounted = useRef(true)
  const sequence = useRef({ source: 0, destination: 0 })
  const busy = useRef(false)
  const sourceBackup = useRef<{ bytes: Uint8Array; fileName: string } | null>(null)

  const invalidate = useCallback(() => {
    updateAcknowledged(false)
    setResult(null)
    setError(null)
  }, [])

  const load = useCallback(
    async (role: Role, input: File | Snapshot) => {
      if (busy.current) return
      const token = ++sequence.current[role]
      const active = () => mounted.current && sequence.current[role] === token
      setLoading(previous => ({ ...previous, [role]: true }))
      invalidate()
      updateSelectedIds([])
      updateStep('files')
      if (role === 'source') {
        setSource(null)
        setSourceError(null)
        sourceBackup.current = null
      } else {
        setDestination(null)
        setDestinationError(null)
      }
      try {
        const fromEditor = !(input instanceof File)
        if (fromEditor && input.error) throw new Error(input.error)
        const fileName = fromEditor ? input.fileName : input.name
        const inputBytes = fromEditor ? input.bytes : new Uint8Array(await input.arrayBuffer())
        if (!inputBytes) throw new Error('The current save could not be captured. Choose a save file instead.')
        const bytes = new Uint8Array(inputBytes)
        const game: TransferGame = role === 'source' ? 'emerald' : 'quetzal'
        const session = await loadTransferSave(bytes, fileName, game)
        if (!active()) return
        if (role === 'source') {
          sourceBackup.current = { bytes: new Uint8Array(bytes), fileName }
          setSource(session)
          setSourceFromEditor(fromEditor)
        } else {
          setDestination(session)
          setDestinationFromEditor(fromEditor)
          const firstWithRoom = session.saveData.boxes?.findIndex(box => box.pokemon.some(pokemon => !pokemon)) ?? -1
          updateDestinationBoxIndex(Math.max(0, firstWithRoom))
        }
      } catch (error) {
        if (active()) (role === 'source' ? setSourceError : setDestinationError)(message(error))
      } finally {
        if (active()) setLoading(previous => ({ ...previous, [role]: false }))
      }
    },
    [invalidate]
  )

  useEffect(() => {
    mounted.current = true
    // An early manual choice wins over prefill. Keep pending reads across
    // StrictMode's simulated teardown; real unmounts remain inactive.
    if (initial && sequence.current[initial.role] === 0) void load(initial.role, initial)
    return () => {
      mounted.current = false
    }
  }, [initial, load])

  const candidates = useMemo(
    () =>
      (source?.candidates ?? []).map(candidate => ({
        ...pokemonView(candidate.pokemon, candidate.id, candidate.level, candidate.speciesName),
        nickname: candidate.nickname,
        groupId: candidate.groupId,
        location: candidate.location,
        canTransfer: !candidate.blockingReason,
        notices: candidate.blockingReason ? [{ severity: 'error' as const, message: candidate.blockingReason }] : [],
      })),
    [source]
  )

  const sourceGroups = useMemo(
    () =>
      source
        ? [
            { id: 'party', name: 'Party', count: source.candidates.filter(candidate => candidate.groupId === 'party').length },
            ...(source.saveData.boxes ?? []).map((box, index) => ({
              id: `box:${index}`,
              name: `${index + 1}. ${box.name}`,
              count: source.candidates.filter(candidate => candidate.groupId === `box:${index}`).length,
            })),
          ]
        : [],
    [source]
  )

  const destinationBoxes = useMemo(
    () =>
      (destination?.saveData.boxes ?? []).map((box, index) => ({
        index,
        name: box.name,
        pokemon: box.pokemon.map((pokemon, slot) => (pokemon ? pokemonView(pokemon, `destination:${index}:${slot}`) : null)),
      })),
    [destination]
  )

  const plan = useMemo(() => {
    if (!source || !destination) return null
    try {
      const planned = planTransfer(source, destination, selectedIds, destinationBoxIndex)
      const seen = new Set<string>()
      const notices: TransferNotice[] = []
      const candidateNotices = new Map<string, TransferNotice[]>()
      let error: string | undefined
      for (const issue of [...planned.issues, ...planned.entries.flatMap(entry => entry.changes)]) {
        const key = `${issue.sourceId ?? ''}:${issue.code}:${issue.message}`
        if (seen.has(key)) continue
        seen.add(key)
        if (issue.severity === 'error') error ??= issue.message
        if (issue.sourceId) {
          const previous = candidateNotices.get(issue.sourceId) ?? []
          candidateNotices.set(issue.sourceId, [...previous, issue])
        } else notices.push(issue)
      }
      return {
        canTransfer: planned.canTransfer,
        placements: planned.entries.map(entry => ({ candidateId: entry.sourceId, boxIndex: entry.boxIndex, slot: entry.slotIndex })),
        notices,
        candidateNotices,
        requiresAcknowledgement: planned.requiresAcknowledgement,
        error,
      }
    } catch (error) {
      return { canTransfer: false, placements: [], notices: [], requiresAcknowledgement: false, error: message(error) }
    }
  }, [source, destination, selectedIds, destinationBoxIndex])

  let loadingRole: Role | null = null
  if (loading.destination) loadingRole = 'destination'
  if (loading.source) loadingRole = 'source'
  const canChoose = !!source && !!destination && !loadingRole && !creating
  const canReview = canChoose && selectedIds.length > 0 && !!plan?.canTransfer
  const canCreate = step === 'review' && canReview && (!plan?.requiresAcknowledgement || acknowledged)

  const setSelectedIds = (ids: string[]) => {
    if (busy.current) return
    invalidate()
    updateSelectedIds([...new Set(ids)])
  }
  const setDestinationBoxIndex = (index: number) => {
    if (busy.current) return
    invalidate()
    updateDestinationBoxIndex(index)
  }
  const setStep = (next: TransferStep) => {
    if (busy.current || loadingRole || step === 'complete') return
    if (next === 'files' || (next === 'choose' && canChoose) || (next === 'review' && canReview)) {
      updateStep(next)
      setError(null)
      if (next !== 'review') updateAcknowledged(false)
    }
  }
  const createTransfer = async () => {
    if (busy.current || !canCreate || !source || !destination) return
    busy.current = true
    setCreating(true)
    setError(null)
    try {
      const created = await executeTransfer(source, destination, selectedIds, destinationBoxIndex, { acknowledgeWarnings: acknowledged })
      if (mounted.current) {
        setResult(created)
        updateStep('complete')
      }
    } catch (error) {
      if (mounted.current) setError(message(error))
    } finally {
      busy.current = false
      if (mounted.current) setCreating(false)
    }
  }
  const openResult = async () => {
    if (!result || busy.current) return
    busy.current = true
    setCreating(true)
    setError(null)
    try {
      // The initial editor may have edits even if either wizard file was replaced.
      // Download its complete snapshot in this click before replacing the editor.
      if (initial) {
        if (!initial.bytes) throw new Error('The current editor could not be backed up. Download the new Quetzal save and return to your current save before opening it.')
        download(initial.bytes, backupName(initial.fileName, 'before-transfer'))
      }
      await onOpenResult(result)
    } catch (error) {
      if (mounted.current) setError(message(error))
    } finally {
      busy.current = false
      if (mounted.current) setCreating(false)
    }
  }
  const reset = () => {
    if (busy.current) return
    sequence.current.source++
    sequence.current.destination++
    setLoading({ source: false, destination: false })
    setSource(null)
    setDestination(null)
    setSourceError(null)
    setDestinationError(null)
    sourceBackup.current = null
    updateSelectedIds([])
    updateDestinationBoxIndex(0)
    invalidate()
    updateStep('files')
  }

  return {
    step,
    source: saveView(source, sourceFromEditor),
    destination: saveView(destination, destinationFromEditor),
    sourceError,
    destinationError,
    error,
    loadingRole,
    creating,
    candidates: candidates.map(candidate => ({ ...candidate, notices: [...candidate.notices, ...(plan?.candidateNotices?.get(candidate.id) ?? [])] })),
    sourceGroups,
    selectedIds,
    destinationBoxes,
    destinationBoxIndex,
    plan,
    acknowledged,
    result: result
      ? {
          filename: result.fileName,
          pokemonCount: result.plan.entries.length,
          boxName: result.plan.destinationBoxName,
          placements: result.plan.entries.map(entry => ({ candidateId: entry.sourceId, boxIndex: entry.boxIndex, slot: entry.slotIndex })),
        }
      : null,
    canChoose,
    canReview,
    canCreate,
    editorBackupName: initial ? backupName(initial.fileName, 'before-transfer') : undefined,
    loadSource: file => load('source', file),
    loadDestination: file => load('destination', file),
    setSelectedIds,
    setDestinationBoxIndex,
    setAcknowledged: value => {
      if (!busy.current) updateAcknowledged(value)
    },
    setStep,
    createTransfer,
    downloadResult: () => {
      if (result) download(result.bytes, result.fileName)
    },
    downloadSource: source
      ? () => {
          const backup = sourceBackup.current
          if (backup) download(backup.bytes, backupName(backup.fileName))
        }
      : undefined,
    openResult,
    reset,
  }
}
