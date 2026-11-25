import { useMusicLibraries } from '@/music/musicLibraries'
import { useServerName } from '@/stores/wrenPrefs'
import { StatusChip } from '@/ui/StatusChip/StatusChip'

/** The server's chip: its name, and whether it answers, read from its libraries. */
export function ServerStatusChip() {
  const { failure } = useMusicLibraries()
  const name = useServerName()
  return <StatusChip isConnected={failure === null} name={name} />
}
