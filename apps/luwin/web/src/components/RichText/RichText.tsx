import styles from '@/components/RichText/RichText.module.scss'
import { SEGMENT_KINDS, type Segment, parseRichText } from '@/lib/richText'

const SegmentView = ({ segment }: { segment: Segment }) => {
  switch (segment.kind) {
    case SEGMENT_KINDS.text:
      return segment.text
    case SEGMENT_KINDS.strong:
      return <strong className={styles.strong}>{segment.text}</strong>
    case SEGMENT_KINDS.link:
      return (
        <a className={styles.link} href={segment.href} target="_blank" rel="noopener noreferrer">
          {segment.text}
        </a>
      )
    default: {
      const unknown: never = segment
      return unknown
    }
  }
}

/** A reply's text with its links clickable and its bold bold; the rest as written. */
export const RichText = ({ text }: { text: string }) =>
  parseRichText(text).map((segment, index) => (
    <SegmentView key={`${index}-${segment.text}`} segment={segment} />
  ))
