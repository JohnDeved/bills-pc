import { useEffect } from 'react'

type UndoRedo = () => Promise<void> | void

interface UseUndoRedoShortcutsOptions {
  undo: UndoRedo
  redo: UndoRedo
  enabled?: boolean
}

export function useUndoRedoShortcuts({ undo, redo, enabled = true }: UseUndoRedoShortcutsOptions) {
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) void redo()
        else void undo()
      } else if (key === 'y') {
        e.preventDefault()
        void redo()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [undo, redo, enabled])
}
