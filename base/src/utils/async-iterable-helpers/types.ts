export { Context } from '../iterable-helpers/types';

export type AsyncIteratorFunction<TIn, TOut> = (item: TIn, index: number) => TOut | Promise<TOut>;
export type AsyncPredicate<T> = AsyncIteratorFunction<T, boolean>;
export type AsyncRetryPredicate<T> = (error: Error, item: T, index: number) => boolean | Promise<boolean>;
export type AsyncComparator<T> = (a: T, b: T) => number | Promise<number>;
export type AsyncReducer<T, U> = (previous: U, current: T, index: number) => U | Promise<U>;

export type ParallelizableIteratorFunction<TIn, TOut> = (item: TIn, index: number) => Promise<TOut>;
export type ParallelizablePredicate<T> = ParallelizableIteratorFunction<T, boolean>;

export type ThrottleFunction = () => Promise<void>;
