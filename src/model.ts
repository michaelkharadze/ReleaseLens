import type { Cluster } from './core/types.ts';

export function validateHypothesis(
  input: unknown,
  cluster: Cluster,
): { hypothesis: string; citations: string[]; nextStep: string } {
  const r = input as { hypothesis?: unknown; citations?: unknown; nextStep?: unknown };
  const valid = new Set(cluster.reports.map((r) => r.id));
  if (
    !r ||
    typeof r.hypothesis !== 'string' ||
    !r.hypothesis.trim() ||
    r.hypothesis.length > 2000 ||
    typeof r.nextStep !== 'string' ||
    !r.nextStep.trim() ||
    r.nextStep.length > 2000 ||
    !Array.isArray(r.citations) ||
    !r.citations.length ||
    r.citations.some((id) => typeof id !== 'string' || !valid.has(id))
  )
    throw new Error('Model returned an invalid or ungrounded hypothesis');
  return {
    hypothesis: r.hypothesis,
    citations: [...new Set(r.citations)] as string[],
    nextStep: r.nextStep,
  };
}

/** Compatibility route: all generation now goes through the tested LangChain RAG service. */
export async function generateHypothesis(
  cluster: Cluster,
  rag: import('./rag/pipeline.ts').RagService,
  releaseId: string,
  windowDays: number,
) {
  const result = await rag.ask({
    question: `What evidence supports investigating this problem: ${cluster.title}? Distinguish observed symptoms from possible release-related causes.`,
    releaseId,
    windowDays,
  });
  return {
    hypothesis: result.answer,
    citations: [...new Set(result.citations.map((c) => c.sourceId))],
    nextStep:
      'Reproduce the reported symptom on this release and its predecessor; verify any suspected release change before proposing a fix.',
    model: result.trace.chatModel ?? 'retrieval abstention',
    usage: result.trace.usage,
    note: result.note,
    trace: result.trace,
  };
}
