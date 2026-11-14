/**
 * Guards built from smaller guards. Each API shape is written once, as a
 * guard, and its type is read off it with `Infer`, so a field added to one
 * cannot be missing from the other.
 */

import { isRecord } from '@shared/http'

/** Says whether an `unknown` is a `T`; what every network boundary narrows with. */
export type Guard<T> = (value: unknown) => value is T

/** The type a guard narrows to. */
export type Infer<G> = G extends Guard<infer T> ? T : never

/** An object's fields, each with the guard its value must pass. */
export type Shape = Record<string, Guard<unknown>>

/** A guard `optional` made: its field may be left out of the object altogether. */
export type OptionalGuard<T> = Guard<T | undefined> & { readonly isOptional: true }

/** The fields of `S` an `optional` guard checks. */
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends { readonly isOptional: true } ? K : never
}[keyof S]

/** An intersection as one object type, so an editor shows its fields instead of an alias. */
type Flatten<T> = { [K in keyof T]: T[K] } & {}

/** The object a shape describes: a field of an `optional` guard may be missing, every other is there. */
export type ObjectOf<S extends Shape> = Flatten<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    [K in OptionalKeys<S>]?: Infer<S[K]>
  }
>

/**
 * A guard for an object, with its shape kept so another can extend it:
 * `{ ...isA.shape, b }`.
 */
export type ObjectGuard<S extends Shape> = Guard<ObjectOf<S>> & {
  readonly shape: S
}

/** A guard for one of a fixed set of values, with the values kept for a menu or a loop. */
export type OneOfGuard<T extends readonly Literal[]> = Guard<T[number]> & {
  readonly values: Readonly<T>
}

type Literal = string | number | boolean

export { isRecord }

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

/** Exactly `value`: the tag of one variant of a union. */
export const literal = <const T extends Literal>(value: T): OneOfGuard<readonly [T]> =>
  oneOf([value])

/** A value `guard` accepts, or none at all: a field an older server does not send yet. */
export const optional = <T>(guard: Guard<T>): OptionalGuard<T> =>
  Object.assign((value: unknown): value is T | undefined => value === undefined || guard(value), {
    isOptional: true as const,
  })

type WholeNumberInProps = {
  min: number
  /** Left out, any whole number a double holds exactly. */
  max?: number
}

/** A whole number from `min` to `max`, both included, that a double holds exactly. */
export const wholeNumberIn =
  ({ min, max = Number.MAX_SAFE_INTEGER }: WholeNumberInProps): Guard<number> =>
  (value): value is number =>
    isNumber(value) && Number.isSafeInteger(value) && value >= min && value <= max

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
    (value: unknown): value is ObjectOf<S> =>
      isRecord(value) && Object.entries(shape).every(([key, guard]) => guard(value[key])),
    { shape },
  )

/** Each variant's own fields, by the value its tag takes. */
type Variants = Record<string, Shape>

/** The union `tagged` checks: each variant's fields, with `D` set to its key. */
type TaggedOf<D extends string, V extends Variants> = {
  [K in keyof V & string]: Flatten<{ [P in D]: K } & ObjectOf<V[K]>>
}[keyof V & string]

type TaggedProps<D extends string, V extends Variants> = { tag: D; variants: V }

/**
 * A discriminated union written as a map from each tag to its variant's fields:
 * `tagged({ tag: 'type', variants: { [KINDS.a]: { id: isNumber }, [KINDS.b]: {} } })`. A value
 * passes when its `tag` names a variant and it has that variant's fields.
 */
export const tagged =
  <const D extends string, const V extends Variants>({
    tag,
    variants,
  }: TaggedProps<D, V>): Guard<TaggedOf<D, V>> =>
  (value: unknown): value is TaggedOf<D, V> => {
    if (!isRecord(value)) return false
    const kind = value[tag]
    if (!isString(kind) || !Object.hasOwn(variants, kind)) return false
    return Object.entries(variants[kind] ?? {}).every(([key, guard]) => guard(value[key]))
  }

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
