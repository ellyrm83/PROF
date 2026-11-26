// PROF: servizio che collega l'app a Claude (Cloudflare Worker, piano gratuito).
// Custodisce la chiave di Anthropic: l'app non la vede mai. Risponde solo all'account proprietario di PROF.
// Impostazioni (nel pannello Cloudflare, vedi LEGGIMI.md):
//   ANTHROPIC_API_KEY → la chiave presa da console.anthropic.com (segreto)
//   OPENAI_API_KEY → la chiave presa da platform.openai.com, per la voce naturale (segreto, facoltativo)
//   PROJECT_ID, ORIGIN → facoltativi (predefiniti: prof-2de3c, https://ellyrm83.github.io)
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
    const PID = env.PROJECT_ID || "prof-2de3c";
    const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") {
      return new Response("PROF AI: attivo · versione 5 · voce " + (env.OPENAI_API_KEY ? "naturale pronta" : "da collegare"), { headers: cors });
    }
    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let uid; try { uid = await verificaToken(tok, PID); } catch (e) { return new Response("accesso negato", { status: 401, headers: cors }); }
    if (!(await isOwner(uid, tok, PID))) return new Response("accesso negato", { status: 403, headers: cors });
    // comprensione della voce (OpenAI): POST /stt con l'audio registrato → testo, italiano o inglese riconosciuti da soli
    if (new URL(req.url).pathname === "/stt") {
      if (!env.OPENAI_API_KEY) return new Response("manca OPENAI_API_KEY", { status: 503, headers: cors });
      const type = (req.headers.get("Content-Type") || "audio/webm").split(";")[0];
      const buf = await req.arrayBuffer(); if (!buf.byteLength || buf.byteLength > 20e6) return new Response("audio non valido", { status: 400, headers: cors });
      const ext = /mp4|m4a|aac/.test(type) ? "mp4" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : /mpeg|mp3/.test(type) ? "mp3" : "webm";
      const fd = new FormData();
      fd.append("file", new File([buf], "voce." + ext, { type }));
      fd.append("model", "gpt-4o-mini-transcribe");
      fd.append("response_format", "json");
      fd.append("prompt", "Adriano, studente italiano di 14 anni, parla con il suo professore. Può parlare in italiano oppure in inglese (English speaking practice): trascrivi esattamente nella lingua in cui parla, senza tradurre.");
      let r;
      try { r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + env.OPENAI_API_KEY }, body: fd }); }
      catch (e) { return new Response("OpenAI non raggiungibile", { status: 502, headers: cors }); }
      const t = await r.text();
      if (!r.ok) return new Response("OpenAI " + r.status + ": " + t.slice(0, 200), { status: /quota|billing|insufficient/i.test(t) ? 402 : 502, headers: cors });
      let text = ""; try { text = JSON.parse(t).text || ""; } catch (e) {}
      return new Response(JSON.stringify({ text }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    // voce naturale del prof (OpenAI gpt-4o-mini-tts): POST /tts {text, lang, voice}
    if (new URL(req.url).pathname === "/tts") {
      if (!env.OPENAI_API_KEY) return new Response("manca OPENAI_API_KEY", { status: 503, headers: cors });
      let b; try { b = await req.json(); } catch (e) { return new Response("richiesta non valida", { status: 400, headers: cors }); }
      const text = String(b.text || "").slice(0, 3800); if (!text.trim()) return new Response("vuoto", { status: 400, headers: cors });
      const en = b.lang === "en";
      const VOCI = ["marin", "cedar", "ash", "ballad", "coral", "echo", "sage", "verse", "alloy", "nova", "onyx", "shimmer", "fable"];
      const voice = VOCI.includes(b.voice) ? b.voice : "cedar";
      const instructions = en
        ? "You are a warm, friendly English teacher talking one-to-one with a 14-year-old Italian student. Speak naturally and conversationally, like a real person, with a clear British accent, relaxed pace, natural pauses and gentle enthusiasm. Never sound like you are reading."
        : "Voce: italiano madrelingua, nato e cresciuto in Italia. Pronuncia italiana perfetta e naturale, ZERO accento straniero (niente accento americano o inglese): vocali italiane pure, R italiana, doppie ben marcate, accenti delle parole corretti, intonazione italiana. Tono: un professore simpatico e caloroso che parla a tu per tu con un ragazzo di 14 anni, come in una conversazione vera, ritmo rilassato, pause naturali, un sorriso nella voce; mai come uno che legge. IMPORTANTE: le parole e le frasi in inglese dentro il discorso (per esempio esempi di grammatica come I went, past simple, football) pronunciale con pronuncia inglese corretta, poi torna subito alla pronuncia italiana.";
      let r;
      try { r = await fetch("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer " + env.OPENAI_API_KEY }, body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: text, instructions, response_format: "mp3" }) }); }
      catch (e) { return new Response("OpenAI non raggiungibile", { status: 502, headers: cors }); }
      if (!r.ok) { const t = await r.text(); return new Response("OpenAI " + r.status + ": " + t.slice(0, 200), { status: /quota|billing|insufficient/i.test(t) ? 402 : 502, headers: cors }); }
      return new Response(r.body, { headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }
    let body; try { body = await req.json(); } catch (e) { return new Response("richiesta non valida", { status: 400, headers: cors }); }
    const tier = MODELS[body.tier] ? body.tier : "default";
    if (!Array.isArray(body.messages) || !body.messages.length || JSON.stringify(body.messages).length > 12e6) return new Response("richiesta non valida", { status: 400, headers: cors });
    if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ stato: 0, errore: "Manca il segreto ANTHROPIC_API_KEY su Cloudflare" }), { status: 502, headers: cors });
    const payload = { model: MODELS[tier], max_tokens: MAXTOK[tier], messages: body.messages, stream: true };
    // ricerca sul web (server di Anthropic): solo quando l'app la chiede, al massimo 3 ricerche per risposta
    if (body.web) payload.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
    let r;
    try { r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify(payload) }); }
    catch (e) { return new Response(JSON.stringify({ stato: 0, errore: "Anthropic non raggiungibile" }), { status: 502, headers: cors }); }
    if (!r.ok) {
      const t = await r.text();
      if (/credit balance|credit/i.test(t) && r.status === 400) return new Response("credito esaurito", { status: 402, headers: cors });
      // se la ricerca web non è attiva sull'account, riprova senza
      if (body.web && r.status === 400 && /web_search|tool/i.test(t)) { delete payload.tools; const r2 = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify(payload) }); if (r2.ok) return new Response(r2.body, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }); }
      let msg = t; try { msg = JSON.parse(t).error.message; } catch (e) {}
      return new Response(JSON.stringify({ stato: r.status, errore: String(msg).slice(0, 300) }), { status: r.status === 429 || r.status === 529 ? 429 : 502, headers: cors });
    }
    return new Response(r.body, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  },
};
