/**
 * Guards built from smaller guards. Each API shape is written once, as a
 * guard, and its type is read off it with `Infer`, so a field added to one
 * cannot be missing from the other.
 */

/** Says whether an `unknown` is a `T`; what every network boundary narrows with. */
export type Guard<T> = (value: unknown) => value is T

/** The type a guard narrows to. */
export type Infer<G> = G extends Guard<infer T> ? T : never

/** An object's fields, each with the guard its value must pass. */
export type Shape = Record<string, Guard<unknown>>

/**
 * A guard for an object, with its shape kept so another can extend it:
 * `{ ...isA.shape, b }`. The object type is spelled out rather than named, so
 * an editor shows its fields instead of an alias.
 */
export type ObjectGuard<S extends Shape> = Guard<{ [K in keyof S]: Infer<S[K]> }> & {
  readonly shape: S
}

/** A guard for one of a fixed set of values, with the values kept for a menu or a loop. */
export type OneOfGuard<T extends readonly Literal[]> = Guard<T[number]> & {
  readonly values: Readonly<T>
}

type Literal = string | number | boolean

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isString = (value: unknown): value is string => typeof value === 'string'

export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

/** Exactly one of `values`; the union of them is the type. */
export const oneOf = <const T extends readonly Literal[]>(values: T): OneOfGuard<T> =>
  Object.assign((value: unknown): value is T[number] => values.some((known) => known === value), {
    values,
  })

export const nullable =
  <T>(guard: Guard<T>): Guard<T | null> =>
  (value): value is T | null =>
    value === null || guard(value)

/** A value `guard` accepts, or none at all: a field an older server does not send yet. */
export const optional =
  <T>(guard: Guard<T>): Guard<T | undefined> =>
  (value): value is T | undefined =>
    value === undefined || guard(value)

/** A list whose every entry passes `guard`. */
export const listOf =
  <T>(guard: Guard<T>): Guard<T[]> =>
  (value): value is T[] =>
    Array.isArray(value) && value.every(guard)

export const isStringArray = listOf(isString)

/** A string `pattern` matches: an id, a token or a name of a fixed form. `pattern` must not be global, which would keep a `lastIndex` between calls. */
export const matching =
  (pattern: RegExp): Guard<string> =>
  (value): value is string =>
    isString(value) && pattern.test(value)

/** Whatever passes any of `guards`. */
export const union =
  <const G extends readonly Guard<unknown>[]>(...guards: G): Guard<Infer<G[number]>> =>
  (value): value is Infer<G[number]> =>
    guards.some((guard) => guard(value))

/** An object with every field of `shape`; fields it does not know are let through. */
export const object = <S extends Shape>(shape: S): ObjectGuard<S> =>
  Object.assign(
    (value: unknown): value is { [K in keyof S]: Infer<S[K]> } =>
      isRecord(value) && Object.entries(shape).every(([key, guard]) => guard(value[key])),
    { shape },
  )

/** One of the field names of `shape`. */
export const keyOf =
  <S extends Shape>(shape: S): Guard<keyof S & string> =>
  (value): value is keyof S & string =>
    isString(value) && Object.hasOwn(shape, value)

/**
 * A change to an object of `shape`: any of its fields, each one valid, and
 * nothing it does not know. What a body that edits part of something is.
 */
export const exactPartial =
  <S extends Shape>(shape: S): Guard<{ [K in keyof S]?: Infer<S[K]> }> =>
  (value): value is { [K in keyof S]?: Infer<S[K]> } =>
    isRecord(value) &&
    Object.entries(value).every(([key, field]) => Object.hasOwn(shape, key) && shape[key](field))
