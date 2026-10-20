/** What JSON text holds, or undefined when it is not JSON: no JSON text parses to undefined. */
export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
