import { THEME_TONES, themeOf } from '@raven/core'
import { useState } from 'react'
import { LOGO_TONES, type LogoTone, logoTone } from '@/lib/logoTone'
import { useTheme } from '@/stores/theme'
import styles from '@/components/LogoImage/LogoImage.module.scss'

type LogoImageProps = {
  src: string
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
  onError?: () => void
}

/**
 * A title's logo, the art TMDB keeps on a clear ground. Once it has loaded,
 * one that would vanish on the theme's ground is redrawn in one colour: a
 * dark logo in white on a dark theme, a light one in ink on a light theme.
 * A caller's className sizes and places it.
 */
export const LogoImage = ({ src, alt, className, loading, onError }: LogoImageProps) => {
  const [tone, setTone] = useState<LogoTone>(LOGO_TONES.mixed)
  const ground = themeOf(useTheme((state) => state.theme)).tone
  const recolour =
    (tone === LOGO_TONES.dark && ground === THEME_TONES.dark && styles.whitened) ||
    (tone === LOGO_TONES.light && ground === THEME_TONES.light && styles.inked) ||
    undefined
  const classes = [className, recolour].filter((name): name is string => !!name)
  return (
    <img
      className={classes.length > 0 ? classes.join(' ') : undefined}
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      onLoad={(event) => setTone(logoTone(event.currentTarget))}
      onError={onError}
    />
  )
}
