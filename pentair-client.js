const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class PentairClient {
    constructor(host, port = 6680) {
        this.host = host;
        this.port = port;
        this.ws = null;
        this.pingTimeout = null;
        this.pingInterval = 60000;
        this.reconnectDelay = 1000; // 1 second
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
            this.reconnectDelay = 1000; // Reset reconnect delay on successful connection
            this.heartbeat();
            this.subscribeToStatus();
            this.startPingTimer();
        });

        this.ws.on('message', (data) => {
            this.heartbeat();
            const message = JSON.parse(data);
            this.handleMessage(message);
        });

        this.ws.on('close', () => {
            console.log('Disconnected from Pentair Intellicenter');
            this.stopPingTimer();
            clearTimeout(this.pingTimeout);
            setTimeout(() => this.connect(), this.reconnectDelay);
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5 * 60 * 1000); // Exponential backoff up to 5 minutes
        });

        this.ws.on('error', (error) => {
            console.error('Pentair client error:', error);
            this.ws.close();
        });
    }

    handleMessage(message) {
        //console.log('Received message:', JSON.stringify(message, null, 2));
        if (message.command === "NotifyList" && 
            message.objectList && 
            message.objectList.length > 0 &&
            message.objectList[0].objnam === 'B1101')
        {
            const body = message.objectList[0];
            if (body.params.HTMODE) {
                if (body.params.HTMODE !== '0' && body.params.HTMODE !== '1') {
                    console.error(`Unexpected HTMODE value: ${body.params.HTMODE}`);
                }
                const isHeating = body.params.HTMODE === '1';
                this.updateHeaterState(isHeating);
            }
            if (body.params.LOTMP) {
                this.setpoint = body.params.LOTMP;
            }
            if (body.params.TEMP) {
                this.waterTemp = body.params.TEMP;
            }
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

    heartbeat() {
        clearTimeout(this.pingTimeout);
        this.pingTimeout = setTimeout(() => {
            this.ws.terminate();
        }, this.pingInterval + 5000);
    }

    startPingTimer() {
        this.pingTimer = setInterval(() => {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ command: "ping" }));
            }
        }, this.pingInterval);
    }

    stopPingTimer() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    subscribeToStatus() {
        const bodyMessage = {
            command: 'RequestParamList',
            messageID: uuidv4(),
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
            if (appUptime < 120 * 60) {
                dutyCycleTimeframe = `last ${Math.round(appUptime / 60)} minutes`;
            } else {
                dutyCycleTimeframe = `last ${Math.round(appUptime / 3600)} hours`;
            }
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
