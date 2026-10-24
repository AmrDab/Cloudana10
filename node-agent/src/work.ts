/**
 * Challenge-mode work (ENGINEERING_BACKLOG B-26): run the job's plan, commit to every segment's output, submit, then
 * answer the segments the API draws — only after it stored the commitment, so the node cannot know them in advance.
 * The outputs stay in memory between the two calls; nothing is written to disk.
 */
import { makeCommitment, type Commitment, type SegmentOpening, type Tensor, type TensorRef } from "../../shared/verification.ts";
import { executeInt8Mlp, int8MlpInputs, int8MlpPlan, validateInt8Mlp, type Int8MlpInput } from "../../shared/work-int8-mlp.ts";

export interface ChallengeWork {
  commitment: Commitment;
  result: Tensor;
  outputs: Tensor[];
}

export function buildChallengeWork(input: Int8MlpInput, sigma: string): ChallengeWork {
  const { outputs, result } = executeInt8Mlp(input);
  return { commitment: makeCommitment(sigma, int8MlpInputs(input), int8MlpPlan(), outputs), result, outputs };
}

/** Each challenged segment's opening: the `seg:j` tensors it reads and its own output. Job inputs are never sent. */
export function openSegments(work: ChallengeWork, segments: number[]): SegmentOpening[] {
  const plan = int8MlpPlan();
  return segments.map((idx) => {
    const tensors: Partial<Record<TensorRef, Tensor>> = { [`seg:${idx}`]: work.outputs[idx] };
    for (const ref of plan[idx].inputs) if (ref.startsWith("seg:")) tensors[ref] = work.outputs[Number(ref.slice(4))];
    return { idx, tensors };
  });
}

export interface ChallengeAssignment {
  jobId: string;
  workType: string;
  sigma: string;
  input: Int8MlpInput;
}

/** Submit, then answer the challenge. Returns what the API credited (the answer's response). */
export async function runChallengeJob(
  a: ChallengeAssignment,
  post: (path: string, body: unknown) => Promise<any>,
): Promise<{ laneAUcld: number; laneBUcld: number }> {
  const invalid = validateInt8Mlp(a.input);
  if (invalid) throw new Error(`assignment input refused: ${invalid}`);
  const work = buildChallengeWork(a.input, a.sigma);
  const submitted = await post("/v1/work/submit", { jobId: a.jobId, commitment: work.commitment, result: work.result });
  const segments = submitted?.challenge?.segments;
  if (!Array.isArray(segments) || !segments.every((i) => Number.isInteger(i) && i >= 0 && i < work.outputs.length)) {
    throw new Error("the API answered the commitment without a challenge");
  }
  const answered = await post("/v1/work/answer", { jobId: a.jobId, openings: openSegments(work, segments) });
  return { laneAUcld: answered.earned?.laneAUcld ?? 0, laneBUcld: answered.earned?.laneBUcld ?? 0 };
}
