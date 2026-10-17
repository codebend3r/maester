import { useState } from 'react'
import { type PlayerConnection, usePlayerConnection } from '@/renderer/desktop/playerConnection'

export type Chosen = Exclude<PlayerConnection, { status: 'waiting' }>

/** The engine settles once per video: the first answer main gives, kept until it is lost. */
export const useChosenEngine = (): Chosen | null => {
  const connection = usePlayerConnection()
  const [chosen, setChosen] = useState<Chosen | null>(
    connection.status === 'waiting' ? null : connection,
  )
  if (chosen === null && connection.status !== 'waiting') {
    setChosen(connection)
    return connection
  }
  return chosen
}
