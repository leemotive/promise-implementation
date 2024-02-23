// @ts-expect-error 没有类型的模块
import promisesAplusTests from 'promises-aplus-tests';
import MyPromise from '../src';

// @ts-expect-error 测试添加的属性
MyPromise.deferred = function deferred() {
  const result: any = {};

  result.promise = new MyPromise((resolve, reject) => {
    result.resolve = resolve;
    result.reject = reject;
  });
  return result;
};
promisesAplusTests(MyPromise, (err: any) => {
  // eslint-disable-next-line no-console
  console.log(err);
});
