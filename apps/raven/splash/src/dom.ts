type ElProps<Tag extends keyof HTMLElementTagNameMap> = {
  tag: Tag
  className?: string
  text?: string
  children?: readonly HTMLElement[]
}

/** One element with its class and its text or children, built without markup strings. */
export const el = <Tag extends keyof HTMLElementTagNameMap>({
  tag,
  className,
  text,
  children,
}: ElProps<Tag>): HTMLElementTagNameMap[Tag] => {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  if (children !== undefined) node.replaceChildren(...children)
  return node
}

type LinkProps = Omit<ElProps<'a'>, 'tag'> & { href: string }

export const link = ({ href, ...rest }: LinkProps): HTMLAnchorElement => {
  const node = el({ tag: 'a', ...rest })
  node.href = href
  return node
}
