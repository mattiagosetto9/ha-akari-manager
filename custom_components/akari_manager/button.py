"""Action buttons for Akari Manager (restart, reload config)."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from homeassistant.components.button import ButtonEntity, ButtonEntityDescription
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .api_client import AkariApiClient, AkariConnectionError
from .const import CONF_API_URL, CONF_RPI_ID, DOMAIN
from .coordinator import AkariCoordinator
from .entity import AkariEntity

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, kw_only=True)
class AkariButtonEntityDescription(ButtonEntityDescription):
    """Description for an Akari action button."""

    action: str  # "restart" or "reload"
    icon: str = "mdi:play"


BUTTON_DESCRIPTIONS: tuple[AkariButtonEntityDescription, ...] = (
    AkariButtonEntityDescription(
        key="restart_service",
        translation_key="restart_service",
        action="restart",
        icon="mdi:restart",
    ),
    AkariButtonEntityDescription(
        key="reload_config",
        translation_key="reload_config",
        action="reload",
        icon="mdi:reload",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Akari action buttons from a config entry."""
    coordinator: AkariCoordinator = hass.data[DOMAIN][entry.entry_id]
    rpi_id: str = entry.data[CONF_RPI_ID]
    rpi_name: str = entry.title
    api_url: str = entry.data[CONF_API_URL]

    async_add_entities(
        AkariButton(coordinator, description, rpi_id, rpi_name, api_url)
        for description in BUTTON_DESCRIPTIONS
    )


class AkariButton(AkariEntity, ButtonEntity):
    """A button that triggers an action on the Akari RPi."""

    entity_description: AkariButtonEntityDescription

    def __init__(
        self,
        coordinator: AkariCoordinator,
        description: AkariButtonEntityDescription,
        rpi_id: str,
        rpi_name: str,
        api_url: str,
    ) -> None:
        """Initialize the button."""
        super().__init__(coordinator, rpi_id, rpi_name, api_url)
        self.entity_description = description
        self._attr_unique_id = f"{rpi_id}_{description.key}"
        self._attr_icon = description.icon

    async def async_press(self) -> None:
        """Handle button press — call the appropriate API endpoint."""
        client: AkariApiClient = self.coordinator.client
        action = self.entity_description.action

        try:
            if action == "restart":
                await client.restart()
                self.hass.components.persistent_notification.async_create(
                    f"Restart command sent to {self._rpi_name}.",
                    title="Akari Manager",
                    notification_id=f"akari_{self._rpi_id}_restart",
                )
            elif action == "reload":
                await client.reload_config()
                # Force an immediate coordinator refresh so entities update
                await self.coordinator.async_request_refresh()
                self.hass.components.persistent_notification.async_create(
                    f"Config reloaded on {self._rpi_name}.",
                    title="Akari Manager",
                    notification_id=f"akari_{self._rpi_id}_reload",
                )
        except AkariConnectionError as err:
            _LOGGER.error("Failed to execute %s on %s: %s", action, self._rpi_id, err)
