import { Inject, Injectable } from '@nestjs/common'
import { type AiSuggestion, type Infer, oneOf } from '@raven/core'
import { DatabaseService } from '@/db/database'

/** How sure the AI lookup was: `high` is matched, `low` is a suggestion. */
export const isAiConfidence = oneOf(['high', 'low'])

export type AiConfidence = Infer<typeof isAiConfidence>

/** The movie or show the AI lookup chose, as the search that offered it described it. */
export type AiPick = Omit<AiSuggestion, 'reason' | 'place'>

/** How one lookup came out. */
export type AiOutcome =
  /** Claude chose a result `search_tmdb` offered in the lookup. */
  | { kind: 'chosen'; pick: AiPick; confidence: AiConfidence; reason: string }
  /** Claude chose nothing: no result fits, or the files are another show's. */
  | { kind: 'none'; confidence: AiConfidence; reason: string }
  /** No decision: a refusal, no `choose_match`, an id never offered, or out of turns. */
  | { kind: 'undecided'; reason: string }

/** Where a decision is kept: a group's place in a library, as a Fix match is. */
export type DecisionPlace = { libraryId: number; place: string }

/** A decision as its columns hold it. */
type Row = {
  tmdbId: string | null
  title: string | null
  year: number | null
  poster: string | null
  confidence: AiConfidence
  reason: string
}

/** How an outcome is kept: one with no decision counts as low, with no id. */
const rowOf = (outcome: AiOutcome): Row => {
  switch (outcome.kind) {
    case 'chosen':
      return { ...outcome.pick, confidence: outcome.confidence, reason: outcome.reason }
    case 'none':
      return {
        tmdbId: null,
        title: null,
        year: null,
        poster: null,
        confidence: outcome.confidence,
        reason: outcome.reason,
      }
    case 'undecided':
      return {
        tmdbId: null,
        title: null,
        year: null,
        poster: null,
        confidence: 'low',
        reason: outcome.reason,
      }
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

/**
 * What the AI lookup decided for each group it was asked about, by library
 * and place, so a group is asked once. A sure pick is matched; an unsure
 * one is a suggestion; no pick is asked again after Match again.
 */
@Injectable()
export class AiDecisions {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db
  }

  /** Keeps a lookup's outcome for its place, replacing the one before. */
  record({
    libraryId,
    place,
    outcome,
    model,
  }: DecisionPlace & { outcome: AiOutcome; model: string }): void {
    const row = rowOf(outcome)
    this.db
      .prepare(
        `INSERT INTO ai_decisions
           (library_id, place, tmdb_id, title, year, poster, confidence, reason, model, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (library_id, place) DO UPDATE SET
           tmdb_id = excluded.tmdb_id, title = excluded.title, year = excluded.year,
           poster = excluded.poster, confidence = excluded.confidence, reason = excluded.reason,
           model = excluded.model, decided_at = excluded.decided_at`,
      )
      .run(
        libraryId,
        place,
        row.tmdbId,
        row.title,
        row.year,
        row.poster,
        row.confidence,
        row.reason,
        model,
        new Date().toISOString(),
      )
  }

  /** Whether a place was asked about, whatever came of it. */
  isAsked({ libraryId, place }: DecisionPlace): boolean {
    return (
      this.db
        .prepare<[number, string], { found: number }>(
          'SELECT 1 AS found FROM ai_decisions WHERE library_id = ? AND place = ?',
        )
        .get(libraryId, place) != null
    )
  }

  /** The TMDB id of a sure pick for a place, which matching takes after its own search. */
  highPickAt({ libraryId, place }: DecisionPlace): string | null {
    return (
      this.db
        .prepare<[number, string], { tmdb_id: string }>(
          `SELECT tmdb_id FROM ai_decisions
            WHERE library_id = ? AND place = ? AND confidence = 'high' AND tmdb_id IS NOT NULL`,
        )
        .get(libraryId, place)?.tmdb_id ?? null
    )
  }

  /**
   * The unsure picks for these places, by place, each naming its own; none
   * where a Fix match has answered. The places are groups' places inside the
   * library, as `groupPlaceOf` gives them, never a path on disk.
   */
  suggestionsAt({
    libraryId,
    places,
  }: {
    libraryId: number
    places: readonly string[]
  }): Map<string, AiSuggestion> {
    if (places.length === 0) return new Map()
    const rows = this.db
      .prepare<
        [number, string],
        {
          place: string
          tmdb_id: string
          title: string | null
          year: number | null
          poster: string | null
          reason: string
        }
      >(
        `SELECT d.place, d.tmdb_id, d.title, d.year, d.poster, d.reason FROM ai_decisions d
          WHERE d.library_id = ? AND d.confidence = 'low' AND d.tmdb_id IS NOT NULL
            AND d.place IN (SELECT value FROM json_each(?))
            AND NOT EXISTS (
              SELECT 1 FROM match_overrides o WHERE o.library_id = d.library_id AND o.place = d.place
            )`,
      )
      .all(libraryId, JSON.stringify([...new Set(places)]))
    return new Map(
      rows.flatMap((row) =>
        row.title == null
          ? []
          : [
              [
                row.place,
                {
                  tmdbId: row.tmdb_id,
                  title: row.title,
                  year: row.year,
                  poster: row.poster,
                  reason: row.reason,
                  place: row.place,
                },
              ] as const,
            ],
      ),
    )
  }

  /** The reason of the newest sure pick of `tmdbId` at any of `places`; null when none chose it. */
  highReason({
    places,
    tmdbId,
  }: {
    places: readonly DecisionPlace[]
    tmdbId: string
  }): string | null {
    if (places.length === 0) return null
    return (
      this.db
        .prepare<[string, string], { reason: string }>(
          `SELECT d.reason FROM ai_decisions d
             JOIN json_each(?) p
               ON d.library_id = json_extract(p.value, '$.libraryId')
              AND d.place = json_extract(p.value, '$.place')
            WHERE d.tmdb_id = ? AND d.confidence = 'high'
            ORDER BY d.decided_at DESC
            LIMIT 1`,
        )
        .get(JSON.stringify(places), tmdbId)?.reason ?? null
    )
  }

  /** Match again: the lookups that chose no id are forgotten, so their groups are asked again. How many. */
  clearUndecided(libraryId: number): number {
    return Number(
      this.db
        .prepare<[number]>('DELETE FROM ai_decisions WHERE library_id = ? AND tmdb_id IS NULL')
        .run(libraryId).changes,
    )
  }

  /** Every decision of a library, for a change that makes them stale: its type, or where its files sit. */
  forget(libraryId: number): void {
    this.db.prepare('DELETE FROM ai_decisions WHERE library_id = ?').run(libraryId)
  }

  /**
   * A library's decisions that chose no id or were unsure, for a type that
   * prefers other results: those groups are asked again with it, while a
   * sure pick keeps its group matched.
   */
  forgetUnsure(libraryId: number): void {
    this.db
      .prepare(
        `DELETE FROM ai_decisions WHERE library_id = ? AND (tmdb_id IS NULL OR confidence = 'low')`,
      )
      .run(libraryId)
  }
}
