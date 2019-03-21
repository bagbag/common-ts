import { AnyIterable } from '../any-iterable-iterator';
import { isAsyncIterable } from './is-async-iterable';
import { AsyncReducer } from './types';

export function reduceAsync<T>(iterable: AnyIterable<T>, reducer: AsyncReducer<T, T>): Promise<T>;
export function reduceAsync<T, U>(iterable: AnyIterable<T>, reducer: AsyncReducer<T, U>, initialValue?: U): Promise<U>;
export function reduceAsync<T, U>(iterable: AnyIterable<T>, reducer: AsyncReducer<T, U>, initialValue?: U): Promise<U> { // tslint:disable-line: promise-function-async
  if (isAsyncIterable(iterable)) {
    return asyncReduce(iterable, reducer, initialValue);
  } else {
    return syncReduce(iterable, reducer, initialValue);
  }
}

async function syncReduce<T, U>(iterable: Iterable<T>, reducer: AsyncReducer<T, U>, initialValue?: U): Promise<U> {
  let accumulator: T | U | undefined = initialValue;
  let index = 0;

  for (const currentValue of iterable) {
    if (accumulator == undefined) {
      accumulator = currentValue;
    }
    else {
      const returnValue = reducer(accumulator as U, currentValue, index++);

      if (returnValue instanceof Promise) {
        accumulator = await returnValue;
      } else {
        accumulator = returnValue;
      }
    }
  }

  return accumulator as U;
}

async function asyncReduce<T, U>(iterable: AnyIterable<T>, reducer: AsyncReducer<T, U>, initialValue?: U): Promise<U> {
  let accumulator: T | U | undefined = initialValue;
  let index = 0;

  for await (const currentValue of iterable) {
    if (accumulator == undefined) {
      accumulator = currentValue;
    }
    else {
      const returnValue = reducer(accumulator as U, currentValue, index++);
      if (returnValue instanceof Promise) {
        accumulator = await returnValue;
      }
      else {
        accumulator = returnValue;
      }
    }
  }
  return accumulator as U;
}
