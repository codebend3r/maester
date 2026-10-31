import { useQuery } from '@tanstack/react-query'
import { PLAYLIST_LIMITS, type PlaylistSummary, type Track, isPlaylistName } from '@raven/core'
import { Button, useToasts } from '@raven/ui'
import { type ComponentType, type FormEvent, useId, useState } from 'react'
import { playlistFacts } from '@/lib/music'
import { ownPlaylistsQuery } from '@/lib/queries'
import { useModal } from '@/lib/useModal'
import { usePlaylistMutations } from '@/lib/usePlaylistMutations'
import { ADD_TO_PLAYLIST_COPY } from '@/components/AddToPlaylistDialog/copy'
import styles from '@/components/AddToPlaylistDialog/AddToPlaylistDialog.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type WhatOfProps = { tracks: readonly Track[] }

/** What is being added, as the dialog names it: the track's title, or how many tracks. */
const whatOf = ({ tracks }: WhatOfProps): string => {
  const [only] = tracks
  return tracks.length === 1 && only !== undefined ? only.title : COMMON_COPY.tracks(tracks.length)
}

/** What the dialog shows of the account's playlists: being read, failed to read, none yet, or the list. */
const CHOICE_KEYS = {
  reading: 'reading',
  failed: 'failed',
  none: 'none',
  listed: 'listed',
} as const
type ChoiceKey = (typeof CHOICE_KEYS)[keyof typeof CHOICE_KEYS]

type PlaylistChoicesProps = {
  playlists: readonly PlaylistSummary[]
  isPending: boolean
  onPick: (playlist: PlaylistSummary) => void
}

const ReadingPlaylists = () => <p className={styles.hint}>{ADD_TO_PLAYLIST_COPY.reading}</p>

// Why the read failed shows with the dialog's other failures, below the form.
const UnreadPlaylists = () => null

const NoPlaylists = () => <p className={styles.hint}>{ADD_TO_PLAYLIST_COPY.none}</p>

type ListedPlaylistsProps = PlaylistChoicesProps

const ListedPlaylists = ({ playlists, isPending, onPick }: ListedPlaylistsProps) => (
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

const PLAYLIST_CHOICES = {
  [CHOICE_KEYS.reading]: ReadingPlaylists,
  [CHOICE_KEYS.failed]: UnreadPlaylists,
  [CHOICE_KEYS.none]: NoPlaylists,
  [CHOICE_KEYS.listed]: ListedPlaylists,
} as const satisfies Record<ChoiceKey, ComponentType<PlaylistChoicesProps>>

type ChoiceOfProps = { playlists: readonly PlaylistSummary[] | undefined; isError: boolean }

const choiceOf = ({ playlists, isError }: ChoiceOfProps): ChoiceKey => {
  if (playlists === undefined) return isError ? CHOICE_KEYS.failed : CHOICE_KEYS.reading
  if (playlists.length === 0) return CHOICE_KEYS.none
  return CHOICE_KEYS.listed
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
  const playlists = useQuery(ownPlaylistsQuery)
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
          show(ADD_TO_PLAYLIST_COPY.added({ what, name: playlist.name }))
          close()
        },
      },
    )

  const makeAndAdd = (event: FormEvent) => {
    event.preventDefault()
    if (!isPlaylistName(name)) return
    create.mutate(name.trim(), { onSuccess: (details) => addTo(details.playlist) })
  }

  const Choices: ComponentType<PlaylistChoicesProps> =
    PLAYLIST_CHOICES[choiceOf({ playlists: playlists.data, isError: playlists.isError })]

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
          {COMMON_COPY.addToPlaylist}
        </h2>
        <p className={styles.what}>{what}</p>
        <Choices playlists={playlists.data ?? []} isPending={isPending} onPick={addTo} />
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
    </dialog>
  )
}
