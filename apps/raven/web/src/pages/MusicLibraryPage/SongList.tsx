import { RADIO_SEED_KINDS, type Track } from '@raven/core'
import { Button } from '@raven/ui'
import { useAudioQueue } from '@raven/ui/headless'
import { START_RADIO_LOOKS, StartRadio } from '@/components/StartRadio/StartRadio'
import { TrackList, type TrailProps } from '@/components/TrackList/TrackList'
import { MUSIC_LIBRARY_COPY } from '@/pages/MusicLibraryPage/copy'
import styles from '@/pages/MusicLibraryPage/MusicLibraryPage.module.scss'

type SongControlsProps = TrailProps

/** A song's row: Start radio from it. */
const SongControls = ({ track }: SongControlsProps) => (
  <StartRadio
    seed={{ kind: RADIO_SEED_KINDS.track, id: track.id }}
    title={track.title}
    look={START_RADIO_LOOKS.icon}
  />
)

type SongListProps = {
  tracks: readonly Track[]
  label: string
  hasMore: boolean
  isLoadingMore: boolean
  onMore: () => void
}

/** Songs from every music library, played as a queue of the list shown, with Show more past a page. */
export const SongList = ({ tracks, label, hasMore, isLoadingMore, onMore }: SongListProps) => {
  const playTracks = useAudioQueue((store) => store.playTracks)
  return (
    <div className={styles.songs}>
      <TrackList
        tracks={tracks}
        onPlay={(startAt) => playTracks({ tracks, startAt })}
        numberOf={({ index }) => index + 1}
        Trail={SongControls}
        label={label}
      />
      {hasMore && (
        <Button className={styles.more} disabled={isLoadingMore} onClick={onMore}>
          {MUSIC_LIBRARY_COPY.showMore}
        </Button>
      )}
    </div>
  )
}
