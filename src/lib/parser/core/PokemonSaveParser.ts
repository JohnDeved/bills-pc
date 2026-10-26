/**
 * Pokemon Save File Parser
 * TypeScript port of pokemon_save_parser.py with modern browser-compatible features
 */

import { type GameConfig, type PlayTimeData, type PokemonBox, type PokemonStorage, type SaveData, type SectorInfo, VANILLA_EMERALD_SIGNATURE } from './types'

import { MgbaWebSocketClient } from '../../mgba/websocket-client'
import { GameConfigRegistry } from '../games'
import { PokemonBase } from './PokemonBase'

// Import character map for decoding text
import charMap from '../data/pokemon_charmap.json'

/**
 * Decode Pokemon character-encoded text to string
 */
function decodePokemonText(bytes: Uint8Array): string {
  const result: string[] = []

  for (const byte of bytes) {
    if (byte === 0xff) {
      // End of string marker
      break
    }

    const char = charMap[byte.toString() as keyof typeof charMap]
    if (char) {
      result.push(char)
    }
  }

  return result.join('').trim()
}

/**
 * Main Pokemon Save File Parser class
 * Handles parsing of Pokemon Emerald save files in the browser with dependency injection
 * Now supports both file-based and memory-based parsing via WebSocket
 */
export class PokemonSaveParser {
  private saveData: Uint8Array | null = null
  private activeSlotStart = 0
  private readonly sectorMap = new Map<number, number>()
  private readonly forcedSlot: 1 | 2 | undefined
  private config: GameConfig | null = null
  private explicitConfig: boolean
  private parsedBoxes: readonly PokemonBox[] = []
  public saveFileName: string | null = null
  public fileHandle: FileSystemFileHandle | null = null

  // Memory mode properties
  private webSocketClient: MgbaWebSocketClient | null = null
  private isMemoryMode = false

  // Watching properties
  private watchingChanges = false
  private readonly watchListeners: ((partyPokemon: PokemonBase[]) => void)[] = []

  constructor(forcedSlot?: 1 | 2, gameConfig?: GameConfig) {
    this.forcedSlot = forcedSlot
    this.config = gameConfig ?? null
    this.explicitConfig = gameConfig !== undefined
  }

  /**
   * Expose a minimal set of config capabilities for UI feature gating
   */
  public getConfigFlags(): { supportsMega: boolean } {
    const supportsMega = Boolean(this.config && this.config.supportsMega)
    return { supportsMega }
  }

  /**
   * Expose memory layout info needed for write-back in emulator mode
   */
  public getMemoryLayout(): { partyData: number; pokemonSize: number } | null {
    if (!this.config?.memoryAddresses?.partyData) return null
    return { partyData: this.config.memoryAddresses.partyData, pokemonSize: this.config.pokemonSize }
  }

  /**
   * Return the set of external item IDs available in the current game config.
   * Used by the item combobox to filter the item list.
   */
  public getAvailableItemIds(): Set<number> | null {
    const items = this.config?.mappings?.items
    if (!items) return null
    const ids = new Set<number>()
    for (const entry of items.values()) {
      if (entry.id !== null && entry.id !== undefined) ids.add(entry.id)
    }
    return ids
  }

  /**
   * Load input data from a File, ArrayBuffer, or WebSocket connection
   * When WebSocket is provided, switches to memory mode
   */
  async loadInputData(input: File | ArrayBuffer | FileSystemFileHandle | MgbaWebSocketClient): Promise<void> {
    try {
      // Always clear sectorMap before loading new data to avoid stale state
      this.sectorMap.clear()
      this.parsedBoxes = []

      // Check if input is a WebSocket client for memory mode using proper instanceof check
      if (input instanceof MgbaWebSocketClient) {
        await this.initializeMemoryMode(input)
        return
      }

      // Reset memory mode for file operations
      this.isMemoryMode = false
      this.webSocketClient = null

      let buffer: ArrayBuffer

      // Only check instanceof FileSystemFileHandle if it exists (browser)
      if (typeof FileSystemFileHandle !== 'undefined' && input instanceof FileSystemFileHandle) {
        this.fileHandle = input
        input = await input.getFile()
      }

      if (input instanceof File) {
        // save the original file name for later use
        this.saveFileName = input.name

        // Check if arrayBuffer method exists (browser environment)
        if (typeof input.arrayBuffer === 'function') {
          buffer = await input.arrayBuffer()
        } else {
          // Fallback for test environments where File might not have arrayBuffer method
          const reader = new FileReader()
          buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
            reader.addEventListener('load', () => {
              resolve(reader.result as ArrayBuffer)
            })
            reader.addEventListener('error', () => {
              reject(reader.error)
            })
            reader.readAsArrayBuffer(input as File)
          })
        }
      } else {
        buffer = input as ArrayBuffer
      }

      this.saveData = new Uint8Array(buffer)

      // Auto-detect config if not provided
      if (!this.explicitConfig) {
        this.config = GameConfigRegistry.detectGameConfig(this.saveData)
        if (!this.config) {
          throw new Error('Unable to detect game type from save file')
        }
      }
    } catch (error) {
      throw new Error(`Failed to load save file: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Initialize memory mode with WebSocket client and auto-detect config
   */
  private async initializeMemoryMode(client: MgbaWebSocketClient): Promise<void> {
    this.webSocketClient = client
    this.isMemoryMode = true

    // Check if connected
    if (!client.isConnected()) {
      throw new Error('WebSocket client is not connected to mGBA')
    }

    // Get game title to check compatibility
    const gameTitle = await client.getGameTitle()
    console.log(`Memory mode: Connected to game "${gameTitle}"`)

    // Auto-detect config based on game title using overloaded detectGameConfig method
    if (!this.explicitConfig) {
      this.config = GameConfigRegistry.detectGameConfig(gameTitle)

      if (!this.config) {
        throw new Error(`Unsupported game for memory parsing: "${gameTitle}". No compatible config found.`)
      }
    } else if (this.config) {
      // Verify existing config can handle this game
      if (!this.config.canHandleMemory?.(gameTitle)) {
        throw new Error(`Current config "${this.config.name}" cannot handle memory parsing for "${gameTitle}"`)
      }
    }

    if (!this.config) throw new Error('Config not loaded')
    console.log(`Memory mode initialized for ${gameTitle} using config: ${this.config.name}`)
  }

  /**
   * Get information about a specific sector
   */
  private getSectorInfo(sectorIndex: number): SectorInfo {
    if (!this.saveData || !this.config) {
      throw new Error('Save data and config not loaded')
    }

    const footerOffset = sectorIndex * this.config.saveLayout.sectorSize + this.config.saveLayout.sectorSize - 12

    if (footerOffset + 12 > this.saveData.length) {
      return { id: -1, checksum: 0, counter: 0, valid: false }
    }

    try {
      const view = new DataView(this.saveData.buffer, this.saveData.byteOffset + footerOffset, 12)

      const sectorId = view.getUint16(0, true)
      const checksum = view.getUint16(2, true)
      const signature = view.getUint32(4, true)
      const counter = view.getUint32(8, true)

      if (signature !== (this.config.signature ?? VANILLA_EMERALD_SIGNATURE)) {
        return { id: sectorId, checksum, counter, valid: false }
      }

      const sectorStart = sectorIndex * this.config.saveLayout.sectorSize
      const checksumSize = this.config.getSectorDataSize?.(sectorId) ?? this.config.saveLayout.sectorDataSize
      const sectorData = this.saveData.slice(sectorStart, sectorStart + checksumSize)

      const calculatedChecksum = this.calculateSectorChecksum(sectorData)
      const valid = calculatedChecksum === checksum

      return { id: sectorId, checksum, counter, valid }
    } catch {
      return { id: -1, checksum: 0, counter: 0, valid: false }
    }
  }

  /**
   * Determine which save slot is active based on sector counters
   */
  private determineActiveSlot(): void {
    if (!this.config) throw new Error('Config not loaded')
    const count = this.config.saveLayout.slotsPerSave
    const readSlot = (start: number) => {
      const infos = Array.from({ length: count }, (_, index) => this.getSectorInfo(start + index))
      const { counter } = infos[0]!
      const complete = infos.every(info => info.valid && info.id >= 0 && info.id < count && info.counter === counter) && new Set(infos.map(info => info.id)).size === count
      return { start, counter, complete }
    }
    const slots = [readSlot(0), readSlot(count)]
    if (this.forcedSlot !== undefined) {
      const forced = slots[this.forcedSlot - 1]!
      if (!forced.complete) throw new Error('Selected save slot is incomplete or has invalid checksums')
      this.activeSlotStart = forced.start
      return
    }
    const valid = slots.filter(slot => slot.complete)
    if (valid.length === 0) throw new Error('No complete save slot with valid checksums found')
    let selected = valid[0]!
    for (const slot of valid.slice(1)) {
      // Unsigned subtraction also handles the save counter wrapping from 0xffffffff to 0.
      const difference = (slot.counter - selected.counter) >>> 0
      if (difference > 0 && difference < 0x80000000) selected = slot
    }
    this.activeSlotStart = selected.start
  }

  /** Map only the sections from the selected, complete save slot. */
  private buildSectorMap(): void {
    if (!this.config) throw new Error('Config not loaded')
    this.sectorMap.clear()
    for (let index = 0; index < this.config.saveLayout.slotsPerSave; index++) {
      const physical = this.activeSlotStart + index
      const info = this.getSectorInfo(physical)
      if (info.valid) this.sectorMap.set(info.id, physical)
    }
  }

  /**
   * Extract SaveBlock1 data from sectors 1-4
   */
  private extractSaveblock1(): Uint8Array {
    if (!this.saveData || !this.config) {
      throw new Error('Save data and config not loaded')
    }
    const saveblock1Sectors = [1, 2, 3, 4].filter(id => this.sectorMap.has(id))
    if (saveblock1Sectors.length === 0) {
      // Instead of throwing, return a zero-filled buffer to allow parsing to continue gracefully
      return new Uint8Array(this.config.saveLayout.saveBlockSize)
    }

    const saveblock1Data = new Uint8Array(this.config.saveLayout.saveBlockSize)

    for (const sectorId of saveblock1Sectors) {
      const sectorIdx = this.sectorMap.get(sectorId)!
      const startOffset = sectorIdx * this.config.saveLayout.sectorSize
      const sectorData = this.saveData.slice(startOffset, startOffset + this.config.saveLayout.sectorDataSize)
      const chunkOffset = (sectorId - 1) * this.config.saveLayout.sectorDataSize

      saveblock1Data.set(sectorData.slice(0, this.config.saveLayout.sectorDataSize), chunkOffset)
    }

    return saveblock1Data
  }

  /**
   * Extract SaveBlock2 data from sector 0
   */
  private extractSaveblock2(): Uint8Array {
    if (!this.saveData || !this.config) {
      throw new Error('Save data and config not loaded')
    }

    if (!this.sectorMap.has(0)) {
      throw new Error('SaveBlock2 sector (ID 0) not found')
    }

    const sectorIdx = this.sectorMap.get(0)!
    const startOffset = sectorIdx * this.config.saveLayout.sectorSize
    return this.saveData.slice(startOffset, startOffset + this.config.saveLayout.sectorDataSize)
  }

  private extractBoxStorage(): Uint8Array {
    if (!this.saveData || !this.config) throw new Error('Save data and config not loaded')
    const { sectorDataSize, sectorSize, slotsPerSave } = this.config.saveLayout
    const storage = new Uint8Array((slotsPerSave - 5) * sectorDataSize)
    for (let id = 5; id < slotsPerSave; id++) {
      const physical = this.sectorMap.get(id)
      if (physical === undefined) throw new Error(`PC storage section ${id} is missing`)
      const offset = physical * sectorSize
      storage.set(this.saveData.subarray(offset, offset + sectorDataSize), (id - 5) * sectorDataSize)
    }
    return storage
  }

  private parseBoxStorage(): PokemonStorage {
    if (!this.config) throw new Error('Config not loaded')
    const storage = this.extractBoxStorage()
    if (this.config.parseBoxStorage) return this.config.parseBoxStorage(storage)

    const boxes = Array.from({ length: 14 }, (_, boxIndex): PokemonBox => {
      const nameOffset = 0x8344 + boxIndex * 9
      const name = decodePokemonText(storage.subarray(nameOffset, nameOffset + 9)) || `BOX${boxIndex + 1}`
      const pokemon = Array.from({ length: 30 }, (_, slot) => {
        const offset = 4 + (boxIndex * 30 + slot) * 80
        const bytes = storage.slice(offset, offset + 80)
        if (bytes.every(byte => byte === 0)) return null
        const mon = new PokemonBase(bytes, this.config!, true)
        return mon.speciesId === 0 ? null : mon
      })
      return { name, pokemon }
    })
    return { boxes, currentBox: Math.min(storage[0] ?? 0, boxes.length - 1) }
  }

  private writeBoxStorage(boxes: readonly PokemonBox[]): Uint8Array {
    if (!this.config) throw new Error('Config not loaded')
    const storage = this.extractBoxStorage()
    if (this.config.writeBoxStorage) return this.config.writeBoxStorage(storage, boxes)
    if (boxes.length !== 14 || boxes.some(box => box.pokemon.length !== 30)) throw new Error('Invalid PC box dimensions')
    boxes.forEach((box, boxIndex) => {
      box.pokemon.forEach((mon, slot) => {
        // Editing only: preserve empty records, names, wallpapers, and every unrelated byte.
        if (!mon) return
        const bytes = mon.rawBytes
        if (!mon.isBoxed || bytes.length !== 80) throw new Error('Invalid boxed Pokemon record')
        storage.set(bytes, 4 + (boxIndex * 30 + slot) * 80)
      })
    })
    return storage
  }

  /**
   * Parse party Pokemon from SaveBlock1 data or memory
   */
  private async parsePartyPokemon(saveblock1Data?: Uint8Array): Promise<PokemonBase[]> {
    if (!this.config) {
      throw new Error('Config not loaded')
    }

    // Memory mode: read directly from emulator memory
    if (this.isMemoryMode && this.webSocketClient) {
      const { memoryAddresses } = this.config
      if (!memoryAddresses) {
        throw new Error(`Config "${this.config.name}" does not define memory addresses for memory parsing`)
      }

      // Get party count from WebSocket cache
      const partyCountBuffer = await this.webSocketClient.readBytes(memoryAddresses.partyCount, 1)
      const partyCountValue = partyCountBuffer[0] ?? 0

      const { maxPartySize } = this.config
      if (partyCountValue < 0 || partyCountValue > maxPartySize) {
        throw new Error(`Invalid party count: ${partyCountValue}. Expected 0-${maxPartySize}.`)
      }

      // Get party data from WebSocket cache (read all at once for efficiency)
      const partyDataBuffer = await this.webSocketClient.readBytes(memoryAddresses.partyData, maxPartySize * this.config.pokemonSize)

      const pokemon: PokemonBase[] = []

      for (let i = 0; i < partyCountValue; i++) {
        const pokemonOffset = i * this.config.pokemonSize
        const pokemonBytes = partyDataBuffer.slice(pokemonOffset, pokemonOffset + this.config.pokemonSize) as Uint8Array
        const pokemonInstance = new PokemonBase(pokemonBytes, this.config)

        // Stop at empty slots (species ID = 0)
        if (pokemonInstance.speciesId === 0) {
          break
        }

        pokemon.push(pokemonInstance)
      }

      return pokemon
    }

    // File mode: parse from SaveBlock1 data
    if (!saveblock1Data) {
      throw new Error('SaveBlock1 data required for file mode')
    }
    const partyPokemon: PokemonBase[] = []

    for (let slot = 0; slot < this.config.maxPartySize; slot++) {
      const offset = this.config.saveLayout.partyOffset + slot * this.config.pokemonSize
      const data = saveblock1Data.slice(offset, offset + this.config.pokemonSize)

      if (data.length < this.config.pokemonSize) {
        break
      }

      try {
        const pokemon = new PokemonBase(data, this.config)
        // Check if Pokemon slot is empty (species ID = 0)
        if (pokemon.speciesId === 0) {
          break
        }
        partyPokemon.push(pokemon)
      } catch (error) {
        console.warn(`Failed to parse Pokemon at slot ${slot}:`, error)
        break
      }
    }

    return partyPokemon
  }

  /**
   * Parse player name from SaveBlock2 data
   */
  private parsePlayerName(saveblock2Data: Uint8Array): string {
    const playerNameBytes = saveblock2Data.slice(0, 8)
    return decodePokemonText(playerNameBytes)
  }

  /**
   * Parse play time from SaveBlock2 data
   */
  private parsePlayTime(saveblock2Data: Uint8Array): PlayTimeData {
    if (!this.config) {
      throw new Error('Config not loaded')
    }

    const view = new DataView(saveblock2Data.buffer, saveblock2Data.byteOffset)

    return {
      hours: view.getUint16(this.config.saveLayout.playTimeHours, true), // u16 playTimeHours
      minutes: view.getUint8(this.config.saveLayout.playTimeMinutes), // u8 playTimeMinutes
      seconds: view.getUint8(this.config.saveLayout.playTimeSeconds), // u8 playTimeSeconds
    }
  }

  /**
   * Calculate checksum for a sector's data
   */
  private calculateSectorChecksum(sectorData: Uint8Array): number {
    let checksum = 0
    const view = new DataView(sectorData.buffer, sectorData.byteOffset, sectorData.byteLength)
    for (let offset = 0; offset + 4 <= sectorData.length; offset += 4) {
      checksum = (checksum + view.getUint32(offset, true)) >>> 0
    }
    return ((checksum >>> 16) + (checksum & 0xffff)) & 0xffff
  }

  /**
   * Update the party Pokémon in a SaveBlock1 buffer with the given PokemonInstance array.
   * Returns a new Uint8Array with the updated party data.
   * @param saveblock1 The original SaveBlock1 buffer
   * @param party Array of PokemonInstance (max length = config.layout.party.maxSize)
   */
  private updatePartyInSaveblock1(saveblock1: Uint8Array, party: readonly PokemonBase[]): Uint8Array {
    if (!this.config) {
      throw new Error('Config not loaded')
    }

    if (saveblock1.length < this.config.saveLayout.saveBlockSize) {
      throw new Error(`SaveBlock1 must be at least ${this.config.saveLayout.saveBlockSize} bytes`)
    }
    if (party.length > this.config.maxPartySize) {
      throw new Error(`Party size cannot exceed ${this.config.maxPartySize}`)
    }

    const updated = new Uint8Array(saveblock1)
    for (let i = 0; i < party.length; i++) {
      const offset = this.config.saveLayout.partyOffset + i * this.config.pokemonSize
      if (party[i]!.isBoxed || party[i]!.rawBytes.length !== this.config.pokemonSize) throw new Error('Invalid party Pokemon record')
      // Use the most up-to-date raw data for each Pokemon
      updated.set(party[i]!.rawBytes, offset)
    }
    return updated
  }

  /**
   * Parse input data and return structured data
   * Supports both file and memory input via WebSocket
   */
  async parse(input: File | ArrayBuffer | FileSystemFileHandle | MgbaWebSocketClient): Promise<SaveData> {
    await this.loadInputData(input)

    // Memory mode: read directly from emulator memory
    if (this.isMemoryMode && this.webSocketClient) {
      const partyPokemon = await this.parsePartyPokemon()

      // TODO: Implement memory support for player name and playtime
      // These fields should be read from memory addresses when implemented
      return {
        party_pokemon: partyPokemon,
        player_name: 'MEMORY', // TODO: Read from memory if needed
        play_time: { hours: 0, minutes: 0, seconds: 0 }, // TODO: Read from memory if needed
        active_slot: 0, // Memory doesn't have multiple save slots
      }
    }

    // File mode: existing logic
    this.determineActiveSlot()
    this.buildSectorMap()

    const saveblock1Data = this.extractSaveblock1()
    const saveblock2Data = this.extractSaveblock2()

    const playerName = this.parsePlayerName(saveblock2Data)
    const partyPokemon = await this.parsePartyPokemon(saveblock1Data)
    const playTime = this.parsePlayTime(saveblock2Data)
    let storage: PokemonStorage | undefined
    let boxError: string | undefined
    try {
      storage = this.parseBoxStorage()
      this.parsedBoxes = storage.boxes
    } catch (error) {
      // An unknown hack storage variant must not prevent existing party edits, or be rewritten.
      boxError = error instanceof Error ? error.message : 'PC storage format is not supported'
    }

    return {
      party_pokemon: partyPokemon,
      boxes: storage?.boxes,
      current_box: storage?.currentBox,
      box_error: boxError,
      player_name: playerName,
      play_time: playTime,
      active_slot: this.activeSlotStart,
      sector_map: this.sectorMap,
      rawSaveData: this.saveData,
    }
  }

  /**
   * Get the current game configuration
   */
  getGameConfig(): GameConfig | null {
    return this.config
  }

  /**
   * Set the game configuration (useful for testing or manual override)
   */
  setGameConfig(config: GameConfig): void {
    this.config = config
    this.explicitConfig = true
  }

  /**
   * Get the currently active game config
   */
  get gameConfig(): GameConfig | null {
    return this.config
  }

  /**
   * Reconstruct the full save file from a new party (PokemonInstance[]).
   * Updates SaveBlock1 with the given party and returns a new Uint8Array representing the reconstructed save file.
   *
   * @param partyPokemon Array of PokemonInstance to update party in SaveBlock1
   */
  reconstructSaveFile(partyPokemon: readonly PokemonBase[], boxes: readonly PokemonBox[] = this.parsedBoxes): Uint8Array {
    if (!this.saveData || !this.config) throw new Error('Save data and config not loaded')

    const baseSaveblock1 = this.extractSaveblock1()
    const updatedSaveblock1 = this.updatePartyInSaveblock1(baseSaveblock1, partyPokemon)
    const newSave = new Uint8Array(this.saveData)

    // Helper to write a sector and update its checksum
    const writeSector = (sectorId: number, data: Uint8Array) => {
      if (!this.config) throw new Error('Game configuration not loaded during sector reconstruction')

      if (!this.sectorMap.has(sectorId)) throw new Error(`Save section ${sectorId} is missing`)
      const sectorIdx = this.sectorMap.get(sectorId)!
      const startOffset = sectorIdx * this.config.saveLayout.sectorSize
      if (data.every((byte, index) => byte === newSave[startOffset + index])) return
      newSave.set(data, startOffset)
      // Recalculate checksum for this sector
      const checksumSize = this.config.getSectorDataSize?.(sectorId) ?? this.config.saveLayout.sectorDataSize
      const checksum = this.calculateSectorChecksum(newSave.subarray(startOffset, startOffset + checksumSize))
      const footerOffset = startOffset + this.config.saveLayout.sectorSize - 12
      const view = new DataView(newSave.buffer, newSave.byteOffset + footerOffset, 12)
      view.setUint16(2, checksum, true)
    }

    // Write SaveBlock1 (sectors 1-4)
    for (let sectorId = 1; sectorId <= 4; sectorId++) {
      const chunkOffset = (sectorId - 1) * this.config.saveLayout.sectorDataSize
      const chunk = updatedSaveblock1.slice(chunkOffset, chunkOffset + this.config.saveLayout.sectorDataSize)
      writeSector(sectorId, chunk)
    }
    if (boxes.length > 0) {
      const storage = this.writeBoxStorage(boxes)
      const { sectorDataSize, slotsPerSave } = this.config.saveLayout
      if (storage.length !== (slotsPerSave - 5) * sectorDataSize) throw new Error('Invalid PC storage size')
      for (let sectorId = 5; sectorId < slotsPerSave; sectorId++) {
        const offset = (sectorId - 5) * sectorDataSize
        writeSector(sectorId, storage.subarray(offset, offset + sectorDataSize))
      }
    }
    return newSave
  }

  /**
   * Check if parser is in memory mode
   */
  isInMemoryMode(): boolean {
    return this.isMemoryMode
  }

  /**
   * Get the WebSocket client (for memory mode)
   */
  getWebSocketClient(): MgbaWebSocketClient | null {
    return this.webSocketClient
  }

  /**
   * Start watching for Pokemon party changes in memory mode
   * This will automatically set up memory watching for the party data regions
   * and call the provided callback when changes are detected
   */
  async watch(options: { onPartyChange?: (partyPokemon: PokemonBase[]) => void; onError?: (error: Error) => void } = {}): Promise<void> {
    if (!this.isMemoryMode || !this.webSocketClient) {
      throw new Error('Watch mode only available in memory mode (WebSocket connection)')
    }

    if (this.watchingChanges) {
      throw new Error('Already watching memory. Call stopWatching() first.')
    }

    if (!this.config?.preloadRegions) {
      throw new Error('No memory addresses configured for watching')
    }

    const handleError = (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error))
      if (options.onError) {
        options.onError(err)
      } else {
        throw err
      }
    }

    try {
      // Add callback to listeners if provided
      if (options.onPartyChange) {
        this.watchListeners.push(options.onPartyChange)
      }

      // Set up memory change listener
      this.webSocketClient.addMemoryChangeListener(async (address, size, data) => {
        try {
          await this.handleMemoryChange(address, size, data)
        } catch (error) {
          handleError(error)
        }
      })

      this.watchingChanges = true
      await this.webSocketClient.startWatching([...this.config.preloadRegions])
    } catch (error) {
      handleError(error)
    }
  }

  /**
   * Handle memory changes from WebSocket (simplified without buffer management)
   */
  private async handleMemoryChange(address: number, _size: number, _data: Uint8Array): Promise<void> {
    if (!this.webSocketClient || !this.config?.memoryAddresses) return

    try {
      // Check if this address is relevant to our party data
      const { partyData, partyCount } = this.config.memoryAddresses
      const { pokemonSize, maxPartySize } = this.config

      const isRelevantAddress = address === partyCount || (address >= partyData && address < partyData + maxPartySize * pokemonSize)

      if (!isRelevantAddress) {
        return
      }

      // Check if we have enough data to parse party Pokemon
      const hasRequiredData = await this.hasMemoryData()
      if (!hasRequiredData) {
        // Not enough data yet, wait for more updates
        return
      }

      // Parse fresh Pokemon objects from WebSocket cache
      const updatedPartyPokemon = await this.parsePartyPokemon()

      // Notify all listeners (no need for change detection as server only sends when changed)
      for (const listener of this.watchListeners) {
        try {
          listener(updatedPartyPokemon)
        } catch (error) {
          console.error('Watch listener error:', error)
        }
      }
    } catch (error) {
      console.error('Error handling party data change:', error)
    }
  }

  /**
   * Check if we have required memory data by attempting to read from WebSocket cache
   */
  private async hasMemoryData(): Promise<boolean> {
    if (!this.config?.memoryAddresses || !this.webSocketClient) return false

    const { partyData, partyCount } = this.config.memoryAddresses
    try {
      // Try to read party count (1 byte) and party data (first pokemon) from cache
      await this.webSocketClient.readBytes(partyCount, 1)
      await this.webSocketClient.readBytes(partyData, this.config.pokemonSize)
      return true
    } catch {
      return false
    }
  }

  /**
   * Stop watching for memory changes
   */
  async stopWatching(): Promise<void> {
    if (!this.webSocketClient) {
      return
    }

    try {
      await this.webSocketClient.stopWatching()
      this.watchingChanges = false
      this.watchListeners.length = 0
    } catch (error) {
      console.error('Error stopping watch mode:', error)
    }
  }

  /**
   * Check if currently watching for changes
   */
  isWatching(): boolean {
    return this.watchingChanges
  }

  /**
   * Get current save data without re-initializing WebSocket connection
   * Useful for getting data after memory mode initialization but before watch setup
   */
  async getCurrentSaveData(): Promise<SaveData> {
    if (!this.isMemoryMode || !this.webSocketClient) {
      throw new Error('getCurrentSaveData only available in memory mode')
    }

    const partyPokemon = await this.parsePartyPokemon()

    return {
      party_pokemon: partyPokemon,
      player_name: 'MEMORY',
      play_time: { hours: 0, minutes: 0, seconds: 0 },
      active_slot: 0,
    }
  }
}

// Export for easier usage
export default PokemonSaveParser
