# Akari Manager — HACS Integration for Home Assistant

Custom component that integrates Akari RPi firmware nodes into Home Assistant.

## Features

- **MQTT Discovery**: automatically finds Akari RPi devices from retained `home/+/info` messages
- **Diagnostic entities**: CPU temperature, RAM used/total, uptime
- **Module status**: binary sensors for MQTT, MCP, GPIO, Modbus, DS18B20 adapters + overlay filesystem
- **Action buttons**: Restart Service, Reload Config
- **HA Services**: read/write config sections via `akari_manager.*` services

## Architectural principle

This integration does **not** create entities for lights, switches, covers, or sensors — those come from the MQTT Discovery published by the RPi firmware itself. Akari Manager only manages the diagnostic/administrative layer.

## Installation (HACS)

1. In HACS → Integrations → Custom repositories, add this repo.
2. Install "Akari Manager".
3. Restart Home Assistant.
4. Go to Settings → Devices & Services → Add Integration → Akari Manager.

## Manual installation

Copy `custom_components/akari_manager/` into `<config>/custom_components/` and restart HA.

## Configuration

### MQTT Discovery (recommended)

Make sure your RPi is publishing on `home/<rpi_id>/info` (retained). The integration
will find it automatically within ~5 seconds and pre-fill the host and port.

### Manual

Enter the RPi IP, port (default 8080), and optional API key.

## Services

### `akari_manager.get_config_section`

Reads a config section from the RPi and shows it as a persistent notification.

| Field | Type | Description |
|-------|------|-------------|
| `entry_id` | string | Config entry ID |
| `section` | select | `mqtt` / `devices` / `covers` / `sensors` / `modbus` / `system` |

### `akari_manager.update_config_section`

Writes new values to a config section on the RPi.

| Field | Type | Description |
|-------|------|-------------|
| `entry_id` | string | Config entry ID |
| `section` | select | Section name |
| `data` | dict | New values for the section |

### `akari_manager.get_devices`

Fetches the list of devices and their states from the RPi.

| Field | Type | Description |
|-------|------|-------------|
| `entry_id` | string | Config entry ID |

## Device layout

Each RPi becomes one HA device:

```
Device: "RPi Zona Giorno"
  Sensors:       CPU Temp · RAM Used · RAM Total · Uptime
  Binary sensors: MQTT · MCP · GPIO · Modbus · DS18B20 · Overlay FS
  Buttons:       Restart Service · Reload Config
```
