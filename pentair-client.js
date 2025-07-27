const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class PentairClient {
    #ws = null;

    constructor(host, port = 6680, nowFn = () => new Date()) {
        this.host = host;
        this.port = port;
        this.nowFn = nowFn;
        this.pingTimeout = null;
        this.pingInterval = 60000;
        this.reconnectDelay = 1000; // 1 second
        this.reconnectTimeout = null; // Track reconnection timeout
        this.heaterLastOn = null;
        this.totalHeaterOnTime = 0; // in seconds
        this.connectionStartTime = null;
        this.totalConnectionTime = 0; // in seconds
        this.setpoint = null;
        this.waterTemp = null;
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.#ws = new WebSocket(`ws://${this.host}:${this.port}`);

            const onOpen = () => {
                this.#ws.removeListener('error', onError);
                this.reconnectDelay = 1000;
                this.#updateConnectionState(true);
                this.heartbeat();
                this.subscribeToStatus();
                this.startPingTimer();
                resolve();
            };

            const onError = (error) => {
                this.#ws.removeListener('open', onOpen);
                reject(error);
            };

            this.#ws.once('open', onOpen);
            this.#ws.once('error', onError);

            // Set up ongoing event handlers
            this.#ws.on('message', (data) => {
                this.heartbeat();
                const message = JSON.parse(data);
                this.handleMessage(message);
            });

            this.#ws.on('close', () => {
                this.#updateConnectionState(false);
                this.stopPingTimer();
                if (!this.#ws) {
                    // Disconnected intentionally
                    return;
                }
                this.reconnectTimeout = setTimeout(() => this.connect(), this.reconnectDelay);
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5 * 60 * 1000);
            });

            this.#ws.on('error', (error) => {
                if (this.#ws) {
                    console.error('Pentair client error:', error);                
                }
                if (this.#ws) {
                    this.#ws.close();
                }
            });
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
                this.#updateHeaterState(isHeating);
            }
            if (body.params.LOTMP) {
                this.setpoint = body.params.LOTMP;
            }
            if (body.params.TEMP) {
                this.waterTemp = body.params.TEMP;
            }
        }
    }

    #updateHeaterState(isHeating) {
        const now = this.nowFn();
        //console.log(`Heater state changed: ${isHeating ? 'ON' : 'OFF'} at ${now.toISOString()}`);
        if (this.heaterLastOn) {
            const diff = now - this.heaterLastOn;
            this.totalHeaterOnTime += diff;
        }

        this.heaterLastOn = isHeating ? now : null;
    }

    getCurrentTotalHeaterOnTime() {
        let total = this.totalHeaterOnTime;
        if (this.heaterLastOn) {
            total += this.nowFn() - this.heaterLastOn;
        }
        return total / 1000; // Convert to seconds
    }

    #updateConnectionState(isConnected) {
        const now = this.nowFn();
        if (this.connectionStartTime) {
            const diff = now - this.connectionStartTime;
            this.totalConnectionTime += diff;
        }

        this.connectionStartTime = isConnected ? now : null;
    }

    getCurrentTotalConnectionTime() {
        let total = this.totalConnectionTime;
        if (this.connectionStartTime) {
            total += this.nowFn() - this.connectionStartTime;
        }
        return total / 1000; // Convert to seconds
    }

    heartbeat() {
        clearTimeout(this.pingTimeout);
        this.pingTimeout = setTimeout(() => {
            if (this.#ws) {
                this.#ws.terminate();
            }
        }, this.pingInterval + 5000);
    }

    startPingTimer() {
        this.pingTimer = setInterval(() => {
            if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
                this.#ws.send(JSON.stringify({ command: "ping" }));
            }
        }, this.pingInterval);
    }

    stopPingTimer() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.pingTimeout) {
            clearTimeout(this.pingTimeout);
            this.pingTimeout = null;
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
        if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
            this.#ws.send(JSON.stringify(bodyMessage));
        }
    }

    disconnect() {
        clearTimeout(this.reconnectTimeout);
        this.stopPingTimer();
        const ws = this.#ws;
        this.#ws = null; // Signal that we are disconnecting.
        if (ws) {
            ws.close();
        }
    
        this.#updateHeaterState(false);
        this.#updateConnectionState(false);
    }

    isConnected() {
        return this.#ws && this.#ws.readyState === WebSocket.OPEN;
    }

}

module.exports = PentairClient;
