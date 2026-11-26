import { StatusChip } from '@/ui/StatusChip'
import { type WrenSession, useMusicLibraries } from '@raven/wren-native'

type ServerStatusChipProps = { session: WrenSession }

/** The active server's chip: its name, and whether it answers, read from its libraries. */
export function ServerStatusChip({ session }: ServerStatusChipProps) {
  const { failure } = useMusicLibraries(session)
  return <StatusChip isConnected={failure === null} name={session.server.name} />
}
