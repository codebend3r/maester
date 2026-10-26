import type { HistoryEntry } from '@/contract'

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

type DayLabelProps = { date: Date; now: Date }

const dayLabel = ({ date, now }: DayLabelProps): string => {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(date) === dayKey(now)) return 'Today'
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday'
  return (date.getFullYear() === now.getFullYear() ? DAY : DAY_WITH_YEAR).format(date)
}

type HistoryDaysProps = {
  entries: HistoryEntry[]
  now?: Date
}

/**
 * Splits a library's history into days, newest first as it came. These are
 * the viewer's own days, unlike the grouped view's months: yesterday means
 * yesterday where they are.
 */
export const historyDays = ({ entries, now = new Date() }: HistoryDaysProps): HistoryDay[] => {
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
  if (entry.marked) return 'Marked watched'
  if (entry.watched) return 'Watched'
  const duration = entry.media.duration
  if (!duration) return 'Played'
  return `${Math.min(100, Math.floor((entry.furthest / duration) * 100))}% watched`
}

type FinishedNoteProps = {
  entry: HistoryEntry
  now?: Date
}

/** The line under a finished video, with no day above it: the day it last played, and how often it has. */
export const finishedNote = ({ entry, now = new Date() }: FinishedNoteProps): string =>
  [
    dayLabel({ date: new Date(entry.lastPlayedAt), now }),
    ...(entry.plays > 1 ? [`${entry.plays} plays`] : []),
  ].join(' · ')

/**
 * The line under a video in its history: how far it got, or that it was
 * marked watched, when it last played or was marked, and how many real plays.
 */
export const historyNote = (entry: HistoryEntry): string =>
  [
    howFar(entry),
    TIME.format(new Date(entry.lastPlayedAt)),
    ...(entry.plays > 1 ? [`${entry.plays} plays`] : []),
  ].join(' · ')
