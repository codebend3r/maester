import type { ComponentType } from 'react'
import { Pressable, type PressableProps, type StyleProp, type TextStyle } from 'react-native'

import { ITEM_LAYOUT_COPY } from '@/layouts/copy'
import { Text } from '@/layouts/Text'
import { TitleArt } from '@/layouts/TitleArt'
import { ART_PLACES, type ItemHero } from '@/queries/itemPage'
import type { RouteTarget } from '@/routes'

/** Whether the words over the title are plain, or a press back to the show's page. */
const HOME_LOOKS = { words: 'words', link: 'link' } as const

type HomeLook = (typeof HOME_LOOKS)[keyof typeof HOME_LOOKS]

const homeLookOf = (hero: ItemHero): HomeLook =>
  hero.home === null ? HOME_LOOKS.words : HOME_LOOKS.link

type HeroHomeProps = {
  hero: ItemHero
  /** How wide the title art may run. */
  maxWidth: number
  /** How tall the title art stands. */
  logoHeight: number
  /** The eyebrow's type, which the art falls back to where it fails to load. */
  eyebrowStyle: StyleProp<TextStyle>
  /** The link's style, with its pressed or focused look, as each platform draws it. */
  linkStyle: PressableProps['style']
  onOpen: (target: RouteTarget) => void
}

type HeroHomeWordsProps = Pick<HeroHomeProps, 'hero' | 'maxWidth' | 'logoHeight' | 'eyebrowStyle'>

/** The show's title art over an episode's or a season's place, and the line under or in place of it. */
const HeroHomeWords = ({ hero, maxWidth, logoHeight, eyebrowStyle }: HeroHomeWordsProps) => (
  <>
    {hero.logo !== null && hero.logo.place === ART_PLACES.over && (
      <TitleArt
        height={logoHeight}
        logo={hero.logo.picture}
        maxWidth={maxWidth}
        name={hero.eyebrow ?? hero.title}
        textStyle={eyebrowStyle}
      />
    )}
    {hero.eyebrow !== null && <Text style={eyebrowStyle}>{hero.eyebrow}</Text>}
  </>
)

/** The same words as a press back to the show's page, said as "Back to Shrinking". */
const HeroHomeLink = ({ hero, linkStyle, onOpen, ...words }: HeroHomeProps) => {
  const { home } = hero
  return (
    home !== null && (
      <Pressable
        accessibilityLabel={ITEM_LAYOUT_COPY.backTo(home.name)}
        accessibilityRole="link"
        onPress={() => onOpen(home.target)}
        style={linkStyle}
      >
        <HeroHomeWords hero={hero} {...words} />
      </Pressable>
    )
  )
}

const HOME_VIEWS = {
  [HOME_LOOKS.words]: HeroHomeWords,
  [HOME_LOOKS.link]: HeroHomeLink,
} as const satisfies Record<HomeLook, ComponentType<HeroHomeProps>>

/**
 * What stands over an item page's title: the show's title art or name over an episode's or a
 * season's place, a link back to the show's page where the hero names one, plain words where
 * it does not (a show's or a film's own page). Each platform hands in its sizes and its link's
 * pressed or focused look.
 */
export const HeroHome = (props: HeroHomeProps) => {
  const View = HOME_VIEWS[homeLookOf(props.hero)]
  return <View {...props} />
}
