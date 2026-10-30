import { jest } from '@jest/globals'
import { ActionSheetIOS } from 'react-native'

type AnswerSheetProps = { answer: string }

/** Answers every action sheet the screen opens with `answer`, and keeps what each offered. */
export const answerSheet = ({ answer }: AnswerSheetProps): string[][] => {
  const offered: string[][] = []
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, done) => {
    offered.push(options.options)
    done(options.options.indexOf(answer))
  })
  return offered
}
