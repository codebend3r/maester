import { STATUS_COPY } from '@raven/wren'
import { useMusicLibraries } from '@/music/musicLibraries'
import { StatusChip } from '@/ui/StatusChip/StatusChip'

/** The server's chip: its name, and whether it answers, read from its libraries. */
export function ServerStatusChip() {
  const { failure } = useMusicLibraries()
  return <StatusChip isConnected={failure === null} name={STATUS_COPY.raven} />
}
