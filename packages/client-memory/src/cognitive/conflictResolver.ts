import type { UserFact, UserProfile } from '../types';

export function mergeFactsIntoProfile(profile: UserProfile, newFacts: UserFact[]): UserProfile {
  if (newFacts.length === 0) return profile;

  const next: UserProfile = {
    ...profile,
    traits: { ...profile.traits },
    facts: [...profile.facts],
    updatedAt: Date.now(),
  };

  for (const fact of newFacts) {
    if (fact.category === 'identity' && fact.key === 'name') {
      next.name = fact.value;
      next.traits.name = fact.value;
      next.facts = next.facts.filter((f) => !(f.category === 'identity' && f.key === 'name'));
      next.facts.push(fact);
      continue;
    }

    if (fact.category === 'identity' && fact.key === 'location') {
      next.traits.location = fact.value;
      next.facts = next.facts.filter((f) => !(f.category === 'identity' && f.key === 'location'));
      next.facts.push(fact);
      continue;
    }

    if (fact.category === 'occupation') {
      next.traits.occupation = fact.value;
      next.facts = next.facts.filter((f) => f.category !== 'occupation');
      next.facts.push(fact);
      continue;
    }

    // List-based facts (preference, pet, health, plan):
    // If identical value exists, update ts and confidence
    const existingIdx = next.facts.findIndex(
      (f) => f.category === fact.category && f.key === fact.key && f.value.toLowerCase() === fact.value.toLowerCase(),
    );

    if (existingIdx >= 0) {
      next.facts[existingIdx] = {
        ...next.facts[existingIdx],
        confidence: Math.max(next.facts[existingIdx].confidence, fact.confidence),
        ts: fact.ts,
      };
    } else {
      next.facts.push(fact);
    }
  }

  // Cap total facts at 60 to prevent unbounded growth
  if (next.facts.length > 60) {
    next.facts = next.facts.slice(-60);
  }

  return next;
}
