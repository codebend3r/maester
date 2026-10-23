/** The build variants `APP_VARIANT` names; unset is a release build. */
export const APP_VARIANTS = { development: 'development' } as const

/**
 * A development build may reach a LAN server over plain http, so it relaxes App Transport
 * Security to local networking and lets Android send cleartext. Any other build keeps both
 * strict, and reaches servers over https only.
 */
export const isDevelopmentVariant = ({ variant }: { variant: string | undefined }): boolean =>
  (variant?.trim() ?? '') === APP_VARIANTS.development
