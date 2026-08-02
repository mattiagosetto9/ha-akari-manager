# PLAN — Allineamento akari-manager ↔ firmware (SHIPPED v2.4.0)

**Status**: ✅ SPEDITO come **v2.4.0** (release HACS, 2026-08-02). Record storico.

Il manager (fermo a v2.3.0) era rimasto indietro rispetto al firmware (PCF8574, display, inverter,
INA3221, module-status via MQTT, 15 sezioni config). Questo giro l'ha riallineato.

## Fatto
- **CONFIG_SECTIONS 12 → 15** (`const.py`) + `services.yaml` selector allineato (rimosso `devices` non valido).
- **Panel**: pcf/display/inverter nell'editor; **card diagnostica PCF**; **fix CSS toggle**.
- **Pulizia**: `strings.json` senza entità legacy; rimosso `get_config()` morto; log setup `warning`→`debug`.
- **Docs/versione**: `manifest` 2.4.0; `AGENTS.md`/`CLAUDE.md` a 15 sezioni; `MEMORY.md` aggiornata.
- **§F firmware** (`api_service.py` `restart_required` include `display`/`inverter`): **codice fatto**, va
  col deploy firmware del pomeriggio (repo `akari`).

## Rimandato
- **Log viewer** (`GET /api/system/logs` → tab "Log" nel pannello): task separato, firmware già pronto.

## Fuori scope (eventuale, futuro)
- Diagnostica `_htmlDiag` data-driven (oggi accoppiata allo schema `/api/diagnostics`).
- HTTPS/porta nel config_flow; `async_migrate_entry` al posto del cleanup imperativo.

> Il refactor successivo (editor schema-aware, nome-come-commento) è in **PLAN-CONFIG-EDITOR.md** (v2.5.0).
