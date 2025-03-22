/**
 * Fake Controller for BSMon
 * 
 * This module implements a fake Modbus controller for testing and development
 * when the real chemical controller is offline.
 */

class FakeController {
  constructor() {
    // No initialization needed for simple implementation
  }

  connectTCP(host, options, callback) {
    // Just call the callback to simulate successful connection
    if (callback) callback();
    return Promise.resolve();
  }

  setID(id) {
    // No-op
  }

  readHoldingRegisters(register, length, callback) {
    // Create a buffer with fake data based on the register being requested
    const buffer = this.createFakeBuffer(register, length);
    
    // Call the callback with the fake data
    if (callback) callback(null, { buffer });
    return Promise.resolve({ buffer });
  }

  close(callback) {
    // Just call the callback to simulate successful disconnection
    if (callback) callback();
    return Promise.resolve();
  }

  createFakeBuffer(register, length) {
    // Create a buffer with appropriate fake data based on the register
    const buffer = Buffer.alloc(length * 2); // Each register is 2 bytes
    
    // System name (ASCII)
    if (register === 0) { // Register 1 in the code, but 0-indexed here
      const text = "FAKE-CONTROLLER";
      const buf = Buffer.from(text.padEnd(20, '\0'), 'latin1');
      return buf.swap16(); // Swap bytes as required by the protocol
    }
    
    // Float values
    if (register === 100) { // ClValue
      buffer.writeFloatBE(1.5, 0); // Chlorine value of 1.5
      return buffer;
    }
    if (register === 102) { // ClUnit
      const text = "ppm";
      const buf = Buffer.from(text.padEnd(10, '\0'), 'latin1');
      return buf.swap16();
    }
    if (register === 111) { // ClSet
      buffer.writeFloatBE(1.0, 0); // Chlorine setpoint of 1.0
      return buffer;
    }
    if (register === 113) { // ClYout
      buffer.writeFloatBE(5.0, 0); // Chlorine output of 5%
      return buffer;
    }
    if (register === 115) { // PhValue
      buffer.writeFloatBE(7.2, 0); // pH value of 7.2
      return buffer;
    }
    if (register === 117) { // PhUnit
      const text = "pH";
      const buf = Buffer.from(text.padEnd(10, '\0'), 'latin1');
      return buf.swap16();
    }
    if (register === 126) { // PhSet
      buffer.writeFloatBE(7.4, 0); // pH setpoint of 7.4
      return buffer;
    }
    if (register === 128) { // PhYout
      buffer.writeFloatBE(3.0, 0); // pH output of 3%
      return buffer;
    }
    if (register === 130) { // ORPValue
      buffer.writeFloatBE(750, 0); // ORP value of 750
      return buffer;
    }
    if (register === 132) { // ORPUnit
      const text = "mV";
      const buf = Buffer.from(text.padEnd(10, '\0'), 'latin1');
      return buf.swap16();
    }
    if (register === 160) { // TempValue
      buffer.writeFloatBE(26.5, 0); // Temperature of 26.5
      return buffer;
    }
    if (register === 162) { // TempUnit
      const text = "°C";
      const buf = Buffer.from(text.padEnd(10, '\0'), 'latin1');
      return buf.swap16();
    }
    
    // UInt16 values
    if (register === 300) { // Alarms
      buffer.writeUInt16BE(0, 0); // No alarms
      return buffer;
    }
    if (register === 304) { // ClMode
      buffer.writeUInt16BE(2, 0); // Auto mode (bit 1 set)
      return buffer;
    }
    if (register === 305) { // PhMode
      buffer.writeUInt16BE(2, 0); // Auto mode (bit 1 set)
      return buffer;
    }
    
    // UInt32 values
    if (register === 310 || register === 314 || register === 318 || register === 328) {
      // ClError, PhError, ORPError, TempError
      buffer.writeUInt32BE(0, 0); // No errors
      return buffer;
    }
    
    // Default: return empty buffer
    return buffer;
  }
}

module.exports = FakeController;
