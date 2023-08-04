function $(id) {
    return document.getElementById(id);
}

let swRegistration = null;
let subscription = null;

const checkids = ["n-clyout", "n-acidyout"];
const textids = ["clyout-max", "acidyout-max"];

async function updateServerSubscription(subscribed) {
    const endpoint = subscribed ? '/subscribe' : '/unsubscribe';

    subset = {};
    for (let i = 0; i < checkids.length; i++) {
        let check = $(checkids[i]);
        let text = $(textids[i]);
        if (check.checked)
            subset[text.id] = text.value;
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

async function init() {
    let data = await fetch('/status.txt');
    $('status').innerHTML = await data.text();

    if ('serviceWorker' in navigator) {
        swRegistration = await navigator.serviceWorker.register('sw.js');
        console.log('Service Worker is registered', swRegistration);
        await initNotifyButtion();

        for (let i = 0; i < checkids.length; i++) {
            let check = $(checkids[i]);
            check.checked = localStorage.getItem(check.id) == "true";
            let text = $(textids[i]);
            text.value = localStorage.getItem(text.id) || "10";
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
}

window.onload = () => { init(); }

   