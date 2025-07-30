const { Registers } = require('./bs-client');

class Logger {
    #fs;
    #settings;
    #nowFn;
    #regAccum = {};
    #accumSamples = 0;
    #lastLogEntry;
    #registersToLog = [
        'ClValue', 'PhValue', 'ORPValue', 'TempValue', 'ClSet', 'PhSet', 'ClYout', 'PhYout'
    ];
    #pentairFieldsToLog = [
        'HeaterOnSeconds', 'setpoint', 'waterTemp', 'PentairSeconds'
    ];
    #timeoutCount = 0;
    #lastHeaterOnTime = 0;
    #lastConnectionTime = 0;
    #bsClient;
    #pentairClient;

    constructor({ bsClient, pentairClient, fs = require('fs'), settings = require('./settings.json'), nowFn = () => new Date() } = {}) {
        this.#bsClient = bsClient;
        this.#pentairClient = pentairClient;
        this.#fs = fs;
        this.#settings = settings;
        this.#nowFn = nowFn;
        this.#lastLogEntry = this.#nowFn();
    }

    #generateCSVHeader() {
        let out = 'Time';
        for (let r of this.#registersToLog) {
            out += ',' + r;
        }
        out += ',SuccessCount,TimeoutCount';
        for (let r of this.#pentairFieldsToLog) {
            out += ',' + r;
        }
        return out;
    }

    getLogFilesForTimeRange(startTime, endTime) {
        const currentMonth = endTime.getMonth() + 1;
        const currentYear = endTime.getFullYear();
        const previousMonth = startTime.getMonth() + 1;
        const previousYear = startTime.getFullYear();
        
        const filesToCheck = [];
        
        // Add files in chronological order to preserve sort
        if (previousYear !== currentYear || previousMonth !== currentMonth) {
            filesToCheck.push(`static/log-${previousYear}-${previousMonth}.csv`);
        }
        filesToCheck.push(`static/log-${currentYear}-${currentMonth}.csv`);
        
        return filesToCheck;
    }

    getLogFileMetadata(files) {
        return files.map(fileName => {
            try {
                if (this.#fs.existsSync(fileName)) {
                    const stats = this.#fs.statSync(fileName);
                    return {
                        path: fileName,
                        exists: true,
                        mtime: stats.mtime.getTime(),
                        size: stats.size
                    };
                }
            } catch (error) {
                console.error(`Error getting stats for ${fileName}:`, error);
            }
            return {
                path: fileName,
                exists: false,
                mtime: 0,
                size: 0
            };
        });
    }

    getLogFilesETag(startTime, endTime) {
        const files = this.getLogFilesForTimeRange(startTime, endTime);
        const metadata = this.getLogFileMetadata(files);
        
        // Create ETag from file metadata - includes modification times and sizes
        const etag = metadata
            .filter(meta => meta.exists)
            .map(meta => `${meta.mtime}-${meta.size}`)
            .join('|');
        
        return etag ? `"${etag}"` : '"empty"';
    }

    getHistoricalCSV(startTime, endTime) {
        const filesToCheck = this.getLogFilesForTimeRange(startTime, endTime);
        
        const header = this.#generateCSVHeader();
        const lines = [header];
        
        for (const fileName of filesToCheck) {
            if (this.#fs.existsSync(fileName)) {
                try {
                    const content = this.#fs.readFileSync(fileName, 'utf8');
                    const fileLines = content.split('\n');
                    
                    for (let i = 1; i < fileLines.length; i++) { // Skip header (line 0)
                        const line = fileLines[i].trim();
                        if (!line) continue; // Skip empty lines
                        
                        // Parse timestamp from first column
                        const firstComma = line.indexOf(',');
                        if (firstComma === -1) continue; // Invalid line
                        
                        const timestampStr = line.substring(0, firstComma);
                        const timestamp = new Date(timestampStr);
                        
                        // Check if timestamp is within time range
                        if (timestamp >= startTime && timestamp <= endTime) {
                            lines.push(line);
                        }
                    }
                } catch (error) {
                    console.error(`Error reading log file ${fileName}:`, error);
                }
            }
        }
        
        return lines.join('\n') + '\n';
    }

    getLast24HoursCSV(nowFn = () => new Date()) {
        const now = nowFn();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        return this.getHistoricalCSV(twentyFourHoursAgo, now);
    }

    incrementTimeoutCount() {
        this.#timeoutCount++;
    }

    async #getBSData() {
        if (!this.#bsClient.getConnected()) {
            return null;
        }

        let regValues = {};
        for (let r of this.#registersToLog) {
            let val = await this.#bsClient.readRegister(Registers[r]);
            if (typeof val != 'number' || isNaN(val)) {
                console.error(`Invalid value for ${r}: ${val} (type: ${typeof val})`);
                throw new Error(`Invalid value for ${r}: ${val}`);
            }
            regValues[r] = val;
        }
        // Update accumulated values for computing a mean
        for (let r of this.#registersToLog) {
            if (!(r in this.#regAccum))
                this.#regAccum[r] = 0;
            this.#regAccum[r] += regValues[r];
        }
        this.#accumSamples++;
        return regValues;
    }

    #getPentairData() {
        if (this.#pentairClient && this.#pentairClient.isConnected()) {
            const currentTotal = this.#pentairClient.getCurrentTotalHeaterOnTime();
            const currentConnectionTotal = this.#pentairClient.getCurrentTotalConnectionTime();
            
            const pentairValues = {
                'HeaterOnSeconds': currentTotal - this.#lastHeaterOnTime,
                'PentairSeconds': currentConnectionTotal - this.#lastConnectionTime,
                'setpoint': this.#pentairClient.setpoint,
                'waterTemp': this.#pentairClient.waterTemp
            };
            
            this.#lastHeaterOnTime = currentTotal;
            this.#lastConnectionTime = currentConnectionTotal;
            
            return pentairValues;
        } else {
            return null;
        }
    }

    async updateLog() {
        await this.#getBSData();

        // If it's been log_entry_minutes since the last log entry, write a new one
       const now = this.#nowFn();
        if (now - this.#lastLogEntry >= this.#settings.log_entry_minutes * 60 * 1000) {
            // Compute a logfile name for the month and year
            const logFileName = `static/log-${now.getFullYear()}-${now.getMonth() + 1}.csv`;
            const pentairData = this.#getPentairData();

            // If the log file doesn't exist yet, create it with an appropriate header
            let out = '';
            if (!this.#fs.existsSync(logFileName)) {
                out = this.#generateCSVHeader() + '\n';
            }

            // Write the new mean data to the log file
            // Use a date format easily parsed by Google Sheets
            const zeroPad = (num) => String(num).padStart(2, '0')
            out += `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ` +
                `${now.getHours()}:${zeroPad(now.getMinutes())}:${zeroPad(now.getSeconds())}`;
            
            // Write BS register values - use averages if we have samples, empty strings if not
            for (let r of this.#registersToLog) {
                if (this.#accumSamples > 0) {
                    out += ',' + (this.#regAccum[r] / this.#accumSamples).toFixed(Registers[r].round || 0);
                } else {
                    out += ',';  // Empty value
                }
            }
            out += `,${this.#accumSamples},${this.#timeoutCount}`;
            
            // Write Pentair values - use empty strings for numeric values when offline
            for (let r of this.#pentairFieldsToLog) {
                if (pentairData === null) {
                    out += ',';  // Empty value when device offline
                } else {
                    let val = pentairData[r];
                    if (val === null) {
                        out += ',';
                    } else {
                        if (typeof val === 'string') {
                            val = parseFloat(val);
                        }
                        out += ',' + val.toFixed(0);
                    }
                }
            }
            out += '\n';
            this.#fs.appendFileSync(logFileName, out);

            // Reset state for next log entry
            this.#lastLogEntry = now;
            this.#accumSamples = 0;
            this.#regAccum = {};
            this.#timeoutCount = 0;
        }
    }
}

module.exports = Logger;
