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
async function readRegisterRounded(client, register) {
    let val = await client.readRegister(register);
    return roundRegister(val, register);
}

async function getRegisterSet(client, rs) {
    let value = await readRegisterRounded(client, rs.value);
    let unit = await client.readRegister(rs.unit);

    let out = `${value} ${unit}`;
    if (rs.setpoint) {
        let setpoint = await readRegisterRounded(client, rs.setpoint);
        out += `, setpoint: ${setpoint}`;
    }
    if (rs.yout) {
        let yout = await readRegisterRounded(client, rs.yout);
        out += `, yout: ${yout}%`;
    }
    return out;
}

async function generateRawOutput() {
    let out = '';
    
    // Connection status
    if (bsClient) {
        const bsStatus = bsClient.getConnectionStatus();
        if (bsStatus.bluUptimeSeconds !== undefined) {
            out += `BluSentinel: Connected for ${bsStatus.bluUptimeSeconds} seconds\n`;
        } else {
            out += `BluSentinel: Disconnected for ${bsStatus.bluDowntimeSeconds} seconds\n`;
        }
    }
    
    if (pentairClient) {
        const pentairStatus = pentairClient.getConnectionStatus();
        if (pentairStatus.pentairUptimeSeconds !== undefined) {
            out += `Pentair: Connected for ${pentairStatus.pentairUptimeSeconds} seconds\n`;
        } else {
            out += `Pentair: Disconnected for ${pentairStatus.pentairDowntimeSeconds} seconds\n`;
        }
    } else {
        out += 'Pentair: Not configured\n';
    }
    
    out += '\n';
    
    if (bsClient && bsClient.getConnected()) {
        out += 'BluSentinel System: ' + await bsClient.readRegister(Registers.System) + '\n';
        for (const rs in RegisterSets) {
            out += rs + ': ' + await getRegisterSet(bsClient, RegisterSets[rs]) + '\n';
        }

        for (const r of ['Alarms', 'ClMode', 'PhMode', 'ClError', 'PhError', 'ORPError', 'TempError']) {
            out += r + ': ' + await bsClient.readRegister(Registers[r]) + '\n';
        }
        // It seems Alarm 1 is the meaningful alarm. 2-5 are always set. 

        // Alarms like low chlorine may be here without any indication in the registers.
        let dataAlarms = await bsClient.getAlarmData();
        out += `Alarm Messages: ${dataAlarms.alarms}\n`
        for (const am of dataAlarms.messages) {
            out += `  ${am.sourceTxt}: ${am.msgTxt} [${am.rdate}]\n`
        }
    } else {
        out += 'BluSentinel device offline\n';
    }

    out += '\n';
    if (pentairClient && pentairClient.isConnected()) {
        out += 'Pentair data:\n';
        out += `Heater On: ${pentairClient.heaterOn ? 'Yes' : 'No'}\n`;
        out += `Setpoint: ${pentairClient.setpoint}\n`;
        out += `Water Temp: ${pentairClient.waterTemp}\n`;
        out += `Total Heater On Time: ${pentairClient.getCurrentTotalHeaterOnTime()}\n`
        out += `Total Connection Time: ${pentairClient.getCurrentTotalConnectionTime()}\n`;
    } else if (pentairClient) {
        out += 'Pentair device offline\n';
    } else {
        out += 'No Pentair device configured\n';
    }

    return out;
}

const app = express();
app.use(express.static('static'))
app.use(express.json({limit: 1024})); 

webpush.setVapidDetails(
    settings.vapid_contact,
    settings.vapid_public_key,
    settings.vapid_private_key
  );

app.get('/status.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    generateRawOutput().then((data) => {
        res.end(data);
    }).catch((error) => {
        console.error("Error generating status output:", error, error.stack);
        res.status(500);
        res.end("ERRORX: " + error.message + error.stack);
    });
});

app.get('/api/status', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    
    try {
        const statusData = {};
        
        // Only include BS data if device is connected
        if (bsClient && bsClient.getConnected()) {
            statusData.system = {
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
        }

        // Only include Pentair data if device is connected
        if (pentairClient && pentairClient.isConnected()) {
            statusData.heaterOn = pentairClient.heaterOn;
            statusData.setpoint = pentairClient.setpoint;
            statusData.waterTemp = pentairClient.waterTemp;
        }
        
        // Add connection status
        if (bsClient) {
            Object.assign(statusData, bsClient.getConnectionStatus());
        }
        if (pentairClient) {
            Object.assign(statusData, pentairClient.getConnectionStatus());
        }

        // Add server uptime
        statusData.bsmonUptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);

        // Add server configuration and current time
        statusData.config = {
            logIntervalMinutes: settings.log_entry_minutes
        };
        statusData.currentTime = new Date();
        
        res.json(statusData);
    } catch (error) {
        console.error("Error generating status data:", error, error.stack);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    
    try {
        // Parse and validate days parameter
        let days = parseInt(req.query.days) || 1; // Default to 1 day (24h)
        days = Math.max(1, Math.min(30, days)); // Cap between 1 and 30 days
        
        const logger = new Logger();
        const now = new Date();
        const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        
        // Generate ETag based on log file metadata
        const etag = logger.getLogFilesETag(startTime, now);
        res.setHeader('ETag', etag);
        
        // Check if client already has this version
        const clientETag = req.headers['if-none-match'];
        if (clientETag && clientETag === etag) {
            res.status(304).end();
            return;
        }
        
        // Generate and send the CSV data
        const csvData = logger.getHistoricalCSV(startTime, now);
        res.send(csvData);
    } catch (error) {
        console.error("Error generating log data:", error, error.stack);
        res.status(500).send(`Error generating log data: ${error.message}`);
    }
});

app.get('/vapid_public_key.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(settings.vapid_public_key);
});

app.post('/subscribe', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const data = req.body;
    const subscription = data.subscription;

    if (!subscription || !subscription.endpoint || !data.settings) {
        res.status(500).send('Invalid subscription format');
        return;
    }

    if (subscriptionMap.size > MAX_SUBSCRIPTIONS) {
        console.log("Too many subscriptions");
        res.status(500).send('Too many subscriptions');
        return;
    }


    const had = subscriptionMap.has(subscription.endpoint);
    data.lastSeen = new Date();
    data.lastIP = req.ip;
    subscriptionMap.set(subscription.endpoint, data);
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
    const subscription = req.body.subscription;

    if(subscriptionMap.has(subscription.endpoint)) {
        subscriptionMap.delete(subscription.endpoint);
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
