import { Inject, Injectable, Logger } from '@nestjs/common'
import { NOTIFICATION_TONES, type NotificationInput } from '@raven/core'
import { errorMessage } from '@/errorMessage'
import { ServerEvents } from '@/events/serverEvents'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ALBUM_OUTCOMES, type AlbumOutcome, AlbumMatching } from '@/music/albumMatching'
import { MusicMatchStore } from '@/music/musicMatchStore'
import { SMART_MATCH_COPY } from '@/music/smartMatchCopy'
import { Notices } from '@/notifications/notices'

/** The notification each album's outcome makes. */
const noticeOf = (outcome: AlbumOutcome): NotificationInput => {
  switch (outcome.kind) {
    case ALBUM_OUTCOMES.matched:
      return {
        message: SMART_MATCH_COPY.matched({
          album: outcome.album.title,
          release: outcome.release,
          isByClaude: outcome.isByClaude,
        }),
        tone: NOTIFICATION_TONES.success,
      }
    case ALBUM_OUTCOMES.unmatched:
      return {
        message: SMART_MATCH_COPY.unmatched(outcome.album.title),
        tone: NOTIFICATION_TONES.info,
      }
    default: {
      const unknown: never = outcome
      return unknown
    }
  }
}

type SmartMatchRunProps = { libraryId: number; account: AccountKey }

/**
 * Smart match, for the account that asked: each unmatched album whose
 * tracks belong to another album by where they sit is folded into it
 * first (`foldStrayAlbums`), then every album still unmatched is searched
 * again by a pass (`AlbumMatching.matchLibrary`). The account is told of each fold and each
 * album as it goes, and of the total at the end, each a notification; a
 * failure is told too, as nothing else would show it.
 */
@Injectable()
export class SmartMatch {
  private readonly logger = new Logger(SmartMatch.name)

  constructor(
    @Inject(MusicMatchStore) private readonly matches: MusicMatchStore,
    @Inject(AlbumMatching) private readonly matching: Pick<AlbumMatching, 'matchLibrary' | 'retry'>,
    @Inject(Notices) private readonly notices: Notices,
    @Inject(ServerEvents) private readonly events: ServerEvents,
  ) {}

  async run({ libraryId, account }: SmartMatchRunProps): Promise<void> {
    const notify = (notice: NotificationInput): void => {
      this.notices.notify({ account, ...notice })
    }
    try {
      const folds = this.matches.foldStrays(libraryId)
      folds.forEach((fold) =>
        notify({ message: SMART_MATCH_COPY.folded(fold), tone: NOTIFICATION_TONES.success }),
      )
      this.matching.retry(libraryId)
      const tally = await this.matching.matchLibrary({
        libraryId,
        onOutcome: (outcome) => notify(noticeOf(outcome)),
      })
      notify({
        message: SMART_MATCH_COPY.finished({ ...tally, folded: folds.length }),
        tone: NOTIFICATION_TONES.info,
      })
    } catch (error) {
      this.logger.warn(`Smart match of library ${libraryId} failed: ${errorMessage(error)}`)
      notify({
        message: SMART_MATCH_COPY.failed(errorMessage(error)),
        tone: NOTIFICATION_TONES.failure,
      })
    } finally {
      this.events.libraryChanged(libraryId)
    }
  }
}
