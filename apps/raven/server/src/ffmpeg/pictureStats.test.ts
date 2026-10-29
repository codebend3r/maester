import { describe, expect, it } from 'vitest'
import { parsePictureStats } from '@/ffmpeg/pictureStats'

describe('parsePictureStats', () => {
  it('reads each frame’s saturation and darkness, in seconds of the file', () => {
    const text = [
      'frame:0    pts:0       pts_time:0',
      'lavfi.signalstats.YAVG=124.153',
      'lavfi.signalstats.SATAVG=86.9657',
      'lavfi.blackframe.pblack=12',
      'frame:1    pts:1       pts_time:1',
      'lavfi.signalstats.SATAVG=2.5',
      'lavfi.blackframe.pblack=91',
      '',
    ].join('\n')
    expect(parsePictureStats({ text, start: 6300 })).toEqual([
      { at: 6300, saturation: 86.9657, dark: 12 },
      { at: 6301, saturation: 2.5, dark: 91 },
    ])
  })

  it('leaves out a frame missing a statistic, and anything before the first frame', () => {
    const text = [
      'lavfi.signalstats.SATAVG=1',
      'frame:0    pts:0       pts_time:0',
      'lavfi.signalstats.SATAVG=1',
      'frame:1    pts:1       pts_time:1.5',
      'lavfi.signalstats.SATAVG=3',
      'lavfi.blackframe.pblack=70',
    ].join('\n')
    expect(parsePictureStats({ text, start: 0 })).toEqual([{ at: 1.5, saturation: 3, dark: 70 }])
  })
})
