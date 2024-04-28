# BSMon
A quick-and-dirty weekend project for monitoring [Blu-Sentinel pool chemical controllers](https://www.evoqua.com/en/evoqua/products--services/disinfection-systems/disinfection-process-analyzers--controllers/blu-sentinel-se-chemical-controller/). I built this because one day my chlorine line got plugged and the pump hose burst, then the feeder proceeded to ramp up to a 100% feed rate feeding chrloine onto my shed floor! I've also had issues with my heater not heating, so like to be alerted when my temperature falls below my setpoint. I've also appreciated being able to monitor chemical and temperature levels in order to help optimize. I'm sharing the code here just in case anyone else finds it useful.

These controllers expose a basic web interface as well as a [modbus](https://en.wikipedia.org/wiki/Modbus) automation interface, with protocol documented [in the manual](https://epipreprod.evoqua.com/siteassets/documents/extranet/a_temp_ext_dis/blu-sentinel-se_w3t387175_wt.050.511.000.de.im.pdf). Unfortunately, neither interace is safe to expose to the Internet due to inadequate security. For example, after a user enters their password on the physical or web interface, the device allows any new connection to modify the settings such as chemical dosing levels (i.e. authentication is global rather than per-session). A VPN could be used for secure remote access, but even then there is no facility for logging or receiving alerts.

This project is a tiny node.js server and web app front-end which is designed to be run on a local device (such as a Raspberry Pi) with direct access to the chemical controller. It polls the controller on a configurable interval and can send push notifications to web clients for any built-in alerts and whenever the dosing interval exceeds user-configurable values. It provides a very primitive UI showing all relevant raw data from the controller. All controller access is read-only and so no authentication is currently required.  If the server is exposed to the Internet, then anyone on the Internet can monitor the values (including system name) and subscribe to notifications. Since web push requires a secure context, a TLS certificate is required but development and testing can work over localhost without one. The server is only weakly hardened against denial-of-service attacks, but is otherwise probably secure from unauthorized access. The web app has been tested manually with current versions of Google Chrome and Apple Safari, but is likely to work with other modern browsers.

As a weekend hobby project with likely no (or few) other users, I have not bothtered to invest in good software engineering practices such as automated testing and penetration testing. Use at your own risk, it's not impossible that this package could somehow damage your controller or allow an attacker to alter your pool chemistry.


Here's an image of the web app (with admitadly terrible UX):\
<img src="https://github.com/RByers/BSMon/assets/1280419/643387b1-78ba-429f-b6d7-3f325b2a8f1e" width=270>

Here's examples of the charts that I can generate from it's logs:\
![image](https://github.com/RByers/BSMon/assets/1280419/cc2dcdd0-da1e-4102-9a26-67d7ed849cd6)
![image](https://github.com/RByers/BSMon/assets/1280419/b6e02837-72f8-4af9-96f4-d1ed46bed5d0)
![image](https://github.com/RByers/BSMon/assets/1280419/a089d257-1edd-4f11-8b07-62cb807d7f30)
![image](https://github.com/RByers/BSMon/assets/1280419/5ff065e0-aa70-4e25-888e-d41ee24e3802)


