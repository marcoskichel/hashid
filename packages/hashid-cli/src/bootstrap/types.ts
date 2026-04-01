export interface LayerAProfile {
  meanSimilarity: number;
  stdDev: number;
  validationSampleSize: number;
}

export interface IdentityRecord {
  agentId: string;
  publicKey: string;
  challengeDbPath: string;
  dbCommitment: string;
  layerAProfile: LayerAProfile;
  deathCertificate: string;
}
