# Akari Manager — HACS Integration for Home Assistant

Custom component that integrates Akari firmware nodes into Home Assistant.

## Features

- **MQTT Discovery**: automatically finds Akari devices from retained `home/+/info` messages
- **Diagnostic entities**: CPU temperature, RAM used/total, uptime
- **Module status**: binary sensors for MQTT, MCP, GPIO, Modbus, DS18B20 adapters + overlay filesystem
- **Action buttons**: Restart Service, Reload Config
- **HA Services**: read/write config sections via `akari_manager.*` services

## Architectural principle

This integration does **not** create entities for lights, switches, covers, or sensors — those come from the MQTT Discovery published by the Akari firmware itself. Akari Manager only manages the diagnostic/administrative layer.

## Installation (HACS)

1. In HACS → Integrations → Custom repositories, add this repo.
2. Install "Akari Manager".
3. Restart Home Assistant.
4. Go to Settings → Devices & Services → Add Integration → Akari Manager.

## Manual installation

Copy `custom_components/akari_manager/` into `<config>/custom_components/` and restart HA.

## Configuration

### MQTT Discovery (recommended)

Make sure your Akari device is publishing on `home/<device_id>/info` (retained). The integration
will find it automatically within ~5 seconds and pre-fill the host and port.

### Manual

Enter the device IP, port (default 8080), and optional API key.

## Services

### `akari_manager.get_config_section`

Reads a config section from the device and shows it as a persistent notification.

| Field | Type | Description |
|-------|------|-------------|
| `entry_id` | string | Config entry ID |
| `section` | select | `mqtt` / `devices` / `covers` / `sensors` / `modbus` / `system` |

### `akari_manager.update_config_section`

Writes new values to a config section on the device.

| Field | Type | Description |
|-------|------|-------------|
| `entry_id` | string | Config entry ID |
| `section` | select | Section name |
| `data` | dict | New values for the section |

### `akari_manager.get_devices`

Fetches the list of devices and their states from the Akari device.

| Field | Type | Description |
|-------|------|-------------|
| `entry_id` | string | Config entry ID |

## Device layout

Each Akari device becomes one HA device:

```
Device: "Akari Zona Giorno"
  Sensors:       CPU Temp · RAM Used · RAM Total · Uptime
  Binary sensors: MQTT · MCP · GPIO · Modbus · DS18B20 · Overlay FS
  Buttons:       Restart Service · Reload Config
```
