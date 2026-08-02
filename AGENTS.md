# Akari Manager — Integrazione Home Assistant (HACS)

Custom component HA per gestire dispositivi Akari. Polling REST API firmware, pannello sidebar diagnostica + config editor, MQTT discovery.

## Struttura

```
custom_components/akari_manager/
  __init__.py          — async_setup (panel + WS) + async_setup_entry (coordinator)
  config_flow.py       — UI setup/discovery MQTT
  api_client.py        — client HTTP verso firmware REST API
  coordinator.py       — DataUpdateCoordinator (polling 30s, solo get_system_info)
  websocket_api.py     — WS handlers per il pannello frontend
  entity.py            — base entity (CoordinatorEntity)
  sensor.py            — sensori diagnostici (RAM used, RAM total, uptime)
  binary_sensor.py     — overlay_active
  button.py            — restart_service, reload_config
  const.py             — costanti, path API, CONFIG_SECTIONS
  frontend/panel.js    — pannello sidebar vanilla web component
  manifest.json        — metadata (versione, dependencies)
  services.yaml        — definizione servizi HA
```

## Versione corrente: 2.4.0

## Architettura

- **Coordinator** (`coordinator.py`): polling 30s, chiama SOLO `get_system_info()` (RAM, uptime, overlay). `get_status()` e `get_diagnostics()` sono on-demand dal pannello, MAI dal coordinator.
- **Entita'**: `ram_used`, `ram_total`, `uptime` (sensor), `overlay_active` (binary_sensor), `restart_service`, `reload_config` (button) — tutti diagnostic
- **CPU temp e module status**: pubblicati dal firmware via MQTT discovery — akari-manager NON li crea
- **Pannello**: vanilla web component, NO LitElement/build tools, NO auto-refresh

## CONFIG_SECTIONS (15, devono matchare `ALL_FILES` del firmware)

Sistema: `system`, `mqtt` | Adattatori: `mcp`, `pca`, `pcf`, `gpio`, `modbus`, `onewire`, `display`, `inverter` | Entita': `switches`, `lights`, `covers`, `sensors`, `binary_sensors`

## Regole critiche

- Coordinator chiama SOLO `get_system_info()`, MAI `get_status()` o `get_diagnostics()`
- `_cleanup_stale_entities()` in `__init__.py` rimuove entita' legacy (module_mqtt, module_mcp, module_gpio, module_modbus, module_ds18b20, modbus_adapter_status, cpu_temp)
- Pannello: NO auto-refresh, solo pulsante "Aggiorna" manuale
- Dependencies manifest: `mqtt`, `http`, `frontend`, `panel_custom`
- Repo: `git@github.com:mattiagosetto9/ha-akari-manager.git`, branch `main`
