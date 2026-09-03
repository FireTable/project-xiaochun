declare module 'onnxruntime-web' {
  export class Tensor {
    constructor(type: string, data: ArrayBufferView, dims?: readonly number[]);
    readonly data: Float32Array | BigInt64Array | Int32Array | Uint8Array;
  }
  export class InferenceSession {
    static create(path: string, options?: object): Promise<InferenceSession>;
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  }
  export const env: {
    wasm: { wasmPaths: string; numThreads: number };
  };
}
