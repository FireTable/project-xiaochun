export type MemoryTurn = {
  id?: number;
  user: string;
  assistant: string;
  ts: number;
};

export type EntityFact = { k: string; v: string; ts: number };

export type EntityProfile = {
  name?: string;
  nickname?: string;
  likes: string[];
  dislikes: string[];
  facts: EntityFact[];
};

export type Recall = {
  entities: EntityProfile;
  recent: MemoryTurn[];
};

export function emptyEntities(): EntityProfile {
  return { likes: [], dislikes: [], facts: [] };
}
