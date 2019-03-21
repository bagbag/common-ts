export type CancelablePromiseResult<T> =
  | { canceled: true }
  | { canceled: false, value: T };

// tslint:disable-next-line: promise-function-async
export function cancelablePromise<T>(promise: Promise<T>, cancelationPromise: PromiseLike<void>): Promise<CancelablePromiseResult<T>> {
  return new Promise<CancelablePromiseResult<T>>((resolve, reject) => {
    let pending = true;

    const pendingResolve = (result: CancelablePromiseResult<T>) => {
      if (pending) {
        resolve(result);
        pending = false;
      }
    };

    const pendingReject = (reason: any) => {
      if (pending) {
        reject(reason);
        pending = false;
      }
    };

    promise
      .then((value) => pendingResolve({ canceled: false, value }))
      .catch(pendingReject);

    cancelationPromise
      .then(() => pendingResolve({ canceled: true }));
  });
}
