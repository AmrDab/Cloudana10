/**
 * int8-model selftest: one block reproduces int8-mlp bit for bit, and the commitment and openings the agent builds for
 * a 4-block model pass the API's checks.
 */
import { checkCommitment, checkOpening } from "../../shared/verification.ts";
import { executeInt8Mlp, randomInt8MlpInput } from "../../shared/work-int8-mlp.ts";
import { int8ModelInputs, int8ModelKernel, int8ModelResultSig, randomInt8ModelInput } from "../../shared/work-int8-model.ts";
import { assignmentInput, buildChallengeWork, openSegments } from "./work.ts";
import { sha256hex } from "./signing.ts";

function fail(msg: string): never {
  console.error(`✗ int8-model selftest failed: ${msg}`);
  process.exit(1);
}

const mlp = randomInt8MlpInput(42, 2, 8, 8);
const { X, b, d, h, ...block } = mlp;
const one = buildChallengeWork({ b, d, h, X, blocks: [block] }, "ab".repeat(32), "int8-model");
if (JSON.stringify(one.result) !== JSON.stringify(executeInt8Mlp(mlp).result)) fail("L = 1 differs from int8-mlp");
console.log("✓ int8-model with one block equals int8-mlp");

const input = randomInt8ModelInput(5, 4, 4, 16, 24);
const sigma = "cd".repeat(32);
const work = buildChallengeWork(input, sigma, "int8-model");
const inputs = int8ModelInputs(input);
const bind = checkCommitment(sigma, inputs, work.plan, work.commitment, work.result, int8ModelResultSig(input));
if (!bind.ok) fail(`commitment refused: ${bind.reason}`);
for (const opening of openSegments(work, work.plan.map((s) => s.idx))) {
  const spec = work.plan[opening.idx];
  const v = checkOpening(spec, opening, work.commitment, inputs, int8ModelKernel(input, spec.op));
  if (!v.ok) fail(`opening of segment ${opening.idx} refused: ${v.reason}`);
}
console.log("✓ int8-model (L = 4) commitment and all 16 openings pass the API's checks");

// 1.9.0: the input is fetched and must hash to the signed inputHash; anything else is refused before any work.
const json = JSON.stringify(input);
const a = { jobId: "j1", workType: "int8-model", sigma, inputHash: sha256hex(json) };
let asked = "";
const got = await assignmentInput(a, async (p) => ((asked = p), json));
if (asked !== "/v1/work/jobs/j1/input" || JSON.stringify(got) !== json) fail(`fetched input not used as served (${asked})`);
const tampered = await assignmentInput(a, async () => json.replace("[", "[1,")).then(() => null, (e: Error) => e.message);
if (!tampered || !/does not match/.test(tampered)) fail("a fetched input that does not hash to inputHash was accepted");
const inline = await assignmentInput({ ...a, input: { inline: true } }, async () => fail("fetched although the input was inline"));
if ((inline as { inline?: boolean }).inline !== true) fail("an inline input was not used");
console.log("✓ int8-model input fetched and checked against the signed inputHash (a tampered one refused; inline kept)");
