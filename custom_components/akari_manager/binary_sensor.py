"""Binary sensors for Akari Manager (module states, overlay)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
    BinarySensorEntityDescription,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_API_URL, CONF_DEVICE_ID, DOMAIN
from .coordinator import AkariCoordinator
from .entity import AkariEntity


@dataclass(frozen=True, kw_only=True)
class AkariBinarySensorEntityDescription(BinarySensorEntityDescription):
    """Description for an Akari binary sensor."""

    data_path: tuple[str, ...]
    icon_on: str | None = None
    icon_off: str | None = None


BINARY_SENSOR_DESCRIPTIONS: tuple[AkariBinarySensorEntityDescription, ...] = (
    AkariBinarySensorEntityDescription(
        key="module_mqtt",
        translation_key="module_mqtt",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("status", "modules", "mqtt"),
    ),
    AkariBinarySensorEntityDescription(
        key="module_mcp",
        translation_key="module_mcp",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("status", "modules", "mcp"),
    ),
    AkariBinarySensorEntityDescription(
        key="module_gpio",
        translation_key="module_gpio",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("status", "modules", "gpio"),
    ),
    AkariBinarySensorEntityDescription(
        key="module_modbus",
        translation_key="module_modbus",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("status", "modules", "modbus"),
    ),
    AkariBinarySensorEntityDescription(
        key="module_ds18b20",
        translation_key="module_ds18b20",
        device_class=BinarySensorDeviceClass.CONNECTIVITY,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("status", "modules", "ds18b20"),
    ),
    AkariBinarySensorEntityDescription(
        key="overlay_active",
        translation_key="overlay_active",
        device_class=None,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("system_info", "overlay_active"),
        icon_on="mdi:shield-lock",
        icon_off="mdi:shield-lock-open",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Akari binary sensors from a config entry."""
    coordinator: AkariCoordinator = hass.data[DOMAIN][entry.entry_id]
    device_id: str = entry.data[CONF_DEVICE_ID]
    device_name: str = entry.title
    api_url: str = entry.data[CONF_API_URL]

    async_add_entities(
        AkariBinarySensor(coordinator, description, device_id, device_name, api_url)
        for description in BINARY_SENSOR_DESCRIPTIONS
    )


class AkariBinarySensor(AkariEntity, BinarySensorEntity):
    """A binary sensor reflecting an Akari module state."""

    entity_description: AkariBinarySensorEntityDescription

    def __init__(
        self,
        coordinator: AkariCoordinator,
        description: AkariBinarySensorEntityDescription,
        device_id: str,
        device_name: str,
        api_url: str,
    ) -> None:
        """Initialize the binary sensor."""
        super().__init__(coordinator, device_id, device_name, api_url)
        self.entity_description = description
        self._attr_unique_id = f"{device_id}_{description.key}"

    def _get_value(self) -> Any:
        """Walk coordinator.data to find the value."""
        if not self.coordinator.data:
            return None
        value: Any = self.coordinator.data
        for key in self.entity_description.data_path:
            if not isinstance(value, dict):
                return None
            value = value.get(key)
        return value

    @property
    def is_on(self) -> bool | None:
        """Return True if the module/feature is active."""
        value = self._get_value()
        if value is None:
            return None
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ("true", "ok", "running", "active", "1")
        return bool(value)

    @property
    def icon(self) -> str | None:
        """Return a custom icon for sensors that have one."""
        desc = self.entity_description
        if desc.icon_on or desc.icon_off:
            return desc.icon_on if self.is_on else desc.icon_off
        return None
