const Buffer = require('node:buffer');
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert');
const express = require('express')
const webpush = require('web-push');
const { BSClient, Registers, bitsVal } = require('./bs-client');
const PentairClient = require('./pentair-client');
const Logger = require('./logger');

const settings = require('./settings.json');

// Security validation functions
function isValidPushEndpoint(unsafeUrl) {
    if (typeof unsafeUrl !== 'string') return false;
    
    try {
        const url = new URL(unsafeUrl);
        return url.protocol === 'https:' && url.hostname === 'fcm.googleapis.com';
    } catch {
        return false;
    }
}

function isValidETag(unsafeETag) {
    return typeof unsafeETag === 'string' && unsafeETag.length < 256;
}

function isValidBase64(str) {
    if (typeof str !== 'string') return false;
    // Base64 regex pattern
    return /^[A-Za-z0-9+/]*(=|==)?$/.test(str) && str.length > 0;
}

function validateSubscriptionData(unsafeData) {
    if (!unsafeData || typeof unsafeData !== 'object') {
        return { valid: false, error: 'Invalid request format' };
    }

    const { subscription: unsafeSubscription, settings: unsafeSettings } = unsafeData;
    let data = {subscription: {}, settings: {}};

    // Validate and copy subscription object
    if (!unsafeSubscription || typeof unsafeSubscription !== 'object') {
        return { valid: false, error: 'Missing or invalid subscription' };
    }

    if (!isValidPushEndpoint(unsafeSubscription.endpoint)) {
        return { valid: false, error: 'Invalid subscription endpoint' };
    }
    data.subscription.endpoint = unsafeSubscription.endpoint;

    if (unsafeSubscription.expirationTime !== null && typeof unsafeSubscription.expirationTime !== 'number') {
        return { valid: false, error: 'Invalid subscription expirationTime' };
    }
    data.subscription.expirationTime = unsafeSubscription.expirationTime;

    if (!unsafeSubscription.keys || typeof unsafeSubscription.keys !== 'object') {
        return { valid: false, error: 'Missing subscription keys' };
    }

    if (!isValidBase64(unsafeSubscription.keys.p256dh)) {
        return { valid: false, error: 'Invalid p256dh key' };
    }

    if (!isValidBase64(unsafeSubscription.keys.auth)) {
        return { valid: false, error: 'Invalid auth key' };
    }
    data.subscription.keys = {
        p256dh: unsafeSubscription.keys.p256dh,
        auth: unsafeSubscription.keys.auth
    };

    // Validate and copy settings object
    if (!unsafeSettings || typeof unsafeSettings !== 'object') {
        return { valid: false, error: 'Missing or invalid settings' };
    }
    
    const allowedNumericSettings = ['clyout-max', 'acidyout-max', 'temp-min'];
    const allowedBooleanSettings = ['notified-temp-min', 'notified-clyout-max', 'notified-acidyout-max'];

    for (const [key, value] of Object.entries(unsafeSettings)) {
        if (allowedNumericSettings.includes(key)) {
            if (typeof value !== 'number' || value < 0 || value > 1000) {
                return { valid: false, error: `Invalid ${key} value` };
            }
            data.settings[key] = value;
        } else if (allowedBooleanSettings.includes(key)) {
            if (typeof value !== 'boolean') {
                return { valid: false, error: `Invalid ${key} value` };
            }
            data.settings[key] = value;
        } else {
            return { valid: false, error: `Unexpected setting: ${key}` };
        }
    }

    return { valid: true, data: data };
}

// Security headers middleware
function addSecurityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Add HSTS header if using HTTPS
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    
    next();
}

// DOS mitigation
// Could add a key to prevent abuse
const MAX_SUBSCRIPTIONS = 20;

// Main state variables
let bsClient = null;
let pentairClient = null;
let logger = null;
let lastAlarmDate = null;
let serverStartTime = Date.now(); // Track when the server started

// Map of endpoint strings to objects with the following properties:
//  'subscription': The subscription object used directly by WebPush
//  'settings': UI options for notifications, eg. "clyout-max"
//  'lastSeen': Date object when the client last connected
//  'lastIP': most recent IP address of the client
let subscriptionMap;
const SUBSCRIPTIONS_FILE = 'subscriptions.json';
if( fs.existsSync(SUBSCRIPTIONS_FILE) ) {
    subsJson = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
    subscriptionMap = new Map(Object.entries(JSON.parse(subsJson)));
} else {
    subscriptionMap = new Map();
}
function writeSubscriptions() {
    let obj = Object.fromEntries(subscriptionMap);
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(obj));
}

const RegisterSets = {
    'Chlorine': {
        value: Registers.ClValue,
        unit: Registers.ClUnit,
        setpoint: Registers.ClSet,
        yout: Registers.ClYout
    },
    'pH': {
        value: Registers.PhValue,
        unit: Registers.PhUnit,
        setpoint: Registers.PhSet,
        yout: Registers.PhYout
    },
    'ORP': {
        value: Registers.ORPValue,
        unit: Registers.ORPUnit,
    },
    'Temperature': {
        value: Registers.TempValue,
        unit: Registers.TempUnit,
    }
}

function roundRegister(val, register) {
    if (`round` in register) {
        return val.toFixed(register.round);
    }
    return val.toString();
}

const app = express();

// Allow clients running on other hosts to access the API.
// This is specifically useful for testing client-only changes, but there's no security reason why
// access to the API would be dangerous. 
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    next();
});

app.use(addSecurityHeaders); // Apply security headers to all routes
app.use(express.static('static')) // Static files are safe - no sensitive data in /static directory
app.use(express.json({limit: 1024})); 

webpush.setVapidDetails(
    settings.vapid_contact,
    settings.vapid_public_key,
    settings.vapid_private_key
  );

app.get('/api/status', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    
    try {
        const statusData = {
            system: {
                logIntervalMinutes: settings.log_entry_minutes,
                currentTime: new Date(),
                uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000)
            }
        };
        
        // Only include BS data if device is connected
        if (bsClient && bsClient.getConnected()) {
            statusData.blusentinel = {
                name: await bsClient.readRegister(Registers.System),
                clMode: await bsClient.readRegister(Registers.ClMode),
                phMode: await bsClient.readRegister(Registers.PhMode),
                clError: await bsClient.readRegister(Registers.ClError),
                phError: await bsClient.readRegister(Registers.PhError),
                orpError: await bsClient.readRegister(Registers.ORPError),
                tempError: await bsClient.readRegister(Registers.TempError),
                alarms: await bsClient.readRegister(Registers.Alarms)
            };
            statusData.chlorine = {
                value: await bsClient.readRegister(Registers.ClValue),
                unit: await bsClient.readRegister(Registers.ClUnit),
                setpoint: await bsClient.readRegister(Registers.ClSet),
                output: await bsClient.readRegister(Registers.ClYout)
            };
            statusData.ph = {
                value: await bsClient.readRegister(Registers.PhValue),
                unit: await bsClient.readRegister(Registers.PhUnit),
                setpoint: await bsClient.readRegister(Registers.PhSet),
                output: await bsClient.readRegister(Registers.PhYout)
            };
            statusData.orp = {
                value: await bsClient.readRegister(Registers.ORPValue),
                unit: await bsClient.readRegister(Registers.ORPUnit)
            };
            statusData.temperature = {
                value: await bsClient.readRegister(Registers.TempValue),
                unit: await bsClient.readRegister(Registers.TempUnit)
            };
            statusData.alarmMessages = await bsClient.getAlarmData();
            const bsStatus = bsClient.getConnectionStatus();
            if (bsStatus.bluUptimeSeconds !== undefined) {
                statusData.blusentinel.uptimeSeconds = bsStatus.bluUptimeSeconds;
            }
            if (bsStatus.bluDowntimeSeconds !== undefined) {
                statusData.blusentinel.downtimeSeconds = bsStatus.bluDowntimeSeconds;
            }
        }

        // Only include Pentair data if device is connected
        if (pentairClient && pentairClient.isConnected()) {
            statusData.pentair = {
                heaterOn: pentairClient.heaterOn,
                setpoint: pentairClient.setpoint,
                waterTemp: pentairClient.waterTemp
            };
            const pentairStatus = pentairClient.getConnectionStatus();
            if (pentairStatus.pentairUptimeSeconds !== undefined) {
                statusData.pentair.uptimeSeconds = pentairStatus.pentairUptimeSeconds;
            }
            if (pentairStatus.pentairDowntimeSeconds !== undefined) {
                statusData.pentair.downtimeSeconds = pentairStatus.pentairDowntimeSeconds;
            }
        }
        
        res.json(statusData);
    } catch (error) {
        console.error("Error generating status data:", error, error.stack);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    
    try {
        // Parse and validate days parameter (UNSAFE: user input)
        const unsafeDaysParam = req.query.days;
        let days = parseInt(unsafeDaysParam) || 1; // Default to 1 day (24h)
        days = Math.max(1, Math.min(30, days)); // Cap between 1 and 30 days
        
        const logger = new Logger();
        const now = new Date();
        const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        
        // Generate ETag based on log file metadata
        const etag = logger.getLogFilesETag(startTime, now);
        res.setHeader('ETag', etag);
        
        // Check if client already has this version (UNSAFE: user input)
        const unsafeClientETag = req.headers['if-none-match'];
        if (unsafeClientETag && unsafeClientETag === etag) {
            res.status(304).end();
            return;
        }
        
        // Generate and send the CSV data
        const csvData = logger.getHistoricalCSV(startTime, now);
        res.send(csvData);
    } catch (error) {
        console.error("Error generating log data:", error, error.stack);
        res.status(500).send("Internal server error");
    }
});

app.get('/vapid_public_key.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(settings.vapid_public_key);
});

app.post('/subscribe', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    
    // Validate subscription data (UNSAFE: user input)
    const unsafeRequestBody = req.body;
    const validation = validateSubscriptionData(unsafeRequestBody);
    
    if (!validation.valid) {
        res.status(400).send(validation.error);
        return;
    }

    if (subscriptionMap.size >= MAX_SUBSCRIPTIONS) {
        console.log("Too many subscriptions");
        res.status(429).send('Too many subscriptions');
        return;
    }

    const endpoint = validation.data.subscription.endpoint;
    const had = subscriptionMap.has(endpoint);
    
    validation.data.lastSeen = new Date();
    validation.data.lastIP = req.ip; // Store the last IP address of the client
    subscriptionMap.set(endpoint, validation.data);
    writeSubscriptions();
    
    if (had) {
        res.send(`Existing subscription (${subscriptionMap.size} total)`);
    } else {
        let status = `New subscription (${subscriptionMap.size} total)`
        console.log(`Client ${req.ip}: ${status}`);
        res.send(status);
    }
});

app.post('/unsubscribe', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    
    // Validate unsubscribe data (UNSAFE: user input)
    const unsafeRequestBody = req.body;
    
    if (!unsafeRequestBody || typeof unsafeRequestBody !== 'object') {
        res.status(400).send('Invalid request format');
        return;
    }

    const { subscription: unsafeSubscription } = unsafeRequestBody;
    
    if (!unsafeSubscription || typeof unsafeSubscription !== 'object') {
        res.status(400).send('Missing or invalid subscription');
        return;
    }

    if (!isValidPushEndpoint(unsafeSubscription.endpoint)) {
        res.status(400).send('Invalid subscription endpoint');
        return;
    }

    if(subscriptionMap.has(unsafeSubscription.endpoint)) {
        subscriptionMap.delete(unsafeSubscription.endpoint);
        writeSubscriptions();
        let status = `Unsubscribed (${subscriptionMap.size} total)`
        console.log(`Client ${req.ip}: ${status}`);
        res.send(status);
    } else {
        res.send("Not subscribed");
    }
});

async function sendNotifications(msg) {
    const options = {
        urgency: 'high'
    };
    let sent = 0;
    
    for(const subdata of subscriptionMap.values()) {
        try {
            await webpush.sendNotification(subdata.subscription, msg, options);
            sent++;
        } catch (err) {
            console.log(`Error ${err.statusCode} sending notification to ${subdata.subscription.endpoint}: ${err}. ${err.body}`);
        }
    }
    return sent;
}

app.get('/testNotify', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    sendNotifications('Test').then((sent) => {
        let status = `Sent ${sent}/${subscriptionMap.size} test notifications ` 
        console.log(status);
        res.send(status);
    });
});

let server = null;

function startServer(port = settings.port) {
    let mode = null;
    if (settings.tls_private_key_file && settings.tls_cert_file) {
        server = https.createServer({
            key: fs.readFileSync(settings.tls_private_key_file),
            cert: fs.readFileSync(settings.tls_cert_file),
        },
        app)
        mode = 'https';
    } else {
        server = http.createServer(app);
        mode = 'http';
    }
    server.listen(port, () => {
        console.log(`Server listening for ${mode} on port ${port}`);
    });
    return server;
}

function stopServer() {
    if (server) {
        server.close();
        server = null;
    }
}

async function checkAlarms() {
    if (!bsClient.getConnected()) {
        return;
    }

    let dataAlarms = null;
    try {
        dataAlarms = await bsClient.getAlarmData();
    } catch(err) {
        if ((err.cause && err.cause.code === 'UND_ERR_CONNECT_TIMEOUT') || 
            err.message === 'fetch failed') {
            logger.incrementTimeoutCount();
            return;
        } else {
            console.error(`Unexpected error getting alarm data: ${err.message}`);
            console.error(err.stack || err);
            return;
        }
    }
    for (const am of dataAlarms.messages) {
        const rdate = new Date(am.rdate);
        if (!lastAlarmDate || rdate > lastAlarmDate) {
            lastAlarmDate = rdate;
            const msg = `${am.sourceTxt}: ${am.msgTxt}`;
            console.log(`Sending alarm notification: ${msg} [${am.rdate}]`);
            await sendNotifications(msg);
        }
    }

    // Look for register values which have exceeded the maximums registered
    // in notification subscriptions.
    let writeSubs = false;
    try {
        const limitMap = {
            'clyout-max': { 'r': Registers.ClYout, 'max': true},
            'acidyout-max': { 'r': Registers.PhYout, 'max': true},
            'temp-min': { 'r': Registers.TempValue, 'max': false}
        }
        for (const limitSet in limitMap) {
            const notkey = 'notified-' + limitSet;
            let val = await bsClient.readRegister(limitMap[limitSet].r);
            assert(typeof val == 'number', `Invalid value for ${limitSet}: ${typeof val}`);
            const isMax = limitMap[limitSet].max;
            const compare = isMax ? (a,b) => (a>b) : (a,b) => (a<b);
            for (const subdata of subscriptionMap.values()) {
                let ss = subdata.settings;
                if (ss[limitSet]) {
                    // Notify once when the limit is exceeded, don't notify again until
                    // after the value has returned to normal range.
                    // TODO: Could we track notification dismissal instead?
                    if (compare(val, ss[limitSet])) {
                        if (!ss[notkey]) {
                            const vr = roundRegister(val, limitMap[limitSet].r);                
                            await webpush.sendNotification(subdata.subscription, 
                                `${isMax ? 'Exceeded' : 'Dropped below'} ${limitSet}: ${vr}`);
                            ss[notkey] = true;
                            writeSubs = true;
                        }
                    } else if (ss[notkey]) {
                        ss[notkey] = false;
                        writeSubs = true;
                    }
                }
            }
        }
        if (writeSubs) {
           writeSubscriptions();
        }

    } catch(err) {
        console.error(`Error polling registers: ${err.message}`);
        console.error(err.stack || err);
        return;
    }
}

let inPoll = false;
async function pollDevices() {
    try {
        if (inPoll) {
            console.warn("Already polling, skipping this cycle");
            return;
        }
        inPoll = true;
        await checkAlarms();
        await logger.updateLog();
    } catch (err) {
        console.error("pollDevices error:", err.message);
        console.error(err.stack || err);
        logger.incrementTimeoutCount();
    } finally {
        inPoll = false;
    }
}

// If started directly, start the server and polling.
if (require.main === module) {
    bsClient = new BSClient(settings);
    
    // Start connection management - this will handle initial connection and all reconnections
    bsClient.scheduleReconnect();
    
    if (settings.pentair_host) {
        pentairClient = new PentairClient(settings.pentair_host);
        pentairClient.connect().then(() => {
            console.log(`Pentair connection to ${settings.pentair_host} established`);
        }).catch((err) => {
            console.error('Failed to establish initial Pentair connection:', err.message);
        });
    } else {
        console.log("No Pentair host configured, skipping Pentair client setup.");
    }
    logger = new Logger({ bsClient, pentairClient });

    startServer();
    setInterval(() => pollDevices(), settings.blusentinel_poll_seconds * 1000);
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('Shutting down gracefully...');
        if (bsClient) {
            await bsClient.close();
        }
        if (pentairClient) {
            await pentairClient.disconnect();
        }
        stopServer();
        process.exit(0);
    });
}

if (process.env.NODE_ENV === 'test') {
    module.exports = { bitsVal, roundRegister, app, startServer, stopServer, Logger, Registers };
}
