"""HTTP client for the Akari REST API."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import aiohttp

from .const import (
    API_CONFIG,
    API_CONFIG_SECTION,
    API_DEVICES,
    API_RELOAD,
    API_RESTART,
    API_STATUS,
    API_SYSTEM_INFO,
)

_LOGGER = logging.getLogger(__name__)

REQUEST_TIMEOUT = 10


class AkariConnectionError(Exception):
    """Raised when connection to the Akari API fails."""


class AkariAuthError(Exception):
    """Raised when authentication to the Akari API fails."""


class AkariApiClient:
    """Async HTTP client for the Akari REST API."""

    def __init__(
        self,
        api_url: str,
        api_key: str,
        session: aiohttp.ClientSession,
    ) -> None:
        """Initialize the API client."""
        self._api_url = api_url.rstrip("/")
        self._api_key = api_key
        self._session = session

    def _headers(self) -> dict[str, str]:
        """Build request headers."""
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            headers["X-API-Key"] = self._api_key
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        json: dict | None = None,
    ) -> Any:
        """Perform an HTTP request and return parsed JSON."""
        url = f"{self._api_url}{path}"
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT):
                response = await self._session.request(
                    method,
                    url,
                    headers=self._headers(),
                    json=json,
                )
        except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as err:
            raise AkariConnectionError(
                f"Cannot connect to Akari at {url}: {err}"
            ) from err

        if response.status == 401:
            raise AkariAuthError("Invalid API key")
        if response.status == 403:
            raise AkariAuthError("Forbidden: check API key permissions")
        if not response.ok:
            raise AkariConnectionError(
                f"Unexpected response {response.status} from {url}"
            )

        return await response.json(content_type=None)

    async def get_status(self) -> dict:
        """GET /api/status — module states."""
        return await self._request("GET", API_STATUS)

    async def get_system_info(self) -> dict:
        """GET /api/system/info — CPU temp, RAM, uptime, version."""
        return await self._request("GET", API_SYSTEM_INFO)

    async def get_config(self) -> dict:
        """GET /api/config — full configuration."""
        return await self._request("GET", API_CONFIG)

    async def get_config_section(self, section: str) -> dict:
        """GET /api/config/{section} — single config section."""
        path = API_CONFIG_SECTION.format(section=section)
        return await self._request("GET", path)

    async def update_config_section(self, section: str, data: dict) -> dict:
        """PUT /api/config/{section} — update a config section."""
        path = API_CONFIG_SECTION.format(section=section)
        return await self._request("PUT", path, json=data)

    async def reload_config(self) -> dict:
        """POST /api/config/reload — reload config without restart."""
        return await self._request("POST", API_RELOAD)

    async def restart(self) -> dict:
        """POST /api/system/restart — restart the Akari service."""
        return await self._request("POST", API_RESTART)

    async def get_devices(self) -> list:
        """GET /api/devices — list of configured devices and their states."""
        result = await self._request("GET", API_DEVICES)
        if isinstance(result, list):
            return result
        return result.get("devices", [])
