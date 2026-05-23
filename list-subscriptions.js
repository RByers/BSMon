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
    console.log(String('Last Seen').padEnd(25) + 'IP Address');
    console.log('-'.repeat(45));

    for (const sub of sortedSubs) {
        let ip = sub.lastIP || 'Unknown IP';
        // Strip the IPv4-mapped IPv6 prefix if present
        if (ip.startsWith('::ffff:')) {
            ip = ip.substring(7);
        }
        
        const lastSeen = new Date(sub.lastSeen).toLocaleString();
        console.log(`${String(lastSeen).padEnd(25)}${ip}`);
    }
} catch (err) {
    console.error('Error reading subscriptions:', err.message);
}
