import { Inject, Injectable, type PipeTransform } from '@nestjs/common'
import type { LibraryRecord } from '@/libraries/librariesRepository'
import { LibraryViews } from '@/libraries/libraryViews'

/** The library a route's `:id` names, after `ParseIntPipe`, or a 404 when there is none. */
@Injectable()
export class LibraryById implements PipeTransform<number, LibraryRecord> {
  constructor(@Inject(LibraryViews) private readonly views: LibraryViews) {}

  transform(id: number): LibraryRecord {
    return this.views.find(id)
  }
}
