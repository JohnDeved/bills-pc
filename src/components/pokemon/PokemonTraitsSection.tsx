import { Skeleton } from '@/components/common'
import { AbilityTab } from '@/components/pokemon/traits/AbilityTab'
import { ItemTab } from '@/components/pokemon/traits/ItemTab'
import { NatureTab } from '@/components/pokemon/traits/NatureTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BoostSandboxTab } from '@/components/pokemon/traits/BoostSandboxTab'
import { useActivePokemonLoading } from '@/hooks'

export const PokemonTraitsSection: React.FC = () => {
  const isLoading = useActivePokemonLoading()
  const tabClassName = 'min-w-0 justify-center whitespace-nowrap px-1 pt-3 pb-2.5 text-xs lg:text-[11px] xl:text-xs max-lg:[font-family:Geist,sans-serif] max-lg:antialiased focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500'
  return (
    <Skeleton.LoadingProvider loading={isLoading}>
      <div className="flex flex-col h-full">
        <Tabs defaultValue="nature" className="flex-1 flex flex-col">
          <div className="flex-shrink-0">
            <div className="w-full border-b border-border/60">
              <div className="px-2 sm:px-3">
                <TabsList className="grid w-full grid-cols-4 gap-1 px-0">
                  <TabsTrigger value="nature" className={tabClassName}>
                    Nature
                  </TabsTrigger>
                  <TabsTrigger value="ability" className={tabClassName}>
                    Ability
                  </TabsTrigger>
                  <TabsTrigger value="item" className={tabClassName}>
                    Held Item
                  </TabsTrigger>
                  <TabsTrigger value="boosts" className={tabClassName}>
                    Boosts
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>
          </div>

          <TabsContent value="nature" className="flex-1 flex flex-col">
            <NatureTab />
          </TabsContent>

          <TabsContent value="ability" className="flex-1 flex flex-col">
            <AbilityTab />
          </TabsContent>

          <TabsContent value="item" className="flex-1 flex flex-col">
            <ItemTab />
          </TabsContent>

          <TabsContent value="boosts" className="flex-1 flex flex-col">
            <BoostSandboxTab />
          </TabsContent>
        </Tabs>
      </div>
    </Skeleton.LoadingProvider>
  )
}
