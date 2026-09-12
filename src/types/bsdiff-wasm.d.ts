declare module 'bsdiff-wasm' {
  export interface BsdiffModule {
    FS: {
      mkdir(path: string): void;
      mount(fs: unknown, opts: { root: string }, path: string): void;
      chdir(path: string): void;
      writeFile(path: string, data: Uint8Array): void;
      readFile(path: string): Uint8Array;
      unlink(path: string): void;
      unmount(path: string): void;
    };
    NODEFS: unknown;
    callMain(args: string[]): number;
  }
  export interface LoadOptions {
    print?: (...args: unknown[]) => void;
    printErr?: (...args: unknown[]) => void;
  }
  export function loadBsdiff(opts?: LoadOptions): Promise<BsdiffModule>;
  export function loadBspatch(opts?: LoadOptions): Promise<BsdiffModule>;
}
