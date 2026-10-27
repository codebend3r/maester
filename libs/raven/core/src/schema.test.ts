import { describe, expect, it } from 'bun:test'
import {
  type Infer,
  exactPartial,
  isNumber,
  isString,
  keyOf,
  listOf,
  matching,
  nullable,
  object,
  oneOf,
  optional,
  union,
} from '@/schema'

describe('matching', () => {
  const isDigits = matching(/^\d+$/)

  it('takes a string the pattern matches, and nothing else', () => {
    expect(isDigits('603')).toBe(true)
    expect(isDigits('tv:603')).toBe(false)
    expect(isDigits(603)).toBe(false)
    expect(isDigits(null)).toBe(false)
  })
})

describe('oneOf', () => {
  const isSize = oneOf(['small', 'large', 3])

  it('takes exactly one of its values, and keeps them', () => {
    expect(isSize('small')).toBe(true)
    expect(isSize(3)).toBe(true)
    expect(isSize('medium')).toBe(false)
    expect(isSize('3')).toBe(false)
    expect(isSize.values).toEqual(['small', 'large', 3])
  })
})

describe('nullable and listOf', () => {
  it('lets null through, and checks every entry of a list', () => {
    expect(nullable(isString)(null)).toBe(true)
    expect(nullable(isString)(undefined)).toBe(false)
    expect(listOf(isNumber)([1, 2])).toBe(true)
    expect(listOf(isNumber)([1, '2'])).toBe(false)
    expect(listOf(isNumber)({ 0: 1 })).toBe(false)
  })
})

describe('optional', () => {
  it('lets a field be left out, but checks it when it is there', () => {
    const isTagged = object({ tag: optional(nullable(isString)) })
    expect(isTagged({})).toBe(true)
    expect(isTagged({ tag: null })).toBe(true)
    expect(isTagged({ tag: 'new' })).toBe(true)
    expect(isTagged({ tag: 4 })).toBe(false)
  })
})

describe('object', () => {
  const isPoint = object({ x: isNumber, y: isNumber })

  it('needs every field, and lets fields it does not know through', () => {
    expect(isPoint({ x: 1, y: 2 })).toBe(true)
    expect(isPoint({ x: 1, y: 2, label: 'a' })).toBe(true)
    expect(isPoint({ x: 1 })).toBe(false)
    expect(isPoint([1, 2])).toBe(false)
    expect(isPoint(null)).toBe(false)
  })

  it('keeps its shape, so another object can extend it', () => {
    const isNamedPoint = object({ ...isPoint.shape, name: isString })
    const point: Infer<typeof isNamedPoint> = { x: 1, y: 2, name: 'origin' }
    expect(isNamedPoint(point)).toBe(true)
    expect(isNamedPoint({ x: 1, y: 2 })).toBe(false)
  })
})

describe('union', () => {
  const isChoice = union(
    object({ source: oneOf(['tmdb']), ref: isString }),
    object({ source: oneOf(['local']) }),
  )

  it('takes whatever passes one of its guards', () => {
    expect(isChoice({ source: 'tmdb', ref: '/a.jpg' })).toBe(true)
    expect(isChoice({ source: 'local' })).toBe(true)
    expect(isChoice({ source: 'tmdb' })).toBe(false)
    expect(isChoice({ source: 'web' })).toBe(false)
  })
})

describe('keyOf and exactPartial', () => {
  const shape = { title: isString, year: nullable(isNumber) }

  it('names a field of the shape and nothing inherited', () => {
    expect(keyOf(shape)('title')).toBe(true)
    expect(keyOf(shape)('colour')).toBe(false)
    expect(keyOf(shape)('toString')).toBe(false)
  })

  it('takes some of the fields, each valid, and nothing else', () => {
    const isChange = exactPartial(shape)
    expect(isChange({})).toBe(true)
    expect(isChange({ year: null })).toBe(true)
    expect(isChange({ title: 'Heat', year: 1995 })).toBe(true)
    expect(isChange({ title: 7 })).toBe(false)
    expect(isChange({ title: 'Heat', colour: 'red' })).toBe(false)
    expect(isChange({ toString: 'x' })).toBe(false)
    expect(isChange('Heat')).toBe(false)
  })
})
