function $(id) {
    return document.getElementById(id);
}

// Enable easy client-only testing without redeploying the server.
// This is especially useful for testing logic that depends on having full logs.
const urlParams = new URLSearchParams(window.location.search);
let serverURL = '/';
if (window.location.protocol === 'file:' && urlParams.has('serverHost')) {
    const serverHost = urlParams.get('serverHost');
    const protocol = serverHost.startsWith('localhost') ? 'http' : 'https';
    serverURL = `${protocol}://${serverHost}/`;
}

function formatDuration(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) {
        const minutes = Math.round(seconds / 60);
        return `${minutes}m`;
    } else {
        const hours = Math.round(seconds / 3600);
        return `${hours}h`;
    }
}

let swRegistration = null;
let subscription = null;
let currentTimePeriod = 1; // Default to 1 day

const checkids = ["n-clyout", "n-acidyout", "n-temp"];
const textids = ["clyout-max", "acidyout-max", "temp-min"];

async function updateServerSubscription(subscribed) {
    const endpoint = subscribed ? 'subscribe' : 'unsubscribe';

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
    const resp = await fetch(serverURL + endpoint, {
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
    const vkresp = await fetch(serverURL + 'vapid_public_key.txt');
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

// Helper function to update uptime percentage (left column)
function updateUptimePercentage(elementId, percentage) {
    const element = $(elementId);
    if (typeof(percentage) === 'number') {
        element.textContent = `${percentage.toFixed(1)}%`;
        if (percentage < 95) {
            element.classList.add('down-status');
        } else {
            element.classList.remove('down-status');
        }
    } else {
        element.textContent = `-`;
        element.classList.remove('down-status');
    }
}

// Helper function to update uptime status (right column)
function updateUptimeStatus(elementId, uptimeSeconds, downtimeSeconds) {
    const element = $(elementId);
    if (uptimeSeconds !== undefined) {
        element.textContent = `Up ${formatDuration(uptimeSeconds)}`;
        element.classList.remove('down-status');
    } else if (downtimeSeconds !== undefined) {
        element.textContent = 'Down';
        if (downtimeSeconds > 0)
            element.textContent += ` ${formatDuration(downtimeSeconds)}`;
        element.classList.add('down-status');
    } else {
        element.textContent = '-';
        element.classList.remove('down-status');
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
    } else {
        $('cl-value').textContent = '-';
        $('cl-setpoint').textContent = '-';
        $('cl-output').textContent = '-';
    }
    
    // Update pH card
    if (data.ph) {
        $('ph-value').textContent = `${data.ph.value.toFixed(2)} ${data.ph.unit}`;
        $('ph-setpoint').textContent = `${data.ph.setpoint.toFixed(1)} ${data.ph.unit}`;
        $('ph-output').textContent = `${data.ph.output.toFixed(1)}%`;
    } else {
        $('ph-value').textContent = '-';
        $('ph-setpoint').textContent = '-';
        $('ph-output').textContent = '-';
    }
    
    // Update ORP card
    if (data.orp) {
        $('orp-value').textContent = `${data.orp.value.toFixed(0)} ${data.orp.unit}`;
    } else {
        $('orp-value').textContent = '-';
    }
    
    // Update Temperature card
    if (data.temperature) {
        $('temp-value').textContent = `${data.temperature.value.toFixed(1)} ${data.temperature.unit}`;
    } else {
        $('temp-value').textContent = '-';
    }

    // Update Heater card
    if (data.pentair) {
        $('heater-status').textContent = data.pentair.heaterOn ? 'On' : 'Off';
        $('heater-setpoint').textContent = `${data.pentair.setpoint}°F`;
    } else {
        $('heater-status').textContent = '-';
        $('heater-setpoint').textContent = '-';
    }

    // Update Page Title with System Name
    if (data.blusentinel && data.blusentinel.name) {
        $('page-title').textContent = `BSMon: ${data.blusentinel.name}`;
        $('page-title-tag').textContent = `BSMon: ${data.blusentinel.name}`;
    }
    
    // Update Alarms (including connection status)
    const alarmsCard = $('alarms-card');
    let alarmHtml = '';
    let hasAlarms = false;
    
    // Add device connection alarms
    if (data.blusentinel && data.blusentinel.downtimeSeconds !== undefined) {
        alarmHtml += `<div>Connection: BluSentinel down for ${formatDuration(data.blusentinel.downtimeSeconds)}</div>`;
        hasAlarms = true;
    }

    if (data.pentair && data.pentair.downtimeSeconds !== undefined) {
        alarmHtml += `<div>Connection: Pentair down for ${formatDuration(data.pentair.downtimeSeconds)}</div>`;
        hasAlarms = true;
    }
    
    // Add existing alarm messages
    if (data.alarmMessages && data.alarmMessages.messages && data.alarmMessages.messages.length > 0) {
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
        hasAlarms = true;
    }
    
    if (hasAlarms) {
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

async function fetchStatus() {
    try {
        const response = await fetch(serverURL + 'api/status');
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

// Update log metrics (heater duty cycle, Pentair uptime, BS uptime, service uptime, and 24h output averages) using shared data fetch
async function updateLogMetrics() {
    try {
        // Get current status to access log interval and server time
        const statusData = await fetchStatus();
        const logIntervalMinutes = statusData.system.logIntervalMinutes;
        const serverTime = new Date(statusData.system.currentTime);
        
        const metrics = await getLogMetrics(logIntervalMinutes, serverTime, currentTimePeriod);
        
        if (metrics.dutyCycle !== null) {
            $('heater-duty-cycle').textContent = `${metrics.dutyCycle}%`;
        } else {
            $('heater-duty-cycle').textContent = '-';
        }
        
        // Update uptime percentages (left column) from log metrics
        updateUptimePercentage('bsmon-pct', metrics.serviceUptime);
        updateUptimePercentage('bs-pct', metrics.bsUptime);
        updateUptimePercentage('pentair-pct', metrics.pentairUptime);
        
        // Update uptime status (right column) from status API
        updateUptimeStatus('bsmon-status', statusData.system.uptimeSeconds, null);
        if (statusData.blusentinel) {
            updateUptimeStatus('bs-status', statusData.blusentinel.uptimeSeconds, statusData.blusentinel.downtimeSeconds);
        }
        if (statusData.pentair) {
            updateUptimeStatus('pentair-status', statusData.pentair.uptimeSeconds, statusData.pentair.downtimeSeconds);
        }
        
        if (metrics.clOutputAvg !== null) {
            $('cl-output-avg').textContent = `${metrics.clOutputAvg.toFixed(1)}%`;
        } else {
            $('cl-output-avg').textContent = '-';
        }
        
        if (metrics.phOutputAvg !== null) {
            $('ph-output-avg').textContent = `${metrics.phOutputAvg.toFixed(1)}%`;
        } else {
            $('ph-output-avg').textContent = '-';
        }
        
        // Update ORP min/max values
        if (metrics.orpMinMax.min !== null) {
            $('orp-min').textContent = `${Math.round(metrics.orpMinMax.min)} mV`;
        } else {
            $('orp-min').textContent = '-';
        }
        
        if (metrics.orpMinMax.max !== null) {
            $('orp-max').textContent = `${Math.round(metrics.orpMinMax.max)} mV`;
        } else {
            $('orp-max').textContent = '-';
        }
        
        // Update Temperature min/max values
        if (metrics.tempMinMax.min !== null) {
            $('temp-min').textContent = `${metrics.tempMinMax.min.toFixed(1)}°F`;
        } else {
            $('temp-min').textContent = '-';
        }
        
        if (metrics.tempMinMax.max !== null) {
            $('temp-max').textContent = `${metrics.tempMinMax.max.toFixed(1)}°F`;
        } else {
            $('temp-max').textContent = '-';
        }
        
    } catch (error) {
        console.error('Error updating heater and uptime metrics:', error);
        $('heater-duty-cycle').textContent = '-';
        // Update uptime displays to show error state
        updateUptimePercentage('bsmon-pct', 'BSMon', null);
        updateUptimePercentage('bs-pct', 'BluSentinel', null);
        updateUptimePercentage('pentair-pct', 'Pentair', null);
        updateUptimeStatus('bsmon-status', null, -1); // BSMon is down if we can't get metrics
        updateUptimeStatus('bs-status', null, null);
        updateUptimeStatus('pentair-status', null, null);
        $('cl-output-avg').textContent = '-';
        $('ph-output-avg').textContent = '-';
        $('orp-min').textContent = '-';
        $('orp-max').textContent = '-';
        $('temp-min').textContent = '-';
        $('temp-max').textContent = '-';
    }
}

// Handle time period selection
function setupTimePeriodSelector() {
    const timePeriodRadios = document.querySelectorAll('input[name="time-period"]');
    
    // Load saved preference from localStorage
    const savedPeriod = localStorage.getItem('timePeriod');
    if (savedPeriod) {
        currentTimePeriod = parseInt(savedPeriod);
        const savedRadio = document.querySelector(`input[name="time-period"][value="${currentTimePeriod}"]`);
        if (savedRadio) {
            savedRadio.checked = true;
        }
    }
    
    // Add event listeners to all radio buttons
    timePeriodRadios.forEach(radio => {
        radio.addEventListener('change', async function() {
            if (this.checked) {
                currentTimePeriod = parseInt(this.value);
                localStorage.setItem('timePeriod', currentTimePeriod.toString());
                
                // Immediately update log metrics with new time period
                await updateLogMetrics();
            }
        });
    });
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
        const data = await fetchStatus();
        if (data) {
            rawStatus.textContent = JSON.stringify(data, null, 2);
        } else {
            rawStatus.textContent = "Error fetching status";
        }
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
    // Fetch initial status
    await fetchStatus();
    
    // Setup time period selector
    setupTimePeriodSelector();
    
    // Fetch initial heater duty cycle and Pentair uptime using shared function
    await updateLogMetrics();
    
    // Setup raw data modal
    setupRawDataModal();

    // Initialize service worker and notification settings
    if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
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
    
    // Set up heater duty cycle and Pentair uptime refresh every 15 minutes using shared function
    setInterval(updateLogMetrics, 15 * 60 * 1000);
}

window.onload = () => { init(); }
