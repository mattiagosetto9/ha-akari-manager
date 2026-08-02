# PLAN — Refactor Config Editor (nomi-come-commenti + schema-aware + salvataggio sicuro)

**Status**: IMPLEMENTATO + testato in locale (2026-08-02) — deploy col batch MQTT (device) e release HACS (manager) PENDING.
Approccio editor: **engine generico potenziato** (nome `_name` in cima, dropdown adapter, add/remove campi
opzionali, header lista col nome) invece di 15 schemi hardcoded → più robusto/manutenibile, copre le lamentele.
Firmware round-trip nome-come-commento verificato sui file reali nsf001; editor testato con harness Node.
**Scope**: COMPLETO (deciso) — cross-repo `akari` (firmware) + `akari-manager` (HA).
**Decisioni utente**:
1. I **nomi** delle entità restano **commenti YAML** (niente campo `name` nei dati). Il pannello mostra
   un campo "Nome" editabile; il firmware lo scrive come commento eol `# Nome` sulla riga dell'entità.
2. Refactor **completo**: salvataggio non distruttivo + nome-come-commento + editor schema-aware su tutte
   le 15 sezioni.

---

## 0. Problemi che risolviamo

| # | Problema | Dove | Oggi |
|---|----------|------|------|
| 1 | **Salvataggio distruttivo** | firmware `config_service._save:427` | `yaml.dump(sort_keys=True default)` → cancella commenti (= i nomi), riordina chiavi alfabeticamente, espande il flow style compatto. Editare una sezione dal pannello massacra il file. |
| 2 | **Nomi solo nei commenti** | tutti gli entity YAML | `# Applique salotto` è l'unica identità umana; API JSON e pannello non la vedono. |
| 3 | **Editor cieco allo schema** | manager `panel.js:_fieldsHtml` | Render JSON grezzo: niente dropdown adapter, niente add di campi opzionali (feedback/static), niente validazione, entità mostrate col topic criptico. |

---

## 1. Meccanismo "nome-come-commento"

Il nome è **metadato in commento**, trasportato come **campo virtuale** attraverso l'API JSON.

```
switches.yaml (ruamel round-trip)
  - {topic: output_6_A, output: {adapter: mcp_B, pin: 13}, feedback: {...}}  # Applique salotto
                                                                               └── eol comment = NOME
        │  GET /api/config/switches                    ▲  PUT /api/config/switches
        ▼  (firmware inietta il commento come campo)   │  (firmware riscrive il commento dal campo)
  { "switches": [ { "topic": "...", "output": {...}, "feedback": {...},
                    "_name": "Applique salotto" } ] }   ← campo virtuale, NON persistito come chiave
```

- **`_name`** (prefisso `_` = campo derivato/virtuale, non è una chiave YAML reale).
- **GET**: il firmware legge l'eol comment di ogni item della lista e lo aggiunge come `_name`.
- **PUT**: il firmware, nel ricostruire la sezione, **estrae `_name`** da ogni item, lo rimuove dai dati,
  e lo scrive come eol comment sulla riga. Zero chiavi `name:` nei dati.
- Sezioni non-entity (system/mqtt/adapter): `_name` non usato; round-trip preserva i commenti esistenti.

### Approccio: serializer custom, ZERO dipendenze nuove (deciso)
I file entity usano un formato **compatto una-riga-per-item** (`- {…}  # Nome`). Questo rende il round-trip
del commento banale senza `ruamel`:
- **Read**: dopo `yaml.safe_load`, secondo passaggio sulle righe grezze del file → per ogni item della
  lista, l'eol comment dopo l'ultima `#` fuori dalle graffe = `_name`.
- **Write**: ogni item serializzato in flow compatto `{k: v, …}` + `  # _name`; le chiavi non-lista
  (es. `command_whitelist`) con `yaml.dump(sort_keys=False)`.
- Vantaggi vs ruamel: nessuna dipendenza su tutti i device, e mantiene **esattamente** l'estetica compatta
  (ruamel la riformatterebbe).

### Caveat onesti
- I **commenti di gruppo** standalone (`# MCP B (0x21)`) NON sono legati a un dato → nella riscrittura di
  una lista possono non essere preservati. I **nomi per-entità** (eol) sì. Documentato, accettato.
- Il round-trip del nome dipende dal formato **una-riga-per-item**: il writer normalizza gli item a quel
  formato (coerente coi file attuali).

---

## 2. Firmware (`akari`)

### 2.1 Salvataggio sicuro (`config_service._save`)
- `yaml.dump(..., sort_keys=False, default_flow_style=False, allow_unicode=True)` per le chiavi non-lista
  (stop al riordino alfabetico).
- Per le liste entity: **serializer custom** che emette una riga compatta per item + eol `# _name`.
- Doppio-write overlay (lower FS) invariato.

### 2.2 Nome-come-commento (helper in `config_service.py`, no dep)
- **Read** (`_read_item_names(section)`): dopo il load, parse delle righe grezze → mappa index→nome
  dall'eol comment; esposto come `_name` per item nelle sezioni entity.
- **Write**: `update(section, data)` estrae `_name` da ogni item (non lo persiste come chiave) e lo passa
  al serializer come eol comment.
- Sezioni entity coinvolte: `switches`, `lights`, `binary_sensors` (e `sensors` dove ha `topic`).
  `covers`/sensori Modbus hanno già `name` come campo dati → nessun `_name`.

### 2.3 API — endpoint adapter per i dropdown (`api_service.py`)
L'editor ha bisogno della lista adapter risolti per i dropdown. Aggiungere:
- `GET /api/adapters` → `{adapters: [{name, type, address}]}` da `AdapterRegistry` (mcp/pca/pcf/gpio…),
  così il pannello popola i menu `adapter` invece di testo libero.

### 2.4 `restart_required`
Già include display/inverter (fix §F precedente). Nessun cambiamento.

---

## 3. Manager (`akari-manager`)

### 3.1 Editor schema-driven (`frontend/panel.js`)
Sostituire il render generico ricorsivo con **definizioni di schema per sezione** (`SECTION_SCHEMAS`):
- tipi di campo: `text`, `number`, `bool` (toggle), `select` (con opzioni statiche o dinamiche es. adapter),
  `pinref` ({adapter select + pin number}), `group` (oggetto annidato), `list` (array con item schema).
- Ogni entity item ha un campo **"Nome"** in cima (mappa su `_name`), poi i campi dello schema.
- Campi opzionali (`feedback`, `static`) con **add/remove** espliciti.
- `command_whitelist` / `retained_command_whitelist`: editor di lista di stringhe dedicato.
- Validazione lato client minima (pin numerico, adapter tra quelli noti).

### 3.2 Client + WS
- `api_client.get_adapters()` → `GET /api/adapters`; WS `akari_manager/adapters`.
- Il pannello carica gli adapter una volta per popolare i `select`.

### 3.3 Fallback
- Se il firmware è vecchio (no `_name`, no `/api/adapters`): l'editor degrada a testo libero (adapter come
  text) e nome vuoto. Nessun crash.

---

## 4. Schemi sezione (bozza, da rifinire leggendo gli .example)

- **switches/lights**: item `{topic:text, output:pinref, feedback?:{...pinref, topic:text}, static?:bool}`
  + `_name`; sezione con `command_whitelist:list<str>`.
- **covers**: item con `name` (qui il name è già campo dati!), pin_up/pin_down, timing…
- **binary_sensors**: item `{topic, input:pinref, ...}` + `_name`.
- **sensors**: item per tipo (`modbus`/`ds18b20`/`cpu_temp`/`ina3221`) — schema per `type`.
- **mcp/pca/pcf**: `chips:list<{name,address,active_low,...}>`.
- **gpio/modbus/onewire/display/inverter/system/mqtt**: schema dedicato ciascuno.

> Nota: `covers` e sensori Modbus hanno **`name` come campo dati reale** (regola firmware) → lì niente
> `_name`-commento, si edita il campo `name` normale.

---

## 5. Task breakdown & ordine

1. **Firmware — persistenza ruamel + safe save** (ferma l'emorragia). Verifica: edit round-trip preserva
   commenti/nomi e formato.
2. **Firmware — `_name` read/write** per sezioni entity. Verifica: GET espone `_name`, PUT lo riscrive come commento.
3. **Firmware — `GET /api/adapters`**.
4. **Manager — schema engine + editor** (schema per sezione, widget, add/remove, nome).
5. **Manager — client/WS adapters + dropdown**.
6. **Docs + version bump** (manager 2.5.0), memory.

## 6. Verifica
- Firmware: unit su `config_service` → editare uno switch mantiene gli altri commenti/nomi; `_name`
  round-trips; nessun riordino chiavi.
- Manager: `node --check`; editor apre tutte le 15 sezioni; salvataggio di uno switch col nome scrive il
  commento giusto sul device; dropdown adapter popolati; degrado su firmware vecchio.
- Non-regressione: nessuna modifica ai topic/discovery.

## 7. Deploy
Il tutto va deployato coi 3 device **insieme alla migrazione MQTT** (come da indicazione utente). Il
manager invece si rilascia via tag GitHub (HACS) quando pronto.
