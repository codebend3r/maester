import {
  Controller,
  Get,
  Req,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common'
import type { PersonDetails } from '@raven/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { sendImage } from '@/items/sendImage'
import { Public } from '@/lock/lockGuard'
import { LockService } from '@/lock/lockService'
import { IMAGE_WIDTHS, ImageCache } from '@/metadata/imageCache'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { Filmographies } from '@/people/filmographies'
import { PeopleRepository } from '@/people/peopleRepository'

/** People are in no library; a person's credits hide the movies and shows this caller may not see. */
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
    @Req() request: FastifyRequest,
  ): Promise<PersonDetails> {
    const person = this.metadata.person(id)
    if (!person) throw new NotFoundException(`No person ${id}`)
    const viewer = this.lock.viewer({ request })
    const credits = person.credits.filter((credit) => viewer.seesItem(credit.item.id))
    // A person whose titles are all hidden from this caller is never looked
    // up; the rest share two lookups at a time, with 20 waiting.
    const asked = credits.length > 0 ? await this.filmographies.ensure({ personId: id }) : null
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
        isTurnedAway: asked?.isTurnedAway ?? false,
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
