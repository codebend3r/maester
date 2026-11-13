import { useQuery } from '@tanstack/react-query'
import type { DirectoryListing } from '@raven/core'
import { useState } from 'react'
import { BUTTON_TONES, Button, Icon } from '@raven/ui'
import { FOLDER_BROWSER_COPY } from '@/components/FolderBrowser/copy'
import { browseQuery } from '@/lib/queries'
import styles from '@/components/FolderBrowser/FolderBrowser.module.scss'
import { COMMON_COPY } from '@/lib/copy'
import { QueryView } from '@raven/ui/headless'

type ListingFoldersProps = {
  directories: DirectoryListing['directories']
  onOpen: (path: string) => void
}

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

/** Whether a folder holds no folders. */
const hasNoFolders = ({ directories }: DirectoryListing): boolean => directories.length === 0

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

  return (
    <section className={styles.browser} aria-label={FOLDER_BROWSER_COPY.chooseAFolder}>
      <div className={styles.location}>
        <Button
          icon="up"
          aria-label={FOLDER_BROWSER_COPY.upOneFolder}
          disabled={listing.data?.parent == null}
          onClick={() => setPath(listing.data?.parent ?? null)}
        />
        <span className={styles.path}>{current === '' ? COMMON_COPY.loading : current}</span>
      </div>

      <QueryView
        query={listing}
        pending={<ListingFolders directories={[]} onOpen={setPath} />}
        renderFailed={(error) => (
          <p className={styles.message} role="alert">
            {error.message}
          </p>
        )}
        empty={{
          isEmpty: hasNoFolders,
          shown: <p className={styles.message}>{FOLDER_BROWSER_COPY.noFolders}</p>,
        }}
      >
        {({ directories }) => <ListingFolders directories={directories} onOpen={setPath} />}
      </QueryView>

      <Button
        tone={BUTTON_TONES.primary}
        className={styles.use}
        disabled={!listing.data || alreadyAdded}
        onClick={() => listing.data && onChoose(listing.data.path)}
      >
        {alreadyAdded ? FOLDER_BROWSER_COPY.folderAdded : FOLDER_BROWSER_COPY.thisFolder}
      </Button>
    </section>
  )
}
