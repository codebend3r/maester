import { themeOf } from '@raven/ui'
import { useState } from 'react'
import { type LogoTone, logoTone } from '@/lib/logoTone'
import { useTheme } from '@/stores/theme'
import styles from '@/components/LogoImage/LogoImage.module.scss'

/**
 * A title's logo, the art TMDB keeps on a clear ground. Once it has loaded,
 * one that would vanish on the theme's ground is redrawn in one colour: a
 * dark logo in white on a dark theme, a light one in ink on a light theme.
 * A caller's className sizes and places it.
 */
export const LogoImage = ({
  src,
  alt,
  className,
  loading,
  onError,
}: {
  src: string
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
  onError?: () => void
}) => {
  const [tone, setTone] = useState<LogoTone>('mixed')
  const ground = themeOf(useTheme((state) => state.theme)).tone
  const recolour =
    (tone === 'dark' && ground === 'dark' && styles.whitened) ||
    (tone === 'light' && ground === 'light' && styles.inked) ||
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
