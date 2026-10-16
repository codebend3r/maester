import { describe, expect, it } from 'bun:test'
import { dropPaths } from '@/preload/dropPaths'

const fileAt = (name: string) => new File(['x'], name, { type: 'video/mp4' })

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
        pathOf: () => '/m/Film.mkv',
      }),
    ).toEqual(['/m/Film.mkv'])
  })
})
