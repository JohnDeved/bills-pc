import { useState, useCallback } from 'react'

/**
 * Hook to manage adaptive popover positioning based on available viewport space.
 * Determines whether to show popover above or below the trigger element.
 */
export function usePopoverSide() {
  const [side, setSide] = useState<'top' | 'bottom'>('top')

  /**
   * Decides which side to show the popover based on available space.
   * Shows below if there's more space below, otherwise shows above.
   */
  const decideSideFromElement = useCallback((element: HTMLElement | null) => {
    if (!element) return

    const rect = element.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top

    setSide(spaceBelow >= spaceAbove ? 'bottom' : 'top')
  }, [])

  return { side, decideSideFromElement }
}
