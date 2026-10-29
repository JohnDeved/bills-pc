import { PokemonSaveParser } from '../core/PokemonSaveParser'
import type { PokemonBase } from '../core/PokemonBase'
import type { GameConfig, PokemonBox, SaveData } from '../core/types'
import { QuetzalConfig } from '../games/quetzal/config'
import { VanillaConfig } from '../games/vanilla/config'
import { createQuetzalBoxPokemon, QuetzalBoxPokemon, type QuetzalBoxRecordFields } from '../games/quetzal/storage'
import { convertEmeraldPokemon } from './convert'
import { readEmeraldPokemon, type EmeraldPokemon } from './emerald'
import type { TransferCandidate, TransferEntry, TransferGame, TransferIssue, TransferPlan, TransferResult, TransferSession } from './types'

export type { TransferCandidate, TransferEntry, TransferGame, TransferIssue, TransferPlan, TransferResult, TransferSession } from './types'

interface TrustedCandidate {
  readonly display: TransferCandidate
  readonly source?: EmeraldPokemon
}

interface SessionState {
  readonly game: TransferGame
  readonly fileName: string
  readonly bytes: Uint8Array
  readonly parser: PokemonSaveParser
  readonly save: SaveData
  readonly config: GameConfig
  readonly candidates: readonly TrustedCandidate[]
  readonly recordSize?: number
}

interface PreparedPlan {
  readonly plan: TransferPlan
  readonly fields: ReadonlyMap<string, QuetzalBoxRecordFields>
}

const sessions = new WeakMap<TransferSession, SessionState>()
const targetConfig = new QuetzalConfig()
const RECORDS_OFFSET = 0x461
const SLOTS_PER_BOX = 30

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'This Pokémon cannot be transferred safely'
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

function getState(session: TransferSession, expected: TransferGame): SessionState {
  const state = sessions.get(session)
  if (!state || state.game !== expected) throw new Error(`Load a valid ${expected === 'emerald' ? 'Emerald source' : 'Quetzal destination'} save first`)
  return state
}

function candidate(pokemon: PokemonBase, slotIndex: number, boxIndex?: number, boxName?: string): TrustedCandidate {
  const id = boxIndex === undefined ? `party:${slotIndex}` : `box:${boxIndex}:${slotIndex}`
  const location = boxIndex === undefined ? `Party · slot ${slotIndex + 1}` : `${boxName || `Box ${boxIndex + 1}`} · slot ${slotIndex + 1}`
  let source: EmeraldPokemon | undefined
  let blockingReason: string | undefined
  try {
    source = readEmeraldPokemon(pokemon)
    // Layout-independent checks are already visible before selection.
    convertEmeraldPokemon(source, targetConfig, 31, id)
  } catch (error) {
    blockingReason = message(error)
  }
  return {
    source,
    display: {
      id,
      groupId: boxIndex === undefined ? 'party' : `box:${boxIndex}`,
      location,
      boxIndex,
      slotIndex,
      pokemon,
      level: source?.level ?? pokemon.level,
      nickname: source?.nickname ?? pokemon.nickname,
      speciesId: source?.speciesId ?? pokemon.speciesId,
      speciesName: source?.speciesName ?? pokemon.nameId?.replace(/-/g, ' ') ?? `Pokémon ${pokemon.speciesId}`,
      blockingReason,
    },
  }
}

async function parseSnapshot(bytes: Uint8Array, fileName: string, expectedGame: TransferGame): Promise<SessionState> {
  const parser = new PokemonSaveParser()
  const save = await parser.parse(new Uint8Array(bytes).buffer)
  const config = parser.gameConfig
  let actualGame: TransferGame | undefined
  if (config instanceof QuetzalConfig) actualGame = 'quetzal'
  else if (config instanceof VanillaConfig) actualGame = 'emerald'
  if (actualGame !== expectedGame || !config) throw new Error(`Choose a ${expectedGame === 'emerald' ? 'vanilla Pokémon Emerald' : 'Pokémon Quetzal'} save for this side of the transfer`)
  if (!save.boxes || save.box_error) {
    if (expectedGame === 'quetzal') throw new Error('This Quetzal PC layout cannot be identified safely. If every box is empty, deposit one Pokémon in Quetzal and save the game, then reload the save. Other unknown layouts are not supported.')
    throw new Error(save.box_error || 'PC storage is unavailable in this save')
  }
  let recordSize: number | undefined
  if (expectedGame === 'quetzal') {
    const first = save.boxes.flatMap(box => box.pokemon).find(pokemon => pokemon !== null)
    if (!(first instanceof QuetzalBoxPokemon)) throw new Error('The Quetzal box format cannot be identified safely')
    recordSize = first.rawBytes.length
    const expectedBoxes = new Map([
      [21, 67],
      [31, 45],
      [38, 37],
    ]).get(recordSize)
    if (save.boxes.length !== expectedBoxes || save.boxes.some(box => box.pokemon.length !== SLOTS_PER_BOX)) throw new Error('Unsupported Quetzal box dimensions')
  }
  const candidates = expectedGame === 'emerald' ? [...save.party_pokemon.map((pokemon, index) => candidate(pokemon, index)), ...save.boxes.flatMap((box, boxIndex) => box.pokemon.flatMap((pokemon, slotIndex) => (pokemon ? [candidate(pokemon, slotIndex, boxIndex, box.name)] : [])))] : []
  return { game: expectedGame, fileName, bytes: new Uint8Array(bytes), parser, save, config, candidates, recordSize }
}

/** Independent, immutable source snapshots: this never receives a writable file handle. */
export async function loadTransferSave(bytes: Uint8Array | ArrayBuffer, fileName: string, expectedGame: TransferGame): Promise<TransferSession> {
  const original = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  const state = await parseSnapshot(original, fileName, expectedGame)
  // Public Pokémon objects have mutable editor setters. Give the UI a separate
  // parse so changing them cannot change the trusted plan or export.
  const display = await parseSnapshot(original, fileName, expectedGame)
  const session: TransferSession = Object.freeze({
    game: expectedGame,
    fileName,
    playerName: display.save.player_name,
    saveData: display.save,
    candidates: Object.freeze(display.candidates.map(entry => Object.freeze(entry.display))),
  })
  sessions.set(session, state)
  return session
}

function preparePlan(source: SessionState, destination: SessionState, selectedIds: readonly string[], destinationBoxIndex: number): PreparedPlan {
  const issues: TransferIssue[] = []
  const fields = new Map<string, QuetzalBoxRecordFields>()
  const entries: TransferEntry[] = []
  const error = (code: string, text: string, sourceId?: string) => issues.push({ code, severity: 'error', message: text, sourceId })
  const box = Number.isInteger(destinationBoxIndex) ? destination.save.boxes?.[destinationBoxIndex] : undefined
  const emptySlots = box?.pokemon.flatMap((pokemon, index) => (pokemon === null ? [index] : [])) ?? []
  const selected = new Set(selectedIds)
  if (!box) error('destination-box', 'Choose an existing destination box')
  if (selectedIds.length === 0) error('empty-selection', 'Choose at least one Emerald Pokémon to copy')
  if (selected.size !== selectedIds.length) error('duplicate-selection', 'A Pokémon can only be included once in the same transfer')
  if (selectedIds.length > emptySlots.length) error('capacity', `This box has ${emptySlots.length} empty ${emptySlots.length === 1 ? 'slot' : 'slots'} for ${selectedIds.length} selected Pokémon. Choose another box or select fewer Pokémon; transfers never spill into another box.`)
  const byId = new Map(source.candidates.map(entry => [entry.display.id, entry]))
  selectedIds.forEach((id, index) => {
    const entry = byId.get(id)
    if (!entry) {
      error('source-location', 'A selected source location does not contain a Pokémon', id)
      return
    }
    if (entry.display.blockingReason || !entry.source) {
      error('unsupported-pokemon', `${entry.display.nickname}: ${entry.display.blockingReason || 'No valid source record'}`, id)
      return
    }
    try {
      const converted = convertEmeraldPokemon(entry.source, destination.config, destination.recordSize!, id)
      // Validate dimensions and packed ranges during review, before any export.
      createQuetzalBoxPokemon(converted.fields, destination.config, destination.recordSize!)
      fields.set(id, converted.fields)
      issues.push(...converted.changes)
      const slotIndex = emptySlots[index]
      if (slotIndex !== undefined && box)
        entries.push({
          sourceId: id,
          sourceLabel: entry.display.location,
          nickname: entry.display.nickname,
          speciesId: entry.source.speciesId,
          speciesName: entry.source.speciesName,
          level: entry.source.level,
          boxIndex: destinationBoxIndex,
          slotIndex,
          changes: converted.changes,
        })
    } catch (cause) {
      error('unsupported-pokemon', `${entry.display.nickname}: ${message(cause)}`, id)
    }
  })
  if (selectedIds.length > 0) {
    issues.unshift({
      code: 'compact-metadata',
      severity: 'warning',
      message:
        'Quetzal compact boxes do not store the original trainer name/ID, personality ID, language, friendship, met location/level, origin game, Pokérus, contest condition, ribbons, event flags, markings, or PP Up upgrades. These are not carried into the copied Pokémon. Your Emerald save keeps the complete original Pokémon.',
    })
    if (destination.recordSize !== 38)
      issues.push({
        code: 'compact-battle-state',
        severity: 'warning',
        message: 'This Quetzal box format does not store current move PP or HP. Those current battle values are not carried over; their destination values are determined by Quetzal when it loads the Pokémon.',
      })
  }
  const plan: TransferPlan = {
    canTransfer: selectedIds.length > 0 && !issues.some(issue => issue.severity === 'error') && entries.length === selectedIds.length,
    entries,
    issues,
    emptySlots: emptySlots.length,
    selectedCount: selectedIds.length,
    destinationBoxIndex,
    destinationBoxName: box?.name ?? '',
    requiresAcknowledgement: issues.some(issue => issue.severity === 'warning'),
  }
  return { plan, fields }
}

export function planTransfer(source: TransferSession, destination: TransferSession, selectedIds: readonly string[], destinationBoxIndex: number): TransferPlan {
  return preparePlan(getState(source, 'emerald'), getState(destination, 'quetzal'), selectedIds, destinationBoxIndex).plan
}

function verifyOutput(original: SessionState, output: Uint8Array, reparsed: SaveData, entries: readonly TransferEntry[], created: ReadonlyMap<string, QuetzalBoxPokemon>): void {
  if (output.length !== original.bytes.length || reparsed.active_slot !== original.save.active_slot || !reparsed.boxes || reparsed.box_error) throw new Error('The exported save did not reopen with the expected structure')
  if (reparsed.party_pokemon.length !== original.save.party_pokemon.length || reparsed.boxes.length !== original.save.boxes!.length) throw new Error('The exported save changed unrelated Pokémon counts')
  original.save.party_pokemon.forEach((pokemon, index) => {
    if (!sameBytes(pokemon.rawBytes, reparsed.party_pokemon[index]!.rawBytes)) throw new Error('An existing party Pokémon changed during transfer')
  })
  const placements = new Map(entries.map(entry => [`${entry.boxIndex}:${entry.slotIndex}`, entry]))
  original.save.boxes!.forEach((box, boxIndex) => {
    const afterBox = reparsed.boxes![boxIndex]!
    if (box.name !== afterBox.name || box.pokemon.length !== afterBox.pokemon.length) throw new Error('Existing box metadata changed during transfer')
    box.pokemon.forEach((pokemon, slotIndex) => {
      const after = afterBox.pokemon[slotIndex]
      const placement = placements.get(`${boxIndex}:${slotIndex}`)
      if (placement) {
        const expected = created.get(placement.sourceId)
        if (pokemon !== null || !after || !expected || !sameBytes(expected.rawBytes, after.rawBytes) || after.level !== placement.level) throw new Error('A transferred Pokémon failed the export verification')
      } else if (pokemon === null ? after !== null : !after || !sameBytes(pokemon.rawBytes, after.rawBytes)) {
        throw new Error('An existing box slot changed during transfer')
      }
    })
  })
  // Byte-level boundary check: permit only the explicitly selected empty
  // records and the checksums of sections intersecting those records.
  const allowed = new Set<number>()
  const { sectorDataSize, sectorSize } = original.config.saveLayout
  for (const entry of entries) {
    const start = RECORDS_OFFSET + (entry.boxIndex * SLOTS_PER_BOX + entry.slotIndex) * original.recordSize!
    for (let byte = start; byte < start + original.recordSize!; byte++) {
      const section = 5 + Math.floor(byte / sectorDataSize)
      const physical = original.save.sector_map?.get(section)
      if (physical === undefined) throw new Error('A destination PC section is missing')
      allowed.add(physical * sectorSize + (byte % sectorDataSize))
      allowed.add(physical * sectorSize + sectorSize - 10)
      allowed.add(physical * sectorSize + sectorSize - 9)
    }
  }
  for (let index = 0; index < output.length; index++) {
    if (output[index] !== original.bytes[index] && !allowed.has(index)) throw new Error('Transfer attempted to change bytes outside the selected empty slots')
  }
}

/** Recompute from private originals, create atomically, then reopen and verify before returning bytes. */
export async function executeTransfer(source: TransferSession, destination: TransferSession, selectedIds: readonly string[], destinationBoxIndex: number, options: { readonly acknowledgeWarnings: boolean }): Promise<TransferResult> {
  const storedSource = getState(source, 'emerald')
  const storedDestination = getState(destination, 'quetzal')
  const selection = [...selectedIds]
  const freshSource = await parseSnapshot(storedSource.bytes, storedSource.fileName, 'emerald')
  const freshDestination = await parseSnapshot(storedDestination.bytes, storedDestination.fileName, 'quetzal')
  const { plan, fields } = preparePlan(freshSource, freshDestination, selection, destinationBoxIndex)
  if (!plan.canTransfer)
    throw new Error(
      plan.issues
        .filter(issue => issue.severity === 'error')
        .map(issue => issue.message)
        .join('\n') || 'This transfer cannot be completed safely'
    )
  if (plan.requiresAcknowledgement && !options.acknowledgeWarnings) throw new Error('Review and acknowledge the Quetzal format changes before exporting')
  const created = new Map<string, QuetzalBoxPokemon>()
  const boxes: PokemonBox[] = freshDestination.save.boxes!.map(box => ({ name: box.name, pokemon: [...box.pokemon] }))
  for (const entry of plan.entries) {
    const box = boxes[entry.boxIndex]!
    if (box.pokemon[entry.slotIndex] !== null) throw new Error('The destination slot is occupied; no Pokémon was overwritten')
    const pokemon = createQuetzalBoxPokemon(fields.get(entry.sourceId)!, freshDestination.config, freshDestination.recordSize!)
    created.set(entry.sourceId, pokemon)
    const slots = [...box.pokemon]
    slots[entry.slotIndex] = pokemon
    boxes[entry.boxIndex] = { name: box.name, pokemon: slots }
  }
  const output = freshDestination.parser.reconstructSaveFile(freshDestination.save.party_pokemon, boxes)
  const check = await parseSnapshot(output, freshDestination.fileName, 'quetzal')
  verifyOutput(freshDestination, output, check.save, plan.entries, created)
  if (!sameBytes(freshSource.bytes, storedSource.bytes) || !sameBytes(freshDestination.bytes, storedDestination.bytes)) throw new Error('An original save changed during transfer')
  return {
    bytes: output,
    fileName: `${storedDestination.fileName.replace(/\.[^.]+$/, '') || 'quetzal'}-with-emerald-pokemon.sav`,
    plan,
    verification: { sourceUnchanged: true, destinationUnchanged: true, existingPokemonUnchanged: true, outputReparsed: true },
  }
}
