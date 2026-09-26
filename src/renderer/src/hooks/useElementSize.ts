import { useEffect, useRef, useState } from 'react'

/** Tracks an element's content box so virtualised layouts can be computed in CSS pixels. */
export function useElementSize<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>
  width: number
  height: number
} {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (element === null) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const box = entry.contentRect
      setSize((current) => {
        const width = Math.round(box.width)
        const height = Math.round(box.height)
        return current.width === width && current.height === height ? current : { width, height }
      })
    })

    observer.observe(element)
    setSize({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [])

  return { ref, ...size }
}
