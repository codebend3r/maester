import { Bone, Loading, SkeletonCards, SkeletonPanel } from '@/components/Skeleton/Skeleton'
import { COMMON_COPY } from '@/lib/copy'
import { HOME_CONTINUE_COUNT } from '@/lib/homeContinue'
import { HOME_COPY } from '@/pages/HomePage/copy'
import frames from '@/pages/HomePage/HomeFrames.module.scss'
import styles from '@/pages/HomePage/HomeSkeleton.module.scss'

/** How many library rows stand in before home says which are pinned. */
const SHELF_COUNT = 2

/** The hero's shape: words at the left, a poster beside them. */
const HeroShape = () => (
  <div className={styles.hero}>
    <div className={styles.words}>
      <Bone shape="small" width="short" />
      <Bone shape="hero" width="most" />
      <Bone shape="text" width="most" />
      <Bone shape="text" width="half" />
      <Bone shape="button" />
    </div>
    <div className={styles.poster}>
      <Bone shape="poster" />
    </div>
  </div>
)

/** A tile in progress on its way, in the tile's own shape: its logo's line, its words and its progress. */
const ContinueTileShape = () => (
  <SkeletonPanel className={frames.tile}>
    <span className={styles.tileLogo}>
      <Bone shape="heading" />
    </span>
    <span className={styles.tileCopy}>
      <Bone shape="text" width="most" />
      <Bone shape="small" width="half" />
      <Bone shape="small" />
    </span>
  </SkeletonPanel>
)

type ContinueTileShapesProps = { count: number }

/** `count` tiles on their way, two across as the real ones are. */
export const ContinueTileShapes = ({ count }: ContinueTileShapesProps) => (
  <ul className={frames.tiles}>
    {Array.from({ length: count }, (_, index) => (
      <ContinueTileShape key={index} />
    ))}
  </ul>
)

/** Continue watching's heading over its tiles. */
const ContinueShape = () => (
  <section className={frames.section}>
    <Bone shape="heading" width="short" />
    <ContinueTileShapes count={HOME_CONTINUE_COUNT} />
  </section>
)

type ShelfShapesProps = { count: number }

/** Rows of cards, each under a line for its library's name. */
const ShelfShapes = ({ count }: ShelfShapesProps) =>
  Array.from({ length: count }, (_, index) => (
    <section key={index} className={frames.section}>
      <Bone shape="heading" width="short" />
      <ul className={frames.row}>
        <SkeletonCards picture="poster" count={8} />
      </ul>
    </section>
  ))

/** The hero, standing in while its titles are read. */
export const HeroSkeleton = () => (
  <Loading label={HOME_COPY.gatheringHero}>
    <HeroShape />
  </Loading>
)

/** What is being watched and each pinned library's row, standing in while home is read. */
export const ShelvesSkeleton = () => (
  <Loading label={HOME_COPY.gatheringLibraries}>
    <div className={frames.sections}>
      <ContinueShape />
      <ShelfShapes count={SHELF_COUNT} />
    </div>
  </Loading>
)

/** A row of cards standing in while a search from home is answered. */
export const SearchSkeleton = () => (
  <Loading label={HOME_COPY.searching}>
    <ShelfShapes count={1} />
  </Loading>
)

/**
 * The whole of home while its code is on its way: its title, the hero, the
 * tiles in progress and the libraries' rows, as the page lays them out.
 */
export const HomeSkeleton = () => (
  <Loading label={COMMON_COPY.loading}>
    <div className={frames.sections}>
      <Bone shape="hero" width="short" />
      <HeroShape />
      <ContinueShape />
      <ShelfShapes count={SHELF_COUNT} />
    </div>
  </Loading>
)
