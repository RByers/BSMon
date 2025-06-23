const Buffer = require('node:buffer');
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const assert = require('node:assert');
const express = require('express')
const webpush = require('web-push');
const ModbusRTU = require('modbus-serial');
const FakeController = require('./fake-controller');
const PentairClient = require('./pentair-client');

const settings = require('./settings.json');

const MODBUS_PORT = 502;

// DOS mitigation
// Could add a key to prevent abuse
const MAX_SUBSCRIPTIONS = 20;

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

// Protocol definition from https://epipreprod.evoqua.com/siteassets/documents/extranet/a_temp_ext_dis/blu-sentinel-se_w3t387175_wt.050.511.000.de.im.pdf
const RF = {
    Float: 'Float',
    ASCII: 'ASCII',
    UInt16: 'UInt16',
    UInt32: 'UInt32'
}
const MODE_BITS = ['Manual', 'Auto', 'Controller Aus', 'Adaption running',, 'Controller stop',
    'Controller freeze', 'Controller Yout=100%',,,, 'Eco mode switching', 'Controller standby'];
const ERROR_BITS = ['Zero point calibration', 'DPD calibration', 'pH7 calibration', 'phX calibration',
    'Error calibration eg. ORP', 'Offset calibration',, 'Cell error', 'Factory calibraiton error',,,
    'Setpoint error', 'Limit error', 'HOCL error',, 'Overfeed', 'Auto tune error'];
const ALARM_BITS = ['1-Master', '2-Normal', '3-Normal', '4-Normal', '5-Normal', '6-Unknown', 
    '7-Unknown', '8-Unknown'];
const Registers = {
    'System':   {reg: 1,   format: RF.ASCII, len: 20},
    'ClValue':  {reg: 100, format: RF.Float, round: 2},
    'ClUnit':   {reg: 102, format: RF.ASCII, len: 10},
    'ClSet':    {reg: 111, format: RF.Float, round: 1},
    'ClYout':   {reg: 113, format: RF.Float, round: 2},
    'PhValue':  {reg: 115, format: RF.Float, round: 2},
    'PhUnit':   {reg: 117, format: RF.ASCII, len: 10},
    'PhSet':    {reg: 126, format: RF.Float, round: 1},
    'PhYout':   {reg: 128, format: RF.Float, round: 1},
    'ORPValue': {reg: 130, format: RF.Float, round: 0},
    'ORPUnit':  {reg: 132, format: RF.ASCII, len: 10},
    'TempValue':{reg: 160, format: RF.Float, round: 1},
    'TempUnit': {reg: 162, format: RF.ASCII, len: 10},
    // Only Alarm 1 seems useful so far
    'Alarms':   {reg: 300, format: RF.UInt16, bits: ALARM_BITS}, 
    // Note: ClMode is 0 even under low chlorine error
    'ClMode':   {reg: 304, format: RF.UInt16, bits: MODE_BITS},
    'PhMode':   {reg: 305, format: RF.UInt16, bits: MODE_BITS},
    'ClError':  {reg: 310, format: RF.UInt32, bits: ERROR_BITS},
    'PhError':  {reg: 314, format: RF.UInt32, bits: ERROR_BITS},
    'ORPError': {reg: 318, format: RF.UInt32, bits: ERROR_BITS},
    'TempError':{reg: 328, format: RF.UInt32, bits: ERROR_BITS},
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

function bitsVal(val, bits) {
    if (!bits)
        return val;
    if (!val)
        return '0';

    let out = [];
    for (let i = 0; i < bits.length; i++) {
        if (val & (1 << i))
            out.push(bits[i]);
    }
    return out.join(', ');
}

function readRegister(client, register) {
    return new Promise((resolve, reject) => {
        let len = 2;
        let rn = register.reg;
        if (register.format == RF.ASCII) {
            len = register.len / 2;
            //  Strangely I have to subtract 1 from the register number for ASCII registers
            rn -= 1;
        }

        client.readHoldingRegisters(rn, len, (err, data) => {
            if (err) {
                reject(err);
            } else {
                switch(register.format) {
                    case RF.Float:
                        let floatVal = data.buffer.readFloatBE();
                        resolve(floatVal);
                        break;
                    case RF.ASCII:
                        // Null-terminated string in 16-bit registers, so swap bytes
                        let buf = data.buffer.swap16();
                        let i = buf.indexOf(0);
                        if (i == -1)
                            i = buf.length;
                        resolve(buf.toString('latin1', 0, i));
                        break;
                    case RF.UInt16:
                        let u16val = data.buffer.readUInt16BE();
                        resolve(bitsVal(u16val, register.bits));
                        break;
                    case RF.UInt32:
                        let u32val = data.buffer.readUInt32BE();
                        resolve(bitsVal(u32val, register.bits));
                        break;
                }
            }
        });
    });
}

function roundRegister(val, register) {
    if (`round` in register) {
        return val.toFixed(register.round);
    }
    return val.toString();
}
async function readRegisterRounded(client, register) {
    let val = await readRegister(client, register);
    return roundRegister(val, register);
}

async function getRegisterSet(client, rs) {
    let value = await readRegisterRounded(client, rs.value);
    let unit = await readRegister(client, rs.unit);

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

function connect(client) {
    return new Promise((resolve, reject) => {
        client.connectTCP(settings.bshost, { port: MODBUS_PORT }, () => {
            client.setID(1);
            resolve();
        });
    });
}

function close(client) {
    return new Promise((resolve, reject) => {
        client.close(resolve);
    });
}

async function getAlarmData() {
    if (settings.use_fake_controller) {
        return {
                "alarms": 1,
                "messages": [
                  {
                    "id": 8,
                    "rdate": "2025-05-01T19:19",
                    "prio": 3,
                    "groupID": 1,
                    "bgcolor": "#FF0000",
                    "ftcolor": "#FFFFFF",
                    "ack": false,
                    "sourceID": 0,
                    "sourceTxt": "Alarm",
                    "msgTxt": "Chlorine High"
                  }
                ]                
        };
    }
    
    let res = await fetch('http://' + settings.bshost + '/ajax_dataAlarms.json')
    let dataAlarms = await res.json();
    return dataAlarms;
}   

async function generateOutput() {
    const client = settings.use_fake_controller ? new FakeController() : new ModbusRTU();
    await connect(client);
    try {
        out = 'System: ' + await readRegister(client, Registers.System) + '\n';
        for (rs in RegisterSets) {
            out += rs + ': ' + await getRegisterSet(client, RegisterSets[rs]) + '\n';
        }
  
        for (const r of ['Alarms', 'ClMode', 'PhMode', 'ClError', 'PhError', 'ORPError', 'TempError']) {
            out += r + ': ' + await readRegister(client, Registers[r]) + '\n';
        }
        // It seems Alarm 1 is the meaningful alarm. 2-5 are always set. 

        // Alarms like low chlorine may be here without any indication in the registers.
        let dataAlarms = await getAlarmData();
        out += `Alarm Messages: ${dataAlarms.alarms}\n`
        for (const am of dataAlarms.messages) {
            out += `  ${am.sourceTxt}: ${am.msgTxt} [${am.rdate}]\n`
        }
    } finally {       
        await close(client);
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

    generateOutput().then((data) => {
        res.end(data);
    }).catch((error) => {
        res.end("ERROR: " + error.message);
    });
});

app.get('/api/status', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    
    try {
        const client = settings.use_fake_controller ? new FakeController() : new ModbusRTU();
        await connect(client);
        
        try {
            // Gather all data in structured format
            const statusData = {
                system: {
                    name: await readRegister(client, Registers.System),
                    clMode: await readRegister(client, Registers.ClMode),
                    phMode: await readRegister(client, Registers.PhMode),
                    clError: await readRegister(client, Registers.ClError),
                    phError: await readRegister(client, Registers.PhError),
                    orpError: await readRegister(client, Registers.ORPError),
                    tempError: await readRegister(client, Registers.TempError),
                    alarms: await readRegister(client, Registers.Alarms)
                },
                chlorine: {
                    value: await readRegister(client, Registers.ClValue),
                    unit: await readRegister(client, Registers.ClUnit),
                    setpoint: await readRegister(client, Registers.ClSet),
                    output: await readRegister(client, Registers.ClYout)
                },
                ph: {
                    value: await readRegister(client, Registers.PhValue),
                    unit: await readRegister(client, Registers.PhUnit),
                    setpoint: await readRegister(client, Registers.PhSet),
                    output: await readRegister(client, Registers.PhYout)
                },
                orp: {
                    value: await readRegister(client, Registers.ORPValue),
                    unit: await readRegister(client, Registers.ORPUnit)
                },
                temperature: {
                    value: await readRegister(client, Registers.TempValue),
                    unit: await readRegister(client, Registers.TempUnit)
                }
            };
            
            statusData.alarmMessages = await getAlarmData();

            if (logger.getPentairClient()) {
                const dutyCycles = logger.getPentairClient().getDutyCycles();
                statusData.heaterOn = dutyCycles.heaterOn;
                statusData.dutyCycle = dutyCycles.dutyCycle;
                statusData.dutyCycleTimeframe = dutyCycles.dutyCycleTimeframe;
                statusData.setpoint = dutyCycles.setpoint;
            }
            
            res.json(statusData);
        } finally {
            await close(client);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
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

class Logger {
    #fs;
    #settings;
    #nowFn;
    #regAccum = {};
    #accumSamples = 0;
    #lastLogEntry;
    #registersToLog = [
        'ClValue', 'PhValue', 'ORPValue', 'TempValue', 'ClSet', 'PhSet', 'ClYout', 'PhYout'
    ];
    #pentairFieldsToLog = [
        'HeaterOnSeconds', 'setpoint', 'waterTemp'
    ];
    #timeoutCount = 0;
    #pentairClient = null;
    #lastPentairHeaterOnTime = 0;

    constructor({ fs = require('fs'), settings = require('./settings.json'), nowFn = () => new Date() } = {}) {
        this.#fs = fs;
        this.#settings = settings;
        this.#nowFn = nowFn;
        this.#lastLogEntry = this.#nowFn();
    }

    incrementTimeoutCount() {
        this.#timeoutCount++;
    }

    setPentairClient(client) {
        this.#pentairClient = client;
    }

    getPentairClient() {
        return this.#pentairClient;
    }

    async #getBSData(client) {
        let regValues = {};
        for (let r of this.#registersToLog) {
            let val = await readRegister(client, Registers[r]);
            if (typeof val != 'number' || isNaN(val)) {
                console.error(`Invalid value for ${r}: ${val} (type: ${typeof val})`);
                throw new Error(`Invalid value for ${r}: ${val}`);
            }
            regValues[r] = val;
        }
        // Update accumulated values for computing a mean
        for (let r of this.#registersToLog) {
            if (!(r in this.#regAccum))
                this.#regAccum[r] = 0;
            this.#regAccum[r] += regValues[r];
        }
        this.#accumSamples++;
    }

    #getPentairData() {
        let pentairValues = {};
        if (this.#pentairClient) {
            const dutyCycles = this.#pentairClient.getDutyCycles();
            const currentTotal = this.#pentairClient.totalHeaterOnTime;
            const diff = currentTotal - (this.#lastPentairHeaterOnTime || 0);
            this.#lastPentairHeaterOnTime = currentTotal;
            pentairValues['HeaterOnSeconds'] = diff;
            pentairValues['setpoint'] = dutyCycles.setpoint;
            pentairValues['waterTemp'] = dutyCycles.waterTemp;
        }
        return pentairValues;
    }

    async updateLog(client) {
        await this.#getBSData(client);

        // If it's been log_entry_minutes since the last log entry, write a new one
       const now = this.#nowFn();
        if (now - this.#lastLogEntry >= this.#settings.log_entry_minutes * 60 * 1000) {
            if (this.#accumSamples === 0) {
                // All samples failed, so we can't write a log entry.
                this.#lastLogEntry = now;
                return;
            }
            // Compute a logfile name for the month and year
            const logFileName = `static/log-${now.getFullYear()}-${now.getMonth() + 1}.csv`;
            const pentairData = this.#getPentairData();

            // If the log file doesn't exist yet, create it with an appropriate header
            let out = '';
            if (!this.#fs.existsSync(logFileName)) {
                out = 'Time';
                for (let r of this.#registersToLog) {
                    out += ',' + r;
                }
                out += ',SuccessCount,TimeoutCount';
                for (let r of this.#pentairFieldsToLog) {
                    out += ',' + r;
                }
                out += '\n';
            }

            // Write the new mean data to the log file
            // Use a date format easily parsed by Google Sheets
            const zeroPad = (num) => String(num).padStart(2, '0')
            out += `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ` +
                `${now.getHours()}:${zeroPad(now.getMinutes())}:${zeroPad(now.getSeconds())}`;
            for (let r of this.#registersToLog) {
                out += ',' + (this.#regAccum[r] / this.#accumSamples).toFixed(Registers[r].round || 0);
            }
            out += `,${this.#accumSamples},${this.#timeoutCount}`;
            for (let r of this.#pentairFieldsToLog) {
                let val = pentairData[r] || 0;
                if (typeof val === 'string') {
                    val = parseFloat(val);
                }
                out += ',' + val.toFixed(0);
            }
            out += '\n';
            this.#fs.appendFileSync(logFileName, out);

            // Reset state for next log entry
            this.#lastLogEntry = now;
            this.#accumSamples = 0;
            this.#regAccum = {};
            this.#timeoutCount = 0;
        }
    }
}

const logger = new Logger();

let lastAlarmDate = null;

async function checkAlarms() {
    let dataAlarms = null;
    try {
        dataAlarms = await getAlarmData();
    } catch(err) {
        if (err.cause && err.cause.code === 'UND_ERR_CONNECT_TIMEOUT') {
            logger.incrementTimeoutCount();
            return;
        } else {
            console.log(`Unexpected error getting alarm data: ${err.message}`);
            console.log(err);
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
    const client = settings.use_fake_controller ? new FakeController() : new ModbusRTU();
    await connect(client);
    let writeSubs = false;
    try {
        const limitMap = {
            'clyout-max': { 'r': Registers.ClYout, 'max': true},
            'acidyout-max': { 'r': Registers.PhYout, 'max': true},
            'temp-min': { 'r': Registers.TempValue, 'max': false}
        }
        for (let limitSet in limitMap) {
            const notkey = 'notified-' + limitSet;
            let val = await readRegister(client, limitMap[limitSet].r);
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

        await logger.updateLog(client);
    } catch(err) {
        console.log(`Error polling registers: ${err}`);
        return;
    } finally {
        await close(client);
    }
}

function pollAlarms() {
    checkAlarms().catch(err => console.error("checkAlarms error:", err));
}

// If started directly, start the server and polling.
if (require.main === module) {
    startServer();
    setInterval(pollAlarms, settings.alarm_poll_seconds * 1000);

    if (settings.pentair_host) {
        const pentairClient = new PentairClient(settings.pentair_host);
        pentairClient.connect();
        logger.setPentairClient(pentairClient);
    }
}

if (process.env.NODE_ENV === 'test') {
    module.exports = { bitsVal, roundRegister, app, startServer, stopServer, Logger, Registers };
}
