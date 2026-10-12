import { useState } from 'react'
import { isDarkLogo } from '@/lib/logoTone'
import styles from '@/components/LogoImage/LogoImage.module.scss'

/**
 * A title's logo, the art TMDB keeps on a clear ground. One that reads as
 * dark once it has loaded would vanish on the night, so it is drawn in
 * white. A caller's className sizes and places it.
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
  const [isDark, setDark] = useState(false)
  const classes = [className, isDark ? styles.whitened : undefined].filter(
    (name): name is string => !!name,
  )
  return (
    <img
      className={classes.length > 0 ? classes.join(' ') : undefined}
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      onLoad={(event) => setDark(isDarkLogo(event.currentTarget))}
      onError={onError}
    />
  )
}
