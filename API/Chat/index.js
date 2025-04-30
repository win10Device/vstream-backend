process.env.HELIX_TOKEN_SECRET = "aaaaa";
const config = require('./config.json');
const { exec, execSync } = require('child_process');
const { createCluster, createClient } = require('redis');
const crypto = require('node:crypto');
const { cpus } = require('os');
const { WebSocket, WebSocketServer } = require('ws');
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
  },
  _action: {
    type: "object",
    properties: {
      type: {type: "string"},
      ref: {type: "string"},
      action: {type: "string"},
      reason: {type: "string"}
    },
    required: ["ref","action"],
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
//console.log(decoded);


var validate_1 = ajv.compile(clientSchema.main);
var validate_2 = ajv.compile(clientSchema.message);
var validate_3 = ajv.compile(clientSchema._action);

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
function getBit(number, position) {
  const mask = 1 << position;
  const bit = (number & mask) >> position;
  return bit;
}
function MessageObject(msg, color, flags) {
  return {
    id: helix.generateId(),
    timestamp: Math.floor(Date.now()/1000),
    content: msg,
    colour: color,
    flags
  };
}

async function GetUserById(id) {
  try {
    const x = await client.get(`users:byId:${id}`);
    if (x) {
      return JSON.parse(x);
    } else {
      let user = (await users.findById(id));
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
            .then((results) => { /*console.log(results)*/ });
        return user;
      }
    }
  } catch (e) {
    // NO-OP
  }
  return null;
}
async function GetUserData(ws, id) {
  const user = await GetUserById(id);
  if (user) {
    if(Boolean(user.deletedAt == null && user.banExpiration == null)) {
      let flags = 0;
      if (user.canStream) flags = setBit(flags, 1);
      if (typeof(ws.user) !== 'undefined') {
        if (ws.creator.id === ws.user.id) flags = setBit(flags, 3)
      }
      return {
        type: 1,
        id: user.id,
        username: user.username,
        global_name: user.displayName,
        avatar: user.avatar,
        badges: [],
        flags
      };
    }
  }
  return null;
}
async function CompileMessageList(creator_id) {
  const list = await client.zRange(`chat:log:${creator_id}`, -20, -1);
  const a = {
    type: "6",
    messages: []
  };
  list.forEach((msg) => {
    a.messages.push(JSON.parse(msg));
  });
  return JSON.stringify(a);
}
async function GetMessage(creator_id, ref) {
  const list = await client.zRange(`chat:log:${creator_id}`, 0, -1);
  return list.find((s) => s.indexOf(`"id":"${ref}"`) > 0); // id can never be at index 0 because it always starts with a bracket
}
async function HandleModerationAction(ws, action, ref) {
  switch (action) {
    case "remove":
      if (ws.perms.message.remove) {
        const str = await GetMessage(ws.creator.id, ref);
        if (str) {
          const a = await client.zRem(`chat:log:${ws.creator.id}`, str);
          if (a == 1) {
            const msg = {
              type: 3,
              ref,
              action
           };
           client.publish(`stream_chat:${ws.creator.id}`, JSON.stringify(msg));
           return true;
          }
        }
      }
      break;
    case "highlight":
      if (ws.perms.message.highlight) {
        const str = await GetMessage(ws.creator.id, ref);
        if (str) {
            const msg = {
              type: 3,
              ref,
              action
           };
           client.publish(`stream_chat:${ws.creator.id}`, JSON.stringify(msg));
           return true;
        }
      }
      break;
  }
  return false;
}

const numCPUs = cpus().length;
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
} else {
  const wss = new WebSocketServer({ port: 8083 });
  wss.on('connection', async function connection(ws, req) {
    var rate = {
      timestamp: 0,
      count: 0
    };
    var url = req.url.substring(1).trim().split('/');
    if (url.length > 1) {
      if (url[0] === 'chat' && url[1].length == 24) {
        let valid = false;
        const creator = await GetUserById(url[1]);
        if (creator) {
          ws.creator = creator;
          let stream = await client.get(`ab:${creator.username}`);
          if (stream) {
            stream = JSON.parse(stream);
            if (stream.endpoint.hls !== "") {
              ws.mods = stream.chat.moderators;
              valid = true;
            }
          }
        }
        if (!valid) {
          ws.close();
          return;
        } else {
          if (typeof(req.headers['cookie']) !== 'undefined' || true) {
            //let temp = req.headers['cookie'];
            let temp = "token=eyJ1c2VySWQiOiI2N2Y4N2E3ZGNmM2Q3MDlhNTYwODIzYmYiLCJyb2xlcyI6WyJhZG1pbiIsInVzZXIiXSwiZXhwIjoxNzQ1NTY1NDkzNzA1fQ.ECBajrVzkGIOh4yoYBDyV3W4Yjm6JVI3I2HvoFVZtO0;";
            if (temp.includes('token=')) {
              let s = temp.substring(temp.indexOf('token='));
              let auth = s.substring(6, s.includes(';') ? s.indexOf(';') : s.length);
              try {
                const data = helix.verifyToken(token);
                if (ws.user = await GetUserData(ws, data.userId)) {
                  ws.activeSession = true;
                  const mod = ws.mods.find((obj) => obj.id === ws.user.id);
                  if (mod) {
                    ws.perms = {
                      message: {
                        remove: getBit(mod.permissions, 0),
                        highlight: getBit(mod.permissions, 1)
                      },
                      user: {
                        timeout: getBit(mod.permissions, 2),
                        ban_temp: getBit(mod.permissions, 3),
                        ban_perm: getBit(mod.permissions, 4)
                      }
                    };
                  }

                } else
                  ws.activeSession = false;
              } catch (e) {
                console.log(e);
                ws.activeSession = false;
              }
            }
          }
          ws.ownId = `${crypto.randomBytes(20).toString('hex')}`;
          const msg = {
            type: "0",
            msg: MessageObject(`Hallo!\nWelcome to the stream of ${ws.creator.displayName}, remember to be respectful!`, 0, 0),
          };
          ws.send(JSON.stringify(msg));
          const list = await CompileMessageList(ws.creator.id);
          ws.send(list);

          if (ws.user != null) {
            ws.on('message', async function nessage(data, isBin) {
              if (ws.activeSession) {
                if ((ws.user = await GetUserData(ws, ws.user.id)) == null) {
                  ws.removeAllListeners();
                  delete ws.user;
                  console.log("message event was revoked from an active session because their account's permissions where removed");
                  return;
                }
              }
              try {
                data = JSON.parse(data)
                if (validate_1(data)) {
                  switch (data.type) {
                    case "1":
                      if (rate.count > 4) {
                        if (Date.now() < (rate.timestamp + 60000)) {
                          ws.send(JSON.stringify({type: "2", notification: {dialog: true, header: "Whoa there!", content: "Take a quick breather and try again in a moment — we’ve got you on a short cooldown to keep things flowing smoothly." }, restriction: 0, expiresAt: rate.timestamp+60000 }))
                          return;
                        } else rate.count = 0;
                      } else {
                        if (Date.now() - rate.timestamp < 1000) rate.count++;
                        if (Date.now() - rate.timestamp > 3500) rate.count = 0;
                        rate.timestamp = Date.now();
                      }
                      if (validate_2(data)) {
                        let msg = {
                          type: "2",
                          author: ws.user,
                          msg: MessageObject(data.msg, 0, 0),
                          conn: ws.ownId
                        };
                        let response = {
                          type: "4",
                          response: "OK",
                          echo: msg
                        };
                        let temp_1 = JSON.stringify(msg);
                        await client.zAdd(`chat:log:${ws.creator.id}`, {score: Date.now(), value: temp_1});
                        client.publish(`stream_chat:${ws.creator.id}`, temp_1);
                        ws.send(JSON.stringify(response));
                      } else SendError(ws, validate_2.errors[0].message);
                      break;
                    case "3":
                      if (typeof(ws.perms) != 'undefined') {
                        if (validate_3(data)) {
                          await HandleModerationAction(ws, data.action, data.ref);
                        } else SendError(ws, validate_3.errors[0].message);
                      }
                      break;
                    default:
                      ws.send(JSON.stringify({type: "err", msg: "unknown message type"}));
                      break;
                  }
                } else SendError(ws, validate_1.errors[0].message);
              } catch (e) {
                ws.send(JSON.stringify({type: "err", msg: "exception"}));
                ws.terminate(); //Not putting up with bs
                console.log(e);
              }
            });
            subscriber.subscribe(`user_update:${ws.user.id}`, async (message) => {
              ws.user = await GetUserData(ws, ws.user.id);
            });
          }
          subscriber.subscribe(`stream_chat:${ws.creator.id}`, async (message) => {
            const a = JSON.parse(message);
            if (a.conn !== ws.ownId)
              ws.send(message);
          });
          setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send('{"type":5}');
            } else {
              clearInterval(this);
            }
          }, 10000);
        }
      } else {
        ws.close();
      }
    } else {
      ws.close();
      return;
    }
    //console.log(req); req.url
    ws.on('error', console.error);
  });
}
