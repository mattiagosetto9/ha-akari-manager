"""WebSocket API handlers for the Akari Manager panel."""
from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .api_client import AkariAuthError, AkariConnectionError
from .const import CONFIG_SECTIONS, DOMAIN

_LOGGER = logging.getLogger(__name__)


def register_websocket_commands(hass: HomeAssistant) -> None:
    """Register all WebSocket commands."""
    websocket_api.async_register_command(hass, ws_devices)
    websocket_api.async_register_command(hass, ws_diagnostics)
    websocket_api.async_register_command(hass, ws_status)
    websocket_api.async_register_command(hass, ws_config_get)
    websocket_api.async_register_command(hass, ws_config_update)
    websocket_api.async_register_command(hass, ws_config_reload)
    websocket_api.async_register_command(hass, ws_restart)


def _get_coordinator(hass: HomeAssistant, entry_id: str):
    """Get coordinator by entry_id or return None."""
    return hass.data.get(DOMAIN, {}).get(entry_id)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "akari_manager/devices",
    }
)
@websocket_api.async_response
async def ws_devices(hass, connection, msg):
    """Return list of configured Akari entries."""
    entries = []
    for entry_id, coordinator in hass.data.get(DOMAIN, {}).items():
        entries.append({
            "entry_id": entry_id,
            "device_id": coordinator.device_id,
            "name": coordinator.name,
        })
    connection.send_result(msg["id"], {"devices": entries})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "akari_manager/diagnostics",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.async_response
async def ws_diagnostics(hass, connection, msg):
    """Fetch hardware diagnostics from firmware."""
    coordinator = _get_coordinator(hass, msg["entry_id"])
    if not coordinator:
        connection.send_error(msg["id"], "not_found", "Entry non trovata")
        return
    try:
        data = await coordinator.client.get_diagnostics()
    except (AkariConnectionError, AkariAuthError) as err:
        connection.send_error(msg["id"], "connection_error", str(err))
        return
    connection.send_result(msg["id"], data)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "akari_manager/status",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.async_response
async def ws_status(hass, connection, msg):
    """Fetch status + system info from firmware."""
    coordinator = _get_coordinator(hass, msg["entry_id"])
    if not coordinator:
        connection.send_error(msg["id"], "not_found", "Entry non trovata")
        return
    try:
        status = await coordinator.client.get_status()
        sys_info = await coordinator.client.get_system_info()
    except (AkariConnectionError, AkariAuthError) as err:
        connection.send_error(msg["id"], "connection_error", str(err))
        return
    connection.send_result(msg["id"], {"status": status, "system_info": sys_info})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "akari_manager/config_get",
        vol.Required("entry_id"): str,
        vol.Required("section"): vol.In(CONFIG_SECTIONS),
    }
)
@websocket_api.async_response
async def ws_config_get(hass, connection, msg):
    """Get a config section from firmware."""
    coordinator = _get_coordinator(hass, msg["entry_id"])
    if not coordinator:
        connection.send_error(msg["id"], "not_found", "Entry non trovata")
        return
    try:
        data = await coordinator.client.get_config_section(msg["section"])
    except (AkariConnectionError, AkariAuthError) as err:
        connection.send_error(msg["id"], "connection_error", str(err))
        return
    connection.send_result(msg["id"], data)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "akari_manager/config_update",
        vol.Required("entry_id"): str,
        vol.Required("section"): vol.In(CONFIG_SECTIONS),
        vol.Required("data"): dict,
    }
)
@websocket_api.async_response
async def ws_config_update(hass, connection, msg):
    """Update a config section on firmware."""
    coordinator = _get_coordinator(hass, msg["entry_id"])
    if not coordinator:
        connection.send_error(msg["id"], "not_found", "Entry non trovata")
        return
    try:
        result = await coordinator.client.update_config_section(
            msg["section"], msg["data"]
        )
    except (AkariConnectionError, AkariAuthError) as err:
        connection.send_error(msg["id"], "connection_error", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "akari_manager/config_reload",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.async_response
async def ws_config_reload(hass, connection, msg):
    """Reload config on firmware."""
    coordinator = _get_coordinator(hass, msg["entry_id"])
    if not coordinator:
        connection.send_error(msg["id"], "not_found", "Entry non trovata")
        return
    try:
        result = await coordinator.client.reload_config()
    except (AkariConnectionError, AkariAuthError) as err:
        connection.send_error(msg["id"], "connection_error", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "akari_manager/restart",
        vol.Required("entry_id"): str,
    }
)
@websocket_api.async_response
async def ws_restart(hass, connection, msg):
    """Restart firmware service."""
    coordinator = _get_coordinator(hass, msg["entry_id"])
    if not coordinator:
        connection.send_error(msg["id"], "not_found", "Entry non trovata")
        return
    try:
        result = await coordinator.client.restart()
    except (AkariConnectionError, AkariAuthError) as err:
        connection.send_error(msg["id"], "connection_error", str(err))
        return
    connection.send_result(msg["id"], result)
