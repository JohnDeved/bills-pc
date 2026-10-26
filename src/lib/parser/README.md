# Pokemon Save Parser

A modern TypeScript library for parsing and editing Pokemon save files with dependency injection for game-specific configurations.

## Features

- **Multi-game support** - Extensible architecture for Pokemon Emerald, ROM hacks like Quetzal, and more
- **Type-safe** - Full TypeScript implementation with comprehensive interfaces
- **Auto-detection** - Automatically detects game type from save file characteristics
- **Dependency injection** - Clean separation of game-specific logic and data
- **Real-time editing** - Parse, modify, and reconstruct save files
- **PC storage** - Edit Emerald box records and Quetzal's packed PC layouts while preserving unrelated save bytes

## Quick Start

```typescript
import { PokemonSaveParser } from './parser'

// Auto-detect game and parse save file
const parser = new PokemonSaveParser()
const saveData = await parser.parseSaveFile(file)

console.log(`Game: ${parser.getGameConfig()?.name}`) // "Pokemon Quetzal"
console.log(`Player: ${saveData.player_name}`)
console.log(`Party size: ${saveData.party_pokemon.length}`)

// Access Pokemon data
const firstPokemon = saveData.party_pokemon[0]
console.log(`${firstPokemon.nickname} - Level ${firstPokemon.level}`)
console.log(`Stats: ${firstPokemon.stats}`)
console.log(`IVs: ${firstPokemon.ivs}`)
```

## Architecture

### Core Components

- **`PokemonSaveParser`** - Main parser with auto-detection and file handling
- **`GameConfig`** - Interface for game-specific configurations and mappings
- **`BasePokemonData`** - Abstract base class for Pokemon data with common functionality
- **Auto-detection** - Automatically selects appropriate game configuration

## Supported Games

- **Pokemon Quetzal** - Full support with unencrypted IVs and custom shiny logic
- **Pokemon Emerald (Vanilla)** - Party and PC support with encrypted data handling

### Box Pokémon

File parses return optional `boxes` and `current_box` fields. Each box has a
`name` and 30 `pokemon` slots containing a `PokemonBase` or `null`. Box Pokémon
expose `isBoxed`; their derived battle stats are never written into the next
record. Emerald box levels can be hydrated with `setBoxLevel()` after looking up
the species' growth curve. Quetzal box levels use its common Medium Slow curve.

```typescript
const parser = new PokemonSaveParser()
const save = await parser.parse(file)
const pokemon = save.boxes?.[0]?.pokemon[0]
if (pokemon) {
  pokemon.setIvs([31, 31, 31, 31, 31, 31])
  const edited = parser.reconstructSaveFile(save.party_pokemon, save.boxes)
}
```

`reconstructSaveFile(party)` remains supported and includes the parser's current
box objects. The optional second argument makes box persistence explicit.
`box_error` explains unavailable box support without preventing party editing;
unrecognized PC bytes remain untouched. Memory-mode parses omit boxes.

## Adding Game Support

The parser uses a flexible GameConfig system for adding support for new Pokemon games:

### Required Components

1. **Configuration Class** - Implement the GameConfig interface
   - Define game name and signature
   - Set up memory offsets for save data structure
   - Create ID mappings (Pokemon, items, moves)
   - Implement game detection logic
   - Handle save slot selection

2. **Pokemon Data Class** - Extend BasePokemonData
   - Implement IV reading logic
   - Handle shiny detection
   - Define game-specific stat calculations

3. **Registry** - Add your config to the available configurations list

Basic structure:
```typescript
// 1. GameConfig implementation
export class MyGameConfig implements GameConfig {
  // Define offsets, mappings, detection logic
}

// 2. Pokemon data class  
class MyGamePokemonData extends BasePokemonData {
  // Implement game-specific data reading
}

// 3. Register in games/registry.ts
export const AVAILABLE_CONFIGS = [
  () => new MyGameConfig(),
  // ... existing configs
]
```

## API Reference

### PokemonSaveParser

```typescript
class PokemonSaveParser {
  constructor(saveData?: Uint8Array, config?: GameConfig)
  
  async parseSaveFile(file: File): Promise<SaveData>
  reconstructSaveFile(saveData: SaveData): Uint8Array
  getGameConfig(): GameConfig | null
}
```

### BasePokemonData

```typescript
abstract class BasePokemonData {
  // Core properties
  readonly personality: number
  readonly otId: number
  readonly speciesId: number
  readonly level: number
  readonly stats: readonly number[]
  readonly evs: readonly number[]
  readonly moves: PokemonMoves
  
  // Abstract methods (game-specific)
  abstract get ivs(): readonly number[]
  abstract get isShiny(): boolean
  abstract get shinyNumber(): number
}
```
