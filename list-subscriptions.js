const fs = require('fs');
const path = require('path');

const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');

if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
    console.log('No subscriptions found (subscriptions.json does not exist).');
    process.exit(0);
}

try {
    const subsJson = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
    const subscriptions = JSON.parse(subsJson);
    const subList = Object.values(subscriptions);
    
    if (subList.length === 0) {
        console.log('No active subscriptions.');
        process.exit(0);
    }

    // Sort by lastSeen descending (most recent first)
    // Allow script to fail if lastSeen is missing
    const sortedSubs = subList
        .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

    console.log(`Found ${subList.length} subscriptions:\n`);
    console.log(String('IP Address').padEnd(20) + 'Last Seen');
    console.log('-'.repeat(45));

    for (const sub of sortedSubs) {
        const ip = sub.lastIP || 'Unknown IP';
        const lastSeen = new Date(sub.lastSeen).toLocaleString();
        console.log(`${String(ip).padEnd(20)}${lastSeen}`);
    }
} catch (err) {
    console.error('Error reading subscriptions:', err.message);
}
