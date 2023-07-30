const VAPID_PUBLIC_KEY = 'BNj1KsjxRwwFfYOnoOtvgy_T7DxCgfamSwblOsu1rlruiK23Qouk28PrDdcY-2HJaSnTvMZpNG-hYLTqhzF_Sqg';

function $(id) {
    return document.getElementById(id);
}

let swRegistration = null;

async function updateServerSubscription(subscription, subscribed) {
    const endpoint = subscribed ? '/subscribe' : '/unsubscribe';
    const body = JSON.stringify(subscription);
    console.log('Sending: ' + body);
    const sent = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: body
    });
}

async function subscribe() {
    const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_PUBLIC_KEY
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
        await updateServerSubscription(sub, true);
    } 
}

window.onload = () => { init(); }

   