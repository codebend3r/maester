import { useState } from 'react'
import {
  CONNECTION_STATUSES,
  type PlayerConnection,
  usePlayerConnection,
} from '@/renderer/desktop/playerConnection'

export type Chosen = Exclude<PlayerConnection, { status: typeof CONNECTION_STATUSES.waiting }>

/** The engine settles once per video: the first answer main gives, kept until it is lost. */
export const useChosenEngine = (): Chosen | null => {
  const connection = usePlayerConnection()
  const [chosen, setChosen] = useState<Chosen | null>(
    connection.status === CONNECTION_STATUSES.waiting ? null : connection,
  )
  if (chosen === null && connection.status !== CONNECTION_STATUSES.waiting) {
    setChosen(connection)
    return connection
  }
  return chosen
}
