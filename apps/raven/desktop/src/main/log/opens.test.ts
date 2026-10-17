import { describe, expect, it } from 'bun:test'
import { describedFileId, logsDirFor, openLine } from '@/main/log/opens'

const FILE_ID = '0b5f6c3e-2a41-4d7e-9c1b-7f2e8a9d6c45'

describe('openLine', () => {
  it('names only the extension of a file, in lower case', () => {
    const line = openLine({ kind: 'file', path: '/Volumes/Media/Secret Film (2024).MKV' })
    expect(line).toBe('open file .mkv')
    expect(line).not.toContain('Secret')
    expect(line).not.toContain('/Volumes')
  })

  it('says when a file has no extension', () => {
    expect(openLine({ kind: 'file', path: '/Volumes/Media/Secret Film' })).toBe(
      'open file (no extension)',
    )
    expect(openLine({ kind: 'file', path: '/Volumes/Media/.secret' })).toBe(
      'open file (no extension)',
    )
  })

  it('never takes a name for an extension', () => {
    const line = openLine({ kind: 'file', path: '/Volumes/Media/Film.Secret Name Here' })
    expect(line).toBe('open file (no extension)')
  })

  it('names a server title by its id and its server', () => {
    expect(openLine({ kind: 'server', serverName: 'Vhagar', mediaId: 7 })).toBe(
      'open server title 7 on Vhagar',
    )
  })
})

describe('logsDirFor', () => {
  it('is the pinned logs folder in the home folder', () => {
    expect(logsDirFor({ home: '/Users/a', userDataOverride: null })).toBe(
      '/Users/a/Library/Logs/raven',
    )
  })

  it('is inside the test hook userData', () => {
    expect(logsDirFor({ home: '/Users/a', userDataOverride: '/tmp/u' })).toBe('/tmp/u/logs')
  })
})

describe('describedFileId', () => {
  it('is the file a page asks to describe', () => {
    expect(
      describedFileId({
        kind: 'page',
        request: { type: 'describeFile', fileId: FILE_ID, queue: [] },
      }),
    ).toBe(FILE_ID)
  })

  it('is null for any other request, a drop or something that is not a request', () => {
    expect(describedFileId({ kind: 'page', request: { type: 'listRecents' } })).toBeNull()
    expect(describedFileId({ kind: 'drop', paths: ['/a.mkv'] })).toBeNull()
    expect(
      describedFileId({
        kind: 'page',
        request: { type: 'describeFile', fileId: 'nope', queue: [] },
      }),
    ).toBeNull()
    expect(describedFileId(null)).toBeNull()
    expect(describedFileId('describeFile')).toBeNull()
  })
})
