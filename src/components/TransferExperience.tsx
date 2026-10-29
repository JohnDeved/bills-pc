import { usePokemonTransfer } from '@/hooks/usePokemonTransfer'
import type { TransferResult } from '@/lib/parser/transfer/types'
import { TransferWorkbench } from './transfer/TransferWorkbench'

export function TransferExperience({ onClose, onOpenResult }: { onClose: () => void; onOpenResult: (result: TransferResult) => Promise<void> }) {
  const controller = usePokemonTransfer(onOpenResult)
  return <TransferWorkbench controller={controller} onClose={onClose} />
}
