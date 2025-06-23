const WebSocket = require('ws');

const host = '192.168.86.6';
const port = 6680;

const ws = new WebSocket(`ws://${host}:${port}`);

let heaterData = null;

ws.on('open', () => {
  console.log('Connected to Pentair Intellicenter');
  
  const heaterMessage = {
    command: 'GetParamList',
    condition: 'OBJTYP = HEATER',
    objectList: [{
      objnam: 'ALL',
      keys: ["OBJTYP: SUBTYP: SNAME: LISTORD: STATUS: PERMIT: TIMOUT: READY: HTMODE : SHOMNU : COOL : COMUART : BODY : HNAME : START : STOP : HEATING : BOOST : TIME : DLY : MODE"]
    }],
    messageID: 'dump-heater-script-heater'
  };
  
  ws.send(JSON.stringify(heaterMessage));
});

ws.on('message', (data) => {
  const response = JSON.parse(data.toString());
  
  if (response.messageID === 'dump-heater-script-heater') {
    heaterData = response.objectList;
    
    const bodyMessage = {
      command: 'GetParamList',
      condition: 'OBJTYP = BODY',
      objectList: [{
        objnam: 'ALL',
        keys: ["OBJTYP: SUBTYP: SNAME: LISTORD: FILTER: LOTMP: TEMP: HITMP: HTSRC: PRIM: SEC: ACT1: ACT2: ACT3: ACT4: CIRCUIT: SPEED: BOOST: SELECT: STATUS: HTMODE : LSTTMP : HEATER : VOL : MANUAL : HNAME : MODE"]
      }],
      messageID: 'dump-heater-script-body'
    };
    
    ws.send(JSON.stringify(bodyMessage));
  } else if (response.messageID === 'dump-heater-script-body') {
    const body = response.objectList[0];
    const heater = heaterData[0];

    const isHeating = heater.params.STATUS === 'ON' && body.params.HTMODE !== '0';

    console.log('--- Heater Status ---');
    console.log(`Actively Heating: ${isHeating}`);
    console.log(`Heater Status: ${heater.params.STATUS}`);
    console.log(`Body Heat Mode: ${body.params.HTMODE}`);
    console.log('');
    console.log('--- Temperature ---');
    console.log(`Current Water Temp: ${body.params.TEMP}°F`);
    console.log(`Low Temp Setpoint: ${body.params.LOTMP}°F`);
    console.log(`High Temp Setpoint: ${body.params.HITMP}°F`);
    console.log('');
    console.log('--- Raw Data ---');
    console.log('Heater Object:');
    console.log(JSON.stringify(heater, null, 2));
    console.log('Body Object:');
    console.log(JSON.stringify(body, null, 2));
    ws.close();
  }
});

ws.on('close', () => {
  console.log('Disconnected from Pentair Intellicenter');
});

ws.on('error', (error) => {
  console.error('Pentair client error:', error);
});
