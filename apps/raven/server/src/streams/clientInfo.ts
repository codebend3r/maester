/** How a client calls itself in its User-Agent header, read as a browser and a device. */
export type ClientInfo = { browser: string; device: string }

type Rule = { label: string; test: RegExp }

const UNKNOWN_BROWSER = 'Unknown browser'
const UNKNOWN_DEVICE = 'Unknown device'

/** Each browser's own token, before the ones it also carries: Edge and Opera say Chrome, and Chrome says Safari. */
const BROWSERS: readonly Rule[] = [
  { label: 'raven desktop', test: /Electron\/(\d+)/ },
  { label: 'Edge', test: /Edg(?:e|A|iOS)?\/(\d+)/ },
  { label: 'Opera', test: /OPR\/(\d+)/ },
  { label: 'Firefox', test: /(?:Firefox|FxiOS)\/(\d+)/ },
  { label: 'Chrome', test: /(?:Chrome|CriOS)\/(\d+)/ },
  { label: 'Safari', test: /Version\/(\d+)[^]*Safari\// },
  { label: 'mpv', test: /\b(?:libmpv|mpv)\b/i },
  { label: 'VLC', test: /VLC\/(\d+)/ },
]

/** The more specific device first: a phone says Android and Linux, a TV says Android too. */
const DEVICES: readonly Rule[] = [
  { label: 'iPhone', test: /iPhone/ },
  { label: 'iPad', test: /iPad/ },
  { label: 'Apple TV', test: /AppleTV/ },
  { label: 'TV', test: /SMART-TV|Tizen|Web0S|webOS|Roku|CrKey|Android TV|BRAVIA/i },
  { label: 'Android phone', test: /Android[^]*Mobile/ },
  { label: 'Android tablet', test: /Android/ },
  { label: 'Chromebook', test: /CrOS/ },
  { label: 'Mac', test: /Macintosh|Mac OS X/ },
  { label: 'Windows PC', test: /Windows/ },
  { label: 'Linux PC', test: /Linux|X11/ },
]

/** The browser's name with its major version when its token carries one: "Chrome 141". */
const browserOf = (userAgent: string): string => {
  const rule = BROWSERS.find(({ test }) => test.test(userAgent))
  if (rule == null) return UNKNOWN_BROWSER
  const version = rule.test.exec(userAgent)?.[1]
  return version == null ? rule.label : `${rule.label} ${version}`
}

const deviceOf = (userAgent: string): string =>
  DEVICES.find(({ test }) => test.test(userAgent))?.label ?? UNKNOWN_DEVICE

/**
 * What a User-Agent header says about its client, for the admin's Streams
 * page. A header is the client's own word and nothing here verifies it, so
 * it names a stream and never decides who may do what.
 */
export const describeClient = (userAgent: string): ClientInfo => ({
  browser: browserOf(userAgent),
  device: deviceOf(userAgent),
})
