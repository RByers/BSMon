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
 * Main function to get heater duty cycle for last 24 hours
 * @returns {Promise<number|null>} Duty cycle percentage or null if unavailable
 */
async function getHeaterDutyCycle24Hours() {
    try {
        const csvData = await fetchLast24HoursLogs();
        const logEntries = parseCSV(csvData);
        return calculateHeaterDutyCycle(logEntries);
    } catch (error) {
        console.error('Error getting heater duty cycle:', error);
        return null;
    }
}

// Export functions for testing (if in Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fetchLast24HoursLogs,
        parseCSV,
        calculateHeaterDutyCycle,
        getHeaterDutyCycle24Hours
    };
}
