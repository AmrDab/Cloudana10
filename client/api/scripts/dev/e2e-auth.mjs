import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
const B = "http://127.0.0.1:8790/v1";
const acct = privateKeyToAccount(generatePrivateKey());
const addr = acct.address;
const j = async (p, init = {}) => { const r = await fetch(B + p, init); let b = null; try { b = await r.json(); } catch {} return { s: r.status, b }; };
const H = (t) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
const out = {};

const nonce = await j(`/auth/nonce?address=${addr}`);
out.nonce = nonce.s;
const sig = await acct.signMessage({ message: nonce.b.message });
const login = await j("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr, message: nonce.b.message, signature: sig }) });
out.login = login.s; const jwt = login.b?.token;
out.replayLogin = (await j("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr, message: nonce.b.message, signature: sig }) })).s;

const n2 = await j(`/auth/nonce?address=${addr}`);
const other = privateKeyToAccount(generatePrivateKey());
const badSig = await other.signMessage({ message: n2.b.message });
out.wrongSignerLogin = (await j("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr, message: n2.b.message, signature: badSig }) })).s;

out.balanceWithJwt = await j("/payments/balance", { headers: H(jwt) });
out.balanceFakeBearer = (await j("/payments/balance", { headers: H("0x000000000000000000000000000000000000dEaD") })).s;
out.balanceQueryAddress = (await j("/payments/balance?address=0x000000000000000000000000000000000000dEaD")).s;
out.historyNoAuth = (await j("/payments/history")).s;
out.convertPublic = (await j("/payments/convert?usd=1")).b;
out.scanNoAuth = (await j("/providers/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: "http://169.254.169.254" }) })).s;
out.scanPrivateIp = await j("/providers/scan", { method: "POST", headers: H(jwt), body: JSON.stringify({ endpoint: "http://169.254.169.254/latest" }) });
out.scanLocalhost = (await j("/providers/scan", { method: "POST", headers: H(jwt), body: JSON.stringify({ endpoint: "http://localhost:4040" }) })).b?.error;
out.scanFtp = (await j("/providers/scan", { method: "POST", headers: H(jwt), body: JSON.stringify({ endpoint: "ftp://1.2.3.4" }) })).b?.error;
out.ipfsNoAuth = (await j("/ipfs/pin", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).s;
out.ipfsNoSecret = (await j("/ipfs/pin", { method: "POST", headers: H(jwt), body: JSON.stringify({ content: { a: 1 } }) })).s;

let last = 0; for (let i = 0; i < 25; i++) last = (await j(`/auth/nonce?address=${addr}`)).s;
out.authRateLimitedAfter25 = last;
console.log(JSON.stringify(out, null, 1));
