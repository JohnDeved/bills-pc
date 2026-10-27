import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PokemonSaveParser } from '../core/PokemonSaveParser'

const fixture = (game: 'emerald' | 'quetzal') => new Uint8Array(readFileSync(new URL(`./test_data/${game}.sav`, import.meta.url)))
const bufferOf = (bytes: Uint8Array) => new Uint8Array(bytes).buffer

// Independent section/checksum helpers use the on-disk formats, not parser internals.
function sectionMap(bytes: Uint8Array, start: number, count: number): Map<number, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return new Map(
    Array.from({ length: count }, (_, index) => {
      const physical = start + index
      return [view.getUint16(physical * 0x1000 + 0xff4, true), physical]
    })
  )
}

function checksum(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sum = 0
  for (let offset = 0; offset < bytes.length; offset += 4) sum = (sum + view.getUint32(offset, true)) >>> 0
  return ((sum >>> 16) + (sum & 0xffff)) & 0xffff
}

function emeraldChecksumSize(section: number): number {
  if (section === 0) return 0xf2c
  if (section === 4) return 0xf08
  if (section === 13) return 0x7d0
  return 0xf80
}

function updateEmeraldChecksum(bytes: Uint8Array, physical: number, section: number): void {
  const start = physical * 0x1000
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(start + 0xff6, checksum(bytes.subarray(start, start + emeraldChecksumSize(section))), true)
}

function storageByteOffset(map: Map<number, number>, offset: number): number {
  return map.get(5 + Math.floor(offset / 0xf80))! * 0x1000 + (offset % 0xf80)
}

function populatedEmerald(): Uint8Array {
  const bytes = fixture('emerald')
  const map = sectionMap(bytes, 14, 14)
  // The checked-in Emerald save has empty boxes. Deposit exact encrypted records from
  // its real Treecko party member, including a record crossing sections and the last slot.
  const treecko = bytes.slice(map.get(1)! * 0x1000 + 0x238, map.get(1)! * 0x1000 + 0x238 + 80)
  for (const slot of [0, 49, 419]) {
    for (let index = 0; index < treecko.length; index++) bytes[storageByteOffset(map, 4 + slot * 80 + index)] = treecko[index]!
  }
  for (let section = 5; section <= 13; section++) updateEmeraldChecksum(bytes, map.get(section)!, section)
  return bytes
}

function assertPokemonChecksum(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const key = view.getUint32(0, true) ^ view.getUint32(4, true)
  let sum = 0
  for (let offset = 0x20; offset < 80; offset += 4) {
    const value = view.getUint32(offset, true) ^ key
    sum += (value & 0xffff) + (value >>> 16)
  }
  expect(view.getUint16(0x1c, true)).toBe(sum & 0xffff)
}

describe('PC box save storage', () => {
  it.each(['emerald', 'quetzal'] as const)('round-trips the real %s fixture without changing a byte', async game => {
    const bytes = fixture(game)
    const parser = new PokemonSaveParser()
    const save = await parser.parse(bufferOf(bytes))
    expect(save.box_error).toBeUndefined()
    expect(save.boxes).toHaveLength(game === 'emerald' ? 14 : 45)
    expect(parser.reconstructSaveFile(save.party_pokemon, save.boxes)).toEqual(bytes)
    expect(save.active_slot).toBe(game === 'emerald' ? 14 : 16)
  })

  it('retains empty Emerald slots, box names, and sparse populated positions', async () => {
    const parser = new PokemonSaveParser()
    const save = await parser.parse(bufferOf(populatedEmerald()))
    expect(save.boxes).toHaveLength(14)
    expect(save.boxes![0]!.name).toBe('BOX1')
    expect(save.boxes![13]!.name).toBe('BOX14')
    expect(save.boxes!.every(box => box.pokemon.length === 30)).toBe(true)
    expect(save.boxes!.flatMap(box => box.pokemon).filter(Boolean)).toHaveLength(3)
    for (const [box, slot] of [
      [0, 0],
      [1, 19],
      [13, 29],
    ]) {
      const mon = save.boxes![box!]!.pokemon[slot!]!
      expect(mon.speciesId).toBe(252)
      expect(mon.isBoxed).toBe(true)
      expect(mon.rawBytes).toHaveLength(80)
      expect(mon.experience).toBe(167)
    }
    expect(save.boxes![0]!.pokemon[1]).toBeNull()
  })

  it('terminates boxed nicknames and OT names without changing trailing saved bytes', async () => {
    const bytes = populatedEmerald()
    const map = sectionMap(bytes, 14, 14)
    const nickname = [0xc6, 0xc9, 0xce, 0xbb, 0xbe, 0xff, 0xc1, 0xbb, 0xc6, 0xc6] // LOTAD + old name bytes.
    const trainer = [0xbf, 0xd0, 0xbf, 0xff, 0xc6, 0xc9, 0xce] // EVE + old name bytes.
    nickname.forEach((byte, index) => {
      bytes[storageByteOffset(map, 4 + 8 + index)] = byte
    })
    trainer.forEach((byte, index) => {
      bytes[storageByteOffset(map, 4 + 0x14 + index)] = byte
    })
    updateEmeraldChecksum(bytes, map.get(5)!, 5)

    const parser = new PokemonSaveParser()
    const save = await parser.parse(bufferOf(bytes))
    const mon = save.boxes![0]!.pokemon[0]!
    expect(mon.nickname).toBe('LOTAD')
    expect(mon.otName).toBe('EVE')
    expect([...mon.rawBytes.subarray(8, 18)]).toEqual(nickname)
    expect([...mon.rawBytes.subarray(0x14, 0x1b)]).toEqual(trainer)
    expect(parser.reconstructSaveFile(save.party_pokemon, save.boxes)).toEqual(bytes)
  })

  it('exports IV, EV, nature, ability, and held-item edits across a storage section boundary', async () => {
    const original = populatedEmerald()
    const parser = new PokemonSaveParser()
    const save = await parser.parse(bufferOf(original))
    const mon = save.boxes![1]!.pokemon[19]!
    const originalParty = save.party_pokemon.map(pokemon => pokemon.rawBytes)
    const originalMoves = mon.moveIds
    mon.setNatureRaw(3)
    mon.abilityNumber = 1
    mon.setIvs([31, 30, 29, 28, 27, 26])
    mon.setEvs([252, 0, 0, 252, 4, 0])
    mon.setItem(17) // Potion's external item ID (13 in Emerald's save).
    mon.setBoxLevel(5)
    const beforeStats = mon.rawBytes
    mon.setStats([100, 101, 102, 103, 104, 105])
    expect(mon.rawBytes).toEqual(beforeStats)
    expect(mon.stats).toEqual([100, 101, 102, 103, 104, 105])
    expect(mon.currentHp).toBe(100)
    expect(mon.level).toBe(5)
    assertPokemonChecksum(mon.rawBytes)

    // Omitting the new optional argument must still persist parsed box edits.
    const output = parser.reconstructSaveFile(save.party_pokemon)
    const reparsed = await new PokemonSaveParser().parse(bufferOf(output))
    const edited = reparsed.boxes![1]!.pokemon[19]!
    expect(edited.ivs).toEqual([31, 30, 29, 28, 27, 26])
    expect(edited.evs).toEqual([252, 0, 0, 252, 4, 0])
    expect(edited.natureRaw).toBe(3)
    expect(edited.abilityNumber).toBe(1)
    expect(edited.item).toBe(17)
    expect(edited.moveIds).toEqual(originalMoves)
    expect(reparsed.party_pokemon.map(pokemon => pokemon.rawBytes)).toEqual(originalParty)
    assertPokemonChecksum(edited.rawBytes)

    const map = sectionMap(original, 14, 14)
    const allowed = new Set<number>()
    for (let index = 0; index < 80; index++) allowed.add(storageByteOffset(map, 4 + 49 * 80 + index))
    for (const section of [5, 6]) {
      const start = map.get(section)! * 0x1000
      allowed.add(start + 0xff6)
      allowed.add(start + 0xff7)
      expect(new DataView(output.buffer).getUint16(start + 0xff6, true)).toBe(checksum(output.subarray(start, start + 0xf80)))
    }
    const changed = [...output.keys()].filter(index => output[index] !== original[index])
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.every(index => allowed.has(index))).toBe(true)
    expect(output.slice(0x20000)).toEqual(original.slice(0x20000)) // RTC trailer.
  })

  it('falls back to the complete Emerald slot instead of mixing sectors after an interrupted save', async () => {
    const bytes = populatedEmerald()
    const map = sectionMap(bytes, 14, 14)
    bytes[map.get(6)! * 0x1000] = bytes[map.get(6)! * 0x1000]! ^ 1
    const save = await new PokemonSaveParser().parse(bufferOf(bytes))
    expect(save.active_slot).toBe(0)
    expect([...save.sector_map!.values()].every(physical => physical < 14)).toBe(true)
    expect(save.boxes!.flatMap(box => box.pokemon).filter(Boolean)).toHaveLength(0)
    await expect(new PokemonSaveParser(2).parse(bufferOf(bytes))).rejects.toThrow('incomplete')
  })

  it.each(['invalid inner checksum', 'Bad Egg flag', 'zero species with occupancy flag'] as const)('preserves the entire PC when an occupied Emerald record has an %s', async damage => {
    const bytes = populatedEmerald()
    const map = sectionMap(bytes, 14, 14)
    if (damage === 'zero species with occupancy flag') {
      const offset = storageByteOffset(map, 4)
      const view = new DataView(bytes.buffer)
      const key = view.getUint32(offset, true) ^ view.getUint32(offset + 4, true)
      // A zero species with a valid inner checksum must still be rejected when
      // the unencrypted occupancy flag says that a Pokémon belongs here.
      for (let word = 32; word < 80; word += 4) view.setUint32(offset + word, key, true)
      view.setUint16(offset + 28, 0, true)
      bytes[offset + 0x13]! |= 2
    } else {
      const offset = storageByteOffset(map, 4 + (damage === 'Bad Egg flag' ? 0x13 : 56))
      bytes[offset]! ^= 1
    }
    // The containing save sector is intact; it is the individual Pokémon whose
    // damage must not be silently legitimized by recalculating its checksum.
    updateEmeraldChecksum(bytes, map.get(5)!, 5)
    const parser = new PokemonSaveParser()
    const save = await parser.parse(bufferOf(bytes))
    expect(save.active_slot).toBe(14)
    expect(save.boxes).toBeUndefined()
    expect(save.box_error).toContain('Box 1, slot 1')
    expect(parser.reconstructSaveFile(save.party_pokemon, save.boxes)).toEqual(bytes)

    save.party_pokemon[0]!.setItem(17)
    const output = parser.reconstructSaveFile(save.party_pokemon, save.boxes)
    const reparsed = await new PokemonSaveParser().parse(bufferOf(output))
    expect(reparsed.party_pokemon[0]!.item).toBe(17)
    expect(reparsed.boxes).toBeUndefined()
    expect(reparsed.box_error).toBe(save.box_error)
    for (let section = 5; section <= 13; section++) {
      const physicalStart = map.get(section)! * 0x1000
      expect(output.slice(physicalStart, physicalStart + 0x1000)).toEqual(bytes.slice(physicalStart, physicalStart + 0x1000))
    }
  })

  it.each(['emerald', 'quetzal'] as const)('handles a wrapped %s save counter without selecting stale data', async game => {
    const bytes = fixture(game)
    const count = game === 'emerald' ? 14 : 16
    const view = new DataView(bytes.buffer)
    for (let physical = 0; physical < count * 2; physical++) view.setUint32(physical * 0x1000 + 0xffc, physical < count ? 0xffffffff : 0, true)
    const save = await new PokemonSaveParser().parse(bufferOf(bytes))
    expect(save.active_slot).toBe(count)
    expect([...save.sector_map!.values()].every(physical => physical >= count && physical < count * 2)).toBe(true)
  })

  it('redetects the game when the same parser opens Emerald after Quetzal', async () => {
    const parser = new PokemonSaveParser()
    await parser.parse(bufferOf(fixture('quetzal')))
    const emerald = await parser.parse(bufferOf(populatedEmerald()))
    expect(parser.gameConfig?.name).toBe('Pokemon Emerald (Vanilla)')
    expect(emerald.boxes).toHaveLength(14)
    expect(emerald.boxes![0]!.pokemon[0]!.speciesId).toBe(252)
  })

  it('does not mistake unrelated Emerald bytes for a Quetzal party', async () => {
    const bytes = populatedEmerald()
    const map = sectionMap(bytes, 14, 14)
    const physical = map.get(1)!
    // This looks like Quetzal's first species when interpreted at the wrong offset,
    // but the actual save still has Emerald's 14-section layout.
    new DataView(bytes.buffer).setUint16(physical * 0x1000 + 0x6a8 + 0x28, 25, true)
    updateEmeraldChecksum(bytes, physical, 1)
    const parser = new PokemonSaveParser()
    const save = await parser.parse(bufferOf(bytes))
    expect(parser.gameConfig?.name).toBe('Pokemon Emerald (Vanilla)')
    expect(save.boxes).toHaveLength(14)
    expect(save.party_pokemon[0]!.speciesId).toBe(252)
  })
})
