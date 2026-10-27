import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PokemonBase } from '../core/PokemonBase'
import { QuetzalConfig } from '../games/quetzal/config'
import { QuetzalBoxPokemon } from '../games/quetzal/storage'
import { VanillaConfig } from '../games/vanilla/config'

// Independent Gen 3 codec: physical block order is the lexicographic permutation
// selected by PID % 24. Do not use PokemonBase's permutation or checksum helpers.
function permutations(values: number[]): number[][] {
  if (values.length === 0) return [[]]
  return values.flatMap((value, index) => permutations(values.filter((_, other) => other !== index)).map(rest => [value, ...rest]))
}
const orders = permutations([0, 1, 2, 3])
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function decode(record: Uint8Array): Uint8Array {
  const view = viewOf(record)
  const result = new Uint8Array(48)
  const decoded = viewOf(result)
  const key = view.getUint32(0, true) ^ view.getUint32(4, true)
  orders[view.getUint32(0, true) % 24]!.forEach((logical, physical) => {
    for (let word = 0; word < 3; word++) decoded.setUint32(logical * 12 + word * 4, view.getUint32(32 + physical * 12 + word * 4, true) ^ key, true)
  })
  return result
}

function innerChecksum(data: Uint8Array): number {
  const view = viewOf(data)
  let checksum = 0
  for (let offset = 0; offset < 48; offset += 2) checksum += view.getUint16(offset, true)
  return checksum & 0xffff
}

const fixture = new Uint8Array(readFileSync(new URL('./test_data/emerald.sav', import.meta.url)))
const fixtureView = viewOf(fixture)
const partySector = Array.from({ length: 14 }, (_, index) => index + 14).find(physical => fixtureView.getUint16(physical * 0x1000 + 0xff4, true) === 1)!
const template = fixture.slice(partySector * 0x1000 + 0x238, partySector * 0x1000 + 0x238 + 80)
const originalData = decode(template)
const config = new VanillaConfig()

function recordFor(rawSpecies: number, personality: number, otId: number): Uint8Array {
  const data = new Uint8Array(originalData)
  const secure = viewOf(data)
  secure.setUint16(0, rawSpecies, true)
  // Preserve an egg, second ability, met data, ribbons, and opaque bytes as well
  // as the real fixture's moves, IVs/EVs, experience, held item, and friendship.
  secure.setUint32(40, secure.getUint32(40, true) | 0xc0000000, true)
  secure.setUint32(44, 0x96e1b5a7, true)
  const result = new Uint8Array(template)
  const view = viewOf(result)
  view.setUint32(0, personality, true)
  view.setUint32(4, otId, true)
  const key = personality ^ otId
  orders[personality % 24]!.forEach((logical, physical) => {
    for (let word = 0; word < 3; word++) view.setUint32(32 + physical * 12 + word * 4, secure.getUint32(logical * 12 + word * 4, true) ^ key, true)
  })
  view.setUint16(28, innerChecksum(data), true)
  return result
}

function shiny(personality: number, otId: number): boolean {
  return ((personality >>> 16) ^ (personality & 0xffff) ^ (otId >>> 16) ^ (otId & 0xffff)) < 8
}

function unownLetter(personality: number): number {
  return (((personality >>> 24) & 3) * 64 + ((personality >>> 16) & 3) * 16 + ((personality >>> 8) & 3) * 4 + (personality & 3)) % 28
}

function assertNatureEdit(rawSpecies: number, personality: number, otId: number, nature: number): void {
  const before = recordFor(rawSpecies, personality, otId)
  const mon = new PokemonBase(new Uint8Array(before), config, true)
  const originalSpecies = mon.speciesId
  mon.setNatureRaw(nature)
  const after = mon.rawBytes
  const editedPid = viewOf(after).getUint32(0, true)
  const data = decode(after)
  expect(editedPid % 25).toBe(nature)
  expect(mon.speciesId).toBe(originalSpecies)
  expect(data).toEqual(decode(before))
  expect(after.slice(4, 32)).toEqual(before.slice(4, 32))
  expect(viewOf(after).getUint16(28, true)).toBe(innerChecksum(data))
  expect(shiny(editedPid, otId)).toBe(shiny(personality, otId))
  expect(editedPid & 1).toBe(personality & 1)
  if (rawSpecies === 201) expect(unownLetter(editedPid)).toBe(unownLetter(personality))
  if (rawSpecies === 290) {
    expect((editedPid & 0xff) < 127).toBe((personality & 0xff) < 127)
    expect((editedPid >>> 16) % 10 < 5).toBe((personality >>> 16) % 10 < 5)
  }
  if (!shiny(personality, otId) || (rawSpecies !== 201 && rawSpecies !== 290)) expect(editedPid & 0xff).toBe(personality & 0xff)
}

describe('Emerald nature editing preserves personality-dependent traits', () => {
  it.each([
    { label: 'ordinary non-shiny Pokémon', species: 277, personality: 3058660210, otId: 0x12345678 },
    { label: 'shiny Pokémon', species: 277, personality: 0x12341234, otId: 0 },
    { label: 'zero PID, shiny', species: 277, personality: 0, otId: 0 },
    { label: 'zero PID, non-shiny', species: 277, personality: 0, otId: 8 },
    { label: 'maximum PID, shiny', species: 277, personality: 0xffffffff, otId: 1 },
    { label: 'maximum PID, non-shiny', species: 277, personality: 0xffffffff, otId: 8 },
    { label: 'non-shiny Unown', species: 201, personality: 0x12345678, otId: 0 },
    { label: 'shiny Unown', species: 201, personality: 0, otId: 1 },
    { label: 'shiny Unown requiring the bounded fallback', species: 201, personality: 652663065, otId: 65531 },
    { label: 'non-shiny Wurmple', species: 290, personality: 0x12345678, otId: 0 },
    { label: 'shiny Wurmple requiring the bounded fallback', species: 290, personality: 497738298, otId: 65427 },
  ])('preserves all unrelated data for all 25 natures: $label', ({ species, personality, otId }) => {
    for (let nature = 0; nature < 25; nature++) assertNatureEdit(species, personality, otId, nature)
  })

  it('re-encrypts correctly from every possible original substructure order', () => {
    for (let personality = 0; personality < 24; personality++) {
      for (let nature = 0; nature < 25; nature++) assertNatureEdit(277, personality, 0x13572468, nature)
    }
  })

  it('retains every Unown letter for shiny and non-shiny originals', () => {
    const letters = new Map<number, number>()
    for (let personality = 0; letters.size < 28; personality++) letters.set(unownLetter(personality), personality)
    for (const personality of letters.values()) {
      const shinyOt = (personality >>> 16) ^ (personality & 0xffff)
      for (const otId of [shinyOt, shinyOt ^ 8]) {
        for (let nature = 0; nature < 25; nature++) assertNatureEdit(201, personality, otId, nature)
      }
    }
  })

  it('rejects a Spinda nature change before modifying its unique spot pattern', () => {
    const before = recordFor(308, 0x12345678, 0)
    const mon = new PokemonBase(new Uint8Array(before), config, true)
    expect(mon.speciesId).toBe(327)
    expect(mon.natureEditDisabledReason).toContain('spot pattern')
    expect(() => mon.setNatureRaw((mon.natureRaw + 1) % 25)).toThrow('spot pattern')
    expect(mon.rawBytes).toEqual(before)
    mon.setNatureRaw(mon.natureRaw)
    expect(mon.rawBytes).toEqual(before)
  })

  it('allows Quetzal Spinda nature changes because its packed nature is independent', () => {
    const record = new Uint8Array(31)
    viewOf(record).setUint16(0, 327, true)
    record[5] = 0xe0 // Preserve unknown bits as well as all unrelated fields.
    const mon = new QuetzalBoxPokemon(record, new QuetzalConfig(), { size: 31, boxes: 45, nicknameOffset: 21, ppOffset: null })
    expect(mon.speciesId).toBe(327)
    expect(mon.natureEditDisabledReason).toBeUndefined()
    mon.setNatureRaw(24)
    expect(mon.natureRaw).toBe(24)
    const expected = new Uint8Array(record)
    expected[20] = 24 << 1
    expect(mon.rawBytes).toEqual(expected)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 25, 1.5])('rejects invalid nature %s without partial mutation', nature => {
    const before = recordFor(277, 0x12341234, 0)
    const mon = new PokemonBase(new Uint8Array(before), config, true)
    expect(() => mon.setNatureRaw(nature)).toThrow('Nature value must be between 0 and 24')
    expect(mon.rawBytes).toEqual(before)
  })
})
