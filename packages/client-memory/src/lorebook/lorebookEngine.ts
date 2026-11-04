import type { LorebookEntry } from '../types';

export interface SillyTavernLorebookRaw {
  entries?: Record<string, {
    key?: string[];
    keysecondary?: string[];
    comment?: string;
    content?: string;
    constant?: boolean;
    selective?: boolean;
    order?: number;
    depth?: number;
    disable?: boolean;
  }>;
}

function toKeyArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.filter((k): k is string => typeof k === 'string' && k.trim().length > 0);
  }
  if (typeof val === 'string') {
    return val.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return [];
}

export function parseSillyTavernLorebook(jsonStr: string, bookId = 'custom'): LorebookEntry[] {
  try {
    const raw = JSON.parse(jsonStr) as SillyTavernLorebookRaw;
    if (!raw.entries || typeof raw.entries !== 'object') return [];

    const result: LorebookEntry[] = [];
    let idx = 0;
    for (const [key, item] of Object.entries(raw.entries)) {
      if (!item || item.disable) continue;
      result.push({
        uid: `${bookId}_${key}_${idx++}`,
        bookId,
        keys: toKeyArray(item.key),
        secondaryKeys: toKeyArray(item.keysecondary),
        selective: Boolean(item.selective),
        constant: Boolean(item.constant),
        order: typeof item.order === 'number' ? item.order : 100,
        depth: typeof item.depth === 'number' ? item.depth : 4,
        content: typeof item.content === 'string' ? item.content.trim() : '',
        enabled: true,
      });
    }
    return result;
  } catch (e) {
    console.warn('[client-memory] Failed to parse SillyTavern lorebook JSON', e);
    return [];
  }
}

export function matchLorebookEntries(
  entries: LorebookEntry[],
  query: string,
  options?: { maxEntries?: number; maxChars?: number },
): LorebookEntry[] {
  const maxEntries = options?.maxEntries ?? 1; // Strict limit: max 1 entry
  const maxChars = options?.maxChars ?? 120;   // Strict budget: max 120 chars
  const lowerQuery = query.toLowerCase();

  const matched: LorebookEntry[] = [];

  for (const entry of entries) {
    if (!entry.enabled || !entry.content) continue;

    // Constant entries always trigger
    if (entry.constant) {
      matched.push(entry);
      continue;
    }

    if (!entry.keys || entry.keys.length === 0) continue;

    const primaryHit = entry.keys.some((k) => lowerQuery.includes(k.toLowerCase().trim()));
    if (!primaryHit) continue;

    if (entry.selective && entry.secondaryKeys && entry.secondaryKeys.length > 0) {
      const secHit = entry.secondaryKeys.some((k) => lowerQuery.includes(k.toLowerCase().trim()));
      if (!secHit) continue;
    }

    matched.push(entry);
  }

  // Sort by order descending (higher order has higher priority)
  matched.sort((a, b) => b.order - a.order);

  // Take top entries up to budget
  const finalHits: LorebookEntry[] = [];
  let charCount = 0;

  for (const entry of matched) {
    if (finalHits.length >= maxEntries) break;
    const len = entry.content.length;
    if (charCount + len <= maxChars || finalHits.length === 0) {
      finalHits.push(entry);
      charCount += len;
    }
  }

  return finalHits;
}
