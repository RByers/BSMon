const Logger = require('../logger');
const { BSClient, Registers } = require('../bs-client');
const WebSocket = require('ws');
const PentairClient = require('../pentair-client');

const mockFs = {
  existsSync: jest.fn(() => false),
  appendFileSync: jest.fn()
};

const mockSettings = {
  log_entry_minutes: 10
};

// Constants and helpers for register value creation
const CSV_HEADERS = ['Time', 'ClValue', 'PhValue', 'ORPValue', 'TempValue', 'ClSet', 'PhSet', 'ClYout', 'PhYout', 'SuccessCount', 'TimeoutCount', 'HeaterOnSeconds', 'setpoint', 'waterTemp'];
const LOGGER_REGISTERS = ['ClValue', 'PhValue', 'ORPValue', 'TempValue', 'ClSet', 'PhSet', 'ClYout', 'PhYout'];

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

function createRegisterValues(value) {
  return LOGGER_REGISTERS.reduce((obj, reg) => {
    obj[reg] = value;
    return obj;
  }, {});
}

function setupLogFile() {
  mockFs.existsSync.mockReturnValueOnce(false).mockReturnValue(true);
  const writtenLines = [];
  let writtenFilename = null;
  mockFs.appendFileSync.mockImplementation((filename, content) => {
    writtenFilename = filename;
    expect(content.endsWith('\n')).toBe(true);
    const lines = content.split('\n').filter(line => line.trim() !== '');
    writtenLines.push(...lines);
  });
  
  return { 
    content: writtenLines, 
    filename: () => writtenFilename,
    getColumnValue: (rowIndex, columnName) => {
      const parts = writtenLines[rowIndex].split(',');
      return parseFloat(parts[CSV_HEADERS.indexOf(columnName)]);
    },
    getLastDataRow: () => {
      const dataRowIndex = writtenLines.length - 1; // Last row
      const parts = writtenLines[dataRowIndex].split(',');
      const result = {};
      CSV_HEADERS.forEach((header, index) => {
        result[header] = parseFloat(parts[index]);
      });
      return result;
    }
  };
}

// Mock client with readHoldingRegisters method, using symbolic register names
function makeMockBSClient(registerValueMap) {
  const mockClient = {
    _registerValues: { ...registerValueMap },
    
    readRegister: (register) => {
      const regName = Object.keys(Registers).find(key => Registers[key] === register);
      const value = mockClient._registerValues[regName];
      if (value === 'FAIL') {
        return Promise.reject(new Error('Read failed'));
      }
      return Promise.resolve(value !== undefined ? value : 0);
    },
    
    updateValues: (newValues) => {
      Object.assign(mockClient._registerValues, newValues);
    }
  };
  
  return mockClient;
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

  async broadcastStatus() {
    const sendPromises = [];
    
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        sendPromises.push(this.sendStatus(ws));
      }
    }
    
    await Promise.all(sendPromises);
  }

  close() {
    this.server.close();
  }
}

describe('Logger', () => {
  let fakeNow;
  let logFile;
  const nowFn = () => fakeNow;
  const advanceTime = async (seconds, logger) => {
    fakeNow = new Date(fakeNow.getTime() + seconds * 1000);
    if (logger) {
      await logger.updateLog();
    }
  };

  beforeEach(() => {
    mockFs.existsSync.mockReset();
    mockFs.appendFileSync.mockReset();
    fakeNow = new Date(2024, 0, 1, 12, 0, 0);
    logFile = setupLogFile();
  });

  it('mock client returns correct values for logger registers', async () => {
    const client = makeMockBSClient(createRegisterValues(2));
    // Only check registers used by the logger
    for (const regName of LOGGER_REGISTERS) {
      const val = await client.readRegister(Registers[regName]);
      expect(val).toBe(2);
    }
  });

  it('writes a log row with correct average and filename for two good samples', async () => {
    const mockClient = makeMockBSClient(createRegisterValues(2));
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await advanceTime(mockSettings.log_entry_minutes * 60 / 2, logger);
    mockClient.updateValues(createRegisterValues(4));
    await advanceTime(11 * 60, logger);
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    expect(logFile.filename()).toBe('static/log-2024-1.csv');
    expect(logFile.content.length).toBe(2); // Header + data row
    const result = logFile.getLastDataRow();
    for (const registerName of LOGGER_REGISTERS) {
      expect(result[registerName]).toBeCloseTo((2 + 4) / 2, 2);
    }
    expect(result.SuccessCount).toBe(2);
    expect(result.TimeoutCount).toBe(0);
  });

  it('creates multiple log entries with a long sample and two normal samples', async () => {
    // First sample: all 10s
    const mockClient = makeMockBSClient(createRegisterValues(10));
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await advanceTime(mockSettings.log_entry_minutes * 60 / 2, logger);
    // Second sample: all 2s
    mockClient.updateValues(createRegisterValues(2));
    await advanceTime(mockSettings.log_entry_minutes * 60 / 2, logger);
    
    // Check first log entry: average of 10 and 2
    expect(logFile.content.length).toBe(2); // Header + 1 data row
    let result = logFile.getLastDataRow();
    for (const registerName of LOGGER_REGISTERS) {
      expect(result[registerName]).toBeCloseTo((10 + 2) / 2, 2);
    }
    expect(result.SuccessCount).toBe(2);
    expect(result.TimeoutCount).toBe(0);
    
    // Third sample: all 4s
    mockClient.updateValues(createRegisterValues(4));
    await advanceTime(mockSettings.log_entry_minutes * 60, logger);
    
    // Check second log entry: just 4
    expect(logFile.content.length).toBe(3); // Header + 2 data rows
    result = logFile.getLastDataRow();
    for (const registerName of LOGGER_REGISTERS) {
      expect(result[registerName]).toBeCloseTo(4, 2);
    }
    expect(result.SuccessCount).toBe(1);
    expect(result.TimeoutCount).toBe(0);
  });

  it('throws if a single register read fails', async () => {
    const mockClient = makeMockBSClient({ ...createRegisterValues(2), PhValue: 'FAIL' });
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await expect(logger.updateLog()).rejects.toThrow();
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });

  it('handles interleaving errors and success', async () => {
    // Good sample
    const mockClient = makeMockBSClient(createRegisterValues(2));
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await advanceTime(2 * 60, logger);
    // Error sample
    mockClient.updateValues({ ...createRegisterValues(4), PhValue: 'FAIL' });
    await advanceTime(2 * 60, logger).catch(() => {});
    // Good sample
    mockClient.updateValues(createRegisterValues(4));
    await advanceTime(10 * 60, logger);
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    expect(logFile.content.length).toBe(2); // Header + data row
    const result = logFile.getLastDataRow();
    for (const registerName of LOGGER_REGISTERS) {
      expect(result[registerName]).toBeCloseTo(3, 2);
    }
    expect(result.SuccessCount).toBe(2);
    expect(result.TimeoutCount).toBe(0);
  });

  it('should not write a log row if all register reads fail (NaN bug test)', async () => {
    // All reads fail for both samples
    const mockClient = makeMockBSClient(createRegisterValues('FAIL'));
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    try {
      await logger.updateLog();
    } catch (e) {}
    try {
      await logger.updateLog();
    } catch (e) {}
    await advanceTime(11 * 60, logger).catch(() => {});
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });

  describe('Heater On Seconds Tests', () => {
    const MOCK_SERVER_PORT = 6681;
    
    let mockServer;
    let testClient;
    let pentairClient;
    let logger;

    beforeEach(async () => {
      mockServer = new MockPentairServer(MOCK_SERVER_PORT);
      testClient = makeMockBSClient(createRegisterValues(2));
      // Note: the global beforeEach is what resets mockFs and fakeNow
      pentairClient = new PentairClient('localhost', MOCK_SERVER_PORT, nowFn);
      await pentairClient.connect();
      logger = new Logger({ bsClient: testClient, pentairClient, fs: mockFs, settings: mockSettings, nowFn });
    });

    afterEach(async () => {
      if (pentairClient) {
        pentairClient.disconnect();
      }
      if (mockServer) {
        for (const ws of mockServer.connections) {
          if (ws.readyState === 1) { // OPEN
            ws.close();
          }
        }
        mockServer.connections.clear();
        await mockServer.server.close();
        mockServer = null;
      }

    });

    it('records heater on seconds when heater cycles on and off within logging period', async () => {
      await advanceTime(1 * 60, logger);
      await mockServer.turnHeaterOn();
      
      await advanceTime(1 * 60, logger);
      await mockServer.turnHeaterOff();

      // Trigger log write
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(60);
    });

    it('records zero heater on seconds when heater never turns on', async () => {
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(0);
    });

    it('handles multiple on/off cycles within single logging period', async () => {
      // First cycle: on for 2 minutes
      await mockServer.turnHeaterOn();
      
      await advanceTime(2 * 60, logger);
      await mockServer.turnHeaterOff();

      // Second cycle: on for 3 minutes
      await advanceTime(3 * 60, logger);
      await mockServer.turnHeaterOn();
      
      await advanceTime(3 * 60, logger);
      await mockServer.turnHeaterOff();

      // Trigger log write
      await advanceTime(2 * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(5 * 60); // 2 + 3 minutes = 5 minutes
    });

    it('handles heater remaining on across log period boundary', async () => {
      mockFs.existsSync.mockReturnValue(true);

      // Heater turns on at start
      await mockServer.turnHeaterOn();

      // First log period ends - heater still on
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      // Check first period: heater was on for full log period
      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1);
      let result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(mockSettings.log_entry_minutes * 60);

      // Second log period - heater turns off after 5 more minutes
      await advanceTime(5 * 60, logger);
      await mockServer.turnHeaterOff();

      // Trigger second log write
      await advanceTime(5 * 60, logger);

      // Check second period: heater was on for 5 minutes
      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(2);
      result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(300);
    });

    it('defaults to zero when no PentairClient is set', async () => {
      logger = new Logger({ bsClient: testClient, fs: mockFs, settings: mockSettings, nowFn });
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(0);
      expect(result.setpoint).toBe(0);
      expect(result.waterTemp).toBe(0);
    });

    it('handles invalid HTMODE values gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await mockServer.setInvalidHeaterMode('2'); // Invalid value

      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Unexpected HTMODE value: 2');
      
      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(0); // Invalid state ignored

      consoleErrorSpy.mockRestore();
    });

    it('includes correct CSV header with Pentair fields', async () => {
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      expect(logFile.content[0]).toBe(CSV_HEADERS.join(','));
    });

    it('handles WebSocket disconnection during heating', async () => {
      // Start heating
      await mockServer.turnHeaterOn();

      await advanceTime(5 * 60, logger);
      pentairClient.disconnect();

      // Trigger log write
      await advanceTime(5 * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(5 * 60); // Should record time before disconnection
    });

    it('handles heater state reset between log periods', async () => {
      mockFs.existsSync.mockReturnValue(true);

      // First log period: heater on for 5 minutes
      await mockServer.turnHeaterOn();
      await advanceTime(5 * 60, logger);
      await mockServer.turnHeaterOff();
      await advanceTime(5 * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1);
      let result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(5 * 60);

      // Second log period: simulate system restart (client disconnects and reconnects)
      pentairClient.disconnect();
      
      await pentairClient.connect();

      await advanceTime(2 * 60, logger);
      await mockServer.turnHeaterOn();
      await advanceTime(3 * 60, logger);
      await mockServer.turnHeaterOff();
      await advanceTime(5 * 60, logger);

      // Check second period
      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(2);
      result = logFile.getLastDataRow();
      expect(result.HeaterOnSeconds).toBe(3 * 60);
    });
  });
});
