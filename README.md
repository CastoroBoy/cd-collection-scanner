# CD Collection Scanner

Applicazione React/TypeScript per catalogare CD musicali dalle fotografie dei dorsi, con OCR Tesseract.js in locale, identificazione MusicBrainz, archivio IndexedDB ed esportazione CSV, XLSX e JSON.

**Stato del repository:** la configurazione GitHub Pages è presente, ma i file sorgente dell'applicazione devono ancora essere caricati. Il sito non va considerato operativo finché il workflow `Pubblica GitHub Pages` non termina correttamente.

## Come inserire il progetto

1. Aprire l'archivio **CD_Collection_Scanner_GitHub.zip** fornito nella conversazione ChatGPT ed estrarlo.
2. Aprire la cartella estratta `cd-collection-scanner`.
3. Dal repository GitHub usare **Add file → Upload files**, trascinare i file e le cartelle del progetto estratto, quindi confermare il commit sul branch `main`. Sostituire i file già presenti con quelli equivalenti: `.github/workflows/deploy.yml`, `.gitignore`, `README.md`.
4. Controllare **Actions → Pubblica GitHub Pages**: test, verifica TypeScript e build devono terminare con successo.
5. Aprire **Settings → Pages → Build and deployment → Source**, selezionare **GitHub Actions**.
6. Dopo il deploy, l'indirizzo previsto è https://CastoroBoy.github.io/cd-collection-scanner/.

## Configurazione dei prezzi

OCR, catalogazione ed esportazione sono indipendenti da credenziali. Per i prezzi automatici di vendite documentate è previsto un Cloudflare Worker (cartella `worker`) e una chiave privata del provider Trawl. Il provider dichiarato copre eBay UK, non tutti i marketplace europei. Per gli altri paesi si usa la procedura assistita; non vengono inventate vendite.

La chiave privata **non deve comparire** nei file del repository o nelle variabili pubbliche `VITE_*`. Pubblicare il Worker separatamente e impostare in GitHub **Settings → Secrets and variables → Actions → Variables** il valore `VITE_PRICE_API_URL` con l'URL del Worker.

## Requisiti di manutenzione

Per la compilazione locale: Node.js 22+, `npm install`, `npm run typecheck`, `npm test`, `npm run build`. Questi comandi non sono necessari per gli utenti del sito.

Il codice sorgente completo e le ulteriori istruzioni sono disponibili nell'archivio ZIP fornito in chat.
