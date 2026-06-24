'use client'
import { useEffect } from 'react'

interface Props {
  message: string
  type?: 'success' | 'error' | 'info'
  onClose: () => void
}

export default function Toast({ message, type = 'info', onClose }: Props) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <div className={`toast ${type}`} onClick={onClose}>
      {message}
    </div>
  )
}
