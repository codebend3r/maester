import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common'
import type { PersonDetails } from '@raven/core'
import type { FastifyReply } from 'fastify'
import { RAVEN_HEADERS } from '@/http'
import { sendImage } from '@/items/sendImage'
import { Public } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { IMAGE_WIDTHS, ImageCache } from '@/metadata/imageCache'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { Filmographies } from '@/people/filmographies'
import { PeopleRepository } from '@/people/peopleRepository'

/** People are in no library; a person's credits hide the movies and shows this browser may not see. */
@Controller('api/people')
@Public()
export class PeopleController {
  constructor(
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
    @Inject(ImageCache) private readonly images: ImageCache,
    @Inject(LockService) private readonly lock: LockService,
    @Inject(PeopleRepository) private readonly people: PeopleRepository,
    @Inject(Filmographies) private readonly filmographies: Filmographies,
  ) {}

  /**
   * A person, what TMDB says of them and everything it credits them on, and
   * the movies and shows in raven they are credited on, but for locked ones.
   */
  @Get(':id')
  async get(
    @Param('id', ParseIntPipe) id: number,
    @Headers(RAVEN_HEADERS.cookie) cookie: string | undefined,
  ): Promise<PersonDetails> {
    const person = this.metadata.person(id)
    if (!person) throw new NotFoundException(`No person ${id}`)
    const viewer = this.lock.viewer({ cookie })
    const credits = person.credits.filter((credit) => viewer.seesItem(credit.item.id))
    // Only someone this browser finds in raven is worth asking TMDB about,
    // so walking every id asks it nothing.
    if (credits.length > 0) await this.filmographies.ensure({ personId: id })
    // Read again, for the name and photo a fetch just brought.
    const latest = this.people.profile(id) ?? { ...person, profile: null }
    return {
      ...person,
      name: latest.name,
      photoVersion: latest.photoVersion,
      profile: latest.profile,
      filmography: this.filmographies.read({
        personId: id,
        sees: viewer.seesLibrary,
        localCredits: credits,
      }),
      credits: credits.map(({ item, job, role }) => ({ item, job, role })),
    }
  }

  /** A person's photo from TMDB, fetched and cached on first use. */
  @Get(':id/photo')
  async photo(
    @Param('id', ParseIntPipe) id: number,
    @Query('v') version: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const photo = this.metadata.photo(id)
    const path =
      photo == null ? null : await this.images.tmdb({ path: photo, width: IMAGE_WIDTHS.photo })
    await sendImage({ reply, path, version })
  }
}
