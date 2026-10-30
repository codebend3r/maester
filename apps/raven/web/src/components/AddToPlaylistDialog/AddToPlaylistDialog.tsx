import { useQuery } from '@tanstack/react-query'
import { PLAYLIST_LIMITS, type PlaylistSummary, type Track, isPlaylistName } from '@raven/core'
import { Button, useToasts } from '@raven/ui'
import { type FormEvent, useId, useState } from 'react'
import { playlistFacts } from '@/lib/music'
import { playlistsQuery } from '@/lib/queries'
import { useModal } from '@/lib/useModal'
import { usePlaylistMutations } from '@/lib/usePlaylistMutations'
import styles from '@/components/AddToPlaylistDialog/AddToPlaylistDialog.module.scss'

type WhatOfProps = { tracks: readonly Track[] }

/** What is being added, as the dialog names it: the track's title, or how many tracks. */
const whatOf = ({ tracks }: WhatOfProps): string => {
  const [only] = tracks
  return tracks.length === 1 && only !== undefined ? only.title : `${tracks.length} tracks`
}

type AddToPlaylistDialogProps = {
  tracks: readonly Track[]
  onClose: () => void
}

/**
 * Adds `tracks` to the end of one of the account's playlists, or to a new
 * one named here. It closes once they are in, with a note saying where.
 */
export const AddToPlaylistDialog = ({ tracks, onClose }: AddToPlaylistDialogProps) => {
  const { dialog, close, keepKeys } = useModal()
  const titleId = useId()
  const fieldId = useId()
  const playlists = useQuery(playlistsQuery)
  const { create, append } = usePlaylistMutations()
  const show = useToasts((state) => state.show)
  const [name, setName] = useState('')
  const isPending = create.isPending || append.isPending
  const failure = create.error ?? append.error ?? playlists.error
  const what = whatOf({ tracks })

  const addTo = (playlist: PlaylistSummary) =>
    append.mutate(
      { id: playlist.id, tracks },
      {
        onSuccess: () => {
          show(`Added ${what} to ${playlist.name}`)
          close()
        },
      },
    )

  const makeAndAdd = (event: FormEvent) => {
    event.preventDefault()
    if (!isPlaylistName(name)) return
    create.mutate(name.trim(), { onSuccess: (details) => addTo(details.playlist) })
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={keepKeys}
    >
      <div className={styles.body}>
        <h2 id={titleId} className={styles.title}>
          Add to playlist
        </h2>
        <p className={styles.what}>{what}</p>
        {playlists.isPending && <p className={styles.hint}>Reading your playlists…</p>}
        {playlists.data && playlists.data.length === 0 && (
          <p className={styles.hint}>You have no playlists yet. Name one below to start it.</p>
        )}
        {playlists.data && playlists.data.length > 0 && (
          <ul className={styles.playlists} aria-label="Your playlists">
            {playlists.data.map((playlist) => (
              <li key={playlist.id}>
                <button
                  type="button"
                  className={styles.playlist}
                  disabled={isPending}
                  onClick={() => addTo(playlist)}
                >
                  <span className={styles.name}>{playlist.name}</span>
                  <span className={styles.facts}>{playlistFacts({ playlist }).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className={styles.form} onSubmit={makeAndAdd}>
          <label htmlFor={fieldId} className={styles.label}>
            New playlist
          </label>
          <input
            id={fieldId}
            className={styles.input}
            value={name}
            maxLength={PLAYLIST_LIMITS.name}
            autoComplete="off"
            placeholder="Name"
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="submit"
            icon="plus"
            className={styles.make}
            disabled={!isPlaylistName(name) || isPending}
          >
            Make and add
          </Button>
        </form>
        {failure !== null && (
          <p role="alert" className={styles.error}>
            {failure.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={close}>Cancel</Button>
        </div>
      </div>
    </dialog>
  )
}
