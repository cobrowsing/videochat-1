var SCWorker = require('socketcluster/scworker');
var express = require('express');
var fs = require('fs');
var serveStatic = require('serve-static');
var path = require('path');
var morgan = require('morgan');
var healthChecker = require('sc-framework-health-check');
var parser = require('ua-parser-js');

// create a stdout and file logger
const UsageLogger = require('simple-node-logger');
const usageopts = {
  logFilePath: 'videochat.log',
  timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
};
var log = UsageLogger.createSimpleLogger(usageopts);

const AgentLogger = require('simple-node-logger');
const accessoptions = {
  logFilePath: 'useragent.log',
  timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
};
const ua = AgentLogger.createSimpleLogger(accessoptions);

class Worker extends SCWorker {
  run() {
    console.log('   >> Worker PID: ', process.pid);
    var environment = this.options.environment;

    var app = express();

    app.get('/', function(req, res, next) {
      let result = parser(req.headers['user-agent']);
      ua.info(result);
      ua.info('browser: ', result.browser); // {name: "Chromium", version: "15.0.874.106"}
      ua.info('device: ', result.device); // {model: undefined, type: undefined, vendor: undefined}
      ua.info('os: ', result.os); // {name: "Ubuntu", version: "11.10"}
      ua.info('os.version: ', result.os.version); // "11.10"
      ua.info('engine.name: ', result.engine.name); // "WebKit"
      ua.info('cpu.architecture: ', result.cpu.architecture);
      ua.info('-----------------------');
      next();
    });

    app.get('/mobile.html', function(req, res, next) {
      let result = parser(req.headers['user-agent']);
      ua.info('----Mobile Page--------');
      ua.info(result);
      ua.info('browser: ', result.browser); // {name: "Chromium", version: "15.0.874.106"}
      ua.info('device: ', result.device); // {model: undefined, type: undefined, vendor: undefined}
      ua.info('os: ', result.os); // {name: "Ubuntu", version: "11.10"}
      ua.info('os.version: ', result.os.version); // "11.10"
      ua.info('engine.name: ', result.engine.name); // "WebKit"
      ua.info('cpu.architecture: ', result.cpu.architecture);
      ua.info('-----------------------');
      next();
    });

    // create a write stream (in append mode)
    var accessLogStream = fs.createWriteStream(
      path.join(__dirname, 'access.log'),
      { flags: 'a' }
    );
    var clientsList = [];

    var httpServer = this.httpServer;
    var scServer = this.scServer;

    if (environment === 'dev') {
      // Log every HTTP request. See https://github.com/expressjs/morgan for other
      // available formats.
      app.use(morgan('dev'));
      app.use(morgan('combined', { stream: accessLogStream }));
    }

    app.use(serveStatic(path.resolve(__dirname, 'public')));

    httpServer.on('request', app);

    scServer.on('connection', function(server) {
      log.info('User connected');
      log.info('clients connected are', Object.keys(scServer.clients));
      log.info('id: ', server.id);

      scServer.exchange.publish(
        'clientsConnected',
        Object.keys(scServer.clients)
      );

      server.on('msg', function(message) {
        log.info('client said: ', message);
        var data = {
          id: server.id,
          msg: message
        };
        scServer.exchange.publish('messagebroadcast', data);
      });

      //server.on('got user media', room);

      server.on('create or join', function(room) {
        log.info('Received request to create or join room ' + room);

        var numClients = scServer.clientsCount;
        log.info('Room ' + room + ' now has ' + numClients + 'client(s)');

        if (numClients === 1) {
          server.emit('askClientToSubscribe', room); //socket.join(room);
          log.info('Client ID ' + server.id + ' created room ' + room);
          server.emit('created', room);
        } else if (numClients >= 2) {
          log.info('Client ID ' + server.id + ' joined room ' + room);
          var data = {
            id: server.id,
            room: room
          };
          scServer.exchange.publish('join', data); //io.sockets.in(room).emit('join', room);
          server.emit('askClientToSubscribe', data.room); //socket.join(room);
          server.emit('joined', Object.keys(scServer.clients));
        }
      });

      server.on('offer', function(data) {
        log.info('offer ', data);
        scServer.exchange.publish('offer', data);
      });

      server.on('answer', function(data) {
        log.info('answer ', data);
        scServer.exchange.publish('answer', data);
      });

      server.on('iceAnswer', function(data) {
        log.info('iceAnswer ', data);
        scServer.exchange.publish('iceAnswer', data);
      });

      server.on('iceOffer', function(data) {
        log.info('iceOffer ', data);
        scServer.exchange.publish('iceOffer', data);
      });

      server.on('bye', function() {
        log.info('received bye');
      });

      server.on('chat', function(data) {
        scServer.exchange.publish('yell', data);
        console.log('Chat: ', data);
      });

      server.on('filemetadata', function (data) {
        scServer.exchange.publish('filemetadata', data);
        console.log('filemetadata: ', data);
      }); 

      server.on('filesentnotify', function (data) {
        scServer.exchange.publish('filesentnotify', data);
        console.log('filesentnotify: ', data);
      });

      server.on('disconnect', function() {
        log.info('User disconnected ', server.id);
        log.info('disconnection ', Object.keys(scServer.clients));
        scServer.exchange.publish(
          'clientsDisconnect',
          Object.keys(scServer.clients)
        );
        scServer.exchange.publish('removeVideo', server.id);
      });
    });
  }
}

new Worker();
