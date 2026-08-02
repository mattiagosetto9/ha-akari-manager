# PLAN — Allineamento akari-manager ↔ firmware Akari

**Status**: IMPLEMENTATO in locale (2026-08-02) — review + deploy PENDING (log viewer §E rimandato).
Fatto: P0-A/B/C + C-bis (toggle), P1-D (diagnostica PCF), P2-G/H/I, F (firmware). Validato staticamente
(py_compile, JSON/YAML, `node --check` panel.js). Deploy NON ancora eseguito (richiesto stop pre-deploy).
**Contesto**: `akari-manager` (integrazione HA / HACS, v2.3.0) è rimasto indietro rispetto al
firmware Akari. Sono state aggiunte al firmware feature (PCF8574, display SSD1306, inverter mpp-solar,
INA3221, module-status via MQTT, `topic_prefix`, endpoint logs) che il manager non conosce o gestisce
male. Questo piano allinea il manager e corregge le incongruenze già presenti.

> **Fonte dei fatti**: analisi incrociata del codice reale di entrambi i repo (2026-08-02).
> Firmware = source of truth. Nessuna modifica al firmware è richiesta tranne un piccolo fix (§F).

---

## 0. Fotografia del drift

### Cosa il firmware espone OGGI (che il manager ignora o sbaglia)

| Area | Firmware (reale) | Manager (attuale) | Gap |
|------|------------------|-------------------|-----|
| Config sections | **15**: system, mqtt, mcp, pca, **pcf**, gpio, modbus, onewire, **display**, **inverter**, switches, lights, covers, sensors, binary_sensors (`config_service.py:12-15`) | 12 in `CONFIG_SECTIONS` (`const.py:30-34`) | mancano `pcf`, `display`, `inverter` |
| `services.yaml` selector `section` | — | offre `{mqtt, devices, covers, sensors, modbus, system}` | set OBSOLETO + include `devices` (non valido → `vol.In` rifiuta) |
| Panel config editor | 15 sezioni editabili | `CONFIG_GROUPS` hardcoded 12 (`panel.js:3-22`) | mancano pcf/display/inverter |
| `/api/status.modules` | include `pcf`, `ds18b20` (`api_service.py:86-89`) | diagnostica pannello non mostra pcf | pcf assente nel render |
| `/api/diagnostics` | ha chiave `pcf` `{status,chips}` (`api_service.py:104-132`) | pannello renderizza mcp/pca ma NON pcf (`panel.js:250-311`) | pcf assente |
| `/api/system/logs?lines=N` | endpoint attivo (`api_service.py:338-352`) | costante `API_SYSTEM_LOGS` presente ma MAI usata (nessun client method, nessuna UI) | feature non esposta |
| `topic_prefix` | topic diventano `home/{id}/...` (`config_service.py:397-405`); `home/{id}/info` sempre prefissato | discovery legge `home/+/info` | ✅ nessun impatto: `info` è sempre `home/{id}/info` |

### Incongruenze/legacy interni al manager (da pulire)

- `strings.json:62-90` — dichiara entità legacy `cpu_temperature` + `module_mqtt/mcp/gpio/modbus/ds18b20`
  NON più create (spostate su MQTT discovery del firmware; già rimosse da `_cleanup_stale_entities`,
  `__init__.py:122-130`). Le `translations/en.json`/`it.json` NON le hanno → `strings.json` è disallineato.
- `services.yaml` selector `section` non coincide con `CONFIG_SECTIONS` → servizi rotti per alcune sezioni.
- `api_client.get_config()` (`api_client.py:95`) definito ma mai chiamato — dead code.
- `API_SYSTEM_LOGS` (`const.py:14`) definito ma mai usato.
- `_LOGGER.warning` usato per messaggi informativi di setup (`__init__.py:45,71`) — livello improprio.

---

## Interventi

Priorità: **P0 rompe** (config editor incompleto / servizi rotti) → **P1 feature nuove** →
**P2 pulizia** → **F cross-repo (firmware)**.

### P0 — Correttezza (cose che non funzionano)

**A. `const.py` — CONFIG_SECTIONS a 15 sezioni**
Aggiungere `pcf`, `display`, `inverter` nell'ordine del firmware:
```python
CONFIG_SECTIONS = [
    "system", "mqtt",
    "mcp", "pca", "pcf", "gpio", "modbus", "onewire", "display", "inverter",
    "switches", "lights", "covers", "sensors", "binary_sensors",
]
```
Sblocca WS `config_get`/`config_update` e i servizi (`vol.In(CONFIG_SECTIONS)`) per le 3 sezioni nuove.

**B. `services.yaml` — allineare il selector `section`**
Sostituire il set obsoleto `{mqtt, devices, covers, sensors, modbus, system}` (righe ~21-27 e ~47-53)
con le 15 sezioni reali di `CONFIG_SECTIONS`. Rimuovere `devices` (non è una config section →
oggi il servizio la rifiuta). Aggiornare anche le descrizioni testuali che elencano il vecchio set.

**C. `frontend/panel.js` — CONFIG_GROUPS a 15 sezioni**
Aggiungere nel gruppo "Adattatori" (DECISO: no gruppo separato): `pcf` (label "PCF8574"),
`display` (label "OLED SSD1306"), `inverter` (label "Inverter").

**C-bis. `frontend/panel.js` — fix grafico dei toggle (bug CSS)**
I toggle bool nell'editor config appaiono deformati (pillola stirata, pallino disallineato).
**Root cause**: specificità CSS. Il toggle è `<label class="toggle">` dentro `.row`, e la regola
`.row label { min-width:140px }` (`panel.js:539`, specificità `(0,1,1)`) sovrascrive
`.toggle { width:44px; min-width:44px }` (`:542`, specificità `(0,1,0)`) → il toggle è forzato a
140px e lo `.slider` con `inset:0` si stira. **Fix**: scoping del label del campo, es.
`.row > label:not(.toggle) { min-width:140px … }`, così la larghezza propria del `.toggle` vince.
Verificare in light/dark theme.

### P1 — Esporre le feature nuove del firmware

**D. Diagnostica pannello — supporto PCF (+ moduli aggiornati)**
`panel.js` `_htmlDiag` (righe ~239-315): aggiungere il blocco `d.pcf.chips[]` + `d.pcf.status`
speculare a mcp/pca. INA3221 è già renderizzato. Verificare che i "module status" mostrino anche
`pcf` e `ds18b20` (ora in `/api/status.modules`). Display non è in `/api/diagnostics` → nessun blocco
diagnostico, solo sezione config.

**E. Visualizzatore log (nuova feature — firmware già pronto)** — ⏸️ RIMANDATO A TASK SEPARATO (deciso)
Il firmware espone `GET /api/system/logs?lines=N` (`api_service.py:338-352`), inutilizzato dal manager.
Implementare la catena completa:
1. `api_client.py`: metodo `get_logs(lines=50)` → GET `API_SYSTEM_LOGS` con query `lines`.
2. `websocket_api.py`: handler `akari_manager/logs` (param opz. `lines`, clamp lato firmware).
3. `frontend/panel.js`: nuova tab/sezione "Log" con textarea read-only + selettore righe + refresh manuale
   (coerente con la regola "NO auto-refresh").
Nessuna modifica firmware richiesta.

### P2 — Pulizia e coerenza

**G. `strings.json` — rimuovere entità legacy**
Eliminare `sensor.cpu_temperature` (righe ~62-64) e i 5 `binary_sensor.module_*` (righe ~76-90):
non più create dal codice, assenti nelle translations. Lasciare solo `ram_used/ram_total/uptime/
overlay_active/restart_service/reload_config` (allineato a en/it). Uniformare stringa
`mqtt_no_devices_found` tra strings.json ed en.json.

**H. Dead code / logging**
- Rimuovere `api_client.get_config()` se resta inutilizzato dopo P1, oppure usarlo dove serve.
- `__init__.py:45,71`: `_LOGGER.warning` → `_LOGGER.info`/`debug` per i messaggi di setup panel.
- (Opz.) uniformare i messaggi d'errore WS misti IT/EN.

**I. Versione + docs**
- `manifest.json`: `2.3.0` → **2.4.0**.
- `AGENTS.md` **e** `CLAUDE.md` (duplicati, entrambi dicono "12 sezioni"/"2.3.0"): aggiornare a
  "CONFIG_SECTIONS (15…)", elenco entità/feature, versione. Valutare rimozione di `CLAUDE.md.bak`.
- Aggiornare la memory `MEMORY.md` (nota "CONFIG_SECTIONS deve matchare le 15 sezioni firmware").

### F — Cross-repo: piccolo fix firmware (fuori da questo repo)

**Firmware `services/api_service.py:208-212`** — la lista `restart_required` NON include `display`
né `inverter`, quindi modificarle via manager NON segnala "riavvio necessario" (mentre il firmware
inizializza quei servizi solo al boot → serve restart). Aggiungere `"display", "inverter"` alla tupla.
Da fare nel repo `akari` (non qui) — allineare anche la memory che oggi afferma "tutte le sezioni".

---

## Fuori scope (proporre separatamente se interessa)

- **Diagnostica generica/robusta**: oggi `_htmlDiag` è accoppiato allo schema `/api/diagnostics`
  (si rompe silenziosamente se il firmware rinomina chiavi). Refactor verso rendering data-driven.
- **HTTPS / porta**: `config_flow` costruisce solo `http://{host}:{port}` (`config_flow.py:42`).
- **`async_migrate_entry`**: oggi la pulizia entità legacy è imperativa in setup, non via migrazione HA.
- **Entità inverter/display in `/api/devices`**: il firmware non le espone lì (solo via MQTT discovery),
  quindi il manager non le "vede" come devices — ma non gli servono (le crea il firmware su HA).

---

## Ordine di esecuzione consigliato

1. P0-A (const) → P0-B (services.yaml) → P0-C (panel groups)  ← sblocca l'editing delle 3 sezioni
2. P1-D (diagnostica pcf) → P1-E (logs viewer)
3. P2-G/H/I (pulizia, logging, version bump, docs)
4. F (fix firmware restart_required — repo akari)

## Verifica

- **Statico**: `python -m json.tool` su manifest/strings/translations/hacs; lint JS del panel.
- **Config editor**: aprire pannello su nsf003 (ha `inverter.yaml`) → le sezioni pcf/display/inverter
  si aprono, si leggono e si salvano; `restart_required` mostrato dove atteso (dopo fix F).
- **Servizi**: `akari_manager.get_config_section` con ognuna delle 15 sezioni → nessun errore `vol.In`.
- **Logs**: tab log mostra output `journalctl` con selettore righe.
- **Diagnostica**: blocco PCF renderizzato quando `pcf` configurato; INA3221 ok; nessun crash se assente.
- **Non-regressione**: entità diagnostiche (ram/uptime/overlay) invariate; nessuna entità legacy ricreata.

## File toccati (previsione)

**Manager**: `const.py`, `services.yaml`, `frontend/panel.js`, `api_client.py`, `websocket_api.py`,
`strings.json`, `__init__.py`, `manifest.json`, `AGENTS.md`.
**Firmware (solo §F)**: `services/api_service.py`.
