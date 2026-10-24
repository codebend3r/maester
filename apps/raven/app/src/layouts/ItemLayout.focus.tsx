import { type ReactNode, useState } from 'react'
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'

import { CARD_SHAPES, type ShelfCard } from '@/queries/cards'
import type { ItemHero, ItemPage, PersonCard, VersionRow } from '@/queries/itemPage'
import { CardPicture } from '@/layouts/Card'
import { FocusBand } from '@/layouts/FocusBand'
import { FOCUS_CARD_WIDTHS, FocusCard } from '@/layouts/FocusCard'
import { useScreenFocusScope } from '@/layouts/focus'
import { toneStyles } from '@/layouts/formStyles'
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
} from '@/layouts/itemKit'
import { LINE_RATIO } from '@/layouts/textHeights'
import { COLOURS, SIZES } from '@/theme/appTheme'

const GUTTER = SIZES.space8

/** The heading's picture in points on a 1920 by 1080 point screen: a poster, or a still. */
const HERO_WIDTHS = { [CARD_SHAPES.poster]: 280, [CARD_SHAPES.wide]: 480 } as const

/** How wide the words beside the picture run: about seventy characters at the TV's size. */
const WORDS_WIDTH = 1040

const PHOTO_SIZE = 120

/** A person's column: their photo, with room either side for a name under it. */
const PERSON_WIDTH = 176

/** The backdrop fills the screen's width at 16:9, dimmed so the words over it read. */
const BACKDROP_RATIO = 9 / 16
const BACKDROP_OPACITY = 0.3

type Opens = ItemLayoutProps['onOpen']

/** What every focusable part of the page tells it on focus, so the opening focus is let go. */
type Settles = { onSettle: () => void }

const Heading = ({ title }: { title: string }) => (
  <Text accessibilityRole="header" style={styles.heading}>
    {title}
  </Text>
)

/**
 * Play, filled as the one action the page is for, or a mark, ticked while it is on, ringed
 * while focused. `isPreferred` asks the remote's focus for it as the page opens.
 */
const ActionButton = ({
  action,
  isPreferred,
  onSettle,
}: Settles & { action: ItemAction; isPreferred: boolean }) => {
  const look = actionLookOf(action)
  return (
    <Pressable
      accessibilityLabel={action.label}
      accessibilityRole={look.role}
      accessibilityState={look.state}
      hasTVPreferredFocus={isPreferred}
      onFocus={onSettle}
      onPress={action.onPress}
      style={({ focused }) => [
        styles.action,
        toneStyles[look.tone].button,
        focused && styles.focused,
      ]}
    >
      <Text style={[styles.actionLabel, toneStyles[look.tone].label]}>{look.text}</Text>
    </Pressable>
  )
}

const ProgressLine = ({ progress }: { progress: NonNullable<ItemHero['progress']> }) => (
  <View style={styles.progress}>
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${progress.fraction * 100}%` }]} />
    </View>
    <Text style={styles.line}>{progress.label}</Text>
  </View>
)

/**
 * The heading over the backdrop: the picture beside the names, facts and summary, then the
 * actions in a row, the first taking the remote's focus while the page opens.
 */
const Hero = ({
  hero,
  actions,
  file,
  isOpening,
  onSettle,
}: Settles & {
  hero: ItemHero
  /** The actions, or null while what Play starts is still being read. */
  actions: ItemAction[] | null
  file: ItemPage['file']
  isOpening: boolean
}) => {
  const facts = heroFactsOf(hero)
  return (
    <View style={styles.hero}>
      <CardPicture card={heroPictureOf(hero)} width={HERO_WIDTHS[hero.poster.shape]} />
      <View style={styles.words}>
        {hero.eyebrow !== null && <Text style={styles.eyebrow}>{hero.eyebrow}</Text>}
        <Text accessibilityRole="header" style={styles.title}>
          {hero.title}
        </Text>
        {hero.byline !== null && <Text style={styles.byline}>{hero.byline}</Text>}
        {facts !== '' && <Text style={styles.line}>{facts}</Text>}
        {hero.progress !== null && <ProgressLine progress={hero.progress} />}
        {hero.tagline !== null && <Text style={styles.tagline}>{hero.tagline}</Text>}
        {hero.summary !== null && (
          <Text numberOfLines={4} style={styles.summary}>
            {hero.summary}
          </Text>
        )}
        {actions !== null && (
          <View style={styles.actions}>
            {actions.map((action, index) => (
              <ActionButton
                key={action.key}
                action={action}
                isPreferred={isOpening && index === 0}
                onSettle={onSettle}
              />
            ))}
          </View>
        )}
        {file.length > 0 && (
          <Text style={styles.line}>
            {dotted(file.map((fact) => `${fact.label} ${fact.value}`))}
          </Text>
        )}
      </View>
    </View>
  )
}

/** A titled row the remote moves along, scrolled as the focus moves. */
const Rail = ({ title, children }: { title: string; children: ReactNode }) => (
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

/** A row of cards the remote moves along, under its heading. */
const CardRow = ({
  title,
  cards,
  onOpen,
  onSettle,
}: Settles & { title: string; cards: ShelfCard[]; onOpen: Opens }) => (
  <Rail title={title}>
    {cards.map((card) => (
      <FocusCard
        key={card.key}
        card={card}
        isPreferred={false}
        onFocused={onSettle}
        onPress={() => onOpen(card.target)}
        width={FOCUS_CARD_WIDTHS[card.shape]}
      />
    ))}
  </Rail>
)

const Versions = ({
  versions,
  onOpen,
  onSettle,
}: Settles & { versions: VersionRow[]; onOpen: Opens }) => (
  <FocusBand>
    <View style={[styles.section, styles.padded]}>
      <Heading title={ITEM_HEADINGS.versions} />
      <View style={styles.versions}>
        {versions.map((version) => (
          <Pressable
            key={version.key}
            accessibilityLabel={playLabelOf(version.fileName)}
            accessibilityRole="button"
            onFocus={onSettle}
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

/** A person the remote can move to, so the row scrolls along with the focus. */
const Person = ({ person, onSettle }: Settles & { person: PersonCard }) => {
  const [isFocused, setFocused] = useState(false)
  return (
    // Deliberately inert until the app has a person page: it takes the focus only so the
    // remote can move along the row and scroll it.
    <Pressable
      accessibilityLabel={`${person.name}, ${person.role}`}
      accessibilityRole="text"
      focusable
      onBlur={() => setFocused(false)}
      onFocus={() => {
        setFocused(true)
        onSettle()
      }}
      style={styles.person}
    >
      <View style={[styles.photo, isFocused && styles.focusedPhoto]}>
        {person.picture !== null ? (
          <Image resizeMode="cover" source={person.picture} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={styles.initials}>{person.initials}</Text>
        )}
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
const ItemLayout = ({ page, actions, isPlayPending, onOpen }: ItemLayoutProps) => {
  const screen = useWindowDimensions()
  // Preferred focus is for the opening only: once anything here has had the focus, a button
  // that changes or mounts again leaves the viewer where they are.
  const { isOpening, settle } = useScreenFocusScope()
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
              isOpening={isOpening}
              onSettle={settle}
            />
          </View>
        </FocusBand>
        {/* The rows wait for the actions, so nothing below can take the opening focus from Play. */}
        {!isPlayPending && (
          <>
            {page.seasons.length > 0 && (
              <CardRow
                cards={page.seasons}
                onOpen={onOpen}
                onSettle={settle}
                title={ITEM_HEADINGS.seasons}
              />
            )}
            {page.episodes.length > 0 && (
              <CardRow
                cards={page.episodes}
                onOpen={onOpen}
                onSettle={settle}
                title={ITEM_HEADINGS.episodes}
              />
            )}
            {page.versions.length > 0 && (
              <Versions onOpen={onOpen} onSettle={settle} versions={page.versions} />
            )}
            {page.cast.length > 0 && (
              <Rail title={page.castTitle}>
                {page.cast.map((person) => (
                  <Person key={person.key} onSettle={settle} person={person} />
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
const ItemNotice = ({ notice }: ItemNoticeProps) => (
  <View style={[styles.ground, styles.notice]}>
    <Text style={styles.summary}>{notice}</Text>
  </View>
)

/** An item's page on a TV. */
export const focusItem: ItemKit = { ItemLayout, ItemNotice }

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, opacity: BACKDROP_OPACITY },
  scroll: { flex: 1 },
  page: { gap: SIZES.space5, paddingTop: SIZES.space6, paddingBottom: SIZES.space6 },
  padded: { paddingHorizontal: GUTTER },
  notice: { justifyContent: 'center', paddingHorizontal: GUTTER },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: SIZES.space6 },
  words: { flex: 1, maxWidth: WORDS_WIDTH, gap: SIZES.space2 },
  eyebrow: { color: COLOURS.muted, fontSize: SIZES.textLg, fontWeight: '600' },
  title: {
    color: COLOURS.text,
    fontSize: SIZES.textXl,
    lineHeight: SIZES.textXl * LINE_RATIO,
    fontWeight: 'bold',
  },
  byline: { color: COLOURS.text, fontSize: SIZES.textLg },
  line: { color: COLOURS.muted, fontSize: SIZES.text, lineHeight: SIZES.text * LINE_RATIO },
  progress: { gap: SIZES.space1, maxWidth: SIZES.measure },
  track: { height: SIZES.space1, borderRadius: SIZES.space0, backgroundColor: COLOURS.track },
  fill: { height: '100%', borderRadius: SIZES.space0, backgroundColor: COLOURS.accent },
  tagline: { color: COLOURS.text, fontSize: SIZES.textLg, fontStyle: 'italic' },
  summary: {
    color: COLOURS.text,
    fontSize: SIZES.textLg,
    lineHeight: SIZES.textLg * LINE_RATIO,
  },
  actions: { flexDirection: 'row', gap: SIZES.space3, paddingVertical: SIZES.space2 },
  action: {
    minHeight: SIZES.controlLarge,
    justifyContent: 'center',
    paddingHorizontal: SIZES.space4,
    borderRadius: SIZES.radius,
    borderWidth: SIZES.tvFocusRing,
  },
  actionLabel: { fontSize: SIZES.textLg, fontWeight: 'bold' },
  focused: { borderColor: COLOURS.text },
  section: { gap: SIZES.space1 },
  heading: { color: COLOURS.text, fontSize: SIZES.textXl, fontWeight: 'bold' },
  row: { gap: SIZES.space5, paddingHorizontal: GUTTER, paddingVertical: SIZES.space4 },
  versions: { gap: SIZES.space2, paddingTop: SIZES.space2 },
  version: {
    alignSelf: 'flex-start',
    gap: SIZES.space0,
    padding: SIZES.space3,
    borderRadius: SIZES.radius,
    borderWidth: SIZES.tvFocusRing,
    borderColor: 'transparent',
    backgroundColor: COLOURS.raised,
  },
  versionTitle: { color: COLOURS.text, fontSize: SIZES.textLg, fontWeight: '600' },
  person: { width: PERSON_WIDTH, alignItems: 'center', gap: SIZES.space1 },
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: PHOTO_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOURS.raised,
    borderWidth: SIZES.tvFocusRing,
    borderColor: 'transparent',
  },
  focusedPhoto: { borderColor: COLOURS.text },
  initials: { color: COLOURS.muted, fontSize: SIZES.textXl, fontWeight: 'bold' },
  personName: {
    color: COLOURS.muted,
    fontSize: SIZES.text,
    fontWeight: '600',
    textAlign: 'center',
  },
  focusedName: { color: COLOURS.text },
  personRole: { color: COLOURS.muted, fontSize: SIZES.textSm, textAlign: 'center' },
})
