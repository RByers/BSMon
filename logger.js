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

    incrementTimeoutCount() {
        this.#timeoutCount++;
    }

    async #getBSData() {
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
    }

    #getPentairData() {
        let pentairValues = {};
        if (this.#pentairClient) {
            const currentTotal = this.#pentairClient.getCurrentTotalHeaterOnTime();
            pentairValues['HeaterOnSeconds'] = currentTotal - this.#lastHeaterOnTime;
            this.#lastHeaterOnTime = currentTotal;
            
            const currentConnectionTotal = this.#pentairClient.getCurrentTotalConnectionTime();
            pentairValues['PentairSeconds'] = currentConnectionTotal - this.#lastConnectionTime;
            this.#lastConnectionTime = currentConnectionTotal;
            
            pentairValues['setpoint'] = this.#pentairClient.setpoint || 0;
            pentairValues['waterTemp'] = this.#pentairClient.waterTemp || 0;
        } else {
            pentairValues['HeaterOnSeconds'] = 0;
            pentairValues['setpoint'] = 0;
            pentairValues['waterTemp'] = 0;
            pentairValues['PentairSeconds'] = 0;
        }
        return pentairValues;
    }

    async updateLog() {
        await this.#getBSData();

        // If it's been log_entry_minutes since the last log entry, write a new one
       const now = this.#nowFn();
        if (now - this.#lastLogEntry >= this.#settings.log_entry_minutes * 60 * 1000) {
            if (this.#accumSamples === 0) {
                // All samples failed, so we can't write a log entry.
                this.#lastLogEntry = now;
                return;
            }
            // Compute a logfile name for the month and year
            const logFileName = `static/log-${now.getFullYear()}-${now.getMonth() + 1}.csv`;
            const pentairData = this.#getPentairData();

            // If the log file doesn't exist yet, create it with an appropriate header
            let out = '';
            if (!this.#fs.existsSync(logFileName)) {
                out = 'Time';
                for (let r of this.#registersToLog) {
                    out += ',' + r;
                }
                out += ',SuccessCount,TimeoutCount';
                for (let r of this.#pentairFieldsToLog) {
                    out += ',' + r;
                }
                out += '\n';
            }

            // Write the new mean data to the log file
            // Use a date format easily parsed by Google Sheets
            const zeroPad = (num) => String(num).padStart(2, '0')
            out += `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()} ` +
                `${now.getHours()}:${zeroPad(now.getMinutes())}:${zeroPad(now.getSeconds())}`;
            for (let r of this.#registersToLog) {
                out += ',' + (this.#regAccum[r] / this.#accumSamples).toFixed(Registers[r].round || 0);
            }
            out += `,${this.#accumSamples},${this.#timeoutCount}`;
            for (let r of this.#pentairFieldsToLog) {
                let val = pentairData[r] || 0;
                if (typeof val === 'string') {
                    val = parseFloat(val);
                }
                out += ',' + val.toFixed(0);
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
