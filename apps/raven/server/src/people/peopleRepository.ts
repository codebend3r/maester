import { Inject, Injectable } from '@nestjs/common'
import { isMatchItemType, isNumber, listOf, type PersonProfile } from '@raven/core'
import type Sqlite from 'better-sqlite3'
import { DatabaseService } from '@/db/database'
import { parseJsonAs } from '@/db/json'
import { PictureVersions } from '@/metadata/pictureVersions'
import type { FetchedPerson, FetchedPersonCredit } from '@/metadata/tmdbClient'

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

/** A person's page as TMDB describes it: who they are, and everything they are credited on. */
@Injectable()
export class PeopleRepository {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PictureVersions) private readonly pictureVersions: PictureVersions,
  ) {}

  private get db(): Sqlite.Database {
    return this.database.db
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
   * Puts what TMDB says of a person in place of what it said before, credits
   * and all. `tmdbId` is the one the fetch asked for.
   */
  saveFilmography({
    personId,
    tmdbId,
    person,
    at,
  }: {
    personId: number
    tmdbId: string
    person: FetchedPerson
    at: string
  }): void {
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
      // A person cleared up while TMDB was answering has no row to hang credits
      // on, and their id may since have gone to someone else.
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
