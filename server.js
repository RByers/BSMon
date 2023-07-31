const Buffer = require('node:buffer');
const express = require('express')
const webpush = require('web-push');
const https = require('node:https');
const fs = require('node:fs');

const PORT = 8076;

const BSHOST = '192.168.86.5';
const BSPORT = 502;

// DOS mitigation
// Could add a key to prevent abuse
const MAX_SUBSCRIPTIONS = 20;

// Generated with https://web-push-codelab.glitch.me/
const VAPID_PUBLIC_KEY = 'BNj1KsjxRwwFfYOnoOtvgy_T7DxCgfamSwblOsu1rlruiK23Qouk28PrDdcY-2HJaSnTvMZpNG-hYLTqhzF_Sqg';
const VAPID_PRIVATE_KEY = 'tD8J_t4kj2-aiE2BMT94kDTh7fyekg3QElFwcvgguJ4';

const ALARM_POLL_SECONDS = 60;

const CERT_DIR = '/etc/letsencrypt/live/home.rbyers.ca/';

// Map of endpoint strings to subscription objects.
// TODO: Persist this to disk
const subscriptionMap = new Map();

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
    'ClYout':   {reg: 113, format: RF.Float, round: 1},
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
                        if ('round' in register)
                            floatVal = floatVal.toFixed(register.round);
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

async function getRegisterSet(client, rs) {
    let value = await readRegister(client, rs.value);
    let unit = await readRegister(client, rs.unit);

    let out = `${value} ${unit}`;
    if (rs.setpoint) {
        let setpoint = await readRegister(client, rs.setpoint);
        out += `, setpoint: ${setpoint}`;
    }
    if (rs.yout) {
        let yout = await readRegister(client, rs.yout);
        out += `, yout: ${yout}%`;
    }
    return out;
}

function connect(client) {
    return new Promise((resolve, reject) => {
        client.connectTCP(BSHOST, { port: BSPORT }, () => {
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
    let res = await fetch('http://' + BSHOST + '/ajax_dataAlarms.json')
    let dataAlarms = await res.json();
    return dataAlarms;
}   

async function generateOutput() {
    // create an empty modbus client
    const ModbusRTU = require("modbus-serial");
    const client = new ModbusRTU();

    // open connection to a tcp line
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
    'mailto:rick@rbyers.net',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

app.get('/status.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    generateOutput().then((data) => {
        res.end(data);
    })/*.catch((err) => {
        res.end('Error: ' + err);
    })*/;
});

app.post('/subscribe', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const subscription = req.body;

    if (subscriptionMap.size > MAX_SUBSCRIPTIONS) {
        console.log("Too many subscriptions");
        res.status(500).send('Too many subscriptions');
        return;
    }

    const had = subscriptionMap.has(subscription.endpoint);
    subscriptionMap.set(subscription.endpoint, subscription);
    if (had) {
        res.send(`Subscription Updated (${subscriptionMap.size} subscriptions)`);
    } else {
        console.log('Subscribe: ' + subscription.endpoint);
        console.log('Total subscriptions: ' + subscriptionMap.size);    
        res.send(`Subscribed (${subscriptionMap.size} subscriptions)`);
    }
});

app.post('/unsubscribe', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const subscription = req.body;

    if(subscriptionMap.has(subscription.endpoint)) {
        subscriptionMap.delete(subscription.endpoint);
        console.log('Unsubscribe: ' + subscription.endpoint);
        console.log('Total subscriptions: ' + subscriptionMap.size);    
        res.send("Unsubscribed");
    } else {
        res.send("Not subscribed");
    }
});

app.get('/testNotify', (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    for(const subscription of subscriptionMap.values()) {
        webpush.sendNotification(subscription, 'Test');
    }
    console.log(`Sent ${subscriptionMap.size} test notifications`);
    res.send("Sent");
});

https.createServer({
        key: fs.readFileSync(CERT_DIR + 'privkey.pem'),
        cert: fs.readFileSync(CERT_DIR + 'cert.pem'),
    },
    app
  ).listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

let lastAlarmDate = null;
async function checkAlarms() {
    const dataAlarms = await getAlarmData();
    for (const am of dataAlarms.messages) {
        const rdate = new Date(am.rdate);
        if (!lastAlarmDate || rdate > lastAlarmDate) {
            lastAlarmDate = rdate;
            const msg = `${am.sourceTxt}: ${am.msgTxt}`;
            console.log(`Sending alarm notification: ${msg} [${am.rdate}]`);
            for(const subscription of subscriptionMap.values()) {
                webpush.sendNotification(subscription, msg);
            }
        }
    }
}

function pollAlarms() {
    checkAlarms().then(() => {
        setTimeout(pollAlarms, ALARM_POLL_SECONDS * 1000);
    });
}
pollAlarms();