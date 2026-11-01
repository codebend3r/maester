import { useEffect, useState } from 'react'
import { freshSpeed } from '@/desktop/downloadSpeed'
import { useDownloadSpeeds } from '@/stores/downloadSpeeds'

const TICK_MS = 1000

/** The time, read again each second, so a download that went quiet stops showing its last speed. */
const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** Bytes a second one download is going at, or null while it has no speed to show. */
export const useDownloadSpeed = (downloadId: string): number | null => {
  const sample = useDownloadSpeeds((state) => state.samples[downloadId])
  return freshSpeed({ sample, now: useNow() })
}

/** Bytes a second every download is going at together, or null while none has a speed to show. */
export const useTotalSpeed = (): number | null => {
  const samples = useDownloadSpeeds((state) => state.samples)
  const now = useNow()
  const speeds = Object.values(samples).flatMap((sample) => {
    const speed = freshSpeed({ sample, now })
    return speed === null ? [] : [speed]
  })
  return speeds.length === 0 ? null : speeds.reduce((sum, speed) => sum + speed, 0)
}
