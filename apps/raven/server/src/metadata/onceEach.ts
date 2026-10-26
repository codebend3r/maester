type OnceEachGetProps<T extends NonNullable<unknown>> = { key: string; make: () => T }

/** Makes each key's value once; later askers for the key share it, a promise included. */
export class OnceEach<T extends NonNullable<unknown>> {
  private readonly made = new Map<string, T>()

  get({ key, make }: OnceEachGetProps<T>): T {
    const known = this.made.get(key)
    if (known !== undefined) return known
    const value = make()
    this.made.set(key, value)
    return value
  }
}
