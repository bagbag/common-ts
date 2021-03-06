import type { AnyIterable } from '../any-iterable-iterator';
import { isAsyncIterable } from './is-async-iterable';
import type { AsyncIteratorFunction } from './types';

export async function groupToSingleMapAsync<TIn, TGroup>(iterable: AnyIterable<TIn>, selector: AsyncIteratorFunction<TIn, TGroup>): Promise<Map<TGroup, TIn>> {
  return isAsyncIterable(iterable)
    ? async(iterable, selector)
    : sync(iterable, selector);
}

async function async<TIn, TGroup>(iterable: AsyncIterable<TIn>, selector: AsyncIteratorFunction<TIn, TGroup>): Promise<Map<TGroup, TIn>> {
  const map = new Map<TGroup, TIn>();

  let index = 0;
  for await (const item of iterable) {
    const groupKey = await selector(item, index++);

    if (map.has(groupKey)) {
      throw new Error('group has more than one items');
    }

    map.set(groupKey, item);
  }

  return map;
}

async function sync<TIn, TGroup>(iterable: Iterable<TIn>, selector: AsyncIteratorFunction<TIn, TGroup>): Promise<Map<TGroup, TIn>> {
  const map = new Map<TGroup, TIn>();

  let index = 0;
  for (const item of iterable) {
    const groupKey = await selector(item, index++);

    if (map.has(groupKey)) {
      throw new Error('group has more than one items');
    }

    map.set(groupKey, item);
  }

  return map;
}
