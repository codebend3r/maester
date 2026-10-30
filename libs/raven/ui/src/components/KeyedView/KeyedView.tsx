import type { ComponentType } from 'react'

/** The components of a keyed set of views, each taking its own props. */
export type ViewsOf<Props extends Record<keyof Props, object>> = {
  readonly [Key in keyof Props]: ComponentType<Props[Key]>
}

/**
 * One view of a keyed set: its key and the props its component takes. A builder generic over a
 * discriminated union's kind `K` returns `ViewOf<Map<K>, K>`, where `Map<Keys>` maps only
 * `Keys` to their props, so it pairs the kind with its own member without a cast; called with
 * the whole union, that is every kind's view.
 */
export type ViewOf<
  Props extends Record<keyof Props, object>,
  Keys extends keyof Props = keyof Props,
> = {
  [Key in Keys]: { key: Key; props: Props[Key] }
}[Keys]

type KeyedViewProps<Props extends Record<keyof Props, object>, Key extends keyof Props> = {
  views: ViewsOf<Props>
  view: { key: Key; props: Props[Key] }
}

/** Renders the component `views` holds under `view.key`, with the props that key takes. */
export const KeyedView = <
  Props extends Record<keyof Props, object>,
  Key extends keyof Props = keyof Props,
>({
  views,
  view,
}: KeyedViewProps<Props, Key>) => {
  const View: ComponentType<Props[Key]> = views[view.key]
  return <View {...view.props} />
}
