const Buffer = require('node:buffer');
const http = require('http');
const express = require('express')

const HOSTNAME = '127.0.0.1';
const PORT = 8076;

const BSHOST = '192.168.86.5'
const BSPORT = 502


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

        // TODO: Fetch ajax_dataAlarms.json for details of alarms.
        // Alarms like low chlorine may be here without any indication in the registers.
        let res = await fetch('http://' + BSHOST + '/ajax_dataAlarms.json')
        let dataAlarms = await res.json();
        out += `Alarm Messages: ${dataAlarms.alarms}\n`
        for (const am of dataAlarms.messages) {
            out += `  ${am.sourceTxt}: ${am.msgTxt} [${am.rdate}]\n`
        }
    } finally {       
        await close(client);
    }
    return out;
}

const app = express()
app.use(express.static('static'))

app.get('/status.txt', (req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    generateOutput().then((data) => {
        res.end(data);
    })/*.catch((err) => {
        res.end('Error: ' + err);
    })*/;
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});