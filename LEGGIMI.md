# PROF – come metterla online

PROF è una web app: si apre dal browser o dall'icona sulla schermata Home, senza installare Claude.
Serve un computer solo per questi passaggi iniziali (circa 30 minuti).

Costi:
- **GitHub Pages** (indirizzo web): gratis.
- **Firebase** (account e dati): gratis, piano **Spark**, senza carta. È un progetto separato da InTurno, con i suoi limiti gratuiti.
- **Cloudflare** (il servizio che collega il prof a Claude): gratis. Puoi usare lo stesso account di InTurno.
- **Anthropic** (l'intelligenza artificiale del prof): **a consumo**, con un tetto di spesa che decidi tu. È l'unico costo.

## 1. Crea il progetto Firebase
1. Vai su https://console.firebase.google.com → **Aggiungi progetto** → nome "prof" → disattiva Google Analytics → **Crea**.
2. Il piano resta **Spark (gratuito)**: non attivare altri piani.

## 2. Attiva l'accesso
**Build → Authentication → Inizia** → **Metodo di accesso** → attiva **Email/password**.

## 3. Crea il database
1. **Build → Firestore Database → Crea database** → posizione **europe-west** → modalità **produzione**.
2. Scheda **Regole**: cancella tutto, incolla il file `firestore.rules`, premi **Pubblica**.

## 4. Prendi la configurazione
⚙️ **Impostazioni progetto** → **Le tue app** → icona **</>** → nome "PROF" → **Registra app**.
Manda a Claude in chat i valori di `firebaseConfig`: li inserisce lui nel file `config.js`.
Poi **Authentication → Impostazioni → Domini autorizzati → Aggiungi dominio**: `ellyrm83.github.io`.

## 5. La chiave di Anthropic
1. Vai su https://console.anthropic.com e crea l'account (serve una carta: si paga solo quello che si usa).
2. **Billing**: carica un credito iniziale (per esempio 10 €) e imposta un **limite di spesa mensile** (per esempio 15–20 €).
3. **API Keys → Create Key** → nome "prof" → copia la chiave (inizia con `sk-ant-`).
   **Non mandarla in chat e non scriverla in nessun file**: va solo su Cloudflare, al passo 6.

## 6. Il servizio del prof su Cloudflare
1. Su https://dash.cloudflare.com → **Workers & Pages → Crea → Importa un repository** → scegli il repository `prof`.
   - Nome progetto: `prof` · comando di deploy: `npx wrangler deploy` (il file `wrangler.jsonc` è già nella cartella principale).
2. Prima di pubblicare, in `strumenti/wrangler.jsonc` deve esserci il tuo `PROJECT_ID` di Firebase (lo inserisce Claude con il passo 4).
3. Dopo la pubblicazione: **Impostazioni → Variabili e segreti → Aggiungi → Segreto** → nome `ANTHROPIC_API_KEY` → incolla la chiave del passo 5.
4. Copia l'indirizzo del servizio (tipo `https://prof.<tuo-nome>.workers.dev`) e mandalo a Claude: lo inserisce in `config.js`.

## 7. Primo accesso
- Apri https://ellyrm83.github.io/PROF/ e tocca **Crea l'account**: il primo account diventa quello di PROF, e **nessun altro** può entrare.
- Sul tablet di Adriano apri lo stesso indirizzo ed entra con **la stessa email e password**. Così ritrova chat, schede, compiti e libri.
- **Android (Chrome)**: menu ⋮ → **Aggiungi a schermata Home**. **iPad (Safari)**: Condividi → **Aggiungi alla schermata Home**.

## Cosa resta sul dispositivo
Le foto, i PDF dei libri e le pagine stampate dallo Zaino restano salvati **sul dispositivo dove li carichi** (il piano gratuito di Firebase non conserva file). Caricali dal tablet di Adriano.
Chat, memoria del prof, schede, compiti, indici dei libri e lezioni sono nel database e si vedono ovunque.

## Sicurezza
- La chiave di Anthropic sta solo su Cloudflare: l'app non la vede mai.
- Il servizio risponde solo all'account di PROF (controlla l'accesso di Firebase).
- Il limite di spesa di Anthropic impedisce sorprese: se lo raggiungi, il prof si ferma fino al mese dopo.


## Voce naturale (facoltativa)
1. Vai su platform.openai.com → crea l'account → Billing → carica un credito (es. 5 $). Niente addebiti automatici.
2. API keys → Create new secret key → copiala con l'icona (non fare screenshot).
3. Cloudflare → Workers → prof → Impostazioni → Variabili e segreti → Aggiungi → tipo Segreto, nome `OPENAI_API_KEY`, valore la chiave → Distribuisci.
4. Nell'app: Impostazioni del genitore → Voce naturale → Prova.
