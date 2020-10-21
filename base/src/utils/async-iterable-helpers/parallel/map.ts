import type { AnyIterable } from '../../any-iterable-iterator';
import type { ParallelizableIteratorFunction } from '../types';
import { parallelFeed } from './feed';

export function parallelMap<TIn, TOut>(iterable: AnyIterable<TIn>, concurrency: number, keepOrder: boolean, mapper: ParallelizableIteratorFunction<TIn, TOut>): AsyncIterable<TOut> {
  return parallelFeed(iterable, concurrency, keepOrder, async (item, index, feed) => {
    const mapped = await mapper(item, index);
    feed(mapped, index);
  });
}
