type ElProps = {
  tag: keyof HTMLElementTagNameMap
  className?: string
  text?: string
  children?: readonly HTMLElement[]
}

/** One element with its class and its text or children, built without markup strings. */
export const el = ({ tag, className, text, children }: ElProps): HTMLElement => {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  if (children !== undefined) node.replaceChildren(...children)
  return node
}

type LinkProps = {
  href: string
  className?: string
  text?: string
  children?: readonly HTMLElement[]
}

export const link = ({ href, className, text, children }: LinkProps): HTMLAnchorElement => {
  const node = document.createElement('a')
  node.href = href
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  if (children !== undefined) node.replaceChildren(...children)
  return node
}

type ByIdProps = {
  id: string
}

export const byId = ({ id }: ByIdProps): HTMLElement | null => document.getElementById(id)
