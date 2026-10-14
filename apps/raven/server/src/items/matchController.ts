import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  type CandidateTier,
  firstTierFor,
  fitsTier,
  isMatchChoice,
  isMatchItemType,
  type MatchCandidate,
  type MatchItemType,
  type MatchSubject,
  type MediaItem,
  matchTypeFor,
  parseEpisodeName,
  showFolderOf,
  splitCountry,
} from '@raven/core'
import type { FastifyReply } from 'fastify'
import { AdminOnly } from '@/admin/adminGuard'
import { isChoosableImageKind } from '@/items/imageKinds'
import { sendImage } from '@/items/sendImage'
import { LibrariesRepository } from '@/libraries/librariesRepository'
import { PrivateBy, Public } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { MediaRepository } from '@/media/mediaRepository'
import { IMAGE_WIDTHS, ImageCache } from '@/metadata/imageCache'
import { type OnDisk, scoreCandidates } from '@/metadata/matchConfidence'
import { MatchFactsCache } from '@/metadata/matchFactsCache'
import { type MatchFile, MatchFiles } from '@/metadata/matchFiles'
import { MetadataService } from '@/metadata/metadataService'
import { type SearchResult, TMDB_IMAGE_PATH, TmdbClient, TmdbError } from '@/metadata/tmdbClient'

const tmdbFailure = (error: unknown): never => {
  if (error instanceof TmdbError) throw new ServiceUnavailableException(error.message)
  throw error
}

/** A file a search's subject stands for, as its score reads it. */
type SubjectFile = Pick<
  MediaItem,
  'libraryId' | 'fileName' | 'folder' | 'match' | 'duration' | 'edition'
>

/** How many of the first-scored results Fix match reads the details of. */
const DETAILS_FOR = 5

/** How long a search waits for those details; any that land later are kept for the next. */
const DETAILS_DEADLINE_MS = 2500

const WHOLE_NUMBER = /^\d+$/

/** What a search scores against when it is for nothing on disk, or for something this browser may not see. */
const NOTHING_ON_DISK = { onDisk: null, country: null } as const satisfies {
  onDisk: OnDisk | null
  country: string | null
}

/** A show's file as its score reads it: a show's files never need a duration or an edition. */
const asShowFile = ({ libraryId, fileName, folder, match }: MatchFile): SubjectFile => ({
  libraryId,
  fileName,
  folder,
  match,
  duration: null,
  edition: null,
})

/** The file or show a search names, or null for none; a malformed id, or both, is a 400. */
const subjectFrom = ({
  mediaId,
  itemId,
}: {
  mediaId: string | undefined
  itemId: string | undefined
}): MatchSubject | null => {
  if (mediaId != null && itemId != null) {
    throw new BadRequestException('Name a file or a show, not both.')
  }
  if (mediaId != null) {
    if (!WHOLE_NUMBER.test(mediaId)) throw new BadRequestException('mediaId must be a media id')
    return { kind: 'media', id: Number(mediaId) }
  }
  if (itemId != null) {
    if (!WHOLE_NUMBER.test(itemId)) throw new BadRequestException('itemId must be an item id')
    return { kind: 'item', id: Number(itemId) }
  }
  return null
}

/** Fix match: searching TMDB from a page, and pointing a file at what the viewer picks. */
@Controller('api')
export class MatchController {
  constructor(
    @Inject(TmdbClient) private readonly tmdb: TmdbClient,
    @Inject(MediaRepository) private readonly media: MediaRepository,
    @Inject(LibrariesRepository) private readonly libraries: LibrariesRepository,
    @Inject(MetadataService) private readonly service: MetadataService,
    @Inject(ImageCache) private readonly images: ImageCache,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(MatchFiles) private readonly files: MatchFiles,
    @Inject(MatchFactsCache) private readonly facts: MatchFactsCache,
  ) {}

  private requireTmdb(): void {
    if (!this.tmdb.enabled) {
      throw new ServiceUnavailableException('Set TMDB_API_TOKEN to search TMDB.')
    }
  }

  /**
   * TMDB's results for Fix match, each with how sure raven is of it, best
   * first. With `libraryId`, those that fit the library type's first tier
   * come first among equals; with `mediaId` or `itemId`, they are scored
   * against what that file's show folder, that movie file or that show has
   * on disk. A country suffix typed, `The Office (UK)`, is the country
   * searched for, ahead of the subject's, and never part of the title.
   */
  @AdminOnly()
  @Get('match/search')
  async search(
    @Query('type') type: string | undefined,
    @Query('query') query: string | undefined,
    @Query('year') year: string | undefined,
    @Query('libraryId') libraryId: string | undefined,
    @Query('mediaId') mediaId: string | undefined,
    @Query('itemId') itemId: string | undefined,
    @Headers('cookie') cookie: string | undefined,
  ): Promise<MatchCandidate[]> {
    if (!isMatchItemType(type)) throw new BadRequestException('type must be movie or show')
    const typed = splitCountry(query?.trim() ?? '')
    if (!typed.title) throw new BadRequestException('Search for a title.')
    const preferred = this.preferredBy({ libraryId, cookie })
    const subject = subjectFrom({ mediaId, itemId })
    this.requireTmdb()
    const parsedYear = Number.parseInt(year ?? '', 10)
    const asked = { query: typed.title, year: Number.isInteger(parsedYear) ? parsedYear : null }
    const results = await (
      type === 'movie' ? this.tmdb.searchMovies(asked) : this.tmdb.searchShows(asked)
    ).catch(tmdbFailure)
    const rank = (result: SearchResult): number => (fitsTier({ tier: preferred, result }) ? 0 : 1)
    const ordered = results.toSorted((a, b) => rank(a) - rank(b))
    const { onDisk, country } = this.onDiskOf({ type, subject, cookie })
    const scoring = {
      title: asked.query,
      year: asked.year,
      country: typed.country ?? country,
      results: ordered,
      tier: preferred,
      onDisk,
    }
    const first = scoreCandidates({ ...scoring, facts: new Map() })
    const top = ordered
      .map((result, index) => ({ tmdbId: result.tmdbId, confidence: first[index] ?? 0 }))
      .toSorted((a, b) => b.confidence - a.confidence)
      .slice(0, DETAILS_FOR)
      .map((each) => each.tmdbId)
    const confidences = scoreCandidates({
      ...scoring,
      facts: await this.facts.read({ type, tmdbIds: top, deadlineMs: DETAILS_DEADLINE_MS }),
    })
    return ordered
      .map(({ tmdbId, title, year: released, overview, poster }, index) => ({
        tmdbId,
        title,
        year: released,
        overview,
        poster,
        confidence: confidences[index] ?? 0,
      }))
      .toSorted((a, b) => b.confidence - a.confidence)
  }

  /**
   * The tier a library's type prefers first; every result for no library,
   * one raven no longer has, or one the lock keeps from this browser, so the
   * order never tells a hidden library's type, or that it is there.
   */
  private preferredBy({
    libraryId,
    cookie,
  }: {
    libraryId: string | undefined
    cookie: string | undefined
  }): CandidateTier {
    if (libraryId == null) return {}
    if (!WHOLE_NUMBER.test(libraryId)) {
      throw new BadRequestException('libraryId must be a library id')
    }
    const id = Number(libraryId)
    if (!this.lock.viewer({ cookie }).seesLibrary(id)) return {}
    const kind = this.libraries.get(id)?.settings.kind
    return kind == null ? {} : firstTierFor(kind)
  }

  /**
   * What a search's subject has on disk, and the country its name gives;
   * nothing for no subject, one raven no longer has, or one in a library
   * the lock keeps from this browser, so the scores never tell it is there.
   */
  private onDiskOf({
    type,
    subject,
    cookie,
  }: {
    type: MatchItemType
    subject: MatchSubject | null
    cookie: string | undefined
  }): { onDisk: OnDisk | null; country: string | null } {
    if (subject == null) return NOTHING_ON_DISK
    const viewer = this.lock.viewer({ cookie })
    // An extra is never matched (`off`), so a trailer's numbers say nothing of the show.
    const files = this.subjectFiles({ type, subject }).filter(
      (file) => file.match !== 'off' && viewer.seesLibrary(file.libraryId),
    )
    const [first] = files
    if (first == null) return NOTHING_ON_DISK
    switch (type) {
      case 'movie':
        // A cut, extended or director's, runs its own length rather than TMDB's runtime.
        return {
          onDisk: { type: 'movie', duration: first.edition == null ? first.duration : null },
          country: null,
        }
      case 'show': {
        const named = files.map((file) =>
          parseEpisodeName({ fileName: file.fileName, folder: file.folder }),
        )
        return {
          onDisk: {
            type: 'show',
            files: named.map(({ season, episodes, absolute, year }) => ({
              season,
              episodes,
              absolute,
              year,
            })),
          },
          country: named.find((name) => name.country != null)?.country ?? null,
        }
      }
      default: {
        const unreachable: never = type
        return unreachable
      }
    }
  }

  /**
   * The files a subject stands for: a show file's whole show folder, a movie
   * file alone, a matched show's every file, or a movie item's files, best first.
   */
  private subjectFiles({
    type,
    subject,
  }: {
    type: MatchItemType
    subject: MatchSubject
  }): SubjectFile[] {
    switch (subject.kind) {
      case 'media': {
        const file = this.media.get(subject.id)
        if (file == null) return []
        const showFolder = type === 'show' ? showFolderOf(file) : null
        if (showFolder == null) return [file]
        return this.files
          .underFolder({ libraryId: file.libraryId, folder: showFolder })
          .map(asShowFile)
      }
      case 'item':
        return type === 'show'
          ? this.files.under(subject.id).map(asShowFile)
          : this.media.forItem(subject.id)
      default: {
        const unreachable: never = subject
        return unreachable
      }
    }
  }

  /**
   * A search result's poster, or a poster, backdrop or logo Edit images
   * offers, through the cache, so the browser never talks to TMDB.
   */
  @Public()
  @Get('images/:use/:file')
  async candidate(
    @Param('use') use: string,
    @Param('file') file: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const path = `/${file}`
    if (!isChoosableImageKind(use) || !TMDB_IMAGE_PATH.test(path)) {
      throw new NotFoundException('No such picture')
    }
    await sendImage({
      reply,
      path: await this.images.tmdb({ path, width: IMAGE_WIDTHS[use] }),
      version: file,
    })
  }

  /**
   * Saves a Fix match: `{ tmdbId }` points the file (and its folder, when
   * that holds one movie or show) at a TMDB movie or show; `{ tmdbId: null }`
   * says it is not one. Kept through renames, and never replaced by matching.
   */
  @PrivateBy('media')
  @AdminOnly()
  @Put('media/:id/match')
  async setMatch(@Param('id', ParseIntPipe) id: number, @Body() body: unknown): Promise<MediaItem> {
    const record = this.media.get(id)
    if (!record) throw new NotFoundException(`No media ${id}`)
    if (!isMatchChoice(body)) throw new BadRequestException('tmdbId must be a TMDB id or null')
    const kind = this.libraries.get(record.libraryId)?.settings.kind
    if (kind == null || matchTypeFor(kind) == null) {
      throw new BadRequestException('Only files in a library of movies or shows can be matched.')
    }
    const tmdbId = body.tmdbId
    if (tmdbId != null) this.requireTmdb()
    await this.service.fixMatch({ mediaId: id, tmdbId }).catch(tmdbFailure)
    const updated = this.media.get(id)
    if (!updated) throw new NotFoundException(`No media ${id}`)
    return updated
  }
}
