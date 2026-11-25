import type { WrenSession } from '@/useWren'

/** What every category page takes: the server, and the way back to Library. */
export type CollectionPageProps = { session: WrenSession; onBack: () => void }
