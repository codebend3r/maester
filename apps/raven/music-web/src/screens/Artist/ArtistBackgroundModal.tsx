import type { ArtistBackgroundOption } from '@raven/core'
import { classNames, useChooseArtistBackground } from '@raven/ui/headless'
import { ARTIST_COPY } from '@raven/wren'
import { type QueryStatus, useQuery } from '@tanstack/react-query'
import type { ComponentType, ReactNode } from 'react'
import { LoadingMark } from '@/components/LoadingMark/LoadingMark'
import { Notice } from '@/components/Notice/Notice'
import { api } from '@/lib/api'
import { queries } from '@/lib/queries'
import { toastFailure } from '@/stores/toast'
import { SIZES } from '@/theme/tokens'
import { BottomSheet } from '@/ui/BottomSheet/BottomSheet'
import { ICONS } from '@/ui/WrenIcon/icons'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/Artist/ArtistBackgroundModal.module.scss'

/** Where the options are, by the status of the query that finds them: still found, not found, or found. */
const PICKER_STATES = {
  loading: 'pending',
  failed: 'error',
  ready: 'success',
} as const satisfies Record<string, QueryStatus>

type PickerState = (typeof PICKER_STATES)[keyof typeof PICKER_STATES]

type Choosing = {
  /** The option worn, by its key; null for the default photo. */
  chosen: string | null
  isPending: boolean
  onChoose: (key: string | null) => void
}

type PickerViewProps = Choosing & {
  artistId: number
  options: readonly ArtistBackgroundOption[]
}

function PickerLoading() {
  return <LoadingMark label={ARTIST_COPY.backgroundLoading} size={SIZES.loadingMark} />
}

function PickerFailed() {
  return <Notice text={ARTIST_COPY.backgroundFailed} />
}

type OptionProps = Choosing & {
  /** The option's key, or null for the default photo. */
  optionKey: string | null
  /** What it is called aloud where what it draws says nothing: a picture. */
  label?: string
  children: ReactNode
}

/** One choice in the grid, marked while it is the one worn. */
function Option({ optionKey, chosen, isPending, onChoose, label, children }: OptionProps) {
  const isWorn = chosen === optionKey
  return (
    <li className={styles.cell}>
      <button
        aria-label={label}
        aria-pressed={isWorn}
        className={classNames([styles.option, isWorn && styles.worn])}
        disabled={isPending}
        onClick={() => onChoose(optionKey)}
        type="button"
      >
        {children}
      </button>
    </li>
  )
}

function PickerReady({ artistId, options, ...choice }: PickerViewProps) {
  return (
    <>
      <p className={styles.note}>{ARTIST_COPY.backgroundNote}</p>
      <ul aria-label={ARTIST_COPY.backgroundTitle} className={styles.grid}>
        <Option {...choice} optionKey={null}>
          <span className={styles.plain}>
            <WrenIcon name={ICONS.artist} />
            <span>{ARTIST_COPY.backgroundDefault}</span>
          </span>
        </Option>
        {options.map(({ key, kind }, at) => (
          <Option
            {...choice}
            key={key}
            label={ARTIST_COPY.backgroundOption({ kind, position: at + 1 })}
            optionKey={key}
          >
            <img
              alt=""
              className={styles.picture}
              decoding="async"
              loading="lazy"
              src={api.artistBackgroundUrl({ artistId, key })}
            />
            {choice.chosen === key && (
              <span className={styles.badge}>{ARTIST_COPY.backgroundWorn}</span>
            )}
          </Option>
        ))}
      </ul>
      {options.length === 0 && <Notice text={ARTIST_COPY.backgroundEmpty} />}
    </>
  )
}

const PICKER_VIEWS = {
  [PICKER_STATES.loading]: PickerLoading,
  [PICKER_STATES.failed]: PickerFailed,
  [PICKER_STATES.ready]: PickerReady,
} as const satisfies Record<PickerState, ComponentType<PickerViewProps>>

const NO_OPTIONS: readonly ArtistBackgroundOption[] = []

type PickerProps = { artistId: number; onClose: () => void }

/** The options, asked for while the sheet is up, and the choice sent when one is pressed. */
function Picker({ artistId, onClose }: PickerProps) {
  const backgrounds = useQuery(queries.artistBackgroundsQuery(artistId))
  const choose = useChooseArtistBackground({
    api,
    artistId,
    onChosen: onClose,
    onFailure: toastFailure,
  })
  const View = PICKER_VIEWS[backgrounds.status]
  return (
    <View
      artistId={artistId}
      chosen={backgrounds.data?.chosen ?? null}
      isPending={choose.isPending}
      onChoose={choose.mutate}
      options={backgrounds.data?.options ?? NO_OPTIONS}
    />
  )
}

type ArtistBackgroundModalProps = {
  artistId: number
  artistName: string
  isOpen: boolean
  onClose: () => void
}

/**
 * The owner's way to change an artist's background: every picture raven has for them in a grid,
 * the one in use marked. A press on one sets it and closes the modal; Default photo goes back to
 * the photo raven found. Each picture lifts a little under the pointer or the keyboard's focus.
 */
export function ArtistBackgroundModal({
  artistId,
  artistName,
  isOpen,
  onClose,
}: ArtistBackgroundModalProps) {
  return (
    <BottomSheet
      head={{ title: ARTIST_COPY.backgroundTitle, subtitle: artistName }}
      isOpen={isOpen}
      isWide
      onClose={onClose}
    >
      <Picker artistId={artistId} onClose={onClose} />
    </BottomSheet>
  )
}
