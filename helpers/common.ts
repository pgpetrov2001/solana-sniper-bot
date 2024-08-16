export const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

export class Deferred {
	reject: Function = () => {};
	resolve: Function = () => {};
	public promise = new Promise((resolve, reject) => {
		this.reject = reject;
		this.resolve = resolve;
	});
}

export const fillArrayFromCallback = (length: number, callback: Function) => new Array(length).fill(0).map(callback());
