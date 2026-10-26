import { PokemonBase } from '../../core/PokemonBase'
import type { GameConfig, PokemonBox, PokemonStorage } from '../../core/types'
import { bytesToGbaString, natures } from '../../core/utils'

// Quetzal's PC is a separate bit-packed format, not a shortened party record.
// Format evidence: https://github.com/LirouVictor/savDex/blob/main/CLAUDE.md
// ("Formato do save (Quetzal)"). The implementation below preserves unknown
// fields and changes only the bits exposed by the editor.
const RECORDS_OFFSET = 0x461
const SLOTS_PER_BOX = 30
const FORMATS = [
  { size: 21, boxes: 67, nicknameOffset: null, ppOffset: null },
  { size: 31, boxes: 45, nicknameOffset: 21, ppOffset: null },
  { size: 38, boxes: 37, nicknameOffset: 28, ppOffset: 24 },
] as const
type StorageFormat = (typeof FORMATS)[number]

function readText(bytes: Uint8Array): string {
  const terminator = bytes.indexOf(0xff)
  return bytesToGbaString(terminator === -1 ? bytes : bytes.subarray(0, terminator))
}

function readField(bytes: Uint8Array, start: number, width: number): number {
  let result = 0
  for (let bit = 0; bit < width; bit++) {
    const position = start + bit
    result += ((bytes[position >>> 3]! >>> (position & 7)) & 1) * 2 ** bit
  }
  return result
}

function writeField(bytes: Uint8Array, start: number, width: number, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= 2 ** width) throw new Error('Value does not fit the Quetzal box field')
  for (let bit = 0; bit < width; bit++) {
    const position = start + bit
    const mask = 1 << (position & 7)
    const offset = position >>> 3
    bytes[offset] = (bytes[offset]! & ~mask) | (((value >>> bit) & 1) << (position & 7))
  }
}

function bounded(value: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('Pokémon values must be finite numbers')
  return Math.max(0, Math.min(maximum, Math.trunc(value)))
}

function detectFormat(storage: Uint8Array): StorageFormat {
  const candidates = FORMATS.filter(format => {
    if (RECORDS_OFFSET + format.boxes * SLOTS_PER_BOX * format.size > storage.length) return false
    let occupied = 0
    for (let slot = 0; slot < format.boxes * SLOTS_PER_BOX; slot++) {
      const offset = RECORDS_OFFSET + slot * format.size
      const record = storage.subarray(offset, offset + format.size)
      if (record.every(byte => byte === 0)) continue
      const species = readField(record, 0, 11)
      // A wrong stride must not be accepted just because some records look
      // plausible. Empty records are entirely zero in the supported layouts.
      if (species < 1 || species > 1528 || readField(record, 21, 17) > 105986 || readField(record, 161, 5) > 24 || readField(record, 166, 2) > 2) return false
      for (let move = 0; move < 4; move++) {
        if (readField(record, 48 + move * 10, 10) > 848) return false
      }
      occupied++
    }
    return occupied > 0
  })
  if (candidates.length !== 1) {
    throw new Error('The Quetzal PC format could not be identified safely. Its stored Pokémon are unchanged; party editing is available.')
  }
  return candidates[0]!
}

export class QuetzalBoxPokemon extends PokemonBase {
  private readonly record: Uint8Array

  constructor(
    record: Uint8Array,
    config: GameConfig,
    private readonly format: StorageFormat
  ) {
    // PokemonBase supplies the shared derived-stat cache. All persistent
    // accessors below use the compact record, never the temporary party view.
    super(new Uint8Array(config.pokemonSize), config, true)
    if (record.length !== format.size) throw new Error('Invalid Quetzal box record length')
    this.record = new Uint8Array(record)
  }

  override get rawBytes() {
    return new Uint8Array(this.record)
  }
  override get experience() {
    return readField(this.record, 21, 17) * 10
  }
  override get boxGrowthRate() {
    return 'medium-slow'
  }
  override get evStep() {
    return 4
  }
  override get hasStoredPP() {
    return this.format.ppOffset !== null
  }

  override get level() {
    // Quetzal uses Medium Slow for every species, including species whose
    // vanilla games use a different growth curve. No API request is needed.
    let level = 1
    for (let candidate = 2; candidate <= 100; candidate++) {
      const threshold = Math.floor((6 * candidate ** 3) / 5) - 15 * candidate ** 2 + 100 * candidate - 140
      if (threshold > this.experience) break
      level = candidate
    }
    return level
  }

  override get speciesId() {
    const raw = readField(this.record, 0, 11)
    return this.config.mappings?.pokemon?.get(raw)?.id ?? raw
  }
  override get nameId() {
    return this.config.mappings?.pokemon?.get(readField(this.record, 0, 11))?.id_name
  }
  override get nickname() {
    const offset = this.format.nicknameOffset
    const nickname = offset === null ? '' : readText(this.record.subarray(offset, offset + 10))
    return nickname.trim() || this.nameId?.replace(/-/g, ' ').toUpperCase() || `Pokémon ${this.speciesId}`
  }
  // Compact records do not store original trainer identity.
  override get otName() {
    return ''
  }
  override get otId_str() {
    return ''
  }

  override get item() {
    const raw = readField(this.record, 11, 10)
    return this.config.mappings?.items?.get(raw)?.id ?? raw
  }
  override get itemIdName() {
    return this.config.mappings?.items?.get(readField(this.record, 11, 10))?.id_name
  }
  override setItem(value: number | null): void {
    const external = value ?? 0
    let raw = external
    for (const [id, item] of this.config.mappings?.items ?? []) {
      if (item.id === external) {
        raw = id
        break
      }
    }
    writeField(this.record, 11, 10, raw)
  }

  private readMove(index: number): number {
    const raw = readField(this.record, 48 + 10 * index, 10)
    return this.config.mappings?.moves?.get(raw)?.id ?? raw
  }
  private readPP(index: number): number {
    return this.format.ppOffset === null ? 0 : this.record[this.format.ppOffset + index]!
  }
  override get move1() {
    return this.readMove(0)
  }
  override get move2() {
    return this.readMove(1)
  }
  override get move3() {
    return this.readMove(2)
  }
  override get move4() {
    return this.readMove(3)
  }
  override get pp1() {
    return this.readPP(0)
  }
  override get pp2() {
    return this.readPP(1)
  }
  override get pp3() {
    return this.readPP(2)
  }
  override get pp4() {
    return this.readPP(3)
  }

  private readEv(index: number): number {
    return readField(this.record, 88 + 6 * index, 6) * 4
  }
  private writeEv(index: number, value: number): void {
    writeField(this.record, 88 + 6 * index, 6, Math.floor(bounded(value, 252) / 4))
  }
  override get hpEV() {
    return this.readEv(0)
  }
  override set hpEV(value: number) {
    this.writeEv(0, value)
  }
  override get atkEV() {
    return this.readEv(1)
  }
  override set atkEV(value: number) {
    this.writeEv(1, value)
  }
  override get defEV() {
    return this.readEv(2)
  }
  override set defEV(value: number) {
    this.writeEv(2, value)
  }
  override get speEV() {
    return this.readEv(3)
  }
  override set speEV(value: number) {
    this.writeEv(3, value)
  }
  override get spaEV() {
    return this.readEv(4)
  }
  override set spaEV(value: number) {
    this.writeEv(4, value)
  }
  override get spdEV() {
    return this.readEv(5)
  }
  override set spdEV(value: number) {
    this.writeEv(5, value)
  }

  override get ivs(): readonly number[] {
    return Array.from({ length: 6 }, (_, index) => readField(this.record, 124 + 5 * index, 5))
  }
  override set ivs(values: readonly number[]) {
    if (values.length !== 6) throw new Error('IVs array must have 6 values')
    const normalized = values.map(value => bounded(value, 31))
    normalized.forEach((value, index) => writeField(this.record, 124 + 5 * index, 5, value))
  }

  override get nature() {
    return natures[this.natureRaw]!
  }
  override get natureRaw() {
    return readField(this.record, 161, 5)
  }
  override set natureRaw(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 24) throw new Error('Nature must be between 0 and 24')
    writeField(this.record, 161, 5, value)
  }
  override get abilityNumber() {
    return readField(this.record, 166, 2)
  }
  override set abilityNumber(value: number) {
    writeField(this.record, 166, 2, bounded(value, 2))
  }
  override get isShiny() {
    return readField(this.record, 44, 1) === 1
  }
  override get shinyNumber() {
    return this.isShiny ? 1 : 0
  }
  override get isRadiant() {
    return false
  }
  override get currentHp() {
    return this.format.size === 38 ? readField(this.record, 168, 16) : super.currentHp
  }
}

export function parseQuetzalStorage(storage: Uint8Array, config: GameConfig): PokemonStorage {
  const format = detectFormat(storage)
  const boxes = Array.from(
    { length: format.boxes },
    (_, box): PokemonBox => ({
      name: readText(storage.subarray(1 + box * 9, 1 + (box + 1) * 9)) || `BOX${box + 1}`,
      pokemon: Array.from({ length: SLOTS_PER_BOX }, (_, slot) => {
        const offset = RECORDS_OFFSET + (box * SLOTS_PER_BOX + slot) * format.size
        const record = storage.subarray(offset, offset + format.size)
        return readField(record, 0, 11) === 0 ? null : new QuetzalBoxPokemon(record, config, format)
      }),
    })
  )
  return { boxes, currentBox: Math.min(storage[0]!, format.boxes - 1) }
}

export function writeQuetzalStorage(storage: Uint8Array, boxes: readonly PokemonBox[]): Uint8Array {
  const format = detectFormat(storage)
  if (boxes.length !== format.boxes) throw new Error('Quetzal box count changed')
  const result = new Uint8Array(storage)
  boxes.forEach((box, boxIndex) => {
    if (box.pokemon.length !== SLOTS_PER_BOX) throw new Error('Quetzal box slot count changed')
    box.pokemon.forEach((pokemon, slot) => {
      const offset = RECORDS_OFFSET + (boxIndex * SLOTS_PER_BOX + slot) * format.size
      // Editing existing occupants only. Never turn an incompatible record
      // into an empty slot or overwrite a differently sized storage layout.
      if (!pokemon) {
        if (readField(storage.subarray(offset, offset + format.size), 0, 11) !== 0) throw new Error('Removing boxed Pokémon is not supported')
        return
      }
      if (!(pokemon instanceof QuetzalBoxPokemon) || pokemon.rawBytes.length !== format.size) throw new Error('Incompatible Quetzal box Pokémon')
      result.set(pokemon.rawBytes, offset)
    })
  })
  return result
}
