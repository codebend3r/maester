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

/** Unique local (`fc00::/7`) and link-local (`fe80::/10`) IPv6 blocks, by their first hextet. */
const PRIVATE_V6_BLOCKS = [
  { base: 0xfc00, bits: 7 },
  { base: 0xfe80, bits: 10 },
] as const

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** An IPv4 address mapped into IPv6, as Node reports a v4 peer on a dual-stack socket. */
const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/

const HEXTET = /^[0-9a-f]{1,4}$/

const V6_HEXTETS = 8
const BITS_PER_OCTET = 8
const BITS_PER_HEXTET = 16
const OCTET_VALUES = 256
/** The hextet before an IPv4 address mapped into IPv6 in hex: `::ffff:c0a8:101`. */
const MAPPED_MARK = 0xffff
/** Where a mapped IPv4 address starts among the eight hextets. */
const MAPPED_AT = 6

const ADDRESS_FAMILIES = { v4: 'v4', v6: 'v6' } as const

type ParsedAddress =
  | { family: typeof ADDRESS_FAMILIES.v4; octets: readonly number[] }
  | { family: typeof ADDRESS_FAMILIES.v6; hextets: readonly number[] }

/** An address as every reader here takes it: trimmed, in lower case, with no IPv6 zone. */
const normalise = (raw: string): string => raw.trim().toLowerCase().replace(/%.*$/, '')

const octetsOf = (address: string): number[] | null => {
  const match = V4.exec(address)
  if (match === null) return null
  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet < OCTET_VALUES) ? octets : null
}

const hextetsIn = (text: string): string[] => (text === '' ? [] : text.split(':'))

/** An IPv6 address's eight hextets, with `::` filled in, or null for anything else. */
const hextetsOf = (address: string): number[] | null => {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const [head = '', tail] = halves
  const front = hextetsIn(head)
  const back = tail === undefined ? [] : hextetsIn(tail)
  const missing = V6_HEXTETS - front.length - back.length
  const isFilled = tail === undefined ? missing === 0 : missing >= 1
  const written = [...front, ...back]
  if (!isFilled || !written.every((hextet) => HEXTET.test(hextet))) return null
  const zeros = Array.from({ length: missing }, () => '0')
  return [...front, ...zeros, ...back].map((hextet) => Number.parseInt(hextet, 16))
}

/** Whether eight hextets are an IPv4 address mapped into IPv6: `::ffff:` and the four octets. */
const isMappedV4 = (hextets: readonly number[]): boolean =>
  hextets.slice(0, MAPPED_AT - 1).every((hextet) => hextet === 0) &&
  hextets[MAPPED_AT - 1] === MAPPED_MARK

const octetsOfMapped = (hextets: readonly number[]): number[] =>
  hextets
    .slice(MAPPED_AT)
    .flatMap((hextet) => [Math.floor(hextet / OCTET_VALUES), hextet % OCTET_VALUES])

/** An IP address, an IPv4 one mapped into IPv6 unwrapped to IPv4; null for anything that is not one. */
const parseAddress = (raw: string): ParsedAddress | null => {
  const address = normalise(raw)
  const v4 = octetsOf(MAPPED_V4.exec(address)?.[1] ?? address)
  if (v4 !== null) return { family: ADDRESS_FAMILIES.v4, octets: v4 }
  const hextets = hextetsOf(address)
  if (hextets === null) return null
  return isMappedV4(hextets)
    ? { family: ADDRESS_FAMILIES.v4, octets: octetsOfMapped(hextets) }
    : { family: ADDRESS_FAMILIES.v6, hextets }
}

type InBlockProps = { value: number; base: number; bits: number; width: number }

/** Whether `value`, a number `width` bits wide, shares its first `bits` with `base`. */
const inBlock = ({ value, base, bits, width }: InBlockProps): boolean => {
  const size = 2 ** (width - bits)
  return Math.floor(value / size) === Math.floor(base / size)
}

const v4Number = (octets: readonly number[]): number =>
  octets.reduce((total, octet) => total * OCTET_VALUES + octet, 0)

const V4_BITS = BITS_PER_OCTET * 4

const isPrivateV4 = (octets: readonly number[]): boolean => {
  const value = v4Number(octets)
  return PRIVATE_V4_BLOCKS.some(({ base, bits }) =>
    inBlock({ value, base: v4Number(base), bits, width: V4_BITS }),
  )
}

/** Loopback (`::1`), the unspecified address (`::`), and the unique local and link-local blocks. */
const isPrivateV6 = (hextets: readonly number[]): boolean => {
  const [first = 0] = hextets
  const isSpecial =
    hextets.slice(0, -1).every((hextet) => hextet === 0) && (hextets.at(-1) ?? 0) <= 1
  return (
    isSpecial ||
    PRIVATE_V6_BLOCKS.some(({ base, bits }) =>
      inBlock({ value: first, base, bits, width: BITS_PER_HEXTET }),
    )
  )
}

/**
 * Whether an address is one the internet does not route to: a home network's,
 * loopback, link-local, CGNAT's shared space, or IPv6's unique local and
 * link-local ranges. Anything that is not an IP address is not private: a
 * caller that must refuse a name resolves it first.
 */
export const isPrivateAddress = (raw: string): boolean => {
  const parsed = parseAddress(raw)
  if (parsed === null) return false
  switch (parsed.family) {
    case ADDRESS_FAMILIES.v4:
      return isPrivateV4(parsed.octets)
    case ADDRESS_FAMILIES.v6:
      return isPrivateV6(parsed.hextets)
    default: {
      const unreachable: never = parsed
      return unreachable
    }
  }
}

/** The IPv6 prefixes a client is counted by: a site's /48, or the /64 a home or a phone is handed. */
export type AddressPrefixBits = 48 | 64

type KeyOfAddressProps = { address: string; prefixBits: AddressPrefixBits }

type PrefixKeyOfProps = { hextets: readonly number[]; prefixBits: AddressPrefixBits }

/** The first `prefixBits` of an IPv6 address, written as `2001:db8:1:0::/48`. */
const prefixKeyOf = ({ hextets, prefixBits }: PrefixKeyOfProps): string => {
  const kept = prefixBits / BITS_PER_HEXTET
  const prefix = hextets
    .slice(0, V6_HEXTETS / 2)
    .map((hextet, index) => (index < kept ? hextet : 0).toString(16))
    .join(':')
  return `${prefix}::/${prefixBits}`
}

/**
 * Who an address is counted as: an IPv4 address, mapped into IPv6 or not, is
 * one client (`::ffff:1.2.3.4` keys as `1.2.3.4`), and an IPv6 one counts by
 * the prefix of `prefixBits` it lies in, since a home or a phone is handed a
 * whole /64 (or /48) to move through. Anything that is not an address keys as
 * itself, trimmed and in lower case.
 */
export const keyOfAddress = ({ address, prefixBits }: KeyOfAddressProps): string => {
  const parsed = parseAddress(address)
  if (parsed === null) return normalise(address)
  switch (parsed.family) {
    case ADDRESS_FAMILIES.v4:
      return parsed.octets.join('.')
    case ADDRESS_FAMILIES.v6:
      return prefixKeyOf({ hextets: parsed.hextets, prefixBits })
    default: {
      const unreachable: never = parsed
      return unreachable
    }
  }
}
