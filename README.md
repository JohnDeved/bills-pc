# Bill's PC

A web-based Pokémon save file editor, CLI tool, and TypeScript parser core with PWA support.

https://github.com/user-attachments/assets/c0cf27de-2d38-4185-9356-a7cc493a5d53

## 🚀 Features

- **Progressive Web App (PWA)**: Install for offline use and app-like experience
- **Multi-Game Support**: Works with various Pokemon games and ROM hacks
- **Real-time Editing**: Interactive Pokemon data visualization and editing
- **File System Integration**: Modern browser file API support
- **Cross-Platform**: Web, CLI, and library usage
- **Mega Stats Preview**: Preview stats if a Mega Evolution exists (gated by game config)
- **PC Box Editing**: Browse named boxes and edit stored Pokémon's IVs, EVs, nature, ability, and held item in Emerald and Quetzal
- **Emerald → Quetzal Transfers**: Copy party and boxed Pokémon into empty Quetzal slots with a guided preview, format review and separate save download

### Editing Pokémon in the PC

Open a save file, select **PC boxes**, choose a box, and select an occupied slot.
The same editor used for the party now applies to that Pokémon. **Undo**, **Redo**,
**Reset**, and the File menu's save/download actions include box edits. Reopen the
exported `.sav` in your game to use the changes.
Box sprites animate only while selected, matching the party list; hovering keeps other Pokémon still.
Party and PC views share a stable layout, with matching blurred panels and consistent spacing on desktop and mobile.

Emerald supports its 14 boxes. Quetzal supports its packed 21-, 31-, and 38-byte
storage layouts (67, 45, and 37 boxes respectively). Quetzal stores box EVs in
multiples of four; the controls use that increment. Layouts without saved PP show
`PP —`. If a Quetzal box format cannot be identified unambiguously, the app explains
that box editing is unavailable and preserves the original PC data when saving
party changes. Live emulator connections currently expose the party only.

Emerald nature edits preserve gender, shiny status, Unown's letter, and Wurmple's
evolution branch. Spinda's nature control is disabled because Emerald stores its
nature and spot pattern in the same personality value; changing one would change
the other. Damaged Emerald PC records (invalid Pokémon checksum or Bad Egg flag)
also disable PC editing while preserving the original PC bytes.

### Transferring an Emerald team to Quetzal

Select **Transfer Pokémon** on the landing screen, or **File → Transfer Pokémon…** in the editor.
Choose an Emerald source save and a Quetzal destination save, select Pokémon from
the source party or PC, and choose a destination box. The preview reserves empty
slots without replacing existing Pokémon. Review the locations and conversion
changes, acknowledge them, and download the new Quetzal save.

Both originals remain unchanged. An open editor file is captured with its current
edits; opening a transfer result first downloads a backup of that initial editor
snapshot. The transfer never writes through the original file's save handle.

Quetzal's compact format cannot retain every Emerald field. Level, nature,
gender, shininess and IVs are preserved for supported Pokémon; XP/EV precision,
nickname support and identity metadata have explicit format-specific reviews.
Eggs, damaged records, unsupported mappings, personality-dependent special cases
and incompatible held items are blocked. The copied record is not a lossless
Emerald clone; the source save retains the complete original Pokémon.

See the [complete user flow and screenshots](docs/pokemon-transfer-flow.md),
[conversion and compatibility reference](src/lib/parser/transfer/README.md), and
[independent save-integrity evidence](docs/transfer-validation.md).

### Box editing and transfer tests

```bash
npm ci
npm test
npm run build
npx playwright install chromium
npx playwright test src/__tests__/box-editing.e2e.test.ts src/__tests__/pokemon-transfer.e2e.test.ts --project=chromium --project='Mobile Chrome'
```

The tests use the checked-in Emerald and Quetzal saves. Quetzal already contains
232 boxed Pokémon; Emerald's PC is empty, so additional tests place its actual
Treecko record into known box slots without using the parser being tested.
Coverage includes sector-spanning records, final slots, encrypted Pokémon and
section checksums, preservation of other Pokémon and save data, save-slot
selection, file switching, undo/redo, and browser download/reopen workflows.

To run the browser workflow against another populated Emerald save, set
`BILLS_PC_EMERALD_SAVE` to its absolute path. The workflow expects an occupied
first slot in the first box:

```bash
BILLS_PC_EMERALD_SAVE=/path/to/emerald.sav npx playwright test src/__tests__/box-editing.e2e.test.ts --project=chromium --project='Mobile Chrome'
```

## Quick Start

### Web Application (PWA)
```bash
npm install
npm run dev
```
Open your browser and drag & drop a Pokemon save file to get started.

**PWA Features:**
- 📱 Install as native app on desktop and mobile
- 🔄 Works offline with previously loaded save files
- ⚡ Fast loading with optimized caching
- 🎨 Native app-like interface and theming

### Command Line
```bash
# Parse a save file
npx github:JohnDeved/pokemon-save-web save.sav

# With debug output
npx github:JohnDeved/pokemon-save-web save.sav --debug
```

### As a Library
```typescript
import { PokemonSaveParser } from './lib/parser'

const parser = new PokemonSaveParser()
const saveData = await parser.parseSaveFile(file)
console.log(`Player: ${saveData.player_name}`)
```

```typescript
import { MgbaWebSocketClient, EmeraldMemoryParser } from './lib/mgba'

// Connect to mGBA emulator
const client = new MgbaWebSocketClient()
await client.connect()

// Configure memory regions to watch for real-time updates
client.configureSharedBuffer({
  preloadRegions: [
    { address: 0x20244e9, size: 7 },   // Party count + context
    { address: 0x20244ec, size: 600 }  // Full party data
  ]
})

// Start watching for memory changes (push-based updates)
await client.startWatchingPreloadRegions()

// Add listener for real-time memory changes
client.addMemoryChangeListener((address, size, data) => {
  console.log(`Memory changed at 0x${address.toString(16)}: ${data.length} bytes`)
})

// Parse save data from memory
const parser = new EmeraldMemoryParser(client)
const saveData = await parser.parseFromMemory()

console.log(`Player: ${saveData.player_name}`)
console.log(`Party: ${saveData.party_pokemon.length} Pokémon`)
```

### Real-time Memory Synchronization

The WebSocket client now supports **push-based memory updates**:

- **Memory Watching**: Configure regions to watch and receive updates only when they change
- **Intelligent Caching**: Watched regions use cached data, dramatically reducing network calls
- **Real-time Notifications**: React to memory changes as they happen in the emulator

## Usage

### 1. Web Application

The main web application provides a user-friendly interface for uploading and analyzing save files.

```bash
npm install
npm run dev    # Start development server
npm run build  # Build for production (includes PWA)
npm run preview # Preview PWA build locally
```

**Features:**
- Drag-and-drop save file upload
- Interactive Pokemon data visualization  
- Real-time editing capabilities
- File System Access API support for modern browsers
- **PWA Support**: Install as native app with offline functionality
- **Optimized Performance**: Code splitting and smart caching

### 2. JavaScript/TypeScript Library

Use the parser as a library in your own projects with full TypeScript support.

```typescript
import { PokemonSaveParser } from './lib/parser'

// Auto-detect game type and parse
const parser = new PokemonSaveParser()
const saveData = await parser.parseSaveFile(file)
console.log(`Player: ${saveData.player_name}`)
console.log(`Party size: ${saveData.party_pokemon.length}`)

// Manual configuration
const config = new QuetzalConfig()
const parser = new PokemonSaveParser(undefined, config)
```

### 3. Command Line Interface

Parse save files from the command line with multiple output formats.

```bash
# Local usage
npm run parse save.sav --debug

# NPX usage (direct from GitHub)  
npx github:JohnDeved/pokemon-save-web save.sav --graph
```

**CLI Options:**
- `--debug` - Show raw bytes for each party Pokemon after the summary table
- `--graph` - Show colored hex/field graph for each party Pokemon
- `--watch` - Continuously monitor for changes and update display
- `--websocket` - Connect to mGBA via WebSocket instead of reading a file
- `--ws-url=URL` - WebSocket URL (default: ws://localhost:7102/ws)
- `--interval=MS` - Update interval in milliseconds for file watch mode (default: 1000)
- `--toBytes=STRING` - Convert a string to GBA byte encoding
- `--toString=HEX` - Convert space/comma-separated hex bytes to a decoded GBA string

**Event-Driven Watch Mode:**

For real-time Pokemon data monitoring, use WebSocket mode with watch:

```bash
# Event-driven real-time monitoring (push-based)
npx github:JohnDeved/pokemon-save-web --websocket --watch

# Traditional file watching (polling-based) 
npx github:JohnDeved/pokemon-save-web save.sav --watch --interval=2000
```

**WebSocket Watch Mode Features:**
- **Push-based Updates**: Instant notifications when party data changes (no polling!)
- **Memory Region Watching**: Monitors specific memory addresses for Pokemon party data
- **Real-time Display**: Updates immediately when Pokemon HP, level, or party composition changes
- **Zero Network Overhead**: Only receives data when memory actually changes
- **Intelligent Caching**: Uses cached data for watched regions, reducing emulator load

The WebSocket watch mode automatically configures memory watching for:
- Party count and context data (address 0x20244e9, 7 bytes)
- Full party Pokemon data (address 0x20244ec, 600 bytes)

When connected to mGBA emulator, the CLI will display live updates as you play!

## Adding Game Support

The parser uses a flexible GameConfig system that makes it easy to add support for new Pokemon games and ROM hacks.

```typescript
export class MyGameConfig implements GameConfig {
  readonly name = 'My Pokemon Game'
  readonly signature = 0x12345678
  readonly offsets = { /* game-specific offsets */ }
  readonly mappings = { /* pokemon/item/move mappings */ }
  
  canHandle(saveData: Uint8Array): boolean {
    // Detection logic
  }
  
  determineActiveSlot(getCounterSum: (range: number[]) => number): number {
    // Slot selection logic
  }
}
```
