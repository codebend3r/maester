/** IPv4 blocks the internet never routes to: a home network, loopback, link-local, CGNAT and "this network". */
const PRIVATE_V4_BLOCKS = [
  { base: [10, 0, 0, 0], bits: 8 },
  { base: [172, 16, 0, 0], bits: 12 },
  { base: [192, 168, 0, 0], bits: 16 },
  { base: [127, 0, 0, 0], bits: 8 },
  { base: [169, 254, 0, 0], bits: 16 },
  { base: [100, 64, 0, 0], bits: 10 },
  { base: [0, 0, 0, 0], bits: 8 },
] as const

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** An IPv4 address mapped into IPv6, as Node reports a v4 peer on a dual-stack socket. */
const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/

/** IPv6 loopback and the unspecified address. */
const V6_SPECIAL = new Set(['::1', '::'])

/** Unique local (`fc00::/7`) and link-local (`fe80::/10`) IPv6 prefixes, by their first hextet. */
const PRIVATE_V6_PREFIX = /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/

const octetsOf = (address: string): number[] | null => {
  const match = V4.exec(address)
  if (match === null) return null
  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet <= 255) ? octets : null
}

const asNumber = (octets: readonly number[]): number =>
  octets.reduce((total, octet) => total * 256 + octet, 0)

const isPrivateV4 = (octets: readonly number[]): boolean => {
  const value = asNumber(octets)
  return PRIVATE_V4_BLOCKS.some(({ base, bits }) => {
    const size = 2 ** (32 - bits)
    return Math.floor(value / size) === Math.floor(asNumber(base) / size)
  })
}

/**
 * Whether an address is one the internet does not route to: a home network's,
 * loopback, link-local, CGNAT's shared space, or IPv6's unique local and
 * link-local ranges. Anything that is not an IP address counts as private,
 * so a caller that refuses private addresses refuses it too.
 */
export const isPrivateAddress = (raw: string): boolean => {
  const address = raw.trim().toLowerCase().replace(/%.*$/, '')
  const v4 = octetsOf(MAPPED_V4.exec(address)?.[1] ?? address)
  if (v4 !== null) return isPrivateV4(v4)
  if (!address.includes(':')) return true
  return V6_SPECIAL.has(address) || PRIVATE_V6_PREFIX.test(address)
}
