export const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

export const range = (n: number) => new Array(n).fill(0).map((_: number, i: number) => i);

//as per: https://stackoverflow.com/questions/62116454/how-to-type-define-a-zip-function-in-typescript
export function zip<T extends unknown[][]>(...args: T): { [K in keyof T]: T[K] extends (infer V)[] ? V : never }[] {
    const minLength = Math.min(...args.map((arr) => arr.length));
    // @ts-expect-error This is too much for ts
    return range(minLength).map((i) => args.map((arr) => arr[i]));
}

export function setDifference<T>(A: Array<T>, B: Array<T>): Array<T> {
    const setA = new Set(A);
    const setB = new Set(B);
    const difference = new Set<T>(setA);
    for (const elem of setB) {
        difference.delete(elem);
    }
    return Array.from(difference);
}

export class Deferred {
    reject: Function = () => {};
    resolve: Function = () => {};
    public promise = new Promise((resolve, reject) => {
        this.reject = reject;
        this.resolve = resolve;
    });
}

export const fillArrayFromCallback = (length: number, callback: Function) => new Array(length).fill(0).map(callback());
