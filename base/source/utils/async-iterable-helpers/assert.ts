import type { AnyIterable } from '../any-iterable-iterator';
import { assert as assertHelper } from '../type-guards';
import { isAsyncIterable } from './is-async-iterable';
import type { AsyncPredicate } from './types';

export function assertAsync<T, TPredicate extends T = T>(iterable: AnyIterable<T>, predicate: AsyncPredicate<T>): AsyncIterableIterator<TPredicate> {
  return isAsyncIterable(iterable)
    ? async(iterable, predicate)
    : sync(iterable, predicate);
}

async function* sync<T, TPredicate extends T = T>(iterable: Iterable<T>, predicate: AsyncPredicate<T>): AsyncIterableIterator<TPredicate> {
  let index = 0;

  for (const item of iterable) {
    let returnValue = predicate(item, index++);

    if (returnValue instanceof Promise) {
      returnValue = await returnValue;
    }

    assertHelper(returnValue);
    yield item as TPredicate;
  }
}

async function* async<T, TPredicate extends T = T>(iterable: AsyncIterable<T>, predicate: AsyncPredicate<T>): AsyncIterableIterator<TPredicate> {
  let index = 0;

  for await (const item of iterable) {
    let returnValue = predicate(item, index++);

    if (returnValue instanceof Promise) {
      returnValue = await returnValue;
    }

    assertHelper(returnValue);
    yield item as TPredicate;
  }
}
