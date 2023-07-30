self.addEventListener('install', function (event) {
    self.skipWaiting();
});

self.addEventListener('notificationclick', function(event) {
	console.log('Notification clicked.');
	event.notification.close();

    event.waitUntil(
        clients
            .matchAll({type: "window"})
            .then((clientList) => {
                for (const client of clientList) {
                    if ('focus' in client) {
                        console.log('Focusing ', client);
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    console.log('Opening new window');
                    return clients.openWindow("/");
                }
            }),
    ); 
});

self.addEventListener('push', event => {
    const options = {
      body: event.data.text(),
      requireInteraction: true,
    };
    console.log('Push received.', event.data);
    self.registration.showNotification('BSMon', options);
  });
  