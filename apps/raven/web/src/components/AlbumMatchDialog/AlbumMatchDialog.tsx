import { useMutation, useQuery } from '@tanstack/react-query'
import type { AlbumMatchCandidate, AlbumSummary } from '@raven/core'
import { Button } from '@raven/ui'
import { useSearch } from '@raven/ui/headless'
import { useId } from 'react'
import { MatchTier, hasBestMatch } from '@/components/MatchTier/MatchTier'
import { SearchField } from '@/components/SearchField/SearchField'
import { api } from '@/lib/api'
import { albumMatchSearchQuery } from '@/lib/queries'
import { useModal } from '@/lib/useModal'
import styles from '@/components/AlbumMatchDialog/AlbumMatchDialog.module.scss'

type CandidateProps = {
  candidate: AlbumMatchCandidate
  isBest: boolean
  disabled: boolean
  onChoose: () => void
}

const Candidate = ({ candidate, isBest, disabled, onChoose }: CandidateProps) => {
  const tierId = useId()
  const facts = [
    candidate.artist,
    ...(candidate.year === null ? [] : [String(candidate.year)]),
    candidate.type,
    ...(candidate.trackCount === null ? [] : [`${candidate.trackCount} tracks`]),
    ...(candidate.country === null ? [] : [candidate.country]),
  ]
  return (
    <li className={isBest ? `${styles.candidate} ${styles.best}` : styles.candidate}>
      <span className={styles.details}>
        <span className={styles.name}>{candidate.title}</span>
        <span className={styles.facts}>{facts.join(' · ')}</span>
        <MatchTier id={tierId} confidence={candidate.confidence} isBest={isBest} />
      </span>
      <Button
        className={styles.choose}
        disabled={disabled}
        onClick={onChoose}
        aria-label={`Choose ${candidate.title} by ${candidate.artist}`}
        aria-describedby={tierId}
      >
        Choose
      </Button>
    </li>
  )
}

type AlbumMatchDialogProps = {
  album: AlbumSummary
  onClose: () => void
  onMatched: () => void
}

/**
 * Fix match for an album: MusicBrainz's releases for its name, each with
 * how sure raven is, best first; other words can be searched for; Choose
 * points the album at a release, and "Not on MusicBrainz" at none.
 */
export const AlbumMatchDialog = ({ album, onClose, onMatched }: AlbumMatchDialogProps) => {
  const { dialog, close, keepKeys } = useModal()
  const titleId = useId()
  const search = useSearch({ initial: '' })
  const candidates = useQuery(albumMatchSearchQuery({ albumId: album.id, query: search.query }))
  const choose = useMutation({
    mutationFn: (mbid: string | null) => api.setAlbumMatch({ albumId: album.id, mbid }),
    onSuccess: () => onMatched(),
  })
  const isBest = (candidate: AlbumMatchCandidate): boolean => {
    const found = candidates.data ?? []
    return candidate === (found[0] ?? null) && hasBestMatch({ candidates: found })
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
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Fix match
          </h2>
          <p className={styles.album}>
            {album.title} · {album.artists.map(({ name }) => name).join(', ')}
          </p>
        </header>
        <SearchField
          search={search}
          aria-label="Search MusicBrainz"
          placeholder="Search MusicBrainz for other words"
        />
        {candidates.isPending && <p className={styles.note}>Searching MusicBrainz</p>}
        {candidates.error && (
          <p className={styles.note} role="alert">
            {candidates.error.message}
          </p>
        )}
        {candidates.data && candidates.data.length === 0 && (
          <p className={styles.note}>MusicBrainz lists nothing by that name.</p>
        )}
        {candidates.data && candidates.data.length > 0 && (
          <ol className={styles.candidates} aria-label="Releases">
            {candidates.data.map((candidate) => (
              <Candidate
                key={candidate.mbid}
                candidate={candidate}
                isBest={isBest(candidate)}
                disabled={choose.isPending}
                onChoose={() => choose.mutate(candidate.mbid)}
              />
            ))}
          </ol>
        )}
        {choose.error && (
          <p className={styles.note} role="alert">
            {choose.error.message}
          </p>
        )}
        <footer className={styles.footer}>
          <Button disabled={choose.isPending} onClick={() => choose.mutate(null)}>
            Not on MusicBrainz
          </Button>
          <Button tone="quiet" onClick={close}>
            Cancel
          </Button>
        </footer>
      </div>
    </dialog>
  )
}
