const PentairClient = require('../pentair-client');
const { MockPentairServer } = require('./test-utils');

describe('PentairClient', () => {
  const MOCK_SERVER_PORT = 6682;
  let mockServer;
  let pentairClient;
  let fakeNow;

  const nowFn = () => fakeNow;

  beforeEach(async () => {
    fakeNow = new Date(2024, 0, 1, 12, 0, 0);
    mockServer = new MockPentairServer(MOCK_SERVER_PORT);
    pentairClient = new PentairClient('localhost', MOCK_SERVER_PORT, nowFn);
    await pentairClient.connect();
  });

  afterEach(async () => {
    if (pentairClient) {
      pentairClient.disconnect();
    }
    if (mockServer) {
      await mockServer.close();
      mockServer = null;
    }
  });

  describe('heaterOn property', () => {
    it('should expose heaterOn property that reflects current heater state', async () => {
      // Initially heater should be off
      expect(pentairClient.heaterOn).toBe(false);
      
      // Turn heater on
      await mockServer.turnHeaterOn();
      expect(pentairClient.heaterOn).toBe(true);
      
      // Turn heater off
      await mockServer.turnHeaterOff();
      expect(pentairClient.heaterOn).toBe(false);
    });

    it('should default heaterOn to false when no status received yet', () => {
      const newClient = new PentairClient('localhost', MOCK_SERVER_PORT, nowFn);
      expect(newClient.heaterOn).toBe(false);
    });
  });

  describe('setpoint availability', () => {
    it('should provide setpoint regardless of heater on/off state', async () => {
      // Set a specific setpoint
      await mockServer.setHeaterSetpoint('85');
      expect(pentairClient.setpoint).toBe('85');
      
      // Setpoint should be available when heater is off
      await mockServer.turnHeaterOff();
      expect(pentairClient.heaterOn).toBe(false);
      expect(pentairClient.setpoint).toBe('85');
      
      // Setpoint should be available when heater is on
      await mockServer.turnHeaterOn();
      expect(pentairClient.heaterOn).toBe(true);
      expect(pentairClient.setpoint).toBe('85');
      
      // Change setpoint while heater is on
      await mockServer.setHeaterSetpoint('90');
      expect(pentairClient.heaterOn).toBe(true);
      expect(pentairClient.setpoint).toBe('90');
    });

    it('should update setpoint independently of heater state changes', async () => {
      // Start with heater off and specific setpoint
      await mockServer.turnHeaterOff();
      await mockServer.setHeaterSetpoint('82');
      
      expect(pentairClient.heaterOn).toBe(false);
      expect(pentairClient.setpoint).toBe('82');
      
      // Change just the setpoint, not heater state
      await mockServer.setHeaterSetpoint('88');
      expect(pentairClient.heaterOn).toBe(false);
      expect(pentairClient.setpoint).toBe('88');
      
      // Turn heater on without changing setpoint
      await mockServer.turnHeaterOn();
      expect(pentairClient.heaterOn).toBe(true);
      expect(pentairClient.setpoint).toBe('88');
    });
  });

  describe('state persistence across reconnection', () => {
    it('should reset heater state when disconnected', async () => {
      // Set initial state
      await mockServer.turnHeaterOn();
      await mockServer.setHeaterSetpoint('85');
      
      expect(pentairClient.heaterOn).toBe(true);
      expect(pentairClient.setpoint).toBe('85');
      
      // Disconnect
      pentairClient.disconnect();
      
      // State should be reset
      expect(pentairClient.heaterOn).toBe(false);
      expect(pentairClient.setpoint).toBe(null);
    });
  });
});
