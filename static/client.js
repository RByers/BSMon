function $(id) {
    return document.getElementById(id);
}

let swRegistration = null;
let subscription = null;

const checkids = ["n-clyout", "n-acidyout", "n-temp"];
const textids = ["clyout-max", "acidyout-max", "temp-min"];

async function updateServerSubscription(subscribed) {
    const endpoint = subscribed ? '/subscribe' : '/unsubscribe';

    subset = {};
    for (let i = 0; i < checkids.length; i++) {
        let check = $(checkids[i]);
        let text = $(textids[i]);
        if (check.checked)
            subset[text.id] = parseFloat(text.value);
    }

    const body = JSON.stringify({
        subscription: subscription,
        settings: subset});
    const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: body
    });
    let status;
    if (resp.status !== 200) {
        status = `Subscription update failed: ${resp.status} ${resp.statusText}`;
    } else {
        status = await resp.text();
    }
    $('substat').textContent = status;
}

async function subscribe() {
    const vkresp = await fetch('/vapid_public_key.txt');
    const vapidKey = (await vkresp.text()).trim();
    subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey
    });
    await updateServerSubscription(true);
    console.log('User is subscribed:', subscription.toJSON());
}

async function unsubscribe() {
    if (subscription) {
        await updateServerSubscription(false);
        await subscription.unsubscribe();
        subscription = null;
        console.log('User is unsubscribed');
    }
}

async function initNotifyButtion() {
    const nb = $('notify');
    if (!('Notification' in window)) {
        nb.textContent = 'No Notification Support';
        return;
    }
    if (!swRegistration) {
        nb.textContent = 'No Service Worker';
        return;
    }

    if (Notification.permission === 'default') {
        nb.textContent = 'Enable Notification Permission';
        nb.onclick = function() {
            console.log("Requesting notification permission");
            Notification.requestPermission().then(() => {
                initNotifyButtion();
            });
        }
        nb.disabled = false; 
    }

    if (Notification.permission === 'granted') {
        subscription = await swRegistration.pushManager.getSubscription();
        if (!subscription) {
            nb.textContent = 'Subscribe to Notifications';
            nb.onclick = function() {
                subscribe().then(() => {
                    initNotifyButtion();
                });
            };
            nb.disabled = false;
        } else {
            nb.textContent = 'Unsubscribe from Notifications';
            nb.onclick = function() {
                unsubscribe().then(() => {
                    initNotifyButtion();
                });
            };
            nb.disabled = false;
        }
    }
}

let debounceTimeout = null;
function saveDebounce() {
    if (debounceTimeout) {
        clearTimeout(debounceTimeout);
    }
    debounceTimeout = setTimeout(() => {
        for (let i = 0; i < checkids.length; i++) {
            let check = $(checkids[i]);
            localStorage.setItem(check.id, check.checked);
            let text = $(textids[i]);
            localStorage.setItem(text.id, text.value);
            if (check.checked)
                subset[text.id] = text.value;
        }
        if (subscription)
            updateServerSubscription(true).then(() => {});
    }, 1000);
}

// Update UI with status data
function updateUI(data) {
    // Update Chlorine card
    if (data.chlorine) {
        $('cl-value').textContent = `${data.chlorine.value.toFixed(2)} ${data.chlorine.unit}`;
        $('cl-setpoint').textContent = `${data.chlorine.setpoint.toFixed(1)} ${data.chlorine.unit}`;
        $('cl-output').textContent = `${data.chlorine.output.toFixed(1)}%`;
    }
    
    // Update pH card
    if (data.ph) {
        $('ph-value').textContent = `${data.ph.value.toFixed(2)} ${data.ph.unit}`;
        $('ph-setpoint').textContent = `${data.ph.setpoint.toFixed(1)} ${data.ph.unit}`;
        $('ph-output').textContent = `${data.ph.output.toFixed(1)}%`;
    }
    
    // Update ORP card
    if (data.orp) {
        $('orp-value').textContent = `${data.orp.value.toFixed(0)} ${data.orp.unit}`;
    }
    
    // Update Temperature card
    if (data.temperature) {
        $('temp-value').textContent = `${data.temperature.value.toFixed(1)} ${data.temperature.unit}`;
    }

    // Update Heater card
    if (data.hasOwnProperty('dutyCycle')) {
        $('heater-status').textContent = data.heaterOn ? 'On' : 'Off';
        $('heater-duty-cycle').textContent = `${(data.dutyCycle * 100).toFixed(1)}%`;
        $('heater-timeframe').textContent = data.dutyCycleTimeframe;
        if (data.setpoint) {
            $('heater-setpoint').textContent = `${data.setpoint}°F`;
        }
    }
    
    // Update Page Title with System Name
    if (data.system && data.system.name) {
        $('page-title').textContent = `BSMon: ${data.system.name}`;
        $('page-title-tag').textContent = `BSMon: ${data.system.name}`;
    }
    
    // Update Alarms
    if (data.alarmMessages) {
        const alarmsCard = $('alarms-card');
        let alarmHtml = '';        
        
        if (data.alarmMessages.messages && data.alarmMessages.messages.length > 0) {
            // Create formatters for date and time
            const dateFormatter = new Intl.DateTimeFormat('en-US', {
                month: '2-digit',
                day: '2-digit'
            });
            
            const timeFormatter = new Intl.DateTimeFormat('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            
            data.alarmMessages.messages.forEach(alarm => {
                // Parse the ISO date string
                const date = new Date(alarm.rdate);
                
                // Format the date and time
                const formattedDate = dateFormatter.format(date);
                const formattedTime = timeFormatter.format(date);
                
                // Combine them in the desired format
                const formattedDateTime = `${formattedDate} ${formattedTime}`;
                
                alarmHtml += `<div>${alarm.sourceTxt}: ${alarm.msgTxt} [${formattedDateTime}]</div>`;
            });
            
            // Show alarms card and apply active styling
            alarmsCard.classList.remove('hidden');
            alarmsCard.classList.add('alarm-active');
        } else {
            // Hide alarms card when no alarms
            alarmsCard.classList.add('hidden');
            alarmsCard.classList.remove('alarm-active');
        }
        
        $('alarm-messages').innerHTML = alarmHtml;
    }
}

async function fetchStatus() {
    try {
        const response = await fetch('/api/status');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        updateUI(data);
        return data;
    } catch (error) {
        console.error('Error fetching status:', error);
        $('system-name').textContent = `Error: ${error.message}`;
        return null;
    }
}

// Fetch raw status text
async function fetchRawStatus() {
    try {
        const response = await fetch('/status.txt');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const text = await response.text();
        return text;
    } catch (error) {
        console.error('Error fetching raw status:', error);
        return `Error fetching raw status: ${error.message}`;
    }
}

// Handle raw data modal
function setupRawDataModal() {
    const viewRawDataBtn = $('view-raw-data');
    const closeRawDataBtn = $('close-raw-data');
    const modal = $('raw-data-modal');
    const rawStatus = $('raw-status');
    
    viewRawDataBtn.onclick = async function() {
        modal.classList.remove('hidden');
        rawStatus.textContent = 'Loading...';
        const text = await fetchRawStatus();
        rawStatus.textContent = text;
    };
    
    closeRawDataBtn.onclick = function() {
        modal.classList.add('hidden');
    };
    
    // Close modal when clicking outside of it
    window.onclick = function(event) {
        if (event.target === modal) {
            modal.classList.add('hidden');
        }
    };
}

async function init() {
    // Show loading state
    $('cl-value').textContent = "Loading...";
    $('ph-value').textContent = "Loading...";
    $('orp-value').textContent = "Loading...";
    $('temp-value').textContent = "Loading...";
    
    // Fetch initial status
    await fetchStatus();
    
    // Setup raw data modal
    setupRawDataModal();

    // Initialize service worker and notification settings
    if ('serviceWorker' in navigator) {
        swRegistration = await navigator.serviceWorker.register('sw.js');
        console.log('Service Worker is registered', swRegistration);
        await initNotifyButtion();

        for (let i = 0; i < checkids.length; i++) {
            let check = $(checkids[i]);
            check.checked = localStorage.getItem(check.id) == "true";
            let text = $(textids[i]);
            val = localStorage.getItem(text.id);
            if (val)
                text.value = val;
            check.onchange = function() {
                text.disabled = !check.checked;
                saveDebounce();
            }
            text.disabled = !check.checked;
            text.onchange = saveDebounce;
        }

        // Make sure the server still knows about our subscription.
        if (subscription)
            await updateServerSubscription(true);
    }
    
    // Set up auto-refresh every 30 seconds
    setInterval(fetchStatus, 30000);
}

window.onload = () => { init(); }
