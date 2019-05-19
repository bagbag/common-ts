import { AnyIterable } from '../any-iterable-iterator';
import { AsyncComparator, quickSortInPlaceAsync } from '../sort';
import { toArrayAsync } from './to-array';

export async function sortAsync<T>(iterable: AnyIterable<T>, comparator?: AsyncComparator<T>): Promise<T[]> {
  const array = await toArrayAsync(iterable);

  // tslint:disable-next-line: no-floating-promises
  quickSortInPlaceAsync(array, comparator);

  return array;
}
