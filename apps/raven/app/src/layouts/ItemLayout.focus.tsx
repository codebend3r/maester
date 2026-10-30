import { type ComponentType, type ReactNode, useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'

import { Icon } from '@raven/native'
import { Text } from '@/layouts/Text'
import { TitleArt } from '@/layouts/TitleArt'
import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import {
  ART_PLACES,
  type ItemHero,
  type ItemPage,
  type PersonCard,
  type VersionRow,
} from '@/queries/itemPage'
import { CardPicture, PICTURE_STATES, type PictureState, pictureStateOf } from '@/layouts/Card'
import { ITEM_LAYOUT_COPY } from '@/layouts/copy'
import { FocusBand } from '@/layouts/FocusBand'
import { focusCardWidthOf, FocusCard } from '@/layouts/FocusCard'
import { useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
import { BUTTON_TONES } from '@/layouts/formKit'
import { useToneStyles } from '@/layouts/formStyles'
import {
  ITEM_HEADINGS,
  type ItemAction,
  type ItemKit,
  type ItemLayoutProps,
  type ItemNoticeProps,
  actionLookOf,
  dotted,
  heroFactsOf,
  heroPictureOf,
  playLabelOf,
  TITLE_LOOKS,
  type TitleLook,
  titleLookOf,
} from '@/layouts/itemKit'
import { LINE_RATIO } from '@/layouts/textHeights'
import { TV_GUTTER, TV_SIZES, tvSize } from '@/theme/tvSizes'
import { themedStyles, useTheme } from '@/theme/useTheme'

/** How tall a show's title art stands over an episode's name: larger than the player's. */
const LOGO_HEIGHT = tvSize(150)

/** The synopsis plate shows a little of the backdrop through it. */
const SYNOPSIS_OPACITY = 0.92

/** The heading's picture in points on a 1920 by 1080 point screen: a poster, or a still. */
const HERO_WIDTHS = {
  [CARD_SHAPES.poster]: tvSize(280),
  [CARD_SHAPES.wide]: tvSize(480),
} as const

/** How wide the words beside the picture run: about seventy characters at the TV's size. */
const WORDS_WIDTH = tvSize(1040)

const PHOTO_SIZE = tvSize(120)

/** A person's column: their photo, with room either side for a name under it. */
const PERSON_WIDTH = tvSize(176)

/** The backdrop fills the screen's width at 16:9, dimmed so the words over it read. */
const BACKDROP_RATIO = 9 / 16
const BACKDROP_OPACITY = 0.3

type Opens = ItemLayoutProps['onOpen']

type HeadingProps = { title: string }

const Heading = ({ title }: HeadingProps) => {
  const styles = useStyles()
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {title}
    </Text>
  )
}

type ActionButtonProps = { action: ItemAction; isFirst: boolean }

/**
 * Play, filled as the one action the page is for, a mark, filled while it is on, or a link up,
 * each its icon with its few words, ringed while focused. The first takes the remote's focus
 * as the page opens, and lets go once anything on the page has had it, so a button that
 * changes after a mark leaves the viewer put.
 */
const ActionButton = ({ action, isFirst }: ActionButtonProps) => {
  const { isOpening, settle } = useOpeningFocus()
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
      hasTVPreferredFocus={isOpening && isFirst}
      onFocus={settle}
      onPress={action.onPress}
      style={({ focused }) => [
        styles.action,
        toneStyles[look.tone].button,
        focused && styles.focused,
      ]}
    >
      {({ focused }) => (
        <>
          <Icon colour={colour} isFocused={focused} name={look.icon} size={TV_SIZES.textXl} />
          {look.text !== null && (
            <Text style={[styles.actionLabel, toneStyles[look.tone].label]}>{look.text}</Text>
          )}
        </>
      )}
    </Pressable>
  )
}

type ProgressLineProps = { progress: NonNullable<ItemHero['progress']> }

const ProgressLine = ({ progress }: ProgressLineProps) => {
  const styles = useStyles()
  return (
    <View style={styles.progress}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress.fraction * 100}%` }]} />
      </View>
      <Text style={styles.line}>{progress.label}</Text>
    </View>
  )
}

type ActionRowProps = { actions: ItemAction[]; isFirstRow: boolean }

/** A row of actions; on the first row the first action takes the opening focus. */
const ActionRow = ({ actions, isFirstRow }: ActionRowProps) => {
  const styles = useStyles()
  return (
    <View style={styles.actions}>
      {actions.map((action, index) => (
        <ActionButton key={action.key} action={action} isFirst={isFirstRow && index === 0} />
      ))}
    </View>
  )
}

type HeroTitleProps = { hero: ItemHero }

type HeroTitleArtProps = HeroTitleProps

/** The title as the item's own title art, said as a header. */
const HeroTitleArt = ({ hero }: HeroTitleArtProps) => {
  const styles = useStyles()
  return (
    <View accessibilityLabel={hero.title} accessibilityRole="header" accessible>
      <TitleArt
        height={LOGO_HEIGHT}
        logo={hero.logo?.picture ?? null}
        maxWidth={WORDS_WIDTH}
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
    <Text accessibilityRole="header" style={styles.title}>
      {hero.title}
    </Text>
  )
}

const HERO_TITLES = {
  [TITLE_LOOKS.art]: HeroTitleArt,
  [TITLE_LOOKS.words]: HeroTitleWords,
} as const satisfies Record<TitleLook, ComponentType<HeroTitleProps>>

/** Whether a file's fact holds one value or several. */
const FACT_COUNTS = { one: 'one', several: 'several' } as const

type FactCount = (typeof FACT_COUNTS)[keyof typeof FACT_COUNTS]

const factCountOf = (values: readonly string[]): FactCount =>
  values.length === 1 ? FACT_COUNTS.one : FACT_COUNTS.several

type FactValuesProps = { values: readonly string[] }

type FactValueProps = FactValuesProps

/** A fact's one value, set plainly. */
const FactValue = ({ values }: FactValueProps) => {
  const styles = useStyles()
  return <Text style={styles.fileValue}>{values[0]}</Text>
}

type FactChipsProps = FactValuesProps

/** A fact's several values, each a chip of its own. */
const FactChips = ({ values }: FactChipsProps) => {
  const styles = useStyles()
  return values.map((value) => (
    <View key={value} style={styles.fileChip}>
      <Text style={styles.fileChipText}>{value}</Text>
    </View>
  ))
}

const FACT_VALUE_VIEWS = {
  [FACT_COUNTS.one]: FactValue,
  [FACT_COUNTS.several]: FactChips,
} as const satisfies Record<FactCount, ComponentType<FactValuesProps>>

type HeroProps = {
  hero: ItemHero
  /** The actions, or null while what Play starts is still being read. */
  actions: ItemAction[] | null
  links: ItemAction[]
  file: ItemPage['file']
}

/**
 * The heading over the backdrop: the picture beside the show's title art, the names, facts and
 * summary, then the actions in a row, the first taking the remote's focus while the page opens,
 * and the links up on a row of their own below, so neither row runs off the screen.
 */
const Hero = ({ hero, actions, links, file }: HeroProps) => {
  const styles = useStyles()
  const facts = heroFactsOf(hero)
  const Title = HERO_TITLES[titleLookOf(hero.logo)]
  return (
    <View style={styles.hero}>
      <CardPicture
        card={heroPictureOf(hero)}
        radius={TV_SIZES.radius}
        width={HERO_WIDTHS[hero.poster.shape]}
      />
      <View style={styles.words}>
        {hero.logo !== null && hero.logo.place === ART_PLACES.over && (
          <TitleArt
            height={LOGO_HEIGHT}
            logo={hero.logo.picture}
            maxWidth={WORDS_WIDTH}
            name={hero.eyebrow ?? hero.title}
            textStyle={styles.eyebrow}
          />
        )}
        {hero.eyebrow !== null && <Text style={styles.eyebrow}>{hero.eyebrow}</Text>}
        <Title hero={hero} />
        {hero.byline !== null && <Text style={styles.byline}>{hero.byline}</Text>}
        {facts !== '' && <Text style={styles.line}>{facts}</Text>}
        {hero.progress !== null && <ProgressLine progress={hero.progress} />}
        {(hero.tagline !== null || hero.summary !== null) && (
          <View style={styles.synopsis}>
            {hero.tagline !== null && <Text style={styles.tagline}>{hero.tagline}</Text>}
            {hero.summary !== null && (
              <Text numberOfLines={4} style={styles.summary}>
                {hero.summary}
              </Text>
            )}
          </View>
        )}
        {actions !== null && <ActionRow actions={actions} isFirstRow />}
        {actions !== null && links.length > 0 && <ActionRow actions={links} isFirstRow={false} />}
        {file.length > 0 && (
          <View style={styles.file}>
            {file.map((fact) => {
              const Values = FACT_VALUE_VIEWS[factCountOf(fact.values)]
              return (
                <View key={fact.label} style={styles.fileRow}>
                  <Text style={styles.fileLabel}>{fact.label}</Text>
                  <View style={styles.fileValues}>
                    <Values values={fact.values} />
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </View>
    </View>
  )
}

type RailProps = { title: string; children: ReactNode }

/** A titled row the remote moves along, scrolled as the focus moves. */
const Rail = ({ title, children }: RailProps) => {
  const styles = useStyles()
  return (
    <FocusBand>
      <View style={styles.section}>
        <View style={styles.padded}>
          <Heading title={title} />
        </View>
        <ScrollView
          contentContainerStyle={styles.row}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </View>
    </FocusBand>
  )
}

type CardRowProps = { title: string; cards: ShelfCard[]; onOpen: Opens }

/** A row of cards the remote moves along, under its heading. */
const CardRow = ({ title, cards, onOpen }: CardRowProps) => (
  <Rail title={title}>
    {cards.map((card) => (
      <FocusCard
        key={card.key}
        card={card}
        isPreferred={false}
        onPress={() => onOpen(card.target)}
        width={focusCardWidthOf(card.shape)}
      />
    ))}
  </Rail>
)

type VersionsProps = { versions: VersionRow[]; onOpen: Opens }

const Versions = ({ versions, onOpen }: VersionsProps) => {
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  return (
    <FocusBand>
      <View style={[styles.section, styles.padded]}>
        <Heading title={ITEM_HEADINGS.versions} />
        <View style={styles.versions}>
          {versions.map((version) => (
            <Pressable
              key={version.key}
              accessibilityLabel={playLabelOf(version.fileName)}
              accessibilityRole="button"
              onFocus={settle}
              onPress={() => onOpen(version.target)}
              style={({ focused }) => [styles.version, focused && styles.focused]}
            >
              <Text style={styles.versionTitle}>{dotted(version.facts)}</Text>
              <Text numberOfLines={1} style={styles.line}>
                {version.fileName}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </FocusBand>
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
  return <Text style={styles.initials}>{person.initials}</Text>
}

/** A person's photo, else their initials. */
const PERSON_PHOTOS = {
  [PICTURE_STATES.shown]: PersonPicture,
  [PICTURE_STATES.missing]: PersonInitials,
} as const satisfies Record<PictureState, ComponentType<PersonProps>>

/** A person the remote can move to, so the row scrolls along with the focus. */
const Person = ({ person }: PersonProps) => {
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  const [isFocused, setFocused] = useState(false)
  const Photo = PERSON_PHOTOS[pictureStateOf(person.picture)]
  return (
    // Deliberately inert until the app has a person page: it takes the focus only so the
    // remote can move along the row and scroll it.
    <Pressable
      accessibilityLabel={ITEM_LAYOUT_COPY.person(person)}
      accessibilityRole="text"
      focusable
      onBlur={() => setFocused(false)}
      onFocus={() => {
        setFocused(true)
        settle()
      }}
      style={styles.person}
    >
      <View style={[styles.photo, isFocused && styles.focusedPhoto]}>
        <Photo person={person} />
      </View>
      <Text numberOfLines={2} style={[styles.personName, isFocused && styles.focusedName]}>
        {person.name}
      </Text>
      <Text numberOfLines={2} style={styles.personRole}>
        {person.role}
      </Text>
    </Pressable>
  )
}

/**
 * An item on a TV, never the touch page made larger: the backdrop behind a heading the remote
 * opens on, its first action holding the focus until the viewer moves it, then rows to move
 * along for the seasons or episodes, the versions and the cast.
 */
const ItemLayout = ({ page, actions, links, isPlayPending, onOpen }: ItemLayoutProps) => {
  const styles = useStyles()
  const screen = useWindowDimensions()
  // The page's hold on its screen's focus; each part below reads the opening focus itself.
  useScreenFocusScope()
  return (
    <View style={styles.ground}>
      {page.hero.backdrop !== null && (
        <Image
          resizeMode="cover"
          source={page.hero.backdrop}
          style={[styles.backdrop, { height: screen.width * BACKDROP_RATIO }]}
        />
      )}
      <ScrollView contentContainerStyle={styles.page} style={styles.scroll}>
        <FocusBand>
          <View style={styles.padded}>
            <Hero
              actions={isPlayPending ? null : actions}
              file={page.file}
              hero={page.hero}
              links={links}
            />
          </View>
        </FocusBand>
        {/* The rows wait for the actions, so nothing below can take the opening focus from Play. */}
        {!isPlayPending && (
          <>
            {page.seasons.length > 0 && (
              <CardRow cards={page.seasons} onOpen={onOpen} title={ITEM_HEADINGS.seasons} />
            )}
            {page.episodes.length > 0 && (
              <CardRow cards={page.episodes} onOpen={onOpen} title={ITEM_HEADINGS.episodes} />
            )}
            {page.versions.length > 0 && <Versions onOpen={onOpen} versions={page.versions} />}
            {page.cast.length > 0 && (
              <Rail title={page.castTitle}>
                {page.cast.map((person) => (
                  <Person key={person.key} person={person} />
                ))}
              </Rail>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

/** Menu goes back on a TV, so the notice is only its line. */
const ItemNotice = ({ notice }: ItemNoticeProps) => {
  const styles = useStyles()
  return (
    <View style={[styles.ground, styles.notice]}>
      <Text style={styles.summary}>{notice}</Text>
    </View>
  )
}

/** An item's page on a TV. */
export const focusItem: ItemKit = { ItemLayout, ItemNotice }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    ground: { flex: 1, backgroundColor: colours.ground },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, opacity: BACKDROP_OPACITY },
    scroll: { flex: 1 },
    page: { gap: TV_SIZES.space5, paddingTop: TV_SIZES.space6, paddingBottom: TV_SIZES.space6 },
    padded: { paddingHorizontal: TV_GUTTER },
    notice: { justifyContent: 'center', paddingHorizontal: TV_GUTTER },
    hero: { flexDirection: 'row', alignItems: 'flex-start', gap: TV_SIZES.space6 },
    words: { flex: 1, maxWidth: WORDS_WIDTH, gap: TV_SIZES.space2 },
    eyebrow: { color: colours.muted, fontSize: TV_SIZES.textLg, fontWeight: '600' },
    title: {
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      lineHeight: TV_SIZES.textXl * LINE_RATIO,
      fontWeight: 'bold',
    },
    byline: { color: colours.text, fontSize: TV_SIZES.textLg },
    line: { color: colours.muted, fontSize: TV_SIZES.text, lineHeight: TV_SIZES.text * LINE_RATIO },
    // The file's facts as a two column list: a quiet label beside each value, values on their own.
    file: { gap: TV_SIZES.space2, paddingTop: TV_SIZES.space2 },
    fileRow: { flexDirection: 'row', alignItems: 'flex-start', gap: TV_SIZES.space3 },
    fileLabel: {
      width: TV_SIZES.space8 * 2,
      color: colours.muted,
      fontSize: TV_SIZES.textSm,
      fontWeight: '600',
      letterSpacing: 1,
      textTransform: 'uppercase',
      lineHeight: TV_SIZES.text * LINE_RATIO,
    },
    fileValues: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: TV_SIZES.space1 },
    fileValue: {
      color: colours.text,
      fontSize: TV_SIZES.text,
      lineHeight: TV_SIZES.text * LINE_RATIO,
    },
    fileChip: {
      paddingHorizontal: TV_SIZES.space2,
      borderRadius: TV_SIZES.radius,
      backgroundColor: colours.quiet,
    },
    fileChipText: {
      color: colours.text,
      fontSize: TV_SIZES.textSm,
      lineHeight: TV_SIZES.text * LINE_RATIO,
    },
    progress: { gap: TV_SIZES.space1, maxWidth: TV_SIZES.measure },
    track: {
      height: TV_SIZES.space1,
      borderRadius: TV_SIZES.space0,
      backgroundColor: colours.track,
    },
    fill: { height: '100%', borderRadius: TV_SIZES.space0, backgroundColor: colours.accent },
    // The raised surface under the words, so they read over the backdrop in every theme.
    synopsis: {
      gap: TV_SIZES.space2,
      padding: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      backgroundColor: colours.raised,
      opacity: SYNOPSIS_OPACITY,
    },
    tagline: { color: colours.text, fontSize: TV_SIZES.textLg, fontStyle: 'italic' },
    summary: {
      color: colours.text,
      fontSize: TV_SIZES.textLg,
      lineHeight: TV_SIZES.textLg * LINE_RATIO,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TV_SIZES.space3,
      paddingVertical: TV_SIZES.space1,
    },
    action: {
      minHeight: TV_SIZES.controlLarge,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TV_SIZES.space2,
      paddingHorizontal: TV_SIZES.space4,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
    },
    actionLabel: { fontSize: TV_SIZES.textLg, fontWeight: 'bold' },
    focused: { borderColor: colours.text },
    section: { gap: TV_SIZES.space1 },
    heading: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    row: { gap: TV_SIZES.space5, paddingHorizontal: TV_GUTTER, paddingVertical: TV_SIZES.space4 },
    versions: { gap: TV_SIZES.space2, paddingTop: TV_SIZES.space2 },
    version: {
      alignSelf: 'flex-start',
      gap: TV_SIZES.space0,
      padding: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
      backgroundColor: colours.raised,
    },
    versionTitle: { color: colours.text, fontSize: TV_SIZES.textLg, fontWeight: '600' },
    person: { width: PERSON_WIDTH, alignItems: 'center', gap: TV_SIZES.space1 },
    photo: {
      width: PHOTO_SIZE,
      height: PHOTO_SIZE,
      borderRadius: PHOTO_SIZE / 2,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colours.raised,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
    focusedPhoto: { borderColor: colours.text },
    initials: { color: colours.muted, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    personName: {
      color: colours.muted,
      fontSize: TV_SIZES.text,
      fontWeight: '600',
      textAlign: 'center',
    },
    focusedName: { color: colours.text },
    personRole: { color: colours.muted, fontSize: TV_SIZES.textSm, textAlign: 'center' },
  }),
)
