/**
 * int8-mlp selftest (ENGINEERING_BACKLOG B-26): the agent's executor reproduces the pinned golden vector bit for bit
 * (client/api/tests/int8-mlp.test.ts pins the same), and the commitment and openings it builds pass the API's checks.
 */
import { checkCommitment, checkOpening, tensorHash } from "../../shared/verification.ts";
import { executeInt8Mlp, int8MlpInputs, int8MlpKernel, int8MlpPlan, int8MlpResultSig, randomInt8MlpInput } from "../../shared/work-int8-mlp.ts";
import { buildChallengeWork, openSegments } from "./work.ts";

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
