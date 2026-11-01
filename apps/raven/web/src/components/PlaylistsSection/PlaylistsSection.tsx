import { useQuery } from '@tanstack/react-query'
import type { PlaylistSummary } from '@raven/core'
import { Button } from '@raven/ui'
import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PlaylistNameDialog } from '@/components/PlaylistNameDialog/PlaylistNameDialog'
import { PLAYLISTS_COPY } from '@/components/PlaylistsSection/copy'
import { COMMON_COPY } from '@/lib/copy'
import { playlistFacts } from '@/lib/music'
import { playlistsQuery } from '@/lib/queries'
import { useMusicLinks } from '@/lib/useMusicLinks'
import { usePlaylistMutations } from '@/lib/usePlaylistMutations'
import styles from '@/components/PlaylistsSection/PlaylistsSection.module.scss'

type PlaylistLinksProps = { playlists: readonly PlaylistSummary[]; label: string }

/** Playlists as cards, each its name linking to its page over its length. */
const PlaylistLinks = ({ playlists, label }: PlaylistLinksProps) => {
  const links = useMusicLinks()
  return (
    <ul className={styles.playlists} aria-label={label}>
      {playlists.map((playlist) => (
        <li key={playlist.id} className={styles.playlist}>
          <Link to={links.playlist(playlist.id)} className={styles.playlistName}>
            {playlist.name}
          </Link>
          <span className={styles.playlistFacts}>
            {playlistFacts({ playlist }).join(COMMON_COPY.separator)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The account's own playlists, the same on every music library's tab and
 * in the music mode as they span them all, most recently changed first, and New playlist, which
 * opens the one it makes; then, under Shared with you, the ones other
 * accounts share.
 */
export const PlaylistsSection = () => {
  const navigate = useNavigate()
  const links = useMusicLinks()
  const playlists = useQuery(playlistsQuery)
  const { create } = usePlaylistMutations()
  const sharedId = useId()
  const [isNaming, setNaming] = useState(false)
  const own = playlists.data?.filter(({ isOwn }) => isOwn) ?? []
  const shared = playlists.data?.filter(({ isOwn }) => !isOwn) ?? []
  return (
    <div className={styles.section}>
      <div className={styles.playlistsToolbar}>
        <Button tone="primary" icon="plus" onClick={() => setNaming(true)}>
          {PLAYLISTS_COPY.newPlaylist}
        </Button>
      </div>
      {playlists.error && (
        <p className={styles.message} role="alert">
          {playlists.error.message}
        </p>
      )}
      {playlists.data && own.length === 0 && (
        <p className={styles.message}>{PLAYLISTS_COPY.noPlaylists}</p>
      )}
      {own.length > 0 && <PlaylistLinks playlists={own} label={PLAYLISTS_COPY.playlists} />}
      {shared.length > 0 && (
        <section className={styles.section} aria-labelledby={sharedId}>
          <h2 id={sharedId} className={styles.playlistsHeading}>
            {PLAYLISTS_COPY.sharedWithYou}
          </h2>
          <PlaylistLinks playlists={shared} label={PLAYLISTS_COPY.sharedWithYou} />
        </section>
      )}
      {isNaming && (
        <PlaylistNameDialog
          title={PLAYLISTS_COPY.newPlaylist}
          initialName=""
          submitLabel={PLAYLISTS_COPY.makePlaylist}
          isPending={create.isPending}
          error={create.error}
          onSubmit={(name) =>
            create.mutate(name, {
              onSuccess: (details) => void navigate(links.playlist(details.playlist.id)),
            })
          }
          onClose={() => setNaming(false)}
        />
      )}
    </div>
  )
}
