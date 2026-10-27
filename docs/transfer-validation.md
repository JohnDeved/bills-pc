# Emerald → Quetzal transfer validation

The transfer feature copies selected Emerald party or PC Pokémon into reviewed empty Quetzal PC slots and returns a new save. The validation checks both the meaning of the copied Pokémon and the integrity of the complete destination file. Original saves are read only.

## Recorded results

The full independent verification completed **27 passing cases, 13,670 passing checks and 537 transferred-record comparisons**, with no failures. A separate check of the **actual browser download** completed **337 passing checks** for four copied Pokémon. Every original save retained its SHA-256 hash.

These measurements were taken before the implementation commit. Each report records the application HEAD, working-tree state, verifier hash and individual parser-source hashes; the HEAD alone does not identify the tested working tree. Use the reproducible commands below to bind a new report to the exact revision being reviewed.

| Real Emerald source | Original PC | Original party | Accepted copies per destination layout | Intentionally blocked | Real Quetzal PC after copying |
| --- | ---: | ---: | ---: | --- | ---: |
| `emerald.sav` | 83 | 6 | 87 | Wurmple, Spinda | 319: 232 existing + 87 copies |
| `emeraldtest.sav` | 89 | 6 | 92 | Wurmple, Spinda, Gastly holding TM10 | 324: 232 existing + 92 copies |

Every compatible party and PC Pokémon was copied to each supported layout: `(87 + 92) × 3 = 537` records. A batch fills only the explicitly chosen box. When testing a complete migration, the verifier starts another batch in a box with enough empty slots.

### Real and derived fixtures

The Emerald inputs are real saves from [PokemonBoxSaveEditor at `054e9878a89fb385e9b8aaf72256107a4f758981`](https://github.com/VitHuang/PokemonBoxSaveEditor/tree/054e9878a89fb385e9b8aaf72256107a4f758981). The destination is this repository's captured [`quetzal.sav`](../src/lib/parser/__tests__/test_data/quetzal.sav), containing 232 boxed Pokémon in the 31-byte layout.

The 21- and 38-byte destination fixtures are **derived fixtures**, constructed from a record in that captured Quetzal save. They exercise the other supported layouts and their sector boundaries. They are not additional in-game captures. No new raw saves or ROMs are vendored by this validation work.

| Fixture | SHA-256 |
| --- | --- |
| Emerald `emerald.sav` | `d883d62a7fe6f7404083dd02c0252516519ada231bce1b62800c0b843868fa31` |
| Emerald `emeraldtest.sav` | `8ea7d22e9de169a16b5aacbb8156cf15a4317cf9ab631dfa00d311543587c0ff` |
| Repository `quetzal.sav` | `f35c85108a9dd9e4ec4d8f713f5764c492096be73a5ee948b839cc2d347e44d9` |

The portable verifier checks these hashes before running the matrix and compares the files again afterward.

### Actual browser export

The screenshot run selected Emerald `party:0`, `party:1`, `box:0:1` and `box:0:3`: Aggron, Blaziken, Lotad and Marill. It copied them to box index 7, slots 23, 26, 27 and 28. In the UI, those are **box 8, slots 24, 27, 28 and 29**.

The browser-produced file passed independent decoding and the full byte allowlist check. All 232 existing boxed Pokémon and all existing party records remained unchanged. The source-backup download exactly matched the original Emerald save. The downloaded Quetzal file also exactly matched a separately requested API export for the same selection and destination.

```text
Browser export SHA-256
b2830e167072a5e52078f55486b815cac5565a1ac862e06a4992371ab2d02c29

Browser source-backup SHA-256
d883d62a7fe6f7404083dd02c0252516519ada231bce1b62800c0b843868fa31
```

## What is checked

The [portable verifier](../scripts/verify-pokemon-transfer.mjs) loads [SavDex at `8fbec28ffb0e508051a3d4557f19ab86da2010cc`](https://github.com/LirouVictor/savDex/tree/8fbec28ffb0e508051a3d4557f19ab86da2010cc) from a separate checkout. Its Emerald decoder decrypts the original records and supplies the expected values. Its Quetzal decoder reopens the exported files. The transfer encoder's output objects are not used to establish the expected decoded fields or the allowed file offsets.

| Check | Required result |
| --- | --- |
| Species, held item, ability and ball | Preserve their meanings across the games' different numeric IDs. |
| Moves | Preserve each move and its order. |
| Level | Preserve the level while converting between Emerald's six growth curves and Quetzal's medium-slow curve. |
| Nature, gender and shiny status | Match the source's independently decoded traits. |
| IVs | Preserve all six values exactly. |
| EVs | Equal the source values rounded down to multiples of four, as disclosed in the review. |
| Nickname | Preserve the decoded name in 31- and 38-byte layouts. |
| PP and HP | For 38-byte records, match independently calculated representable values, including disclosed PP/HP limits. |
| Existing party and PC records | Preserve every decoded field and raw record. |
| Empty target slots | Confirm each destination record was entirely empty before inserting a copy. |
| Complete output file | Permit changes only in the selected new records and the checksums of their containing sectors. |
| Sector checksums | Independently recompute all active destination-sector checksums. |
| Original files and buffers | Preserve length, bytes and original-file hashes. |

The whole-file comparison protects the other save slot, trainer and progression data, box names and metadata, existing Pokémon, padding and auxiliary data. Cross-sector records permit checksum changes in both affected sectors and nowhere else.

The dedicated [`pokemonTransfer.test.ts`](../src/lib/parser/__tests__/pokemonTransfer.test.ts) suite adds synthetic edge cases: all six growth curves, level-boundary rounding, party and PC sources, full/occupied boxes, empty or invalid selections, out-of-range indices, final slots and cross-sector records in every layout, public-object/input tampering, atomic rejection of mixed valid/invalid batches, damaged Pokémon and sector checksums, unsupported species/forms, eggs, text encodings, PP/EV limits, held Mail/TMs, and PP Up conversion.

The real-save audit found two compatibility problems that now have regressions. The original Emerald mapping omitted High Jump Kick, Feint Attack and Smelling Salts. Unrelated malformed Quetzal species-map rows also made Kecleon and Houndour appear ambiguous. The converter now uses the verified move mappings and restricts base-species matches to consistent National Dex entries.

## Source pins and report bindings

The verifier requires the two external repositories at the commits above and rejects modified independent-reader source files. It loads these SavDex files; their hashes are included in every report:

| Independent source | SHA-256 |
| --- | --- |
| `src/parser/gen3.js` | `ae4f900ff15ef19dfdc668941b62bb96233a02335daabf57f062e7112a3946a1` |
| `src/parser/save.js` | `dba729c8d5b5c35a90680415ce62734b5526eb35aaada771ffc0cec99cc39446` |
| `src/data/gen3.json` | `2c339920f2eea7e9159ba499b0bfd334a73e8fe604f1d05fea6349c512d5edb0` |
| `src/data/quetzal.json` | `28c14a9b67541d3df532a6a704865e9e6d612e55d588cb4366f350ddad776b89` |
| `src/data/species.json` | `e5c4e26c0977f76610c26e2b3e1629f9ce19de1211cccf0bf72646ee80828c6e` |
| `src/data/balls.json` | `4740bf032ec49ea46a74c253f1aa6705d8e5a9e1811b5275643717ea6de89866` |

The historical full-matrix report (`candidate-3`) has SHA-256 `914adc53a22472d14256f4eaf4f3a7f63dc8663db5a5f2208a6863d37ab3a202`. The historical browser report (`browser-1`) has SHA-256 `bce82f09f3a9b4c8307976f0ef6c44660f9ce74c617f94b1d6e7ff27abe69b2b`. Both retain the complete application-source hash map. Selected bindings are reproduced here so the reported measurements are not attached only to an uncommitted branch name:

| Application source | Historical SHA-256 |
| --- | --- |
| `transfer/convert.ts` | `9b90d1fffd93833f2ce8f8e5d9c21d22237c1a679f5e49a421e6ab322ca31b78` |
| `transfer/emerald.ts` | `2956b4a63ffc4f1225eb9768240144a2b0d89c9c4d50e82593f9c519b10e5160` |
| `transfer/experience.ts` | `3782e8be330121cd860cc21828cc458b0191bf2c7ebd6ec4f6eaa4d384dea4b9` |
| `transfer/metadata.json` | `b1281b0da3e86dbe487e851046bbc3c7de3c23332dc52ceeb6d28cd5854a5b3d` |
| `transfer/index.ts`, matrix run | `e2510f98dcfa181106530dc71f50caa98ad27772b6e1dafc991639a0538be688` |
| `transfer/index.ts`, browser run | `f22684e436314539810dfead25521a941bf0ecc0188de2fa07b7b4a02398c9fe` |

Application paths in this table are relative to `src/lib/parser`. A new run generates new bindings automatically. Preserve the `application.sources`, `application.commit`, working-tree state, script hash, reader provenance and fixture hashes when reducing a full report for review.

## Reproduce the complete matrix

From this repository's root, install its declared dependencies and obtain the pinned read-only references:

```sh
npm ci
git clone https://github.com/LirouVictor/savDex.git ../savDex
git -C ../savDex checkout --detach 8fbec28ffb0e508051a3d4557f19ab86da2010cc
git clone https://github.com/VitHuang/PokemonBoxSaveEditor.git ../PokemonBoxSaveEditor
git -C ../PokemonBoxSaveEditor checkout --detach 054e9878a89fb385e9b8aaf72256107a4f758981

node --import tsx scripts/verify-pokemon-transfer.mjs \
  --oracle ../savDex \
  --sources ../PokemonBoxSaveEditor \
  --out ../transfer-proof/review-matrix \
  --label review-matrix

npx vitest run src/lib/parser/__tests__/pokemonTransfer.test.ts --maxWorkers=2
```

The repository defaults to the parent of the script's directory. `--oracle`, `--sources` and `--out` are required; there are no machine-specific default paths. Optional `--repo` points to another Bill's PC checkout. Use a distinct output directory for each run, preferably outside the checkout so generated saves do not change its working-tree status.

The verifier writes `report.json` and six separate exported saves into `--out`. It prints a compact summary and exits unsuccessfully if a comparison fails or an original file's hash changes. The report includes input and output hashes, compatibility decisions, destination placements, warnings, counts, failures and exact source bindings. No original input is overwritten.

## Reproduce the browser-download check

Keep the actual save and backup downloaded through the UI. Create a JSON manifest; paths inside it resolve relative to the manifest's directory. For example, a manifest saved in the repository root can describe the recorded selection as follows:

```json
{
  "exports": [
    {
      "name": "four-pokemon-through-browser-flow",
      "sourcePath": "../PokemonBoxSaveEditor/emerald.sav",
      "destinationPath": "src/lib/parser/__tests__/test_data/quetzal.sav",
      "outputPath": "../browser-downloads/quetzal-with-emerald-pokemon.sav",
      "backupPath": "../browser-downloads/emerald-backup.sav",
      "selectedIds": ["party:0", "party:1", "box:0:1", "box:0:3"],
      "destinationBoxIndex": 7,
      "destinationSlots": [23, 26, 27, 28]
    }
  ]
}
```

All indices in the manifest are zero based. Update them to match the actions actually performed in the UI. Then run:

```sh
node --import tsx scripts/verify-pokemon-transfer.mjs \
  --oracle ../savDex \
  --sources ../PokemonBoxSaveEditor \
  --out ../transfer-proof/review-browser \
  --label review-browser \
  --browser transfer-browser-manifest.json
```

Browser mode validates the supplied download instead of running the full migration matrix. It independently calculates the expected empty-slot placements, verifies the resulting file and source backup, and compares the download with a separately requested API export. It does not automate the browser or substitute an API-generated file for the browser download.

## Limits of the evidence

**No emulator play-through was performed.** These checks establish serialization integrity and agreement with an independent decoder. The 21/38-byte cases use derived fixtures. Baseline-species ability and HP expectations come from the pinned SavDex/PokeAPI tables, not observations of a running game. The converter and verifier share those historical factual metadata sources; the decoding and byte-boundary calculations are separate implementations. Arbitrary modified ROMs may use different gameplay tables despite sharing a storage layout.

**The original remains complete; the destination copy is not a lossless Emerald record.** Quetzal compact storage omits original trainer identity, personality, language, friendship, met/origin data, Pokérus, contest condition, ribbons, event flags, markings and PP Ups. Twenty-one-byte records also omit nicknames; 21/31-byte records omit current PP and HP. Experience uses a different growth curve and units of ten. EVs use units of four. The UI requires acknowledgement of these limits and shows applicable numerical changes before export.

Spinda is blocked because the absent personality would lose its spot pattern. Wurmple is blocked because its evolution branch cannot be guaranteed. Unown and Emerald Deoxys remain blocked until their form mappings are verified. Held TMs/HMs are blocked because the same TM number does not establish the same taught move; held Mail would lose its message. Eggs, damaged or inconsistent records, unsupported text and unverified mappings are also rejected. The supported records are copied only after the entire selected batch passes validation.

See [the transfer module documentation](../src/lib/parser/transfer/README.md) for field-level conversion rules and metadata provenance, and [the user flow](pokemon-transfer-flow.md) for the screens and interaction sequence.
