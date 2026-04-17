import { useState, useCallback } from 'react'

interface Toast { id: number; msg: string; type: 'g' | 'r' }

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const showToast = useCallback((msg: string, type: 'g' | 'r' = 'g') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }, [])
  return { toasts, showToast }
}
