import { type SkipStep } from '@raven/core'
import { usePlayerPrefs } from '@raven/ui/headless'
import { useState } from 'react'
import { Animated, Pressable, StatusBar, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Video from 'react-native-video'

import { LoadingMark } from '@/layouts/LoadingMark'
import { CaptionText } from '@/layouts/PlayerCaption'
import { HoldMark, SkipMark } from '@/layouts/PlayerMark.touch'
import { PLAYER_COPY, type PlayerChromeKit, type PlayerChromeProps } from '@/layouts/playerKit'
import { Text } from '@/layouts/Text'
import { useControlsLinger } from '@/layouts/useControlsLinger'
import { useSkipLadder } from '@/layouts/useSkipLadder'
import { heldPlaybackOf, useSurfaceGestures } from '@/layouts/useSurfaceGestures'
import { usePlayerKeys } from '@/player/usePlayerKeys'
import { SIZES } from '@/theme/appTheme'
import { APP_ICONS } from '@/theme/icons'
import { ICON_SIZES, useTouchChromeStyles } from '@/layouts/PlayerChromeStyles.touch'
import { Corner, IconButton, TransportControls, PlayerLogo } from '@/layouts/PlayerParts.touch'

/**
 * Raven's controls over the video under the thumb, the web player's, in icons: Back at the top
 * left with what is playing beside it, the time of day, the picture's chips and how the video plays
 * at the top right as the TV's, and along the bottom the time and the line to drag along, then the transport and the
 * glass icons for subtitles, audio, quality and Picture in Picture, all inside the safe area
 * while the video fills the screen. They fade once the video has played untouched for the
 * viewer's linger, and a tap brings them back; what is playing fades with them. A double tap on
 * the picture's right half skips forward and on its left half back, and a finger held there
 * plays on at twice the speed or runs back at it. Every skip, a button's, a key's or a tap's,
 * climbs one ladder: 10 seconds, then 20 and 30 when they come quickly. A hardware
 * keyboard drives it as it drives the web's player, each key bringing the controls back as a tap
 * does. The video plays in Picture in Picture when the app is left, and on AirPlay; the silent
 * switch never mutes it, and leaving the app without Picture in Picture pauses it.
 */
const PlayerChrome = ({
  title,
  heading,
  surface,
  notice,
  isOpening,
  caption,
  captionStyle,
  transport,
  audio,
  subtitles,
  quality,
  next,
  previous,
  mode,
  onBack,
}: PlayerChromeProps) => {
  const insets = useSafeAreaInsets()
  const volume = usePlayerPrefs((prefs) => prefs.volume)
  const isMuted = usePlayerPrefs((prefs) => prefs.muted)
  const styles = useTouchChromeStyles()
  const isPlaying = transport !== null && !transport.isPaused
  const { isVisible, opacity, stir, show, toggle } = useControlsLinger({ isPlaying })
  const { width } = useWindowDimensions()
  const skip = useSkipLadder({ transport })
  // The last skip's mark, counted so the same one twice starts afresh.
  const [skipped, setSkipped] = useState<{ step: SkipStep; count: number } | null>(null)
  const skipBy = (direction: SkipStep['direction']) => {
    const step = skip(direction)
    if (step !== null) setSkipped((was) => ({ step, count: (was?.count ?? 0) + 1 }))
  }
  const gestures = useSurfaceGestures({
    transport,
    width,
    onSkip: skipBy,
    // Paused, opening or ended the controls stay up, so a tap has nothing to show or hide.
    onTap: () => {
      if (isPlaying) toggle()
    },
  })
  usePlayerKeys({ transport, subtitles, onBack, onSkip: skipBy, onPress: show })
  const sides = {
    paddingTop: insets.top + SIZES.space2,
    paddingBottom: insets.bottom + SIZES.space2,
    paddingLeft: Math.max(insets.left, SIZES.space4),
    paddingRight: Math.max(insets.right, SIZES.space4),
  }
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" hidden={!isVisible} />
      {surface !== null && (
        <Video
          {...surface}
          allowsExternalPlayback
          controls={false}
          enterPictureInPictureOnLeave
          ignoreSilentSwitch="ignore"
          muted={isMuted}
          {...heldPlaybackOf({ surface, held: gestures.held })}
          playInBackground={false}
          resizeMode="contain"
          style={StyleSheet.absoluteFill}
          volume={volume}
        />
      )}
      <Pressable
        {...gestures.surfaceProps}
        accessibilityLabel={isVisible ? PLAYER_COPY.hideControls : PLAYER_COPY.showControls}
        accessibilityRole="button"
        style={StyleSheet.absoluteFill}
      />
      {isOpening && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <LoadingMark
            gap={SIZES.space4}
            isOverPicture
            label={PLAYER_COPY.opening}
            markWidth={SIZES.space6 * 2}
          />
        </View>
      )}
      {notice !== null && (
        <View pointerEvents="none" style={[styles.noticeSlot, sides]}>
          <Text accessibilityLiveRegion="polite" style={styles.notice}>
            {notice}
          </Text>
        </View>
      )}
      <Animated.View
        accessibilityElementsHidden={!isVisible}
        importantForAccessibility={isVisible ? 'auto' : 'no-hide-descendants'}
        onTouchStart={stir}
        pointerEvents={isVisible ? 'box-none' : 'none'}
        style={[StyleSheet.absoluteFill, { opacity }]}
      >
        <View pointerEvents="none" style={styles.scrim} />
        <View pointerEvents="box-none" style={[styles.frame, sides]}>
          <View pointerEvents="box-none" style={styles.top}>
            <IconButton
              icon={APP_ICONS.back}
              isGlass
              label={PLAYER_COPY.leave}
              onPress={onBack}
              size={ICON_SIZES.pill}
            />
            <View pointerEvents="none" style={styles.logoSlot}>
              <PlayerLogo heading={heading} title={title} />
            </View>
            <View pointerEvents="none" style={styles.cornerSlot}>
              <Corner heading={heading} mode={mode} />
            </View>
          </View>
          {gestures.transport !== null && (
            <TransportControls
              audio={audio}
              isShown={isVisible}
              next={next}
              onSkip={skipBy}
              previous={previous}
              quality={quality}
              subtitles={subtitles}
              transport={gestures.transport}
            />
          )}
        </View>
      </Animated.View>
      {skipped !== null && gestures.held === null && (
        <SkipMark key={skipped.count} sides={sides} step={skipped.step} />
      )}
      {gestures.held !== null && <HoldMark side={gestures.held} sides={sides} />}
      {caption !== null && (
        <View pointerEvents="none" style={[styles.captionSlot, sides]}>
          <CaptionText caption={caption} look={captionStyle} />
        </View>
      )}
    </View>
  )
}

/** The player under the thumb, on iPhones and iPads. */
export const touchPlayerChrome: PlayerChromeKit = {
  PlayerChrome,
  shouldDrawCaptions: true,
  canDrawPictureSubtitles: false,
}
