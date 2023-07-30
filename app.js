const Buffer = require('node:buffer');
const http = require('http');

const HOSTNAME = '127.0.0.1';
const PORT = 8076;

const BSHOST = '192.168.86.5'
const BSPORT = 502

const RF = {
    Float: 'Float',
    ASCII: 'ASCII',
}

// From https://epipreprod.evoqua.com/siteassets/documents/extranet/a_temp_ext_dis/blu-sentinel-se_w3t387175_wt.050.511.000.de.im.pdf
// Weird that I have to subtract 1 from ascii register numbers
const Registers = {
    'System':   {reg: 1,  format: RF.ASCII, len: 20},
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
                        val = data.buffer.readFloatBE();
                        if ('round' in register)
                            val = val.toFixed(register.round);
                        resolve(val);
                        break;
                    case RF.ASCII:
                        // Null-terminated string in 16-bit registers, so swap bytes
                        buf = data.buffer.swap16();
                        i = buf.indexOf(0);
                        if (i == -1)
                            i = buf.length;
                        resolve(buf.toString('latin1', 0, i));
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
    } finally {       
        await close(client);
    }
    return out;
}

const server = http.createServer((req, res) => {
    if (req.url != '/') {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Not found');
        return;        
    }

    console.log('Request received');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    generateOutput().then((data) => {
        res.end(data);
    }).catch((err) => {
        res.end('Error: ' + err);
    });
});

server.listen(PORT, HOSTNAME, () => {
  console.log(`Server running at http://${HOSTNAME}:${PORT}/`);
});