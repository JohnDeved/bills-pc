#!/usr/bin/env node
/**
 * Independent Emerald → Quetzal transfer verification.
 * Run from the repository root with Node and the existing tsx dependency:
 * node --import tsx scripts/verify-pokemon-transfer.mjs \
 *   --oracle ../savDex --sources ../PokemonBoxSaveEditor --out ../transfer-proof
 * Savdex is loaded from a separate, pinned checkout. The encoder under test is
 * never used to decode expected values or build the destination byte allowlist.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const script = fileURLToPath(import.meta.url)
const { values: options } = parseArgs({
  options: {
    repo: { type: 'string' },
    oracle: { type: 'string' },
    sources: { type: 'string' },
    out: { type: 'string' },
    label: { type: 'string' },
    browser: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})
const usage = `Usage: node --import tsx scripts/verify-pokemon-transfer.mjs
  --oracle <pinned SavDex checkout> --sources <pinned PokemonBoxSaveEditor checkout>
  --out <output directory> [--label <run name>] [--browser <manifest.json>]
  [--repo <Bill's PC checkout>]

The repository defaults to the parent of this script's directory. Other relative
paths resolve from the current directory. Browser manifest file paths resolve
from the manifest's directory. Inputs are read only; use a distinct --out for each
run. See docs/transfer-validation.md for source pins, hashes and examples.`
if (options.help) {
  console.log(usage)
  process.exit(0)
}
for (const required of ['oracle', 'sources', 'out']) {
  if (!options[required]) throw new Error(`Missing --${required}\n${usage}`)
}
const repo = resolve(options.repo ?? join(dirname(script), '..'))
const oracle = resolve(options.oracle)
const sourceRepo = resolve(options.sources)
const label = (options.label ?? 'verification').replace(/[^\w-]/g, '-')
const out = resolve(options.out)
mkdirSync(out, { recursive: true })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
const read = path => new Uint8Array(readFileSync(path))
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const oracleCommit = '8fbec28ffb0e508051a3d4557f19ab86da2010cc'
const sourceCommit = '054e9878a89fb385e9b8aaf72256107a4f758981'
if (git(oracle, 'rev-parse', 'HEAD') !== oracleCommit) throw new Error(`The independent reader must be checked out at ${oracleCommit}`)
if (git(sourceRepo, 'rev-parse', 'HEAD') !== sourceCommit) throw new Error(`The source-save repository must be checked out at ${sourceCommit}`)
if (git(oracle, 'diff', '--name-only', 'HEAD', '--', 'src')) throw new Error('The independent reader has modified source files; use the unchanged pinned checkout')
const { loadTransferSave, planTransfer, executeTransfer } = await import(pathToFileURL(join(repo, 'src/lib/parser/transfer/index.ts')).href)
const { parseSave } = await import(pathToFileURL(join(oracle, 'src/parser/save.js')).href)
const { parseGen3, detectGen3, levelForExp } = await import(pathToFileURL(join(oracle, 'src/parser/gen3.js')).href)
const G = json(join(oracle, 'src/data/gen3.json'))
const Q = json(join(oracle, 'src/data/quetzal.json'))
const species = json(join(oracle, 'src/data/species.json'))
const { balls } = json(join(oracle, 'src/data/balls.json'))
const STAT_KEYS = ['hp', 'atk', 'def', 'spe', 'spa', 'spd']

function sourceHashes() {
  const files = []
  const visit = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (/\.(ts|json)$/.test(full)) files.push(full)
    }
  }
  visit(join(repo, 'src/lib/parser'))
  return Object.fromEntries(files.sort().map(path => [relative(repo, path), hash(readFileSync(path))]))
}

const report = {
  schema: 1,
  label,
  startedAt: new Date().toISOString(),
  script: { path: script, sha256: hash(readFileSync(script)) },
  application: { commit: git(repo, 'rev-parse', 'HEAD'), workingTree: git(repo, 'status', '--porcelain'), parserDiffSha256: hash(git(repo, 'diff', 'HEAD', '--', 'src/lib/parser')), sources: sourceHashes() },
  independentReader: {
    url: git(oracle, 'remote', 'get-url', 'origin'),
    commit: git(oracle, 'rev-parse', 'HEAD'),
    workingTree: git(oracle, 'status', '--porcelain'),
    sources: Object.fromEntries(['src/parser/gen3.js', 'src/parser/save.js', 'src/data/gen3.json', 'src/data/quetzal.json', 'src/data/species.json', 'src/data/balls.json'].map(path => [path, hash(readFileSync(join(oracle, path)))])),
  },
  sourceSaveRepository: { url: git(sourceRepo, 'remote', 'get-url', 'origin'), commit: git(sourceRepo, 'rev-parse', 'HEAD'), workingTree: git(sourceRepo, 'status', '--porcelain') },
  scope: {
    mode: options.browser ? 'browser-download' : 'full-real-fixture-matrix',
    emulatorExecuted: false,
    realInputs: ['Emerald save with 83 boxed Pokémon and 6 party Pokémon', 'Emerald save with 89 boxed Pokémon and 6 party Pokémon', 'Quetzal save with 232 boxed Pokémon, 31-byte layout'],
    derivedInputs: ['21-byte and 38-byte Quetzal layouts made from the real captured record; not additional in-game captures'],
    independentChecks: [
      'selected species, held item meaning, move IDs, level, nature, ability meaning, gender, shiny status, ball meaning, IVs, EV quantization, representable nickname and PP',
      'original source/input buffers and on-disk save hashes',
      'every existing destination party/PC record',
      'entire output file byte allowlist: new empty records and affected sector checksums only',
      'all active destination sector checksums',
    ],
    knownLimitations: [
      'Quetzal compact storage does not retain Emerald OT/PID/met/friendship/ribbon/contest identity fields; warnings must be acknowledged',
      'PP Ups are absent from packed storage; current PP is absent in 21/31-byte layouts',
      '21-byte storage cannot retain nicknames',
      'Quetzal uses medium-slow XP in increments of 10 and EVs in increments of 4',
      'Independent baseline-species ability labels are Savdex/PokeAPI metadata; 38-byte HP is compared against the same independent species metadata, not a running game',
    ],
  },
  fixtures: [],
  cases: [],
}

function caseFor(name, detail = {}) {
  const result = { name, ...detail, checksPassed: 0, checksFailed: 0, failures: [] }
  report.cases.push(result)
  return result
}

function check(result, condition, description, detail = {}) {
  if (condition) result.checksPassed++
  else {
    result.checksFailed++
    if (result.failures.length < 50) result.failures.push({ description, ...detail })
  }
}

function equal(result, actual, expected, description, detail = {}) {
  check(result, eq(actual, expected), description, { ...detail, actual, expected })
}

function sectionMap(bytes, save, count) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return new Map(
    Array.from({ length: count }, (_, index) => {
      const offset = (save.slot.index * count + index) * 0x1000
      return [view.getUint16(offset + 0xff4, true), offset]
    })
  )
}

function storage(bytes, save) {
  const map = sectionMap(bytes, save, 16)
  const result = new Uint8Array(11 * 0xf80)
  for (let section = 5; section < 16; section++) result.set(bytes.subarray(map.get(section), map.get(section) + 0xf80), (section - 5) * 0xf80)
  return result
}

function checksum(bytes, offset, length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sum = 0
  for (let i = 0; i < length; i += 4) sum = (sum + view.getUint32(offset + i, true)) >>> 0
  return ((sum >>> 16) + (sum & 0xffff)) & 0xffff
}

function derivedDestination(bytes, size) {
  const original = parseSave(bytes)
  const map = sectionMap(bytes, original, 16)
  const oldPC = storage(bytes, original)
  const pc = new Uint8Array(oldPC.length)
  pc.set(oldPC.subarray(0, 0x461))
  const record = new Uint8Array(size)
  record.set(oldPC.subarray(0x461, 0x461 + 21))
  if (size === 38) {
    record.set([88, 0, 0x5a, 10, 11, 12, 13], 21)
    record.set(oldPC.subarray(0x461 + 21, 0x461 + 31), 28)
  }
  const boxes = size === 21 ? 67 : 37
  for (const slot of [0, Math.floor((0xf80 - 0x461) / size), boxes * 30 - 1]) pc.set(record, 0x461 + slot * size)
  const result = new Uint8Array(bytes)
  const view = new DataView(result.buffer)
  for (let section = 5; section < 16; section++) {
    const start = map.get(section)
    result.set(pc.subarray((section - 5) * 0xf80, (section - 4) * 0xf80), start)
    view.setUint16(start + 0xff6, checksum(result, start, 0xff4), true)
  }
  return result
}

function sourceRecords(save) {
  return new Map([...save.party.map(mon => [`party:${mon.slot - 1}`, mon]), ...save.pc.boxes.flatMap(box => box.slots.map(mon => [`box:${box.index}:${mon.slot - 1}`, mon]))])
}

function targetRecords(save) {
  return new Map(save.pc.boxes.flatMap(box => box.slots.map(mon => [`${box.index}:${mon.slot - 1}`, mon])))
}

function checkFile(result, before, after, beforeSave, afterSave, entries) {
  equal(result, after.length, before.length, 'File length preserved')
  const map = sectionMap(before, beforeSave, 16)
  const size = beforeSave.pc.recordSize
  const mask = new Uint8Array(before.length)
  const pc = storage(before, beforeSave)
  for (const entry of entries) {
    const start = 0x461 + (entry.boxIndex * 30 + entry.slotIndex) * size
    check(
      result,
      pc.subarray(start, start + size).every(byte => byte === 0),
      'Chosen destination record was entirely empty',
      { location: `${entry.boxIndex}:${entry.slotIndex}` }
    )
    for (let i = 0; i < size; i++) {
      const logical = start + i
      const offset = map.get(5 + Math.floor(logical / 0xf80))
      mask[offset + (logical % 0xf80)] = 1
      mask[offset + 0xff6] = 1
      mask[offset + 0xff7] = 1
    }
  }
  const unexpected = []
  let changed = 0
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue
    changed++
    if (!mask[i] && unexpected.length < 100) unexpected.push(i)
  }
  result.changedBytes = changed
  result.allowedBytes = mask.reduce((sum, value) => sum + value, 0)
  check(result, changed > 0, 'Export contains transferred records')
  equal(result, unexpected, [], 'No bytes outside new records and affected checksums changed')
  const view = new DataView(after.buffer, after.byteOffset, after.byteLength)
  for (const [section, offset] of map) equal(result, view.getUint16(offset + 0xff6, true), checksum(after, offset, 0xff4), 'Independent sector checksum', { section })
  equal(result, afterSave.warnings, [], 'Independent reader reports no export warnings')
  equal(result, afterSave.party, beforeSave.party, 'Every destination party field and byte is unchanged')
  equal(result, afterSave.trainer, beforeSave.trainer, 'Destination trainer unchanged')
  equal(result, afterSave.summary, beforeSave.summary, 'Destination progression unchanged')
  const newRecords = targetRecords(afterSave)
  for (const [key, mon] of targetRecords(beforeSave)) equal(result, newRecords.get(key), mon, 'Existing boxed Pokémon unchanged', { location: key })
  equal(result, newRecords.size, targetRecords(beforeSave).size + entries.length, 'Exactly selected number added')
}

function checkMon(result, source, target, size, entry, plan) {
  const location = { source: entry.sourceId, target: `${entry.boxIndex}:${entry.slotIndex}` }
  check(result, !!source && !!target, 'Source and exported Pokémon independently found', location)
  if (!source || !target) return
  const row = G.species[source.speciesId]
  const [national, , , , , genderByte] = row
  const expectedFemale = genderByte === 254 || (genderByte !== 0 && genderByte !== 255 && (source.pid & 0xff) < genderByte)
  const expectedShiny = ((source.pid >>> 16) ^ (source.pid & 0xffff) ^ (source.otId >>> 16) ^ (source.otId & 0xffff)) < 8
  equal(result, target.speciesId, national, 'Species translated from Emerald internal ID to Quetzal National Dex', location)
  const sourceAbility = G.abilities[row[3 + source.abilityNum]]
  const targetAbility = species.abilityNames[species.abilities[target.speciesId]?.[target.abilityNum]]
  equal(result, targetAbility, sourceAbility, 'Ability meaning preserved, not just its slot number', location)
  equal(result, target.itemId ? Q.items[target.itemId] : null, source.itemId ? G.items[source.itemId] : null, 'Held item meaning preserved', location)
  equal(
    result,
    target.moves.map(move => move.id),
    source.moves.map(move => move.id),
    'Move meaning/order preserved (Gen3 IDs)',
    location
  )
  equal(result, target.ivs, source.ivs, 'All six IVs preserved', location)
  equal(result, target.evs, Object.fromEntries(STAT_KEYS.map(stat => [stat, Math.floor(source.evs[stat] / 4) * 4])), 'EVs have exactly the disclosed four-point quantization', location)
  equal(result, target.natureId, source.pid % 25, 'Nature preserved', location)
  equal(result, target.shiny, expectedShiny, 'Shiny status preserved', location)
  equal(result, target.femaleBit, Number(expectedFemale), 'Gender preserved', location)
  equal(result, balls[target.ballId], G.balls[source.ballId], 'Poké Ball meaning preserved', location)
  const level = levelForExp(row[6], source.exp)
  equal(result, levelForExp(3, target.exp), level, 'Level preserved across growth-rate conversion', location)
  equal(result, target.exp % 10, 0, 'Destination XP precision is ten', location)
  equal(result, entry.level, level, 'Previewed level matches independent source level', location)
  if (size !== 21) equal(result, target.nickname, source.nickname, 'Nickname preserved', location)
  if (size === 38) {
    const expectedPP = source.moves.map(move => Math.min(move.pp, Q.moveData[move.id][3]))
    equal(
      result,
      target.moves.map(move => move.pp),
      expectedPP,
      'Current PP retained within destination maximum after PP Up reset',
      location
    )
    const [hpBase] = species.baseStats[national]
    const maxHP = national === 292 ? 1 : Math.floor(((2 * hpBase + source.ivs.hp + Math.floor(target.evs.hp / 4)) * level) / 100) + level + 10
    const expectedHP = source.hp === undefined ? maxHP : Math.min(source.hp, maxHP)
    equal(result, target.hp, expectedHP, 'Destination HP matches independent base-stat formula', location)
  }
  check(result, plan.requiresAcknowledgement, 'Lossy format conversion is explicitly acknowledged', location)
  const raw = Buffer.from(target.raw, 'hex')
  equal(result, raw[5] & 0xe0, 0, 'Unspecified new-record bits45..47 are zero', location)
  equal(result, raw[19] & 0xfc, 0, 'Unspecified new-record bits154..159 are zero', location)
  if (size === 38) equal(result, raw[23], 0, 'Unspecified 38-byte record byte23 is zero', location)
}

const paths = [
  ['emerald-83', join(sourceRepo, 'emerald.sav'), 'd883d62a7fe6f7404083dd02c0252516519ada231bce1b62800c0b843868fa31'],
  ['emerald-89', join(sourceRepo, 'emeraldtest.sav'), '8ea7d22e9de169a16b5aacbb8156cf15a4317cf9ab631dfa00d311543587c0ff'],
  ['quetzal-232', join(repo, 'src/lib/parser/__tests__/test_data/quetzal.sav'), 'f35c85108a9dd9e4ec4d8f713f5764c492096be73a5ee948b839cc2d347e44d9'],
]
for (const [id, path, expected] of paths) {
  const bytes = read(path)
  const sha256 = hash(bytes)
  if (sha256 !== expected) throw new Error(`Fixture ${id} does not match the documented SHA-256: expected ${expected}, received ${sha256}`)
  report.fixtures.push({ id, path, sha256, bytes: bytes.length })
}
const destinationOriginal = read(paths[2][1])

for (const [sourceId, path] of options.browser ? [] : paths.slice(0, 2)) {
  for (const size of [31, 21, 38]) {
    const sourceBytes = read(path)
    const sourceOriginalHash = hash(sourceBytes)
    const detected = detectGen3(sourceBytes)
    if (!detected || detected.game.id !== 'emerald') throw new Error(`Independent reader did not identify ${sourceId}`)
    const independentSource = parseGen3(sourceBytes, detected)
    const sources = sourceRecords(independentSource)
    let destinationBytes = size === 31 ? new Uint8Array(destinationOriginal) : derivedDestination(destinationOriginal, size)
    const sourceSession = await loadTransferSave(sourceBytes, `${sourceId}.sav`, 'emerald')
    const { candidates } = sourceSession
    const candidateCase = caseFor(`${sourceId}-${size}-compatibility`, { sourceId, recordSize: size, boxed: independentSource.pc.boxes.reduce((n, box) => n + box.slots.length, 0), party: independentSource.party.length })
    equal(candidateCase, independentSource.warnings, [], 'Independent source has no warnings')
    equal(candidateCase, candidates.length, sources.size, 'Every source PC and party Pokémon receives a compatibility decision')
    candidateCase.blocked = candidates.filter(candidate => candidate.blockingReason).map(candidate => ({ id: candidate.id, nickname: candidate.nickname, speciesId: candidate.speciesId, reason: candidate.blockingReason }))
    let remaining = candidates.filter(candidate => !candidate.blockingReason).map(candidate => candidate.id)
    candidateCase.accepted = remaining.length
    check(candidateCase, remaining.length > 70, 'Real migration accepts the compatible majority')
    const spindas = [...sources].filter(([, mon]) => G.species[mon.speciesId][0] === 327).map(([id]) => id)
    check(
      candidateCase,
      spindas.every(id => candidateCase.blocked.some(candidate => candidate.id === id)),
      'Spinda personality-pattern loss is blocked'
    )
    let batch = 0
    while (remaining.length) {
      const before = parseSave(destinationBytes)
      const [best] = [...before.pc.boxes].sort((a, b) => a.slots.length - b.slots.length || a.index - b.index)
      const count = Math.min(30 - best.slots.length, remaining.length)
      if (!count) throw new Error('No destination capacity remains')
      const selected = remaining.slice(0, count)
      remaining = remaining.slice(count)
      const targetInputHash = hash(destinationBytes)
      const destination = await loadTransferSave(destinationBytes, `quetzal-${size}.sav`, 'quetzal')
      const result = caseFor(`${sourceId}-${size}-batch-${++batch}`, { sourceId, recordSize: size, selected, destinationBox: best.index })
      try {
        const plan = planTransfer(sourceSession, destination, selected, best.index)
        check(result, plan.canTransfer, 'Compatible selection is exportable', { issues: plan.issues })
        equal(result, plan.entries.length, selected.length, 'Preview contains every selected Pokémon')
        check(result, plan.requiresAcknowledgement, 'Review acknowledgement required for format losses')
        const exported = await executeTransfer(sourceSession, destination, selected, best.index, { acknowledgeWarnings: true })
        const after = parseSave(exported.bytes)
        equal(result, hash(sourceBytes), sourceOriginalHash, 'Original source input buffer unchanged')
        equal(result, hash(destinationBytes), targetInputHash, 'Original destination input buffer unchanged')
        checkFile(result, destinationBytes, exported.bytes, before, after, plan.entries)
        const targets = targetRecords(after)
        for (const entry of plan.entries) checkMon(result, sources.get(entry.sourceId), targets.get(`${entry.boxIndex}:${entry.slotIndex}`), size, entry, plan)
        result.preview = plan.entries
        result.warningCodes = [...new Set(plan.issues.filter(issue => issue.severity === 'warning').map(issue => issue.code))]
        result.outputSha256 = hash(exported.bytes)
        result.filename = exported.fileName
        result.applicationVerification = exported.verification
        destinationBytes = new Uint8Array(exported.bytes)
      } catch (error) {
        check(result, false, 'Unexpected transfer failure', { error: String(error), stack: error?.stack })
        break
      }
    }
    const finalPath = join(out, `${sourceId}-to-quetzal-${size}.sav`)
    writeFileSync(finalPath, destinationBytes)
    candidateCase.output = { path: finalPath, sha256: hash(destinationBytes), independentBoxedCount: parseSave(destinationBytes).pc.boxes.reduce((n, box) => n + box.slots.length, 0) }
  }
}

if (options.browser) {
  const manifestPath = resolve(options.browser)
  const manifest = json(manifestPath)
  report.browserManifest = { path: manifestPath, sha256: hash(readFileSync(manifestPath)) }
  for (const entry of manifest.exports) {
    const item = {
      ...entry,
      sourcePath: resolve(dirname(manifestPath), entry.sourcePath),
      destinationPath: resolve(dirname(manifestPath), entry.destinationPath),
      outputPath: resolve(dirname(manifestPath), entry.outputPath),
      backupPath: entry.backupPath ? resolve(dirname(manifestPath), entry.backupPath) : undefined,
    }
    for (const path of [item.sourcePath, item.destinationPath]) {
      if (!report.fixtures.some(fixture => fixture.path === path)) report.fixtures.push({ id: `${item.name}:${path === item.sourcePath ? 'source' : 'destination'}`, path, sha256: hash(read(path)), bytes: read(path).length })
    }
    const result = caseFor(item.name, { sourcePath: item.sourcePath, destinationPath: item.destinationPath, outputPath: item.outputPath, selected: item.selectedIds, destinationBox: item.destinationBoxIndex })
    try {
      const sourceBytes = read(item.sourcePath)
      const destinationBytes = read(item.destinationPath)
      const output = read(item.outputPath)
      const sourceSave = parseGen3(sourceBytes, detectGen3(sourceBytes))
      const before = parseSave(destinationBytes)
      const after = parseSave(output)
      const occupied = new Set(before.pc.boxes[item.destinationBoxIndex].slots.map(mon => mon.slot - 1))
      const empty = Array.from({ length: 30 }, (_, slot) => slot).filter(slot => !occupied.has(slot))
      const sourceRecordsById = sourceRecords(sourceSave)
      const placements = item.selectedIds.map((sourceId, index) => {
        const mon = sourceRecordsById.get(sourceId)
        return { sourceId, boxIndex: item.destinationBoxIndex, slotIndex: empty[index], level: levelForExp(G.species[mon.speciesId][6], mon.exp) }
      })
      equal(
        result,
        placements.map(entry => entry.slotIndex),
        item.destinationSlots,
        'UI-selected target positions match independently identified ascending empty slots'
      )
      const source = await loadTransferSave(sourceBytes, 'emerald.sav', 'emerald')
      const destination = await loadTransferSave(destinationBytes, 'quetzal.sav', 'quetzal')
      const plan = planTransfer(source, destination, item.selectedIds, item.destinationBoxIndex)
      check(result, plan.canTransfer, 'UI selection passes the trusted compatibility plan')
      equal(
        result,
        plan.entries.map(entry => ({ sourceId: entry.sourceId, boxIndex: entry.boxIndex, slotIndex: entry.slotIndex, level: entry.level })),
        placements,
        'Application plan agrees with independent source and empty-slot calculation'
      )
      checkFile(result, destinationBytes, output, before, after, placements)
      const targets = targetRecords(after)
      for (const entry of placements) checkMon(result, sourceRecordsById.get(entry.sourceId), targets.get(`${entry.boxIndex}:${entry.slotIndex}`), before.pc.recordSize, entry, plan)
      const expected = await executeTransfer(source, destination, item.selectedIds, item.destinationBoxIndex, { acknowledgeWarnings: true })
      equal(result, hash(output), hash(expected.bytes), 'Actual browser download exactly equals independently requested API export')
      if (item.backupPath) equal(result, hash(read(item.backupPath)), hash(sourceBytes), 'Actual browser source backup exactly matches original Emerald save')
      result.preview = placements
      result.outputSha256 = hash(output)
      result.sourceSha256 = hash(sourceBytes)
      result.destinationSha256 = hash(destinationBytes)
      result.originalBoxedCount = targetRecords(before).size
      result.outputBoxedCount = targets.size
      result.warningCodes = [...new Set(plan.issues.filter(issue => issue.severity === 'warning').map(issue => issue.code))]
    } catch (error) {
      check(result, false, 'Browser export validation failed', { error: String(error), stack: error?.stack })
    }
  }
}

for (const fixture of report.fixtures) fixture.finalSha256 = hash(read(fixture.path))
report.completedAt = new Date().toISOString()
report.summary = {
  cases: report.cases.length,
  casesPassed: report.cases.filter(result => !result.checksFailed).length,
  casesFailed: report.cases.filter(result => result.checksFailed).length,
  checksPassed: report.cases.reduce((sum, result) => sum + result.checksPassed, 0),
  checksFailed: report.cases.reduce((sum, result) => sum + result.checksFailed, 0),
  transferredRecordsChecked: report.cases.reduce((sum, result) => sum + (result.preview?.length ?? 0), 0),
  originalsUnchanged: report.fixtures.every(fixture => fixture.sha256 === fixture.finalSha256),
}
const reportPath = join(out, 'report.json')
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ reportPath, ...report.summary }, null, 2))
if (report.summary.casesFailed || !report.summary.originalsUnchanged) process.exitCode = 1
