/**
 * Extract ONNX ModelProto.metadata_props (string key/value) without onnx-proto.
 *
 * onnxruntime-web has no getModelMeta() (see ORT#16547). SenseVoice sherpa export
 * stores CMVN + LFR + language ids in metadata_props — we scan the raw file for
 * StringStringEntryProto pairs (field 1 = key, field 2 = value).
 */
function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < bytes.length) {
    const b = bytes[pos++]!;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error('varint too long');
  }
  return { value: value >>> 0, next: pos };
}

function readLenDelimited(bytes: Uint8Array, offset: number): { data: Uint8Array; next: number } {
  const { value: len, next } = readVarint(bytes, offset);
  const end = next + len;
  if (end > bytes.length) throw new Error('length-delimited overflow');
  return { data: bytes.subarray(next, end), next: end };
}

function parseStringEntry(msg: Uint8Array): { key: string; value: string } | null {
  let pos = 0;
  let key: string | null = null;
  let value: string | null = null;
  const dec = new TextDecoder();
  while (pos < msg.length) {
    const { value: tag, next } = readVarint(msg, pos);
    pos = next;
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 2) {
      const { data, next: n2 } = readLenDelimited(msg, pos);
      pos = n2;
      const s = dec.decode(data);
      if (field === 1) key = s;
      else if (field === 2) value = s;
    } else if (wire === 0) {
      const r = readVarint(msg, pos);
      pos = r.next;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      return null;
    }
  }
  if (key != null && value != null) return { key, value };
  return null;
}

/**
 * Walk top-level ModelProto fields; field 14 = metadata_props.
 * Stops early once both neg_mean and inv_stddev are found (large files).
 */
export function extractOnnxMetadataProps(buf: ArrayBuffer): Record<string, string> {
  const bytes = new Uint8Array(buf);
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < bytes.length) {
    let tag: number;
    let next: number;
    try {
      ({ value: tag, next } = readVarint(bytes, pos));
    } catch {
      break;
    }
    pos = next;
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 2) {
      let data: Uint8Array;
      try {
        ({ data, next } = readLenDelimited(bytes, pos));
      } catch {
        break;
      }
      pos = next;
      if (field === 14) {
        const entry = parseStringEntry(data);
        if (entry) {
          out[entry.key] = entry.value;
          if (out.neg_mean && out.inv_stddev) {
            // Keep scanning a bit for lang_* / lfr_* if cheap; else return.
            if (out.lfr_window_size && out.with_itn) return out;
          }
        }
      }
      // Skip other length-delimited blobs (graph is huge — field 7)
      if (field === 7 && data.byteLength > 1_000_000) {
        // continue after graph
      }
    } else if (wire === 0) {
      try {
        ({ next } = readVarint(bytes, pos));
        pos = next;
      } catch {
        break;
      }
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      break;
    }
  }
  return out;
}
