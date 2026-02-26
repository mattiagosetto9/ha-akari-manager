"""DataUpdateCoordinator for Akari Manager."""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api_client import AkariApiClient, AkariAuthError, AkariConnectionError
from .const import DOMAIN, UPDATE_INTERVAL_SECONDS

_LOGGER = logging.getLogger(__name__)


class AkariCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator that polls the Akari REST API every 30 seconds."""

    def __init__(
        self,
        hass: HomeAssistant,
        client: AkariApiClient,
        device_id: str,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{device_id}",
            update_interval=timedelta(seconds=UPDATE_INTERVAL_SECONDS),
        )
        self.client = client
        self.device_id = device_id

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch status and system info from the Akari API."""
        try:
            status, sys_info = await asyncio.gather(
                self.client.get_status(),
                self.client.get_system_info(),
            )
        except AkariAuthError as err:
            raise UpdateFailed(f"Authentication error: {err}") from err
        except AkariConnectionError as err:
            raise UpdateFailed(f"Cannot connect to Akari device: {err}") from err

        return {
            "status": status,
            "system_info": sys_info,
        }
