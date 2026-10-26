import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Icon } from '@raven/ui'
import { browseQuery } from '@/lib/queries'
import styles from '@/components/FolderBrowser/FolderBrowser.module.scss'

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
    <section className={styles.browser} aria-label="Choose a folder">
      <div className={styles.location}>
        <Button
          icon="up"
          aria-label="Up one folder"
          disabled={listing.data?.parent == null}
          onClick={() => setPath(listing.data?.parent ?? null)}
        />
        <span className={styles.path}>{current || 'Loading'}</span>
      </div>

      {listing.isError ? (
        <p className={styles.message} role="alert">
          {listing.error.message}
        </p>
      ) : listing.data?.directories.length === 0 ? (
        <p className={styles.message}>No folders inside this one.</p>
      ) : (
        <ul className={styles.list}>
          {(listing.data?.directories ?? []).map((entry) => (
            <li key={entry.path}>
              <button type="button" className={styles.entry} onClick={() => setPath(entry.path)}>
                <Icon name="folder" size={18} />
                <span className={styles.name}>{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        tone="primary"
        className={styles.use}
        disabled={!listing.data || alreadyAdded}
        onClick={() => listing.data && onChoose(listing.data.path)}
      >
        {alreadyAdded ? 'Folder added' : 'Use this folder'}
      </Button>
    </section>
  )
}
