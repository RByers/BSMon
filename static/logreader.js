// Client-side log reading and heater duty cycle calculation

/**
 * Fetch log data from the server
 * @param {number} days - Number of days of data to fetch (defaults to 1)
 * @returns {Promise<string>} CSV text data
 */
async function fetchLogs(days = 1) {
    const response = await fetch(`/api/logs?days=${days}`);
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
    return uptime;
}

/**
 * Calculate BS Sentinel uptime from log entries
 * @param {Array<Object>} logEntries - Parsed log entries
 * @returns {number|null} Uptime percentage (0-100) or null if no data
 */
function calculateBSUptime(logEntries) {
    if (!logEntries || logEntries.length === 0) {
        return null;
    }
    
    let totalSuccessCount = 0;
    let totalTimeoutCount = 0;
    
    for (const entry of logEntries) {
        if (entry.hasOwnProperty('SuccessCount') && entry.hasOwnProperty('TimeoutCount')) {
            totalSuccessCount += entry.SuccessCount || 0;
            totalTimeoutCount += entry.TimeoutCount || 0;
        }
    }
    
    const totalSamples = totalSuccessCount + totalTimeoutCount;
    
    // Avoid division by zero
    if (totalSamples === 0) {
        return null;
    }
    
    const uptime = (totalSuccessCount / totalSamples) * 100;
    return uptime;
}

/**
 * Calculate BSMon service uptime by comparing actual log entry count to expected count
 * @param {Array<Object>} logEntries - Parsed log entries
 * @param {number} logIntervalMinutes - Expected logging interval in minutes
 * @param {number} days - Number of days of data (defaults to 1)
 * @returns {number|null} Service uptime percentage or null if no data
 */
function calculateServiceUptime(logEntries, logIntervalMinutes, days = 1) {
    if (!logEntries || logEntries.length === 0 || !logIntervalMinutes) {
        return null;
    }
    
    // Expected entries = days * 24 hours * 60 minutes / interval
    const expectedEntries = Math.floor((days * 24 * 60) / logIntervalMinutes);
    const actualEntries = logEntries.length;
    
    if (expectedEntries <= 0) {
        return null;
    }
    
    // Remove clamp so values >100% are visible
    const uptime = (actualEntries / expectedEntries) * 100;
    return uptime;
}

/**
 * Calculate average chlorine output from log entries
 * @param {Array<Object>} logEntries - Parsed log entries
 * @returns {number|null} Average chlorine output percentage (0-100) or null if no data
 */
function calculateClOutputAverage(logEntries) {
    if (!logEntries || logEntries.length === 0) {
        return null;
    }
    
    let totalClOutput = 0;
    let validEntries = 0;
    
    for (const entry of logEntries) {
        if (entry.hasOwnProperty('ClYout') && typeof entry.ClYout === 'number') {
            totalClOutput += entry.ClYout;
            validEntries++;
        }
    }
    
    // Avoid division by zero
    if (validEntries === 0) {
        return null;
    }
    
    const average = totalClOutput / validEntries;
    return Math.round(average * 10) / 10; // Round to 1 decimal place
}

/**
 * Calculate average pH output from log entries
 * @param {Array<Object>} logEntries - Parsed log entries
 * @returns {number|null} Average pH output percentage (0-100) or null if no data
 */
function calculatePhOutputAverage(logEntries) {
    if (!logEntries || logEntries.length === 0) {
        return null;
    }
    
    let totalPhOutput = 0;
    let validEntries = 0;
    
    for (const entry of logEntries) {
        if (entry.hasOwnProperty('PhYout') && typeof entry.PhYout === 'number') {
            totalPhOutput += entry.PhYout;
            validEntries++;
        }
    }
    
    // Avoid division by zero
    if (validEntries === 0) {
        return null;
    }
    
    const average = totalPhOutput / validEntries;
    return Math.round(average * 10) / 10; // Round to 1 decimal place
}

/**
 * Calculate min/max ORP values from log entries
 * @param {Array<Object>} logEntries - Parsed log entries
 * @returns {{min: number|null, max: number|null}} Min and max ORP values or null if no data
 */
function calculateORPMinMax(logEntries) {
    if (!logEntries || logEntries.length === 0) {
        return {min: null, max: null};
    }
    
    let minValue = null;
    let maxValue = null;
    
    for (const entry of logEntries) {
        if (entry.hasOwnProperty('ORPValue') && typeof entry.ORPValue === 'number') {
            const value = entry.ORPValue;
            if (minValue === null || value < minValue) {
                minValue = value;
            }
            if (maxValue === null || value > maxValue) {
                maxValue = value;
            }
        }
    }
    
    return {min: minValue, max: maxValue};
}

/**
 * Calculate min/max Temperature values from log entries
 * @param {Array<Object>} logEntries - Parsed log entries
 * @returns {{min: number|null, max: number|null}} Min and max Temperature values or null if no data
 */
function calculateTempMinMax(logEntries) {
    if (!logEntries || logEntries.length === 0) {
        return {min: null, max: null};
    }
    
    let minValue = null;
    let maxValue = null;
    
    for (const entry of logEntries) {
        if (entry.hasOwnProperty('TempValue') && typeof entry.TempValue === 'number') {
            const value = entry.TempValue;
            if (minValue === null || value < minValue) {
                minValue = value;
            }
            if (maxValue === null || value > maxValue) {
                maxValue = value;
            }
        }
    }
    
    return {min: minValue, max: maxValue};
}

/**
 * Get the timestamp of the last log entry
 * @param {Array<Object>} logEntries - Parsed log entries
 * @returns {Date|null} Last log timestamp or null if no data
 */
function getLastLogTimestamp(logEntries) {
    if (!logEntries || logEntries.length === 0) {
        return null;
    }
    
    const lastEntry = logEntries[logEntries.length - 1];
    if (!lastEntry.Time) {
        return null;
    }
    
    const timestamp = new Date(lastEntry.Time);
    return isNaN(timestamp.getTime()) ? null : timestamp;
}

/**
 * Calculate time elapsed since last log entry
 * Uses server time to avoid timezone and clock synchronization issues
 * @param {Array<Object>} logEntries - Parsed log entries
 * @param {number} logIntervalMinutes - Expected logging interval in minutes
 * @param {Date} serverTime - Current server time (optional, defaults to client time)
 * @returns {{timeAgo: string, isStale: boolean}} Formatted time string and stale flag
 */
function calculateTimeSinceLastLog(logEntries, logIntervalMinutes, serverTime) {
    const lastTimestamp = getLastLogTimestamp(logEntries);
    
    if (!lastTimestamp) {
        return { timeAgo: 'No data', isStale: true };
    }
    
    const elapsedMs = serverTime - lastTimestamp;
    const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
    
    let timeAgo;
    if (elapsedMinutes < 60) {
        timeAgo = `${elapsedMinutes}m ago`;
    } else {
        timeAgo = `${Math.round(elapsedMinutes / 60)}h ago`;
    }
    
    // Consider stale if more than 5% over the logging interval
    const staleThresholdMinutes = logIntervalMinutes ? logIntervalMinutes * 1.05 : 10.5; // default 10.5 min (5% over 10min)
    const isStale = elapsedMinutes > staleThresholdMinutes;
    
    return { timeAgo, isStale };
}

/**
 * Fetch and calculate heater duty cycle, Pentair uptime, BS uptime, service uptime, output averages, min/max values, and last log info from shared log data
 * @param {number} logIntervalMinutes - Expected logging interval in minutes (for service uptime calculation)
 * @param {Date} serverTime - Current server time (optional, for accurate last log calculations)
 * @param {number} days - Number of days of data to fetch (defaults to 1)
 * @returns {Promise<{dutyCycle: number|null, uptime: number|null, bsUptime: number|null, serviceUptime: number|null, clOutputAvg: number|null, phOutputAvg: number|null, orpMinMax: {min: number|null, max: number|null}, tempMinMax: {min: number|null, max: number|null}, lastLog: {timeAgo: string, isStale: boolean}}>} All calculations or null if error
 */
async function getLogMetrics(logIntervalMinutes = null, serverTime = null, days = 1) {
    try {
        const csvData = await fetchLogs(days);
        const logEntries = parseCSV(csvData);
        return {
            dutyCycle: calculateHeaterDutyCycle(logEntries),
            uptime: calculatePentairUptime(logEntries),
            bsUptime: calculateBSUptime(logEntries),
            serviceUptime: logIntervalMinutes ? calculateServiceUptime(logEntries, logIntervalMinutes, days) : null,
            clOutputAvg: calculateClOutputAverage(logEntries),
            phOutputAvg: calculatePhOutputAverage(logEntries),
            orpMinMax: calculateORPMinMax(logEntries),
            tempMinMax: calculateTempMinMax(logEntries),
            lastLog: calculateTimeSinceLastLog(logEntries, logIntervalMinutes, serverTime)
        };
    } catch (error) {
        console.error('Error getting heater and uptime metrics:', error);
        return {
            dutyCycle: null,
            uptime: null,
            bsUptime: null,
            serviceUptime: null,
            clOutputAvg: null,
            phOutputAvg: null,
            orpMinMax: {min: null, max: null},
            tempMinMax: {min: null, max: null},
            lastLog: { timeAgo: 'Error', isStale: true }
        };
    }
}


// Export functions for testing (if in Node.js environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fetchLogs,
        parseCSV,
        calculateHeaterDutyCycle,
        calculatePentairUptime,
        calculateBSUptime,
        calculateServiceUptime,
        calculateClOutputAverage,
        calculatePhOutputAverage,
        calculateORPMinMax,
        calculateTempMinMax,
        getLastLogTimestamp,
        calculateTimeSinceLastLog,
        getLogMetrics
    };
}
