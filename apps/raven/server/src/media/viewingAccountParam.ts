import {
  type ExecutionContext,
  Inject,
  Injectable,
  type PipeTransform,
  createParamDecorator,
} from '@nestjs/common'
import type { AccountKey } from '@/media/viewingAccountKeys'
import { ViewingAccounts } from '@/media/viewingAccounts'

const requestOf = createParamDecorator((_data: unknown, context: ExecutionContext): unknown =>
  context.switchToHttp().getRequest(),
)

/** Reads the viewing account off the request, as `ViewingAccounts.keyOf` does for every route. */
@Injectable()
class ViewingAccountOf implements PipeTransform<unknown, AccountKey> {
  constructor(@Inject(ViewingAccounts) private readonly accounts: ViewingAccounts) {}

  transform(request: unknown): AccountKey {
    if (typeof request !== 'object' || request === null) {
      throw new Error('The viewing account was asked for outside a request')
    }
    return this.accounts.keyOf({ request })
  }
}

/** The caller's viewing account, the only place per-viewer statements take `@account` from. */
export const ViewingAccount = (): ParameterDecorator => requestOf(ViewingAccountOf)
