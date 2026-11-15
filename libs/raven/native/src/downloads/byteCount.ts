/**
 * A byte count from `expo-file-system` as a plain number. Its iOS module declares sizes and disk
 * space as `Int64` or `UInt64`, which Hermes hands over as a BigInt whatever its types say, and
 * arithmetic mixing one with a number throws ("Cannot convert 100 to BigInt"), as does writing
 * one to JSON. Null for anything that is not a count.
 */
export const byteCountOf = (value: unknown): number | null => {
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}
