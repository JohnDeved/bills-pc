import { PokemonMoveSummary } from './PokemonMoveSummary'

export const PokemonMovePlaceholder: React.FC = () => (
  <div className="h-full w-full text-left p-3 rounded-lg bg-transparent border border-dashed border-border">
    <PokemonMoveSummary name="——" type="UNKNOWN" pp="-/-" empty />
  </div>
)
