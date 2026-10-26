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
  const boxError = useSaveFileStore(s => s.saveData?.box_error)

  return (
    <Tabs value={storageView} onValueChange={value => setStorageView(value as 'party' | 'boxes')} className="gap-4">
      <TabsList aria-label="Pokémon location" className="justify-start border-b border-border px-2">
        <TabsTrigger value="party" className="pt-2 pb-2">
          Party
        </TabsTrigger>
        <TabsTrigger value="boxes" className="pt-2 pb-2 disabled:opacity-40 disabled:cursor-not-allowed" disabled={!hasBoxes}>
          PC boxes
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
