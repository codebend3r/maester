import type { ReactNode } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Text } from '@/layouts/Text'
import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import type { EpisodeRow, ItemHero, ItemPage, PersonCard, VersionRow } from '@/queries/itemPage'
import { CardPicture } from '@/layouts/Card'
import { TouchBack } from '@/layouts/TouchBack'
import { TouchCard } from '@/layouts/TouchCard'
import { useToneStyles } from '@/layouts/formStyles'
import {
  ITEM_HEADINGS,
  WATCHED_MARK,
  type ItemAction,
  type ItemKit,
  type ItemLayoutProps,
  type ItemNoticeProps,
  actionLookOf,
  dotted,
  episodeLabelOf,
  heroFactsOf,
  heroPictureOf,
  playLabelOf,
} from '@/layouts/itemKit'
import { isTablet } from '@/layouts/screenSizes'
import { LINE_RATIO } from '@/layouts/textHeights'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles } from '@/theme/useTheme'

/** How wide the heading's picture stands: a poster, or an episode's wider still. */
const HERO_WIDTHS = {
  phone: { [CARD_SHAPES.poster]: 112, [CARD_SHAPES.wide]: 176 },
  tablet: { [CARD_SHAPES.poster]: 168, [CARD_SHAPES.wide]: 288 },
} as const

const SEASON_WIDTHS = { phone: 128, tablet: 168 } as const

const STILL_WIDTH = 128

const PHOTO_SIZE = 72

/** A person's column: their photo, with room either side for a name under it. */
const PERSON_WIDTH = 96

/**
 * The backdrop is 16:9, and never more than a third of the screen's height, so a phone held
 * sideways or a tablet still opens on the title.
 */
const BACKDROP_RATIO = 9 / 16
const BACKDROP_SHARE = 1 / 3

const useGutters = () => {
  const insets = useSafeAreaInsets()
  return { left: SIZES.space3 + insets.left, right: SIZES.space3 + insets.right }
}

type HeadingProps = { title: string }

const Heading = ({ title }: HeadingProps) => {
  const styles = useStyles()
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {title}
    </Text>
  )
}

type ActionButtonProps = { action: ItemAction }

/** Play, filled as the one action the page is for, or a mark, ticked while it is on. */
const ActionButton = ({ action }: ActionButtonProps) => {
  const styles = useStyles()
  const toneStyles = useToneStyles()
  const look = actionLookOf(action)
  return (
    <Pressable
      accessibilityLabel={action.label}
      accessibilityRole={look.role}
      accessibilityState={look.state}
      onPress={action.onPress}
      style={({ pressed }) => [
        styles.action,
        toneStyles[look.tone].button,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionLabel, toneStyles[look.tone].label]}>{look.text}</Text>
    </Pressable>
  )
}

type ProgressLineProps = { progress: NonNullable<ItemHero['progress']> }

/** Where playback stopped, or how much is watched, as a line with its words. */
const ProgressLine = ({ progress }: ProgressLineProps) => {
  const styles = useStyles()
  return (
    <View style={styles.progress}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress.fraction * 100}%` }]} />
      </View>
      <Text style={styles.small}>{progress.label}</Text>
    </View>
  )
}

type HeroProps = { hero: ItemHero; actions: ItemAction[] }

const Hero = ({ hero, actions }: HeroProps) => {
  const styles = useStyles()
  const { width, height } = useWindowDimensions()
  const widths = isTablet({ width, height }) ? HERO_WIDTHS.tablet : HERO_WIDTHS.phone
  // Held sideways the screen is short, so the title sits by the poster's top, not its foot.
  const isWide = width > height
  const facts = heroFactsOf(hero)
  return (
    <View style={styles.hero}>
      <View style={[styles.headRow, isWide && styles.headRowWide]}>
        <CardPicture card={heroPictureOf(hero)} width={widths[hero.poster.shape]} />
        <View style={styles.words}>
          {hero.eyebrow !== null && <Text style={styles.eyebrow}>{hero.eyebrow}</Text>}
          <Text accessibilityRole="header" style={styles.title}>
            {hero.title}
          </Text>
          {hero.byline !== null && <Text style={styles.byline}>{hero.byline}</Text>}
          {facts !== '' && <Text style={styles.small}>{facts}</Text>}
          {hero.progress !== null && <ProgressLine progress={hero.progress} />}
        </View>
      </View>
      <View style={styles.actions}>
        {actions.map((action) => (
          <ActionButton key={action.key} action={action} />
        ))}
      </View>
      {hero.tagline !== null && <Text style={styles.tagline}>{hero.tagline}</Text>}
      {hero.summary !== null && <Text style={styles.summary}>{hero.summary}</Text>}
    </View>
  )
}

type FileFactsProps = { facts: ItemPage['file'] }

const FileFacts = ({ facts }: FileFactsProps) => {
  const styles = useStyles()
  return (
    <View style={styles.facts}>
      <Heading title={ITEM_HEADINGS.file} />
      {facts.map((fact) => (
        <View key={fact.label} style={styles.fact}>
          <Text style={styles.factLabel}>{fact.label}</Text>
          <Text style={styles.factValue}>{fact.value}</Text>
        </View>
      ))}
    </View>
  )
}

type VersionsProps = { versions: VersionRow[]; onOpen: Opens }

const Versions = ({ versions, onOpen }: VersionsProps) => {
  const styles = useStyles()
  return (
    <View style={styles.section}>
      <Heading title={ITEM_HEADINGS.versions} />
      {versions.map((version) => (
        <Pressable
          key={version.key}
          accessibilityLabel={playLabelOf(version.fileName)}
          accessibilityRole="button"
          onPress={() => onOpen(version.target)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={styles.words}>
            <Text style={styles.rowTitle}>{dotted(version.facts)}</Text>
            <Text numberOfLines={1} style={styles.small}>
              {version.fileName}
            </Text>
          </View>
          <Text style={styles.play}>{'▶'}</Text>
        </Pressable>
      ))}
    </View>
  )
}

type Opens = ItemLayoutProps['onOpen']

type RailProps = { title: string; children: ReactNode }

/** A titled row that scrolls sideways, running to the screen's edges past the gutters. */
const Rail = ({ title, children }: RailProps) => {
  const styles = useStyles()
  const gutters = useGutters()
  const padded = { paddingLeft: gutters.left, paddingRight: gutters.right }
  return (
    <View style={styles.section}>
      <View style={padded}>
        <Heading title={title} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.cards, padded]}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  )
}

type SeasonsProps = { seasons: ShelfCard[]; onOpen: Opens }

const Seasons = ({ seasons, onOpen }: SeasonsProps) => {
  const screen = useWindowDimensions()
  return (
    <Rail title={ITEM_HEADINGS.seasons}>
      {seasons.map((season) => (
        <TouchCard
          key={season.key}
          card={season}
          onPress={() => onOpen(season.target)}
          width={isTablet(screen) ? SEASON_WIDTHS.tablet : SEASON_WIDTHS.phone}
        />
      ))}
    </Rail>
  )
}

type EpisodesProps = { episodes: EpisodeRow[]; onOpen: Opens }

const Episodes = ({ episodes, onOpen }: EpisodesProps) => {
  const styles = useStyles()
  return (
    <View style={styles.section}>
      <Heading title={ITEM_HEADINGS.episodes} />
      {episodes.map((episode) => (
        <Pressable
          key={episode.key}
          accessibilityLabel={episodeLabelOf(episode)}
          accessibilityRole="button"
          onPress={() => onOpen(episode.target)}
          style={({ pressed }) => [styles.episode, pressed && styles.pressed]}
        >
          <CardPicture card={episode} width={STILL_WIDTH} />
          <View style={styles.words}>
            <Text style={styles.rowTitle}>{episode.title}</Text>
            {episode.line !== null && <Text style={styles.small}>{episode.line}</Text>}
            {episode.summary !== null && (
              <Text numberOfLines={3} style={styles.small}>
                {episode.summary}
              </Text>
            )}
            {episode.isWatched && <Text style={styles.small}>{WATCHED_MARK}</Text>}
          </View>
        </Pressable>
      ))}
    </View>
  )
}

type PersonProps = { person: PersonCard }

const Person = ({ person }: PersonProps) => {
  const styles = useStyles()
  return (
    <View style={styles.person}>
      <View style={styles.photo}>
        {person.picture !== null ? (
          <Image resizeMode="cover" source={person.picture} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.initials}>{person.initials}</Text>
        )}
      </View>
      <Text numberOfLines={2} style={styles.personName}>
        {person.name}
      </Text>
      <Text numberOfLines={2} style={styles.personRole}>
        {person.role}
      </Text>
    </View>
  )
}

type CastProps = { title: string; cast: PersonCard[] }

const Cast = ({ title, cast }: CastProps) => (
  <Rail title={title}>
    {cast.map((person) => (
      <Person key={person.key} person={person} />
    ))}
  </Rail>
)

type TopProps = Pick<ItemPage['hero'], 'backdrop'> & { onBack: () => void }

/** The backdrop across the top, under the way back; without one, room for the way back. */
const Top = ({ backdrop, onBack }: TopProps) => {
  const styles = useStyles()
  const screen = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const gutters = useGutters()
  const height = Math.min(screen.width * BACKDROP_RATIO, screen.height * BACKDROP_SHARE)
  const room = { paddingTop: insets.top + SIZES.space1, paddingLeft: gutters.left }
  if (backdrop === null) {
    return (
      <View style={room}>
        <TouchBack onPress={onBack} />
      </View>
    )
  }
  return (
    <View style={{ height }}>
      <Image resizeMode="cover" source={backdrop} style={StyleSheet.absoluteFill} />
      <View style={[styles.top, room]}>
        <TouchBack isRaised onPress={onBack} />
      </View>
    </View>
  )
}

/**
 * An item on a phone or tablet: the backdrop, then the poster beside the names and facts, the
 * actions, the summary and the file, then a movie's versions, a show's seasons or a season's
 * episodes, and the cast. It scrolls as one page, clear of the side insets held sideways. The
 * marks are drawn at once and Play once it is known, as on the web.
 */
const ItemLayout = ({ page, actions, onOpen, onBack }: ItemLayoutProps) => {
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const gutters = useGutters()
  const padded = { paddingLeft: gutters.left, paddingRight: gutters.right }
  return (
    <ScrollView
      contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + SIZES.space5 }]}
      style={styles.ground}
    >
      <Top backdrop={page.hero.backdrop} onBack={onBack} />
      <View style={padded}>
        <Hero actions={actions} hero={page.hero} />
      </View>
      {page.file.length > 0 && (
        <View style={padded}>
          <FileFacts facts={page.file} />
        </View>
      )}
      {page.versions.length > 0 && (
        <View style={padded}>
          <Versions onOpen={onOpen} versions={page.versions} />
        </View>
      )}
      {page.seasons.length > 0 && <Seasons onOpen={onOpen} seasons={page.seasons} />}
      {page.episodes.length > 0 && (
        <View style={padded}>
          <Episodes episodes={page.episodes} onOpen={onOpen} />
        </View>
      )}
      {page.cast.length > 0 && <Cast cast={page.cast} title={page.castTitle} />}
    </ScrollView>
  )
}

const ItemNotice = ({ notice, onBack }: ItemNoticeProps) => {
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const gutters = useGutters()
  return (
    <View
      style={[
        styles.ground,
        styles.notice,
        { paddingTop: insets.top, paddingLeft: gutters.left, paddingRight: gutters.right },
      ]}
    >
      <TouchBack onPress={onBack} />
      <Text style={styles.summary}>{notice}</Text>
    </View>
  )
}

/** An item's page on a phone or tablet. */
export const touchItem: ItemKit = { ItemLayout, ItemNotice }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    page: { gap: SIZES.space4 },
    notice: { gap: SIZES.space3 },
    top: { position: 'absolute', top: 0, left: 0 },
    hero: { gap: SIZES.space3 },
    headRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SIZES.space3 },
    headRowWide: { alignItems: 'flex-start' },
    heading: { color: colours.text, fontSize: SIZES.textLg, fontWeight: 'bold' },
    words: { flex: 1, gap: SIZES.space0 },
    eyebrow: { color: colours.muted, fontSize: SIZES.textSm, fontWeight: '600' },
    title: {
      color: colours.text,
      fontSize: SIZES.textXl,
      lineHeight: SIZES.textXl * LINE_RATIO,
      fontWeight: 'bold',
    },
    byline: { color: colours.text, fontSize: SIZES.textSm },
    small: { color: colours.muted, fontSize: SIZES.textSm, lineHeight: SIZES.textSm * LINE_RATIO },
    progress: { gap: SIZES.space0, paddingTop: SIZES.space0, maxWidth: SIZES.measure },
    track: { height: SIZES.space0, borderRadius: SIZES.space0, backgroundColor: colours.track },
    fill: { height: '100%', borderRadius: SIZES.space0, backgroundColor: colours.accent },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZES.space1 },
    action: {
      minHeight: SIZES.fieldHeight,
      justifyContent: 'center',
      paddingHorizontal: SIZES.space3,
      borderRadius: SIZES.radius,
      borderWidth: SIZES.focusRing,
    },
    actionLabel: { fontSize: SIZES.text, fontWeight: 'bold' },
    pressed: { opacity: OPACITIES.pressed },
    tagline: { color: colours.text, fontSize: SIZES.text, fontStyle: 'italic' },
    summary: {
      color: colours.text,
      fontSize: SIZES.text,
      lineHeight: SIZES.text * LINE_RATIO,
      maxWidth: SIZES.measure,
    },
    section: { gap: SIZES.space2 },
    facts: { gap: SIZES.space2, maxWidth: SIZES.measure },
    fact: {
      flexDirection: 'row',
      gap: SIZES.space3,
      paddingVertical: SIZES.space1,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colours.line,
    },
    factLabel: { width: '30%', color: colours.muted, fontSize: SIZES.textSm },
    factValue: { flex: 1, color: colours.text, fontSize: SIZES.textSm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space2,
      minHeight: SIZES.fieldHeight,
      paddingVertical: SIZES.space1,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colours.line,
    },
    rowTitle: { color: colours.text, fontSize: SIZES.text, fontWeight: '600' },
    play: { color: colours.text, fontSize: SIZES.textLg, paddingHorizontal: SIZES.space1 },
    cards: { gap: SIZES.space3 },
    episode: { flexDirection: 'row', alignItems: 'flex-start', gap: SIZES.space2 },
    person: { width: PERSON_WIDTH, alignItems: 'center', gap: SIZES.space0 },
    photo: {
      width: PHOTO_SIZE,
      height: PHOTO_SIZE,
      borderRadius: PHOTO_SIZE / 2,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.raised,
    },
    initials: { color: colours.muted, fontSize: SIZES.textLg, fontWeight: 'bold' },
    personName: {
      color: colours.text,
      fontSize: SIZES.textXs,
      fontWeight: '600',
      textAlign: 'center',
    },
    personRole: { color: colours.muted, fontSize: SIZES.textXs, textAlign: 'center' },
  }),
)
