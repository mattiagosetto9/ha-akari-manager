# Akari Manager — Integrazione Home Assistant (HACS)

## Struttura

```
custom_components/akari_manager/
  __init__.py          — async_setup (panel + WS) + async_setup_entry (coordinator)
  config_flow.py       — UI setup/discovery MQTT
  api_client.py        — client HTTP verso firmware REST API
  coordinator.py       — DataUpdateCoordinator (polling 30s)
  websocket_api.py     — WS handlers per il pannello frontend
  entity.py            — base entity
  sensor.py            — sensori diagnostici (RAM, uptime, overlay)
  binary_sensor.py     — stato moduli hardware
  button.py            — pulsanti (restart, reload config)
  const.py             — costanti, path API, sezioni config
  frontend/panel.js    — pannello sidebar LitElement (diagnostica + config editor)
  manifest.json        — metadata integrazione (versione, dependencies)
  services.yaml        — definizione servizi HA
```

## Deploy (rilascio nuova versione)

Il deploy usa GitHub Actions. Il workflow `.github/workflows/release.yml` si attiva su push di tag `v*`.

### Procedura

1. **Aggiornare la versione** in `manifest.json` (campo `"version"`)
2. **Commit e push** su `main`
3. **Creare e pushare il tag**:
   ```bash
   git tag v2.2.0
   git push origin v2.2.0
   ```
4. La GitHub Action:
   - Aggiorna `manifest.json` con la versione dal tag
   - Crea uno zip di `custom_components/akari_manager/`
   - Pubblica una GitHub Release con lo zip allegato
5. **HACS** rileva la nuova release e mostra l'aggiornamento in Home Assistant

### Repo e remote

- **Repo**: `git@github.com:mattiagosetto9/ha-akari-manager.git`
- **Branch principale**: `main`
- **Tag rilasciati**: `v2.0.0`, `v2.0.1`

## Architettura pannello frontend

- `async_setup()` in `__init__.py` registra il pannello sidebar (`/akari-manager`) e i comandi WebSocket
- Il pannello carica `frontend/panel.js` come static path
- I comandi WS (`akari_manager/diagnostics`, `akari_manager/config_get`, ecc.) fanno da bridge verso il REST API del firmware
- Il pannello NON usa build tools — e' un singolo file ES module che importa LitElement da unpkg CDN

## Note

- `CONFIG_SECTIONS` in `const.py` deve matchare le 12 sezioni firmware
- `manifest.json` ha `"dependencies": ["mqtt", "frontend"]` — frontend necessario per il pannello sidebar
- La versione in `manifest.json` viene sovrascritta dalla GitHub Action al momento del release (dal tag)
