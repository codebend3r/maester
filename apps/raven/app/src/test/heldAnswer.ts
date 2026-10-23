/** What `release` is until the promise has its resolver, which its executor hands over at once. */
const NOT_YET = (): void => undefined

/** A server's answer held back until `release` is called, so a test can look while it waits. */
export const heldAnswer = () => {
  let release = NOT_YET
  const answer = new Promise<void>((resolve) => {
    release = resolve
  })
  return { answer, release }
}
