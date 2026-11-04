import { describe, expect, it } from 'vitest';
import { extractFactsFromUserText } from '../src/cognitive/extractor';
import { mergeFactsIntoProfile } from '../src/cognitive/conflictResolver';
import { emptyUserProfile } from '../src/types';

describe('client-memory > Extractor & ConflictResolver', () => {
  it('extracts name, occupation, preferences, pet, and location', () => {
    const text = '你好小蠢，我叫阿豪，是一名独立游戏设计师。我家在杭州，养了一只柴犬。我超级喜欢喝冰美式，最讨厌吃香菜！';
    const facts = extractFactsFromUserText(text);

    expect(facts.length).toBeGreaterThanOrEqual(5);

    const nameFact = facts.find((f) => f.key === 'name');
    expect(nameFact?.value).toBe('阿豪');

    const jobFact = facts.find((f) => f.category === 'occupation');
    expect(jobFact?.value).toContain('独立游戏设计');

    const locFact = facts.find((f) => f.key === 'location');
    expect(locFact?.value).toBe('杭州');

    const petFact = facts.find((f) => f.key === 'pet');
    expect(petFact?.value).toBe('柴犬');

    const likeFact = facts.find((f) => f.key === 'like');
    expect(likeFact?.value).toContain('冰美式');

    const dislikeFact = facts.find((f) => f.key === 'dislike');
    expect(dislikeFact?.value).toContain('香菜');
  });

  it('merges facts into profile and updates single-value attributes', () => {
    let profile = emptyUserProfile();
    const facts1 = extractFactsFromUserText('我叫小明，住在北京');
    profile = mergeFactsIntoProfile(profile, facts1);

    expect(profile.name).toBe('小明');
    expect(profile.traits.location).toBe('北京');

    // Conflict resolution: user moved to Shanghai
    const facts2 = extractFactsFromUserText('我搬到了上海');
    profile = mergeFactsIntoProfile(profile, facts2);

    expect(profile.traits.location).toBe('上海');
    // Ensure only 1 location fact remains
    const locFacts = profile.facts.filter((f) => f.key === 'location');
    expect(locFacts.length).toBe(1);
    expect(locFacts[0].value).toBe('上海');
  });

  it('avoids false positives on colloquial expressions (e.g. 可爱, 爱心便当, 写程序)', () => {
    const text1 = '小蠢好可爱呀，今天写程序遇到Bug了，但是我觉得做爱心便当很好';
    const facts = extractFactsFromUserText(text1);

    const falseLike = facts.find((f) => f.key === 'like');
    expect(falseLike).toBeUndefined();

    const falseJob = facts.find((f) => f.category === 'occupation');
    expect(falseJob).toBeUndefined();
  });
});
