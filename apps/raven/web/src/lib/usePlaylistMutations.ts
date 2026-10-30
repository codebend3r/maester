import { playlistMutationsFor } from '@raven/ui/headless'
import { api } from '@/lib/api'

export const { usePlaylistMutations } = playlistMutationsFor({ api })
