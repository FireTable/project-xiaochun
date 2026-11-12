/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { OPFSStore, type OPFSAccessMode } from "./opfs_store";
import { getWebGPUFramePacing } from "./webgpu";

export type { OPFSAccessMode } from "./opfs_store";

export const CANONICAL_HF_ORIGIN = "https://huggingface.co";
export const DEFAULT_HF_MIRROR_ORIGIN = "https://hf-mirror.com";
export const CANONICAL_MLC_WASM_PREFIX =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main";
export const DEFAULT_MLC_WASM_MIRROR_PREFIXES: readonly string[] = Object.freeze([
  "https://testingcf.jsdelivr.net/gh/mlc-ai/binary-mlc-llm-libs@main",
  "https://cdn.jsdelivr.net/gh/mlc-ai/binary-mlc-llm-libs@main",
  "https://fastly.jsdelivr.net/gh/mlc-ai/binary-mlc-llm-libs@main",
  "https://ghfast.top/https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main",
]);

export interface ArtifactMirrorConfig {
  /**
   * Ordered Hugging Face origins to try for outbound network requests, e.g.
   * `["https://hf-mirror.com", "https://huggingface.co"]`.
   * Local Cache/IDB/OPFS keys always normalize back to `https://huggingface.co`.
   */
  hfOrigins?: string[];
  /**
   * Ordered prefix mirrors for prebuilt `mlc-ai/binary-mlc-llm-libs` `.wasm` files.
   * Local Cache/IDB/OPFS keys always normalize back to `CANONICAL_MLC_WASM_PREFIX`.
   */
  wasmLibPrefixes?: string[];
  /**
   * Enable concurrent HTTP `Range` chunked fetching for giant weight shards.
   * When omitted, enabled automatically on desktop (`maxParallelShardDownloads > 2`)
   * and disabled on mobile to keep transient RAM usage low.
   */
  enableParallelRange?: boolean;
  /** Minimum shard byte size to use parallel HTTP `Range` slicing (default: 48 MiB). */
  parallelRangeMinBytes?: number;
  /** Number of concurrent HTTP `Range` slices per giant shard (default: 4). */
  parallelRangeConnections?: number;
}

const MIRROR_GLOBAL_KEY = "__xcArtifactMirrorConfig";

function trimTrailingSlashes(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function dedupeStrings(items: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const cleaned = trimTrailingSlashes(raw);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

export function getArtifactMirrorConfig(): Readonly<ArtifactMirrorConfig> {
  const g = globalThis as Record<string, unknown>;
  const existing = g[MIRROR_GLOBAL_KEY] as ArtifactMirrorConfig | undefined;
  return existing ?? {};
}

export function setArtifactMirrorConfig(
  update: ArtifactMirrorConfig | null | undefined,
): Readonly<ArtifactMirrorConfig> {
  const g = globalThis as Record<string, unknown>;
  if (!update) {
    const empty = Object.freeze({});
    g[MIRROR_GLOBAL_KEY] = empty;
    return empty;
  }
  const normalized: ArtifactMirrorConfig = {};
  if (update.hfOrigins !== undefined) {
    normalized.hfOrigins = dedupeStrings(update.hfOrigins);
  }
  if (update.wasmLibPrefixes !== undefined) {
    normalized.wasmLibPrefixes = dedupeStrings(update.wasmLibPrefixes);
  }
  if (update.enableParallelRange !== undefined) {
    normalized.enableParallelRange = Boolean(update.enableParallelRange);
  }
  if (update.parallelRangeMinBytes !== undefined) {
    normalized.parallelRangeMinBytes = Math.max(
      4 * 1024 * 1024,
      Math.floor(update.parallelRangeMinBytes),
    );
  }
  if (update.parallelRangeConnections !== undefined) {
    normalized.parallelRangeConnections = Math.max(
      1,
      Math.min(8, Math.floor(update.parallelRangeConnections)),
    );
  }
  const frozen = Object.freeze(normalized);
  g[MIRROR_GLOBAL_KEY] = frozen;
  return frozen;
}

/**
 * Normalize mirror URLs back to their canonical upstream URL so Cache Storage,
 * IndexedDB, and OPFS keys remain 100% invariant across mirror/VPN switches.
 */
export function toCanonicalArtifactUrl(url: string): string {
  if (!url || !url.startsWith("http")) {
    return url;
  }
  const cfg = getArtifactMirrorConfig();

  // 1. Check MLC binary WASM library mirrors first (some prefixes wrap raw.githubusercontent.com)
  const wasmPrefixes = dedupeStrings([
    CANONICAL_MLC_WASM_PREFIX,
    ...DEFAULT_MLC_WASM_MIRROR_PREFIXES,
    ...(cfg.wasmLibPrefixes ?? []),
  ]);
  for (const prefix of wasmPrefixes) {
    if (url.startsWith(prefix + "/")) {
      return CANONICAL_MLC_WASM_PREFIX + url.slice(prefix.length);
    }
  }

  // 2. Check Hugging Face origins
  const hfOrigins = dedupeStrings([
    CANONICAL_HF_ORIGIN,
    DEFAULT_HF_MIRROR_ORIGIN,
    ...(cfg.hfOrigins ?? []),
  ]);
  for (const origin of hfOrigins) {
    if (url.startsWith(origin + "/")) {
      return CANONICAL_HF_ORIGIN + url.slice(origin.length);
    }
  }

  return url;
}

/**
 * Expand an artifact URL into ordered mirror candidate URLs `[primary, ...fallbacks]`.
 */
export function resolveArtifactMirrorUrls(url: string): string[] {
  if (!url || !url.startsWith("http")) {
    return [url];
  }
  const cfg = getArtifactMirrorConfig();
  const canonical = toCanonicalArtifactUrl(url);

  if (canonical.startsWith(CANONICAL_MLC_WASM_PREFIX + "/")) {
    const suffix = canonical.slice(CANONICAL_MLC_WASM_PREFIX.length);
    const configured = cfg.wasmLibPrefixes;
    const prefixes =
      configured && configured.length > 0
        ? dedupeStrings([...configured, CANONICAL_MLC_WASM_PREFIX])
        : dedupeStrings([
            ...(url !== canonical ? [url.slice(0, url.length - suffix.length)] : []),
            CANONICAL_MLC_WASM_PREFIX,
            ...DEFAULT_MLC_WASM_MIRROR_PREFIXES,
          ]);
    return prefixes.map((p) => p + suffix);
  }

  if (canonical.startsWith(CANONICAL_HF_ORIGIN + "/")) {
    const suffix = canonical.slice(CANONICAL_HF_ORIGIN.length);
    const configured = cfg.hfOrigins;
    const origins =
      configured && configured.length > 0
        ? dedupeStrings([...configured, CANONICAL_HF_ORIGIN])
        : dedupeStrings([
            ...(url !== canonical ? [url.slice(0, url.length - suffix.length)] : []),
            CANONICAL_HF_ORIGIN,
            DEFAULT_HF_MIRROR_ORIGIN,
          ]);
    return origins.map((o) => o + suffix);
  }

  return [url];
}

function createAbortError(message = "Artifact fetch aborted"): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: string }).name === "AbortError"
  );
}

/**
 * Fetch an artifact URL with automatic failover across configured mirrors on
 * network error, CORS block (e.g. `hf-mirror.com` geo-308 on overseas IP), or non-OK HTTP status.
 */
export async function fetchArtifactWithMirrorFailover(
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const signal = init?.signal ?? undefined;
  if (signal?.aborted) {
    throw createAbortError(`Aborted before fetching ${url}`);
  }
  const candidates = resolveArtifactMirrorUrls(url);
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (signal?.aborted) {
      throw createAbortError(`Aborted while fetching ${url}`);
    }
    try {
      const response = await fetchImpl(candidate, init);
      if (response.ok || response.status === 206) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} while fetching ${candidate}`);
    } catch (err) {
      if (isAbortError(err, signal)) {
        throw err;
      }
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch ${url}: ${String(lastError)}`);
}

const DEFAULT_PARALLEL_RANGE_MIN_BYTES = 48 * 1024 * 1024;
const DEFAULT_PARALLEL_RANGE_CONNECTIONS = 4;
const GLOBAL_INFLIGHT_CACHE_ADDS = new Map<string, Promise<void>>();

export interface TensorCacheEntry {
  name: string;
  shape: Array<number>;
  dtype: string;
  format: "f32-to-bf16" | "raw";
  byteOffset: number;
  nbytes: number;
}

export interface TensorShardEntry {
  dataPath: string;
  format: "raw-shard";
  nbytes: number;
  records: Array<TensorCacheEntry>;
}

/**
 * Return a borrowed view of one tensor record within a shard.
 *
 * The returned view aliases the shard and is only valid for as long as the
 * shard data remains alive. Tensor-cache decoding consumes it synchronously.
 */
export function getTensorCacheRecordBytes(
  shardData: ArrayBuffer | Uint8Array,
  record: Pick<TensorCacheEntry, "byteOffset" | "nbytes">,
): Uint8Array {
  const shardBytes =
    shardData instanceof Uint8Array ? shardData : new Uint8Array(shardData);
  const { byteOffset, nbytes } = record;
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
    throw new Error(`Invalid tensor-cache byteOffset: ${byteOffset}`);
  }
  if (!Number.isSafeInteger(nbytes) || nbytes < 0) {
    throw new Error(`Invalid tensor-cache nbytes: ${nbytes}`);
  }
  const endOffset = byteOffset + nbytes;
  if (!Number.isSafeInteger(endOffset) || endOffset > shardBytes.byteLength) {
    throw new Error(
      `Tensor-cache record range [${byteOffset}, ${endOffset}) exceeds ` +
      `shard size ${shardBytes.byteLength}`,
    );
  }
  return shardBytes.subarray(byteOffset, endOffset);
}

/**
 *   Common Interface for the artifact cache
 */
export interface ArtifactCacheTemplate {
  /**
   * Retrieve data object that corresponds to `url` from cache. If data object does not exist in
   * cache, fetch the data and then add to cache.
   *
    * @param url The url to the data to be cached.
    * @param storetype This field is required so that `ArtifactIndexedDBCache` can store the
   * actual data object (see `addToCache()`), while `ArtifactCache` which uses the Cache API can
   * return the actual data object rather than the request. There are two options:
   * 1. "json": returns equivalent to `fetch(url).json()`
   * 2. "arraybuffer": returns equivalent to `fetch(url).arraybuffer()`
    * @param signal An optional AbortSignal allowing user to abort the fetching before its completion.
   * @return The data object (i.e. users do not need to call `.json()` or `.arraybuffer()`).
   *
    * Note: This is an async function.
   */
  fetchWithCache(url: string, storetype?: string, signal?: AbortSignal): Promise<any>;

  /**
   * Fetch data from url and add into cache. If already exists in cache, should return instantly.
   *
    * @param url The url to the data to be cached.
    * @param storetype Only applies to `ArtifactIndexedDBCache`. Since `indexedDB` stores the actual
    * @param signal An optional AbortSignal to abort data retrival.
   * data rather than a request, we specify `storagetype`. There are two options:
   * 1. "json": IndexedDB stores `fetch(url).json()`
   * 2. "arraybuffer": IndexedDB stores `fetch(url).arrayBuffer()`
   *
    * Note: This is an async function.
   */
  addToCache(
    url: string,
    storetype?: string,
    signal?: AbortSignal,
    onBytes?: (deltaBytes: number) => void,
    expectedBytes?: number,
  ): Promise<void>;

  /**
   * check if cache has all keys in Cache
   *
    * Note: This is an async function.
   */
  hasAllKeys(keys: string[]): Promise<boolean>;

  /**
   * Delete url in cache if url exists
   *
    * Note: This is an async function.
   */
  deleteInCache(url: string): Promise<void>;
}

export type ArtifactCacheType = "cache" | "indexeddb" | "cross-origin" | "opfs";

export interface TensorCacheAccessOptions {
  cacheScope?: string;
  cacheType?: ArtifactCacheType;
  artifactCache?: ArtifactCacheTemplate;
  opfsAccessMode?: OPFSAccessMode;
}

type StoreType = string | undefined;
type RequestLike = string | URL | Request | { url?: string };

interface CrossOriginHashDescriptor {
  algorithm: string;
  value: string;
}

interface CrossOriginStorageHandle {
  getFile(): Promise<Blob>;
  createWritable(): Promise<CrossOriginStorageWritable>;
}

interface CrossOriginStorageGetFileHandleOptions {
  create?: boolean;
  origins?: string[] | string | undefined;
}

interface CrossOriginStorageWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface CrossOriginStorageAPI {
  getFileHandle(
    descriptor: CrossOriginHashDescriptor,
    options?: CrossOriginStorageGetFileHandleOptions,
  ): Promise<CrossOriginStorageHandle>;
}

declare global {
  interface Navigator {
    crossOriginStorage?: CrossOriginStorageAPI;
  }
  interface WorkerNavigator {
    crossOriginStorage?: CrossOriginStorageAPI;
  }
}

const HASH_ALGORITHM = "SHA-256";
const DEFAULT_FETCH_OPTIONS: RequestInit = { method: "GET" };
const COS_HASH_META_CACHE = "tvmjs-cos-hash-meta";
let crossOriginFallbackWarningLogged = false;

const GLOBAL_HASH_CACHE = new Map<
  string,
  CrossOriginHashDescriptor
>();

class CrossOriginStorage {
  private hashCache: Map<string, CrossOriginHashDescriptor>;

  constructor() {
    this.hashCache = GLOBAL_HASH_CACHE;
  }

  static isAvailable(): boolean {
    if (typeof navigator === "undefined") {
      return false;
    }
    // Check for `getFileHandle()` itself, so that an implementation exposing
    // `navigator.crossOriginStorage` without the method falls back to the
    // default cache.
    return typeof navigator.crossOriginStorage?.getFileHandle === "function";
  }

  async match(request: RequestLike): Promise<Response | undefined> {
    const url = this.normalizeRequest(request);
    const hash = await this.resolveHashDescriptor(url);
    if (!hash) {
      return undefined;
    }
    try {
      const api = this.getApi();
      if (!api) {
        return undefined;
      }
      const handle = await api.getFileHandle(hash);
      if (!handle) {
        return undefined;
      }
      const blob = await handle.getFile();
      return new Response(blob);
    } catch {
      return undefined;
    }
  }

  async put(request: RequestLike, response: Response): Promise<void> {
    const url = this.normalizeRequest(request);
    const blob = await response.blob();
    const hash = await this.getBlobHash(blob);
    const api = this.getApi();
    if (!api) {
      throw new Error("Cross-origin storage API unavailable.");
    }
    const handle = await api.getFileHandle(hash, { create: true, origins: "*" /* All origins */ });
    if (!handle) {
      throw new Error("Cross-origin storage API returned no handle.");
    }
    const writableStream = await handle.createWritable();
    await writableStream.write(blob);
    await writableStream.close();
    this.hashCache.set(url, hash);
    await this.persistHashEntry(url, hash);
  }

  async delete(_request: RequestLike): Promise<void> {
    // Cross-origin storage extension currently has no delete API.
    return;
  }

  private getApi(): CrossOriginStorageAPI | undefined {
    if (!CrossOriginStorage.isAvailable()) {
      return undefined;
    }
    return navigator.crossOriginStorage;
  }

  private normalizeRequest(request: RequestLike): string {
    if (typeof request === "string") {
      return toCanonicalArtifactUrl(request);
    }
    if (request instanceof URL) {
      return toCanonicalArtifactUrl(request.href);
    }
    if (request instanceof Request) {
      return toCanonicalArtifactUrl(request.url);
    }
    if (request && typeof request.url === "string") {
      return toCanonicalArtifactUrl(request.url);
    }
    throw new Error("CrossOriginStorage: Unsupported request type.");
  }

  private async persistHashEntry(
    url: string,
    hash: CrossOriginHashDescriptor,
  ): Promise<void> {
    try {
      if (typeof caches === "undefined") {
        return;
      }
      const store = await caches.open(COS_HASH_META_CACHE);
      await store.put(url, new Response(JSON.stringify(hash)));
    } catch {
      // best-effort: ignore storage errors
    }
  }

  private async loadPersistedHashEntry(
    url: string,
  ): Promise<CrossOriginHashDescriptor | null> {
    try {
      if (typeof caches === "undefined") {
        return null;
      }
      const store = await caches.open(COS_HASH_META_CACHE);
      const response = await store.match(url);
      if (!response) {
        return null;
      }
      return JSON.parse(await response.text()) as CrossOriginHashDescriptor;
    } catch {
      return null;
    }
  }

  private async resolveHashDescriptor(
    url: string,
  ): Promise<CrossOriginHashDescriptor | null> {
    const cached = this.hashCache.get(url);
    if (cached) {
      return cached;
    }
    // Check persistent store before falling back to network-based hash extraction.
    // This covers non-LFS files (JSON configs, tokenizers) and non-HuggingFace URLs
    // (e.g. GitHub raw .wasm files) whose hashes were computed from blob content on a
    // previous visit and persisted to the Cache API.
    const persisted = await this.loadPersistedHashEntry(url);
    if (persisted) {
      this.hashCache.set(url, persisted);
      return persisted;
    }
    const hashValue = await this.getFileHash(url);
    if (!hashValue) {
      return null;
    }
    const descriptor: CrossOriginHashDescriptor = {
      algorithm: HASH_ALGORITHM,
      value: hashValue,
    };
    this.hashCache.set(url, descriptor);
    // Persist pointer-derived hashes so subsequent visits skip the LFS pointer
    // network request (especially important for models with many shards).
    await this.persistHashEntry(url, descriptor);
    return descriptor;
  }

  private async getFileHash(url: string): Promise<string | null> {
    if (/\/resolve\//.test(url)) {
      const pointerHash = await this.extractHashFromPointer(url);
      if (pointerHash) {
        return pointerHash;
      }
    }
    return null;
  }

  private async extractHashFromPointer(url: string): Promise<string | null> {
    const rawUrl = url.replace(/\/resolve\//, "/raw/");
    try {
      const text = await fetchArtifactWithMirrorFailover(rawUrl).then((res) => res.text());
      if (!text.includes("oid sha256:")) {
        return null;
      }
      const match = text.match(/oid sha256:([A-Fa-f0-9]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  private async getBlobHash(blob: Blob): Promise<CrossOriginHashDescriptor> {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest(HASH_ALGORITHM, arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      algorithm: HASH_ALGORITHM,
      value: hashHex,
    };
  }
}


function wrapResponseWithByteProgress(
  response: Response,
  onBytes?: (deltaBytes: number) => void,
): Response {
  if (!onBytes || !response.body || typeof TransformStream === "undefined") {
    return response;
  }
  const trackedBody = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (chunk && chunk.byteLength > 0) {
          onBytes(chunk.byteLength);
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(trackedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function readResponseToExactUint8Array(
  response: Response,
  expectedLength: number,
  onBytes?: (deltaBytes: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength !== expectedLength) {
      throw new Error(
        `Range chunk length mismatch: got ${ab.byteLength}, expected ${expectedLength}`,
      );
    }
    onBytes?.(ab.byteLength);
    return new Uint8Array(ab);
  }
  const out = new Uint8Array(expectedLength);
  let offset = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      if (signal?.aborted) {
        throw createAbortError("Range stream aborted");
      }
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (offset + value.byteLength > expectedLength) {
        throw new Error(
          `Range chunk overflow: ${offset + value.byteLength} > ${expectedLength}`,
        );
      }
      out.set(value, offset);
      offset += value.byteLength;
      onBytes?.(value.byteLength);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  if (offset !== expectedLength) {
    throw new Error(
      `Incomplete Range chunk: got ${offset}, expected ${expectedLength}`,
    );
  }
  return out;
}

/**
 * Fetch an artifact with automatic mirror failover AND optional multi-connection
 * HTTP `Range` acceleration for giant weight shards (e.g. 127.5 MiB embedding shards).
 */
export async function fetchArtifactResponseWithAcceleration(
  url: string,
  options?: {
    signal?: AbortSignal;
    onBytes?: (deltaBytes: number) => void;
    expectedBytes?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<Response> {
  const signal = options?.signal;
  const onBytes = options?.onBytes;
  const expectedBytes = options?.expectedBytes;
  const fetchImpl = options?.fetchImpl ?? fetch;

  const cfg = getArtifactMirrorConfig();
  const minBytes = cfg.parallelRangeMinBytes ?? DEFAULT_PARALLEL_RANGE_MIN_BYTES;
  const parts = cfg.parallelRangeConnections ?? DEFAULT_PARALLEL_RANGE_CONNECTIONS;
  const enableParallelRange =
    cfg.enableParallelRange ??
    (getWebGPUFramePacing().maxParallelShardDownloads > 2);

  const shouldTryRange =
    enableParallelRange &&
    parts >= 2 &&
    expectedBytes !== undefined &&
    Number.isSafeInteger(expectedBytes) &&
    expectedBytes >= minBytes &&
    url.startsWith("http") &&
    !url.includes("localhost") &&
    !url.includes("127.0.0.1");

  let rangeReportedBytes = 0;

  if (shouldTryRange) {
    const partSize = Math.ceil(expectedBytes / parts);
    const ranges: Array<{ start: number; end: number; len: number }> = [];
    for (let start = 0; start < expectedBytes; start += partSize) {
      const end = Math.min(expectedBytes - 1, start + partSize - 1);
      ranges.push({ start, end, len: end - start + 1 });
    }

    if (ranges.length >= 2) {
      const rangeAbort = new AbortController();
      const onExternalAbort = () => rangeAbort.abort();
      if (signal) {
        if (signal.aborted) {
          throw createAbortError(`Aborted before Range fetch ${url}`);
        }
        signal.addEventListener("abort", onExternalAbort, { once: true });
      }
      const reportRangeBytes = onBytes
        ? (delta: number) => {
            if (delta > 0) {
              rangeReportedBytes += delta;
              onBytes(delta);
            }
          }
        : undefined;

      try {
        const res0 = await fetchArtifactWithMirrorFailover(
          url,
          {
            method: "GET",
            headers: { Range: `bytes=0-${ranges[0].end}` },
            signal: rangeAbort.signal,
          },
          fetchImpl,
        );

        // Server ignored Range and returned full 200 OK — stream directly with 0 wasted bytes!
        if (res0.status === 200) {
          return wrapResponseWithByteProgress(res0, onBytes);
        }

        if (res0.status === 206) {
          const directUrl =
            res0.url && res0.url.startsWith("http") ? res0.url : undefined;
          const fetchPart = async (idx: number): Promise<Uint8Array> => {
            const r = ranges[idx];
            if (idx === 0) {
              return readResponseToExactUint8Array(
                res0,
                r.len,
                reportRangeBytes,
                rangeAbort.signal,
              );
            }
            const rangeInit: RequestInit = {
              method: "GET",
              headers: { Range: `bytes=${r.start}-${r.end}` },
              signal: rangeAbort.signal,
            };
            let partRes: Response | undefined;
            if (directUrl) {
              try {
                const candidateRes = await fetchImpl(directUrl, rangeInit);
                if (candidateRes.status === 206) {
                  partRes = candidateRes;
                } else {
                  try {
                    await candidateRes.body?.cancel();
                  } catch {
                    // ignore
                  }
                }
              } catch (err) {
                if (isAbortError(err, signal)) throw err;
              }
            }
            if (!partRes) {
              partRes = await fetchArtifactWithMirrorFailover(
                url,
                rangeInit,
                fetchImpl,
              );
            }
            if (partRes.status !== 206) {
              try {
                await partRes.body?.cancel();
              } catch {
                // ignore
              }
              throw new Error(
                `Expected 206 Partial Content for range ${r.start}-${r.end}, got ${partRes.status}`,
              );
            }
            return readResponseToExactUint8Array(
              partRes,
              r.len,
              reportRangeBytes,
              rangeAbort.signal,
            );
          };

          const buffers = await Promise.all(
            ranges.map((_, idx) => fetchPart(idx)),
          );
          const contentType =
            res0.headers.get("content-type") || "application/octet-stream";
          return new Response(new Blob(buffers as BlobPart[], { type: contentType }), {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(expectedBytes),
            },
          });
        }

        try {
          await res0.body?.cancel();
        } catch {
          // ignore
        }
      } catch (err) {
        rangeAbort.abort();
        if (isAbortError(err, signal)) {
          throw err;
        }
        // Any Range/CORS/CDN partial error falls back cleanly to single-stream mirror failover
      } finally {
        if (signal) {
          signal.removeEventListener("abort", onExternalAbort);
        }
      }
    }
  }

  let fallbackStreamed = 0;
  const compensatedOnBytes = onBytes
    ? (delta: number) => {
        const prev = fallbackStreamed;
        fallbackStreamed += delta;
        const uncompensated = Math.max(
          0,
          fallbackStreamed - Math.max(prev, rangeReportedBytes),
        );
        if (uncompensated > 0) {
          onBytes(uncompensated);
        }
      }
    : undefined;

  const response = await fetchArtifactWithMirrorFailover(
    url,
    signal ? { ...DEFAULT_FETCH_OPTIONS, signal } : DEFAULT_FETCH_OPTIONS,
    fetchImpl,
  );
  return wrapResponseWithByteProgress(response, compensatedOnBytes);
}

/**
 * Cache to store model related data, implemented with the Cache API.
 */
export class ArtifactCache implements ArtifactCacheTemplate {
  private scope: string;
  private cache?: Cache;

  constructor(scope: string) {
    this.scope = scope;
  }

  /**
   * Convert the Response object to the expected storetype instead
   */
  async responseTostoretype(response: Response, storetype?: string): Promise<any> {
    if (storetype === undefined) {
      return response;
    } else if (storetype.toLowerCase() === "json") {
      return await response.json();
    } else if (storetype.toLowerCase() === "arraybuffer") {
      return await response.arrayBuffer();
    } else {
      console.error("Unknown storage type " + storetype + ", returning raw response");
      return response;
    }
  }

  /**
   * fetch the corresponding url object in response or stored object format
   * @param url url
   * @param storetype the storage type for indexedDB
   * @param signal an optional abort signal to abort fetching
   * @returns response in json, arraybuffer or pure response format
   */
  async fetchWithCache(url: string, storetype?: string, signal?: AbortSignal): Promise<any> {
    const canonicalUrl = toCanonicalArtifactUrl(url);
    await this.addToCache(url, storetype, signal);
    let result = await this.cache!.match(new Request(canonicalUrl));
    if (result === undefined && canonicalUrl !== url) {
      result = await this.cache!.match(new Request(url));
    }
    if (result === undefined) {
      // Already called `addToCache()`, should expect the request in cache.
      throw Error("Cannot fetch " + url);
    }
    return await this.responseTostoretype(result, storetype);
  }

  async addToCache(
    url: string,
    _storetype?: string,
    signal?: AbortSignal,
    onBytes?: (deltaBytes: number) => void,
    expectedBytes?: number,
  ) {
    const canonicalUrl = toCanonicalArtifactUrl(url);
    if (this.cache === undefined) {
      this.cache = await caches.open(this.scope);
    }
    const existing = await this.cache.match(new Request(canonicalUrl));
    if (existing !== undefined) {
      return;
    }
    if (canonicalUrl !== url) {
      const legacyExisting = await this.cache.match(new Request(url));
      if (legacyExisting !== undefined) {
        return;
      }
    }

    const inflightKey = `${this.scope}::${canonicalUrl}`;
    const existingInflight = GLOBAL_INFLIGHT_CACHE_ADDS.get(inflightKey);
    if (existingInflight && !signal?.aborted) {
      await existingInflight;
      return;
    }

    const task = (async () => {
      const response = await fetchArtifactResponseWithAcceleration(url, {
        signal,
        onBytes,
        expectedBytes,
      });
      await this.cache!.put(new Request(canonicalUrl), response);
    })();

    GLOBAL_INFLIGHT_CACHE_ADDS.set(inflightKey, task);
    try {
      await task;
    } finally {
      if (GLOBAL_INFLIGHT_CACHE_ADDS.get(inflightKey) === task) {
        GLOBAL_INFLIGHT_CACHE_ADDS.delete(inflightKey);
      }
    }
  }

  /**
   * Determine if all keys exist in the cache
   * @param keys the url key list of the strings
   * @returns boolean value indicate if all keys are in cache
   */
  async hasAllKeys(keys: string[]) {
    if (this.cache === undefined) {
      this.cache = await caches.open(this.scope);
    }
    return this.cache
      .keys()
      .then((requests) => {
        const cacheKeySet = new Set(
          requests.map((request) => toCanonicalArtifactUrl(request.url)),
        );
        return keys.every((key) => cacheKeySet.has(toCanonicalArtifactUrl(key)));
      })
      .catch(() => false);
  }

  /**
   * Delete the corresponding url object in cache
   * @param url the corresponding url object to be deleted
   */
  async deleteInCache(url: string) {
    if (this.cache === undefined) {
      this.cache = await caches.open(this.scope);
    }
    const canonicalUrl = toCanonicalArtifactUrl(url);
    await this.cache.delete(canonicalUrl);
    if (canonicalUrl !== url) {
      await this.cache.delete(url);
    }
  }
}

/**
 * Cache by IndexedDB to support caching model data
 */
export class ArtifactIndexedDBCache implements ArtifactCacheTemplate {
  private dbName?: string;
  private dbVersion = 1;
  private db: IDBDatabase | undefined;

  constructor(dbName: string) {
    this.dbName = dbName;
  }

  /**
   * Init the indexed DB database if it is not initialized.
   */
  private async initDB() {
    if (this.db != null) {
      return; // the db is already inialized
    }
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onupgradeneeded = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        if (!this.db.objectStoreNames.contains('urls')) {
          this.db.createObjectStore('urls', { keyPath: 'url' });
        }
      };
      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };
      request.onerror = (event) => {
        console.error("Database error: ", (event.target as IDBOpenDBRequest).error);
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  /**
   * Check if current url object is in indexedDB or not
   * @param url the url link
   * @returns boolean indicate if url object in indexedDB
   */
  private async isUrlInDB(url: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const transaction = this.db?.transaction(['urls'], 'readonly');
      if (transaction === undefined) {
        resolve(false);
        return;
      }
      const store = transaction.objectStore('urls');
      const request = store.get(url);
      request.onsuccess = () => {
        resolve(request.result !== undefined);
      };
      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  async asyncGetHelper(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      let result: any;
      const transaction = this.db?.transaction(['urls'], 'readonly');
      if (transaction === undefined) {
        resolve(undefined);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      const objectStore = transaction.objectStore('urls');
      const getRequest = objectStore.get(url);
      getRequest.onsuccess = () => {
        result = getRequest.result;
      }
    })
  }

  async fetchWithCache(url: string, storetype?: string, signal?: AbortSignal): Promise<any> {
    const canonicalUrl = toCanonicalArtifactUrl(url);
    await this.addToCache(url, storetype, signal);
    let result = await this.asyncGetHelper(canonicalUrl);
    if (result == null && canonicalUrl !== url) {
      result = await this.asyncGetHelper(url);
    }
    if (result == null) {
      // previously null/missing data in cache or somehow failed to add to cache, delete and retry
      await this.deleteInCache(url);
      await this.addToCache(url, storetype, signal);
      result = await this.asyncGetHelper(canonicalUrl);
    }
    if (result != null && typeof result === "object" && "data" in result) {
      // `storetype` not used here because the data stored in indexedDB is already in that type
      return result.data;
    }
    throw Error("ArtifactIndexedDBCache failed to fetch: " + url);
  }

  async addToIndexedDB(url: string, response: any, storetype?: string) {
    await this.initDB();
    let data: any;
    // IndexedDB, unlike the Cache API, stores the actual data object, so we convert reponse here.
    if (storetype != undefined) {
      if (storetype.toLowerCase() === "json") {
        data = await response.json();
      } else if (storetype.toLocaleLowerCase() === "arraybuffer") {
        data = await response.arrayBuffer();
      } else {
        throw Error("Unsupported storetyp for IndexedDB: " + storetype);
      }
    }
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db?.transaction(['urls'], 'readwrite');
      if (transaction === undefined) {
        reject(new Error("IndexedDB transaction unavailable"));
        return;
      }
      const store = transaction.objectStore('urls');
      const request = store.put({ data, url });
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject((event.target as IDBRequest).error);
    });
  }

  async addToCache(
    url: string,
    storetype?: string,
    signal?: AbortSignal,
    onBytes?: (deltaBytes: number) => void,
    expectedBytes?: number,
  ): Promise<void> {
    await this.initDB(); // await the initDB process
    const canonicalUrl = toCanonicalArtifactUrl(url);
    // If already cached, nothing to do
    if (await this.isUrlInDB(canonicalUrl)) {
      return;
    }
    if (canonicalUrl !== url && (await this.isUrlInDB(url))) {
      return;
    }
    try {
      const response = await fetchArtifactResponseWithAcceleration(url, {
        signal,
        onBytes,
        expectedBytes,
      });
      await this.addToIndexedDB(canonicalUrl, response, storetype);
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      throw Error("Failed to store " + url + " with error: " + error);
    }
  }

  async hasAllKeys(keys: string[]): Promise<boolean> {
    await this.initDB(); // Ensure the DB is initialized
    if (!this.db) {
      throw new Error('Database is not initialized');
    }
    return new Promise<boolean>((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readonly');
      const store = transaction.objectStore('urls');
      const promises = keys.map(key => {
        const canonicalKey = toCanonicalArtifactUrl(key);
        return new Promise<boolean>((resolve) => {
          const request = store.get(canonicalKey);
          request.onsuccess = () => {
            if (request.result !== undefined) {
              resolve(true);
            } else if (canonicalKey !== key) {
              const fallbackReq = store.get(key);
              fallbackReq.onsuccess = () => resolve(fallbackReq.result !== undefined);
              fallbackReq.onerror = () => resolve(false);
            } else {
              resolve(false);
            }
          };
          request.onerror = () => {
            resolve(false); // On error, resolve as if the key was not found
          };
        });
      });
      Promise.all(promises).then(results => {
        const allExist = results.every(exists => exists);
        resolve(allExist);
      }).catch(error => {
        reject(error); // Reject the main promise if any of the promises are rejected
      });
    });
  }

  async deleteInCache(url: string) {
    await this.initDB(); // Make sure the DB is initialized
    const transaction = this.db?.transaction(['urls'], 'readwrite');
    if (transaction === undefined) {
      return;
    }
    const store = transaction.objectStore('urls');
    const canonicalUrl = toCanonicalArtifactUrl(url);
    store.delete(canonicalUrl);
    if (canonicalUrl !== url) {
      store.delete(url);
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    return;
  }
}

/**
 * Cache by Origin Private File System (OPFS).
 */
export class ArtifactOPFSCache implements ArtifactCacheTemplate {
  private readonly store: OPFSStore;

  constructor(scope: string, accessMode: OPFSAccessMode = "async") {
    this.store = new OPFSStore(scope, accessMode);
  }

  static isAvailable(): boolean {
    return OPFSStore.isAvailable();
  }

  async fetchWithCache(
    url: string,
    storetype?: string,
    signal?: AbortSignal,
  ): Promise<any> {
    // Try the cache first to avoid a redundant OPFS lookup on a hit.
    const cached = await this.readFromCache(url, storetype);
    if (cached !== undefined) {
      return cached;
    }
    await this.addToCache(url, storetype, signal);
    const fetched = await this.readFromCache(url, storetype);
    if (fetched === undefined) {
      throw new Error("ArtifactOPFSCache failed to fetch: " + url);
    }
    return fetched;
  }

  private async readFromCache(
    url: string,
    storetype?: string,
  ): Promise<any> {
    const canonicalUrl = toCanonicalArtifactUrl(url);
    if (storetype?.toLowerCase() === "arraybuffer") {
      const buf = await this.store.readArrayBuffer(canonicalUrl);
      if (buf !== undefined || canonicalUrl === url) return buf;
      return this.store.readArrayBuffer(url);
    }
    let cachedResponse = await this.store.read(canonicalUrl);
    if (cachedResponse === undefined && canonicalUrl !== url) {
      cachedResponse = await this.store.read(url);
    }
    if (cachedResponse === undefined) {
      return undefined;
    }
    return this.responseToStoreType(cachedResponse, storetype);
  }

  async addToCache(
    url: string,
    _storetype?: string,
    signal?: AbortSignal,
    onBytes?: (deltaBytes: number) => void,
    expectedBytes?: number,
  ): Promise<void> {
    const canonicalUrl = toCanonicalArtifactUrl(url);
    if (await this.store.has(canonicalUrl)) {
      return;
    }
    if (canonicalUrl !== url && (await this.store.has(url))) {
      return;
    }
    const response = await fetchArtifactResponseWithAcceleration(url, {
      signal,
      onBytes,
      expectedBytes,
    });
    await this.store.write(canonicalUrl, response);
  }

  async hasAllKeys(keys: string[]): Promise<boolean> {
    const results = await Promise.all(
      keys.map(async (key) => {
        const canonicalKey = toCanonicalArtifactUrl(key);
        if (await this.store.has(canonicalKey)) return true;
        return canonicalKey !== key ? await this.store.has(key) : false;
      }),
    );
    return results.every((result) => result);
  }

  async deleteInCache(url: string): Promise<void> {
    const canonicalUrl = toCanonicalArtifactUrl(url);
    await this.store.remove(canonicalUrl);
    if (canonicalUrl !== url) {
      await this.store.remove(url);
    }
  }

  private async responseToStoreType(
    response: Response,
    storetype?: StoreType,
  ): Promise<any> {
    if (storetype === undefined) {
      return response;
    }
    const format = storetype.toLowerCase();
    if (format === "json") {
      return response.json();
    }
    if (format === "arraybuffer") {
      return response.arrayBuffer();
    }
    return response;
  }
}

/**
 * Cache by cross-origin storage extension.
 */
export class ArtifactCrossOriginStorageCache implements ArtifactCacheTemplate {
  private storage: CrossOriginStorage;

  constructor(
    _scope: string,
    storage: CrossOriginStorage = new CrossOriginStorage(),
  ) {
    this.storage = storage;
  }

  async fetchWithCache(
    url: string,
    storetype?: StoreType,
    signal?: AbortSignal,
  ): Promise<any> {
    const canonicalUrl = toCanonicalArtifactUrl(url);
    const cachedResponse = await this.storage.match(canonicalUrl);
    if (cachedResponse !== undefined) {
      return this.responseToStoreType(cachedResponse, storetype);
    }
    await this.addToCache(url, storetype, signal);
    const hydrated = await this.storage.match(canonicalUrl);
    if (hydrated === undefined) {
      throw new Error(`ArtifactCrossOriginStorageCache: failed to hydrate ${url}`);
    }
    return this.responseToStoreType(hydrated, storetype);
  }

  async addToCache(
    url: string,
    _storetype?: StoreType,
    signal?: AbortSignal,
    onBytes?: (deltaBytes: number) => void,
    expectedBytes?: number,
  ): Promise<void> {
    const canonicalUrl = toCanonicalArtifactUrl(url);
    const existing = await this.storage.match(canonicalUrl);
    if (existing !== undefined) {
      return;
    }
    const response = await fetchArtifactResponseWithAcceleration(url, {
      signal,
      onBytes,
      expectedBytes,
    });
    await this.storage.put(canonicalUrl, response);
  }

  async hasAllKeys(keys: string[]): Promise<boolean> {
    const results = await Promise.all(
      keys.map(async (key) => {
        const cached = await this.storage.match(toCanonicalArtifactUrl(key));
        return cached !== undefined;
      }),
    );
    return results.every((result) => result);
  }

  async deleteInCache(url: string): Promise<void> {
    await this.storage.delete(toCanonicalArtifactUrl(url));
  }

  private async responseToStoreType(
    response: Response,
    storetype?: StoreType,
  ): Promise<any> {
    if (storetype === undefined) {
      return response;
    }
    const format = storetype.toLowerCase();
    if (format === "json") {
      return response.json();
    }
    if (format === "arraybuffer") {
      return response.arrayBuffer();
    }
    return response;
  }
}

function normalizeCacheType(cacheType?: string): ArtifactCacheType {
  if (cacheType === undefined) {
    return "cache";
  }
  const normalized = cacheType.toLowerCase();
  if (normalized === "cache") {
    return "cache";
  }
  if (normalized === "indexeddb") {
    return "indexeddb";
  }
  if (normalized === "cross-origin") {
    return "cross-origin";
  }
  if (normalized === "opfs") {
    return "opfs";
  }
  console.error("Unsupported cacheType: " + cacheType + ", using default ArtifactCache.");
  return "cache";
}

function isTensorCacheAccessOptions(
  value: string | TensorCacheAccessOptions | undefined,
): value is TensorCacheAccessOptions {
  return typeof value === "object" && value !== null;
}

function normalizeCacheAccessOptions(
  cacheScopeOrOptions: string | TensorCacheAccessOptions | undefined,
  cacheType?: string,
): TensorCacheAccessOptions {
  if (isTensorCacheAccessOptions(cacheScopeOrOptions)) {
    return cacheScopeOrOptions;
  }
  return {
    cacheScope: cacheScopeOrOptions,
    cacheType: normalizeCacheType(cacheType),
  };
}

export function createArtifactCache(
  scope: string,
  options: TensorCacheAccessOptions = {},
): ArtifactCacheTemplate {
  if (options.artifactCache !== undefined) {
    return options.artifactCache;
  }
  const cacheType = normalizeCacheType(options.cacheType);
  if (cacheType === "indexeddb") {
    return new ArtifactIndexedDBCache(scope);
  }
  if (cacheType === "cross-origin") {
    if (CrossOriginStorage.isAvailable()) {
      return new ArtifactCrossOriginStorageCache(scope);
    }
    if (!crossOriginFallbackWarningLogged) {
      console.warn(
        "Cross-origin storage backend is unavailable; falling back to ArtifactCache.",
      );
      crossOriginFallbackWarningLogged = true;
    }
  }
  if (cacheType === "opfs") {
    return new ArtifactOPFSCache(scope, options.opfsAccessMode);
  }
  return new ArtifactCache(scope);
}


/**
 * Function to check if NDarray is in Cache or not
 *
 * @param tensorCacheUrl The cache url which links to the Tensor
 * @param cacheScope The scope identifier of the cache
 * @param cacheType The type of the cache: "cache", "indexedDB", "cross-origin", or "opfs"
 * @returns the result if the cache has Tensor
 */
export async function hasTensorInCache(
  tensorCacheUrl: string,
  options?: TensorCacheAccessOptions,
): Promise<boolean>;
export async function hasTensorInCache(
  tensorCacheUrl: string,
  cacheScope?: string,
  cacheType?: string,
): Promise<boolean>;
export async function hasTensorInCache(
  tensorCacheUrl: string,
  cacheScopeOrOptions: string | TensorCacheAccessOptions = "tvmjs",
  cacheType = "cache",
): Promise<boolean> {
  const options = normalizeCacheAccessOptions(cacheScopeOrOptions, cacheType);
  const cacheScope = options.cacheScope ?? "tvmjs";
  const artifactCache = createArtifactCache(cacheScope, options);
  const jsonUrl = new URL("tensor-cache.json", tensorCacheUrl).href;
  const hasJsonUrlInCache = await artifactCache.hasAllKeys([jsonUrl]);
  if (!hasJsonUrlInCache) {
    return false;
  }
  const list = (await artifactCache.fetchWithCache(
    jsonUrl,
    "json",
  ))["records"] as Array<TensorShardEntry>;
  return await artifactCache.hasAllKeys(list.map(key => new URL(key.dataPath, tensorCacheUrl).href));
}


/**
 * Given cacheUrl, search up items to delete based on cacheUrl/tensor-cache.json
 *
 * @param cacheUrl The cacheUrl for the items
 * @param cacheScope The scope identifier of the cache
 * @param cacheType The type of the cache: "cache", "indexedDB", "cross-origin", or "opfs"
 */
export async function deleteTensorCache(
  cacheUrl: string,
  options?: TensorCacheAccessOptions,
): Promise<void>;
export async function deleteTensorCache(
  cacheUrl: string,
  cacheScope?: string,
  cacheType?: string,
): Promise<void>;
export async function deleteTensorCache(
  cacheUrl: string,
  cacheScopeOrOptions: string | TensorCacheAccessOptions = "tvmjs",
  cacheType = "cache",
): Promise<void> {
  const options = normalizeCacheAccessOptions(cacheScopeOrOptions, cacheType);
  const cacheScope = options.cacheScope ?? "tvmjs";
  const artifactCache = createArtifactCache(cacheScope, options);
  if (artifactCache instanceof ArtifactCrossOriginStorageCache) {
    // Cross-origin storage extension does not currently support programmatic deletion.
    return;
  }
  const jsonUrl = new URL("tensor-cache.json", cacheUrl).href;
  const list = await artifactCache.fetchWithCache(jsonUrl, "json");
  const arrayentry = list["records"] as Array<TensorShardEntry>;
  const processShard = async (i: number) => {
    const dataUrl = new URL(arrayentry[i].dataPath, cacheUrl).href;
    await artifactCache.deleteInCache(dataUrl);
  }
  await Promise.all(arrayentry.map((_, index) => processShard(index)));
}
