/** The value of cookie `name` in a `Cookie` header, or null when it is missing or empty. */
export const readCookie = ({
  header,
  name,
}: {
  header: string | undefined
  name: string
}): string | null => {
  const found = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  const value = found?.slice(name.length + 1) ?? ''
  return value === '' ? null : value
}
