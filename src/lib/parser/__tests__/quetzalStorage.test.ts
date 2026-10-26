import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PokemonSaveParser } from '../core/PokemonSaveParser'
import { QuetzalConfig } from '../games/quetzal/config'
import { parseQuetzalStorage, writeQuetzalStorage } from '../games/quetzal/storage'

const config = new QuetzalConfig()
const fixture = new Uint8Array(readFileSync(new URL('./test_data/quetzal.sav', import.meta.url)))
const originalStorage = new Uint8Array(11 * 0xf80)
const footerView = new DataView(fixture.buffer)
for (let physical = 16; physical < 32; physical++) {
  const id = footerView.getUint16(physical * 0x1000 + 0xff4, true)
  if (id >= 5) originalStorage.set(fixture.subarray(physical * 0x1000, physical * 0x1000 + 0xf80), (id - 5) * 0xf80)
}

describe('Quetzal packed PC storage', () => {
  it('matches the independently decoded real save and round-trips byte for byte', async () => {
    const parser = new PokemonSaveParser()
    const save = await parser.parse(new Uint8Array(fixture).buffer)
    expect(save.box_error).toBeUndefined()
    expect(save.boxes).toHaveLength(45)
    expect(save.boxes!.flatMap(box => box.pokemon).filter(Boolean)).toHaveLength(232)
    const surskit = save.boxes![0]!.pokemon[0]!
    expect(surskit.nickname).toBe('Surskit')
    expect(surskit.speciesId).toBe(283)
    expect(surskit.experience).toBe(6460)
    expect(surskit.level).toBe(21)
    expect(surskit.natureRaw).toBe(11)
    expect(surskit.abilityNumber).toBe(0)
    expect(surskit.ivs).toEqual([16, 10, 19, 16, 2, 2])
    expect(surskit.evs).toEqual([0, 0, 0, 0, 0, 0])
    expect(surskit.moveIds).toEqual([98, 230, 487, 61])
    expect(surskit.rawBytes).toHaveLength(31)
    expect(parser.reconstructSaveFile(save.party_pokemon, save.boxes)).toEqual(fixture)
  })

  it('maps post-Hoenn species exactly once', () => {
    const save = parseQuetzalStorage(originalStorage, config)
    const shroodle = save.boxes[0]!.pokemon[10]!
    expect(shroodle.nickname).toBe('Shroodle')
    expect(shroodle.speciesId).toBe(944)
    expect(shroodle.nameId).toBe('shroodle')
  })

  // Build alternative record layouts from an actual captured Surskit. These
  // are derived fixtures, not claims of additional in-game save captures.
  for (const [size, count] of [
    [21, 67],
    [31, 45],
    [38, 37],
  ] as const) {
    it(`preserves unknown fields and boundary records in the ${size}-byte layout`, () => {
      const storage = new Uint8Array(originalStorage.length)
      storage.set(originalStorage.subarray(0, 0x461))
      const record = new Uint8Array(size)
      record.set(originalStorage.subarray(0x461, 0x461 + 21))
      record[5]! |= 0xe0 // unknown bits beside ball/shiny
      record[19]! |= 0xfc // unknown bits beside the last IV
      if (size === 31) record.set(originalStorage.subarray(0x461 + 21, 0x461 + 31), 21)
      if (size === 38) {
        record.set([88, 0, 0x5a, 10, 11, 12, 13], 21)
        record.set(originalStorage.subarray(0x461 + 21, 0x461 + 31), 28)
      }
      const boundary = Math.floor((0xf80 - 0x461) / size)
      const occupied = [0, boundary, count * 30 - 1]
      for (const slot of occupied) storage.set(record, 0x461 + slot * size)
      const save = parseQuetzalStorage(storage, config)
      expect(save.boxes).toHaveLength(count)
      expect(writeQuetzalStorage(storage, save.boxes)).toEqual(storage)
      const first = save.boxes[0]!.pokemon[0]!
      expect(first.hasStoredPP).toBe(size === 38)
      expect(first.evStep).toBe(4)
      if (size === 38) {
        expect(first.currentHp).toBe(88)
        expect([first.pp1, first.pp2, first.pp3, first.pp4]).toEqual([10, 11, 12, 13])
      }
      if (size === 21) expect(first.nickname).toBe('SURSKIT')

      const mon = save.boxes[Math.floor(boundary / 30)]!.pokemon[boundary % 30]!
      mon.setIvs([31, 30, 29, 28, 27, 26])
      mon.setEvs([253, 201, 7, 11, 15, 19])
      mon.setNatureRaw(3)
      mon.abilityNumber = 2
      mon.setItem(config.mappings.items.get(13)!.id)
      mon.setStats([999, 888, 777, 666, 555, 444])
      const exported = writeQuetzalStorage(storage, save.boxes)
      const start = 0x461 + boundary * size
      expect(exported.subarray(0, start)).toEqual(storage.subarray(0, start))
      expect(exported.subarray(start + size)).toEqual(storage.subarray(start + size))
      // Packed fields that are not editable (including PID substitutes,
      // moves, nickname, HP/PP and undocumented bits) survive every setter.
      expect(exported[start + 5]! & 0xe0).toBe(0xe0)
      expect(exported[start + 19]! & 0xfc).toBe(0xfc)
      expect(exported[start + 20]! & 1).toBe(record[20]! & 1)
      expect(exported.subarray(start + 21, start + size)).toEqual(record.subarray(21))
      const reloaded = parseQuetzalStorage(exported, config).boxes[Math.floor(boundary / 30)]!.pokemon[boundary % 30]!
      expect(reloaded.ivs).toEqual([31, 30, 29, 28, 27, 26])
      expect(reloaded.evs).toEqual([252, 200, 4, 8, 12, 16])
      expect(reloaded.natureRaw).toBe(3)
      expect(reloaded.abilityNumber).toBe(2)
      expect(reloaded.item).toBe(config.mappings.items.get(13)!.id)
      expect(reloaded.experience).toBe(first.experience)
      expect(reloaded.moveIds).toEqual(first.moveIds)
    })
  }

  it('does not guess the format for empty or malformed packed storage', () => {
    const empty = new Uint8Array(originalStorage.length)
    empty.set(originalStorage.subarray(0, 0x461))
    expect(() => parseQuetzalStorage(empty, config)).toThrow('could not be identified safely')
    const malformed = new Uint8Array(originalStorage)
    malformed[0x461 + 20] = 0xff // invalid nature / ability
    expect(() => parseQuetzalStorage(malformed, config)).toThrow('could not be identified safely')
  })

  it('preserves unidentified PC data while allowing party changes', async () => {
    const bytes = new Uint8Array(fixture)
    const view = new DataView(bytes.buffer)
    const storage = new Uint8Array(originalStorage)
    storage[0x461 + 20] = 0xff
    const pcSectors: number[] = []
    for (let physical = 16; physical < 32; physical++) {
      const offset = physical * 0x1000
      const id = view.getUint16(offset + 0xff4, true)
      if (id < 5) continue
      pcSectors.push(offset)
      bytes.set(storage.subarray((id - 5) * 0xf80, (id - 4) * 0xf80), offset)
      let sum = 0
      for (let word = 0; word < 0xff4; word += 4) sum = (sum + view.getUint32(offset + word, true)) >>> 0
      view.setUint16(offset + 0xff6, ((sum >>> 16) + (sum & 0xffff)) & 0xffff, true)
    }
    const parser = new PokemonSaveParser()
    const save = await parser.parse(bytes.buffer)
    expect(save.boxes).toBeUndefined()
    expect(save.box_error).toContain('could not be identified safely')
    save.party_pokemon[0]!.setIvs([1, 2, 3, 4, 5, 6])
    const exported = parser.reconstructSaveFile(save.party_pokemon)
    for (const offset of pcSectors) expect(exported.subarray(offset, offset + 0x1000)).toEqual(bytes.subarray(offset, offset + 0x1000))
    const restored = await new PokemonSaveParser().parse(exported.buffer)
    expect(restored.party_pokemon[0]!.ivs).toEqual([1, 2, 3, 4, 5, 6])
    expect(restored.box_error).toBeDefined()
  })
})
