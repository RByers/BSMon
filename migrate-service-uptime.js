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
    const originalColumnCount = headerFields.length;
    
    // Check if serviceUptimeSeconds column already exists
    if (headerFields.includes('serviceUptimeSeconds')) {
        console.log(`  File already has serviceUptimeSeconds column, skipping.`);
        return false;
    }
    
    console.log(`  Adding serviceUptimeSeconds column (original header has ${originalColumnCount} columns)...`);
    
    // Update header
    const newHeader = header + ',serviceUptimeSeconds';
    const updatedLines = [newHeader];
    
    let paddedRowCount = 0;
    
    // Update data rows
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') {
            // Preserve empty lines
            updatedLines.push('');
            continue;
        }
        
        // Count columns in this data row
        const rowFields = line.split(',');
        const rowColumnCount = rowFields.length;
        
        let paddedLine = line;
        
        // If this row has fewer columns than the original header, pad with empty columns
        if (rowColumnCount < originalColumnCount) {
            const missingColumns = originalColumnCount - rowColumnCount;
            const padding = ','.repeat(missingColumns);
            paddedLine = line + padding;
            paddedRowCount++;
        }
        
        // Add serviceUptimeSeconds value to the padded row
        const newLine = paddedLine + ',' + SERVICE_UPTIME_SECONDS;
        updatedLines.push(newLine);
    }
    
    // Write back to file
    const newContent = updatedLines.join('\n');
    fs.writeFileSync(filePath, newContent, 'utf8');
    
    const dataRowCount = lines.length - 1;
    console.log(`  Successfully updated ${dataRowCount} data rows.`);
    if (paddedRowCount > 0) {
        console.log(`  Padded ${paddedRowCount} rows that had fewer than ${originalColumnCount} columns.`);
    }
    return true;
}

function showUsage() {
    console.log('BSMon Log File Migration Script');
    console.log('Usage: node migrate-service-uptime.js <file1> [file2] [file3] ...');
    console.log('');
    console.log('Examples:');
    console.log('  node migrate-service-uptime.js static/log-2025-7.csv');
    console.log('  node migrate-service-uptime.js static/log-2025-7.csv static/log-2025-8.csv');
    console.log('');
    console.log('This script adds the serviceUptimeSeconds column to existing log files.');
}

function main() {
    // Get command line arguments (skip node and script name)
    const filePaths = process.argv.slice(2);
    
    if (filePaths.length === 0) {
        showUsage();
        process.exit(1);
    }
    
    console.log('BSMon Log File Migration Script');
    console.log('Adding serviceUptimeSeconds column to specified log files...\n');
    
    console.log(`Processing ${filePaths.length} file(s):`);
    filePaths.forEach(file => console.log(`  ${file}`));
    console.log('');
    
    let migratedCount = 0;
    
    for (const logFile of filePaths) {
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

module.exports = { migrateLogFile };
