const Logger = require('../logger');
const { BSClient, Registers } = require('../bs-client');

const mockFs = {
  existsSync: jest.fn(() => false),
  appendFileSync: jest.fn()
};

const mockSettings = {
  log_entry_minutes: 10
};

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

describe('Logger', () => {
  let fakeNow;
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
  });

  it('mock client returns correct values for logger registers', async () => {
    const all2 = { ClValue: 2, PhValue: 2, ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    const client = makeMockBSClient(all2);
    // Only check registers used by the logger
    const registersToLog = ['ClValue', 'PhValue', 'ORPValue', 'TempValue', 'ClSet', 'PhSet', 'ClYout', 'PhYout'];
    for (const regName of registersToLog) {
      const val = await client.readRegister(Registers[regName]);
      expect(val).toBe(2);
    }
  });

  it('writes a log row with correct average and filename for two good samples', async () => {
    mockFs.existsSync.mockReturnValueOnce(false); // File does not exist
    let writtenFilename = null;
    mockFs.appendFileSync.mockImplementation((filename, content) => {
      writtenFilename = filename;
    });
    const all2 = { ClValue: 2, PhValue: 2, ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    const mockClient = makeMockBSClient(all2);
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await advanceTime(mockSettings.log_entry_minutes * 60 / 2, logger);
    const all4 = { ClValue: 4, PhValue: 4, ORPValue: 4, TempValue: 4, ClSet: 4, PhSet: 4, ClYout: 4, PhYout: 4 };
    mockClient.updateValues(all4);
    await advanceTime(11 * 60, logger);
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    expect(writtenFilename).toBe('static/log-2024-1.csv');
    const logCall = mockFs.appendFileSync.mock.calls[0][1];
    const lines = logCall.split('\n');
    const dataRow = lines[1];
    const parts = dataRow.split(',');
    expect(parts.length).toBe(14); // Time + 8 values + SuccessCount + TimeoutCount + 3 Pentair fields
    for (let i = 1; i <= 8; ++i) {
      expect(parseFloat(parts[i])).toBeCloseTo(3, 2);
    }
    expect(parseFloat(parts[9])).toBe(2); // SuccessCount
    expect(parseFloat(parts[10])).toBe(0); // TimeoutCount
  });

  it('appends a second line to an existing log file with a long sample and two normal samples', async () => {
    // Simulate file exists for the second call
    mockFs.existsSync.mockReturnValue(true);
    let writtenContent = [];
    mockFs.appendFileSync.mockImplementation((filename, content) => {
      writtenContent.push(content);
    });
    // First sample: all 10s
    const all10 = { ClValue: 10, PhValue: 10, ORPValue: 10, TempValue: 10, ClSet: 10, PhSet: 10, ClYout: 10, PhYout: 10 };
    const mockClient = makeMockBSClient(all10);
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await advanceTime(mockSettings.log_entry_minutes * 60 / 2, logger);
    // Second sample: all 2s
    const all2 = { ClValue: 2, PhValue: 2, ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    mockClient.updateValues(all2);
    await advanceTime(mockSettings.log_entry_minutes * 60 / 2, logger);
    // Third sample: all 4s
    const all4 = { ClValue: 4, PhValue: 4, ORPValue: 4, TempValue: 4, ClSet: 4, PhSet: 4, ClYout: 4, PhYout: 4 };
    mockClient.updateValues(all4);
    await advanceTime(mockSettings.log_entry_minutes * 60, logger);
    // Should have written two log entries (one for each time window)
    expect(writtenContent.length).toBe(2);
    // First line: average of 10 and 2 = 6
    const row1 = writtenContent[0];
    const parts1 = row1.split(',');
    for (let i = 1; i <= 8; ++i) {
      expect(parseFloat(parts1[i])).toBeCloseTo(6, 2);
    }
    expect(parseFloat(parts1[9])).toBe(2); // SuccessCount
    expect(parseFloat(parts1[10])).toBe(0); // TimeoutCount
    // Second line: just 4
    const row2 = writtenContent[1];
    const parts2 = row2.split(',');
    for (let i = 1; i <= 8; ++i) {
      expect(parseFloat(parts2[i])).toBeCloseTo(4, 2);
    }
    expect(parseFloat(parts2[9])).toBe(1); // SuccessCount
    expect(parseFloat(parts2[10])).toBe(0); // TimeoutCount
  });

  it('throws if a single register read fails', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.appendFileSync.mockClear();
    const errorSample = { ClValue: 2, PhValue: 'FAIL', ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    const mockClient = makeMockBSClient(errorSample);
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await expect(logger.updateLog()).rejects.toThrow();
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });

  it('handles interleaving errors and success', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.appendFileSync.mockClear();
    // Good sample
    const all2 = { ClValue: 2, PhValue: 2, ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    const mockClient = makeMockBSClient(all2);
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await advanceTime(2 * 60, logger);
    // Error sample
    const errorSample = { ClValue: 4, PhValue: 'FAIL', ORPValue: 4, TempValue: 4, ClSet: 4, PhSet: 4, ClYout: 4, PhYout: 4 };
    mockClient.updateValues(errorSample);
    await advanceTime(2 * 60, logger).catch(() => {});
    // Good sample
    const all4 = { ClValue: 4, PhValue: 4, ORPValue: 4, TempValue: 4, ClSet: 4, PhSet: 4, ClYout: 4, PhYout: 4 };
    mockClient.updateValues(all4);
    await advanceTime(10 * 60, logger);
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    const logCall = mockFs.appendFileSync.mock.calls[0][1];
    const lines = logCall.split('\n');
    const dataRow = lines[1];
    const parts = dataRow.split(',');
    expect(parts.length).toBe(14); // Time + 8 values + SuccessCount + TimeoutCount + 3 Pentair fields
    for (let i = 1; i <= 8; ++i) {
      expect(parseFloat(parts[i])).toBeCloseTo(3, 2);
    }
    expect(parseFloat(parts[9])).toBe(2); // SuccessCount
    expect(parseFloat(parts[10])).toBe(0); // TimeoutCount
  });

  it('should not write a log row if all register reads fail (NaN bug test)', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.appendFileSync.mockClear();
    // All reads fail for both samples
    const failAll = { ClValue: 'FAIL', PhValue: 'FAIL', ORPValue: 'FAIL', TempValue: 'FAIL', ClSet: 'FAIL', PhSet: 'FAIL', ClYout: 'FAIL', PhYout: 'FAIL' };
    const mockClient = makeMockBSClient(failAll);
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
    const WebSocket = require('ws');
    const PentairClient = require('../pentair-client');
    
    const MOCK_SERVER_PORT = 6681;
    
    let mockServer;
    let testClient;
    let pentairClient;
    let logger;

    // Mock Pentair server that implements the protocol
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

      handleMessage(ws, message) {
        if (message.command === 'RequestParamList') {
          this.sendStatus(ws);
        }
      }

      sendStatus(ws) {
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
        ws.send(JSON.stringify(message));
      }

      sendStatusToClient(ws) {
        return new Promise((resolve, reject) => {
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
          
          ws.send(JSON.stringify(message), (error) => {
            if (error) {
              reject(error);
            } else {
              // Wait multiple event loop ticks for client-side processing
              setImmediate(() => {
                setImmediate(() => {
                  setImmediate(resolve);
                });
              });
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
            sendPromises.push(this.sendStatusToClient(ws));
          }
        }
        
        await Promise.all(sendPromises);
      }

      close() {
        this.server.close();
      }
    }

    // Test utilities
    function parseLogOutput(content) {
      const lines = content.split('\n').filter(line => line.trim() !== '');
      const dataRow = lines[lines.length - 1]; // Get the last non-empty line (most recent data)
      const parts = dataRow.split(',');
      return {
        heaterOnSeconds: parseFloat(parts[11]),
        setpoint: parseFloat(parts[12]),
        waterTemp: parseFloat(parts[13]),
        header: lines[0]
      };
    }


    beforeEach(async () => {
      mockServer = new MockPentairServer(MOCK_SERVER_PORT);
      testClient = makeMockBSClient({ ClValue: 2, PhValue: 2, ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 });
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
      mockFs.existsSync.mockReturnValueOnce(false);
      let writtenContent = '';
      mockFs.appendFileSync.mockImplementation((filename, content) => {
        writtenContent = content;
      });

      await advanceTime(1 * 60, logger);
      await mockServer.turnHeaterOn();
      
      await advanceTime(1 * 60, logger);
      await mockServer.turnHeaterOff();

      // Trigger log write
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = parseLogOutput(writtenContent);
      expect(result.heaterOnSeconds).toBe(60);
    });

    it('records zero heater on seconds when heater never turns on', async () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      let writtenContent = '';
      mockFs.appendFileSync.mockImplementation((filename, content) => {
        writtenContent = content;
      });

      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = parseLogOutput(writtenContent);
      expect(result.heaterOnSeconds).toBe(0);
    });

    it('handles multiple on/off cycles within single logging period', async () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      let writtenContent = '';
      mockFs.appendFileSync.mockImplementation((filename, content) => {
        writtenContent = content;
      });


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
      const result = parseLogOutput(writtenContent);
      expect(result.heaterOnSeconds).toBe(300); // 2 + 3 minutes = 5 minutes
    });

    it('handles heater remaining on across log period boundary', async () => {
      mockFs.existsSync.mockReturnValue(true);
      let writtenContent = [];
      mockFs.appendFileSync.mockImplementation((filename, content) => {
        writtenContent.push(content);
      });


      // Heater turns on at start
      await mockServer.turnHeaterOn();

      // First log period ends - heater still on
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      // Second log period - heater turns off after 5 more minutes
      await advanceTime(5 * 60, logger);
      await mockServer.turnHeaterOff();

      // Trigger second log write
      await advanceTime(5 * 60, logger);

      expect(writtenContent.length).toBe(2);
      
      // First period: heater was on for full log period
      const result1 = parseLogOutput(writtenContent[0]);
      expect(result1.heaterOnSeconds).toBe(mockSettings.log_entry_minutes * 60);
      
      // Second period: heater was on for 5 minutes
      const result2 = parseLogOutput(writtenContent[1]);
      expect(result2.heaterOnSeconds).toBe(300);
    });

    it('defaults to zero when no PentairClient is set', async () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      let writtenContent = '';
      mockFs.appendFileSync.mockImplementation((filename, content) => {
        writtenContent = content;
      });

      logger = new Logger({ bsClient: testClient, fs: mockFs, settings: mockSettings, nowFn });
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = parseLogOutput(writtenContent);
      expect(result.heaterOnSeconds).toBe(0);
      expect(result.setpoint).toBe(0);
      expect(result.waterTemp).toBe(0);
    });

    it('handles invalid HTMODE values gracefully', async () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      let writtenContent = '';
      mockFs.appendFileSync.mockImplementation((filename, content) => {
        writtenContent = content;
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await mockServer.setInvalidHeaterMode('2'); // Invalid value

      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Unexpected HTMODE value: 2');
      
      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = parseLogOutput(writtenContent);
      expect(result.heaterOnSeconds).toBe(0); // Invalid state ignored

      consoleErrorSpy.mockRestore();
    });

    it('includes correct CSV header with Pentair fields', async () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      let writtenContent = '';
      mockFs.appendFileSync.mockImplementation((filename, content) => {
        writtenContent = content;
      });

      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = parseLogOutput(writtenContent);
      expect(result.header).toBe('Time,ClValue,PhValue,ORPValue,TempValue,ClSet,PhSet,ClYout,PhYout,SuccessCount,TimeoutCount,HeaterOnSeconds,setpoint,waterTemp');
    });

    it('handles WebSocket disconnection during heating', async () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      let writtenContent = '';
      mockFs.appendFileSync.mockImplementation((filename, content) => {
        writtenContent = content;
      });


      // Start heating
      await mockServer.turnHeaterOn();

      await advanceTime(5 * 60, logger);
      pentairClient.disconnect();

      // Trigger log write
      await advanceTime(5 * 60, logger);

      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const result = parseLogOutput(writtenContent);
      expect(result.heaterOnSeconds).toBe(300); // Should record time before disconnection
    });

    it('handles heater state reset between log periods', async () => {
      mockFs.existsSync.mockReturnValue(true);
      let writtenContent = [];
      mockFs.appendFileSync.mockImplementation((filename, content) => {
        writtenContent.push(content);
      });


      // First log period: heater on for 5 minutes
      await mockServer.turnHeaterOn();
      await advanceTime(5 * 60, logger);
      await mockServer.turnHeaterOff();
      await advanceTime(5 * 60, logger);

      // Second log period: simulate system restart (client disconnects and reconnects)
      pentairClient.disconnect();
      
      await pentairClient.connect();

      await advanceTime(2 * 60, logger);
      await mockServer.turnHeaterOn();
      await advanceTime(3 * 60, logger);
      await mockServer.turnHeaterOff();
      await advanceTime(5 * 60, logger);

      expect(writtenContent.length).toBe(2);
      
      // First period: 300 seconds
      const result1 = parseLogOutput(writtenContent[0]);
      expect(result1.heaterOnSeconds).toBe(300);
      
      // Second period: 180 seconds
      const result2 = parseLogOutput(writtenContent[1]);
      expect(result2.heaterOnSeconds).toBe(180);
    });
  });
});
