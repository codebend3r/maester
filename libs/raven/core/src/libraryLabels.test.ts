import { describe, expect, it } from 'bun:test'
import { isLibraryKind } from '@/contract'
import {
  GROUPING_LABELS,
  JUMP_SCALE_LABELS,
  LIBRARY_VIEW_LABELS,
  SORT_DIRECTION_LABELS,
  SORT_FIELD_LABELS,
  emptyListingMessage,
} from '@/libraryLabels'
import { groupingsFor, sortFieldsFor, viewsFor } from '@/libraryKinds'

describe('library labels', () => {
  it('names every sort, view and grouping any type of library offers', () => {
    isLibraryKind.values.forEach((kind) => {
      sortFieldsFor(kind).forEach((field) => expect(SORT_FIELD_LABELS[field]).toBeTruthy())
      viewsFor(kind).forEach((view) => expect(LIBRARY_VIEW_LABELS[view]).toBeTruthy())
      groupingsFor(kind).forEach((grouping) => expect(GROUPING_LABELS[grouping]).toBeTruthy())
    })
  })

  it('says which way each field runs, as the web says it', () => {
    expect(SORT_DIRECTION_LABELS.title).toEqual({ ascending: 'A to Z', descending: 'Z to A' })
    expect(SORT_DIRECTION_LABELS.added.descending).toBe('Newest first')
    expect(SORT_FIELD_LABELS.added).toBe('Date added')
    expect(GROUPING_LABELS.match).toBe('Matched or not')
    expect(JUMP_SCALE_LABELS.title).toBe('Jump to a letter')
  })
})

describe('emptyListingMessage', () => {
  it('says nothing while the listing holds something', () => {
    expect(emptyListingMessage({ isEmpty: false, query: 'dune', isScanning: true })).toBeNull()
  })

  it('names a search that found nothing first, then a scan still looking', () => {
    expect(emptyListingMessage({ isEmpty: true, query: 'dune', isScanning: true })).toBe(
      'Nothing here matches "dune".',
    )
    expect(emptyListingMessage({ isEmpty: true, query: '', isScanning: true })).toBe(
      'Looking through the folders. Videos appear here as they are found.',
    )
    expect(emptyListingMessage({ isEmpty: true, query: '', isScanning: false })).toBe(
      'No videos in these folders yet. Check the paths, or add a folder that holds videos.',
    )
  })
})
