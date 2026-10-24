/**
 * Challenge-mode work (ENGINEERING_BACKLOG B-26): run the job's plan, commit to every segment's output, submit, then
 * answer the segments the API draws — only after it stored the commitment, so the node cannot know them in advance.
 * The outputs stay in memory between the two calls; nothing is written to disk.
 *
 * A lost response must not cost an honest node its pay: a submit whose response never arrived is sent once more (the
 * API answers the same commitment with the challenge it already stored), and an answer is retried on network errors
 * and 5xx, with backoff, until the deadline.
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

/**
 * The challenged indices as the node will open them: integers of the plan, each once, sorted, never more than the plan
 * has. Anything else from the API is refused rather than answered (an answer is at most every segment, once).
 */
export function challengedSegments(raw: unknown, planLength: number): number[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > planLength) throw new Error("the API answered the commitment without a valid challenge");
  const segments = [...new Set(raw)];
  if (!segments.every((i) => Number.isInteger(i) && i >= 0 && i < planLength)) throw new Error("the API answered the commitment without a valid challenge");
  return (segments as number[]).sort((a, b) => a - b);
}

export interface ChallengeAssignment {
  jobId: string;
  workType: string;
  sigma: string;
  input: Int8MlpInput;
}

export interface RetryOptions {
  /** Whether a failed POST may be sent again: a network error or a 5xx (never a 4xx, never a bad signature). */
  retryable?: (err: unknown) => boolean;
  /** The server's clock (ms), to stop retrying at the deadline. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultRetryable = (err: unknown) => {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 500;
};

/** Submit, then answer the challenge. Returns what the API credited (the answer's response). */
export async function runChallengeJob(
  a: ChallengeAssignment,
  post: (path: string, body: unknown) => Promise<any>,
  opts: RetryOptions = {},
): Promise<{ laneAUcld: number; laneBUcld: number }> {
  const retryable = opts.retryable ?? defaultRetryable;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const invalid = validateInt8Mlp(a.input);
  if (invalid) throw new Error(`assignment input refused: ${invalid}`);
  const work = buildChallengeWork(a.input, a.sigma);
  const body = { jobId: a.jobId, commitment: work.commitment, result: work.result };
  let submitted: any;
  try {
    submitted = await post("/v1/work/submit", body);
  } catch (err) {
    if (!retryable(err)) throw err;
    // The response may be what was lost: the same commitment gets back the challenge the API already stored.
    submitted = await post("/v1/work/submit", body);
  }
  const segments = challengedSegments(submitted?.challenge?.segments, work.outputs.length);
  const deadline = Number(submitted?.challenge?.deadline);
  const answer = { jobId: a.jobId, openings: openSegments(work, segments) };
  for (let delay = 500; ; delay = Math.min(delay * 2, 5000)) {
    try {
      const answered = await post("/v1/work/answer", answer);
      return { laneAUcld: answered.earned?.laneAUcld ?? 0, laneBUcld: answered.earned?.laneBUcld ?? 0 };
    } catch (err) {
      if (!retryable(err) || !(now() + delay < deadline)) throw err;
      await sleep(delay);
    }
  }
}
