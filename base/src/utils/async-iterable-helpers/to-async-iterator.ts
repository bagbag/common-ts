import { AnyIterable, AnyIterator } from '../any-iterable-iterator';
import { isIterable } from '../iterable-helpers/is-iterable';
import { isAsyncIterable } from './is-async-iterable';

export function iterableToAsyncIterator<T>(iterable: AnyIterable<T>): AsyncIterator<T> {
  let asyncIterator: AsyncIterator<T>;

  if (isIterable(iterable)) {
    const iterator = iterable[Symbol.iterator]();
    asyncIterator = iteratorToAsyncIterator(iterator);
  }
  else if (isAsyncIterable(iterable)) {
    asyncIterator = iterable[Symbol.asyncIterator]();
  }
  else {
    throw new Error('parameter is neither iterable nor async-iterable');
  }

  return asyncIterator;
}

export function iteratorToAsyncIterator<T>(iterator: AnyIterator<T>): AsyncIterator<T> {
  const asyncIterator: AsyncIterator<T> = {
    next: async (value?: any) => iterator.next(value)
  };

  if (iterator.return != undefined) {
    // eslint-disable-next-line @typescript-eslint/promise-function-async, @typescript-eslint/no-non-null-assertion, @typescript-eslint/unbound-method
    asyncIterator.return = (value?: any) => ((value instanceof Promise) ? value : Promise.resolve(iterator.return!(value)));
  }

  if (iterator.throw != undefined) {
    // eslint-disable-next-line @typescript-eslint/promise-function-async, @typescript-eslint/no-non-null-assertion, @typescript-eslint/unbound-method
    asyncIterator.throw = (e?: any) => ((e instanceof Promise) ? e : Promise.resolve(iterator.throw!(e)));
  }

  return asyncIterator;
}
