import { describe, expect, it } from 'vitest'
import { describeClient } from '@/streams/clientInfo'

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const CHROME_ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 15; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const SAMSUNG_TV =
  'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/7.0 TV Safari/537.36'
const ELECTRON =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) raven/0.6.1 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36'

describe('describeClient', () => {
  it.each([
    { name: 'Chrome on a Mac', userAgent: CHROME_MAC, browser: 'Chrome 141', device: 'Mac' },
    {
      name: 'Safari on an iPhone',
      userAgent: SAFARI_IPHONE,
      browser: 'Safari 18',
      device: 'iPhone',
    },
    {
      name: 'Edge, which also says Chrome',
      userAgent: EDGE_WINDOWS,
      browser: 'Edge 140',
      device: 'Windows PC',
    },
    {
      name: 'Firefox on Linux',
      userAgent: FIREFOX_LINUX,
      browser: 'Firefox 130',
      device: 'Linux PC',
    },
    {
      name: 'Chrome on an Android phone',
      userAgent: CHROME_ANDROID,
      browser: 'Chrome 141',
      device: 'Android phone',
    },
    {
      name: 'Chrome on an Android tablet',
      userAgent: CHROME_ANDROID_TABLET,
      browser: 'Chrome 141',
      device: 'Android tablet',
    },
    { name: 'a smart TV', userAgent: SAMSUNG_TV, browser: 'Unknown browser', device: 'TV' },
    {
      name: 'the desktop app, which also says Chrome',
      userAgent: ELECTRON,
      browser: 'raven desktop 38',
      device: 'Mac',
    },
    { name: 'mpv', userAgent: 'libmpv', browser: 'mpv', device: 'Unknown device' },
  ])('reads $name', ({ userAgent, browser, device }) => {
    expect(describeClient(userAgent)).toEqual({ browser, device })
  })

  it('says so when the header is missing or says nothing', () => {
    expect(describeClient('')).toEqual({ browser: 'Unknown browser', device: 'Unknown device' })
    expect(describeClient('curl/8.5.0')).toEqual({
      browser: 'Unknown browser',
      device: 'Unknown device',
    })
  })
})
