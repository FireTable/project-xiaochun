import { describe, it, expect } from 'vitest';
import { parseTransferText, SyncFormatError } from '../syncPayload';
import { zhCN } from '@/i18n/zh-CN';
import { en } from '@/i18n/en';
import { ja } from '@/i18n/ja';

const codeOf = (text: string) => {
  try {
    parseTransferText(text);
  } catch (e) {
    return e instanceof SyncFormatError ? e.code : 'other';
  }
  return null;
};

describe('sync paste errors are localizable (code → chat.sync.errors.*) in zh / en / ja', () => {
  it('maps each malformed input to a code with a message in every language', () => {
    expect(codeOf('nope')).toBe('badPrefix');
    expect(codeOf('xs:1:abc.def')).toBe('badVersionTag');
    expect(codeOf('xs:v99:abc.def')).toBe('unsupportedVersion');
    expect(codeOf('xs:v1:onlyone')).toBe('badBody');
    for (const bundle of [zhCN, en, ja]) {
      for (const code of ['badPrefix', 'badVersionTag', 'unsupportedVersion', 'badBody'] as const) {
        expect(bundle.chat.sync.errors[code].length).toBeGreaterThan(0);
      }
    }
  });
});
