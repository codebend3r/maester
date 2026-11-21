import { useRouter } from 'expo-router'
import type { ComponentType, ReactNode } from 'react'
import { type StyleProp, Text, type TextStyle, View, type ViewStyle } from 'react-native'

import { DETAIL_COPY } from '@raven/wren'
import { DetailAction } from '@/components/DetailAction'
import { Nothing } from '@/components/Nothing'
import { PlayButtons } from '@/components/PlayButtons'
import type { Cover } from '@/music/useCovers'
import { BackButton } from '@/screens/detail/BackButton'
import { type WrenTheme, themedStyles, useFormFactor, useWrenTheme } from '@/theme/wrenTheme'
import {
  DETAIL_SIZES,
  RADIUS,
  SPACE,
  TYPE,
  FORM_FACTORS,
  type FormFactor,
} from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { BackLink } from '@/ui/BackLink'
import { IconButton } from '@/ui/IconButton'
import { ICONS, WrenIcon } from '@/ui/WrenIcon'

/** The cover on a phone's page, and in a tablet's left column. */
const COVER_SIZES = {
  [FORM_FACTORS.phone]: DETAIL_SIZES.cover,
  [FORM_FACTORS.tablet]: DETAIL_SIZES.tabletCover,
} as const satisfies Record<FormFactor, number>

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  phone: { gap: SPACE.s2, paddingBottom: SPACE.s3 },
  tablet: { gap: SPACE.s2, width: COVER_SIZES[FORM_FACTORS.tablet] },
  nav: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  centred: { alignItems: 'center' },
  stacked: { gap: SPACE.s2 },
  phoneTitle: {
    ...TYPE.albumTitle,
    color: colors.text,
    marginTop: SPACE.s5,
    textAlign: 'center',
  },
  tabletTitle: { ...TYPE.largeTitle, color: colors.text, marginTop: SPACE.s4 },
  meta: { ...TYPE.meta, color: colors.text3, fontVariant: ['tabular-nums'] },
  phoneMeta: { marginTop: SPACE.s1, textAlign: 'center' },
  play: { flexDirection: 'row', gap: SPACE.s3, marginTop: SPACE.s4, width: '100%' },
  phoneActions: {
    flexDirection: 'row',
    gap: SPACE.s6,
    justifyContent: 'center',
    marginTop: SPACE.s2,
  },
  tabletActions: { flexDirection: 'row', gap: SPACE.s3, marginTop: SPACE.s2 },
}))

type HeadStyles = ReturnType<typeof useStyles>

/** Where a form factor sets each part of the head. */
type HeadLook = {
  frame: StyleProp<ViewStyle>
  body: StyleProp<ViewStyle>
  title: StyleProp<TextStyle>
  meta: StyleProp<TextStyle>
  actions: StyleProp<ViewStyle>
}

const HEAD_LOOKS = {
  [FORM_FACTORS.phone]: (styles: HeadStyles): HeadLook => ({
    frame: styles.phone,
    body: styles.centred,
    title: styles.phoneTitle,
    meta: [styles.meta, styles.phoneMeta],
    actions: styles.phoneActions,
  }),
  [FORM_FACTORS.tablet]: (styles: HeadStyles): HeadLook => ({
    frame: styles.tablet,
    body: styles.stacked,
    title: styles.tabletTitle,
    meta: styles.meta,
    actions: styles.tabletActions,
  }),
} as const satisfies Record<FormFactor, (styles: HeadStyles) => HeadLook>

type MoreActionProps = { onMore: () => void }

/** A tablet's More, among the head's actions; a phone's sits in its nav bar instead. */
function TabletMore({ onMore }: MoreActionProps) {
  const { colors } = useWrenTheme()
  return (
    <DetailAction
      glyph={<WrenIcon color={colors.text2} name={ICONS.more} />}
      label={DETAIL_COPY.more}
      onPress={onMore}
    />
  )
}

const MORE_ACTIONS = {
  [FORM_FACTORS.phone]: Nothing,
  [FORM_FACTORS.tablet]: TabletMore,
} as const satisfies Record<FormFactor, ComponentType<MoreActionProps>>

type HeadTopProps = { onMore: () => void }

/** A phone's nav bar: back, and More at its end. */
function PhoneTop({ onMore }: HeadTopProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <View style={styles.nav}>
      <BackButton />
      <IconButton color={colors.text} icon={ICONS.more} label={DETAIL_COPY.more} onPress={onMore} />
    </View>
  )
}

/** A tablet's "< Back" in red above the cover; its More sits with the actions. */
function TabletTop() {
  const router = useRouter()
  return <BackLink onPress={() => router.back()} />
}

const HEAD_TOPS = {
  [FORM_FACTORS.phone]: PhoneTop,
  [FORM_FACTORS.tablet]: TabletTop,
} as const satisfies Record<FormFactor, ComponentType<HeadTopProps>>

type CollectionHeadProps = {
  cover: Cover | null
  title: string
  /** The album's artists as links, or nothing for a playlist. */
  byline?: ReactNode
  /** "Pop · 2014 · 20 songs · 1 hr 24 min". */
  meta: string
  onPlay: () => void
  onShuffle: () => void
  /** Whether there is anything to play: an empty playlist shows no Play or Shuffle. */
  canPlay?: boolean
  /** Opens the page's More sheet. */
  onMore: () => void
  /** Download, Like, Queue. */
  actions: ReactNode
}

/**
 * An album's or a playlist's head: its cover with a soft shadow, its title in Young Serif, its
 * artists and facts, Play and Shuffle at equal width, and its actions under them. A phone
 * centres it under its nav bar; a tablet sets it in a column under "< Back", More beside the
 * actions.
 */
export function CollectionHead({
  cover,
  title,
  byline,
  meta,
  onPlay,
  onShuffle,
  canPlay = true,
  onMore,
  actions,
}: CollectionHeadProps) {
  const styles = useStyles()
  const formFactor = useFormFactor()
  const MoreAction = MORE_ACTIONS[formFactor]
  const look = HEAD_LOOKS[formFactor](styles)
  const Top = HEAD_TOPS[formFactor]
  return (
    <View style={look.frame}>
      <Top onMore={onMore} />
      <View style={look.body}>
        <AlbumArt cover={cover} isRaised radius={RADIUS.md} size={COVER_SIZES[formFactor]} />
        <Text accessibilityRole="header" style={look.title}>
          {title}
        </Text>
        {byline}
        {meta !== '' && <Text style={look.meta}>{meta}</Text>}
        {canPlay && (
          <View style={styles.play}>
            <PlayButtons onPlay={onPlay} onShuffle={onShuffle} />
          </View>
        )}
        <View style={look.actions}>
          {actions}
          <MoreAction onMore={onMore} />
        </View>
      </View>
    </View>
  )
}
