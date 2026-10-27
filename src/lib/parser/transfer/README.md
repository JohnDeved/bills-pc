# Emerald to Quetzal transfers

This module copies selected Pokémon from an Emerald party or PC into explicitly reviewed **empty slots in one Quetzal box**, then returns a new save file. It never receives a writable file handle, deletes a source Pokémon, replaces a destination occupant, or spills into another box.

## API and trust boundary

`loadTransferSave(bytes, fileName, expectedGame)` loads each side independently. Public display objects and trusted parsed records come from separate copies. The original bytes are held in a private `WeakMap`; changing the input arrays, exposed Pokémon, box arrays, sector maps, or a displayed plan does not affect the trusted snapshot.

`planTransfer(source, destination, selectedIds, boxIndex)` returns stable source references (`party:0`, `box:0:0`), explicit destination slots, compatibility errors, and required format-change acknowledgements. All indices are zero based. Selection order determines placement into ascending empty slots.

`executeTransfer(source, destination, selectedIds, boxIndex, { acknowledgeWarnings })` reparses both private originals and recomputes the plan. It rejects the whole batch if any selection is invalid, if capacity is insufficient, or if the format review has not been acknowledged. It creates all records in memory before reconstructing a new output.

Before returning an output, it reparses the save, verifies the active slot, compares every existing party and boxed Pokémon, compares every inserted compact record, and checks the complete byte array. Only the reviewed empty records and checksums of sections intersecting those records may change. This includes records crossing section boundaries. Save size, the other save slot, box metadata, untouched padding and auxiliary sectors remain byte identical.

## Supported conversion

- Source: valid vanilla Emerald party records (100 bytes) and boxed records (80 bytes), including decryption, substructure permutation and Pokémon checksum validation.
- Destination: independently detected Quetzal compact records of 21, 31 or 38 bytes, with respectively 67, 45 or 37 boxes. An empty or ambiguous PC cannot establish a layout safely; deposit at least one Pokémon in Quetzal and save before loading an empty PC here. Unknown layouts are rejected.
- Species, moves, held items and Poké Balls map by their semantic names, not by copying internal numeric IDs. Base species are restricted to the verified National Dex range, and each target mapping must agree with that ordering (`raw ID === canonical ID`). This excludes malformed aliases elsewhere in the existing mapping table, including Keldeo mislabeled as Kecleon and Thundurus mislabeled as Houndour, without allowing those aliases to create ambiguous matches for valid Emerald Pokémon. Three legacy Emerald move names are explicitly mapped: Hi Jump Kick → High Jump Kick, Faint Attack → Feint Attack, and SmellingSalt → Smelling Salts.
- Ability names are resolved from Emerald's species table and selected slot, then matched to the target species' ability table. A missing Emerald ability slot is rejected. Emerald's `GetAbilityBySpecies` does **not** fall back to slot 0 when slot 1 is empty.
- Level, nature, gender, shiny status and all six IVs are preserved. Quetzal uses Medium Slow for every species; experience is converted by level and relative progress to the next level, rounded to a multiple of ten and constrained so the level cannot change. Level 100 maps to 1,059,860 experience.
- EVs are rounded down to multiples of four, with every change shown. The contribution to current calculated stats is unchanged. Their exact numeric totals are not preserved.
- Ten nickname bytes are preserved in 31- and 38-byte layouts. The 21-byte layout has no nickname field and requires explicit review of that loss.
- The 38-byte layout preserves valid current PP up to Quetzal's base PP limit and current party HP up to the destination maximum. A boxed source uses its computed maximum HP. Shedinja's maximum is one. Exact PP or HP adjustments appear in the review. The 21- and 31-byte layouts have no PP or HP fields.

## Inherent losses and blocked records

Compact records do not store original trainer identity, personality, language, friendship, met data, origin game, Pokérus, contest condition, ribbons, event flags, markings, PP Ups or battle status. These omissions are explicitly presented for acknowledgement. The source save remains the complete original record; the destination copy is not a lossless PK3 clone.

The converter rejects eggs, Bad Eggs, damaged records, invalid experience/party-level combinations, invalid PP, invalid EV totals, unsupported text encodings, unknown mappings, missing abilities, and held Mail. Held TMs/HMs are rejected because identical TM numbers do not establish that the same move is taught across games.

Spinda is blocked because its exact spot pattern requires the original personality. Unown and Emerald Deoxys are blocked until version-specific form mappings are verified. Wurmple is blocked because Emerald's personality-based evolution and Quetzal's gender-based evolution cannot both be assumed to describe the same branch.

## Offline metadata and provenance

`metadata.json` contains only the small numerical/name tables needed for conversion. It includes no ROM or save data and makes no runtime network requests. Values were extracted from the following files in [LirouVictor/savDex at `8fbec28ffb0e508051a3d4557f19ab86da2010cc`](https://github.com/LirouVictor/savDex/tree/8fbec28ffb0e508051a3d4557f19ab86da2010cc):

| Output table | Source and meaning |
| --- | --- |
| `emerald` | `src/data/gen3.json`, `species` and `abilities`; keyed by Emerald internal species ID. Tuple: `[National Dex ID, growth curve, female threshold byte, first ability name, second ability name or null, base HP]`. The generator `tools/build-gen3.mjs` reads [pret/pokeemerald](https://github.com/pret/pokeemerald/blob/master/src/data/pokemon/species_info.h). |
| `quetzal` | `src/data/species.json`, restricted to National Dex 1–386. Tuple: `[base HP, first ability name, second ability name or null, hidden ability name or null]`. SavDex's pinned `CLAUDE.md`, Quetzal format section, documents that base species 1–898 match these PokeAPI names, types, stats and abilities. |
| `emeraldMovePP` | `src/data/gen3.json`, move field 2; Emerald's base PP by raw move ID. |
| `quetzalMovePP` | `src/data/quetzal.json`, `moveData` field 3; Quetzal base PP by raw move ID, extracted by `tools/build-quetzal.mjs`. |

The packed layout, female/shiny/ball bits, growth rule and field omissions follow SavDex's pinned `src/parser/save.js` and its documented ROM observations. Its Quetzal metadata identifies `PokemonQuetzalPtBrAlpha9v1.gba`, SHA-1 `c4091f572d52436c86ceaa0c5718cfb22dc2d59d`. Only extracted factual metadata is included here. Layout recognition alone cannot prove that an arbitrary modified ROM uses identical gameplay tables, so support does not extend to unverified forks.

Growth-curve numbers follow Emerald: 0 Medium Fast, 1 Erratic, 2 Fluctuating, 3 Medium Slow, 4 Fast, 5 Slow. Gender thresholds use Emerald's byte convention (0 male, 254 female, 255 genderless). The ability-slot behavior is verified against [pret/pokeemerald's `GetAbilityBySpecies`](https://github.com/pret/pokeemerald/blob/master/src/pokemon.c).

## Validation scope

`pokemonTransfer.test.ts` builds and decodes the formats independently of the transfer encoder. It covers semantic field mapping, source party and PC copies, occupied/full boxes, atomic rejection, tampered public objects, damaged saves, all three compact layouts, their final slots, and records crossing section boundaries. Additional validation uses real Emerald saves and the repository's captured Quetzal save, decoded again by the pinned independent SavDex implementation. Byte equality and independent decoding establish serialization integrity; an actual emulator play-through is a separate validation claim and must not be implied by these checks.
