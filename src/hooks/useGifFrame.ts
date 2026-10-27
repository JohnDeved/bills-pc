import { useEffect, useState } from 'react'

export const useGifFrame = (gifUrl: string) => {
  const [frame, setFrame] = useState<{ url: string; src: string | null } | null>(null)

  useEffect(() => {
    if (!gifUrl) return
    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'

    const captureFrame = () => {
      if (cancelled) return
      let src: string | null = null
      try {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        if (context) {
          context.drawImage(image, 0, 0)
          src = canvas.toDataURL('image/png')
        }
      } catch {
        // The caller can use its static fallback if the frame cannot be read.
      }
      setFrame({ url: gifUrl, src })
    }
    const handleError = () => {
      if (!cancelled) setFrame({ url: gifUrl, src: null })
    }
    image.addEventListener('load', captureFrame)
    image.addEventListener('error', handleError)
    image.src = gifUrl

    return () => {
      cancelled = true
      image.removeEventListener('load', captureFrame)
      image.removeEventListener('error', handleError)
    }
  }, [gifUrl])

  const currentFrame = frame?.url === gifUrl ? frame : null
  return { staticFrameSrc: currentFrame?.src ?? null, isLoading: Boolean(gifUrl) && !currentFrame }
}
