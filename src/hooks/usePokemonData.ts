import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PokeAPI } from 'pokeapi-types/dist/index'
import { useCallback, useEffect } from 'react'
import { buildBoxListFromSaveData, buildPartyListFromSaveData, findPokemon, selectActivePokemon, usePokemonStore, useSaveFileStore } from '../stores'
import { calculateTotalStats } from '@/lib/parser/core/utils'
import type { SaveData } from '@/lib/parser/core/types'
import { type MoveWithDetails, type PokemonType, PokemonTypeSchema, type PokemonDetails, type UIPokemonData, type Ability as UiAbility } from '../types'

// --- Constants ---
const UNKNOWN_TYPE: PokemonType = 'UNKNOWN'
const NO_MOVE: MoveWithDetails = {
  pp: 0,
  id: 0,
  name: 'None',
  type: UNKNOWN_TYPE,
  description: 'No move assigned.',
  power: null,
  accuracy: null,
}

// --- Utility Functions ---
const formatName = (name: string): string => name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())

const parsePokemonType = (apiType: string): PokemonType => {
  const result = PokemonTypeSchema.safeParse(apiType.toUpperCase())
  return result.success ? result.data : UNKNOWN_TYPE
}

// Lightweight fetch helper: rely on PokeAPI TypeScript types + targeted guards
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch from ${url}: ${response.statusText}`)
  return (await response.json()) as T
}

// Pick best English effect text if present
function pickEnglishEffect(entries: PokeAPI.VerboseEffect[] | undefined): string | undefined {
  if (!Array.isArray(entries)) return undefined
  const e = entries.find(x => x.language?.name === 'en')
  return e?.effect
}

// Pick latest English flavor text (based on trailing numeric id in version/version_group URL)
function pickLatestEnglishFlavorText(
  entries:
    | {
        flavor_text: string
        language: { name: string }
        version_group?: { url: string }
        version?: { url: string }
      }[]
    | undefined
): string | undefined {
  if (!Array.isArray(entries)) return undefined
  let best: { text: string; id: number } | undefined
  for (const entry of entries) {
    if (entry.language?.name !== 'en') continue
    const url = entry.version_group?.url ?? entry.version?.url ?? ''
    const id = (() => {
      const m = url.match(/\/(\d+)\/?$/)
      return m ? parseInt(m[1]!, 10) : 0
    })()
    const text = entry.flavor_text
    if (!text) continue
    if (!best || id > best.id) best = { text, id }
  }
  return best?.text?.replace(/\s+/g, ' ').trim()
}

function getAbilityDescription(ability: PokeAPI.Ability): string {
  return pickEnglishEffect(ability.effect_entries) || pickLatestEnglishFlavorText(ability.flavor_text_entries) || 'No description available.'
}

function getMoveDescription(move: PokeAPI.Move): string {
  return pickEnglishEffect(move.effect_entries) || pickLatestEnglishFlavorText(move.flavor_text_entries) || 'No description available.'
}

function belongsToSave(pokemon: UIPokemonData, saveData: SaveData | null): boolean {
  return !!saveData && (saveData.party_pokemon.includes(pokemon.data) || !!saveData.boxes?.some(box => box.pokemon.includes(pokemon.data)))
}

// Box records store experience, but no party level or battle stats.
async function getBoxLevel(pokemon: UIPokemonData, speciesUrl: string): Promise<number | undefined> {
  if (!pokemon.data.isBoxed) return undefined
  if (pokemon.data.level > 0) return pokemon.data.level
  const growthUrl = pokemon.data.boxGrowthRate ? `https://pokeapi.co/api/v2/growth-rate/${pokemon.data.boxGrowthRate}` : (await fetchJson<PokeAPI.PokemonSpecies>(speciesUrl)).growth_rate.url
  const growth = await fetchJson<{ levels: { experience: number; level: number }[] }>(growthUrl)
  const { experience } = pokemon.data
  return growth.levels.reduce((level, entry) => (entry.experience <= experience ? Math.max(level, entry.level) : level), 1)
}

function hydrateBoxPokemon(pokemon: UIPokemonData, details: PokemonDetails): UIPokemonData {
  if (pokemon.data.isBoxed && details.boxLevel !== undefined) {
    pokemon.data.setBoxLevel(details.boxLevel)
    pokemon.data.setStats(calculateTotalStats(pokemon.data, details.baseStats))
  }
  return { ...pokemon, details }
}

/**
 * Fetches all details for a Pokémon, including moves and abilities.
 */
export async function getPokemonDetails(pokemon: UIPokemonData) {
  const { data } = pokemon
  const pokeData = await fetchJson<PokeAPI.Pokemon>(`https://pokeapi.co/api/v2/pokemon/${data.speciesId}`)
  const moveSources = [data.moves.move1, data.moves.move2, data.moves.move3, data.moves.move4]
  const [moveResults, boxLevel] = await Promise.all([
    Promise.all(moveSources.map(move => (move.id === 0 ? null : fetchJson<PokeAPI.Move>(`https://pokeapi.co/api/v2/move/${move.id}`).catch(() => null)))),
    getBoxLevel(pokemon, pokeData.species?.url ?? `https://pokeapi.co/api/v2/pokemon-species/${data.speciesId}`),
  ])
  const abilityEntries = pokeData.abilities
  const abilities: UiAbility[] = await Promise.all(
    abilityEntries.map(async entry => {
      try {
        const abilityData = await fetchJson<PokeAPI.Ability>(entry.ability.url)
        return {
          slot: entry.slot,
          name: formatName(abilityData.name),
          description: getAbilityDescription(abilityData),
        }
      } catch {
        return {
          slot: entry.slot,
          name: entry.ability.name,
          description: 'Could not fetch ability data.',
        }
      }
    })
  )
  const types = pokeData.types.map(t => parsePokemonType(t.type.name))
  // Extract base stats in correct order
  const baseStats = ['hp', 'attack', 'defense', 'speed', 'special-attack', 'special-defense'].map(stat => pokeData.stats.find(s => s.stat?.name === stat)?.base_stat ?? 0)
  const moves: MoveWithDetails[] = moveSources.map((move, i) => {
    if (move.id === 0) {
      return { ...NO_MOVE }
    }
    const validMove = moveResults[i]
    if (validMove) {
      return {
        id: move.id,
        name: formatName(validMove.name),
        pp: move.pp,
        type: validMove.type?.name ? parsePokemonType(validMove.type.name) : UNKNOWN_TYPE,
        description: getMoveDescription(validMove),
        power: validMove.power ?? null,
        accuracy: validMove.accuracy ?? null,
        damageClass: validMove.damage_class?.name === 'physical' || validMove.damage_class?.name === 'special' || validMove.damage_class?.name === 'status' ? validMove.damage_class.name : undefined,
        target: validMove.target?.name,
      }
    }
    return {
      id: move.id,
      name: `Move #${move.id}`,
      pp: move.pp,
      type: UNKNOWN_TYPE,
      description: 'Failed to load move details.',
      power: null,
      accuracy: null,
    }
  })
  // Item details are fetched separately for fine-grained loading states
  return { types, abilities, moves, baseStats, boxLevel }
}

/**
 * React hook for accessing and managing Pokémon party data and details.
 * This is a compatibility layer that uses Zustand stores but maintains the same API.
 */
export const usePokemonData = () => {
  // Get state from Zustand stores using selectors to avoid over-subscribing
  const activePokemonId = usePokemonStore(s => s.activePokemonId)
  const partyList = usePokemonStore(s => s.partyList)
  const boxList = usePokemonStore(s => s.boxList)
  const setActivePokemonId = usePokemonStore(s => s.setActivePokemonId)
  const setEvIndex = usePokemonStore(s => s.setEvIndex)
  const setIvIndex = usePokemonStore(s => s.setIvIndex)
  const setNature = usePokemonStore(s => s.setNature)
  const getRemainingEvs = usePokemonStore(s => s.getRemainingEvs)
  const resetPokemonData = usePokemonStore(s => s.resetPokemonData)

  // Get save file state
  const saveData = useSaveFileStore(state => state.saveData)
  const saveSessionId = useSaveFileStore(state => state.saveSessionId)
  const isParsingSave = useSaveFileStore(state => state.isLoading)
  const lastUpdateTransient = useSaveFileStore(state => state.lastUpdateTransient)

  const queryClient = useQueryClient()

  // Initialize party list when save data changes
  useEffect(() => {
    if (!saveData?.party_pokemon) {
      resetPokemonData()
      return
    }

    // Skip rebuilding party list for transient reorder updates
    if (lastUpdateTransient && saveData.__transient__) {
      return
    }

    const initialPartyList = buildPartyListFromSaveData(saveData)
    const initialBoxList = buildBoxListFromSaveData(saveData)

    if (lastUpdateTransient) {
      // Preserve existing details to avoid flashing during undo/redo/reset
      const previous = usePokemonStore.getState()
      const previousById = new Map(previous.partyList.map(p => [p.id, p]))
      for (const box of previous.boxList) {
        for (const pokemon of box.pokemon) {
          if (pokemon) previousById.set(pokemon.id, pokemon)
        }
      }
      const preserveDetails = (pokemon: UIPokemonData) => {
        const prevPokemon = previousById.get(pokemon.id)
        return prevPokemon?.details && prevPokemon.data.speciesId === pokemon.data.speciesId ? hydrateBoxPokemon(pokemon, prevPokemon.details) : pokemon
      }
      const merged = initialPartyList.map(preserveDetails)
      const mergedBoxes = initialBoxList.map(box => ({ ...box, pokemon: box.pokemon.map(p => (p ? preserveDetails(p) : null)) }))
      usePokemonStore.setState({ partyList: merged, boxList: mergedBoxes })
      // Ensure active selection remains valid after history navigation.
      const current = usePokemonStore.getState()
      if (!selectActivePokemon(current)) {
        const candidates = current.storageView === 'party' ? merged : (mergedBoxes[current.activeBoxIndex]?.pokemon ?? [])
        setActivePokemonId(candidates.find(p => p)?.id ?? -1)
      }
      // Do not clear queries on transient updates
    } else {
      const activeBoxIndex = Math.max(0, Math.min(saveData.current_box ?? 0, initialBoxList.length - 1))
      usePokemonStore.setState({
        partyList: initialPartyList,
        boxList: initialBoxList,
        activeBoxIndex,
        storageView: initialPartyList.length ? 'party' : 'boxes',
        activePokemonId: initialPartyList[0]?.id ?? initialBoxList[activeBoxIndex]?.pokemon.find(p => p)?.id ?? -1,
      })
      // Clear cached pokemon details to avoid stale data after loading a new file
      queryClient.removeQueries({ queryKey: ['pokemon', 'details'] })
    }
  }, [saveData, resetPokemonData, queryClient, lastUpdateTransient, setActivePokemonId])

  // Get the current active Pokémon
  const activePokemon = usePokemonStore(selectActivePokemon)
  const activePokemonData = activePokemon?.data
  const activePokemonBelongsToSave = !!activePokemon && belongsToSave(activePokemon, saveData)

  // Query for details of the active Pokémon
  const {
    data: detailedData,
    isLoading,
    isError,
    error,
  } = useQuery({
    // Include saveSessionId and speciesId to isolate per loaded save/species
    queryKey: ['pokemon', 'details', saveSessionId, activePokemon?.data?.speciesId ?? 'none', String(activePokemonId)],
    queryFn: () => (activePokemon ? getPokemonDetails(activePokemon) : Promise.reject(new Error('No active Pokémon'))),
    enabled: !isParsingSave && activePokemonBelongsToSave,
    staleTime: 1000 * 60 * 60, // 1 hour
  })

  // Apply details only to the same Pokémon instance and save session that requested them.
  useEffect(() => {
    if (!detailedData || !activePokemonData || !activePokemonBelongsToSave || isParsingSave || useSaveFileStore.getState().saveSessionId !== saveSessionId) return
    const expectedData = activePokemonData
    const update = (p: UIPokemonData) => {
      if (p.id !== activePokemonId || p.data !== expectedData) return p
      return hydrateBoxPokemon(p, { ...detailedData, item: p.details?.item })
    }
    usePokemonStore.setState(prevState => ({
      partyList: prevState.partyList.map(update),
      boxList: prevState.boxList.map(box => ({ ...box, pokemon: box.pokemon.map(p => (p ? update(p) : null)) })),
    }))
  }, [detailedData, activePokemonId, activePokemonData, activePokemonBelongsToSave, isParsingSave, saveSessionId])

  // Preload details for a party or boxed Pokémon by id
  const preloadPokemonDetails = useCallback(
    async (id: number) => {
      const pokemon = findPokemon(usePokemonStore.getState(), id)
      const currentSave = useSaveFileStore.getState()
      if (!pokemon || currentSave.isLoading || currentSave.saveSessionId !== saveSessionId || !belongsToSave(pokemon, currentSave.saveData)) return
      await queryClient.prefetchQuery({
        queryKey: ['pokemon', 'details', saveSessionId, pokemon.data.speciesId, String(id)],
        queryFn: () => getPokemonDetails(pokemon),
        staleTime: 1000 * 60 * 60,
      })
    },
    [queryClient, saveSessionId]
  )

  return {
    partyList,
    boxList,
    activePokemonId,
    setActivePokemonId,
    activePokemon,
    isLoading,
    isError,
    error,
    setEvIndex,
    setIvIndex,
    setNature,
    preloadPokemonDetails,
    getRemainingEvs,
  }
}
