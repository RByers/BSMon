#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Script to migrate existing log files to add serviceUptimeSeconds column
 * Sets serviceUptimeSeconds to 900 (15 minutes) for all existing entries
 */

const SERVICE_UPTIME_SECONDS = 900; // 15 minutes

function migrateLogFile(filePath) {
    console.log(`Processing ${filePath}...`);
    
    if (!fs.existsSync(filePath)) {
        console.log(`  File does not exist, skipping.`);
        return false;
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    if (lines.length < 1) {
        console.log(`  File is empty, skipping.`);
        return false;
    }
    
    const header = lines[0];
    const headerFields = header.split(',');
    
    // Check if serviceUptimeSeconds column already exists
    if (headerFields.includes('serviceUptimeSeconds')) {
        console.log(`  File already has serviceUptimeSeconds column, skipping.`);
        return false;
    }
    
    console.log(`  Adding serviceUptimeSeconds column...`);
    
    // Update header
    const newHeader = header + ',serviceUptimeSeconds';
    const updatedLines = [newHeader];
    
    // Update data rows
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') {
            // Preserve empty lines
            updatedLines.push('');
            continue;
        }
        
        // Add serviceUptimeSeconds value to each data row
        const newLine = line + ',' + SERVICE_UPTIME_SECONDS;
        updatedLines.push(newLine);
    }
    
    // Write back to file
    const newContent = updatedLines.join('\n');
    fs.writeFileSync(filePath, newContent, 'utf8');
    
    console.log(`  Successfully updated ${lines.length - 1} data rows.`);
    return true;
}

function findLogFiles() {
    const staticDir = './static';
    if (!fs.existsSync(staticDir)) {
        console.error('Static directory not found. Please run this script from the BSMon root directory.');
        process.exit(1);
    }
    
    const files = fs.readdirSync(staticDir);
    const logFiles = files
        .filter(file => file.startsWith('log-') && file.endsWith('.csv'))
        .map(file => path.join(staticDir, file));
    
    return logFiles;
}

function main() {
    console.log('BSMon Log File Migration Script');
    console.log('Adding serviceUptimeSeconds column to existing log files...\n');
    
    const logFiles = findLogFiles();
    
    if (logFiles.length === 0) {
        console.log('No log files found in ./static directory.');
        return;
    }
    
    console.log(`Found ${logFiles.length} log file(s):`);
    logFiles.forEach(file => console.log(`  ${file}`));
    console.log('');
    
    let migratedCount = 0;
    
    for (const logFile of logFiles) {
        try {
            if (migrateLogFile(logFile)) {
                migratedCount++;
            }
        } catch (error) {
            console.error(`  Error processing ${logFile}:`, error.message);
        }
    }
    
    console.log(`\nMigration complete. Updated ${migratedCount} file(s).`);
    
    if (migratedCount > 0) {
        console.log('\nNote: serviceUptimeSeconds was set to 900 (15 minutes) for all existing entries.');
        console.log('This represents an estimate since actual service uptime data was not tracked previously.');
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { migrateLogFile, findLogFiles };
