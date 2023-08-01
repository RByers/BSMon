function $(id) {
    return document.getElementById(id);
}

let swRegistration = null;

async function updateServerSubscription(subscription, subscribed) {
    const endpoint = subscribed ? '/subscribe' : '/unsubscribe';
    const body = JSON.stringify(subscription);
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
    const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey
    });
    await updateServerSubscription(subscription, true);
    console.log('User is subscribed:', subscription.toJSON());
}

async function unsubscribe() {
    const subscription = await swRegistration.pushManager.getSubscription();
    if (subscription) {
        await updateServerSubscription(subscription, false);
        await subscription.unsubscribe();
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
        const sub = await swRegistration.pushManager.getSubscription();
        if (!sub) {
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

async function init() {
    let data = await fetch('/status.txt');
    $('status').innerHTML = await data.text();

    if ('serviceWorker' in navigator) {
        swRegistration = await navigator.serviceWorker.register('sw.js');
        console.log('Service Worker is registered', swRegistration);
        await initNotifyButtion();

        // Make sure the server still knows about our subscription.
        const sub = await swRegistration.pushManager.getSubscription();
        if (sub)
            await updateServerSubscription(sub, true);
    } 
}

window.onload = () => { init(); }

   