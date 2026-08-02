# Config Editor — Refactor (nome-come-commento + editor coerente + salvataggio sicuro)

**Status**: ✅ CODICE FATTO + testato in locale (2026-08-02). Manager spedito come **v2.5.0** (HACS).
**Firmware** (`akari`): codice fatto, **deploy PENDING** col batch del pomeriggio (migrazione MQTT).
Fino al deploy firmware l'editor gira **degradato** (adapter come testo, niente nomi) → **non salvare
config dal pannello sul firmware vecchio** (usa ancora `yaml.dump` distruttivo).

## Problemi risolti
1. **Salvataggio distruttivo** (firmware `config_service._save`): `yaml.dump` cancellava i commenti (= i
   nomi), riordinava le chiavi, espandeva il flow compatto.
2. **Nomi solo nei commenti**: `# Applique salotto` era l'unica identità umana, invisibile ad API/pannello.
3. **Editor cieco**: JSON grezzo, niente dropdown adapter, niente add campi opzionali, entità col topic criptico.

## Decisioni (utente)
- **Nome = commento YAML**, non campo dati. Trasportato come **campo virtuale `_name`** via API.
- **Zero dipendenze nuove**: niente `ruamel`. I file entity sono compatti una-riga-per-item → round-trip
  del commento fatto con serializer custom, mantenendo l'estetica compatta.
- Editor = **engine generico potenziato** (NON 15 schemi hardcoded).

## Come funziona (as-built)

**Firmware `akari` — `services/config_service.py`**
- `NAME_COMMENT_SECTIONS = {switches, lights, binary_sensors}` (covers/sensors hanno `name` come dato reale).
- `get_section_api(section)`: inietta `_name` leggendo l'eol comment (`_read_item_names`) — `_config` resta pulito.
- `update()`: estrae/pop `_name` da ogni item, lo passa a `_save(section, comment_names)`.
- `_dump_section()`: serializer custom, item compatto una-riga + `# _name`, **`sort_keys=False`**, no riordino.
- `AdapterRegistry.list_adapters()` + `api_service.py` `GET /api/adapters`; `get_config_section` usa `get_section_api`.

**Manager `akari-manager` v2.5.0 — `frontend/panel.js`**
- `ENTITY_OPT` (campi opzionali per sezione) + `FIELD_LABELS`.
- `_name` in cima all'entità; `_adapterOptions` (dropdown); `_addField`/`_rmField`; header lista col nome.
- `api_client.get_adapters()`, WS `akari_manager/adapters` (degrada a `{adapters:[]}` su 404), `const.API_ADAPTERS`.

## Compatibilità
- Manager nuovo + firmware vecchio: `/api/adapters` 404 → dropdown = testo; GET senza `_name` → nessun nome. OK.
- Manager vecchio + firmware nuovo: `_name` mostrato grezzo, riscritto come commento. OK.

## Caveat
- I commenti di **gruppo** standalone (`# MCP B (0x21)`) non sono preservati alla riscrittura di una lista;
  i **nomi per-entità** (eol) sì.
- Toggle deformati: causa specificità CSS `.row label` vs `.toggle` → fix `.row > label:not(.toggle)` +
  `.toggle {flex:0 0 auto; max-width:44px}`. Per vederlo: update HACS + restart HA + hard-refresh browser.

## Verifica fatta (locale)
- Firmware round-trip sui file reali nsf001: rinomino + modifica pin → nomi preservati, dati aggiornati,
  ordine chiavi intatto, whitelist intatta, `covers/sensors` usano `name`-dato.
- Editor: harness Node → nome in cima, dropdown adapter, add/remove `feedback`/`static`, degrado firmware vecchio.

## Pending (pomeriggio)
Deploy firmware ai 3 device col batch migrazione MQTT → sblocca nomi + dropdown e il salvataggio sicuro.
Vedi [`../akari/MIGRATION-MQTT-PLAN.md`].
