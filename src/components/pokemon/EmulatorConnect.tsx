import { Gamepad2, Loader2, Unplug, Wifi } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useEmulatorStore } from '@/stores/useEmulatorStore'
import { cn } from '@/lib/utils'

export const EmulatorConnect: React.FC = () => {
  const status = useEmulatorStore(s => s.status)
  const error = useEmulatorStore(s => s.error)
  const url = useEmulatorStore(s => s.url)
  const gameTitle = useEmulatorStore(s => s.gameTitle)
  const setUrl = useEmulatorStore(s => s.setUrl)
  const connect = useEmulatorStore(s => s.connect)
  const disconnect = useEmulatorStore(s => s.disconnect)
  const [showUrlInput, setShowUrlInput] = useState(false)

  const isActive = status === 'connected' || status === 'watching'
  const isConnecting = status === 'connecting'

  const handleConnect = async () => {
    try {
      await connect()
      toast.success('Connected to emulator', {
        position: 'bottom-center',
        duration: 3000,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      toast.error(message, {
        position: 'bottom-center',
        duration: 5000,
      })
    }
  }

  const handleDisconnect = () => {
    disconnect()
    toast.info('Disconnected from emulator', {
      position: 'bottom-center',
      duration: 2000,
    })
  }

  if (isActive) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-sm text-emerald-400">
          <Wifi className="size-4 animate-pulse" />
          <span>Connected{gameTitle ? ` — ${gameTitle}` : ''}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleDisconnect} className="text-muted-foreground hover:text-destructive">
          <Unplug className="size-3.5" />
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <div className={cn('h-px flex-1 min-w-8', 'bg-border')} />
        <span className="text-xs text-muted-foreground px-2">or connect to emulator</span>
        <div className={cn('h-px flex-1 min-w-8', 'bg-border')} />
      </div>

      {showUrlInput && <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="ws://localhost:7102/ws" className="w-64 px-3 py-1.5 text-xs rounded-md border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />}

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleConnect} disabled={isConnecting} className="gap-2">
          {isConnecting ? <Loader2 className="size-3.5 animate-spin" /> : <Gamepad2 className="size-3.5" />}
          {isConnecting ? 'Connecting...' : 'Connect to Emulator'}
        </Button>

        <button type="button" onClick={() => setShowUrlInput(v => !v)} className="text-xs text-muted-foreground hover:text-foreground transition-colors" title="Edit WebSocket URL">
          {showUrlInput ? 'hide' : 'edit url'}
        </button>
      </div>

      {error && <p className="text-xs text-destructive max-w-64 text-center">{error}</p>}
    </div>
  )
}
