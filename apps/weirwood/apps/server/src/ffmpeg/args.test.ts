import { describe, expect, it } from 'vitest'
import { TONEMAP_FILTER, thumbnailArgs, thumbnailSeek } from '@/ffmpeg/args.js'

describe('thumbnailSeek', () => {
  it('lands a tenth of the way in', () => {
    expect(thumbnailSeek(5812.768)).toBe(581.277)
  })

  it('uses the first frame for short or unknown clips', () => {
    expect(thumbnailSeek(3)).toBe(0)
    expect(thumbnailSeek(null)).toBe(0)
  })
})

describe('thumbnailArgs', () => {
  it('seeks on the input so ffmpeg jumps to a keyframe', () => {
    const args = thumbnailArgs({
      input: '/m/a.mkv',
      output: '/t/1.jpg',
      seek: 60,
      width: 480,
      tonemap: false,
    })
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(args).toContain('thumbnail=n=24,scale=w=480:h=-2')
    expect(args.at(-1)).toBe('/t/1.jpg')
  })

  it('leaves out the seek at zero and adds tone mapping for HDR', () => {
    const args = thumbnailArgs({
      input: '/m/a.mkv',
      output: '/t/1.jpg',
      seek: 0,
      width: 320,
      tonemap: true,
    })
    expect(args).not.toContain('-ss')
    expect(args).toContain(`thumbnail=n=24,scale=w=320:h=-2,${TONEMAP_FILTER}`)
  })
})
