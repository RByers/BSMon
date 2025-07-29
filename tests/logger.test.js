const Logger = require('../logger');
const { BSClient, Registers } = require('../bs-client');
const PentairClient = require('../pentair-client');
const { drainEventLoop, MockPentairServer } = require('./test-utils');

const mockFs = {
  existsSync: jest.fn(() => false),
  appendFileSync: jest.fn()
};

const mockSettings = {
  log_entry_minutes: 10,
  alarm_poll_seconds: 10
};

// Constants and helpers for register value creation
const CSV_HEADERS = ['Time', 'ClValue', 'PhValue', 'ORPValue', 'TempValue', 'ClSet', 'PhSet', 'ClYout', 'PhYout', 'SuccessCount', 'TimeoutCount', 'HeaterOnSeconds', 'setpoint', 'waterTemp', 'PentairSeconds'];
const LOGGER_REGISTERS = ['ClValue', 'PhValue', 'ORPValue', 'TempValue', 'ClSet', 'PhSet', 'ClYout', 'PhYout'];


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
  
  const logFileHelpers = {
    content: writtenLines, 
    filename: () => writtenFilename,
    getColumnValue: (rowIndex, columnName) => {
      const parts = writtenLines[rowIndex].split(',');
      return parseFloat(parts[CSV_HEADERS.indexOf(columnName)]);
    },
    getDataRow: (rowIndex) => {
      const parts = writtenLines[rowIndex].split(',');
      const result = {};
      CSV_HEADERS.forEach((header, index) => {
        if (header === 'Time') {
          result[header] = parts[index]; // Keep timestamp as string
        } else {
          result[header] = parseFloat(parts[index]);
        }
      });
      return result;
    },
    getLastDataRow: () => {
      return logFileHelpers.getDataRow(writtenLines.length - 1);
    },
    getRowCount: () => writtenLines.length
  };
  
  return logFileHelpers;
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


describe('Logger', () => {
  let fakeNow;
  let logFile;
  const nowFn = () => fakeNow;
  // Manage the fake clock, advancing it and triggering any log updates similarly to how polling
  // works in the main app. Throws exceptions on error.
  // Note: this will early-out when an error occurs, only advancing time up to the point of first error
  const advanceTime = async (seconds, logger) => {
    const pollInterval = mockSettings.alarm_poll_seconds;
    const totalSteps = Math.ceil(seconds / pollInterval);
    
    for (let step = 0; step < totalSteps; step++) {
      const stepSeconds = Math.min(pollInterval, seconds - (step * pollInterval));
      fakeNow = new Date(fakeNow.getTime() + stepSeconds * 1000);
      if (logger) {
        await logger.updateLog();
      }
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
    // With 10-second polling: 10 minutes = 60 polls (log writes after exactly 10 minutes)
    expect(result.SuccessCount).toBe(60);
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
    // With 10-second polling: 10 min = 60 polls
    expect(result.SuccessCount).toBe(60);
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
    // With 10-second polling: 10 min = 60 polls
    expect(result.SuccessCount).toBe(60);
    expect(result.TimeoutCount).toBe(0);
  });

  it('throws if a single register read fails', async () => {
    const mockClient = makeMockBSClient({ ...createRegisterValues(2), PhValue: 'FAIL' });
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await expect(logger.updateLog()).rejects.toThrow();
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });

  it('handles errors during sampling', async () => {
    // Good samples for 8 minutes with value 3
    const mockClient = makeMockBSClient(createRegisterValues(3));
    const logger = new Logger({ bsClient: mockClient, fs: mockFs, settings: mockSettings, nowFn });
    await advanceTime(8 * 60, logger);
    
    // Error occurs - this will cause advanceTime to early-out, stopping progression at this point
    mockClient.updateValues({ ...createRegisterValues(5), PhValue: 'FAIL' });
    try {
      await advanceTime(5 * 60, logger); // Attempt to continue but will fail immediately
    } catch (e) {
      // Expected to fail - advanceTime early-outs on first error
    }
    
    // Fix the client values and manually advance time to reach the 10-minute log boundary
    mockClient.updateValues(createRegisterValues(3)); // Reset to working values
    await advanceTime(2 * 60, logger); // Add 2 more minutes to reach 10 minutes total
    
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    expect(logFile.content.length).toBe(2); // Header + data row
    const result = logFile.getLastDataRow();
    
    // With 10-second polling: 8 min = 48 successful polls with value 3, then error, then 2 min = 12 more successful polls with value 3
    // Average = 3 (since all successful samples had value 3)
    for (const registerName of LOGGER_REGISTERS) {
      expect(result[registerName]).toBe(3);
    }
    expect(result.SuccessCount).toBe(59); // 60 polls over 10 minutes minus one failure
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

  describe('Pentair Connection Time Tests', () => {
    const MOCK_SERVER_PORT = 6680; // Different port from heater tests
    
    let mockServer;
    let testClient;
    let pentairClient;
    let logger;

    beforeEach(async () => {
      mockServer = new MockPentairServer(MOCK_SERVER_PORT);
      testClient = makeMockBSClient(createRegisterValues(2));
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

    it('records connection time across two log periods and validates timestamps', async () => {
      // Client is already connected, advance time for first full log period
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      // Verify first log entry was written
      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(1);
      expect(logFile.getRowCount()).toBe(2); // Header + 1 data row

      const firstEntry = logFile.getDataRow(1); // Row 1 is first data row (row 0 is header)
      expect(firstEntry.PentairSeconds).toBe(mockSettings.log_entry_minutes * 60); // 10 minutes = 600 seconds
      expect(firstEntry.Time).toBe('1/1/2024 12:10:00'); // Started at 12:00:00, advanced 10 minutes

      // Advance time for second full log period  
      await advanceTime(mockSettings.log_entry_minutes * 60, logger);

      // Verify second log entry was written
      expect(mockFs.appendFileSync).toHaveBeenCalledTimes(2);
      expect(logFile.getRowCount()).toBe(3); // Header + 2 data rows

      const secondEntry = logFile.getDataRow(2); // Row 2 is second data row
      expect(secondEntry.PentairSeconds).toBe(mockSettings.log_entry_minutes * 60); // Another 10 minutes = 600 seconds
      expect(secondEntry.Time).toBe('1/1/2024 12:20:00'); // Advanced another 10 minutes to 20 minutes total

      // Validate that connection time equals the log period duration for both entries
      const expectedConnectionTime = mockSettings.log_entry_minutes * 60;
      expect(firstEntry.PentairSeconds).toBe(expectedConnectionTime);
      expect(secondEntry.PentairSeconds).toBe(expectedConnectionTime);
    });
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

  describe('getLast24HoursCSV', () => {
    let mockFs;
    let logger;

    beforeEach(() => {
      mockFs = {
        existsSync: jest.fn(),
        readFileSync: jest.fn()
      };
      logger = new Logger({ fs: mockFs });
    });

    it('returns just header when no log files exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      
      const result = logger.getLast24HoursCSV(nowFn);
      
      expect(result).toBe('Time,ClValue,PhValue,ORPValue,TempValue,ClSet,PhSet,ClYout,PhYout,SuccessCount,TimeoutCount,HeaterOnSeconds,setpoint,waterTemp,PentairSeconds\n');
    });

    it('filters entries from last 24 hours correctly', () => {
      const fakeNow = new Date(2024, 0, 2, 12, 0, 0); // Jan 2, 2024 12:00:00
      const testNowFn = () => fakeNow;
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        'Time,ClValue,PhValue,ORPValue,TempValue,ClSet,PhSet,ClYout,PhYout,SuccessCount,TimeoutCount,HeaterOnSeconds,setpoint,waterTemp,PentairSeconds\n' +
        '1/1/2024 10:00:00,1.0,7.2,650,75,1.0,7.2,50,25,60,0,300,80,76,600\n' + // 26 hours ago - should be excluded
        '1/1/2024 14:00:00,1.1,7.3,655,76,1.1,7.3,55,30,60,0,400,80,77,600\n' + // 22 hours ago - should be included
        '1/2/2024 10:00:00,1.2,7.1,645,74,1.2,7.1,45,20,60,0,200,80,75,600\n' + // 2 hours ago - should be included
        '1/2/2024 13:00:00,1.3,7.4,660,77,1.3,7.4,60,35,60,0,500,80,78,600\n'  // 1 hour in future - should be excluded
      );
      
      const result = logger.getLast24HoursCSV(testNowFn);
      const lines = result.split('\n').filter(line => line.trim() !== '');
      
      expect(lines).toHaveLength(3); // Header + 2 data lines
      expect(lines[0]).toBe('Time,ClValue,PhValue,ORPValue,TempValue,ClSet,PhSet,ClYout,PhYout,SuccessCount,TimeoutCount,HeaterOnSeconds,setpoint,waterTemp,PentairSeconds');
      expect(lines[1]).toBe('1/1/2024 14:00:00,1.1,7.3,655,76,1.1,7.3,55,30,60,0,400,80,77,600');
      expect(lines[2]).toBe('1/2/2024 10:00:00,1.2,7.1,645,74,1.2,7.1,45,20,60,0,200,80,75,600');
    });

    it('handles month boundary crossing', () => {
      const fakeNow = new Date(2024, 1, 1, 6, 0, 0); // Feb 1, 2024 06:00:00
      const testNowFn = () => fakeNow;
      
      // Mock file system to return true for both January and February files
      mockFs.existsSync.mockImplementation((filename) => {
        return filename === 'static/log-2024-2.csv' || filename === 'static/log-2024-1.csv';
      });
      
      // Mock different content for each file
      mockFs.readFileSync.mockImplementation((filename) => {
        if (filename === 'static/log-2024-1.csv') {
          return 'Time,ClValue,PhValue,ORPValue,TempValue,ClSet,PhSet,ClYout,PhYout,SuccessCount,TimeoutCount,HeaterOnSeconds,setpoint,waterTemp,PentairSeconds\n' +
                 '1/31/2024 10:00:00,1.0,7.2,650,75,1.0,7.2,50,25,60,0,300,80,76,600\n'; // 20 hours ago - should be included
        } else if (filename === 'static/log-2024-2.csv') {
          return 'Time,ClValue,PhValue,ORPValue,TempValue,ClSet,PhSet,ClYout,PhYout,SuccessCount,TimeoutCount,HeaterOnSeconds,setpoint,waterTemp,PentairSeconds\n' +
                 '2/1/2024 2:00:00,1.1,7.3,655,76,1.1,7.3,55,30,60,0,400,80,77,600\n'; // 4 hours ago - should be included
        }
      });
      
      const result = logger.getLast24HoursCSV(testNowFn);
      const lines = result.split('\n').filter(line => line.trim() !== '');
      
      expect(lines).toHaveLength(3); // Header + 2 data lines from both months
      expect(mockFs.existsSync).toHaveBeenCalledWith('static/log-2024-2.csv');
      expect(mockFs.existsSync).toHaveBeenCalledWith('static/log-2024-1.csv');
    });

    it('handles malformed lines gracefully', () => {
      const fakeNow = new Date(2024, 0, 2, 12, 0, 0);
      const testNowFn = () => fakeNow;
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        'Time,ClValue,PhValue,ORPValue,TempValue,ClSet,PhSet,ClYout,PhYout,SuccessCount,TimeoutCount,HeaterOnSeconds,setpoint,waterTemp,PentairSeconds\n' +
        'invalid-line-without-comma\n' +
        '1/2/2024 10:00:00,1.2,7.1,645,74,1.2,7.1,45,20,60,0,200,80,75,600\n' +
        '\n' + // Empty line
        'another-invalid-line\n'
      );
      
      const result = logger.getLast24HoursCSV(testNowFn);
      const lines = result.split('\n').filter(line => line.trim() !== '');
      
      expect(lines).toHaveLength(2); // Header + 1 valid data line
      expect(lines[1]).toBe('1/2/2024 10:00:00,1.2,7.1,645,74,1.2,7.1,45,20,60,0,200,80,75,600');
    });

    it('handles file read errors gracefully', () => {
      const fakeNow = new Date(2024, 0, 2, 12, 0, 0);
      const testNowFn = () => fakeNow;
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });
      
      const result = logger.getLast24HoursCSV(testNowFn);
      const lines = result.split('\n').filter(line => line.trim() !== '');
      
      expect(lines).toHaveLength(1); // Just header
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error reading log file'), expect.any(Error));
      
      consoleErrorSpy.mockRestore();
    });

    it('returns entries sorted chronologically when reading from multiple files', () => {
      const fakeNow = new Date(2024, 1, 1, 12, 0, 0); // Feb 1, 2024 12:00:00
      const testNowFn = () => fakeNow;
      
      mockFs.existsSync.mockImplementation((filename) => {
        return filename === 'static/log-2024-2.csv' || filename === 'static/log-2024-1.csv';
      });
      
      mockFs.readFileSync.mockImplementation((filename) => {
        if (filename === 'static/log-2024-1.csv') {
          return 'Time,ClValue,PhValue,ORPValue,TempValue,ClSet,PhSet,ClYout,PhYout,SuccessCount,TimeoutCount,HeaterOnSeconds,setpoint,waterTemp,PentairSeconds\n' +
                 '1/31/2024 18:00:00,1.0,7.2,650,75,1.0,7.2,50,25,60,0,300,80,76,600\n'; // 18 hours ago
        } else if (filename === 'static/log-2024-2.csv') {
          return 'Time,ClValue,PhValue,ORPValue,TempValue,ClSet,PhSet,ClYout,PhYout,SuccessCount,TimeoutCount,HeaterOnSeconds,setpoint,waterTemp,PentairSeconds\n' +
                 '2/1/2024 6:00:00,1.1,7.3,655,76,1.1,7.3,55,30,60,0,400,80,77,600\n'; // 6 hours ago
        }
      });
      
      const result = logger.getLast24HoursCSV(testNowFn);
      const lines = result.split('\n').filter(line => line.trim() !== '');
      
      expect(lines).toHaveLength(3); // Header + 2 data lines
      expect(lines[1]).toBe('1/31/2024 18:00:00,1.0,7.2,650,75,1.0,7.2,50,25,60,0,300,80,76,600');
      expect(lines[2]).toBe('2/1/2024 6:00:00,1.1,7.3,655,76,1.1,7.3,55,30,60,0,400,80,77,600');
    });
  });
});
