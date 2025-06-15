const { Logger, Registers } = require('../server');

const mockFs = {
  existsSync: jest.fn(() => false),
  appendFileSync: jest.fn()
};

const mockSettings = {
  log_entry_minutes: 10
};

// Mock client with readHoldingRegisters method, using symbolic register names
function makeMockClient(registerValueMap) {
  // Map symbolic names to register numbers
  const regNumMap = {};
  for (const key in Registers) {
    regNumMap[Registers[key].reg] = key;
  }
  return {
    readHoldingRegisters: (rn, len, cb) => {
      const regName = regNumMap[rn];
      const value = registerValueMap[regName];
      if (value === 'FAIL') {
        cb(new Error('Read failed'), null);
        return;
      }
      const buffer = Buffer.alloc(4);
      buffer.writeFloatBE(value !== undefined ? value : 0, 0);
      cb(null, { buffer });
    }
  };
}

describe('Logger', () => {
  beforeEach(() => {
    mockFs.existsSync.mockReset();
    mockFs.appendFileSync.mockReset();
  });

  it('mock client returns correct values for logger registers', done => {
    const all2 = { ClValue: 2, PhValue: 2, ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    const client = makeMockClient(all2);
    // Only check registers used by the logger
    const registersToLog = ['ClValue', 'PhValue', 'ORPValue', 'TempValue', 'ClSet', 'PhSet', 'ClYout', 'PhYout'];
    let checked = 0;
    registersToLog.forEach(regName => {
      const rn = Registers[regName].reg;
      client.readHoldingRegisters(rn, 2, (err, data) => {
        expect(err).toBeNull();
        const val = data.buffer.readFloatBE(0);
        expect(val).toBe(2);
        checked++;
        if (checked === registersToLog.length) done();
      });
    });
  });

  it('writes a log row with correct average and filename for two good samples', async () => {
    mockFs.existsSync.mockReturnValueOnce(false); // File does not exist
    let writtenFilename = null;
    mockFs.appendFileSync.mockImplementation((filename, content) => {
      writtenFilename = filename;
    });
    let fakeNow = new Date(2024, 0, 1, 12, 0, 0);
    const nowFn = () => fakeNow;
    const logger = new Logger({ fs: mockFs, settings: mockSettings, nowFn });
    const all2 = { ClValue: 2, PhValue: 2, ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    const all4 = { ClValue: 4, PhValue: 4, ORPValue: 4, TempValue: 4, ClSet: 4, PhSet: 4, ClYout: 4, PhYout: 4 };
    await logger.updateLog(makeMockClient(all2));
    fakeNow = new Date(2024, 0, 1, 12, 11, 0);
    await logger.updateLog(makeMockClient(all4));
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    expect(writtenFilename).toBe('static/log-2024-1.csv');
    const logCall = mockFs.appendFileSync.mock.calls[0][1];
    const lines = logCall.split('\n');
    const dataRow = lines[1];
    const parts = dataRow.split(',');
    expect(parts.length).toBe(9); // Time + 8 values
    for (let i = 1; i < parts.length; ++i) {
      expect(parseFloat(parts[i])).toBeCloseTo(3, 2);
    }
  });

  it('appends a second line to an existing log file with a long sample and two normal samples', async () => {
    // Simulate file exists for the second call
    mockFs.existsSync.mockReturnValue(true);
    let writtenContent = [];
    mockFs.appendFileSync.mockImplementation((filename, content) => {
      writtenContent.push(content);
    });
    let fakeNow = new Date(2024, 0, 1, 12, 0, 0);
    const nowFn = () => fakeNow;
    const logger = new Logger({ fs: mockFs, settings: mockSettings, nowFn });
    // First sample: all 10s
    const all10 = { ClValue: 10, PhValue: 10, ORPValue: 10, TempValue: 10, ClSet: 10, PhSet: 10, ClYout: 10, PhYout: 10 };
    await logger.updateLog(makeMockClient(all10));
    // Second sample: all 2s
    fakeNow = new Date(2024, 0, 1, 12, 11, 0);
    const all2 = { ClValue: 2, PhValue: 2, ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    await logger.updateLog(makeMockClient(all2));
    // Third sample: all 4s
    fakeNow = new Date(2024, 0, 1, 12, 22, 0);
    const all4 = { ClValue: 4, PhValue: 4, ORPValue: 4, TempValue: 4, ClSet: 4, PhSet: 4, ClYout: 4, PhYout: 4 };
    await logger.updateLog(makeMockClient(all4));
    // Should have written two log entries (one for each time window)
    expect(writtenContent.length).toBe(2);
    // First line: average of 10 and 2 = 6
    const lines1 = writtenContent[0].split('\n');
    const dataRow1 = lines1[1];
    const parts1 = dataRow1.split(',');
    for (let i = 1; i < parts1.length; ++i) {
      expect(parseFloat(parts1[i])).toBeCloseTo(6, 2);
    }
    // Second line: just 4s
    const lines2 = writtenContent[1].split('\n');
    const dataRow2 = lines2[0]; // no header
    const parts2 = dataRow2.split(',');
    for (let i = 1; i < parts2.length; ++i) {
      expect(parseFloat(parts2[i])).toBeCloseTo(4, 2);
    }
  });

  it('throws if a single register read fails', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.appendFileSync.mockClear();
    let fakeNow = new Date(2024, 0, 1, 12, 0, 0);
    const nowFn = () => fakeNow;
    const logger = new Logger({ fs: mockFs, settings: mockSettings, nowFn });
    const errorSample = { ClValue: 2, PhValue: 'FAIL', ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    await expect(logger.updateLog(makeMockClient(errorSample))).rejects.toThrow();
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });

  it('handles interleaving errors and success', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.appendFileSync.mockClear();
    let fakeNow = new Date(2024, 0, 1, 12, 0, 0);
    const nowFn = () => fakeNow;
    const logger = new Logger({ fs: mockFs, settings: mockSettings, nowFn });
    // Good sample
    const all2 = { ClValue: 2, PhValue: 2, ORPValue: 2, TempValue: 2, ClSet: 2, PhSet: 2, ClYout: 2, PhYout: 2 };
    await logger.updateLog(makeMockClient(all2));
    // Error sample
    fakeNow = new Date(2024, 0, 1, 12, 5, 0);
    const errorSample = { ClValue: 4, PhValue: 'FAIL', ORPValue: 4, TempValue: 4, ClSet: 4, PhSet: 4, ClYout: 4, PhYout: 4 };
    await logger.updateLog(makeMockClient(errorSample)).catch(() => {});
    // Good sample
    fakeNow = new Date(2024, 0, 1, 12, 11, 0);
    const all4 = { ClValue: 4, PhValue: 4, ORPValue: 4, TempValue: 4, ClSet: 4, PhSet: 4, ClYout: 4, PhYout: 4 };
    await logger.updateLog(makeMockClient(all4));
    expect(mockFs.appendFileSync).toHaveBeenCalled();
    const logCall = mockFs.appendFileSync.mock.calls[0][1];
    const lines = logCall.split('\n');
    const dataRow = lines[1];
    const parts = dataRow.split(',');
    expect(parts.length).toBe(9); // Time + 8 values
    for (let i = 1; i < parts.length; ++i) {
      expect(parseFloat(parts[i])).toBeCloseTo(3, 2);
    }
  });

  it('should not write a log row if all register reads fail (NaN bug test)', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.appendFileSync.mockClear();
    let fakeNow = new Date(2024, 0, 1, 12, 0, 0);
    const nowFn = () => fakeNow;
    const logger = new Logger({ fs: mockFs, settings: mockSettings, nowFn });
    // All reads fail for both samples
    const failAll = { ClValue: 'FAIL', PhValue: 'FAIL', ORPValue: 'FAIL', TempValue: 'FAIL', ClSet: 'FAIL', PhSet: 'FAIL', ClYout: 'FAIL', PhYout: 'FAIL' };
    try {
      await logger.updateLog(makeMockClient(failAll));
    } catch (e) {}
    try {
      await logger.updateLog(makeMockClient(failAll));
    } catch (e) {}
    fakeNow = new Date(2024, 0, 1, 12, 11, 0);
    try {
      await logger.updateLog(makeMockClient(failAll));
    } catch (e) {}
    expect(mockFs.appendFileSync).not.toHaveBeenCalled();
  });
}); 