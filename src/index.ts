type AnyFunction<T = any> = (...args: any[]) => T;
interface PromiseExecutor<V, R> {
  (resolve: (value: V) => void, reject: (value: R) => void): void;
}
type PromiseStatus = 'pending' | 'fulfilled' | 'rejected';
interface PromiseHandler<T = any> {
  (v: T): any;
}

class MyPromise<V = any, R = any> {
  #onFulfilledCallbacks: AnyFunction[];

  #onRejectedCallbacks: AnyFunction[];

  #status!: PromiseStatus;

  #value!: V;

  #reason!: any;

  #resolve = (value?: V) => {
    if (this.#status === 'rejected') {
      return;
    }

    if (this.#status === 'pending') {
      this.#value = value!;
      this.#status = 'fulfilled';
    }

    const callbacks = this.#onFulfilledCallbacks.splice(0);
    callbacks.forEach(fn => queueMicrotask(() => fn(this.#value)));
  };

  #reject = (reason?: any) => {
    if (this.#status === 'fulfilled') {
      return;
    }
    if (this.#status === 'pending') {
      this.#reason = reason;
      this.#status = 'rejected';
    }

    const callbacks = this.#onRejectedCallbacks.splice(0);
    callbacks.forEach(fn => queueMicrotask(() => fn(this.#reason)));
  };

  constructor(executor: PromiseExecutor<V, R>) {
    this.#onFulfilledCallbacks = [];
    this.#onRejectedCallbacks = [];
    this.#status = 'pending';
    try {
      executor((value?: V) => innerResolver(this, this.#resolve, this.#reject, value), this.#reject);
    } catch (e) {
      this.#reject(e);
    }
  }

  then(onFulfilled?: PromiseHandler<V>, onRejected?: PromiseHandler) {
    const { promise, resolve, reject } = MyPromise.withResolvers();

    pushCallback(promise, this.#onFulfilledCallbacks, onFulfilled, resolve, reject, true);
    pushCallback(promise, this.#onRejectedCallbacks, onRejected, resolve, reject, false);

    if (this.#status === 'fulfilled') {
      this.#resolve();
    } else if (this.#status === 'rejected') {
      this.#reject();
    }

    return promise;
  }

  catch(onRejected?: PromiseHandler) {
    return this.then(undefined, onRejected);
  }

  finally(onFinally: () => any) {
    const p = this.then(onFinally, onFinally);
    const { promise, resolve, reject } = MyPromise.withResolvers();
    p.then(() => (this.#status === 'fulfilled' ? resolve(this.#value) : reject(this.#reason)), reject);
    return promise;
  }

  static resolve<S = any>(value?: S) {
    return new MyPromise<S>(resolve => {
      resolve(value!);
    });
  }

  static reject<J = any>(value?: J) {
    return new MyPromise<any, J>((resolve, reject) => {
      reject(value!);
    });
  }

  static withResolvers<E = any, N = any>() {
    let resolve!: (v: E) => void;
    let reject!: (r: N) => void;
    const promise = new MyPromise<E, N>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      promise,
      resolve,
      reject,
    };
  }

  static all(promises: unknown[] | Iterable<unknown>) {
    const { promise, resolve, reject } = MyPromise.withResolvers();
    const values: unknown[] = [];
    const iter = Array.from(promises);
    function setValue(value: unknown, index: number) {
      values[index] = value;
      if (Object.keys(values).length === iter.length) {
        resolve(values);
      }
    }

    iter.forEach((p, index) => {
      MyPromise.resolve(p).then(value => setValue(value, index), reject);
    });
    return promise;
  }

  static any(promises: unknown[] | Iterable<unknown>) {
    const { promise, resolve, reject } = MyPromise.withResolvers();
    const reasons: unknown[] = [];
    const iter = Array.from(promises);
    function setReason(value: unknown, index: number) {
      reasons[index] = value;
      if (Object.keys(reasons).length === iter.length) {
        reject(new AggregateError(reasons, 'All promises were rejected'));
      }
    }

    iter.forEach((p, index) => {
      MyPromise.resolve(p).then(resolve, reason => setReason(reason, index));
    });
    return promise;
  }

  static race(promises: unknown[] | Iterable<unknown>) {
    const { promise, resolve, reject } = MyPromise.withResolvers();
    const iter = Array.from(promises);

    iter.forEach(p => {
      MyPromise.resolve(p).then(resolve, reject);
    });
    return promise;
  }

  static allSettled(promises: unknown[] | Iterable<unknown>) {
    const { promise, resolve } = MyPromise.withResolvers();
    const iter = Array.from(promises);

    const results: unknown[] = [];
    function setValue(index: number, v: unknown) {
      results[index] = { status: 'fulfilled', value: v };
      resolveIfEnd();
    }
    function setReason(index: number, r: unknown) {
      results[index] = { status: 'rejected', reason: r };
      resolveIfEnd();
    }
    function resolveIfEnd() {
      if (Object.keys(results).length === iter.length) {
        resolve(results);
      }
    }

    iter.forEach((p, index) => {
      MyPromise.resolve(p).then(setValue.bind(null, index), setReason.bind(null, index));
    });
    return promise;
  }
}

function innerResolver(promise2: MyPromise, resolve: AnyFunction, reject: AnyFunction, x: any) {
  if (x === promise2) {
    reject(TypeError('can not resolve promise self'));
  } else if (x instanceof MyPromise) {
    x.then(
      y => queueMicrotask(() => innerResolver(promise2, resolve, reject, y)),
      r => reject(r),
    );
  } else if (x && ['object', 'function'].includes(typeof x)) {
    const race = getRace();
    try {
      const { then } = x;
      if (typeof then === 'function') {
        then.call(
          x,
          race(y => innerResolver(promise2, resolve, reject, y)),
          race(r => reject(r)),
        );
      } else {
        resolve(x);
      }
    } catch (e) {
      race(() => reject(e))();
    }
  } else {
    resolve(x);
  }
}

function getRace() {
  let called = false;
  return (fn: AnyFunction) =>
    function proxyFun(this: any, ...args: any[]) {
      if (called) {
        return undefined;
      }
      called = true;
      return fn.call(this, ...args);
    };
}

function pushCallback(
  p: MyPromise,
  callbackQueue: AnyFunction[],
  handler: AnyFunction | undefined,
  resolve: AnyFunction,
  reject: AnyFunction,
  sign: boolean,
) {
  if (typeof handler !== 'function') {
    // eslint-disable-next-line no-param-reassign
    handler = sign
      ? r => r
      : r => {
          throw r;
        };
  }

  callbackQueue.push(result => {
    let nextResult;
    try {
      nextResult = handler!(result);
    } catch (e) {
      reject(e);
    }
    innerResolver(p, resolve, reject, nextResult);
  });
}

export default MyPromise;
