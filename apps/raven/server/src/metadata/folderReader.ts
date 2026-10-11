import { listFolder } from '@/metadata/localAssets'
import type { MatchFiles } from '@/metadata/matchFiles'
import { OnceEach } from '@/metadata/onceEach'
import { holdsOneMovie } from '@/metadata/places'

/**
 * What matching and refreshing read about folders, each once: the file
 * names in a folder, and whether a folder holds one movie. One reader lives
 * for one pass or one refresh, so a change on disk is seen by the next.
 */
export class FolderReader {
  private readonly listings = new OnceEach<Promise<string[]>>()
  private readonly ownFolders = new OnceEach<boolean>()

  constructor(private readonly files: MatchFiles) {}

  /** The file names in `dir`; none when it cannot be read. */
  names(dir: string): Promise<string[]> {
    return this.listings.get({ key: dir, make: () => listFolder(dir) })
  }

  /**
   * Whether a library folder holds one movie, perhaps in several qualities:
   * its own pictures, NFO and Fix match then belong to that movie.
   */
  ownFolder({ libraryId, folder }: { libraryId: number; folder: string }): boolean {
    return this.ownFolders.get({
      key: `${libraryId}:${folder}`,
      make: () =>
        holdsOneMovie({
          folder,
          files: folder === '' ? [] : this.files.inFolder({ libraryId, folder }),
        }),
    })
  }
}
