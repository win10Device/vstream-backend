/*
--- NOTE ---
The main database is moving away from supabase
*/
process.env.HELIX_TOKEN_SECRET = "aaaaa";
const config = require('./config.json');
const { exec, execSync } = require('child_process');
const { createCluster, createClient } = require('redis');
const crypto = require('node:crypto');
const { cpus } = require('os');
const { WebSocketServer } = require('ws');
const mongoose = require('mongoose');
const users = require('./users.js').init(`${config.mongo.url}/${config.mongo.main}`);
//const vstream = require('./streams.js').init(`${config.mongo.url}/${config.mongo.vstream}`);
const { Helix, HelixError } = require("@vtubers.tv/utils");
const Ajv = require("ajv")
var http = require('http');
var cluster = require('cluster');

const client = createClient();
const ajv = new Ajv(); // options can be passed, e.g. {allErrors: true}

(async () => {
  await client.connect();
})();
const subscriber = client.duplicate();
(async () => {
  await subscriber.connect();
})();

const clientSchema = {
  main: {
    type: "object",
    properties: {
      type: {type: "string", "enum": ["1", "2", "3"]},
    },
    required: ["type"],
    additionalProperties: true
  },
  message: {
    type: "object",
    properties: {
      type: {type: "string"},
      msg: {type: "string", "minLength": 1, "maxLength": 250 },
    },
    required: ["msg"],
     additionalProperties: false
  }
}

const helix = new Helix({tokenSecret: 'stellagay'});
const token = helix.generateToken({
  userId: '67f87a7dcf3d709a560823bf',
//  email: 'lmay@vtubers.tv',
  roles: ['admin','user'],
  exp: Date.now() + 3600000
});
//const decoded = Helix.decodeToken(token);
console.log(token);
//console.log(decoded);


const validate_1 = ajv.compile(clientSchema.main);
const validate_2 = ajv.compile(clientSchema.message);

function CloseWebsocket() {
  this.ws.Close();
}
function SendError(ws, msg) {
  ws.send(JSON.stringify({type: "err", msg}))
}
function setBit(number, position) {
  const mask = 1 << position;
  return number | mask;
}
function generateRandomString(length) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}
function MessageObject(msg, color, flags) {
  return {
    id: generateRandomString(32),
    timestamp: Math.floor(Date.now()/1000),
    content: msg,
    colour: color,
    flags
  };
}

async function GetUserById(id) {
  var x = await client.get(`users:byId:${id}`);
  if (x) {
    return JSON.parse(x);
  } else {
    var user = (await users.findById(id));
    if (user) {
      user = user.toJSON();
      user.id = user._id.toString()
      delete user._id;
      await client.multi()
            .set(`users:byName:${user.username}`, `${user.id}`)
            .set(`users:byId:${user.id}`, JSON.stringify(user)) //Not an effective way to store JSON in redis
            .expire(`users:byName:${user.username}`, 6000)
            .expire(`users:byId:${user.id}`, 6000)
            .execAsPipeline()
            .then((results) => { console.log(results) });
      return user;
    }
  }
  return null;
}
async function GetUserData(id) {
  var user = await GetUserById(id);
  if (user) {
    var flags = 0b00000000;
    if (user.canStream) flags = setBit(flags, 1)
    return {
      id: user.id,
      username: user.username,
      global_name: user.displayName,
      avatar: user.avatar,
      flags
    };
  } else return null;
}
/*const numCPUs = cpus().length;
if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork(); // Restart worker
  });
} else {*/
  var ListOfConnections = new Map();
  const wss = new WebSocketServer({ port: 8083 });
  wss.on('connection', async function connection(ws, req) {
    if (typeof(req.headers['cookie']) !== 'undefined' || true) {
//      var temp = req.headers['cookie'];
      var temp = "token=eyJ1c2VySWQiOiI2N2Y4N2E3ZGNmM2Q3MDlhNTYwODIzYmYiLCJyb2xlcyI6WyJhZG1pbiIsInVzZXIiXSwiZXhwIjoxNzQ1NTY1NDkzNzA1fQ.ECBajrVzkGIOh4yoYBDyV3W4Yjm6JVI3I2HvoFVZtO0;";
      if (temp.includes('token=')) {
        var s = temp.substring(temp.indexOf('token='));
        var auth = s.substring(6, s.includes(';') ? s.indexOf(';') : s.length);
        try {
          const data = helix.verifyToken(token);
          console.log(data);
//          var user = await GetUserById(data.userId);
          if (ws.user = await GetUserData(data.userId))
            ws.activeSession = true;
          else
            ws.activeSession = false;
        } catch (e) {
          ws.activeSession = false;
        }
      }
    }
    var rate = {
      timestamp: 0,
      count: 0
    };
    var url = req.url.substring(1).trim().split('/');
    console.log(url)
    if (url.length > 1) {
      if (url[0] === 'chat' && url[1].length >= 4) {
        ws.ownId = `${crypto.randomBytes(20).toString('hex')}`;
        if (ws.user != null ) {
          ws.on('message', async function nessage(data, isBin) {
            if (ws.activeSession) ws.user = await GetUserData(ws.user.id);
            try {
              data = JSON.parse(data)
              if (validate_1(data)) {
                switch (data.type) {
                  case "1":
                    time = Date.now()
                    if (time - rate.timestamp < 500) rate.count++;
                    else rate.count = 0
                    rate.timestamp = Date.now() + 60000; //
                    if (rate.count > 10) {
                      ws.send(JSON.stringify({type: "2", notification: {dialog: true, header: "Whoa there!", content: "Take a quick breather and try again in a moment — we’ve got you on a short cooldown to keep things flowing smoothly." }, restriction: 0, expiresAt: rate.timestamp }))
                      return;
                    }
                    if (validate_2(data)) {
                      wss.clients.forEach(function each(client) {
                        if (client !== ws) {
                          client.send(JSON.stringify({
                              type: "2",
                              author: ws.user,
/*
                            author: {
                              type: 0,
                              id: ws.user.id,
                              username: ws.user.username,
                              global_name: ws.user.global_name,
                              avatar: ws.user.avatar,
                              badges: [{}],
                              colour: 0,
                              flags: ws.user.flags
                            },
*/
                              msg: MessageObject(data.msg, 0, 0)
                            }
                          ));
                        }
                      });
                      console.log(data);
                    } else SendError(ws, validate_2.errors[0].message);
                    break;
                  case "3":
                    break;
                  default:
                }
              } else SendError(ws, validate_1.errors[0].message);
            } catch (e) {
              ws.send(JSON.stringify({type: "err", msg: "exception"}));
              ws.terminate(); //Not putting up with bs
              console.log(e);
            }
          });
          subscriber.subscribe(`user_update:${ws.user.id}`, async (message) => {
            ws.user = await GetUserData(ws.user.id);
          });
        }
      } else ws.close();
    } else {
      ws.close();
      return;
    }
    //console.log(req); req.url
    ws.on('error', console.error);
  });
//}
