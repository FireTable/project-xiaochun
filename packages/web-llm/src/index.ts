/// <reference types="@webgpu/types" preserve="true" />
/// <reference types="chrome" preserve="true" />

export {
  ModelRecord,
  AppConfig,
  OPFSAccessMode,
  ChatOptions,
  MLCEngineConfig,
  GenerationConfig,
  ModelType,
  prebuiltAppConfig,
  modelVersion,
  modelLibURLPrefix,
  functionCallingModelIds,
} from "./config";

export {
  verifyIntegrity,
  isValidSRI,
  type ModelIntegrity,
  type SRIString,
  type FileIntegrityMap,
} from "./integrity";

export { IntegrityError } from "./error";

export {
  MODEL_PACKAGE_MANIFEST_FILENAME,
  TENSOR_CACHE_MANIFEST_FILENAME,
  ARTIFACT_SCHEMA_VERSION,
  type ModelPackageManifest,
  type CompiledProgramArtifact,
} from "./artifact_manifest";

export {
  InitProgressCallback,
  InitProgressReport,
  MLCEngineInterface,
  LogitProcessor,
  LogLevel,
  ResumableGenerationConfig,
  ResumeChatCompletionOptions,
  ResumeProbeResult,
  ResumeResult,
} from "./types";

export { MLCEngine, CreateMLCEngine } from "./engine";

export {
  hasModelInCache,
  deleteChatConfigInCache,
  deleteModelAllInfoInCache,
  deleteModelWasmInCache,
  deleteModelInCache,
} from "./cache_util";

export {
  WebWorkerMLCEngineHandler,
  WebWorkerMLCEngine,
  CreateWebWorkerMLCEngine,
} from "./web_worker";

export { WorkerRequest, WorkerResponse, CustomRequestParams } from "./message";

export {
  ServiceWorkerMLCEngineHandler,
  ServiceWorkerMLCEngine,
  CreateServiceWorkerMLCEngine,
} from "./service_worker";

export {
  ServiceWorkerMLCEngineHandler as ExtensionServiceWorkerMLCEngineHandler,
  ServiceWorkerMLCEngine as ExtensionServiceWorkerMLCEngine,
  CreateServiceWorkerMLCEngine as CreateExtensionServiceWorkerMLCEngine,
} from "./extension_service_worker";

export {
  setWebGPUFramePacing,
  getWebGPUFramePacing,
  DESKTOP_WEBGPU_FRAME_PACING,
  MOBILE_WEBGPU_FRAME_PACING,
  CANONICAL_HF_ORIGIN,
  DEFAULT_HF_MIRROR_ORIGIN,
  CANONICAL_MLC_WASM_PREFIX,
  DEFAULT_MLC_WASM_MIRROR_PREFIXES,
  getArtifactMirrorConfig,
  setArtifactMirrorConfig,
  toCanonicalArtifactUrl,
  resolveArtifactMirrorUrls,
  fetchArtifactWithMirrorFailover,
  fetchArtifactResponseWithAcceleration,
  type WebGPUFramePacingPreset,
  type WebGPUFramePacingOptions,
  type WebGPUFramePacingUpdate,
  type ArtifactMirrorConfig,
} from "@mlc-ai/web-runtime";

export {
  computeSlicedGrid,
  getSlicedRGBTilesFromURL,
  type SlicedRGBImageBundle,
} from "./support";

export * from "./openai_api_protocols/index";
