import { describe, expect, it } from 'vitest'
import { validateLibraryInput } from '@/libraryInput'

describe('validateLibraryInput', () => {
  it('trims the name and tidies the paths', () => {
    const result = validateLibraryInput({
      name: '  Movies ',
      paths: ['/media/movies/', '/media/movies', ' /media/new ', '', 42],
    })
    expect(result).toEqual({
      ok: true,
      value: { name: 'Movies', paths: ['/media/movies', '/media/new'] },
    })
  })

  it('keeps the filesystem root as a path', () => {
    const result = validateLibraryInput({ name: 'Everything', paths: ['/'] })
    expect(result).toEqual({ ok: true, value: { name: 'Everything', paths: ['/'] } })
  })

  it('lists every problem at once', () => {
    const result = validateLibraryInput({ name: ' ', paths: ['movies'] })
    expect(result).toEqual({
      ok: false,
      errors: ['Give the library a name.', '"movies" is not an absolute path.'],
    })
  })

  it('needs at least one folder', () => {
    expect(validateLibraryInput({ name: 'Empty', paths: [] })).toEqual({
      ok: false,
      errors: ['Add at least one folder.'],
    })
  })

  it('keeps the settings that were sent and drops unknown ones', () => {
    const result = validateLibraryInput({
      name: 'Clips',
      paths: ['/media/clips'],
      settings: { saveProgress: false, colour: 'red' },
    })
    expect(result).toEqual({
      ok: true,
      value: { name: 'Clips', paths: ['/media/clips'], settings: { saveProgress: false } },
    })
  })

  it('rejects a setting that is not on or off', () => {
    const result = validateLibraryInput({
      name: 'Clips',
      paths: ['/media/clips'],
      settings: { saveProgress: 'no', pinned: 1 },
    })
    expect(result).toEqual({
      ok: false,
      errors: ['Save progress must be on or off.', 'Pinned must be on or off.'],
    })
  })

  it('keeps a sort, view and grouping that are among the choices', () => {
    const result = validateLibraryInput({
      name: 'Clips',
      paths: ['/media/clips'],
      settings: { sort: 'bitrate-high', view: 'grouped', groupBy: 'codec' },
    })
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Clips',
        paths: ['/media/clips'],
        settings: { sort: 'bitrate-high', view: 'grouped', groupBy: 'codec' },
      },
    })
  })

  it('rejects a sort, view or grouping that is not one of the choices', () => {
    const result = validateLibraryInput({
      name: 'Clips',
      paths: ['/media/clips'],
      settings: { sort: 'loudest', view: 'poster', groupBy: true },
    })
    expect(result).toEqual({
      ok: false,
      errors: [
        'Sort is not one of the choices.',
        'View is not one of the choices.',
        'Group by is not one of the choices.',
      ],
    })
  })

  it('keeps a watched percentage that is a whole number from 1 to 100', () => {
    const result = validateLibraryInput({
      name: 'Clips',
      paths: ['/media/clips'],
      settings: { watchedPercent: 75 },
    })
    expect(result).toEqual({
      ok: true,
      value: { name: 'Clips', paths: ['/media/clips'], settings: { watchedPercent: 75 } },
    })
  })

  it.each([0, 101, 90.5, '90'])('rejects %p as a watched percentage', (watchedPercent) => {
    const result = validateLibraryInput({
      name: 'Clips',
      paths: ['/media/clips'],
      settings: { watchedPercent },
    })
    expect(result).toEqual({
      ok: false,
      errors: ['Watched at must be a whole percentage from 1 to 100.'],
    })
  })

  it('rejects settings that are not an object', () => {
    const result = validateLibraryInput({ name: 'Clips', paths: ['/media/clips'], settings: 'off' })
    expect(result).toEqual({ ok: false, errors: ['Settings must be an object.'] })
  })

  it('rejects something that is not an object', () => {
    expect(validateLibraryInput('Movies').ok).toBe(false)
  })
})
