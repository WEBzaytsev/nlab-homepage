import { useEffect, useRef } from 'react'

type Poll = () => void | Promise<void>

export function useVisiblePolling(intervalMs: number, poll: Poll, cancel: () => void) {
  const pollRef = useRef(poll)
  const cancelRef = useRef(cancel)
  pollRef.current = poll
  cancelRef.current = cancel

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void pollRef.current()
      else cancelRef.current()
    }

    onVisibilityChange()
    const interval = window.setInterval(onVisibilityChange, intervalMs)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      cancelRef.current()
    }
  }, [intervalMs])
}
