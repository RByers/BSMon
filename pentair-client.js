const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class PentairClient {
    constructor(host, port = 6680) {
        this.host = host;
        this.port = port;
        this.ws = null;
        this.pingTimeout = null;
        this.pingInterval = 60000;
        this.heaterOn = false;
        this.heaterOnTime = null;
        this.totalHeaterOnTime = 0; // in seconds
        this.yesterdayHeaterOnTime = 0; // in seconds
        this.appStartTime = new Date();
        this.lastRollover = new Date();
        this.setpoint = null;
        this.waterTemp = null;
    }

    connect() {
        this.ws = new WebSocket(`ws://${this.host}:${this.port}`);

        this.ws.on('open', () => {
            console.log('Connected to Pentair Intellicenter');
            this.heartbeat();
            this.getInitialState();
        });

        this.ws.on('message', (data) => {
            this.heartbeat();
            const message = JSON.parse(data);
            this.handleMessage(message);
        });

        this.ws.on('close', () => {
            console.log('Disconnected from Pentair Intellicenter');
            clearTimeout(this.pingTimeout);
            // Optional: implement reconnection logic here
        });

        this.ws.on('error', (error) => {
            console.error('Pentair client error:', error);
        });
    }

    handleMessage(message) {
        if (message.messageID === 'initial-state-heater' || message.messageID === 'subscribe-heater') {
            this.heaterData = message.objectList;
        } else if (message.messageID === 'initial-state-body' || message.messageID === 'subscribe-body') {
            this.bodyData = message.objectList;
        }

        if (this.heaterData && this.bodyData) {
            const heater = this.heaterData[0];
            const body = this.bodyData[0];
            const isHeating = heater.params.STATUS === 'ON' && body.params.HTMODE !== '0';
            this.updateHeaterState(isHeating);
            this.setpoint = body.params.LOTMP;
            this.waterTemp = body.params.TEMP;
        }
    }

    updateHeaterState(isHeating) {
        this.checkForRollover();
        if (isHeating && !this.heaterOn) {
            this.heaterOn = true;
            this.heaterOnTime = new Date();
        } else if (!isHeating && this.heaterOn) {
            this.heaterOn = false;
            if (this.heaterOnTime) {
                const diff = (new Date() - this.heaterOnTime) / 1000;
                this.totalHeaterOnTime += diff;
                this.heaterOnTime = null;
            }
        }
    }

    getInitialState() {
        const heaterMessage = {
            command: 'GetParamList',
            condition: 'OBJTYP = HEATER',
            objectList: [{
                objnam: 'ALL',
                keys: ["OBJTYP: SUBTYP: SNAME: LISTORD: STATUS: PERMIT: TIMOUT: READY: HTMODE : SHOMNU : COOL : COMUART : BODY : HNAME : START : STOP : HEATING : BOOST : TIME : DLY : MODE"]
            }],
            messageID: 'initial-state-heater'
        };
        this.ws.send(JSON.stringify(heaterMessage));

        const bodyMessage = {
            command: 'GetParamList',
            condition: 'OBJTYP = BODY',
            objectList: [{
                objnam: 'ALL',
                keys: ["OBJTYP: SUBTYP: SNAME: LISTORD: FILTER: LOTMP: TEMP: HITMP: HTSRC: PRIM: SEC: ACT1: ACT2: ACT3: ACT4: CIRCUIT: SPEED: BOOST: SELECT: STATUS: HTMODE : LSTTMP : HEATER : VOL : MANUAL : HNAME : MODE"]
            }],
            messageID: 'initial-state-body'
        };
        this.ws.send(JSON.stringify(bodyMessage));

        // After getting the initial state, subscribe to future updates.
        this.subscribeToStatus();
    }

    heartbeat() {
        clearTimeout(this.pingTimeout);
        this.pingTimeout = setTimeout(() => {
            this.ws.terminate();
        }, this.pingInterval + 5000);
    }

    subscribeToStatus() {
        const heaterMessage = {
            command: 'RequestParamList',
            messageID: 'subscribe-heater',
            objectList: [
                {
                    objnam: 'H0001',
                    keys: ['STATUS']
                }
            ]
        };
        this.ws.send(JSON.stringify(heaterMessage));

        const bodyMessage = {
            command: 'RequestParamList',
            messageID: 'subscribe-body',
            objectList: [
                {
                    objnam: 'B1101',
                    keys: ['HTMODE', 'TEMP', 'LOTMP']
                }
            ]
        };
        this.ws.send(JSON.stringify(bodyMessage));
    }

    checkForRollover() {
        const now = new Date();
        if (now.getDate() !== this.lastRollover.getDate()) {
            if (this.heaterOn && this.heaterOnTime) {
                const diff = (new Date(now).setHours(0,0,0,0) - this.heaterOnTime) / 1000;
                this.totalHeaterOnTime += diff;
                this.heaterOnTime = new Date(new Date(now).setHours(0,0,0,0));
            }
            this.yesterdayHeaterOnTime = this.totalHeaterOnTime;
            this.lastRollover = now;
        }
    }

    getDutyCycles() {
        this.checkForRollover();
        let currentOnTime = 0;
        if (this.heaterOn && this.heaterOnTime) {
            currentOnTime = (new Date() - this.heaterOnTime) / 1000;
        }

        const now = new Date();
        const appUptime = (now - this.appStartTime) / 1000;

        let dutyCycle;
        let dutyCycleTimeframe;

        if (appUptime >= 24 * 60 * 60) {
            dutyCycle = this.yesterdayHeaterOnTime / (24 * 60 * 60);
            dutyCycleTimeframe = 'yesterday';
        } else {
            dutyCycle = (this.totalHeaterOnTime + currentOnTime) / appUptime;
            dutyCycleTimeframe = `last ${Math.round(appUptime / 3600)} hours`;
        }

        return {
            heaterOn: this.heaterOn,
            dutyCycle,
            dutyCycleTimeframe,
            setpoint: this.setpoint,
            waterTemp: this.waterTemp
        };
    }
}

module.exports = PentairClient;
