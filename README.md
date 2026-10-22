# CD Collection Scanner

Applicazione web **in italiano**, responsive, senza login per l'utente finale. Catalogazione di CD musicali da foto delle coste mediante OCR **nel browser**, identificazione tramite MusicBrainz, salvataggio locale in IndexedDB ed esportazione CSV / Excel / backup JSON.

**Prezzi eBay autentici: nessun prezzo fittizio.** Il modulo automatico opzionale usa l'endpoint documentato `GET https://api.trawl.dev/ebay/v1/sold`, limitato a **eBay Regno Unito (GB)**. Sono esclusi i casi di Best Offer per cui non è dimostrabile l'importo effettivo. Per eBay IT/DE/FR/ES il software offre link alla ricerca dei venduti e registrazione assistita dopo verifica dell'utente. Al momento NON è lecito sostenere una copertura automatica dei cinque mercati con questa API.

## 1. Cosa funziona senza chiavi

- Importazione multipla JPG, PNG, WEBP e acquisizione dalla fotocamera; trascinamento delle foto.
- Anteprima, rotazione, zoom, selezione manuale di una regione dell'immagine.
- Riconoscimento locale con Tesseract.js (lingua inglese, testi latini); preprocessing con miglioramento contrasto e prova di rotazioni 0°, 90°, 270°.
- Segmentazione euristica delle coste per differenze di luminanza; supporto a fotografie con più dorsi e tentativi MusicBrainz di separazione artista/album anche in assenza di separatori. **Non è garantita** la lettura corretta di tutti i CD nelle foto dense o poco nitide. Quando non riesce, l'utente corregge o seleziona manualmente.
- Identificazione MusicBrainz, scelta di release-group e, se disponibili, edizioni CD (data, paese). Occorre connettività Internet e rispettare i limiti MusicBrainz.
- Tabella CD/Album/Data uscita/Venduto 1/Venduto 2/Venduto 3, editing, ricerca, ordinamento, inserimento/eliminazione.
- IndexedDB automatico su quel browser; esportazione CSV, XLSX (2 fogli: collezione, fonti), JSON; importazione JSON con eliminazione duplicati.
- Ricerca assistita eBay per 5 paesi. Nessun annuncio attivo riempie automaticamente le celle.
- Dettaglio di ciascuna vendita con URL eBay, data, valuta, fonte, condizioni, spedizione, eventuale cambio.

**Privacy:** le foto non vengono caricate dal software su un server. Le stringhe artista/album vengono inviate a MusicBrainz per il riconoscimento e, se configurato, al Worker Trawl per cercare i prezzi. Le immagini caricate sono temporanee e non vengono conservate nel backup; dati OCR, metadati, vendite e fonti sì.

## 2. Requisiti per lo sviluppo

- Node.js 22 LTS + npm (solo sulla macchina **dello sviluppatore**, mai sul PC dell'utente finale)
- Un account GitHub per pubblicare, senza server per il frontend
- Facoltativi: account Cloudflare e chiave Trawl per ricerca prezzi automatica UK

Dalla cartella principale:

```bash
npm install
npm run dev
```

Visita `http://localhost:5173`. Dopo la prima installazione, **includi `package-lock.json` nel repository** per build riproducibili e `npm ci` nel workflow.

Verifiche locali:

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

Il codice viene distribuito come **sorgenti**, non come `node_modules` o `dist`. Le dipendenze si scaricano con `npm install` nella tua macchina oppure con GitHub Actions in fase di pubblicazione.

## 3. Configurare la ricerca AUTOMATICA dei venduti UK

La sola API eBay Browse **non** fornisce storici venduti. La Marketplace Insights è `Limited Release` e deve essere approvata da eBay: non è inclusa alcuna chiamata non autorizzata. Dal 2026 le normali ricerche di pagine pubbliche dei venduti possono richiedere login; per questo l'app non usa scraping HTML o SerpApi per simulare vendite.

Il Worker incluso legge i **prezzi di vendita** pubblicati da Trawl per `EBAY_GB`, mai annunci attivi. **Attenzione:** quando la fonte pubblica un prezzo annunciato per una Best Offer accettata ma non l'effettivo, il Worker scarta il risultato. La regola conservativa `best_offer_available === false` può scartare anche vendite valide; è intenzionale. Trawl richiede un account e crediti; controlla il piano e le condizioni sul sito del provider.

### 3A. Crea la chiave Trawl

1. Apri https://trawl.dev/docs e registra un account.
2. Ottieni una chiave API nel pannello di Trawl.
3. **Non** scrivere mai la chiave nel frontend, nelle variabili `VITE_*`, nel GitHub repository o nei commit.

### 3B. Pubblica il Cloudflare Worker

Da `worker/`:

```bash
cd worker
npm install
npx wrangler login
```

Il Worker usa già il dominio GitHub collegato `CastoroBoy`: se pubblichi su un altro account, modifica `worker/wrangler.toml` con il dominio corretto. L'origine per Pages dev'essere `https://CastoroBoy.github.io` (senza `/nome-repository`). Se usi un dominio personalizzato, usa la sua origine, es. `https://cd.example.org`.

```bash
npx wrangler secret put TRAWL_API_KEY
# incolla la chiave nella richiesta di Wrangler
npm run deploy
```

Il comando restituisce un URL simile a `https://cd-collection-prices.<account>.workers.dev`. Per una prova locale del Worker puoi usare `npm run dev`; la chiave locale può stare in `worker/.dev.vars` nel formato `TRAWL_API_KEY=...` (file escluso dal repository), **mai nei file pubblici**.

**Sicurezza e costi:** il Worker è senza login, quindi chiunque che riesca a fare richieste server-side può potenzialmente consumare i tuoi crediti, anche con CORS impostato. La cache per 6 ore riduce richieste duplicate ma **non è un meccanismo di autenticazione o rate limiting**. Prima di esporre il Worker al pubblico applica rate limiting / WAF Cloudflare, budget e alert sui crediti del provider oppure restringi l'accesso a un uso privato. Non pubblicare una chiave Trawl in alcun file.

### 3C. Collega la pagina al Worker

Per sviluppo locale copia `.env.example` in `.env.local` e imposta:

```dotenv
VITE_PRICE_API_URL=https://cd-collection-prices.TUOACCOUNT.workers.dev
```

Nel repository GitHub, vai a **Settings → Secrets and variables → Actions → Variables → New repository variable** e crea:

| Nome | Valore |
|---|---|
| `VITE_PRICE_API_URL` | URL HTTPS pubblico del tuo Worker, **senza barra finale** |

Questo indirizzo non è segreto. La chiave API resta esclusivamente nel Cloudflare Worker come secret. Senza la variabile, la pagina continua a funzionare con **ricerca assistita**.

La funzione `/health` restituisce copertura GB e stato configurazione. La funzione `/sold?artist=Pink%20Floyd&album=The%20Wall` serve esclusivamente prezzi venduti GB. Cloudflare effettua controlli delle origini del browser e cache; l'API downstream richiede la chiave.

### Paesi automatici

| Paese | eBay venduti automatici | Modalità senza provider |
|---|---|---|
| Italia (`IT`) | **No** | Ricerca assistita, inserimento documentato |
| Germania (`DE`) | **No** | Ricerca assistita, inserimento documentato |
| Francia (`FR`) | **No** | Ricerca assistita, inserimento documentato |
| Spagna (`ES`) | **No** | Ricerca assistita, inserimento documentato |
| Regno Unito (`GB`) | **Sì, solo configurando Trawl** | Ricerca assistita, inserimento documentato |

Il progetto separa il modulo dei prezzi (`src/lib/prices.ts`) dal recupero lato Worker (`worker/src/index.ts`): è possibile aggiungere un provider autorizzato con prova documentata di vendita e, eventualmente, Marketplace Insights se approvato, senza cambiare OCR e collezione. Nessuna copertura viene dichiarata senza contratto reale.

## 4. Pubblicare GitHub Pages, passo per passo

1. Apri **https://github.com/new** e crea un repository **pubblico** dal tuo account `CastoroBoy`, chiamato esattamente `cd-collection-scanner`. Lascialo **vuoto**: non aggiungere README, `.gitignore` o licenza dalla pagina GitHub, perché sono già nel progetto.
2. Carica **tutti i file del progetto**, inclusa la cartella `.github/workflows`, tranne `node_modules`, `.env.local`, `.dev.vars`. Con terminale:

   ```bash
   git init
   git add .
   git commit -m "Prima versione CD Collection Scanner"
   git branch -M main
   git remote add origin https://github.com/CastoroBoy/cd-collection-scanner.git
   git push -u origin main
   ```

3. Nel repository apri **Settings → Pages** e imposta **Build and deployment → Source: GitHub Actions**.
4. Apri **Actions → Pubblica GitHub Pages**. Il workflow compila e distribuisce da `dist/`.
5. Apri `https://CastoroBoy.github.io/cd-collection-scanner/` (l’URL presuppone che il repository si chiami `cd-collection-scanner`).
6. Per aggiornare il sito fai modifiche, `git add .`, `git commit -m "Aggiornamento"`, `git push`. Il sito si aggiorna tramite Actions.

Il progetto imposta `base: './'` in Vite, quindi funziona nei sottopercorsi GitHub Pages e senza backend frontend. Chrome, Firefox, Edge, Safari moderni sono l'obiettivo; usa connessione HTTPS (GitHub Pages la fornisce). Verifica che il browser non blocchi IndexedDB e il download dei file.

## 5. Procedura d'uso

1. Premi **📷 CARICA FOTO DEI CD** oppure **Scatta foto**; puoi trascinare diverse immagini.
2. Se necessario **Ruota 90°**, ingrandisci e premi **SCANSIONA TUTTE LE FOTO**. Se non rileva una costa, trascina un rettangolo e scegli **Scansiona zona selezionata**.
3. Nel pannello di revisione modifica i campi OCR e usa **Identifica con MusicBrainz**. Se MusicBrainz propone diverse versioni scegli la release-group corretta e, quando disponibile, l'edizione **CD**. Conferma ogni scheda: informazioni non identificate restano marcate come incerte.
4. Usa **CERCA PREZZI VENDUTI SU EBAY** o **AGGIORNA PREZZI**. Se il Worker è configurato cerca GB; altri mercati rimangono con collegamenti alla verifica manuale. La barra mostra CD elaborati, trovati, non trovati, errori.
5. In tabella seleziona una riga e premi **CERCA PREZZO SINGOLO** per aggiornarla. Clicca su un prezzo per vedere il titolo, la fonte, il cambio e le condizioni.
6. Puoi salvare in locale e creare file CSV, XLSX e backup JSON completo. I backup sono indispensabili per spostare dati tra dispositivi o dopo pulizia del browser.

### Come vengono scelti i prezzi

- L'endpoint Trawl elenca **oggetti venduti**. Non usa Browse API o annunci correnti.
- Richiede artista, titolo e supporto CD riconoscibili nel titolo; esclude parole indicative di vinili, cassette, lotti, box set e versioni incompatibili.
- Se l'edizione è segnalata, controlla i marcatori noti di ristampa, deluxe e remaster; i titoli eBay incompleti potrebbero comunque richiedere verifica umana.
- Scarta Best Offer con importo effettivo non documentato; per sicurezza scarta anche annunci che **ammettevano** Best Offer quando non è dimostrato che l'importo pubblicato sia l'importo pagato.
- Deduplica per inserzione e conserva fino a 3 risultati recenti. Nessun prezzo viene creato per completare tre colonne.
- Memorizza GBP e cambio GBP→EUR ottenuto da [Frankfurter](https://frankfurter.dev/), con data del cambio. Se la conversione non è disponibile, visualizza GBP e non inventa una cifra in euro.
- L'aggiornamento non cancella le vendite passate se la richiesta fallisce o non trova nuove inserzioni.
- La stima somma i prezzi **medi per CD** solo quando esistono vendite documentate convertibili in EUR; mostra sempre quanti CD sono esclusi.

## 6. Struttura del repository

```text
cd-collection-scanner/
├── .github/workflows/deploy.yml   # build, test e GitHub Pages
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── postcss.config.cjs
├── tailwind.config.cjs
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.tsx
│   ├── styles.css
│   ├── App.tsx
│   ├── components/
│   │   ├── PhotoScanner.tsx
│   │   ├── PricePanel.tsx
│   │   └── ReviewDrawer.tsx
│   ├── lib/
│   │   ├── types.ts
│   │   ├── helpers.ts
│   │   ├── musicbrainz.ts
│   │   ├── ocr.ts
│   │   ├── storage.ts
│   │   ├── prices.ts
│   │   └── export.ts
│   └── tests/helpers.test.ts
└── worker/
    ├── package.json
    ├── tsconfig.json
    ├── wrangler.toml
    └── src/index.ts
```

## 7. Verifica dei requisiti e limiti delle prove

I test automatici in `src/tests/helpers.test.ts` verificano deduplicazione, filtraggio dei titoli incongruenti, nessun prezzo sintetico, esclusione dei CD senza prezzi dalla stima, URL eBay per venduti, segmentazione su un profilo sintetico di 10 dorsi. **Non sostituiscono** la prova reale sulle fotografie o una connessione API autenticata.

| Scenario | Come verificarlo | Condizioni / limiti |
|---|---|---|
| 10 coste in un'unica foto | Caricare foto reale, analizzare regioni, correggere | OCR euristico; non è garantita l'esatta segmentazione |
| Correzione titolo | Inserire titolo, confermare, ricaricare | IndexedDB disponibile |
| Titolo/anno MusicBrainz | Usare Identifica e scegliere release-group | Internet e risultati MusicBrainz |
| 3 vendite autentiche con fonte | Configurare Trawl, trovare 3 oggetti eleggibili | Solo GB, crediti, disponibilità, esclusione Best Offer |
| CD senza vendite | Effettuare ricerca senza risultati | Deve mostrare N.D. |
| Persistenza dopo refresh | Aggiungere CD, aggiornare la pagina | Non usare navigazione privata / cancellazione dati |
| Esportazione Excel | Premere Excel e aprire il file | Browser con download abilitati |
| URL GitHub Pages pubblico | Pubblicare tramite Actions e navigare al link | Repository e configurazione Pages dell'utente |

**Stato delle verifiche di questa consegna:** i file sono stati generati e controllati sintatticamente dove possibile. In questo ambiente la rete per scaricare pacchetti npm non è disponibile; non posso attestare l'esecuzione di `npm install`, la build web completa, una prova browser end-to-end, una vendita Trawl autentica oppure la pubblicazione reale del repository. Dopo aver installato i pacchetti, esegui i comandi della sezione 2 e verifica la matrice qui sopra.

## 8. Riferimenti tecnici

- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) e [limite una richiesta/s](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [eBay Marketplace Insights API — accesso limitato](https://www.edp.ebay.com/api-docs/buy/marketplace-insights/static/overview.html)
- [Trawl Sold Listings API — mercati GB e US](https://trawl.dev/docs/ebay/sold)
- [Frankfurter v2 — conversioni con tasso e data](https://frankfurter.dev/)
- [GitHub Pages con Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

Licenza: MIT, vedere `LICENSE`. MusicBrainz, eBay, Trawl e Frankfurter appartengono ai rispettivi titolari. Questo progetto non è associato né sponsorizzato da eBay.
