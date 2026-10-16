import { describe, expect, it } from 'bun:test'
import { dropPaths } from '@/preload/dropPaths'

const fileAt = (name: string) => new File(['x'], name, { type: 'video/mp4' })

const anyPath = () => '/m/Film.mkv'

describe('dropPaths', () => {
  it('keeps the dropped files in the order they were dropped', () => {
    const first = fileAt('Episode 1.mp4')
    const second = fileAt('Episode 2.mp4')
    const paths = new Map([
      [first, '/m/Episode 1.mp4'],
      [second, '/m/Episode 2.mp4'],
    ])
    expect(dropPaths({ files: [first, second], pathOf: (file) => paths.get(file) ?? '' })).toEqual([
      '/m/Episode 1.mp4',
      '/m/Episode 2.mp4',
    ])
  })

  it('drops a File the page made itself, which has no path', () => {
    const real = fileAt('Film.mkv')
    const made = fileAt('/etc/passwd')
    expect(
      dropPaths({ files: [made, real], pathOf: (file) => (file === real ? '/m/Film.mkv' : '') }),
    ).toEqual(['/m/Film.mkv'])
  })

  it('drops anything that is not a File', () => {
    const real = fileAt('Film.mkv')
    expect(
      dropPaths({
        files: ['/etc/passwd', { name: 'Film.mkv', path: '/etc/passwd' }, null, real],
        pathOf: anyPath,
      }),
    ).toEqual(['/m/Film.mkv'])
  })

  it('never runs methods on an object posing as a list', () => {
    const calls: string[] = []
    const forged = {
      filter: () => {
        calls.push('filter')
        return { map: () => ({ filter: () => ['/Users/victim/secret.mkv'] }) }
      },
      reduce: () => {
        calls.push('reduce')
        return ['/Users/victim/secret.mkv']
      },
    }
    expect(dropPaths({ files: forged, pathOf: anyPath })).toEqual([])
    expect(calls).toEqual([])
  })

  it('refuses an array-like that is not an array', () => {
    expect(dropPaths({ files: { length: 1, 0: fileAt('Film.mkv') }, pathOf: anyPath })).toEqual([])
  })

  it('refuses a missing or scalar value', () => {
    expect(dropPaths({ files: undefined, pathOf: anyPath })).toEqual([])
    expect(dropPaths({ files: '/m/Film.mkv', pathOf: anyPath })).toEqual([])
  })

  it('skips an element behind a getter without running it', () => {
    const calls: string[] = []
    const real = fileAt('Film.mkv')
    const files: unknown[] = [real]
    Object.defineProperty(files, 1, {
      enumerable: true,
      get: () => {
        calls.push('get')
        return fileAt('Other.mkv')
      },
    })
    expect(dropPaths({ files, pathOf: anyPath })).toEqual(['/m/Film.mkv'])
    expect(calls).toEqual([])
  })

  it('ignores methods an array was given of its own', () => {
    const real = fileAt('Film.mkv')
    const files = Object.assign([real], {
      filter: () => ({ map: () => ({ filter: () => ['/Users/victim/secret.mkv'] }) }),
      map: () => ['/Users/victim/secret.mkv'],
      reduce: () => ['/Users/victim/secret.mkv'],
    })
    expect(dropPaths({ files, pathOf: anyPath })).toEqual(['/m/Film.mkv'])
  })
})
