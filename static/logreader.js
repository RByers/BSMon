// Client-side log reading and heater duty cycle calculation

/**
 * Fetch last 24 hours of log data from the server
 * @returns {Promise<string>} CSV text data
 */
async function fetchLast24HoursLogs() {
    const response = await fetch('/api/logs/24h');
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.text();
}

/**
 * Parse CSV text into array of objects
 * @param {string} csvText - Raw CSV data
 * @returns {Array<Object>} Array of log entry objects
 */
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) {
        return []; // No data (just header or empty)
    }
    
    const headers = lines[0].split(',');
    const entries = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue; // Skip empty lines
        
        const values = line.split(',');
        // Support the case of new columns being added during the day (during development)
        if (values.length > headers.length) {
            console.warn(`Malformed CSV line ${i}: ${line}, found ${values.length} columns, but only headers for ${headers.length}`);
            continue;
        }
        
        const entry = {};
        for (let j = 0; j < values.length; j++) {
            const header = headers[j];
            const value = values[j];
            
            // Parse numeric values, keep Time as string
            if (header === 'Time') {
                entry[header] = value;
            } else {
                const numValue = parseFloat(value);
                entry[header] = isNaN(numValue) ? 0 : numValue;
            }
        }
        entries.push(entry);
    }
    
    return entries;
}

/**
 * Calculate heater duty cycle from log entries
 * @param {Array<Object>} logEntries - Parsed log entries
 * @returns {number|null} Duty cycle percentage (0-100) or null if no data
 */
function calculateHeaterDutyCycle(logEntries) {
    if (!logEntries || logEntries.length === 0) {
        return null;
    }
    
    let totalHeaterOnSeconds = 0;
    let totalPentairSeconds = 0;
    
    for (const entry of logEntries) {
        if (entry.hasOwnProperty('HeaterOnSeconds') && entry.hasOwnProperty('PentairSeconds')) {
            totalHeaterOnSeconds += entry.HeaterOnSeconds || 0;
            totalPentairSeconds += entry.PentairSeconds || 0;
        }
    }
    
    // Avoid division by zero
    if (totalPentairSeconds === 0) {
        return null;
    }
    
    const dutyCycle = (totalHeaterOnSeconds / totalPentairSeconds) * 100;
    return Math.round(dutyCycle); // Round to whole number
}

/**
 * Calculate Pentair uptime from log entries
 * @param {Array<Object>} logEntries - Parsed log entries
 * @returns {number|null} Uptime percentage (0-100) or null if no data
 */
function calculatePentairUptime(logEntries) {
    if (!logEntries || logEntries.length === 0) {
        return null;
    }
    
    // Need at least 2 entries to calculate time span
    if (logEntries.length < 2) {
        return null;
    }
    
    let totalPentairSeconds = 0;
    
    // Sum PentairSeconds from entries 2 through N (skip first entry)
    // The first entry's PentairSeconds represents an unknown time span
    // Entry i represents the interval from timestamp i-1 to timestamp i
    for (let i = 1; i < logEntries.length; i++) {
        const entry = logEntries[i];
        if (entry.hasOwnProperty('PentairSeconds')) {
            totalPentairSeconds += entry.PentairSeconds || 0;
        }
    }
    
    // Calculate total time span from first to last timestamp
    const firstEntry = logEntries[0];
    const lastEntry = logEntries[logEntries.length - 1];
    
    if (!firstEntry.Time || !lastEntry.Time) {
        return null;
    }
    
    const firstTimestamp = new Date(firstEntry.Time);
    const lastTimestamp = new Date(lastEntry.Time);
    
    if (isNaN(firstTimestamp.getTime()) || isNaN(lastTimestamp.getTime())) {
        return null;
    }
    
    const totalTimeSpanSeconds = (lastTimestamp - firstTimestamp) / 1000;
    
    // Avoid division by zero
    if (totalTimeSpanSeconds <= 0) {
        return null;
    }
    
    const uptime = (totalPentairSeconds / totalTimeSpanSeconds) * 100;
    return Math.round(uptime); // Round to whole number
}

/**
 * Fetch and calculate both heater duty cycle and Pentair uptime from shared log data
 * @returns {Promise<{dutyCycle: number|null, uptime: number|null}>} Both calculations or null if error
 */
async function getLogMetrics24Hours() {
    try {
        const csvData = await fetchLast24HoursLogs();
        const logEntries = parseCSV(csvData);
        return {
            dutyCycle: calculateHeaterDutyCycle(logEntries),
            uptime: calculatePentairUptime(logEntries)
        };
    } catch (error) {
        console.error('Error getting heater and uptime metrics:', error);
        return {
            dutyCycle: null,
            uptime: null
        };
    }
}


// Export functions for testing (if in Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fetchLast24HoursLogs,
        parseCSV,
        calculateHeaterDutyCycle,
        calculatePentairUptime,
        getLogMetrics24Hours
    };
}
