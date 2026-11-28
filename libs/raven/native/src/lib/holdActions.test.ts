import { describe, expect, it, mock } from 'bun:test'
import { holdActionPropsOf } from '@/lib/holdActions'

const LABEL = 'More about it'
const HINT = 'Hold for its menu'

type ActionNamed = { actionName: string }

const actionOf = ({ actionName }: ActionNamed) => ({ nativeEvent: { actionName } })

describe('holdActionPropsOf', () => {
  it('offers the long press by its label with its hint, and holds on that action alone', () => {
    const onHold = mock(() => undefined)
    const props = holdActionPropsOf({ label: LABEL, hint: HINT, onHold })

    expect(props.accessibilityActions).toEqual([{ name: 'longpress', label: LABEL }])
    expect(props.accessibilityHint).toBe(HINT)
    props.onAccessibilityAction?.(actionOf({ actionName: 'activate' }))
    expect(onHold).not.toHaveBeenCalled()
    props.onAccessibilityAction?.(actionOf({ actionName: 'longpress' }))
    expect(onHold).toHaveBeenCalledTimes(1)
  })

  it('offers nothing with nothing to hold', () => {
    expect(holdActionPropsOf({ label: LABEL, hint: HINT, onHold: undefined })).toEqual({})
  })
})
