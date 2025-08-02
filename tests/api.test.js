const http = require('http');
const { app, startServer, stopServer } = require('../server');

describe('GET /api/status', () => {
    beforeAll((done) => {
        startServer(8081);
        done();
    });

    afterAll((done) => {
        stopServer();
        done();
    });

    it('should return a JSON object with the correct structure', (done) => {
        http.get('http://localhost:8081/api/status', (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                expect(res.statusCode).toEqual(200);
                const data = JSON.parse(body);
                expect(data).toHaveProperty('system');
                expect(data.system).toHaveProperty('logIntervalMinutes');
                expect(data.system).toHaveProperty('currentTime');
                expect(data.system).toHaveProperty('uptimeSeconds');
                done();
            });
        }).on('error', (e) => {
            done(e);
        });
    });
});
