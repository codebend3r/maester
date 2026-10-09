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

  it('rejects something that is not an object', () => {
    expect(validateLibraryInput('Movies').ok).toBe(false)
  })
})
