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
- `POST /subscribe` - Subscribe to push notifications
- `POST /unsubscribe` - Unsubscribe from notifications
- `GET /testNotify` - Send test notification

### 2. BSClient (bs-client.js)
Modbus TCP client for communicating with the Blu Sentintel pool chemistry controller:
- Connects to pool controller via Modbus TCP (port 502)
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
- **style.css** - Responsive CSS styling
- **sw.js** - Service worker for push notifications, no explicit offline support
- **manifest.json** - PWA manifest for installability

**Features:**
- Real-time status updates (30-second refresh)
- Push notification settings with threshold configuration
- Raw data modal for detailed system information
- Responsive design for mobile and desktop

## Data Flow

### 1. Monitoring Loop
The system operates on multiple overlapping cycles that handle different aspects of data collection and processing:

**Blue Sentinel Polling (60-second cycle)**: The server regularly polls the Blue Sentinel pool controller via Modbus TCP to read chemistry values, system status, and check for new alarm conditions. This polling approach is necessary due to the Modbus protocol's request-response nature.

**Pentair Real-time Updates**: The Pentair heater system provides real-time status updates through a persistent WebSocket connection. Changes in heater status, temperature setpoints, and water temperature are pushed immediately to the BSMon server without polling, enabling responsive monitoring of heating operations.

**Periodic Logging (10-minute intervals)**: The Logger accumulates samples from both the Blue Sentinel polling cycles and Pentair real-time updates, computing mean values over the logging period before writing entries to monthly CSV files. This approach provides historical data while smoothing out short-term fluctuations.

**Alarm Processing**: During each Blue Sentinel polling cycle, the system checks for new alarm conditions and sends push notifications to subscribed clients when thresholds are exceeded or new alarm messages are detected.

## Configuration

### Settings (settings.json)
- **port**: HTTP server port (default: 8076)
- **bshost**: Pool controller IP address
- **pentair_host**: Pentair heater IP address (optional)
- **vapid_***: WebPush VAPID keys for notifications
- **alarm_poll_seconds**: Device polling interval (default: 60)
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

### File Structure
```
BSMon/
├── server.js              # Main server application
├── bs-client.js          # Pool controller client
├── pentair-client.js     # Heater system client
├── logger.js             # Data logging system
├── fake-controller.js    # Testing utilities
├── dump-heater.js        # Utility scripts
├── settings.json         # Runtime configuration
├── subscriptions.json    # Push notification subscriptions
├── static/               # Web application files
│   ├── index.html
│   ├── client.js
│   ├── style.css
│   ├── sw.js
│   ├── manifest.json
│   └── log-*.csv        # Generated log files
└── tests/               # Test suites
```

### Service Installation
The system includes `bsmon.service` for systemd service management on Linux systems.

## Testing

The system includes comprehensive test suites:
- **logger.test.js**: Logger functionality and data integrity
- **bitsVal.test.js**: Bit field parsing validation
- **roundRegister.test.js**: Number rounding and formatting
- **sanity.test.js**: Basic system functionality

Tests use Jest framework and includes mocking for external dependencies.

## Security Considerations

- **Anonymous access**: All data is read-only and not sensitive, so no authentication or authorization system is provided.
- **DOS Mitigation**: Limited subscription count (MAX_SUBSCRIPTIONS = 20)
- **Input Validation**: JSON payload size limits (1024 bytes)
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
