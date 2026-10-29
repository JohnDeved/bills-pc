import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type BoxGame = 'emerald' | 'quetzal'

export function readSaveFixture(game: BoxGame): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../lib/parser/__tests__/test_data', `${game}.sav`)))
}

/**
 * The checked-in Emerald save has an empty PC. Deposit its actual Treecko record
 * into three slots, including a sector boundary and the last slot, without using
 * the parser under test. The original party, backup slot and emulator trailer
 * remain untouched. Quetzal's fixture already contains real boxed Pokémon.
 */
export function loadBoxSave(game: BoxGame): Uint8Array<ArrayBuffer> {
  const bytes = readSaveFixture(game)
  if (game === 'quetzal') return bytes

  const view = new DataView(bytes.buffer)
  const start = view.getUint32(14 * 4096 + 0xffc, true) > view.getUint32(0xffc, true) ? 14 : 0
  const sections = new Map<number, number>()
  for (let sector = start; sector < start + 14; sector++) {
    sections.set(view.getUint16(sector * 4096 + 0xff4, true), sector * 4096)
  }
  const partyOffset = sections.get(1)! + 0x238
  const treecko = bytes.slice(partyOffset, partyOffset + 80)
  const storage = new Uint8Array(0x83d0)
  for (let section = 5; section <= 13; section++) {
    const length = section === 13 ? 0x7d0 : 0xf80
    storage.set(bytes.subarray(sections.get(section)!, sections.get(section)! + length), (section - 5) * 0xf80)
  }
  for (const slot of [0, 49, 419]) storage.set(treecko, 4 + slot * 80)
  for (let section = 5; section <= 13; section++) {
    const offset = sections.get(section)!
    const length = section === 13 ? 0x7d0 : 0xf80
    bytes.set(storage.subarray((section - 5) * 0xf80, (section - 5) * 0xf80 + length), offset)
    let sum = 0
    for (let index = 0; index < length; index += 4) sum = (sum + view.getUint32(offset + index, true)) >>> 0
    view.setUint16(offset + 0xff6, ((sum & 0xffff) + (sum >>> 16)) & 0xffff, true)
  }
  return bytes
}

// Deterministic API responses keep integration tests independent of PokeAPI uptime.
export function pokemonApiResponse(url: string): unknown {
  const { pathname } = new URL(url)
  if (pathname.includes('/pokemon-species/')) return { growth_rate: { url: 'https://pokeapi.co/api/v2/growth-rate/4/' }, varieties: [] }
  if (pathname.includes('/growth-rate/')) {
    return {
      levels: Array.from({ length: 101 }, (_, level) => ({
        level,
        experience: Math.max(0, Math.floor((6 * level ** 3) / 5) - 15 * level ** 2 + 100 * level - 140),
      })),
    }
  }
  if (pathname.includes('/pokemon/')) {
    const id = Number(pathname.split('/').filter(Boolean).at(-1))
    return {
      id,
      species: { url: `https://pokeapi.co/api/v2/pokemon-species/${id}/` },
      stats: ['hp', 'attack', 'defense', 'speed', 'special-attack', 'special-defense'].map(name => ({ stat: { name }, base_stat: 50 })),
      types: [{ type: { name: 'normal' } }],
      abilities: [{ slot: 1, ability: { name: 'test-ability', url: 'https://pokeapi.co/api/v2/ability/1/' } }],
    }
  }
  if (pathname.includes('/ability/')) return { name: 'test-ability', effect_entries: [] }
  if (pathname.includes('/move/')) return { name: 'test-move', type: { name: 'normal' }, power: 40, accuracy: 100, effect_entries: [], damage_class: { name: 'physical' }, target: { name: 'selected-pokemon' } }
  if (pathname.includes('/item/')) return { name: 'test-item', effect_entries: [] }
  throw new Error(`Unexpected PokeAPI request: ${url}`)
}
