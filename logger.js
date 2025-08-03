const { Registers } = require('./bs-client');

class Logger {
    // Data reduction constants
    static REDUCTION_THRESHOLD_DAYS = 14;
    static REDUCTION_BUCKET_HOURS = 2;
    static SUMMED_FIELDS = ['SuccessCount', 'TimeoutCount', 'HeaterOnSeconds', 'PentairSeconds', 'serviceUptimeSeconds'];

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
        out += ',serviceUptimeSeconds';
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

    getHistoricalCSV(startTime, endTime, bucketHours = null) {
        const filesToCheck = this.getLogFilesForTimeRange(startTime, endTime);
        const header = this.#generateCSVHeader();
        const dayRange = (endTime - startTime) / (1000 * 60 * 60 * 24);
        const bucketMs = bucketHours ? bucketHours * 60 * 60 * 1000 : null;

        const lines = [header];
        let currentBucket = null;
        let currentBucketStart = null;
        const headerFields = header.split(',');
        
        // Single file reading loop - shared between both modes
        for (const fileName of filesToCheck) {
            if (this.#fs.existsSync(fileName)) {
                try {
                    const content = this.#fs.readFileSync(fileName, 'utf8');
                    const fileLines = content.split('\n');
                    
                    // Get the actual file header (first line)
                    let fileHeaderFields = null;
                    if (fileLines.length > 0) {
                        fileHeaderFields = fileLines[0].split(',');
                    }
                    
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
                            if (bucketMs) {
                                const bucketStart = Math.floor(timestamp.getTime() / bucketMs) * bucketMs;
                                
                                // If we've moved to a new bucket, finalize the current one
                                if (currentBucket && bucketStart !== currentBucketStart) {
                                    lines.push(this.#bucketToCSVLine(currentBucket, headerFields));
                                    currentBucket = null;
                                }
                                
                                // Initialize or add to current bucket
                                if (!currentBucket) {
                                    currentBucket = {
                                        values: {},
                                        counts: {}
                                    };
                                    currentBucketStart = bucketStart;
                                }
                                
                                currentBucket.timestamp = timestamp;
                                this.#addLineToBucket(currentBucket, line, fileHeaderFields);
                            } else {
                                lines.push(line);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error reading log file ${fileName}:`, error);
                }
            }
        }
        
        // Don't forget the final bucket!
        if (currentBucket) {
            lines.push(this.#bucketToCSVLine(currentBucket, headerFields));
        }
        
        return lines.join('\n') + '\n';
    }

    #addLineToBucket(bucket, line, headerFields) {
        const values = line.split(',');
        
        // Aggregate each field (skip Time column at index 0)
        for (let j = 1; j < Math.min(values.length, headerFields.length); j++) {
            const fieldName = headerFields[j];
            const valueStr = values[j];
            
            // Skip empty values
            if (!valueStr || valueStr.trim() === '') {
                continue;
            }
            
            const value = parseFloat(valueStr);
            if (!isNaN(value)) {
                if (!bucket.values[fieldName]) {
                    bucket.values[fieldName] = 0;
                    bucket.counts[fieldName] = 0;
                }
                bucket.values[fieldName] += value;
                bucket.counts[fieldName]++;
            }
        }
    }

    #bucketToCSVLine(bucket, headerFields) {
        const values = [this.#formatTimestamp(bucket.timestamp)];
        
        for (let j = 1; j < headerFields.length; j++) {
            const fieldName = headerFields[j];
            
            if (bucket.values[fieldName] !== undefined && bucket.counts[fieldName] > 0) {
                if (Logger.SUMMED_FIELDS.includes(fieldName)) {
                    // Sum the values
                    values.push(bucket.values[fieldName].toFixed(0));
                } else {
                    // Average the values
                    const avg = bucket.values[fieldName] / bucket.counts[fieldName];
                    values.push(avg.toFixed(2));
                }
            } else {
                values.push(''); // Empty value when no data
            }
        }
        
        return values.join(',');
    }

    // Short timestamp format supported by Google sheets
    #formatTimestamp(date) {
        const zeroPad = (num) => String(num).padStart(2, '0');
        return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ` +
               `${date.getHours()}:${zeroPad(date.getMinutes())}:${zeroPad(date.getSeconds())}`;
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

    #writeLogEntry(now) {
        // Get Pentair data and compute logfile name
        const pentairData = this.#getPentairData();
        const logFileName = `static/log-${now.getFullYear()}-${now.getMonth() + 1}.csv`;

        // Calculate service uptime seconds since last log entry
        const serviceUptimeSeconds = Math.round((now - this.#lastLogEntry) / 1000);

        // If the log file doesn't exist yet, create it with an appropriate header
        let out = '';
        if (!this.#fs.existsSync(logFileName)) {
            out = this.#generateCSVHeader() + '\n';
        }

        // Write the new mean data to the log file
        out += this.#formatTimestamp(now);
        
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
        
        // Write service uptime seconds
        out += ',' + serviceUptimeSeconds;
        out += '\n';
        this.#fs.appendFileSync(logFileName, out);

        // Reset state after writing entry
        this.#lastLogEntry = now;
        this.#accumSamples = 0;
        this.#regAccum = {};
        this.#timeoutCount = 0;
    }

    flushPartialLogEntry() {
        // Only flush if we have accumulated data
        if (this.#accumSamples === 0) {
            return;
        }

        try {
            const now = this.#nowFn();
            this.#writeLogEntry(now);
        } catch (error) {
            console.error('Error flushing partial log entry:', error);
        }
    }

    async updateLog() {
        await this.#getBSData();

        // If it's been log_entry_minutes since the last log entry, write a new one
        const now = this.#nowFn();
        if (now - this.#lastLogEntry >= this.#settings.log_entry_minutes * 60 * 1000) {
            this.#writeLogEntry(now);
        }
    }
}

module.exports = Logger;
