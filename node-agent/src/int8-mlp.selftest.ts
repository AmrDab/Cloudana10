/**
 * int8-mlp selftest (ENGINEERING_BACKLOG B-26): the agent's executor reproduces the pinned golden vector bit for bit
 * (client/api/tests/int8-mlp.test.ts pins the same), and the commitment and openings it builds pass the API's checks.
 */
import { checkCommitment, checkOpening, tensorHash } from "../../shared/verification.ts";
import { executeInt8Mlp, int8MlpInputs, int8MlpKernel, int8MlpPlan, int8MlpResultSig, randomInt8MlpInput } from "../../shared/work-int8-mlp.ts";
import { buildChallengeWork, challengedSegments, openSegments, runChallengeJob } from "./work.ts";

const GOLDEN_RESULT = [-22, 33, -102, -24, -11, -54, 81, 19, -76, 127, 78, 6, 127, 123, -51, 115];
const GOLDEN_OUT_HASHES = [
  "b8a75b9de9e466c6c75026cf4df3a36cf8ecdf0186aa5520cf29a8c6313561bd",
  "5aff0b8851b5007e3dd4ae13670dca5c6fb99c40525e2e547825e4f7b3a08310",
  "b24fb5ee60d7e9e21825b90d8513701bde23d72cc74cbcd86488d9150e1cbcea",
  "495ad426e781ef12aadcad94e64ff90b6871649382cef443d4ee18d0b3be0650",
];

function fail(msg: string): never {
  console.error(`✗ int8-mlp selftest failed: ${msg}`);
  process.exit(1);
}

const golden = executeInt8Mlp(randomInt8MlpInput(42, 2, 8, 8));
if (JSON.stringify(golden.result.data) !== JSON.stringify(GOLDEN_RESULT)) fail(`result ${JSON.stringify(golden.result.data)} is not the golden vector`);
if (JSON.stringify(golden.outputs.map(tensorHash)) !== JSON.stringify(GOLDEN_OUT_HASHES)) fail("segment hashes differ from the golden vector");
console.log("✓ int8-mlp executor reproduces the golden vector");

const input = randomInt8MlpInput(5, 8, 32, 48);
const sigma = "cd".repeat(32);
const work = buildChallengeWork(input, sigma);
const plan = int8MlpPlan();
const inputs = int8MlpInputs(input);
const bind = checkCommitment(sigma, inputs, plan, work.commitment, work.result, int8MlpResultSig(input));
if (!bind.ok) fail(`commitment refused: ${bind.reason}`);
for (const opening of openSegments(work, [0, 1, 2, 3])) {
  const spec = plan[opening.idx];
  const v = checkOpening(spec, opening, work.commitment, inputs, int8MlpKernel(input, spec.op));
  if (!v.ok) fail(`opening of segment ${opening.idx} refused: ${v.reason}`);
}
if (checkCommitment("ef".repeat(32), inputs, plan, work.commitment, work.result, int8MlpResultSig(input)).ok) fail("commitment accepted under another σ");
console.log("✓ int8-mlp commitment and all four openings pass the API's checks; another σ is refused");

// Challenged indices: deduplicated, sorted, capped at the plan; anything else is refused.
if (JSON.stringify(challengedSegments([2, 2, 0], 4)) !== "[0,2]") fail("challenged indices are not deduplicated and sorted");
for (const bad of [[0, 1, 2, 3, 0], [4], [1.5], [], "0,1"]) {
  let threw = false;
  try {
    challengedSegments(bad, 4);
  } catch {
    threw = true;
  }
  if (!threw) fail(`challenge ${JSON.stringify(bad)} was accepted`);
}
console.log("✓ challenged indices are deduplicated, sorted and capped at the plan");

// Lost responses: a submit whose response was lost is sent once more; an answer is retried on 5xx / network errors
// until the deadline, never on a 4xx.
async function retries(): Promise<void> {
  const a = { jobId: "job-1", workType: "int8-mlp", sigma, input };
  const fake = (script: Record<string, unknown[]>) => {
    const calls: string[] = [];
    const post = async (path: string) => {
      calls.push(path);
      const next = script[path].shift();
      if (next instanceof Error) throw next;
      return next;
    };
    return { calls, post };
  };
  const lost = () => Object.assign(new Error("network"), { lost: true });
  const http = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
  const challenge = () => ({ challenge: { segments: [1, 3], deadline: 10_000 } });
  const paid = { earned: { laneAUcld: 949, laneBUcld: 40 } };
  const opts = {
    retryable: (e: unknown) => (e as { lost?: boolean }).lost === true || ((e as { status?: number }).status ?? 0) >= 500,
    now: () => 0,
    sleep: async () => {},
  };

  const ok = fake({ "/v1/work/submit": [lost(), challenge()], "/v1/work/answer": [http(503), lost(), paid] });
  const earned = await runChallengeJob(a, ok.post, opts);
  if (earned.laneAUcld !== 949 || ok.calls.join() !== "/v1/work/submit,/v1/work/submit,/v1/work/answer,/v1/work/answer,/v1/work/answer") {
    fail(`retries: ${ok.calls.join()} → ${JSON.stringify(earned)}`);
  }
  const refused = fake({ "/v1/work/submit": [challenge()], "/v1/work/answer": [http(422), paid] });
  if (await runChallengeJob(a, refused.post, opts).then(() => true, () => false)) fail("a 4xx answer was retried into a success");
  if (refused.calls.length !== 2) fail("a 4xx answer was retried");
  const late = fake({ "/v1/work/submit": [challenge()], "/v1/work/answer": [lost(), paid] });
  if (await runChallengeJob(a, late.post, { ...opts, now: () => 10_000 }).then(() => true, () => false)) fail("an answer was retried past the deadline");
  console.log("✓ a lost submit is sent once more; a lost answer is retried until the deadline; a refusal is not retried");
}
await retries();
