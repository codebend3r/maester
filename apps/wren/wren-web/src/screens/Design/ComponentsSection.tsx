import { EQUALIZER_SIZES } from '@raven/ui'
import { useState } from 'react'
import { DESIGN_COPY, WREN_ICONS } from '@raven/wren'
import { DesignSection, Specimen } from '@/screens/Design/DesignSection'
import { SECTION_IDS } from '@/screens/Design/sections'
import { SIZES } from '@/theme/tokens'
import { AlbumArt } from '@/ui/AlbumArt/AlbumArt'
import { AlbumTile } from '@/ui/AlbumTile/AlbumTile'
import { ArtistAvatar } from '@/ui/ArtistAvatar/ArtistAvatar'
import { ArtistCard } from '@/ui/ArtistCard/ArtistCard'
import { BUTTON_SIZES, BUTTON_VARIANTS, Button } from '@/ui/Button/Button'
import { EmptyState } from '@/ui/EmptyState/EmptyState'
import { EqualizerIndicator } from '@/ui/EqualizerIndicator/EqualizerIndicator'
import { FilterChips } from '@/ui/FilterChips/FilterChips'
import { ICON_BUTTON_VARIANTS, IconButton } from '@/ui/IconButton/IconButton'
import { NAVIGATION_ROW_VARIANTS, NavigationRow } from '@/ui/NavigationRow/NavigationRow'
import { SectionHeader } from '@/ui/SectionHeader/SectionHeader'
import { SegmentedControl } from '@/ui/SegmentedControl/SegmentedControl'
import { Spinner } from '@/ui/Spinner/Spinner'
import { StatusChip } from '@/ui/StatusChip/StatusChip'
import { TextField } from '@/ui/TextField/TextField'
import { WrenIcon } from '@/ui/WrenIcon/WrenIcon'
import styles from '@/screens/Design/Design.module.scss'

const COPY = DESIGN_COPY.components
const SAMPLES = DESIGN_COPY.samples

/** A press that does nothing: the page shows how a piece looks, not what it does. */
const NOOP = (): void => undefined

/** The sample control's choices, by key. */
const SORTS = { title: 'title', artist: 'artist', year: 'year' } as const

type Sort = (typeof SORTS)[keyof typeof SORTS]

const SORT_CHOICES = [
  { key: SORTS.title, label: SAMPLES.choices.first },
  { key: SORTS.artist, label: SAMPLES.choices.second },
  { key: SORTS.year, label: SAMPLES.choices.third },
] as const

/** The sample chip row's choices, by key. */
const CHIPS = { all: 'all', albums: 'albums', songs: 'songs' } as const

type Chip = (typeof CHIPS)[keyof typeof CHIPS]

const CHIP_CHOICES = [
  { key: CHIPS.all, label: SAMPLES.chips.all },
  { key: CHIPS.albums, label: SAMPLES.chips.albums },
  { key: CHIPS.songs, label: SAMPLES.chips.songs },
] as const

function Buttons() {
  const copy = SAMPLES.buttons
  return (
    <div className={styles.row}>
      <Button label={copy.primary} onPress={NOOP} variant={BUTTON_VARIANTS.primary} />
      <Button label={copy.secondary} onPress={NOOP} variant={BUTTON_VARIANTS.secondary} />
      <Button label={copy.ghost} onPress={NOOP} variant={BUTTON_VARIANTS.ghost} />
      <Button
        icon={WREN_ICONS.playlistAdd}
        label={copy.icon}
        onPress={NOOP}
        variant={BUTTON_VARIANTS.secondary}
      />
      <Button label={copy.large} onPress={NOOP} size={BUTTON_SIZES.large} />
      <Button isLoading label={copy.loading} onPress={NOOP} />
      <Button isDisabled label={copy.disabled} onPress={NOOP} />
    </div>
  )
}

function IconButtons() {
  return (
    <div className={styles.row}>
      <IconButton
        icon={WREN_ICONS.heart}
        label={SAMPLES.iconButton.plain}
        onPress={NOOP}
        variant={ICON_BUTTON_VARIANTS.plain}
      />
      <IconButton
        icon={WREN_ICONS.play}
        label={SAMPLES.iconButton.filled}
        onPress={NOOP}
        variant={ICON_BUTTON_VARIANTS.filled}
      />
    </div>
  )
}

function Choices() {
  const [sort, setSort] = useState<Sort>(SORTS.title)
  const [chip, setChip] = useState<Chip>(CHIPS.all)
  return (
    <div className={styles.column}>
      <SegmentedControl
        choices={SORT_CHOICES}
        label={SAMPLES.choices.label}
        onSelect={setSort}
        selected={sort}
      />
      <FilterChips
        choices={CHIP_CHOICES}
        label={SAMPLES.chips.label}
        onSelect={setChip}
        selected={chip}
      />
    </div>
  )
}

function Fields() {
  const [plain, setPlain] = useState('')
  const [search, setSearch] = useState('')
  const [password, setPassword] = useState('')
  const copy = SAMPLES.fields
  return (
    <div className={styles.column}>
      <TextField label={copy.plain} onChangeText={setPlain} value={plain} />
      <TextField
        icon={WREN_ICONS.search}
        label={copy.withIcon}
        onChangeText={setSearch}
        value={search}
      />
      <TextField
        error={copy.error}
        label={copy.failed}
        onChangeText={setPassword}
        type="password"
        value={password}
      />
    </div>
  )
}

function Statuses() {
  return (
    <div className={styles.row}>
      <StatusChip isConnected name={SAMPLES.status.server} />
      <StatusChip isConnected={false} name={SAMPLES.status.server} />
    </div>
  )
}

function Motion() {
  return (
    <div className={styles.row}>
      <Spinner />
    </div>
  )
}

const SHOWN_SIZES = Object.values(EQUALIZER_SIZES)

function Equalizers() {
  return (
    <div className={styles.row}>
      {SHOWN_SIZES.map((size) => (
        <EqualizerIndicator isPlaying key={size} size={size} />
      ))}
    </div>
  )
}

function Rows() {
  const copy = SAMPLES.rows
  return (
    <div className={styles.column}>
      <SectionHeader seeAll={{ onPress: NOOP }} title={copy.section} />
      <NavigationRow
        icon={WREN_ICONS.library}
        label={copy.library}
        onPress={NOOP}
        variant={NAVIGATION_ROW_VARIANTS.library}
      />
      <NavigationRow
        label={copy.settings}
        onPress={NOOP}
        value={copy.value}
        variant={NAVIGATION_ROW_VARIANTS.settings}
      />
    </div>
  )
}

function Tiles() {
  const copy = SAMPLES.tiles
  return (
    <div className={styles.row}>
      <AlbumArt cover={null} size={SIZES.sheetArt} />
      <ArtistAvatar name={copy.artist} picture={null} />
      <div className={styles.tile}>
        <AlbumTile
          cover={null}
          label={copy.albumLabel}
          onPress={NOOP}
          subtitle={copy.artist}
          title={copy.album}
        />
      </div>
      <div className={styles.tile}>
        <ArtistCard
          albumCount={copy.albums}
          name={copy.artist}
          onPress={NOOP}
          picture={null}
          trackCount={copy.tracks}
        />
      </div>
    </div>
  )
}

function Empty() {
  const copy = SAMPLES.empty
  return (
    <EmptyState
      action={{ label: copy.action, onPress: NOOP }}
      body={copy.body}
      icon={WREN_ICONS.playlist}
      title={copy.title}
    />
  )
}

const ICON_SET = Object.entries(WREN_ICONS)

function IconSet() {
  return (
    <ul aria-label={COPY.icons} className={styles.icons}>
      {ICON_SET.map(([name, icon]) => (
        <li className={styles.icon} key={name}>
          <WrenIcon name={icon} size={SIZES.largeIcon} />
          <code className={styles.tokenName}>{name}</code>
        </li>
      ))}
    </ul>
  )
}

/** The kit's pieces, each in the states a page puts it in. */
export function ComponentsSection() {
  return (
    <DesignSection id={SECTION_IDS.components} intro={COPY.intro}>
      <Specimen name={COPY.buttons} note={COPY.buttonsNote}>
        <Buttons />
      </Specimen>
      <Specimen name={COPY.iconButtons} note={COPY.iconButtonsNote}>
        <IconButtons />
      </Specimen>
      <Specimen name={COPY.choices} note={COPY.choicesNote}>
        <Choices />
      </Specimen>
      <Specimen name={COPY.fields} note={COPY.fieldsNote}>
        <Fields />
      </Specimen>
      <Specimen name={COPY.status} note={COPY.statusNote}>
        <Statuses />
      </Specimen>
      <Specimen name={COPY.motion} note={COPY.motionNote}>
        <Motion />
      </Specimen>
      <Specimen name={COPY.equalizers} note={COPY.equalizersNote}>
        <Equalizers />
      </Specimen>
      <Specimen name={COPY.rows} note={COPY.rowsNote}>
        <Rows />
      </Specimen>
      <Specimen name={COPY.tiles} note={COPY.tilesNote}>
        <Tiles />
      </Specimen>
      <Specimen name={COPY.empty} note={COPY.emptyNote}>
        <Empty />
      </Specimen>
      <Specimen name={COPY.icons} note={COPY.iconsNote}>
        <IconSet />
      </Specimen>
    </DesignSection>
  )
}
