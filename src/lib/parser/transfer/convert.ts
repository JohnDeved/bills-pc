import type { GameConfig } from '../core/types'
import { VanillaConfig } from '../games/vanilla/config'
import type { QuetzalBoxRecordFields } from '../games/quetzal/storage'
import { transferMetadata, type EmeraldPokemon } from './emerald'
import { quetzalExperience } from './experience'
import type { TransferIssue } from './types'

const sourceConfig = new VanillaConfig()
const statNames = ['HP', 'Attack', 'Defense', 'Speed', 'Sp. Atk', 'Sp. Def']
const identityLimits: Readonly<Record<number, string>> = {
  201: 'Unown forms depend on personality; their mapping to this Quetzal version is not verified',
  265: 'Wurmple evolution depends on personality in Emerald and gender in Quetzal; its evolution branch cannot be guaranteed',
  327: 'Spinda spot patterns depend on personality, which Quetzal compact boxes do not store',
  386: 'Emerald Deoxys uses its Speed Forme; the destination form mapping is not verified',
}

type Mapping = ReadonlyMap<number, { readonly id_name: string }>

function mapByMeaning(raw: number, source: Mapping | undefined, destination: Mapping | undefined, kind: string): number {
  if (raw === 0) return 0
  const name = source?.get(raw)?.id_name
  if (!name) throw new Error(`${kind} ${raw} has no verified Emerald mapping`)
  const matches = [...(destination ?? [])].filter(([, entry]) => entry.id_name === name)
  if (matches.length !== 1) throw new Error(`${kind} ${name.replace(/-/g, ' ')} has no unique, verified Quetzal mapping`)
  return matches[0]![0]
}

export function convertEmeraldPokemon(source: EmeraldPokemon, targetConfig: GameConfig, recordSize: number, sourceId: string): { fields: QuetzalBoxRecordFields; changes: readonly TransferIssue[] } {
  if (identityLimits[source.speciesId]) throw new Error(identityLimits[source.speciesId])
  const changes: TransferIssue[] = []
  const warn = (code: string, message: string) => changes.push({ code, severity: 'warning', message, sourceId })
  // Quetzal's base species 1–898 use National Dex ordering. Restrict the semantic
  // match to those base forms; later form IDs can share an external species ID.
  const speciesMap = new Map([...(targetConfig.mappings?.pokemon ?? [])].filter(([raw, entry]) => raw >= 1 && raw <= 898 && entry.id === raw))
  const species = mapByMeaning(source.rawSpecies, sourceConfig.mappings.pokemon, speciesMap, 'Species')
  const targetSpecies = transferMetadata.quetzal[species]
  if (!targetSpecies) throw new Error('This destination species has no verified ability and stat data')
  const ability = targetSpecies.slice(1).indexOf(source.abilityName)
  if (ability === -1 || ability > 2) throw new Error(`The Emerald ability ${source.abilityName} is not available for this species in Quetzal`)
  const heldItem = sourceConfig.mappings.items.get(source.item)
  if (source.item !== 0 && (!heldItem || heldItem.id === null)) throw new Error(`Held item ${source.item} has no verified mapping`)
  if (heldItem && /^(tm|hm)\d+$/i.test(heldItem.id_name)) throw new Error(`${heldItem.name} cannot be transferred: the move taught by that TM/HM is not verified across these games. Remove it in Emerald first`)
  if (heldItem?.id_name.endsWith('-mail')) throw new Error('Held Mail cannot be transferred with its message. Remove it in Emerald first')
  const item = mapByMeaning(source.item, sourceConfig.mappings.items, targetConfig.mappings?.items, 'Held item')
  const moves = source.moves.map(move => mapByMeaning(move, sourceConfig.mappings.moves, targetConfig.mappings?.moves, 'Move'))
  if (source.ball < 1 || source.ball > 12) throw new Error('The original Poké Ball has no verified Quetzal equivalent')
  const ball = mapByMeaning(source.ball, sourceConfig.mappings.items, targetConfig.mappings?.items, 'Poké Ball')
  if (ball > 27) throw new Error('The original Poké Ball does not map to a Quetzal ball')
  const convertedExperience = quetzalExperience(source.growth, source.experience)
  if (convertedExperience.experience !== source.experience) {
    warn('experience', `Experience changes from ${source.experience.toLocaleString('en-US')} to ${convertedExperience.experience.toLocaleString('en-US')} to keep level ${source.level} on Quetzal's growth curve. Progress to the next level is rounded to the nearest representable value.`)
  }
  const evs = source.evs.map(ev => Math.floor(ev / 4) * 4)
  const changedEVs = evs.flatMap((ev, index) => (ev === source.evs[index] ? [] : [`${statNames[index]} ${source.evs[index]} → ${ev}`]))
  if (changedEVs.length) warn('ev-rounding', `Quetzal stores EVs in steps of 4: ${changedEVs.join(', ')}. Their current contribution to stats is preserved.`)
  const pp = moves.map((move, index) => {
    if (move === 0) return 0
    const maximum = transferMetadata.quetzalMovePP[move]
    if (maximum === undefined) throw new Error(`Move ${move} has no verified Quetzal PP limit`)
    const value = Math.min(source.pp[index]!, maximum)
    if (recordSize === 38 && value !== source.pp[index]) {
      const moveName = sourceConfig.mappings.moves.get(source.moves[index]!)?.name ?? `Move ${index + 1}`
      warn('pp-limit', `${moveName} current PP changes from ${source.pp[index]} to ${value}; Quetzal's box format does not store PP Ups.`)
    }
    return value
  })
  if (recordSize === 21) warn('nickname', `This Quetzal box format has no nickname field. “${source.nickname}” will use its species name in the destination; the Emerald nickname is kept in your original save.`)
  if (source.ppUps.some(value => value !== 0)) warn('pp-ups', 'PP Up upgrades are not stored in Quetzal compact boxes and are not carried over.')
  if (!source.pokemon.isBoxed && source.pokemon.status !== 0) warn('status', 'Current party status conditions are not stored in Quetzal compact boxes and are not carried over.')
  const maxHP = source.speciesId === 292 ? 1 : Math.floor(((2 * targetSpecies[0] + source.ivs[0]! + Math.floor(evs[0]! / 4)) * source.level) / 100) + source.level + 10
  const currentHp = source.pokemon.isBoxed ? maxHP : Math.min(source.pokemon.currentHp, maxHP)
  if (recordSize === 38 && !source.pokemon.isBoxed && currentHp !== source.pokemon.currentHp) warn('hp-limit', `Current HP changes from ${source.pokemon.currentHp} to ${currentHp} to fit the destination's maximum HP.`)
  return {
    fields: {
      species,
      item,
      experience: convertedExperience.experience,
      ball,
      shiny: source.shiny,
      female: source.female,
      moves,
      evs,
      ivs: source.ivs,
      nature: source.nature,
      ability,
      nickname: source.nicknameBytes,
      pp,
      currentHp,
    },
    changes,
  }
}
