import { useQuery } from '@tanstack/react-query'
import { PLAYLIST_LIMITS, type PlaylistSummary, type Track, isPlaylistName } from '@raven/core'
import { Button, useToasts } from '@raven/ui'
import { type FormEvent, useId, useState } from 'react'
import { playlistFacts } from '@/lib/music'
import { ownPlaylistsQuery } from '@/lib/queries'
import { useModal } from '@/lib/useModal'
import { usePlaylistMutations } from '@/lib/usePlaylistMutations'
import { ADD_TO_PLAYLIST_COPY } from '@/components/AddToPlaylistDialog/copy'
import styles from '@/components/AddToPlaylistDialog/AddToPlaylistDialog.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { QueryView, keptRead, isNone } from '@raven/ui/headless'
import { DialogFrame, DIALOG_WIDTHS } from '@/components/DialogFrame/DialogFrame'

type WhatOfProps = { tracks: readonly Track[] }

/** What is being added, as the dialog names it: the track's title, or how many tracks. */
const whatOf = ({ tracks }: WhatOfProps): string => {
  const [only] = tracks
  return tracks.length === 1 && only !== undefined ? only.title : COMMON_COPY.tracks(tracks.length)
}

type PlaylistChoicesProps = {
  playlists: readonly PlaylistSummary[]
  isPending: boolean
  onPick: (playlist: PlaylistSummary) => void
}

const PlaylistChoices = ({ playlists, isPending, onPick }: PlaylistChoicesProps) => (
  <ul className={styles.playlists} aria-label={ADD_TO_PLAYLIST_COPY.yourPlaylists}>
    {playlists.map((playlist) => (
      <li key={playlist.id}>
        <button
          type="button"
          className={styles.playlist}
          disabled={isPending}
          onClick={() => onPick(playlist)}
        >
          <span className={styles.name}>{playlist.name}</span>
          <span className={styles.facts}>
            {playlistFacts({ playlist }).join(COMMON_COPY.separator)}
          </span>
        </button>
      </li>
    ))}
  </ul>
)

// Why the read failed shows with the dialog's other failures, below the form.
const unshown = (): null => null

type AddToPlaylistDialogProps = {
  tracks: readonly Track[]
  onClose: () => void
}

/**
 * Adds `tracks` to the end of one of the account's playlists, or to a new
 * one named here. It closes once they are in, with a note saying where.
 */
export const AddToPlaylistDialog = ({ tracks, onClose }: AddToPlaylistDialogProps) => {
  const { dialog, keepKeys, close } = useModal()
  const titleId = useId()
  const fieldId = useId()
  const playlists = useQuery(ownPlaylistsQuery)
  const { create, append } = usePlaylistMutations()
  const show = useToasts((state) => state.show)
  const [name, setName] = useState('')
  const isPending = create.isPending
  const failure = create.error ?? playlists.error
  const what = whatOf({ tracks })

  /*
   * The tracks show in the playlist at once, so the dialog closes before the
   * server answers; a refusal takes them out again and says so in a toast.
   */
  const addTo = (playlist: PlaylistSummary) => {
    show(ADD_TO_PLAYLIST_COPY.added({ what, name: playlist.name }))
    close()
    append.attempt({
      variables: { id: playlist.id, tracks },
      onRefused: (error) =>
        show(ADD_TO_PLAYLIST_COPY.notAdded({ name: playlist.name, why: error.message })),
    })
  }

  const makeAndAdd = (event: FormEvent) => {
    event.preventDefault()
    if (!isPlaylistName(name)) return
    create.mutate(name.trim(), { onSuccess: (details) => addTo(details.playlist) })
  }

  return (
    <DialogFrame
      dialog={dialog}
      onKeyDown={keepKeys}
      width={DIALOG_WIDTHS.prose}
      labelledBy={titleId}
      onClose={onClose}
    >
      <div className={styles.body}>
        <h2 id={titleId} className={styles.title}>
          {COMMON_COPY.addToPlaylist}
        </h2>
        <p className={styles.what}>{what}</p>
        <QueryView
          query={keptRead(playlists)}
          pending={<p className={styles.hint}>{ADD_TO_PLAYLIST_COPY.reading}</p>}
          renderFailed={unshown}
          empty={{
            isEmpty: isNone,
            shown: <p className={styles.hint}>{ADD_TO_PLAYLIST_COPY.none}</p>,
          }}
        >
          {(read) => <PlaylistChoices playlists={read} isPending={isPending} onPick={addTo} />}
        </QueryView>
        <form className={styles.form} onSubmit={makeAndAdd}>
          <label htmlFor={fieldId} className={styles.label}>
            {ADD_TO_PLAYLIST_COPY.newPlaylist}
          </label>
          <input
            id={fieldId}
            className={styles.input}
            value={name}
            maxLength={PLAYLIST_LIMITS.name}
            autoComplete="off"
            placeholder={COMMON_COPY.name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="submit"
            icon="plus"
            className={styles.make}
            disabled={!isPlaylistName(name) || isPending}
          >
            {ADD_TO_PLAYLIST_COPY.makeAndAdd}
          </Button>
        </form>
        {failure !== null && (
          <p role="alert" className={styles.error}>
            {failure.message}
          </p>
        )}
        <div className={styles.actions}>
          <Button onClick={close}>{COMMON_COPY.cancel}</Button>
        </div>
      </div>
    </DialogFrame>
  )
}
