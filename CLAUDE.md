# Akari Manager — Integrazione Home Assistant (HACS)

## Struttura

```
custom_components/akari_manager/
  __init__.py          — async_setup (panel + WS) + async_setup_entry (coordinator)
  config_flow.py       — UI setup/discovery MQTT
  api_client.py        — client HTTP verso firmware REST API
  coordinator.py       — DataUpdateCoordinator (polling 30s, solo get_system_info)
  websocket_api.py     — WS handlers per il pannello frontend
  entity.py            — base entity
  sensor.py            — sensori diagnostici (RAM used, RAM total, uptime)
  binary_sensor.py     — overlay_active
  button.py            — restart_service, reload_config
  const.py             — costanti, path API, sezioni config
  frontend/panel.js    — pannello sidebar vanilla web component (diagnostica + config editor)
  manifest.json        — metadata integrazione (versione, dependencies)
  services.yaml        — definizione servizi HA
```

## Versione corrente

**2.3.0** — Rimozione auto-refresh pannello + INA3221 in diagnostica.

## Architettura

### Coordinator (polling 30s)
`coordinator.py` chiama SOLO `get_system_info()` (RAM, uptime, overlay). NON chiama `get_status()`.

### Entita' create
- **Sensori** (`sensor.py`): `ram_used`, `ram_total`, `uptime` — tutti diagnostic
- **Binary sensor** (`binary_sensor.py`): `overlay_active` — diagnostic
- **Button** (`button.py`): `restart_service`, `reload_config`

CPU temperature e module status (mqtt, mcp, gpio, modbus, ds18b20) sono pubblicati dal firmware via MQTT discovery — akari-manager NON li crea.

### Entita' rimosse (cleanup in __init__.py)
`_cleanup_stale_entities()` rimuove automaticamente le entita' legacy da versioni precedenti:
`module_mqtt`, `module_mcp`, `module_gpio`, `module_modbus`, `module_ds18b20`, `modbus_adapter_status`, `cpu_temp`.

### Pannello frontend (panel.js)
- **Vanilla web component** (`class AkariManagerPanel extends HTMLElement`) — NO LitElement, NO build tools, NO dipendenze esterne
- Registrato come `<akari-manager-panel>` nel sidebar HA
- **NO auto-refresh** — solo pulsante "Aggiorna" manuale
- Due tab: **Diagnostica** (stato hardware, sensori, INA3221) e **Configurazione** (editor YAML per-sezione)
- Chiama WS commands on-demand: `akari_manager/diagnostics` + `akari_manager/status`
- Cache-bust via query param `?v={mtime}` sul file JS

### WebSocket commands
| Comando | Azione | Quando |
|---------|--------|--------|
| `akari_manager/devices` | Lista config entries | Init pannello |
| `akari_manager/diagnostics` | `get_diagnostics()` | Click "Aggiorna" |
| `akari_manager/status` | `get_status()` + `get_system_info()` | Click "Aggiorna" |
| `akari_manager/config_get` | `get_config_section()` | Click sezione config |
| `akari_manager/config_update` | `update_config_section()` | Click "Salva" |
| `akari_manager/config_reload` | `reload_config()` | Bottone reload |
| `akari_manager/restart` | `restart()` | Bottone restart |

### API client endpoints (api_client.py)
| Metodo | Endpoint | Uso |
|--------|----------|-----|
| `get_status()` | GET `/api/status` | On-demand (pannello) |
| `get_system_info()` | GET `/api/system/info` | Coordinator 30s + pannello |
| `get_diagnostics()` | GET `/api/diagnostics` | On-demand (pannello) |
| `get_config_section()` | GET `/api/config/{section}` | On-demand (pannello) |
| `update_config_section()` | PUT `/api/config/{section}` | On-demand (pannello) |
| `reload_config()` | POST `/api/config/reload` | Pannello + button entity |
| `restart()` | POST `/api/system/restart` | Pannello + button entity |
| `get_devices()` | GET `/api/devices` | Servizi HA |

## Costanti (const.py)

### CONFIG_SECTIONS (12 sezioni, devono matchare il firmware)
- Sistema: `system`, `mqtt`
- Adattatori: `mcp`, `pca`, `gpio`, `modbus`, `onewire`
- Entita': `switches`, `lights`, `covers`, `sensors`, `binary_sensors`

## Diagnostica pannello

La card "Sensori" nel tab Diagnostica mostra:
- **DS18B20**: conteggio sensori + topics
- **CPU Temp**: abilitato/disabilitato
- **INA3221**: conteggio canali + nomi canali (da `/api/diagnostics`)

## Deploy (rilascio nuova versione)

Il deploy usa GitHub Actions. Il workflow `.github/workflows/release.yml` si attiva su push di tag `v*`.

### Procedura

1. **Aggiornare la versione** in `manifest.json` (campo `"version"`)
2. **Commit e push** su `main`
3. **Creare e pushare il tag**:
   ```bash
   git tag v2.3.0
   git push origin v2.3.0
   ```
4. La GitHub Action:
   - Aggiorna `manifest.json` con la versione dal tag
   - Crea uno zip di `custom_components/akari_manager/`
   - Pubblica una GitHub Release con lo zip allegato
5. **HACS** rileva la nuova release e mostra l'aggiornamento in Home Assistant

### Repo e remote

- **Repo**: `git@github.com:mattiagosetto9/ha-akari-manager.git`
- **Branch principale**: `main`
- **Tag rilasciati**: v2.0.0, v2.0.1, v2.2.0 — v2.2.12

### Dependencies (manifest.json)
```json
"dependencies": ["mqtt", "http", "frontend", "panel_custom"]
```

## Note

- La versione in `manifest.json` viene sovrascritta dalla GitHub Action al momento del release (dal tag)
- `get_status()` e `get_diagnostics()` sono chiamati SOLO on-demand dal pannello, MAI dal coordinator
- Il pannello NON ha auto-refresh — era stato rimosso in v2.3.0 perche' fastidioso
