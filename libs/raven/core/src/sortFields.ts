import {
  type MediaSort,
  SORT_DIRECTIONS,
  SORT_FIELDS,
  SORT_FIELD_NAMES,
  SORT_FIELD_TYPES,
  type SortDirection,
  type SortFieldName,
  fieldSorts,
  isSortFieldName,
} from '@/contract'

/** A field's entry in `SORT_FIELDS`: its sort each way and the way it starts, or its one sort. */
export type SortField = (typeof SORT_FIELDS)[SortFieldName]

/** The fields that run either way, which every field but Random does. */
export type DirectedSortFieldName = {
  [Name in SortFieldName]: (typeof SORT_FIELDS)[Name] extends {
    type: typeof SORT_FIELD_TYPES.directed
  }
    ? Name
    : never
}[SortFieldName]

/** A sort as its field and the way it runs; a field with no way to it, as Random, has none. */
export type SortParts =
  | { field: DirectedSortFieldName; direction: SortDirection }
  | { field: Exclude<SortFieldName, DirectedSortFieldName>; direction: null }

const isDirected = (name: SortFieldName): name is DirectedSortFieldName =>
  SORT_FIELDS[name].type === SORT_FIELD_TYPES.directed

/** A sort as its field, and its direction when the field has one. */
export const sortParts = (sort: MediaSort): SortParts => {
  const field =
    isSortFieldName.values.find((name) => fieldSorts(name).includes(sort)) ?? SORT_FIELD_NAMES.title
  if (!isDirected(field)) return { field, direction: null }
  return {
    field,
    direction:
      SORT_FIELDS[field].ascending === sort
        ? SORT_DIRECTIONS.ascending
        : SORT_DIRECTIONS.descending,
  }
}

type SortOfProps = {
  field: SortFieldName
  direction: SortDirection
}

/** The sort for a field run one way; a field with no direction has the one. */
export const sortOf = ({ field, direction }: SortOfProps): MediaSort => {
  const rule: SortField = SORT_FIELDS[field]
  return rule.type === SORT_FIELD_TYPES.directed ? rule[direction] : rule.sort
}

/** A field as a library first sorts on it: in the direction it starts in. */
export const startingSort = (field: SortFieldName): MediaSort => {
  const rule: SortField = SORT_FIELDS[field]
  return rule.type === SORT_FIELD_TYPES.directed ? rule[rule.start] : rule.sort
}

const REVERSED_DIRECTIONS = {
  ascending: SORT_DIRECTIONS.descending,
  descending: SORT_DIRECTIONS.ascending,
} as const satisfies Record<SortDirection, SortDirection>

/** The other way a field runs. */
export const reversedDirection = (direction: SortDirection): SortDirection =>
  REVERSED_DIRECTIONS[direction]

/** The same field run the other way; a sort whose field has no direction stays as it is. */
export const reversedSort = (sort: MediaSort): MediaSort => {
  const { field, direction } = sortParts(sort)
  return direction === null ? sort : sortOf({ field, direction: reversedDirection(direction) })
}
