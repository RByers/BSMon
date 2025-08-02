# BSMon System Architecture

BSMon is a Node.js-based pool monitoring system that provides real-time monitoring, logging, and notifications for pool chemistry and equipment status. The system consists of a backend Node.js server that communicates with pool equipment via Modbus TCP and WebSocket protocols, and serves a progressive web application for monitoring and control.

## Core Components

### 1. Server (server.js)
The main Express.js application server that:
- Serves the static web application
- Provides REST API endpoints for status data
- Handles WebPush notifications and subscriptions
- Manages periodic polling of devices for alarms and logging
- Supports both HTTP and HTTPS with TLS configuration

**Key Endpoints:**
- `GET /api/status` - JSON structured status data
- `GET /status.txt` - Human-readable text status
- `GET /api/logs?days=N` - CSV data for last N days of log entries (capped at 30, defaults to 1)
- `POST /subscribe` - Subscribe to push notifications
- `POST /unsubscribe` - Unsubscribe from notifications
- `GET /testNotify` - Send test notification

### 2. BSClient (bs-client.js)
Modbus TCP client for communicating with the Blu Sentintel pool chemistry controller:
- Maintains a single persistent connection to pool controller via Modbus TCP (port 502)
- Automatic reconnection with exponential backoff when connection is lost
- Reads various register types (Float, ASCII, UInt16, UInt32)
- Polls periodically to provide structured access to pool chemistry data and system status
- Fetches alarm data via HTTP from controller's web interface
- Supports fake controller mode for testing

**Key Registers:**
- Chemistry values: Chlorine, pH, ORP, Temperature (with units and setpoints)
- Output levels: Chlorine and pH output percentages (duty cycle)
- System status: Modes, errors, alarms for each parameter
- Alarm messages with timestamps and priorities

### 3. PentairClient (pentair-client.js)
WebSocket client for Pentair heater system integration:
- Connects via WebSocket to Pentair controller (port 6680)
- Monitors heater status, setpoint, and water temperature
- Tracks total heater on-time for energy monitoring
- Implements automatic reconnection with exponential backoff
- Maintains a persistent connection with heatbeat protection to avoid the need for polling.

### 4. Logger (logger.js)
Data logging system that:
- Accumulates samples from BSClient and PentairClient
- Writes periodic entries to monthly CSV log files
- Computes mean values over sampling periods
- Tracks connection success/timeout statistics
- Stores logs in `static/log-YYYY-MM.csv` format for web access

**Logged Data:**
- All chemistry values (Cl, pH, ORP, Temp) with setpoints and outputs
- Success/timeout counts for reliability monitoring
- Heater on-time, setpoint, and water temperature
- Configurable logging intervals (default: 10 minutes)

### 5. Frontend (static/)
Progressive Web Application with:
- **index.html** - Main dashboard interface with metric cards
- **client.js** - JavaScript for API communication, notifications, UI updates
- **logreader.js** - Client-side CSV parsing and metric calculations
- **style.css** - Responsive CSS styling
- **sw.js** - Service worker for push notifications, no explicit offline support
- **manifest.json** - PWA manifest for installability

**Features:**
- Real-time status updates (30-second refresh)
- Client-side calculated metrics based on server-stored log data
- Push notification settings with threshold configuration
- Raw data modal for detailed system information
- Responsive design for mobile and desktop

## Device Resilience

The system is designed to handle device connectivity issues gracefully:

**Connection Monitoring**: Both BSClient and PentairClient track connection status and provide `getConnected()` and `isConnected()` methods respectively.

**Resilient Status Endpoints**: Status endpoints (`/api/status`, `/status.txt`) check device connectivity before attempting data collection and return partial data rather than failing completely when devices are offline.

**Continuous Logging**: The Logger continues writing log entries even when devices are offline:
- When devices are offline for entire logging periods, empty values are written to CSV columns
- When devices are partially available, averages are computed from successful samples only
- CSV column order is preserved for backward compatibility with existing log files

**Alarm Processing**: Alarm processing checks device connectivity before attempting to read alarm data, preventing error spam during outages while allowing reconnection attempts to be logged.

**Offline Data Handling**: Consistently uses empty strings for offline device data in CSV logs, with null values from uninitialized Pentair properties handled appropriately.

## Data Flow

### 1. Monitoring Loop
The system operates on multiple overlapping cycles that handle different aspects of data collection and processing:

**Blue Sentinel Polling (10-second cycle)**: The server regularly polls the Blue Sentinel pool controller via Modbus TCP to read chemistry values, system status, and check for new alarm conditions. If the device is offline, polling is skipped and logged appropriately. This polling approach is necessary due to the Modbus protocol's request-response nature.

**Pentair Real-time Updates**: The Pentair heater system provides real-time status updates through a persistent WebSocket connection. Changes in heater status, temperature setpoints, and water temperature are pushed immediately to the BSMon server without polling, enabling responsive monitoring of heating operations. When disconnected, the system gracefully handles missing data.

**Periodic Logging (10-minute intervals)**: The Logger accumulates samples from both the Blue Sentinel polling cycles and Pentair real-time updates, computing mean values over the logging period before writing entries to monthly CSV files. **Log entries are always written**, even when devices are offline - offline periods result in empty CSV values while maintaining historical continuity.

**Alarm Processing**: During each Blue Sentinel polling cycle, the system checks device connectivity before processing alarms. If the device is offline, alarm processing is skipped to avoid error spam while reconnection attempts continue in the background.

## Configuration

### Settings (settings.json)
- **port**: HTTP server port (default: 8076)
- **bshost**: Pool controller IP address
- **pentair_host**: Pentair heater IP address (optional)
- **vapid_***: WebPush VAPID keys for notifications
- **blusentinel_poll_seconds**: BluSentinel device polling interval controlling both alarms and data logging (default: 10)
- **log_entry_minutes**: Logging interval (default: 10)
- **tls_***: Optional TLS certificate files for HTTPS
- **use_fake_controller**: Enable fake controller for testing

## Deployment

### Dependencies
- **express**: Web server framework
- **modbus-serial**: Modbus TCP communication
- **ws**: WebSocket client for Pentair
- **web-push**: Push notification support
- **uuid**: Unique identifier generation

### Service Installation
The system includes `bsmon.service` for systemd service management on Linux systems.

## Testing (tests/)

The system includes comprehensive test suites:
- **logger.test.js**: Logger functionality and data integrity
- **logreader.test.js**: Client-side CSV parsing and metric calculations
- **bitsVal.test.js**: Bit field parsing validation
- **roundRegister.test.js**: Number rounding and formatting
- **sanity.test.js**: Basic system functionality

Tests use Jest framework and includes mocking for external dependencies.

## Security Considerations

- **Anonymous access**: All data is read-only and not sensitive, so no authentication or authorization system is provided.
- **Input Validation**: All user input variables are prefixed with `unsafe` and undergo strict validation. Subscription endpoints are restricted to Google FCM with comprehensive property validation and allowlisting.
- **Security Headers**: Standard headers applied globally (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Strict-Transport-Security` for HTTPS).
- **Error Sanitization**: Generic error messages sent to clients while detailed errors are logged server-side to prevent information disclosure.
- **DOS Mitigation**: Limited subscription count (MAX_SUBSCRIPTIONS = 20) and JSON payload size limits (1024 bytes)
- **TLS Support**: Optional HTTPS with certificate configuration
- **Network Isolation**: Exposes a public web interface for devices otherwise secured on a private network
- **Subscription Management**: Automatic cleanup of invalid push subscriptions

## Monitoring and Diagnostics

### Logging
- Console logging for connection events and errors
- CSV data logs for historical analysis
- Timeout tracking for connection reliability
- Push notification delivery status

### Debugging Features
- Fake controller mode for development
- Raw data access via `/status.txt` endpoint
- Test notification endpoint
- Detailed error messages in API responses
