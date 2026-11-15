export const AUTH_SCHEMES = { bearer: 'Bearer' } as const

type BearerTokenProps = { header: string | undefined }

/** The token of an `Authorization: Bearer <token>` header, the scheme in any case, or null for anything else. */
export const bearerToken = ({ header }: BearerTokenProps): string | null => {
  const [scheme, token, extra] = (header ?? '').split(' ')
  const isBearer = (scheme ?? '').toLowerCase() === AUTH_SCHEMES.bearer.toLowerCase()
  if (!isBearer || token === undefined || token === '' || extra !== undefined) return null
  return token
}
