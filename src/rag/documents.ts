import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { analyze } from '../core/analysis.ts';
import type { Workspace } from '../core/types.ts';
export async function digest(text: string) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(data), (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function releaseDocuments(
  workspace: Workspace,
  releaseId: string,
  windowDays: number,
): Promise<Document[]> {
  const release = workspace.releases.find((r) => r.id === releaseId);
  if (!release) throw new Error('Release not found');
  const analysis = analyze(workspace.reports, release, windowDays);
  const reports = analysis.clusters.flatMap((c) => c.reports);
  const originals: Document[] = [
    ...reports.map(
      (r) =>
        new Document({
          pageContent: `${r.title}\n${r.body}`,
          metadata: {
            sourceId: r.id,
            kind: 'report',
            title: r.title,
            createdAt: r.createdAt,
            url: r.url,
          },
        }),
    ),
    ...release.changes.map(
      (change, index) =>
        new Document({
          pageContent: change,
          metadata: {
            sourceId: `${release.id}:change-${index + 1}`,
            kind: 'release_note',
            title: `${release.name} release change ${index + 1}`,
            createdAt: release.releasedAt,
          },
        }),
    ),
  ];
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 900, chunkOverlap: 120 });
  const chunks = await splitter.splitDocuments(originals);
  const ordinals = new Map<string, number>();
  return Promise.all(
    chunks.map(async (d) => {
      const ordinal = ordinals.get(d.metadata.sourceId) ?? 0;
      ordinals.set(d.metadata.sourceId, ordinal + 1);
      return new Document({
        pageContent: d.pageContent,
        metadata: {
          ...d.metadata,
          releaseId,
          chunkId: `${d.metadata.sourceId}:${ordinal}:${(await digest(d.pageContent)).slice(0, 12)}`,
        },
      });
    }),
  );
}
