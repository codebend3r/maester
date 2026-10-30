import type { ComponentType } from 'react'
import styles from '@/components/RichText/RichText.module.scss'
import { SEGMENT_KINDS, type Segment, parseRichText } from '@/lib/richText'

type SegmentKind = Segment['kind']

type SegmentViewProps = { segment: Segment }

type PlainSegmentProps = SegmentViewProps

const PlainSegment = ({ segment }: PlainSegmentProps) => segment.text

type StrongSegmentProps = SegmentViewProps

const StrongSegment = ({ segment }: StrongSegmentProps) => (
  <strong className={styles.strong}>{segment.text}</strong>
)

type EmphasisSegmentProps = SegmentViewProps

const EmphasisSegment = ({ segment }: EmphasisSegmentProps) => (
  <em className={styles.emphasis}>{segment.text}</em>
)

type LinkSegmentProps = SegmentViewProps

const LinkSegment = ({ segment }: LinkSegmentProps) =>
  segment.kind === SEGMENT_KINDS.link && (
    <a className={styles.link} href={segment.href} target="_blank" rel="noopener noreferrer">
      {segment.text}
    </a>
  )

const SEGMENT_VIEWS = {
  [SEGMENT_KINDS.text]: PlainSegment,
  [SEGMENT_KINDS.strong]: StrongSegment,
  [SEGMENT_KINDS.emphasis]: EmphasisSegment,
  [SEGMENT_KINDS.link]: LinkSegment,
} as const satisfies Record<SegmentKind, ComponentType<SegmentViewProps>>

const SegmentView = ({ segment }: SegmentViewProps) => {
  const View = SEGMENT_VIEWS[segment.kind]
  return <View segment={segment} />
}

type RichTextProps = { text: string }

/** A reply's text with its links clickable, its bold bold and its italics italic. */
export const RichText = ({ text }: RichTextProps) =>
  parseRichText(text).map((segment, index) => (
    <SegmentView key={`${index}-${segment.text}`} segment={segment} />
  ))
