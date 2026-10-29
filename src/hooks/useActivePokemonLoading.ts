import { selectActivePokemon, usePokemonStore } from '@/stores'

/**
 * Returns loading state for the active Pokémon details, avoiding prop drilling.
 * It considers both missing details and in-flight React Query requests.
 */
export function useActivePokemonLoading(): boolean {
  const pokemon = usePokemonStore(selectActivePokemon)
  // Only consider loading when no details exist yet.
  // Background refetches should not trigger loading states across the UI.
  return !pokemon?.details
}
