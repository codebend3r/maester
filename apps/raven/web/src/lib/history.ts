import type { HistoryEntry } from '@raven/core'

/** One day of a library's history, its entries in the order they came. */
export type HistoryDay = {
  key: string
  label: string
  entries: HistoryEntry[]
}

const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const DAY_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})
const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`

const dayLabel = ({ date, now }: { date: Date; now: Date }): string => {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(date) === dayKey(now)) return 'Today'
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday'
  return (date.getFullYear() === now.getFullYear() ? DAY : DAY_WITH_YEAR).format(date)
}

/**
 * Splits a library's history into days, newest first as it came. These are
 * the viewer's own days, unlike the grouped view's months: yesterday means
 * yesterday where they are.
 */
export const historyDays = ({
  entries,
  now = new Date(),
}: {
  entries: HistoryEntry[]
  now?: Date
}): HistoryDay[] => {
  const dated = entries.map((entry) => {
    const date = new Date(entry.lastPlayedAt)
    return { entry, date, key: dayKey(date) }
  })
  return [...new Set(dated.map((item) => item.key))].map((key) => {
    const day = dated.filter((item) => item.key === key)
    const first = day.at(0)
    return {
      key,
      label: first ? dayLabel({ date: first.date, now }) : key,
      entries: day.map((item) => item.entry),
    }
  })
}

const howFar = (entry: HistoryEntry): string => {
  if (entry.watched) return 'Watched'
  const duration = entry.media.duration
  if (!duration) return 'Played'
  return `${Math.min(100, Math.floor((entry.furthest / duration) * 100))}% watched`
}

/** The line under a video in its history: how far it got, when it last played, and how often. */
export const historyNote = (entry: HistoryEntry): string =>
  [
    howFar(entry),
    TIME.format(new Date(entry.lastPlayedAt)),
    ...(entry.plays > 1 ? [`${entry.plays} plays`] : []),
  ].join(' · ')
