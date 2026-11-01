import type { ComponentType, ReactNode } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Icon } from '@raven/native'
import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { TitleArt } from '@/layouts/TitleArt'
import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import {
  ART_PLACES,
  type EpisodeRow,
  type ItemHero,
  type ItemPage,
  type PersonCard,
  type VersionRow,
} from '@/queries/itemPage'
import { CardPicture, PICTURE_STATES, type PictureState, pictureStateOf } from '@/layouts/Card'
import { ITEM_LAYOUT_COPY } from '@/layouts/copy'
import { TouchNav } from '@/layouts/TouchNav'
import { TouchCard } from '@/layouts/TouchCard'
import { BUTTON_TONES } from '@/layouts/formKit'
import { useToneStyles } from '@/layouts/formStyles'
import {
  ITEM_HEADINGS,
  ITEM_TEST_IDS,
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
  TITLE_LOOKS,
  type TitleLook,
  titleLookOf,
} from '@/layouts/itemKit'
import { isTablet } from '@/layouts/screenSizes'
import { LINE_RATIO } from '@/layouts/textHeights'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { translucent } from '@/theme/translucent'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** How tall a show's title art stands over an episode's name. */
const LOGO_HEIGHT = 56

/** How wide the heading's picture stands: a poster, or an episode's wider still. */
const HERO_WIDTHS = {
  phone: { [CARD_SHAPES.poster]: 112, [CARD_SHAPES.wide]: 176, [CARD_SHAPES.square]: 112 },
  tablet: { [CARD_SHAPES.poster]: 168, [CARD_SHAPES.wide]: 288, [CARD_SHAPES.square]: 168 },
} as const

const SEASON_WIDTHS = { phone: 128, tablet: 168 } as const

const STILL_WIDTH = 128

const PHOTO_SIZE = 72

/** A person's column: their photo, with room either side for a name under it. */
const PERSON_WIDTH = 96

/**
 * The backdrop is the page's ground, as the web's `PageBackdrop` is: fixed behind the content
 * while it scrolls, faded well back over the theme's ground so the text keeps its contrast. The
 * ground is the text's opposite in every theme (light ground and dark text, or the reverse), so
 * one opacity dims the picture towards the contrast the text needs on light and dark alike.
 */
const BACKDROP_OPACITY = 0.28

/** How much of the theme's raised colour the synopsis plate keeps, so the backdrop shows faintly through. */
const PLATE_ALPHA = 0.75

const useGutters = () => {
  const insets = useSafeAreaInsets()
  return { left: SIZES.space3 + insets.left, right: SIZES.space3 + insets.right }
}

type HeadingProps = { title: string }

const Heading = ({ title }: HeadingProps) => {
  const styles = useStyles()
  return (
    <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.heading}>
      {title}
    </Text>
  )
}

type ActionButtonProps = { action: ItemAction }

/** Play, filled as the one action the page is for, a mark, filled while it is on, or a link up: its icon with its few words. */
const ActionButton = ({ action }: ActionButtonProps) => {
  const styles = useStyles()
  const toneStyles = useToneStyles()
  const palette = useTheme((theme) => theme.palette)
  const look = actionLookOf(action)
  const colour = look.tone === BUTTON_TONES.primary ? palette.onAccent : palette.text
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
      <Icon colour={colour} name={look.icon} size={SIZES.textLg} />
      {look.text !== null && (
        <Text style={[styles.actionLabel, toneStyles[look.tone].label]}>{look.text}</Text>
      )}
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

type HeroTitleProps = { hero: ItemHero; maxWidth: number }

type HeroTitleArtProps = HeroTitleProps

/** The title as the item's own title art, said as a header. */
const HeroTitleArt = ({ hero, maxWidth }: HeroTitleArtProps) => {
  const styles = useStyles()
  return (
    <View accessibilityLabel={hero.title} accessibilityRole="header" accessible>
      <TitleArt
        height={LOGO_HEIGHT}
        logo={hero.logo?.picture ?? null}
        maxWidth={maxWidth}
        name={hero.title}
        textStyle={styles.title}
      />
    </View>
  )
}

type HeroTitleWordsProps = HeroTitleProps

/** The title in type. */
const HeroTitleWords = ({ hero }: HeroTitleWordsProps) => {
  const styles = useStyles()
  return (
    <Text variant={TEXT_VARIANTS.display} accessibilityRole="header" style={styles.title}>
      {hero.title}
    </Text>
  )
}

const HERO_TITLES = {
  [TITLE_LOOKS.art]: HeroTitleArt,
  [TITLE_LOOKS.words]: HeroTitleWords,
} as const satisfies Record<TitleLook, ComponentType<HeroTitleProps>>

type HeroProps = { hero: ItemHero; actions: ItemAction[]; links: ItemAction[] }

const Hero = ({ hero, actions, links }: HeroProps) => {
  const styles = useStyles()
  const { width, height } = useWindowDimensions()
  const widths = isTablet({ width, height }) ? HERO_WIDTHS.tablet : HERO_WIDTHS.phone
  const facts = heroFactsOf(hero)
  const Title = HERO_TITLES[titleLookOf(hero.logo)]
  return (
    <View style={styles.hero}>
      <View style={styles.headRow}>
        <CardPicture card={heroPictureOf(hero)} width={widths[hero.poster.shape]} />
        <View style={styles.words}>
          {hero.logo !== null && hero.logo.place === ART_PLACES.over && (
            <TitleArt
              height={LOGO_HEIGHT}
              logo={hero.logo.picture}
              maxWidth={width}
              name={hero.eyebrow ?? hero.title}
              textStyle={styles.eyebrow}
            />
          )}
          {hero.eyebrow !== null && <Text style={styles.eyebrow}>{hero.eyebrow}</Text>}
          <Title hero={hero} maxWidth={width} />
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
      {links.length > 0 && (
        <View style={styles.actions}>
          {links.map((action) => (
            <ActionButton key={action.key} action={action} />
          ))}
        </View>
      )}
      {(hero.tagline !== null || hero.summary !== null) && (
        <View style={styles.synopsis}>
          {hero.tagline !== null && <Text style={styles.tagline}>{hero.tagline}</Text>}
          {hero.summary !== null && <Text style={styles.summary}>{hero.summary}</Text>}
        </View>
      )}
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
          <Text style={styles.factValue}>{ITEM_LAYOUT_COPY.values(fact.values)}</Text>
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
          <Text style={styles.play}>{ITEM_LAYOUT_COPY.play}</Text>
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

type PersonPictureProps = PersonProps

const PersonPicture = ({ person }: PersonPictureProps) =>
  person.picture !== null && (
    <Image resizeMode="cover" source={person.picture} style={StyleSheet.absoluteFill} />
  )

type PersonInitialsProps = PersonProps

const PersonInitials = ({ person }: PersonInitialsProps) => {
  const styles = useStyles()
  return (
    <Text variant={TEXT_VARIANTS.display} style={styles.initials}>
      {person.initials}
    </Text>
  )
}

/** A person's photo, else their initials. */
const PERSON_PHOTOS = {
  [PICTURE_STATES.shown]: PersonPicture,
  [PICTURE_STATES.missing]: PersonInitials,
} as const satisfies Record<PictureState, ComponentType<PersonProps>>

const Person = ({ person }: PersonProps) => {
  const styles = useStyles()
  const Photo = PERSON_PHOTOS[pictureStateOf(person.picture)]
  return (
    <View style={styles.person}>
      <View style={styles.photo}>
        <Photo person={person} />
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

type TopProps = { onBack: () => void }

/** Room for the way back, clear of the status bar; the poster sits right under it. */
const Top = ({ onBack }: TopProps) => {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ paddingTop: insets.top + SIZES.space1 }}>
      <TouchNav onBack={onBack} />
    </View>
  )
}

type BackdropProps = { backdrop: NonNullable<ItemPage['hero']['backdrop']> }

const Backdrop = ({ backdrop }: BackdropProps) => {
  const styles = useStyles()
  return (
    <Image
      accessibilityElementsHidden
      resizeMode="cover"
      source={backdrop}
      style={[StyleSheet.absoluteFill, styles.backdrop]}
      testID={ITEM_TEST_IDS.backdrop}
    />
  )
}

/**
 * An item on a phone or tablet: the backdrop behind the whole page, fixed while it scrolls, and
 * over it the way back, then the poster at the top left beside the names and facts, the
 * actions, the summary and the file, then a movie's versions, a show's seasons or a season's
 * episodes, and the cast. It scrolls as one page, clear of the side insets held sideways. The
 * marks are drawn at once and Play once it is known, as on the web.
 */
const ItemLayout = ({ page, actions, links, onOpen, onBack }: ItemLayoutProps) => {
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const gutters = useGutters()
  const padded = { paddingLeft: gutters.left, paddingRight: gutters.right }
  return (
    <View style={styles.ground}>
      {page.hero.backdrop !== null && <Backdrop backdrop={page.hero.backdrop} />}
      <ScrollView
        contentContainerStyle={[styles.page, { paddingBottom: insets.bottom + SIZES.space5 }]}
        style={styles.scroll}
      >
        <View style={[styles.head, padded]}>
          <Top onBack={onBack} />
          <Hero actions={actions} hero={page.hero} links={links} />
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
    </View>
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
      <TouchNav onBack={onBack} />
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
    scroll: { flex: 1 },
    backdrop: { opacity: BACKDROP_OPACITY },
    head: { gap: SIZES.space2 },
    hero: { gap: SIZES.space3 },
    headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SIZES.space3 },
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
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SIZES.space1,
      paddingHorizontal: SIZES.space3,
      borderRadius: SIZES.radius,
      borderWidth: SIZES.focusRing,
    },
    actionLabel: { fontSize: SIZES.text, fontWeight: 'bold' },
    pressed: { opacity: OPACITIES.pressed },
    // The raised surface under the words, translucent so the backdrop shows faintly through.
    synopsis: {
      gap: SIZES.space2,
      padding: SIZES.space3,
      borderRadius: SIZES.radius,
      backgroundColor: translucent({ colour: colours.raised, alpha: PLATE_ALPHA }),
    },
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
