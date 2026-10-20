const segmentOf = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/** An access token shaped as Supabase issues one, for the account given; its signature is fake. */
export const tokenFor = ({ accountId }: { accountId: string }): string =>
  `${segmentOf({ alg: 'ES256', typ: 'JWT' })}.${segmentOf({ sub: accountId, aud: 'authenticated' })}.c2ln`
