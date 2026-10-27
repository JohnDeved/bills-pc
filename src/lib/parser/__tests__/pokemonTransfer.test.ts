import { describe, expect, it } from 'vitest'
import { loadBoxSave, readSaveFixture } from '../../../__tests__/box-fixtures'
import { executeTransfer, loadTransferSave, planTransfer } from '../transfer'

// These helpers write and read the documented on-disk formats directly. They do
// not use the transfer encoder or its metadata to establish expected values.
const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG', 'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG']
const SIZE = 0x1000
const STRIDE = 0xf80
const MON_START = 0x461
const BOX_COUNTS = { 21: 67, 31: 45, 38: 37 } as const
const mediumSlowThreshold = (level: number) => (level <= 1 ? 0 : Math.floor((6 * level ** 3) / 5) - 15 * level ** 2 + 100 * level - 140)

function sectionMap(bytes: Uint8Array, sectors: number): Map<number, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const first = view.getUint32(0xffc, true)
  const second = view.getUint32(sectors * SIZE + 0xffc, true)
  const start = second > first ? sectors : 0
  return new Map(Array.from({ length: sectors }, (_, i) => [view.getUint16((start + i) * SIZE + 0xff4, true), (start + i) * SIZE]))
}

function checksum(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sum = 0
  for (let offset = 0; offset < bytes.length; offset += 4) sum = (sum + view.getUint32(offset, true)) >>> 0
  return ((sum >>> 16) + (sum & 0xffff)) & 0xffff
}

function storageOf(bytes: Uint8Array, sectors: number): Uint8Array<ArrayBuffer> {
  const map = sectionMap(bytes, sectors)
  const storage = new Uint8Array((sectors - 5) * STRIDE)
  for (let section = 5; section < sectors; section++) storage.set(bytes.subarray(map.get(section)!, map.get(section)! + STRIDE), (section - 5) * STRIDE)
  return storage
}

function replaceStorage(bytes: Uint8Array, sectors: number, storage: Uint8Array): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(bytes)
  const map = sectionMap(output, sectors)
  const view = new DataView(output.buffer)
  for (let section = 5; section < sectors; section++) {
    const offset = map.get(section)!
    const copied = sectors === 14 && section === 13 ? 0x7d0 : STRIDE
    output.set(storage.subarray((section - 5) * STRIDE, (section - 5) * STRIDE + copied), offset)
    const covered = sectors === 16 ? 0xff4 : copied
    view.setUint16(offset + 0xff6, checksum(output.subarray(offset, offset + covered)), true)
  }
  return output
}

function textBytes(text: string, length: number): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(length).fill(0xff)
  for (let i = 0; i < Math.min(text.length, length); i++) output[i] = 0xbb + text.charCodeAt(i) - 65
  return output
}

interface SourceFields {
  species?: number
  item?: number
  experience?: number
  personality?: number
  otId?: number
  ability?: number
  egg?: boolean
  moves?: readonly number[]
  pp?: readonly number[]
  ppUps?: readonly number[]
  evs?: readonly number[]
  ivs?: readonly number[]
  nickname?: string
  ball?: number
  language?: number
}

function emeraldRecord(fields: SourceFields = {}): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(80)
  const view = new DataView(output.buffer)
  const pid = fields.personality ?? 0x12345678
  const ot = fields.otId ?? pid // Deliberately shiny: the four half-words XOR to zero.
  view.setUint32(0, pid, true)
  view.setUint32(4, ot, true)
  output.set(textBytes(fields.nickname ?? 'TREECKO', 10), 8)
  output[18] = fields.language ?? 2 // English
  output[19] = 2 // hasSpecies; not a Bad Egg
  output.set(textBytes('ASH', 7), 20)
  const plain = new Uint8Array(48)
  const data = new DataView(plain.buffer)
  data.setUint16(0, fields.species ?? 277, true) // Treecko's Emerald internal ID, not National Dex 252.
  data.setUint16(2, fields.item ?? 13, true) // Potion; Quetzal uses raw item 28.
  data.setUint32(4, fields.experience ?? 10_000, true)
  plain[8] = (fields.ppUps ?? [0, 0, 0, 0]).reduce((value, upgrades, i) => value | (upgrades << (2 * i)), 0)
  plain[9] = 100 // friendship, which the compact destination cannot store
  const moves = fields.moves ?? [33, 43, 71, 235]
  const pp = fields.pp ?? [10, 9, 8, 4]
  for (let i = 0; i < 4; i++) {
    data.setUint16(12 + i * 2, moves[i] ?? 0, true)
    plain[20 + i] = pp[i] ?? 0
  }
  plain.set(fields.evs ?? [255, 1, 6, 13, 128, 87], 24)
  plain[37] = 16 // met location
  data.setUint16(38, 5 | ((fields.ball ?? 4) << 11), true) // caught at level 5 in a Poké Ball
  const ivs = fields.ivs ?? [31, 1, 16, 30, 7, 25]
  const ivWord = ivs.reduce((word, value, i) => word | (value << (5 * i)), 0) | ((fields.egg ? 1 : 0) << 30) | ((fields.ability ?? 0) << 31)
  data.setUint32(40, ivWord >>> 0, true)
  const order = ORDERS[pid % 24]!
  const key = (pid ^ ot) >>> 0
  let sum = 0
  for (let i = 0; i < 48; i += 2) sum = (sum + data.getUint16(i, true)) & 0xffff
  view.setUint16(28, sum, true)
  for (let block = 0; block < 4; block++) {
    const canonical = 'GAEM'.indexOf(order[block]!) * 12
    for (let word = 0; word < 12; word += 4) view.setUint32(32 + block * 12 + word, (data.getUint32(canonical + word, true) ^ key) >>> 0, true)
  }
  return output
}

function sourceSave(records: SourceFields[] = [{}]): Uint8Array<ArrayBuffer> {
  const original = loadBoxSave('emerald')
  const storage = storageOf(original, 14)
  storage.fill(0, 4, 4 + 420 * 80)
  records.forEach((record, i) => storage.set(emeraldRecord(record), 4 + i * 80))
  return replaceStorage(original, 14, storage)
}

function destinationSave(size: 21 | 31 | 38 = 31, occupied?: number[]): Uint8Array<ArrayBuffer> {
  const original = readSaveFixture('quetzal')
  const oldStorage = storageOf(original, 16)
  const storage = new Uint8Array(oldStorage.length)
  storage.set(oldStorage.subarray(0, MON_START))
  const record = new Uint8Array(size)
  record.set(oldStorage.subarray(MON_START, MON_START + 21))
  if (size === 31) record.set(oldStorage.subarray(MON_START + 21, MON_START + 31), 21)
  if (size === 38) {
    record.set([88, 0, 0x5a, 10, 11, 12, 13], 21)
    record.set(oldStorage.subarray(MON_START + 21, MON_START + 31), 28)
  }
  const boxes = BOX_COUNTS[size]
  const slots = occupied ?? [0, Math.floor((STRIDE - MON_START) / size), boxes * 30 - 2]
  for (const slot of slots) storage.set(record, MON_START + slot * size)
  return replaceStorage(original, 16, storage)
}

function readPacked(bytes: Uint8Array, size: number, slot: number) {
  const storage = storageOf(bytes, 16)
  const record = storage.slice(MON_START + slot * size, MON_START + (slot + 1) * size)
  let word = 0n
  for (let i = 0; i < record.length; i++) word |= BigInt(record[i]!) << BigInt(i * 8)
  const bits = (offset: number, width: number) => Number((word >> BigInt(offset)) & ((1n << BigInt(width)) - 1n))
  return {
    record,
    species: bits(0, 11),
    item: bits(11, 10),
    experience: bits(21, 17) * 10,
    ball: bits(38, 6),
    shiny: bits(44, 1),
    moves: Array.from({ length: 4 }, (_, i) => bits(48 + i * 10, 10)),
    evs: Array.from({ length: 6 }, (_, i) => bits(88 + i * 6, 6) * 4),
    ivs: Array.from({ length: 6 }, (_, i) => bits(124 + i * 5, 5)),
    female: bits(160, 1),
    nature: bits(161, 5),
    ability: bits(166, 2),
    hp: size === 38 ? bits(168, 16) : null,
    pp: size === 38 ? [...record.subarray(24, 28)] : null,
    nickname: size === 21 ? null : record.slice(size === 31 ? 21 : 28),
  }
}

function assertAllowedChanges(before: Uint8Array, after: Uint8Array, size: number, slots: number[]): void {
  expect(after.length).toBe(before.length)
  const map = sectionMap(before, 16)
  const permitted = new Set<number>()
  const changedSections = new Set<number>()
  for (const slot of slots) {
    for (let byte = 0; byte < size; byte++) {
      const logical = MON_START + slot * size + byte
      const section = 5 + Math.floor(logical / STRIDE)
      changedSections.add(section)
      permitted.add(map.get(section)! + (logical % STRIDE))
    }
  }
  for (const section of changedSections) {
    permitted.add(map.get(section)! + 0xff6)
    permitted.add(map.get(section)! + 0xff7)
  }
  const unexpected = []
  let changes = 0
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue
    changes++
    if (!permitted.has(i)) unexpected.push(i)
  }
  expect(changes).toBeGreaterThan(0)
  expect(unexpected).toEqual([])
  const view = new DataView(after.buffer, after.byteOffset, after.byteLength)
  for (const offset of map.values()) expect(view.getUint16(offset + 0xff6, true)).toBe(checksum(after.subarray(offset, offset + 0xff4)))
}

async function sessions(sourceBytes = sourceSave(), destinationBytes = destinationSave()) {
  const source = await loadTransferSave(sourceBytes, 'journey.sav', 'emerald')
  const destination = await loadTransferSave(destinationBytes, 'quetzal.sav', 'quetzal')
  return { source, destination, sourceBytes, destinationBytes }
}

describe('Emerald to Quetzal transfer', () => {
  it('copies a Pokémon by meaning and changes only its empty destination record and sector checksum', async () => {
    const { source, destination, sourceBytes, destinationBytes } = await sessions()
    const originalSource = new Uint8Array(sourceBytes)
    const originalDestination = new Uint8Array(destinationBytes)
    const plan = planTransfer(source, destination, ['box:0:0'], 0)
    expect(plan.canTransfer).toBe(true)
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]).toMatchObject({ sourceId: 'box:0:0', boxIndex: 0, slotIndex: 1, speciesId: 252 })
    expect(plan.requiresAcknowledgement).toBe(true)
    const result = await executeTransfer(source, destination, ['box:0:0'], 0, { acknowledgeWarnings: true })
    expect(sourceBytes).toEqual(originalSource)
    expect(destinationBytes).toEqual(originalDestination)
    expect(result.fileName).not.toBe('quetzal.sav')
    expect(result.fileName).toMatch(/\.sav$/i)
    assertAllowedChanges(originalDestination, result.bytes, 31, [1])
    const record = readPacked(result.bytes, 31, 1)
    expect(record.species).toBe(252)
    expect(record.item).toBe(28)
    expect(record.moves).toEqual([33, 43, 71, 235])
    expect(record.ivs).toEqual([31, 1, 16, 30, 7, 25])
    expect(record.evs).toEqual([252, 0, 4, 12, 128, 84])
    expect(record.nature).toBe(0x12345678 % 25)
    expect(record.shiny).toBe(1)
    expect(record.female).toBe(0)
    expect(record.ability).toBe(0)
    expect(record.ball).toBe(1) // Emerald Poké Ball 4 → Quetzal Poké Ball 1.
    expect(record.nickname).toEqual(textBytes('TREECKO', 10))
    const reopened = await loadTransferSave(result.bytes, result.fileName, 'quetzal')
    expect(reopened.saveData.boxes![0]!.pokemon[1]!.speciesId).toBe(252)
  })

  it('requires explicit acknowledgement of destination-format losses before exporting', async () => {
    const { source, destination, sourceBytes, destinationBytes } = await sessions()
    const originals = [new Uint8Array(sourceBytes), new Uint8Array(destinationBytes)]
    const plan = planTransfer(source, destination, ['box:0:0'], 0)
    expect(plan.issues.filter(issue => issue.severity === 'warning').length).toBeGreaterThan(0)
    expect(plan.issues.map(issue => issue.message).join(' ')).toMatch(/trainer|identity|OT/i)
    await expect(executeTransfer(source, destination, ['box:0:0'], 0, { acknowledgeWarnings: false })).rejects.toThrow(/acknowledg|review|warning/i)
    expect(sourceBytes).toEqual(originals[0])
    expect(destinationBytes).toEqual(originals[1])
  })

  it.each([
    { species: 133, experience: 27_000, level: 30 }, // Eevee: medium-fast → medium-slow.
    { species: 129, experience: 33_750, level: 30 }, // Magikarp: slow → medium-slow.
    { species: 301, experience: 37_800, level: 30 }, // Nincada: erratic → medium-slow.
    { species: 306, experience: 23_760, level: 30 }, // Shroomish: fluctuating → medium-slow.
    { species: 183, experience: 21_600, level: 30 }, // Marill: fast → medium-slow.
    { species: 277, experience: 6_458, level: 21 }, // A level boundary not representable in tens.
    { species: 277, experience: 0, level: 1 },
    { species: 129, experience: 1_250_000, level: 100 },
  ])('preserves level $level while translating XP $experience for Emerald species $species', async fields => {
    const { source, destination } = await sessions(sourceSave([fields]))
    const result = await executeTransfer(source, destination, ['box:0:0'], 0, { acknowledgeWarnings: true })
    const xp = readPacked(result.bytes, 31, 1).experience
    expect(xp % 10).toBe(0)
    expect(xp).toBeGreaterThanOrEqual(mediumSlowThreshold(fields.level))
    if (fields.level < 100) expect(xp).toBeLessThan(mediumSlowThreshold(fields.level + 1))
    expect(result.plan.entries[0]!.level).toBe(fields.level)
  })

  it.each([
    { species: 277, personality: 0x12345601, female: 1 },
    { species: 277, personality: 0x123456ff, female: 0 },
    { species: 113, personality: 0x123456ff, female: 1 }, // Chansey is always female.
  ])('preserves gender for species $species and PID $personality', async fields => {
    const { source, destination } = await sessions(sourceSave([fields]))
    const result = await executeTransfer(source, destination, ['box:0:0'], 0, { acknowledgeWarnings: true })
    const record = readPacked(result.bytes, 31, 1)
    expect(record.female).toBe(fields.female)
    expect(record.shiny).toBe(1)
    expect(record.nature).toBe(fields.personality % 25)
  })

  it.each([21, 31, 38] as const)('writes the final slot of the %s-byte destination without touching the backup save or unused data', async size => {
    const boxCount = BOX_COUNTS[size]
    const occupied = [0, ...Array.from({ length: 29 }, (_, i) => (boxCount - 1) * 30 + i)]
    const { source, destination, destinationBytes } = await sessions(sourceSave(), destinationSave(size, occupied))
    const plan = planTransfer(source, destination, ['box:0:0'], boxCount - 1)
    expect(plan.canTransfer).toBe(true)
    expect(plan.entries[0]).toMatchObject({ boxIndex: boxCount - 1, slotIndex: 29 })
    const result = await executeTransfer(source, destination, ['box:0:0'], boxCount - 1, { acknowledgeWarnings: true })
    assertAllowedChanges(destinationBytes, result.bytes, size, [boxCount * 30 - 1])
    const record = readPacked(result.bytes, size, boxCount * 30 - 1)
    expect(record.species).toBe(252)
    expect(record.ivs).toEqual([31, 1, 16, 30, 7, 25])
    if (size === 21) {
      expect(record.nickname).toBeNull()
      expect(plan.issues.map(issue => issue.message).join(' ')).toMatch(/nickname/i)
    } else expect(record.nickname).toEqual(textBytes('TREECKO', 10))
    if (size === 38) {
      expect(record.pp).toEqual([10, 9, 8, 4])
      expect(record.hp).toBeGreaterThan(0)
    }
  })

  it.each([21, 31, 38] as const)('checksums both sectors when a %s-byte destination record straddles a sector boundary', async size => {
    const crossing = Math.floor((STRIDE - MON_START) / size)
    const occupied = Array.from({ length: crossing % 30 }, (_, i) => Math.floor(crossing / 30) * 30 + i)
    occupied.push(0)
    const { source, destination, destinationBytes } = await sessions(sourceSave(), destinationSave(size, occupied))
    const result = await executeTransfer(source, destination, ['box:0:0'], Math.floor(crossing / 30), { acknowledgeWarnings: true })
    expect(result.plan.entries[0]!.slotIndex).toBe(crossing % 30)
    assertAllowedChanges(destinationBytes, result.bytes, size, [crossing])
  })

  it('copies party Pokémon while leaving every original party byte intact', async () => {
    const { source, destination, sourceBytes, destinationBytes } = await sessions()
    const sourceOriginal = new Uint8Array(sourceBytes)
    expect(source.candidates.some(candidate => candidate.id === 'party:0')).toBe(true)
    const result = await executeTransfer(source, destination, ['party:0'], 0, { acknowledgeWarnings: true })
    expect(sourceBytes).toEqual(sourceOriginal)
    assertAllowedChanges(destinationBytes, result.bytes, 31, [1])
    expect(readPacked(result.bytes, 31, 1).species).toBe(252)
  })

  it('fills empty slots in order and never replaces an occupied Pokémon', async () => {
    const { source, destination, destinationBytes } = await sessions(sourceSave([{}, { nickname: 'SECOND' }, { nickname: 'THIRD' }]), destinationSave(31, [0, 2, 4, 1348]))
    const result = await executeTransfer(source, destination, ['box:0:0', 'box:0:1', 'box:0:2'], 0, { acknowledgeWarnings: true })
    expect(result.plan.entries.map(entry => entry.slotIndex)).toEqual([1, 3, 5])
    assertAllowedChanges(destinationBytes, result.bytes, 31, [1, 3, 5])
    expect(readPacked(result.bytes, 31, 3).nickname).toEqual(textBytes('SECOND', 10))
    expect(readPacked(result.bytes, 31, 5).nickname).toEqual(textBytes('THIRD', 10))
  })

  it('refuses a full destination box without overwriting or spilling into another box', async () => {
    const { source, destination, sourceBytes, destinationBytes } = await sessions(sourceSave(), destinationSave(31, [...Array.from({ length: 30 }, (_, i) => i), 1348]))
    const originalSource = new Uint8Array(sourceBytes)
    const originalDestination = new Uint8Array(destinationBytes)
    const plan = planTransfer(source, destination, ['box:0:0'], 0)
    expect(plan.canTransfer).toBe(false)
    expect(plan.emptySlots).toBe(0)
    await expect(executeTransfer(source, destination, ['box:0:0'], 0, { acknowledgeWarnings: true })).rejects.toThrow()
    expect(sourceBytes).toEqual(originalSource)
    expect(destinationBytes).toEqual(originalDestination)
  })

  it.each([{ ids: [] }, { ids: ['box:0:0', 'box:0:0'] }, { ids: ['box:999:999'] }])('rejects an invalid selection $ids before export', async ({ ids }) => {
    const { source, destination } = await sessions()
    expect(planTransfer(source, destination, ids, 0).canTransfer).toBe(false)
    await expect(executeTransfer(source, destination, ids, 0, { acknowledgeWarnings: true })).rejects.toThrow()
  })

  it.each([-1, 45, 0.5, Number.NaN])('rejects invalid destination box %s', async box => {
    const { source, destination } = await sessions()
    expect(planTransfer(source, destination, ['box:0:0'], box).canTransfer).toBe(false)
    await expect(executeTransfer(source, destination, ['box:0:0'], box, { acknowledgeWarnings: true })).rejects.toThrow()
  })

  it.each([
    ['Spinda pattern', { species: 308 }],
    ['Unown form', { species: 201 }],
    ['Wurmple evolution branch', { species: 290 }],
    ['Deoxys form', { species: 410 }],
    ['egg', { egg: true }],
    ['unknown species', { species: 500 }],
    ['unmapped held item', { item: 0xffff }],
    ['unmapped move', { moves: [0xffff, 43, 71, 235] }],
    ['invalid ability slot', { ability: 1 }], // Emerald returns NONE for Treecko's nonexistent second ability.
    ['held TM', { item: 298 }],
    ['held Mail', { item: 121 }],
    ['Japanese nickname encoding', { language: 1 }],
    ['invalid current PP', { pp: [10, 9, 8, 255] }],
    ['excessive EVs', { evs: [255, 255, 255, 255, 255, 255] }],
  ] as const)('blocks %s and refuses a mixed batch atomically', async (_reason, fields) => {
    const { source, destination, sourceBytes, destinationBytes } = await sessions(sourceSave([{}, fields]))
    const originals = [new Uint8Array(sourceBytes), new Uint8Array(destinationBytes)]
    const plan = planTransfer(source, destination, ['box:0:0', 'box:0:1'], 0)
    expect(plan.canTransfer).toBe(false)
    expect(plan.issues.some(issue => issue.severity === 'error')).toBe(true)
    await expect(executeTransfer(source, destination, ['box:0:0', 'box:0:1'], 0, { acknowledgeWarnings: true })).rejects.toThrow()
    expect(sourceBytes).toEqual(originals[0])
    expect(destinationBytes).toEqual(originals[1])
  })

  it('does not trust a caller mutating loaded Pokémon or the original input arrays after review', async () => {
    const { source, destination, sourceBytes, destinationBytes } = await sessions()
    const originalDestination = new Uint8Array(destinationBytes)
    const candidate = source.candidates.find(mon => mon.id === 'box:0:0')!
    candidate.pokemon.setIvs([0, 0, 0, 0, 0, 0])
    destination.saveData.boxes![0]!.pokemon[0]!.setIvs([1, 1, 1, 1, 1, 1])
    sourceBytes.fill(0)
    destinationBytes.fill(0)
    const result = await executeTransfer(source, destination, ['box:0:0'], 0, { acknowledgeWarnings: true })
    assertAllowedChanges(originalDestination, result.bytes, 31, [1])
    expect(readPacked(result.bytes, 31, 1).ivs).toEqual([31, 1, 16, 30, 7, 25])
  })

  it('discloses and bounds current PP when source PP Ups cannot fit the destination', async () => {
    const { source, destination } = await sessions(sourceSave([{ pp: [10, 9, 8, 7], ppUps: [0, 0, 0, 2] }]), destinationSave(38))
    const plan = planTransfer(source, destination, ['box:0:0'], 0)
    expect(plan.canTransfer).toBe(true)
    expect(plan.issues.some(issue => issue.code === 'pp-ups')).toBe(true)
    expect(plan.issues.some(issue => issue.code === 'pp-limit')).toBe(true)
    const result = await executeTransfer(source, destination, ['box:0:0'], 0, { acknowledgeWarnings: true })
    expect(readPacked(result.bytes, 38, 1).pp).toEqual([10, 9, 8, 5])
  })

  it('maps the three valid Emerald moves omitted by the original generated mapping', async () => {
    const { source, destination } = await sessions(sourceSave([{ moves: [136, 185, 265, 0], pp: [5, 10, 5, 0] }]))
    const result = await executeTransfer(source, destination, ['box:0:0'], 0, { acknowledgeWarnings: true })
    // High Jump Kick, Feint Attack and Smelling Salts must keep their meanings.
    expect(readPacked(result.bytes, 31, 1).moves).toEqual([136, 185, 265, 0])
  })

  it.each([
    { species: 317, national: 352 }, // Kecleon; an unrelated Keldeo mapping previously shared its name.
    { species: 228, national: 228 }, // Houndour; an unrelated Thundurus mapping previously shared its name.
  ])('selects the correct base species $national despite unrelated duplicate mapping names', async fields => {
    const { source, destination } = await sessions(sourceSave([fields]))
    const result = await executeTransfer(source, destination, ['box:0:0'], 0, { acknowledgeWarnings: true })
    expect(readPacked(result.bytes, 31, 1).species).toBe(fields.national)
  })

  it('rejects an invalid inner Pokémon checksum even when its containing save sectors have valid checksums', async () => {
    const bytes = sourceSave()
    const storage = storageOf(bytes, 14)
    storage[4 + 32]! ^= 1
    const corrupted = replaceStorage(bytes, 14, storage)
    await expect(loadTransferSave(corrupted, 'damaged-pokemon.sav', 'emerald')).rejects.toThrow(/checksum|PC|storage/i)
  })

  it('rejects files in the wrong direction and cannot identify an empty compact layout by guessing', async () => {
    await expect(loadTransferSave(readSaveFixture('quetzal'), 'wrong-source.sav', 'emerald')).rejects.toThrow()
    await expect(loadTransferSave(readSaveFixture('emerald'), 'wrong-destination.sav', 'quetzal')).rejects.toThrow()
    await expect(loadTransferSave(destinationSave(31, []), 'empty.sav', 'quetzal')).rejects.toThrow()
  })

  it('rejects invalid checksums in both save slots instead of legitimizing corrupt data', async () => {
    for (const game of ['emerald', 'quetzal'] as const) {
      const bytes = game === 'emerald' ? sourceSave() : destinationSave()
      const perSlot = game === 'emerald' ? 14 : 16
      bytes[0]! ^= 0xff
      bytes[perSlot * SIZE]! ^= 0xff
      await expect(loadTransferSave(bytes, `${game}-corrupt.sav`, game)).rejects.toThrow(/checksum|complete|valid|detect/i)
    }
  })
})
