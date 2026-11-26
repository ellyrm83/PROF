// PROF: servizio che collega l'app a Claude (Cloudflare Worker, piano gratuito).
// Custodisce la chiave di Anthropic: l'app non la vede mai. Risponde solo all'account proprietario di PROF.
// Impostazioni (nel pannello Cloudflare, vedi LEGGIMI.md):
//   ANTHROPIC_API_KEY → la chiave presa da console.anthropic.com (segreto)
//   PROJECT_ID        → id del progetto Firebase di PROF
//   ORIGIN            → https://ellyrm83.github.io
const MODELS = { quick: "claude-haiku-5-5", default: "claude-haiku-5-5", complex: "claude-sonnet-5-5" };
// default = Haiku (economico); complex = Sonnet: lo usa l'app per le materie in "qualità alta", le foto, gli indici e la correzione finale dell'esposizione
const MAXTOK = { quick: 900, default: 1600, complex: 8000 };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const enc = new TextEncoder();
let JWKS = null, JWKS_T = 0;

async function verificaToken(tok, projectId) {
  const [h, p, sg] = String(tok || "").split("."); if (!h || !p || !sg) throw new Error("token");
  const head = JSON.parse(new TextDecoder().decode(unb64u(h))), pay = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (head.alg !== "RS256") throw new Error("alg");
  if (!JWKS || Date.now() - JWKS_T > 3600e3) { const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"); JWKS = (await r.json()).keys; JWKS_T = Date.now(); }
  const jwk = JWKS.find(k => k.kid === head.kid); if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64u(sg), enc.encode(h + "." + p)))) throw new Error("firma");
  const now = Date.now() / 1000;
  if (pay.aud !== projectId || pay.iss !== "https://securetoken.google.com/" + projectId || pay.exp < now || !pay.sub) throw new Error("claim");
  return pay.sub;
}

// controlla su Firestore (con il permesso di chi chiama) che sia l'account proprietario di PROF
const OWNER = new Map();
async function isOwner(uid, tok, projectId) {
  const c = OWNER.get(uid); if (c && Date.now() - c < 3600e3) return true;
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/config/owner`, { headers: { Authorization: "Bearer " + tok } });
  if (!r.ok) return false; const d = await r.json();
  const ok = d && d.fields && d.fields.uid && d.fields.uid.stringValue === uid; if (ok) OWNER.set(uid, Date.now()); return ok;
}

export default {
  async fetch(req, env) {
    const origin = env.ORIGIN || "https://ellyrm83.github.io";
    const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("PROF AI: attivo", { headers: cors });
    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let uid; try { uid = await verificaToken(tok, env.PROJECT_ID); } catch (e) { return new Response("accesso negato", { status: 401, headers: cors }); }
    if (!(await isOwner(uid, tok, env.PROJECT_ID))) return new Response("accesso negato", { status: 403, headers: cors });
    let body; try { body = await req.json(); } catch (e) { return new Response("richiesta non valida", { status: 400, headers: cors }); }
    const tier = MODELS[body.tier] ? body.tier : "default";
    if (!Array.isArray(body.messages) || !body.messages.length || JSON.stringify(body.messages).length > 12e6) return new Response("richiesta non valida", { status: 400, headers: cors });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODELS[tier], max_tokens: MAXTOK[tier], messages: body.messages, stream: true }),
    });
    if (!r.ok) { const t = await r.text(); return new Response(t, { status: r.status === 429 || r.status === 529 ? 429 : 502, headers: cors }); }
    return new Response(r.body, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  },
};
