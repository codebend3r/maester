import { Inject, Injectable } from '@nestjs/common'
import {
  type Credit,
  type CreditJob,
  isCreditJob,
  isMatchItemType,
  isNumber,
  ITEM_TYPES,
  listOf,
  type PersonDetails,
  type PersonProfile,
} from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import { likePattern, under } from '@/media/mediaSql'
import { MetadataRepository } from '@/metadata/metadataRepository'
import { PictureVersions } from '@/metadata/pictureVersions'
import type { FetchedCredit, FetchedPerson, FetchedPersonCredit } from '@/metadata/tmdbShapes'

/** One of a person's TMDB credits as stored, with raven's item for its title. */
export type FilmographyRow = Pick<
  FetchedPersonCredit,
  | 'type'
  | 'tmdbId'
  | 'title'
  | 'released'
  | 'poster'
  | 'genreIds'
  | 'department'
  | 'role'
  | 'episodes'
> & {
  /** The movie or show of that type and TMDB id, whether or not a file of it is on disk. */
  itemId: number | null
}

/** A person's TMDB id, name and photo, what TMDB says of them, and when their filmography was fetched. */
export type StoredProfile = {
  tmdbId: string
  name: string
  photoVersion: string | null
  /** Null until a filmography has been fetched. */
  profile: PersonProfile | null
  fetchedAt: string | null
}

type ProfileRow = {
  tmdb_id: string
  name: string
  photo: string | null
  imdb_id: string | null
  birthday: string | null
  deathday: string | null
  place_of_birth: string | null
  biography: string | null
  known_for: string | null
  filmography_fetched_at: string | null
}

type CreditRow = {
  type: string
  tmdb_id: string
  title: string
  released: string | null
  poster: string | null
  genre_ids: string
  department: string
  role: string | null
  episodes: number | null
  item_id: number | null
}

const isGenreIds = listOf(isNumber)

/** A credit on a movie or show raven holds, with the title's TMDB id and date, which only the server reads. */
export type LocalCredit = PersonDetails['credits'][number] & {
  tmdbId: string
  released: string | null
}

/** A person as raven's own credits know them; what TMDB says of them is `profile`'s. */
export type StoredPerson = Pick<PersonDetails, 'id' | 'tmdbId' | 'name' | 'photoVersion'> & {
  credits: LocalCredit[]
}

type PersonRow = { id: number; tmdb_id: string; name: string; photo: string | null }

type CreditOnDiskRow = {
  item_id: number
  tmdb_id: string
  released: string | null
  job: string
  role: string | null
}

/** A credit on a title on disk whose job the contract knows. */
type CreditOnDisk = Omit<CreditOnDiskRow, 'job'> & { job: CreditJob }

/** A person whose name a search matched. */
export type NamedPerson = { id: number; name: string; photoVersion: string | null }

type PeopleRepositoryNamedProps = {
  search: string
  limit: number
}

type PeopleRepositorySaveFilmographyProps = {
  personId: number
  tmdbId: string
  person: FetchedPerson
  at: string
}

/** A person's page as TMDB describes it: who they are, and everything they are credited on. */
@Injectable()
export class PeopleRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PictureVersions) private readonly pictureVersions: PictureVersions,
    @Inject(MetadataRepository) private readonly metadata: MetadataRepository,
  ) {}

  private get db(): Sqlite.Database {
    return this.database.db
  }

  /** A person's page: the movies and shows on disk they are credited on, newest first. */
  person(id: number): StoredPerson | null {
    const row = this.db
      .prepare<[number], PersonRow>('SELECT id, tmdb_id, name, photo FROM people WHERE id = ?')
      .get(id)
    if (!row) return null
    const credits = this.creditsOnDisk(id)
    const summaries = this.metadata.summaries({
      ids: credits.map((credit) => credit.item_id),
      libraryId: null,
    })
    return {
      id: row.id,
      tmdbId: row.tmdb_id,
      name: row.name,
      photoVersion: this.pictureVersions.photo({ id: row.id, photo: row.photo }),
      credits: credits.flatMap((credit) => {
        const item = summaries.get(credit.item_id)
        return item
          ? [
              {
                item,
                job: credit.job,
                role: credit.role,
                tmdbId: credit.tmdb_id,
                released: credit.released,
              },
            ]
          : []
      }),
    }
  }

  /** The ids of the movies and shows on disk a person is credited on, once for each credit; a search counts them without reading each title. */
  creditedItemIds(personId: number): number[] {
    return this.creditsOnDisk(personId).map((credit) => credit.item_id)
  }

  /** A person's credits on movies and shows a file of is on disk, newest first. */
  private creditsOnDisk(personId: number): CreditOnDisk[] {
    return this.db
      .prepare<[number, number], CreditOnDiskRow>(
        `WITH RECURSIVE ${under('SELECT item_id, item_id FROM credits WHERE person_id = ?')}
         SELECT c.item_id, i.tmdb_id, i.released, c.job, c.role
           FROM credits c JOIN items i ON i.id = c.item_id
          WHERE c.person_id = ? AND i.type IN ('${ITEM_TYPES.movie}', '${ITEM_TYPES.show}')
            AND c.item_id IN (SELECT u.root FROM under u JOIN media_items mi ON mi.item_id = u.id)
          ORDER BY i.released DESC, i.title`,
      )
      .all(personId, personId)
      .flatMap((row) => (isCreditJob(row.job) ? [{ ...row, job: row.job }] : []))
  }

  /**
   * Credits as TMDB gave them for a title no library holds, each person kept
   * in raven's people under their TMDB id, so their photo and page work as a
   * library title's cast does.
   */
  creditsOf(credits: readonly FetchedCredit[]): Credit[] {
    return this.metadata.savePeople(credits).map(({ credit, personId }) => ({
      personId,
      name: credit.name,
      job: credit.job,
      role: credit.role,
      photoVersion: this.pictureVersions.photo({ id: personId, photo: credit.photo }),
    }))
  }

  /** A person's photo path on TMDB, or null. */
  photo(personId: number): string | null {
    return (
      this.db
        .prepare<[number], { photo: string | null }>('SELECT photo FROM people WHERE id = ?')
        .get(personId)?.photo ?? null
    )
  }

  /** Null for an id that names no one. */
  profile(personId: number): StoredProfile | null {
    const row = this.db
      .prepare<[number], ProfileRow>(
        `SELECT tmdb_id, name, photo, imdb_id, birthday, deathday, place_of_birth, biography,
                known_for, filmography_fetched_at
           FROM people WHERE id = ?`,
      )
      .get(personId)
    if (!row) return null
    return {
      tmdbId: row.tmdb_id,
      name: row.name,
      photoVersion: this.pictureVersions.photo({ id: personId, photo: row.photo }),
      fetchedAt: row.filmography_fetched_at,
      profile:
        row.filmography_fetched_at == null
          ? null
          : {
              imdbId: row.imdb_id,
              birthday: row.birthday,
              deathday: row.deathday,
              placeOfBirth: row.place_of_birth,
              biography: row.biography,
              knownFor: row.known_for,
            },
    }
  }

  /**
   * People whose name holds `search`, ignoring case: one named exactly that
   * first, then whoever is credited on the most of raven's titles.
   */
  named({ search, limit }: PeopleRepositoryNamedProps): NamedPerson[] {
    return this.db
      .prepare<
        { search: string; pattern: string; limit: number },
        { id: number; name: string; photo: string | null }
      >(
        `SELECT p.id, p.name, p.photo
           FROM people p
          WHERE p.name LIKE @pattern ESCAPE '\\'
          ORDER BY lower(p.name) = lower(@search) DESC,
                   (SELECT COUNT(*) FROM credits c WHERE c.person_id = p.id) DESC,
                   p.name
          LIMIT @limit`,
      )
      .all({ search, pattern: likePattern(search), limit })
      .map((row) => ({
        id: row.id,
        name: row.name,
        photoVersion: this.pictureVersions.photo({ id: row.id, photo: row.photo }),
      }))
  }

  /**
   * Puts what TMDB says of a person in place of what it said before, credits
   * and all. `tmdbId` is the one the fetch asked for.
   */
  saveFilmography({ personId, tmdbId, person, at }: PeopleRepositorySaveFilmographyProps): void {
    this.db.transaction(() => {
      const updated = this.db
        .prepare(
          `UPDATE people
              SET name = @name, photo = @photo, imdb_id = @imdbId, birthday = @birthday,
                  deathday = @deathday, place_of_birth = @placeOfBirth, biography = @biography,
                  known_for = @knownFor, filmography_fetched_at = @at
            WHERE id = @personId AND tmdb_id = @tmdbId`,
        )
        .run({
          personId,
          tmdbId,
          at,
          name: person.name,
          photo: person.photo,
          imdbId: person.imdbId,
          birthday: person.birthday,
          deathday: person.deathday,
          placeOfBirth: person.placeOfBirth,
          biography: person.biography,
          knownFor: person.knownFor,
        })
      /*
       * A person cleared up while TMDB was answering has no row to hang credits
       * on, and their id may since have gone to someone else.
       */
      if (updated.changes === 0) return
      this.db.prepare('DELETE FROM person_credits WHERE person_id = ?').run(personId)
      const insert = this.db.prepare(
        `INSERT INTO person_credits (person_id, credit_id, type, tmdb_id, title, released, poster,
                                     genre_ids, department, role, episodes, position)
         VALUES (@personId, @creditId, @type, @tmdbId, @title, @released, @poster,
                 @genreIds, @department, @role, @episodes, @position)`,
      )
      person.credits.forEach((credit) =>
        insert.run({ ...credit, personId, genreIds: JSON.stringify(credit.genreIds) }),
      )
    })()
  }

  /** A person's TMDB credits in TMDB's order, each with the item raven keeps for its title. */
  filmographyRows(personId: number): FilmographyRow[] {
    return this.db
      .prepare<[number], CreditRow>(
        `SELECT pc.type, pc.tmdb_id, pc.title, pc.released, pc.poster, pc.genre_ids,
                pc.department, pc.role, pc.episodes, i.id AS item_id
           FROM person_credits pc
           LEFT JOIN items i ON i.type = pc.type AND i.tmdb_id = pc.tmdb_id
          WHERE pc.person_id = ?
          ORDER BY pc.position`,
      )
      .all(personId)
      .flatMap((row): FilmographyRow[] =>
        isMatchItemType(row.type)
          ? [
              {
                type: row.type,
                tmdbId: row.tmdb_id,
                title: row.title,
                released: row.released,
                poster: row.poster,
                genreIds: parseJsonAs({ json: row.genre_ids, guard: isGenreIds }) ?? [],
                department: row.department,
                role: row.role,
                episodes: row.episodes,
                itemId: row.item_id,
              },
            ]
          : [],
      )
  }
}
