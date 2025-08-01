const ModbusRTU = require('modbus-serial');
const FakeController = require('./fake-controller');

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

class BSClient {
    #client;
    #settings;
    #reconnectTimer = null;
    #reconnectAttempts = 0;
    #baseReconnectDelay = 1000; // 1 second
    #connectionStartTime = null;
    #disconnectionStartTime = null;

    constructor(settings) {
        this.#settings = settings;
        this.#client = this.#settings.use_fake_controller ? new FakeController() : new ModbusRTU();
        this.#disconnectionStartTime = Date.now(); 
        this.setupConnectionHandlers();
    }

    setupConnectionHandlers() {
        if (this.#settings.use_fake_controller) {
            // FakeController doesn't emit events, skip setup
            return;
        }

        this.#client.on('close', () => {
            console.log('BluSentinel connection lost, attempting reconnect...');
            this.#disconnectionStartTime = Date.now();
            this.scheduleReconnect();
        });

        this.#client.on('error', (err) => {
            console.error('BluSentinel connection error:', err.message);
        });
    }

    scheduleReconnect() {
        if (this.#reconnectTimer) {
            return; // Already scheduled
        }

        // Start with no delay
        const delay = Math.min(this.#baseReconnectDelay * this.#reconnectAttempts, 60000);
        
        this.#reconnectTimer = setTimeout(async () => {
            this.#reconnectTimer = null;
            this.#reconnectAttempts++;
            
            try {
                await this.connect();
                console.log('BluSentinel connection successful');
                this.#reconnectAttempts = 0; // Reset on successful connection
            } catch (error) {
                console.error(`BluSentinel reconnect attempt ${this.#reconnectAttempts} failed:`, error.message);
                this.scheduleReconnect(); // Schedule next attempt
            }
        }, delay);
    }

    /**
     * Attempts to connect to the BluSentinel controller.
     * @throws {Error} Connection error if unable to connect
     */
    async connect() {
        if (this.#client.isOpen) {
            return; // Already connected
        }

        await this.#client.connectTCP(this.#settings.bshost, { port: 502 });
        this.#client.setID(1);
        this.#connectionStartTime = Date.now();
    }

    getConnected() {
        return this.#client.isOpen;
    }

    getConnectionStatus() {
        const now = Date.now();
        if (this.#client.isOpen) {
            return { bluUptimeSeconds: Math.floor((now - this.#connectionStartTime) / 1000) };
        } 
        return { bluDowntimeSeconds: Math.floor((now - this.#disconnectionStartTime) / 1000) };
    }

    async close() {
        if (this.#reconnectTimer) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = null;
        }
        this.#reconnectAttempts = 0;
        if (this.#client.isOpen) {
            await this.#client.close();
        }
    }

    async readRegister(register) {
        if (!this.#client.isOpen) {
            throw new Error("BSClient not connected");
        }
        let len = 2;
        let rn = register.reg;
        if (register.format == RF.ASCII) {
            len = register.len / 2;
            //  Strangely I have to subtract 1 from the register number for ASCII registers
            rn -= 1;
        }

        let data = await this.#client.readHoldingRegisters(rn, len);
        // Note: I have seen an issue where readHolderRegisters just never returns,
        // presumably because the device got into some bad state. Rebooting the device
        // addressed the issue. Perhaps we should have a timeout so we can identify this error
        // more clearly.
        switch(register.format) {
            case RF.Float:
                let floatVal = data.buffer.readFloatBE();
                return floatVal;
            case RF.ASCII:
                // Null-terminated string in 16-bit registers, so swap bytes
                let buf = data.buffer.swap16();
                let i = buf.indexOf(0);
                if (i == -1)
                    i = buf.length;
                return buf.toString('latin1', 0, i);
            case RF.UInt16:
                let u16val = data.buffer.readUInt16BE();
                return bitsVal(u16val, register.bits);
            case RF.UInt32:
                let u32val = data.buffer.readUInt32BE();
                return bitsVal(u32val, register.bits);
        }
        console.error("readRegister - unexpected holding register state");
    }

    async getAlarmData() {
        if (this.#settings.use_fake_controller) {
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
        
        let res = await fetch('http://' + this.#settings.bshost + '/ajax_dataAlarms.json')
        let dataAlarms = await res.json();
        return dataAlarms;
    }
}

module.exports = { BSClient, Registers, RF, bitsVal };
