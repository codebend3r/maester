import { useQuery } from '@tanstack/react-query'
import type { DirectoryListing } from '@raven/core'
import { type ComponentType, useState } from 'react'
import { Button, Icon } from '@raven/ui'
import { FOLDER_BROWSER_COPY } from '@/components/FolderBrowser/copy'
import { browseQuery } from '@/lib/queries'
import styles from '@/components/FolderBrowser/FolderBrowser.module.scss'
import { COMMON_COPY } from '@/lib/copy'

/** What the browser shows under where it is: the failure, word of no folders, or the folders. */
const LISTING_STATES = { failed: 'failed', empty: 'empty', folders: 'folders' } as const

type ListingState = (typeof LISTING_STATES)[keyof typeof LISTING_STATES]

type ListingViewProps = {
  error: Error | null
  directories: DirectoryListing['directories']
  onOpen: (path: string) => void
}

type ListingFailedProps = ListingViewProps

const ListingFailed = ({ error }: ListingFailedProps) => (
  <p className={styles.message} role="alert">
    {error?.message ?? ''}
  </p>
)

const ListingEmpty = () => <p className={styles.message}>{FOLDER_BROWSER_COPY.noFolders}</p>

type ListingFoldersProps = ListingViewProps

const ListingFolders = ({ directories, onOpen }: ListingFoldersProps) => (
  <ul className={styles.list}>
    {directories.map((entry) => (
      <li key={entry.path}>
        <button type="button" className={styles.entry} onClick={() => onOpen(entry.path)}>
          <Icon name="folder" size={18} />
          <span className={styles.name}>{entry.name}</span>
        </button>
      </li>
    ))}
  </ul>
)

const LISTING_VIEWS = {
  [LISTING_STATES.failed]: ListingFailed,
  [LISTING_STATES.empty]: ListingEmpty,
  [LISTING_STATES.folders]: ListingFolders,
} as const satisfies Record<ListingState, ComponentType<ListingViewProps>>

type ListingStateOfProps = { isError: boolean; data: DirectoryListing | undefined }

const listingStateOf = ({ isError, data }: ListingStateOfProps): ListingState => {
  if (isError) return LISTING_STATES.failed
  if (data?.directories.length === 0) return LISTING_STATES.empty
  return LISTING_STATES.folders
}

type FolderBrowserProps = {
  onChoose: (path: string) => void
  exclude: readonly string[]
}

/**
 * Walks the server's folders (as the server sees them: container paths under
 * Docker) so a library path is picked rather than typed from memory: where
 * it is, with the way up, the folders inside, and Use this folder.
 */
export const FolderBrowser = ({ onChoose, exclude }: FolderBrowserProps) => {
  const [path, setPath] = useState<string | null>(null)
  const listing = useQuery(browseQuery(path))
  const current = listing.data?.path ?? path ?? ''
  const alreadyAdded = exclude.includes(current)
  const Listing: ComponentType<ListingViewProps> = LISTING_VIEWS[listingStateOf(listing)]

  return (
    <section className={styles.browser} aria-label={FOLDER_BROWSER_COPY.chooseAFolder}>
      <div className={styles.location}>
        <Button
          icon="up"
          aria-label={FOLDER_BROWSER_COPY.upOneFolder}
          disabled={listing.data?.parent == null}
          onClick={() => setPath(listing.data?.parent ?? null)}
        />
        <span className={styles.path}>{current || COMMON_COPY.loading}</span>
      </div>

      <Listing
        error={listing.error}
        directories={listing.data?.directories ?? []}
        onOpen={setPath}
      />

      <Button
        tone="primary"
        className={styles.use}
        disabled={!listing.data || alreadyAdded}
        onClick={() => listing.data && onChoose(listing.data.path)}
      >
        {alreadyAdded ? FOLDER_BROWSER_COPY.folderAdded : FOLDER_BROWSER_COPY.thisFolder}
      </Button>
    </section>
  )
}
