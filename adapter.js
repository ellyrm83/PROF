// PROF – collegamento a Firebase (piano gratuito Spark) e al servizio AI su Cloudflare.
// Fornisce all'app le stesse funzioni che usava dentro Claude: db, user, sample (il prof), dictation (microfono).
(function () {
  const cfg = window.PROF_FIREBASE, AI = (window.PROF_AI || {}).url || "";
  let ready; const whenReady = new Promise(r => (ready = r));
  let impl = {};
  window.claude = { use: n => whenReady.then(() => impl[n] || null) };

  // ---------- schermata di accesso ----------
  const css = `#gate{position:fixed;inset:0;z-index:50;background:radial-gradient(120% 90% at 20% 0%,#2c3e4c,#22313d);color:#f3f5ef;display:grid;place-items:center;padding:20px;font:17px/1.5 "Atkinson Hyperlegible",system-ui,sans-serif}
#gate .box{width:min(420px,100%)}#gate h1{font-family:Kalam,cursive;font-size:56px;margin:0 0 4px}#gate p{color:#cfd8d2;margin:4px 0 14px}
#gate label{display:block;font-weight:700;margin:10px 0 4px}#gate input{width:100%;padding:12px;border-radius:10px;border:2px solid #ffd53d;font-size:17px;background:#fff;color:#18202a;-webkit-text-fill-color:#18202a;caret-color:#1b3fae}#gate input::placeholder{color:#7a8590;-webkit-text-fill-color:#7a8590}
#gate button{min-height:48px;padding:8px 18px;border-radius:12px;border:2px solid #ffd53d;font-weight:700;font-size:16px;margin:12px 8px 0 0;cursor:pointer}
#gate .a{background:#ffd53d;color:#1c242c}#gate .b{background:transparent;color:#ffd53d}#gate .err{color:#ffb4a8;min-height:1.5em}#gate .s{font-size:14px;color:#9fb0ba}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const whenDom = f => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", f) : f();
  function gate(html) { whenDom(() => { let g = document.getElementById("gate"); if (!g) { g = document.createElement("div"); g.id = "gate"; document.body.appendChild(g); } g.innerHTML = '<div class="box">' + html + "</div>"; }); }
  const ungate = () => { const g = document.getElementById("gate"); if (g) g.remove(); };

  if (!cfg || !cfg.apiKey || String(cfg.apiKey).includes("INCOLLA")) { gate("<h1>PROF</h1><p>Manca la configurazione di Firebase: segui il file LEGGIMI.md (passo 4).</p>"); return; }
  if (!window.firebase) { gate("<h1>PROF</h1><p>Non riesco a collegarmi. Controlla la rete e riapri l'app.</p>"); return; }
  firebase.initializeApp(cfg);
  const auth = firebase.auth(), fs = firebase.firestore();
  try { fs.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) {}
  try { fs.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) {}

  function login(msg) {
    gate(`<h1>PROF</h1><p>Entra con l'account di PROF. Su tutti i dispositivi si usa lo stesso account: così Adriano ritrova chat, schede e compiti.</p>
      <label for="gem">Email</label><input id="gem" type="email" autocomplete="email">
      <label for="gpw">Password (almeno 6 caratteri)</label><input id="gpw" type="password" autocomplete="current-password">
      <button class="a" id="gin">Entra</button><button class="b" id="gup">Crea l'account (solo la prima volta)</button>
      <p class="err" id="gerr">${msg || ""}</p><p class="s"><button class="b" id="grs" style="min-height:36px;font-size:14px;margin:0">Password dimenticata</button></p>`);
    whenDom(() => {
      const em = () => document.getElementById("gem").value.trim(), pw = () => document.getElementById("gpw").value;
      const fail = e => { const m = { "auth/invalid-credential": "Email o password non corretti.", "auth/wrong-password": "Password non corretta.", "auth/user-not-found": "Account non trovato.", "auth/email-already-in-use": "Questa email ha già un account: tocca Entra.", "auth/weak-password": "La password deve avere almeno 6 caratteri.", "auth/invalid-email": "Email non valida.", "auth/network-request-failed": "Nessuna connessione." }[e && e.code]; document.getElementById("gerr").textContent = m || "Errore: " + (e && e.message || e); };
      document.getElementById("gin").onclick = () => auth.signInWithEmailAndPassword(em(), pw()).catch(fail);
      document.getElementById("gup").onclick = () => auth.createUserWithEmailAndPassword(em(), pw()).catch(fail);
      document.getElementById("grs").onclick = () => { if (!em()) { document.getElementById("gerr").textContent = "Scrivi prima l'email."; return; } auth.sendPasswordResetEmail(em()).then(() => document.getElementById("gerr").textContent = "Ti ho mandato un'email per cambiare la password.").catch(fail); };
    });
  }
  window.__logout = () => auth.signOut().then(() => location.reload());

  // ---------- db (stessa interfaccia usata dall'app) ----------
  const clean = d => JSON.parse(JSON.stringify(d === undefined ? {} : d));
  const err = e => ({ code: e && e.code === "permission-denied" ? "invalid_argument" : e && e.code === "resource-exhausted" ? "resource_exhausted" : "unavailable", message: e && e.message || String(e) });
  const meta = s => ({ fromCache: !!(s.metadata && s.metadata.fromCache), hasPendingWrites: !!(s.metadata && s.metadata.hasPendingWrites) });
  const dsnap = s => ({ id: s.id, exists: s.exists, data: () => (s.exists ? s.data() : undefined), metadata: meta(s) });
  const qsnap = s => { const docs = s.docs.map(dsnap); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta(s) }; };
  function docRef(path) { const ref = fs.doc(path); return { id: ref.id, path,
    get: () => ref.get().then(dsnap).catch(e => { throw err(e); }), set: d => ref.set(clean(d)).catch(e => { throw err(e); }),
    update: d => ref.set(clean(d), { merge: true }).catch(e => { throw err(e); }), delete: () => ref.delete().catch(e => { throw err(e); }),
    onSnapshot: (n, b) => ref.onSnapshot(s => n(dsnap(s)), e => b && b(err(e))), collection: c => colRef(path + "/" + c) }; }
  function colRef(path) { const ref = fs.collection(path); return { path,
    doc: id => docRef(path + "/" + (id || ref.doc().id)), add: d => ref.add(clean(d)).then(r => docRef(path + "/" + r.id)),
    get: () => ref.get().then(qsnap).catch(e => { throw err(e); }), onSnapshot: (n, b) => ref.onSnapshot(s => n(qsnap(s)), e => b && b(err(e))),
    where() { return this; }, orderBy() { return this; }, limit() { return this; } }; }
  const db = { doc: docRef, collection: colRef };

  // ---------- il prof (Claude, tramite il servizio su Cloudflare) ----------
  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  async function sample(input, opts = {}) {
    if (!AI) throw { code: "not_granted", message: "Servizio AI non configurato (LEGGIMI, passo 6)." };
    let msgs = typeof input === "string" ? [{ role: "user", content: input }] : input.map(m => ({ role: m.role, content: m.content }));
    msgs = msgs.map(m => ({ role: m.role, content: [{ type: "text", text: String(m.content) }] }));
    // il primo messaggio (istruzioni del prof) resta in memoria per 5 minuti: costa molto meno
    if (msgs.length > 1 && msgs[0].content[0].text.length > 3000) msgs[0].content[0].cache_control = { type: "ephemeral" };
    if (opts.images && opts.images.length) { const last = msgs[msgs.length - 1]; for (const im of opts.images.slice(0, 8)) last.content.unshift({ type: "image", source: { type: "base64", media_type: im.type && im.type.startsWith("image/") ? im.type : "image/jpeg", data: await b64(im) } }); }
    const token = await auth.currentUser.getIdToken();
    let r;
    try { r = await fetch(AI, { method: "POST", signal: opts.signal, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ tier: opts.modelTier || "default", messages: msgs, stream: true }) }); }
    catch (e) { if (e && e.name === "AbortError") throw e; throw { code: "unavailable", message: "rete" }; }
    if (!r.ok) { const code = r.status === 402 ? "credit" : r.status === 429 ? "rate_limited" : r.status === 401 || r.status === 403 ? "not_granted" : "unavailable"; throw { code, message: await r.text().catch(() => "") }; }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "", text = "", stop = "";
    for (;;) { const { done, value } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n\n")) >= 0) { const ev = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = ev.split("\n").find(l => l.startsWith("data:")); if (!line) continue; let d; try { d = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (d.type === "content_block_delta" && d.delta && d.delta.type === "text_delta") { text += d.delta.text; if (opts.onText) try { opts.onText({ text, delta: d.delta.text }); } catch (e) {} }
        else if (d.type === "message_delta" && d.delta) stop = d.delta.stop_reason || stop;
        else if (d.type === "error") throw { code: d.error && d.error.type === "overloaded_error" ? "rate_limited" : "unavailable", message: d.error && d.error.message }; } }
    return { text, truncated: stop === "max_tokens" };
  }
  sample.limits = async () => ({ images: true });

  // ---------- microfono: dettatura del browser ----------
  function dictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return null;
    let rec = null, want = false, state = "idle", lang = "it-IT", stopRes = null;
    const H = { p: new Set(), f: new Set(), s: new Set() };
    const emit = (k, v) => H[k].forEach(f => { try { f(v); } catch (e) {} });
    const set = (s, reason) => { state = s; emit("s", reason ? { state: s, reason } : { state: s }); };
    function make() { rec = new SR(); rec.lang = lang; rec.continuous = true; rec.interimResults = true;
      rec.onresult = e => { let part = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) emit("f", { text: " " + t.trim() }); else part += t; } emit("p", { text: part }); };
      rec.onerror = e => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { want = false; set("idle", "not_granted"); } };
      rec.onend = () => { emit("p", { text: "" }); if (want) { try { rec.start(); return; } catch (e) {} } set("idle", stopRes ? "stopped" : "viewer_stopped"); if (stopRes) { stopRes(); stopRes = null; } }; }
    return {
      start(o) { lang = o && o.language === "en" ? "en-GB" : "it-IT"; want = true; make(); try { rec.start(); set("listening"); return Promise.resolve(); } catch (e) { want = false; return Promise.reject({ code: "upstream_error", message: String(e) }); } },
      stop() { want = false; if (!rec || state === "idle") return Promise.resolve(); set("finishing"); return new Promise(r => { stopRes = r; try { rec.stop(); } catch (e) { r(); } }); },
      active: () => state !== "idle",
      onPartial: f => (H.p.add(f), () => H.p.delete(f)), onFinal: f => (H.f.add(f), () => H.f.delete(f)), onState: f => (H.s.add(f), () => H.s.delete(f)),
    };
  }

  // ---------- avvio ----------
  let started = false;
  auth.onAuthStateChanged(async u => {
    if (!u) { login(); return; }
    if (started) return; started = true;
    // la prima persona che entra diventa la proprietaria: solo il suo account può usare PROF
    try { const o = await fs.doc("config/owner").get(); if (!o.exists) await fs.doc("config/owner").set({ uid: u.uid, creato: new Date().toISOString() });
      else if (o.data().uid !== u.uid) { gate("<h1>PROF</h1><p>Questo account non è quello di PROF. Entra con l'account di casa.</p><button class='b' onclick='__logout()'>Esci</button>"); return; } }
    catch (e) { if (e && e.code === "permission-denied") { gate("<h1>PROF</h1><p>Questo account non è quello di PROF. Entra con l'account di casa.</p><button class='b' onclick='__logout()'>Esci</button>"); return; } }
    const user = { id: async () => u.uid, isOwner: async () => true, canEdit: async () => true, can: async () => true, email: async () => u.email };
    impl = { db, user, sample, dictation: dictation() };
    ungate(); ready();
  });
})();
