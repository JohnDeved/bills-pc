import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePokemonStore, useSaveFileStore } from '@/stores'
import { PokemonBoxList } from './PokemonBoxList'
import { PokemonPartyList } from './PokemonPartyList'

interface PokemonStorageProps {
  onPokemonHover?: (id: number) => void
}

export const PokemonStorage: React.FC<PokemonStorageProps> = ({ onPokemonHover }) => {
  const storageView = usePokemonStore(s => s.storageView)
  const setStorageView = usePokemonStore(s => s.setStorageView)
  const hasBoxes = usePokemonStore(s => s.boxList.length > 0)
  const partyCount = usePokemonStore(s => s.partyList.length)
  const boxPokemonCount = usePokemonStore(s => s.boxList.reduce((count, box) => count + box.pokemon.filter(Boolean).length, 0))
  const boxError = useSaveFileStore(s => s.saveData?.box_error)

  return (
    <Tabs value={storageView} onValueChange={value => setStorageView(value as 'party' | 'boxes')} className="gap-3">
      <TabsList aria-label="Pokémon location" className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-card/40 p-1">
        <TabsTrigger value="party" className="-mb-0 min-h-11 min-w-0 justify-center gap-2 rounded-lg border-0 px-2 py-2 text-[10px] sm:text-xs data-[state=active]:bg-background/80 data-[state=active]:shadow-sm focus-visible:outline-2 focus-visible:outline-cyan-500">
          Party
          <span aria-hidden className="geist-font rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
            {partyCount}
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="boxes"
          className="-mb-0 min-h-11 min-w-0 justify-center gap-2 rounded-lg border-0 px-2 py-2 text-[10px] sm:text-xs data-[state=active]:bg-cyan-500/10 data-[state=active]:text-cyan-800 dark:data-[state=active]:text-cyan-200 data-[state=active]:shadow-sm focus-visible:outline-2 focus-visible:outline-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!hasBoxes}
        >
          PC boxes
          <span aria-hidden className="geist-font rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
            {boxPokemonCount}
          </span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="party">
        <PokemonPartyList isRenaming={false} onPokemonHover={onPokemonHover} />
        {!hasBoxes && (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            {boxError ?? 'Open a save file to edit PC boxes.'}
          </p>
        )}
      </TabsContent>
      <TabsContent value="boxes">
        <PokemonBoxList onPokemonHover={onPokemonHover} />
      </TabsContent>
    </Tabs>
  )
}
