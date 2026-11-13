/** The host of `address`, or the address itself when it isn't a URL. */
export const hostOf = (address: string): string => {
  try {
    return new URL(address).host
  } catch {
    return address
  }
}
