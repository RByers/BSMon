const WebSocket = require('ws');

// Helper function to drain the event loop for reliable test timing
function drainEventLoop() {
  const EVENT_LOOP_TICKS = 5;
  return new Promise(resolve => {
    let ticks = 0;
    
    function tick() {
      if (++ticks >= EVENT_LOOP_TICKS) {
        resolve();
      } else {
        setImmediate(tick);
      }
    }
    
    setImmediate(tick);
  });
}

// Mock Pentair server that implements the WebSocket protocol
class MockPentairServer {
  constructor(port) {
    this.server = new WebSocket.Server({ port });
    this.connections = new Set();
    this.heaterState = '0';
    this.setpoint = '80';
    this.waterTemp = '75';
    
    this.server.on('connection', (ws) => {
      this.connections.add(ws);
      ws.on('close', () => this.connections.delete(ws));
      ws.on('message', (data) => this.handleMessage(ws, JSON.parse(data)));
    });
  }

  makeStatusMessage() {
    const message = {
      command: "NotifyList",
      objectList: [{
        objnam: 'B1101',
        params: {
          HTMODE: this.heaterState,
          LOTMP: this.setpoint,
          TEMP: this.waterTemp
        }
      }]
    };
    return JSON.stringify(message);
  }

  handleMessage(ws, message) {
    if (message.command === 'RequestParamList') {
      ws.send(this.makeStatusMessage());
    }
  }

  sendStatus(ws) {
    return new Promise(async (resolve, reject) => {
      ws.send(this.makeStatusMessage(), async (error) => {
        if (error) {
          reject(error);
        } else {
          // Wait for WebSocket message to be fully processed by the PentairClient.
          // Multiple event loop ticks ensure message reception, JSON parsing,
          // and state updates complete before test assertions run.
          await drainEventLoop();
          resolve();
        }
      });
    });
  }

  async turnHeaterOn() {
    this.heaterState = '1';
    await this.broadcastStatus();
  }

  async turnHeaterOff() {
    this.heaterState = '0';
    await this.broadcastStatus();
  }

  async setInvalidHeaterMode(mode) {
    this.heaterState = mode;
    await this.broadcastStatus();
  }

  async setHeaterSetpoint(temp) {
    this.setpoint = temp;
    await this.broadcastStatus();
  }

  async broadcastStatus() {
    const sendPromises = [];
    
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        sendPromises.push(this.sendStatus(ws));
      }
    }
    
    await Promise.all(sendPromises);
  }

  async close() {
    for (const ws of this.connections) {
      if (ws.readyState === 1) { // OPEN
        ws.close();
      }
    }
    this.connections.clear();
    return new Promise((resolve) => {
      this.server.close(resolve);
    });
  }
}

module.exports = {
  drainEventLoop,
  MockPentairServer
};
