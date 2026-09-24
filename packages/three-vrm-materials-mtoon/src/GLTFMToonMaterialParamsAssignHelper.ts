import * as THREE from 'three';
import { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MToonMaterialParameters } from './MToonMaterialParameters';
import { setTextureColorSpace } from './utils/setTextureColorSpace';

/**
 * MaterialParameters hates `undefined`. This helper automatically rejects assign of these `undefined`.
 * It also handles asynchronous process of textures.
 * Make sure await for {@link GLTFMToonMaterialParamsAssignHelper.pending}.
 */
export class GLTFMToonMaterialParamsAssignHelper {
  private readonly _parser: GLTFParser;
  private _materialParams: MToonMaterialParameters;
  private _pendings: Promise<any>[];

  public get pending(): Promise<unknown> {
    return Promise.all(this._pendings);
  }

  public constructor(parser: GLTFParser, materialParams: MToonMaterialParameters) {
    this._parser = parser;
    this._materialParams = materialParams;
    this._pendings = [];
  }

  public assignPrimitive<T extends keyof MToonMaterialParameters>(key: T, value: MToonMaterialParameters[T]): void {
    if (value != null) {
      this._materialParams[key] = value;
    }
  }

  public assignColor<T extends keyof MToonMaterialParameters>(
    key: T,
    value: number[] | undefined,
    convertSRGBToLinear?: boolean,
  ): void {
    if (value != null) {
      const color = new THREE.Color().fromArray(value);

      if (convertSRGBToLinear) {
        color.convertSRGBToLinear();
      }
      (this._materialParams as any)[key] = color;
    }
  }

  public async assignTexture<T extends keyof MToonMaterialParameters>(
    key: T,
    schemaTexture: { index: number } | undefined,
    isColorTexture: boolean,
  ): Promise<void> {
    const promise = (async () => {
      if (schemaTexture != null) {
        const texture = await this._parser.assignTexture(this._materialParams, key, schemaTexture);

        // early abort if texture failed to load
        if (texture == null) {
          console.warn(
            'GLTFMToonMaterialParamsAssignHelper: Failed to load texture. The rendering result may be wrong',
          );
          return;
        }

        if (isColorTexture) {
          setTextureColorSpace(texture, 'srgb');
        }
      }
    })();

    this._pendings.push(promise);

    return promise;
  }

  public async assignTextureByIndex<T extends keyof MToonMaterialParameters>(
    key: T,
    textureIndex: number | undefined,
    isColorTexture: boolean,
  ): Promise<void> {
    return this.assignTexture(key, textureIndex != null ? { index: textureIndex } : undefined, isColorTexture);
  }
}
