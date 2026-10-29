export type Report = {
  id: string;
  title: string;
  body: string;
  account: string;
  createdAt: string;
  source: 'github' | 'support' | 'community';
  url?: string;
};
export type Release = { id: string; name: string; releasedAt: string; changes: string[] };
export type Cluster = {
  id: string;
  title: string;
  reports: Report[];
  before: number;
  after: number;
  beforeShare: number;
  afterShare: number;
  lift: number | null;
  priority: number;
  signal: 'new' | 'rising' | 'stable' | 'declining' | 'insufficient';
  change: string | null;
  changeSimilarity: number;
};
export type Analysis = {
  release: Release;
  windowDays: number;
  clusters: Cluster[];
  totals: { before: number; after: number; reports: number; accounts: number };
  timeline: { date: string; reports: number; phase: 'before' | 'after' }[];
};
export type Review = { status: 'investigating' | 'confirmed' | 'dismissed'; note: string };
export type Workspace = { reports: Report[]; releases: Release[]; reviews: Record<string, Review> };
