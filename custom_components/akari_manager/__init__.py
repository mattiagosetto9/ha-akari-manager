"""Akari Manager integration for Home Assistant."""
from __future__ import annotations

import json
import logging
from typing import Any

import aiohttp

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api_client import AkariApiClient, AkariAuthError, AkariConnectionError
from .const import (
    CONF_API_KEY,
    CONF_API_URL,
    CONF_DEVICE_ID,
    CONFIG_SECTIONS,
    DOMAIN,
    PLATFORMS,
    SERVICE_GET_CONFIG_SECTION,
    SERVICE_GET_DEVICES,
    SERVICE_UPDATE_CONFIG_SECTION,
)
from .coordinator import AkariCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Akari Manager from a config entry."""
    api_url: str = entry.data[CONF_API_URL]
    api_key: str = entry.data.get(CONF_API_KEY, "")
    device_id: str = entry.data[CONF_DEVICE_ID]

    session = async_get_clientsession(hass)
    client = AkariApiClient(api_url, api_key, session)

    # Verify connectivity at setup time
    try:
        await client.get_status()
    except AkariAuthError as err:
        _LOGGER.error("Authentication failed for %s: %s", device_id, err)
        return False
    except AkariConnectionError as err:
        raise ConfigEntryNotReady(f"Cannot connect to Akari at {api_url}: {err}") from err

    coordinator = AkariCoordinator(hass, client, device_id)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register HA services (only once, on first entry setup)
    if not hass.services.has_service(DOMAIN, SERVICE_GET_CONFIG_SECTION):
        _register_services(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
        if not hass.data[DOMAIN]:
            # Last entry removed — clean up services
            for service in (
                SERVICE_GET_CONFIG_SECTION,
                SERVICE_UPDATE_CONFIG_SECTION,
                SERVICE_GET_DEVICES,
            ):
                hass.services.async_remove(DOMAIN, service)
            hass.data.pop(DOMAIN)
    return unload_ok


def _register_services(hass: HomeAssistant) -> None:
    """Register akari_manager HA services."""

    def _get_coordinator(entry_id: str) -> AkariCoordinator:
        coordinator = hass.data.get(DOMAIN, {}).get(entry_id)
        if coordinator is None:
            raise ValueError(f"No active Akari entry with id '{entry_id}'")
        return coordinator

    async def handle_get_config_section(call: ServiceCall) -> None:
        entry_id: str = call.data["entry_id"]
        section: str = call.data["section"]
        coordinator = _get_coordinator(entry_id)
        try:
            data = await coordinator.client.get_config_section(section)
        except (AkariConnectionError, AkariAuthError) as err:
            _LOGGER.error("get_config_section failed: %s", err)
            hass.components.persistent_notification.async_create(
                f"Error reading config section '{section}':\n{err}",
                title="Akari Manager",
                notification_id=f"akari_{entry_id}_config_error",
            )
            return

        hass.components.persistent_notification.async_create(
            f"**Config section: {section}**\n```json\n{json.dumps(data, indent=2)}\n```",
            title="Akari Manager — Config",
            notification_id=f"akari_{entry_id}_config_{section}",
        )

    async def handle_update_config_section(call: ServiceCall) -> None:
        entry_id: str = call.data["entry_id"]
        section: str = call.data["section"]
        new_data: dict = call.data["data"]
        coordinator = _get_coordinator(entry_id)
        try:
            result = await coordinator.client.update_config_section(section, new_data)
        except (AkariConnectionError, AkariAuthError) as err:
            _LOGGER.error("update_config_section failed: %s", err)
            hass.components.persistent_notification.async_create(
                f"Error updating config section '{section}':\n{err}",
                title="Akari Manager",
                notification_id=f"akari_{entry_id}_update_error",
            )
            return

        msg = f"Config section '{section}' updated successfully."
        if result.get("restart_required"):
            msg += "\n\n**Restart required** for changes to take effect. Use the Restart Service button."
        hass.components.persistent_notification.async_create(
            msg,
            title="Akari Manager — Config Updated",
            notification_id=f"akari_{entry_id}_updated_{section}",
        )

    async def handle_get_devices(call: ServiceCall) -> None:
        entry_id: str = call.data["entry_id"]
        coordinator = _get_coordinator(entry_id)
        try:
            devices = await coordinator.client.get_devices()
        except (AkariConnectionError, AkariAuthError) as err:
            _LOGGER.error("get_devices failed: %s", err)
            hass.components.persistent_notification.async_create(
                f"Error fetching devices:\n{err}",
                title="Akari Manager",
                notification_id=f"akari_{entry_id}_devices_error",
            )
            return

        hass.components.persistent_notification.async_create(
            f"**Devices on {entry_id}**\n```json\n{json.dumps(devices, indent=2)}\n```",
            title="Akari Manager — Devices",
            notification_id=f"akari_{entry_id}_devices",
        )

    import voluptuous as vol
    from homeassistant.helpers import config_validation as cv

    section_selector = vol.In(CONFIG_SECTIONS)

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_CONFIG_SECTION,
        handle_get_config_section,
        schema=vol.Schema(
            {
                vol.Required("entry_id"): cv.string,
                vol.Required("section"): section_selector,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_UPDATE_CONFIG_SECTION,
        handle_update_config_section,
        schema=vol.Schema(
            {
                vol.Required("entry_id"): cv.string,
                vol.Required("section"): section_selector,
                vol.Required("data"): dict,
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        SERVICE_GET_DEVICES,
        handle_get_devices,
        schema=vol.Schema(
            {
                vol.Required("entry_id"): cv.string,
            }
        ),
    )
