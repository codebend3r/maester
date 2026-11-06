import { type RefObject, useEffect, useRef, useState } from 'react'
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HeroSlideView } from '@/layouts/HeroSlide.touch'
import {
  HERO_COPY,
  HERO_MS,
  type HeroKit,
  type HomeHeroProps,
  loopPagesOf,
  slideOfPage,
} from '@/layouts/heroKit'
import { isTablet } from '@/layouts/screenSizes'
import { useReduceMotion } from '@/stores/reduceMotion'
import { SIZES } from '@/theme/appTheme'
import { pictureStyles } from '@/theme/useTheme'

/** A phone's slide is taller than 16:9: this share of the window's height, so the words fit. */
const PHONE_HEIGHT_SHARE = 0.6

/** The least a phone's slide stands, held sideways, so its words still fit over the picture. */
const PHONE_MIN_HEIGHT = 300

const WIDE_RATIO = 9 / 16

const DOT_SIZE = 8

/** How long a programmed slide's animation runs before the list hops off a copy onto its slide. */
const HOP_MS = 450

type SlideSizeOfProps = { width: number; window: { width: number; height: number } }

type SlideSize = { height: number; isTablet: boolean }

/** How tall a slide stands: 16:9 on a tablet, a share of the window's height on a phone. */
const slideSizeOf = ({ width, window }: SlideSizeOfProps): SlideSize => {
  if (isTablet(window)) return { height: width * WIDE_RATIO, isTablet: true }
  return { height: Math.max(window.height * PHONE_HEIGHT_SHARE, PHONE_MIN_HEIGHT), isTablet: false }
}

type HopOffCopyProps = {
  list: RefObject<ScrollViewInstance | null>
  /** The page the list came to rest on. */
  rested: number
  count: number
  width: number
  setPage: (page: number) => void
}

/** Moves onto the slide a copy stands for, at once, so the loop never shows its seam. */
const hopOffCopy = ({ list, rested, count, width, setPage }: HopOffCopyProps) => {
  const real = slideOfPage({ page: rested, count }) + 1
  if (real !== rested) list.current?.scrollTo({ x: real * width, animated: false })
  setPage(real)
}

type DotsProps = { count: number; at: number }

/** Which slide is up, as a row of dots over the picture's foot; the slides say it aloud. */
const Dots = ({ count, at }: DotsProps) => {
  const styles = useStyles()
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.dots}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.dot, index === at && styles.dotUp]} />
      ))}
    </View>
  )
}

/**
 * Home's hero under the thumb: the featured titles as slides edge to edge, swiped through one at
 * a time either way round and round, the last leading back to the first and the first back to
 * the last, with dots saying which is up. It moves on every `HERO_MS` as the TV's does, holds still
 * while a finger is on it, and, as the TV's, never moves by itself when the system asks for less
 * motion. Each slide opens its title, and its button plays it.
 */
const HomeHero = ({ slides, onOpen }: HomeHeroProps) => {
  const count = slides.length
  const window = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const isReduced = useReduceMotion((state) => state.isReduced)
  const isLooped = count > 1
  // The page the list rests on; past the first, the copy of the last, when it loops.
  const firstPage = isLooped ? 1 : 0
  const [page, setPage] = useState(firstPage)
  const [isTouched, setTouched] = useState(false)
  const list = useRef<ScrollViewInstance>(null)
  const styles = useStyles()
  const width = window.width - insets.left - insets.right
  const size = slideSizeOf({ width, window })
  const up = isLooped ? slideOfPage({ page, count }) : 0
  const isHeld = isReduced || isTouched || !isLooped

  useEffect(() => {
    if (isHeld) return undefined
    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(
      setTimeout(() => {
        const next = page + 1
        list.current?.scrollTo({ x: next * width, animated: true })
        timers.push(
          setTimeout(() => hopOffCopy({ list, rested: next, count, width, setPage }), HOP_MS),
        )
      }, HERO_MS),
    )
    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [isHeld, page, count, width])

  if (count === 0) return null

  const settle = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return
    const rested = Math.round(nativeEvent.contentOffset.x / width)
    if (isLooped) hopOffCopy({ list, rested, count, width, setPage })
  }

  return (
    <View
      accessibilityLabel={HERO_COPY.featured}
      onTouchCancel={() => setTouched(false)}
      onTouchEnd={() => setTouched(false)}
      onTouchStart={() => setTouched(true)}
      style={[styles.hero, { width, height: size.height }]}
    >
      {/* A turned screen changes the slides' width: the list starts again on the one up. */}
      <ScrollView
        key={width}
        ref={list}
        contentOffset={{ x: page * width, y: 0 }}
        decelerationRate="fast"
        horizontal
        keyboardShouldPersistTaps="handled"
        onMomentumScrollEnd={settle}
        pagingEnabled
        showsHorizontalScrollIndicator={false}
      >
        {loopPagesOf({ slides }).map(({ key, slide, isCopy }) => (
          <View
            key={key}
            accessibilityElementsHidden={isCopy}
            importantForAccessibility={isCopy ? 'no-hide-descendants' : 'auto'}
          >
            <HeroSlideView
              height={size.height}
              isTablet={size.isTablet}
              onOpen={onOpen}
              slide={slide}
              width={width}
            />
          </View>
        ))}
      </ScrollView>
      {isLooped && <Dots at={up} count={count} />}
    </View>
  )
}

export const touchHero: HeroKit = { HomeHero }

const useStyles = pictureStyles((colours) =>
  StyleSheet.create({
    hero: { backgroundColor: colours.ground },
    dots: {
      position: 'absolute',
      right: SIZES.space4,
      bottom: SIZES.space4 + (SIZES.fieldHeight - DOT_SIZE) / 2,
      flexDirection: 'row',
      gap: SIZES.space1,
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: SIZES.radiusPill,
      backgroundColor: colours.muted,
      opacity: 0.5,
    },
    dotUp: { backgroundColor: colours.text, opacity: 1 },
  }),
)
