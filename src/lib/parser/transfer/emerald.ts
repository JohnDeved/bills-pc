import { PokemonBase } from '../core/PokemonBase'
import { bytesToGbaString } from '../core/utils'
import { VanillaConfig } from '../games/vanilla/config'
import charMap from '../data/pokemon_charmap.json'
import metadata from './metadata.json'
import { levelForExperience } from './experience'

type EmeraldSpecies = readonly [nationalId: number, growth: number, genderThreshold: number, ability1: string, ability2: string | null, baseHP: number]
type QuetzalSpecies = readonly [baseHP: number, ability1: string, ability2: string | null, hiddenAbility: string | null]

export const transferMetadata = metadata as unknown as {
  readonly emerald: Readonly<Record<string, EmeraldSpecies>>
  readonly quetzal: Readonly<Record<string, QuetzalSpecies>>
  readonly emeraldMovePP: Readonly<Record<string, number>>
  readonly quetzalMovePP: Readonly<Record<string, number>>
}

const config = new VanillaConfig()

class EmeraldReader extends PokemonBase {
  block(index: number): DataView {
    const bytes = this.getDecryptedSubstruct(this.data, index)
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
}

export interface EmeraldPokemon {
  readonly raw: Uint8Array
  readonly rawSpecies: number
  readonly speciesId: number
  readonly speciesName: string
  readonly speciesNameId: string
  readonly nickname: string
  readonly nicknameBytes: Uint8Array
  readonly pokemon: PokemonBase
  readonly level: number
  readonly growth: number
  readonly experience: number
  readonly item: number
  readonly moves: readonly number[]
  readonly pp: readonly number[]
  readonly ppUps: readonly number[]
  readonly evs: readonly number[]
  readonly ivs: readonly number[]
  readonly ball: number
  readonly female: boolean
  readonly shiny: boolean
  readonly nature: number
  readonly abilityName: string
}

/** Read the encrypted source without modifying either its cached data or its bytes. */
export function readEmeraldPokemon(original: PokemonBase): EmeraldPokemon {
  const raw = original.rawBytes
  const pokemon = new EmeraldReader(raw, config, original.isBoxed)
  if (!pokemon.hasValidEncryptionChecksum || (raw[0x13]! & 1) !== 0) throw new Error('This Pokémon has a damaged checksum or is a Bad Egg')
  const growth = pokemon.block(0)
  const attacks = pokemon.block(1)
  const effort = pokemon.block(2)
  const misc = pokemon.block(3)
  const ivWord = misc.getUint32(4, true)
  if ((raw[0x13]! & 4) !== 0 || (ivWord & 0x40000000) !== 0) throw new Error('Eggs cannot be transferred safely into Quetzal compact boxes')
  const rawSpecies = growth.getUint16(0, true)
  const info = transferMetadata.emerald[rawSpecies]
  const mapping = config.mappings.pokemon.get(rawSpecies)
  if (!info || !mapping || mapping.id !== info[0]) throw new Error(`Emerald species ${rawSpecies} does not have a verified species mapping`)
  const experience = growth.getUint32(4, true)
  const level = levelForExperience(info[1], experience)
  if (!pokemon.isBoxed && pokemon.level !== level) throw new Error('The party level and experience disagree; this Pokémon cannot be transferred safely')
  const nicknameBytes = raw.slice(8, 18)
  const terminator = nicknameBytes.indexOf(0xff)
  const textBytes = terminator === -1 ? nicknameBytes : nicknameBytes.subarray(0, terminator)
  if (raw[0x12] === 1 || textBytes.some(byte => byte >= 0xf7 || charMap[String(byte) as keyof typeof charMap] === undefined)) {
    throw new Error('This nickname uses an unsupported character encoding; its text cannot be preserved safely')
  }
  const ability = (ivWord >>> 31) & 1
  const abilityName = info[3 + ability]
  if (typeof abilityName !== 'string' || !abilityName) throw new Error('The selected Emerald ability slot is empty and cannot be mapped safely')
  const moves = Array.from({ length: 4 }, (_, index) => attacks.getUint16(index * 2, true))
  const pp = Array.from({ length: 4 }, (_, index) => attacks.getUint8(8 + index))
  const ppUps = Array.from({ length: 4 }, (_, index) => (growth.getUint8(8) >>> (index * 2)) & 3)
  moves.forEach((move, index) => {
    if (move === 0) {
      if (pp[index] !== 0 || ppUps[index] !== 0) throw new Error('An empty move slot contains PP data and cannot be transferred safely')
      return
    }
    const basePP = transferMetadata.emeraldMovePP[move]
    if (basePP === undefined || !config.mappings.moves.has(move)) throw new Error(`Move ${move} has no verified Emerald move mapping`)
    const maximum = basePP + Math.floor((basePP * ppUps[index]!) / 5)
    if (pp[index]! > maximum) throw new Error(`Move ${move} has invalid PP and cannot be transferred safely`)
  })
  const evs = Array.from({ length: 6 }, (_, index) => effort.getUint8(index))
  if (evs.reduce((total, ev) => total + ev, 0) > 510) throw new Error('Total Emerald EVs exceed 510 and cannot be transferred safely')
  if (!pokemon.isBoxed && pokemon.currentHp > pokemon.maxHp) throw new Error('Current HP exceeds maximum HP')
  return {
    raw,
    rawSpecies,
    speciesId: info[0],
    speciesName: mapping.name,
    speciesNameId: mapping.id_name,
    nickname: bytesToGbaString(textBytes).trim() || mapping.name,
    nicknameBytes,
    pokemon,
    level,
    growth: info[1],
    experience,
    item: growth.getUint16(2, true),
    moves,
    pp,
    ppUps,
    evs,
    ivs: Array.from({ length: 6 }, (_, index) => (ivWord >>> (index * 5)) & 31),
    ball: (misc.getUint16(2, true) >>> 11) & 15,
    female: info[2] === 254 || (info[2] !== 255 && info[2] !== 0 && (pokemon.personality & 0xff) < info[2]),
    shiny: pokemon.isShiny,
    nature: pokemon.personality % 25,
    abilityName,
  }
}
