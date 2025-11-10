import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

import type { UIPokemonData } from '@/types'

/**
 * Combines and merges Tailwind CSS classes efficiently.
 * Uses clsx for conditional classes and tailwind-merge to resolve conflicts.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats an ID name by replacing hyphens with spaces and capitalizing each word.
 * Example: "fire-blast" -> "Fire Blast"
 */
export const formatIdName = (value?: string | null) => (value ? value.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) : undefined)

/**
 * Formats PP (Power Points) value as a suffix string.
 * Returns empty string if PP is not a valid finite number.
 */
export const formatPpSuffix = (pp: number | null | undefined) => (typeof pp === 'number' && Number.isFinite(pp) ? ` (PP ${pp})` : '')

/**
 * Builds a formatted line of move names for a Pokemon.
 * Returns "None" if no moves are present.
 */
const buildMovesLine = (pokemon: UIPokemonData) => {
  const detailsMoves = pokemon.details?.moves ?? []
  const { moveIds, ppValues: movePps } = pokemon.data

  const MOVE_SLOTS = [0, 1, 2, 3] as const

  const moveLabels = MOVE_SLOTS.map(slotIndex => {
    const detailedMove = detailsMoves[slotIndex]
    if (detailedMove && detailedMove.id !== 0 && detailedMove.name !== 'None') {
      return `${detailedMove.name}${formatPpSuffix(detailedMove.pp)}`
    }

    const moveId = moveIds[slotIndex]
    if (!moveId) return 'None'
    return `Move ${moveId}${formatPpSuffix(movePps[slotIndex])}`
  })

  const meaningfulMoves = moveLabels.filter(label => label !== 'None')
  return meaningfulMoves.length > 0 ? meaningfulMoves.join(' / ') : 'None'
}

/**
 * Builds a formatted text block for a single Pokemon with all its details.
 * Includes species, nickname, level, ability, nature, item, HP, EVs, and moves.
 */
const buildPokemonBlock = (pokemon: UIPokemonData, index: number): string => {
  const speciesName = formatIdName(pokemon.data.nameId) ?? `Species ${pokemon.data.speciesId}`
  const nickname = pokemon.data.nickname || speciesName
  const abilitySlot = pokemon.data.abilityNumber + 1
  const ability = pokemon.details?.abilities?.find(entry => entry.slot === abilitySlot)?.name ?? pokemon.details?.abilities?.[0]?.name ?? `Ability Slot ${abilitySlot}`
  const itemName = pokemon.details?.item?.name ?? formatIdName(pokemon.data.itemIdName) ?? 'None'
  const { nature } = pokemon.data
  const [hpEv = 0, attackEv = 0, defenseEv = 0, speedEv = 0, spAttackEv = 0, spDefenseEv = 0] = pokemon.data.evs
  const evLine = `HP ${hpEv} / Atk ${attackEv} / Def ${defenseEv} / SpA ${spAttackEv} / SpD ${spDefenseEv} / Spe ${speedEv}`
  const hpLine = `${pokemon.data.currentHp}/${pokemon.data.maxHp}`
  const movesLine = buildMovesLine(pokemon)

  const lines = [`${index + 1}. ${nickname} (${speciesName}) Lv. ${pokemon.data.level}`, `   Ability: ${ability}`, `   Nature: ${nature}`, `   Item: ${itemName}`, `   HP: ${hpLine}`, `   EVs: ${evLine}`, `   Moves: ${movesLine}`]

  return lines.join('\n')
}

/**
 * Builds formatted clipboard text for the entire team.
 * Includes header with trainer name (if provided) and formatted blocks for each Pokemon.
 */
export const buildTeamClipboardText = (party: UIPokemonData[], trainerName?: string | null): string => {
  const headerTitle = `Pokemon Team${trainerName ? ` (Trainer: ${trainerName})` : ''}`
  const underline = '='.repeat(Math.max(headerTitle.length, 12))

  if (party.length === 0) {
    return `${headerTitle}\n${underline}\n\nNo Pokemon in party.`
  }

  const blocks = party.map((pokemon, index) => buildPokemonBlock(pokemon, index))
  return `${headerTitle}\n${underline}\n\n${blocks.join('\n\n')}`
}
