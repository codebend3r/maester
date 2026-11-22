import { useMusicLibraries } from '@/music/musicLibraries'
import { useServerName } from '@/stores/wrenPrefs'
import { StatusChip } from '@/ui/StatusChip'
import type { WrenSession } from '@/useWren'

type ServerStatusChipProps = { session: WrenSession }

/** The active server's chip: its name, and whether it answers, read from its libraries. */
export function ServerStatusChip({ session }: ServerStatusChipProps) {
  const { failure } = useMusicLibraries(session)
  const name = useServerName({ fallback: session.server.name })
  return <StatusChip isConnected={failure === null} name={name} />
}
