"""Base entity for Akari Manager."""
from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import AkariCoordinator


class AkariEntity(CoordinatorEntity[AkariCoordinator]):
    """Base class for all Akari Manager entities."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: AkariCoordinator,
        device_id: str,
        device_name: str,
        api_url: str,
    ) -> None:
        """Initialize the entity."""
        super().__init__(coordinator)
        self._device_id = device_id
        self._device_name = device_name
        self._api_url = api_url

    @property
    def device_info(self) -> DeviceInfo:
        """Return device info for this Akari device."""
        sys_info = self.coordinator.data.get("system_info", {}) if self.coordinator.data else {}
        return DeviceInfo(
            identifiers={(DOMAIN, self._device_id)},
            name=self._device_name,
            manufacturer="Akari",
            model="Akari",
            sw_version=sys_info.get("version"),
            configuration_url=self._api_url,
        )
