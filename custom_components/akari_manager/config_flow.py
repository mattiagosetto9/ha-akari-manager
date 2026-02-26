"""Config flow for Akari Manager."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.components import mqtt
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api_client import AkariApiClient, AkariAuthError, AkariConnectionError
from .const import (
    CONF_API_KEY,
    CONF_API_URL,
    CONF_RPI_ID,
    DOMAIN,
    MQTT_DISCOVERY_TIMEOUT,
    MQTT_DISCOVERY_TOPIC,
)

_LOGGER = logging.getLogger(__name__)

DEFAULT_PORT = 8080


def _build_api_url(host: str, port: int) -> str:
    return f"http://{host}:{port}"


class AkariManagerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the config flow for Akari Manager."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize."""
        self._discovered_rpis: dict[str, dict] = {}  # rpi_id -> {host, port, name}
        self._pending_data: dict[str, Any] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """First step: choose discovery method."""
        if user_input is not None:
            method = user_input.get("method")
            if method == "mqtt":
                return await self.async_step_mqtt_discovery()
            return await self.async_step_manual()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required("method", default="mqtt"): SelectSelector(
                        SelectSelectorConfig(
                            options=[
                                {"value": "mqtt", "label": "Discover via MQTT"},
                                {"value": "manual", "label": "Enter manually"},
                            ],
                            mode=SelectSelectorMode.LIST,
                        )
                    )
                }
            ),
        )

    async def async_step_mqtt_discovery(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Listen on home/+/info for retained messages."""
        if user_input is not None:
            rpi_id = user_input["rpi_id"]
            info = self._discovered_rpis[rpi_id]
            self._pending_data = {
                CONF_RPI_ID: rpi_id,
                CONF_HOST: info["host"],
                CONF_PORT: info["port"],
            }
            return await self.async_step_confirm()

        # Subscribe and collect retained messages for MQTT_DISCOVERY_TIMEOUT seconds
        discovered: dict[str, dict] = {}

        @callback
        def _on_message(msg: Any) -> None:
            try:
                payload = json.loads(msg.payload)
                parts = msg.topic.split("/")
                if len(parts) >= 2:
                    rpi_id = parts[1]
                    host = payload.get("host") or payload.get("ip")
                    port = int(payload.get("port", DEFAULT_PORT))
                    name = payload.get("name") or payload.get("hostname") or rpi_id
                    if host:
                        discovered[rpi_id] = {"host": host, "port": port, "name": name}
            except (json.JSONDecodeError, KeyError, ValueError):
                pass

        unsubscribe = await mqtt.async_subscribe(
            self.hass, MQTT_DISCOVERY_TOPIC, _on_message
        )
        await asyncio.sleep(MQTT_DISCOVERY_TIMEOUT)
        unsubscribe()

        # Filter out already-configured entries
        existing_ids = {
            entry.data.get(CONF_RPI_ID)
            for entry in self.hass.config_entries.async_entries(DOMAIN)
        }
        new_rpis = {k: v for k, v in discovered.items() if k not in existing_ids}

        if not new_rpis:
            # Nothing found — fall back to manual
            return await self.async_step_manual(
                errors={"base": "mqtt_no_devices_found"}
            )

        self._discovered_rpis = new_rpis
        options = [
            {"value": rpi_id, "label": f"{info['name']} ({info['host']}:{info['port']})"}
            for rpi_id, info in new_rpis.items()
        ]

        return self.async_show_form(
            step_id="mqtt_discovery",
            data_schema=vol.Schema(
                {
                    vol.Required("rpi_id"): SelectSelector(
                        SelectSelectorConfig(
                            options=options,
                            mode=SelectSelectorMode.LIST,
                        )
                    )
                }
            ),
        )

    async def async_step_manual(
        self,
        user_input: dict[str, Any] | None = None,
        errors: dict[str, str] | None = None,
    ) -> ConfigFlowResult:
        """Manual entry: host, port, api_key."""
        errors = errors or {}

        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            port = int(user_input.get(CONF_PORT, DEFAULT_PORT))
            api_key = user_input.get(CONF_API_KEY, "").strip()
            api_url = _build_api_url(host, port)

            # Try to determine rpi_id from status endpoint
            session = async_get_clientsession(self.hass)
            client = AkariApiClient(api_url, api_key, session)
            try:
                status = await client.get_status()
                rpi_id = status.get("id") or status.get("rpi_id") or host
            except AkariAuthError:
                errors["base"] = "invalid_auth"
            except AkariConnectionError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(rpi_id)
                self._abort_if_unique_id_configured()
                self._pending_data = {
                    CONF_RPI_ID: rpi_id,
                    CONF_HOST: host,
                    CONF_PORT: port,
                    CONF_API_KEY: api_key,
                    CONF_API_URL: api_url,
                }
                return await self.async_step_confirm()

        return self.async_show_form(
            step_id="manual",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_HOST): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.TEXT)
                    ),
                    vol.Optional(CONF_PORT, default=DEFAULT_PORT): int,
                    vol.Optional(CONF_API_KEY, default=""): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
        )

    async def async_step_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm step: test connection, then create entry."""
        errors: dict[str, str] = {}

        pending = self._pending_data
        host = pending.get(CONF_HOST, "")
        port = pending.get(CONF_PORT, DEFAULT_PORT)
        api_key = pending.get(CONF_API_KEY, "")
        api_url = pending.get(CONF_API_URL) or _build_api_url(host, port)
        rpi_id = pending.get(CONF_RPI_ID, "")

        if user_input is not None:
            api_key = user_input.get(CONF_API_KEY, api_key).strip()
            api_url_final = _build_api_url(host, port)

            session = async_get_clientsession(self.hass)
            client = AkariApiClient(api_url_final, api_key, session)
            try:
                status = await client.get_status()
                resolved_id = status.get("id") or status.get("rpi_id") or rpi_id
            except AkariAuthError:
                errors["base"] = "invalid_auth"
            except AkariConnectionError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(resolved_id)
                self._abort_if_unique_id_configured()

                title = status.get("name") or status.get("hostname") or resolved_id
                return self.async_create_entry(
                    title=title,
                    data={
                        CONF_RPI_ID: resolved_id,
                        CONF_API_URL: api_url_final,
                        CONF_API_KEY: api_key,
                    },
                )

        return self.async_show_form(
            step_id="confirm",
            description_placeholders={
                "host": host,
                "port": str(port),
                "rpi_id": rpi_id,
            },
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_API_KEY, default=api_key): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> AkariOptionsFlow:
        """Return the options flow handler."""
        return AkariOptionsFlow(config_entry)


class AkariOptionsFlow(OptionsFlow):
    """Options flow: update api_key and port."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        """Initialize."""
        self._config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Manage the options."""
        errors: dict[str, str] = {}

        current_url: str = self._config_entry.data.get(CONF_API_URL, "")
        current_key: str = self._config_entry.data.get(CONF_API_KEY, "")

        # Parse current host/port from URL
        try:
            from urllib.parse import urlparse
            parsed = urlparse(current_url)
            current_host = parsed.hostname or ""
            current_port = parsed.port or DEFAULT_PORT
        except Exception:
            current_host = ""
            current_port = DEFAULT_PORT

        if user_input is not None:
            new_port = int(user_input.get(CONF_PORT, current_port))
            new_key = user_input.get(CONF_API_KEY, current_key).strip()
            new_url = _build_api_url(current_host, new_port)

            session = async_get_clientsession(self.hass)
            client = AkariApiClient(new_url, new_key, session)
            try:
                await client.get_status()
            except AkariAuthError:
                errors["base"] = "invalid_auth"
            except AkariConnectionError:
                errors["base"] = "cannot_connect"
            else:
                self.hass.config_entries.async_update_entry(
                    self._config_entry,
                    data={
                        **self._config_entry.data,
                        CONF_API_URL: new_url,
                        CONF_API_KEY: new_key,
                    },
                )
                return self.async_create_entry(title="", data={})

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_PORT, default=current_port): int,
                    vol.Optional(CONF_API_KEY, default=current_key): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
        )
