import { readFileSync } from 'node:fs';

interface ChallengeEntry {
  challenge: string;
  signature: string;
}

export class ChallengeDb {
  private readonly signatures: Map<string, string>;
  private unspent: string[];

  constructor(entries: ChallengeEntry[]) {
    this.signatures = new Map(entries.map((entry) => [entry.challenge, entry.signature]));
    this.unspent = entries.map((entry) => entry.challenge);
  }

  static load(challengeDbPath: string): ChallengeDb {
    const raw = readFileSync(challengeDbPath, 'utf8');
    const entries = JSON.parse(raw) as ChallengeEntry[];
    return new ChallengeDb(entries);
  }

  select(count: number): string[] {
    const available = Math.min(count, this.unspent.length);
    const indices = new Set<number>();

    while (indices.size < available) {
      indices.add(Math.floor(Math.random() * this.unspent.length));
    }

    const selected = [...indices].map((index) => this.unspent[index]!);
    const selectedSet = new Set(selected);
    this.unspent = this.unspent.filter((challenge) => !selectedSet.has(challenge));

    return selected;
  }

  getSignature(challenge: string): string | undefined {
    return this.signatures.get(challenge);
  }

  spend(challenges: string[]): void {
    const toSpend = new Set(challenges);
    this.unspent = this.unspent.filter((challenge) => !toSpend.has(challenge));
  }

  reclaim(challenges: string[]): void {
    for (const challenge of challenges) {
      if (this.signatures.has(challenge)) {
        this.unspent.push(challenge);
      }
    }
  }

  get size(): number {
    return this.unspent.length;
  }
}
