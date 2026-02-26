"""Constants for the Akari Manager integration."""

DOMAIN = "akari_manager"
PLATFORMS = ["sensor", "binary_sensor", "button"]

# Config entry keys
CONF_DEVICE_ID = "device_id"
CONF_API_URL = "api_url"
CONF_API_KEY = "api_key"

# API paths
API_STATUS = "/api/status"
API_SYSTEM_INFO = "/api/system/info"
API_SYSTEM_LOGS = "/api/logs"
API_CONFIG = "/api/config"
API_CONFIG_SECTION = "/api/config/{section}"
API_RELOAD = "/api/config/reload"
API_RESTART = "/api/system/restart"
API_DEVICES = "/api/devices"

# MQTT
MQTT_DISCOVERY_TOPIC = "home/+/info"
MQTT_DISCOVERY_TIMEOUT = 5  # seconds

# Update interval
UPDATE_INTERVAL_SECONDS = 30

# Config sections
CONFIG_SECTIONS = ["mqtt", "devices", "covers", "sensors", "modbus", "system"]

# Service names
SERVICE_GET_CONFIG_SECTION = "get_config_section"
SERVICE_UPDATE_CONFIG_SECTION = "update_config_section"
SERVICE_GET_DEVICES = "get_devices"
