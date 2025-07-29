// Unit tests for client-side log reader functionality
const { parseCSV, calculateHeaterDutyCycle, calculatePentairUptime, calculateBSUptime, calculateClOutputAverage24h, calculatePhOutputAverage24h } = require('../static/logreader');

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

    describe('calculatePentairUptime', () => {
        it('calculates uptime correctly', () => {
            const logEntries = [
                { Time: '2024-01-01T12:00:00Z', PentairSeconds: 600 }, // Skip first entry (unknown time span)
                { Time: '2024-01-01T12:10:00Z', PentairSeconds: 480 }, // 8 minutes
                { Time: '2024-01-01T12:20:00Z', PentairSeconds: 300 }  // 5 minutes
            ];

            const result = calculatePentairUptime(logEntries);

            // Total Pentair seconds: Skip first (600), so 480 + 300 = 780
            // Time span: 20 minutes = 1200 seconds
            // Uptime: 780 / 1200 = 65%
            expect(result).toBe(65);
        });

        it('rounds to whole number', () => {
            const logEntries = [
                { Time: '2024-01-01T12:00:00Z', PentairSeconds: 500 }, // Skip first entry
                { Time: '2024-01-01T12:10:00Z', PentairSeconds: 100 }  // Only count this one
            ];

            const result = calculatePentairUptime(logEntries);

            // Total: Skip first (500), so just 100 seconds / 600 seconds time span = 16.67%
            expect(result).toBeCloseTo(16.67, 2);
        });

        it('returns null for empty log entries', () => {
            const result = calculatePentairUptime([]);
            expect(result).toBeNull();
        });

        it('returns null for null input', () => {
            const result = calculatePentairUptime(null);
            expect(result).toBeNull();
        });

        it('returns null for single entry (need at least 2 for time span)', () => {
            const logEntries = [
                { Time: '2024-01-01T12:00:00Z', PentairSeconds: 600 }
            ];

            const result = calculatePentairUptime(logEntries);
            expect(result).toBeNull();
        });

        it('returns null when timestamps are missing', () => {
            const logEntries = [
                { PentairSeconds: 600 }, // No Time field
                { Time: '2024-01-01T12:10:00Z', PentairSeconds: 480 }
            ];

            const result = calculatePentairUptime(logEntries);
            expect(result).toBeNull();
        });

        it('returns null when timestamps are invalid', () => {
            const logEntries = [
                { Time: 'invalid-date', PentairSeconds: 600 },
                { Time: '2024-01-01T12:10:00Z', PentairSeconds: 480 }
            ];

            const result = calculatePentairUptime(logEntries);
            expect(result).toBeNull();
        });

        it('returns null when time span is zero or negative', () => {
            const logEntries = [
                { Time: '2024-01-01T12:10:00Z', PentairSeconds: 600 },
                { Time: '2024-01-01T12:00:00Z', PentairSeconds: 480 } // Earlier time
            ];

            const result = calculatePentairUptime(logEntries);
            expect(result).toBeNull();
        });

        it('handles missing PentairSeconds fields', () => {
            const logEntries = [
                { Time: '2024-01-01T12:00:00Z' }, // No PentairSeconds field
                { Time: '2024-01-01T12:10:00Z', PentairSeconds: 600 }
            ];

            const result = calculatePentairUptime(logEntries);

            // Only counts entry with PentairSeconds: 600 / 600 seconds = 100%
            expect(result).toBe(100);
        });

        it('treats undefined PentairSeconds as 0', () => {
            const logEntries = [
                { Time: '2024-01-01T12:00:00Z', PentairSeconds: undefined },
                { Time: '2024-01-01T12:10:00Z', PentairSeconds: 300 }
            ];

            const result = calculatePentairUptime(logEntries);

            // (0 + 300) / 600 seconds = 50%
            expect(result).toBe(50);
        });

        it('handles 100% uptime', () => {
            const logEntries = [
                { Time: '2024-01-01T12:00:00Z', PentairSeconds: 600 }, // Skip first entry
                { Time: '2024-01-01T12:10:00Z', PentairSeconds: 600 }  // Only count this one
            ];

            const result = calculatePentairUptime(logEntries);

            // Skip first (600), so just 600 seconds / 600 seconds time span = 100%
            expect(result).toBe(100);
        });

        it('handles 0% uptime', () => {
            const logEntries = [
                { Time: '2024-01-01T12:00:00Z', PentairSeconds: 0 },
                { Time: '2024-01-01T12:10:00Z', PentairSeconds: 0 }
            ];

            const result = calculatePentairUptime(logEntries);
            expect(result).toBe(0);
        });

        it('handles different date formats', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', PentairSeconds: 300 }, // Skip first entry
                { Time: '1/1/2024 12:10:00', PentairSeconds: 300 }  // Only count this one
            ];

            const result = calculatePentairUptime(logEntries);

            // Skip first (300), so just 300 seconds / 600 seconds time span = 50%
            expect(result).toBe(50);
        });
    });

    describe('calculateBSUptime', () => {
        it('calculates BS uptime correctly', () => {
            const logEntries = [
                { SuccessCount: 80, TimeoutCount: 20 }, // 80% success rate
                { SuccessCount: 90, TimeoutCount: 10 }, // 90% success rate
                { SuccessCount: 70, TimeoutCount: 30 }  // 70% success rate
            ];

            const result = calculateBSUptime(logEntries);

            // Total: 240 success / (240 success + 60 timeout) = 240/300 = 80%
            expect(result).toBe(80);
        });

        it('rounds to whole number', () => {
            const logEntries = [
                { SuccessCount: 85, TimeoutCount: 15 } // 85/100 = 85%
            ];

            const result = calculateBSUptime(logEntries);
            expect(result).toBe(85);
        });

        it('calculates decimal percentages correctly', () => {
            const logEntries = [
                { SuccessCount: 1, TimeoutCount: 2 } // 1/3 = 33.33%
            ];

            const result = calculateBSUptime(logEntries);
            expect(result).toBeCloseTo(33.33, 2);
        });

        it('returns null for empty log entries', () => {
            const result = calculateBSUptime([]);
            expect(result).toBeNull();
        });

        it('returns null for null input', () => {
            const result = calculateBSUptime(null);
            expect(result).toBeNull();
        });

        it('returns null when total samples is zero', () => {
            const logEntries = [
                { SuccessCount: 0, TimeoutCount: 0 },
                { SuccessCount: 0, TimeoutCount: 0 }
            ];

            const result = calculateBSUptime(logEntries);
            expect(result).toBeNull();
        });

        it('handles missing SuccessCount and TimeoutCount fields', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', ClValue: 1.5 }, // No BS fields
                { SuccessCount: 80, TimeoutCount: 20 }  // Has BS fields
            ];

            const result = calculateBSUptime(logEntries);

            // Only processes entry with both fields: 80/(80+20) = 80%
            expect(result).toBe(80);
        });

        it('treats undefined values as 0', () => {
            const logEntries = [
                { SuccessCount: undefined, TimeoutCount: 20 },
                { SuccessCount: 80, TimeoutCount: undefined }
            ];

            const result = calculateBSUptime(logEntries);

            // (0 + 80) / (0 + 20 + 80 + 0) = 80/100 = 80%
            expect(result).toBe(80);
        });

        it('handles 100% uptime', () => {
            const logEntries = [
                { SuccessCount: 100, TimeoutCount: 0 },
                { SuccessCount: 200, TimeoutCount: 0 }
            ];

            const result = calculateBSUptime(logEntries);
            expect(result).toBe(100);
        });

        it('handles 0% uptime', () => {
            const logEntries = [
                { SuccessCount: 0, TimeoutCount: 50 },
                { SuccessCount: 0, TimeoutCount: 100 }
            ];

            const result = calculateBSUptime(logEntries);
            expect(result).toBe(0);
        });

        it('handles mixed entries with some missing fields', () => {
            const logEntries = [
                { SuccessCount: 50, TimeoutCount: 10 }, // Valid entry
                { Time: '1/1/2024 12:00:00' },          // Missing BS fields
                { SuccessCount: 40, TimeoutCount: 20 }, // Valid entry
                { ClValue: 1.5 }                       // Missing BS fields
            ];

            const result = calculateBSUptime(logEntries);

            // Only processes valid entries: (50 + 40) / (50 + 10 + 40 + 20) = 90/120 = 75%
            expect(result).toBe(75);
        });

        it('handles entries where only one field is present', () => {
            const logEntries = [
                { SuccessCount: 100 },           // Missing TimeoutCount
                { TimeoutCount: 50 },            // Missing SuccessCount
                { SuccessCount: 80, TimeoutCount: 20 } // Both fields present
            ];

            const result = calculateBSUptime(logEntries);

            // Only processes entry with both fields: 80/(80+20) = 80%
            expect(result).toBe(80);
        });

        it('handles large numbers correctly', () => {
            const logEntries = [
                { SuccessCount: 9999, TimeoutCount: 1 }
            ];

            const result = calculateBSUptime(logEntries);

            // 9999/10000 = 99.99%
            expect(result).toBeCloseTo(99.99, 2);
        });

        it('processes all entries regardless of other fields', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', SuccessCount: 50, TimeoutCount: 50, ClValue: 1.5, PentairSeconds: 600 },
                { Time: '1/1/2024 12:10:00', SuccessCount: 75, TimeoutCount: 25, HeaterOnSeconds: 300 }
            ];

            const result = calculateBSUptime(logEntries);

            // (50 + 75) / (50 + 50 + 75 + 25) = 125/200 = 62.5%
            expect(result).toBeCloseTo(62.5, 1);
        });
    });

    describe('calculateClOutputAverage24h', () => {
        it('calculates chlorine output average correctly', () => {
            const logEntries = [
                { ClYout: 10.5 },
                { ClYout: 15.2 },
                { ClYout: 8.3 }
            ];

            const result = calculateClOutputAverage24h(logEntries);

            // Average: (10.5 + 15.2 + 8.3) / 3 = 11.33... -> rounds to 11.3
            expect(result).toBe(11.3);
        });

        it('rounds to 1 decimal place', () => {
            const logEntries = [
                { ClYout: 10.14 },
                { ClYout: 10.16 }
            ];

            const result = calculateClOutputAverage24h(logEntries);

            // Average: (10.14 + 10.16) / 2 = 10.15 -> stays 10.2 (rounds to 1 decimal)
            expect(result).toBe(10.2);
        });

        it('returns null for empty log entries', () => {
            const result = calculateClOutputAverage24h([]);
            expect(result).toBeNull();
        });

        it('returns null for null input', () => {
            const result = calculateClOutputAverage24h(null);
            expect(result).toBeNull();
        });

        it('returns null when no valid ClYout entries exist', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', ClValue: 1.5 },
                { Time: '1/1/2024 12:10:00', PhYout: 5.2 }
            ];

            const result = calculateClOutputAverage24h(logEntries);
            expect(result).toBeNull();
        });

        it('handles missing ClYout fields', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', ClValue: 1.5 }, // No ClYout field
                { ClYout: 12.5 },                           // Has ClYout field
                { Time: '1/1/2024 12:20:00' }               // No ClYout field
            ];

            const result = calculateClOutputAverage24h(logEntries);

            // Only processes entry with ClYout: 12.5
            expect(result).toBe(12.5);
        });

        it('ignores non-numeric ClYout values', () => {
            const logEntries = [
                { ClYout: 10.0 },
                { ClYout: 'invalid' }, // Non-numeric, should be ignored
                { ClYout: 20.0 }
            ];

            const result = calculateClOutputAverage24h(logEntries);

            // Only processes numeric values: (10.0 + 20.0) / 2 = 15.0
            expect(result).toBe(15.0);
        });

        it('handles zero values correctly', () => {
            const logEntries = [
                { ClYout: 0.0 },
                { ClYout: 5.0 },
                { ClYout: 0.0 }
            ];

            const result = calculateClOutputAverage24h(logEntries);

            // Average: (0.0 + 5.0 + 0.0) / 3 = 1.67... -> rounds to 1.7
            expect(result).toBe(1.7);
        });

        it('handles high precision values', () => {
            const logEntries = [
                { ClYout: 12.345678 },
                { ClYout: 13.654321 }
            ];

            const result = calculateClOutputAverage24h(logEntries);

            // Average: (12.345678 + 13.654321) / 2 = 13.0 (rounded to 1 decimal)
            expect(result).toBe(13.0);
        });

        it('processes all entries regardless of other fields', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', ClYout: 8.5, PhYout: 3.2, ClValue: 1.5 },
                { Time: '1/1/2024 12:10:00', ClYout: 12.5, HeaterOnSeconds: 300 }
            ];

            const result = calculateClOutputAverage24h(logEntries);

            // (8.5 + 12.5) / 2 = 10.5
            expect(result).toBe(10.5);
        });
    });

    describe('calculatePhOutputAverage24h', () => {
        it('calculates pH output average correctly', () => {
            const logEntries = [
                { PhYout: 5.5 },
                { PhYout: 8.2 },
                { PhYout: 3.3 }
            ];

            const result = calculatePhOutputAverage24h(logEntries);

            // Average: (5.5 + 8.2 + 3.3) / 3 = 5.67... -> rounds to 5.7
            expect(result).toBe(5.7);
        });

        it('rounds to 1 decimal place', () => {
            const logEntries = [
                { PhYout: 7.14 },
                { PhYout: 7.16 }
            ];

            const result = calculatePhOutputAverage24h(logEntries);

            // Average: (7.14 + 7.16) / 2 = 7.15 -> rounds to 7.2 (1 decimal)
            expect(result).toBe(7.2);
        });

        it('returns null for empty log entries', () => {
            const result = calculatePhOutputAverage24h([]);
            expect(result).toBeNull();
        });

        it('returns null for null input', () => {
            const result = calculatePhOutputAverage24h(null);
            expect(result).toBeNull();
        });

        it('returns null when no valid PhYout entries exist', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', PhValue: 7.2 },
                { Time: '1/1/2024 12:10:00', ClYout: 5.2 }
            ];

            const result = calculatePhOutputAverage24h(logEntries);
            expect(result).toBeNull();
        });

        it('handles missing PhYout fields', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', PhValue: 7.2 }, // No PhYout field
                { PhYout: 4.5 },                            // Has PhYout field
                { Time: '1/1/2024 12:20:00' }               // No PhYout field
            ];

            const result = calculatePhOutputAverage24h(logEntries);

            // Only processes entry with PhYout: 4.5
            expect(result).toBe(4.5);
        });

        it('ignores non-numeric PhYout values', () => {
            const logEntries = [
                { PhYout: 6.0 },
                { PhYout: 'invalid' }, // Non-numeric, should be ignored
                { PhYout: 8.0 }
            ];

            const result = calculatePhOutputAverage24h(logEntries);

            // Only processes numeric values: (6.0 + 8.0) / 2 = 7.0
            expect(result).toBe(7.0);
        });

        it('handles zero values correctly', () => {
            const logEntries = [
                { PhYout: 0.0 },
                { PhYout: 10.0 },
                { PhYout: 0.0 }
            ];

            const result = calculatePhOutputAverage24h(logEntries);

            // Average: (0.0 + 10.0 + 0.0) / 3 = 3.33... -> rounds to 3.3
            expect(result).toBe(3.3);
        });

        it('handles high precision values', () => {
            const logEntries = [
                { PhYout: 6.789123 },
                { PhYout: 7.210876 }
            ];

            const result = calculatePhOutputAverage24h(logEntries);

            // Average: (6.789123 + 7.210876) / 2 = 7.0 (rounded to 1 decimal)
            expect(result).toBe(7.0);
        });

        it('processes all entries regardless of other fields', () => {
            const logEntries = [
                { Time: '1/1/2024 12:00:00', PhYout: 4.5, ClYout: 8.2, PhValue: 7.2 },
                { Time: '1/1/2024 12:10:00', PhYout: 6.5, HeaterOnSeconds: 300 }
            ];

            const result = calculatePhOutputAverage24h(logEntries);

            // (4.5 + 6.5) / 2 = 5.5
            expect(result).toBe(5.5);
        });
    });
});
