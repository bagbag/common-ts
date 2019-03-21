import {
  anyAsync, AsyncIteratorFunction, AsyncPredicate, AsyncReducer, AsyncRetryPredicate, batchAsync, bufferAsync, drain,
  filterAsync, forEachAsync, interceptAsync, interruptEveryAsync, interruptPerSecondAsync, isAsyncIterableIterator, isIterable,
  iterableToAsyncIterator, mapAsync, mapManyAsync, multiplex, ParallelizableIteratorFunction, ParallelizablePredicate, range,
  reduceAsync, singleAsync, throttle, ThrottleFunction, toArrayAsync, toAsyncIterableIterator, toSync, whileAsync
} from '../utils';
import { AnyIterable } from '../utils/any-iterable-iterator';
import { groupAsync } from '../utils/async-iterable-helpers/group';
import { parallelFilter, parallelForEach, parallelGroup, parallelIntercept, parallelMap } from '../utils/async-iterable-helpers/parallel';
import { retryAsync } from '../utils/async-iterable-helpers/retry';
import { SyncEnumerable } from './sync-enumerable';

export class AsyncEnumerable<T> implements AsyncIterableIterator<T>  {
  private readonly source: AnyIterable<T>;
  private asyncIterator?: AsyncIterator<T>;

  static from<T>(iterable: AnyIterable<T>): AsyncEnumerable<T> {
    return new AsyncEnumerable(iterable);
  }

  static fromRange(fromInclusive: number, toInclusive: number): AsyncEnumerable<number> {
    const rangeIterable = range(fromInclusive, toInclusive);
    return new AsyncEnumerable(rangeIterable);
  }

  constructor(iterable: AnyIterable<T>) {
    this.source = iterable;
  }

  cast<TNew extends T>(): AsyncEnumerable<TNew> {
    return this as AsyncEnumerable<any> as AsyncEnumerable<TNew>;
  }

  forceCast<TNew>(): AsyncEnumerable<TNew> {
    return this as AsyncEnumerable<any> as AsyncEnumerable<TNew>;
  }

  while(predicate: AsyncPredicate<T>): AsyncEnumerable<T> {
    const whiled = whileAsync(this.source, predicate);
    return new AsyncEnumerable(whiled);
  }

  filter(predicate: AsyncPredicate<T>): AsyncEnumerable<T> {
    const filtered = filterAsync(this.source, predicate);
    return new AsyncEnumerable(filtered);
  }

  map<TOut>(mapper: AsyncIteratorFunction<T, TOut>): AsyncEnumerable<TOut> {
    const result = mapAsync(this.source, mapper);
    return new AsyncEnumerable(result);
  }

  reduce(reducer: AsyncReducer<T, T>): Promise<T>;
  reduce<U>(reducer: AsyncReducer<T, U>, initialValue: U): Promise<U>;
  async reduce<U>(reducer: AsyncReducer<T, U>, initialValue?: U): Promise<U> {
    const result = await reduceAsync(this.source, reducer, initialValue);
    return result;
  }

  retry(throwOnRetryFalse: boolean, predicate: AsyncRetryPredicate<T>): AsyncEnumerable<T> {
    const result = retryAsync(this.source, throwOnRetryFalse, predicate);
    return new AsyncEnumerable(result);
  }

  single(): Promise<T>;
  single(predicate: AsyncPredicate<T>): Promise<T>;
  single(predicate?: AsyncPredicate<T>): Promise<T>;
  async single(predicate?: AsyncPredicate<T>): Promise<T> {
    const result = await singleAsync(this.source, predicate);
    return result;
  }

  batch(size: number): AsyncEnumerable<T[]> {
    const result = batchAsync(this.source, size);
    return new AsyncEnumerable(result);
  }

  buffer(size: number): AsyncEnumerable<T> {
    const result = bufferAsync(this.source, size);
    return new AsyncEnumerable(result);
  }

  async any(predicate: AsyncPredicate<T>): Promise<boolean> {
    const result = await anyAsync(this.source, predicate);
    return result;
  }

  mapMany<TOut>(mapper: AsyncIteratorFunction<T, AnyIterable<TOut>>): AsyncEnumerable<TOut> {
    const result = mapManyAsync(this.source, mapper);
    return new AsyncEnumerable(result);
  }

  intercept(func: AsyncIteratorFunction<T, void>): AsyncEnumerable<T> {
    const iterator = interceptAsync(this.source, func);
    return new AsyncEnumerable(iterator);
  }

  throttle(delayOrThrottleFunction: number | ThrottleFunction): AsyncEnumerable<T> {
    const result = throttle(this.source, delayOrThrottleFunction);
    return new AsyncEnumerable(result);
  }

  async group<TGroup>(selector: AsyncIteratorFunction<T, TGroup>): Promise<Map<TGroup, T[]>> {
    const grouped = await groupAsync<T, TGroup>(this.source, selector);
    return grouped;
  }

  async toSync(): Promise<SyncEnumerable<T>> {
    const syncIterable = await toSync(this.source);
    return new SyncEnumerable(syncIterable);
  }

  async toArray(): Promise<T[]> {
    const array = await toArrayAsync(this.source);
    return array;
  }

  async forEach(func: AsyncIteratorFunction<T, any>): Promise<void> {
    await forEachAsync(this.source, func);
  }

  async drain(): Promise<void> {
    await drain(this.source);
  }

  multiplex(count: number, bufferSize: number = 0): AsyncEnumerable<T>[] {
    const iterables = multiplex(this.source, count, bufferSize);
    const enumerables = iterables.map((iterable) => new AsyncEnumerable(iterable));

    return enumerables;
  }

  async parallelForEach(concurrency: number, func: ParallelizableIteratorFunction<T, any>): Promise<void> {
    await parallelForEach(this.source, concurrency, func);
  }

  parallelFilter(concurrency: number, keepOrder: boolean, predicate: ParallelizablePredicate<T>): AsyncEnumerable<T> {
    const result = parallelFilter(this.source, concurrency, keepOrder, predicate);
    return new AsyncEnumerable(result);
  }

  parallelMap<TOut>(concurrency: number, keepOrder: boolean, func: ParallelizableIteratorFunction<T, TOut>): AsyncEnumerable<TOut> {
    const result = parallelMap(this.source, concurrency, keepOrder, func);
    return new AsyncEnumerable(result);
  }

  parallelIntercept(concurrency: number, keepOrder: boolean, func: ParallelizableIteratorFunction<T, void>): AsyncEnumerable<T> {
    const result = parallelIntercept(this.source, concurrency, keepOrder, func);
    return new AsyncEnumerable(result);
  }

  async parallelGroup<TGroup>(concurrency: number, selector: ParallelizableIteratorFunction<T, TGroup>): Promise<Map<TGroup, T[]>> {
    const grouped = await parallelGroup(this.source, concurrency, selector);
    return grouped;
  }

  interruptEvery(value: number): AsyncEnumerable<T> {
    const interrupted = interruptEveryAsync(this.source, value);
    return new AsyncEnumerable(interrupted);
  }

  interruptPerSecond(value: number): AsyncEnumerable<T> {
    const interrupted = interruptPerSecondAsync(this.source, value);
    return new AsyncEnumerable(interrupted);
  }

  toAsync(): AsyncEnumerable<T> {
    return this;
  }

  toIterator(): AsyncIterator<T> {
    const iterator = iterableToAsyncIterator(this.source);
    return iterator;
  }

  async next(value?: any): Promise<IteratorResult<T>> {
    if (this.asyncIterator == undefined) {
      this.asyncIterator = this.toIterator();
    }

    const result = await this.asyncIterator.next(value);
    return result;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (isAsyncIterableIterator(this.source)) {
      return this.source[Symbol.asyncIterator]();
    }

    if (isIterable(this.source)) {
      return toAsyncIterableIterator(this.source);
    }

    throw new Error('source is neither iterable nor async-iterable');
  }
}
