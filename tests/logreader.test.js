// Unit tests for client-side log reader functionality
const { parseCSV, calculateHeaterDutyCycle } = require('../static/logreader');

// Mock fetch for testing
global.fetch = jest.fn();

describe('LogReader', () => {
    describe('parseCSV', () => {
        it('parses valid CSV data correctly', () => {
            const csvData = 'Time,ClValue,HeaterOnSeconds,PentairSeconds\n' +
                           '1/1/2024 12:00:00,1.5,300,600\n' +
                           '1/1/2024 12:10:00,1.6,0,600';

            const result = parseCSV(csvData);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                Time: '1/1/2024 12:00:00',
                ClValue: 1.5,
                HeaterOnSeconds: 300,
                PentairSeconds: 600
            });
            expect(result[1]).toEqual({
                Time: '1/1/2024 12:10:00',
                ClValue: 1.6,
                HeaterOnSeconds: 0,
                PentairSeconds: 600
            });
        });

        it('returns empty array for header-only CSV', () => {
            const csvData = 'Time,ClValue,HeaterOnSeconds,PentairSeconds';
            const result = parseCSV(csvData);
            expect(result).toEqual([]);
        });

        it('returns empty array for empty CSV', () => {
            const csvData = '';
            const result = parseCSV(csvData);
            expect(result).toEqual([]);
        });

        it('skips lines with too many columns and logs warning', () => {
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            
            const csvData = 'Time,ClValue,HeaterOnSeconds,PentairSeconds\n' +
                           '1/1/2024 12:00:00,1.5,300,600\n' +
                           '1/1/2024 12:05:00,1.4,250,600,extra,column\n' +
                           '1/1/2024 12:10:00,1.6,0,600';

            const result = parseCSV(csvData);

            expect(result).toHaveLength(2);
            expect(consoleWarnSpy).toHaveBeenCalledWith('Malformed CSV line 2: 1/1/2024 12:05:00,1.4,250,600,extra,column, found 6 columns, but only headers for 4');
            
            consoleWarnSpy.mockRestore();
        });

        it('processes lines with fewer columns than headers', () => {
            const csvData = 'Time,ClValue,HeaterOnSeconds,PentairSeconds,NewColumn\n' +
                           '1/1/2024 12:00:00,1.5,300,600,newValue\n' +
                           '1/1/2024 12:10:00,1.6,0,600\n' + // Missing NewColumn
                           '1/1/2024 12:20:00,1.7,100';      // Missing PentairSeconds and NewColumn

            const result = parseCSV(csvData);

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({
                Time: '1/1/2024 12:00:00',
                ClValue: 1.5,
                HeaterOnSeconds: 300,
                PentairSeconds: 600,
                NewColumn: 0 // newValue converted to 0 since it's not numeric
            });
            expect(result[1]).toEqual({
                Time: '1/1/2024 12:10:00',
                ClValue: 1.6,
                HeaterOnSeconds: 0,
                PentairSeconds: 600
                // NewColumn missing - not included in object
            });
            expect(result[2]).toEqual({
                Time: '1/1/2024 12:20:00',
                ClValue: 1.7,
                HeaterOnSeconds: 100
                // PentairSeconds and NewColumn missing - not included in object
            });
        });

        it('skips empty lines', () => {
            const csvData = 'Time,ClValue,HeaterOnSeconds,PentairSeconds\n' +
                           '1/1/2024 12:00:00,1.5,300,600\n' +
                           '\n' +
                           '1/1/2024 12:10:00,1.6,0,600\n' +
                           '';

            const result = parseCSV(csvData);
            expect(result).toHaveLength(2);
        });

        it('handles non-numeric values by converting to 0', () => {
            const csvData = 'Time,ClValue,HeaterOnSeconds,PentairSeconds\n' +
                           '1/1/2024 12:00:00,invalid,300,600';

            const result = parseCSV(csvData);

            expect(result).toHaveLength(1);
            expect(result[0].ClValue).toBe(0);
            expect(result[0].HeaterOnSeconds).toBe(300);
        });
    });

    describe('calculateHeaterDutyCycle', () => {
        it('calculates duty cycle correctly', () => {
            const logEntries = [
                { HeaterOnSeconds: 300, PentairSeconds: 600 }, // 50% duty cycle
                { HeaterOnSeconds: 150, PentairSeconds: 600 }, // 25% duty cycle
                { HeaterOnSeconds: 0, PentairSeconds: 600 }    // 0% duty cycle
            ];

            const result = calculateHeaterDutyCycle(logEntries);

            // Total: 450 heater seconds / 1800 pentair seconds = 25%
            expect(result).toBe(25);
        });

        it('rounds to whole number', () => {
            const logEntries = [
                { HeaterOnSeconds: 100, PentairSeconds: 600 }, // 16.67% -> rounds to 17%
            ];

            const result = calculateHeaterDutyCycle(logEntries);
            expect(result).toBe(17);
        });

        it('returns null for empty log entries', () => {
            const result = calculateHeaterDutyCycle([]);
            expect(result).toBeNull();
        });

        it('returns null for null input', () => {
            const result = calculateHeaterDutyCycle(null);
            expect(result).toBeNull();
        });

        it('returns null when total Pentair seconds is zero', () => {
            const logEntries = [
                { HeaterOnSeconds: 300, PentairSeconds: 0 },
                { HeaterOnSeconds: 150, PentairSeconds: 0 }
            ];

            const result = calculateHeaterDutyCycle(logEntries);
            expect(result).toBeNull();
        });

        it('handles missing HeaterOnSeconds and PentairSeconds fields', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', ClValue: 1.5 }, // No heater fields
                { HeaterOnSeconds: 300, PentairSeconds: 600 }  // Has heater fields
            ];

            const result = calculateHeaterDutyCycle(logEntries);

            // Only processes entry with both fields: 300/600 = 50%
            expect(result).toBe(50);
        });

        it('treats undefined values as 0', () => {
            const logEntries = [
                { HeaterOnSeconds: undefined, PentairSeconds: 600 },
                { HeaterOnSeconds: 300, PentairSeconds: undefined }
            ];

            const result = calculateHeaterDutyCycle(logEntries);

            // (0 + 300) / (600 + 0) = 50%
            expect(result).toBe(50);
        });

        it('handles 100% duty cycle', () => {
            const logEntries = [
                { HeaterOnSeconds: 600, PentairSeconds: 600 }
            ];

            const result = calculateHeaterDutyCycle(logEntries);
            expect(result).toBe(100);
        });

        it('handles 0% duty cycle', () => {
            const logEntries = [
                { HeaterOnSeconds: 0, PentairSeconds: 600 },
                { HeaterOnSeconds: 0, PentairSeconds: 600 }
            ];

            const result = calculateHeaterDutyCycle(logEntries);
            expect(result).toBe(0);
        });
    });
});
