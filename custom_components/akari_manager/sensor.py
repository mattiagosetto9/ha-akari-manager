"""Diagnostic sensors for Akari Manager."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfInformation, UnitOfTemperature, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_API_KEY, CONF_API_URL, CONF_RPI_ID, DOMAIN
from .coordinator import AkariCoordinator
from .entity import AkariEntity


@dataclass(frozen=True, kw_only=True)
class AkariSensorEntityDescription(SensorEntityDescription):
    """Description for an Akari sensor."""

    data_path: tuple[str, ...]  # path into coordinator.data


SENSOR_DESCRIPTIONS: tuple[AkariSensorEntityDescription, ...] = (
    AkariSensorEntityDescription(
        key="cpu_temperature",
        translation_key="cpu_temperature",
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        device_class=SensorDeviceClass.TEMPERATURE,
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("system_info", "cpu_temp"),
    ),
    AkariSensorEntityDescription(
        key="ram_used",
        translation_key="ram_used",
        native_unit_of_measurement=UnitOfInformation.MEGABYTES,
        device_class=SensorDeviceClass.DATA_SIZE,
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("system_info", "memory_used_mb"),
    ),
    AkariSensorEntityDescription(
        key="ram_total",
        translation_key="ram_total",
        native_unit_of_measurement=UnitOfInformation.MEGABYTES,
        device_class=SensorDeviceClass.DATA_SIZE,
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("system_info", "memory_total_mb"),
    ),
    AkariSensorEntityDescription(
        key="uptime",
        translation_key="uptime",
        native_unit_of_measurement=UnitOfTime.SECONDS,
        device_class=SensorDeviceClass.DURATION,
        state_class=SensorStateClass.TOTAL_INCREASING,
        entity_category=EntityCategory.DIAGNOSTIC,
        data_path=("system_info", "uptime_seconds"),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Akari diagnostic sensors from a config entry."""
    coordinator: AkariCoordinator = hass.data[DOMAIN][entry.entry_id]
    rpi_id: str = entry.data[CONF_RPI_ID]
    rpi_name: str = entry.title
    api_url: str = entry.data[CONF_API_URL]

    async_add_entities(
        AkariSensor(coordinator, description, rpi_id, rpi_name, api_url)
        for description in SENSOR_DESCRIPTIONS
    )


class AkariSensor(AkariEntity, SensorEntity):
    """A diagnostic sensor reading data from the Akari coordinator."""

    entity_description: AkariSensorEntityDescription

    def __init__(
        self,
        coordinator: AkariCoordinator,
        description: AkariSensorEntityDescription,
        rpi_id: str,
        rpi_name: str,
        api_url: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, rpi_id, rpi_name, api_url)
        self.entity_description = description
        self._attr_unique_id = f"{rpi_id}_{description.key}"

    @property
    def native_value(self) -> Any:
        """Return the sensor value by walking coordinator.data."""
        if not self.coordinator.data:
            return None
        value: Any = self.coordinator.data
        for key in self.entity_description.data_path:
            if not isinstance(value, dict):
                return None
            value = value.get(key)
        return value
