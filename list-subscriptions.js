const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');

async function main() {
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
        console.log(String('Last Seen').padEnd(25) + String('IP Address').padEnd(20) + 'Hostname');
        console.log('-'.repeat(65));

        for (const sub of sortedSubs) {
            let ip = sub.lastIP || 'Unknown IP';
            // Strip the IPv4-mapped IPv6 prefix if present
            if (ip.startsWith('::ffff:')) {
                ip = ip.substring(7);
            }
            
            const lastSeen = new Date(sub.lastSeen).toLocaleString();
            
            let hostname = '';
            if (ip !== 'Unknown IP') {
                try {
                    const hostnames = await dns.reverse(ip);
                    if (hostnames && hostnames.length > 0) {
                        hostname = hostnames[0];
                    }
                } catch (err) {
                    // Ignore resolution errors (e.g., ENOTFOUND) and leave hostname blank
                }
            }

            console.log(`${String(lastSeen).padEnd(25)}${String(ip).padEnd(20)}${hostname}`);
        }
    } catch (err) {
        console.error('Error reading subscriptions:', err.message);
    }
}

main();
