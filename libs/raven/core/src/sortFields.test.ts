import { describe, expect, it } from 'bun:test'
import { MEDIA_SORTS, type MediaSort, isSortFieldName } from '@/contract'
import { sortFieldsFor } from '@/libraryKinds'
import { reversedDirection, reversedSort, sortOf, sortParts, startingSort } from '@/sortFields'

describe('sort fields', () => {
  it('reads every sort as its field and direction, and back again', () => {
    MEDIA_SORTS.forEach((sort) => {
      const { field, direction } = sortParts(sort)
      expect(sortOf({ field, direction: direction ?? 'ascending' })).toBe(sort)
    })
  })

  it('names every sort once, as one way a field runs', () => {
    expect(MEDIA_SORTS).toHaveLength(new Set(MEDIA_SORTS).size)
    const named: MediaSort[] = [
      'title',
      'title-desc',
      'added',
      'oldest',
      'changed',
      'changed-old',
      'largest',
      'smallest',
      'bitrate-high',
      'bitrate-low',
      'resolution-high',
      'resolution-low',
      'year-new',
      'year-old',
      'rating-high',
      'rating-low',
      'random',
    ]
    expect(MEDIA_SORTS.toSorted()).toEqual(named.toSorted())
  })

  it('runs titles A to Z first, and the rest newest, biggest or best first', () => {
    expect(sortParts('title')).toEqual({ field: 'title', direction: 'ascending' })
    expect(sortParts('title-desc')).toEqual({ field: 'title', direction: 'descending' })
    expect(startingSort('title')).toBe('title')
    expect(startingSort('added')).toBe('added')
    expect(startingSort('size')).toBe('largest')
    expect(startingSort('rating')).toBe('rating-high')
  })

  it('gives random no direction', () => {
    expect(sortParts('random')).toEqual({ field: 'random', direction: null })
    expect(sortOf({ field: 'random', direction: 'descending' })).toBe('random')
  })

  it('turns a sort around to the same field run the other way, and leaves random alone', () => {
    expect(reversedDirection('ascending')).toBe('descending')
    expect(reversedDirection('descending')).toBe('ascending')
    expect(reversedSort('title')).toBe('title-desc')
    expect(reversedSort('added')).toBe('oldest')
    expect(reversedSort('bitrate-low')).toBe('bitrate-high')
    expect(reversedSort('random')).toBe('random')
    MEDIA_SORTS.forEach((sort) => {
      expect(reversedSort(reversedSort(sort))).toBe(sort)
    })
  })

  it('knows a field name only by the fields there are', () => {
    expect(isSortFieldName('bitrate')).toBe(true)
    expect(isSortFieldName('toString')).toBe(false)
    expect(isSortFieldName('bitrate-high')).toBe(false)
  })

  it('offers each type of library the fields its sorts allow', () => {
    expect(sortFieldsFor('movies')).toEqual([
      'title',
      'added',
      'changed',
      'size',
      'bitrate',
      'resolution',
      'release',
      'rating',
      'random',
    ])
    expect(sortFieldsFor('shows')).toEqual([
      'title',
      'added',
      'changed',
      'bitrate',
      'release',
      'rating',
      'random',
    ])
    expect(sortFieldsFor('other')).toEqual([
      'title',
      'added',
      'changed',
      'size',
      'bitrate',
      'resolution',
      'random',
    ])
  })
})
