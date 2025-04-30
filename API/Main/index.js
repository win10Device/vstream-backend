const config = require('./config.json');
const { exec, execSync } = require('child_process');
const mongoose = require('mongoose');
const { createCluster, createClient } = require('redis');
const crypto = require('node:crypto');
const { cpus } = require('os');
const users = require('./schemas/users.js').init(`${config.mongo.url}/${config.mongo.main}`);
const vstream = require('./schemas/streams.js').init(`${config.mongo.url}/${config.mongo.vstream}`);
const servers = require('./schemas/servers.js').init(`${config.mongo.url}/${config.mongo.vstream}`);
//var https = require('https'); //Temp
var http = require('http');
var cluster = require('cluster');
const client = createClient();
client.on('error', err => console.log('Redis Client Error', err));
client.on('connect', () => {
    console.log('Connected to Redis...');
});
(async () => {
  await client.connect();
})();
if (cluster.isPrimary) {
  users.watch().on('change', async (data) => {
    console.log(data);
    const updatedData = data.updateDescription.updatedFields;
    let deleteEntry = false;
    let match = false;
    Object.keys(updatedData).forEach((key) => {
      if (['banReason','deletedAt'].includes(key)) {
        deleteEntry = true;
        match = true;
      }
      if (['username','displayName','canStream','avatar'].includes(key)) {
        match = true;
      }
    });
    if (match) {
      let key = `users:byId:${data.documentKey._id.toString()}`;
      if (await client.exists(key)) {
        if (deleteEntry) {
          client.del(key);
          console.log(`Cache for "${data.documentKey._id.toString()}" was removed because the account was flagged as deleted or banned`);
        } else {
          let j = JSON.parse(await client.get(key));
          Object.keys(j).forEach(async (k) => {
            if (updatedData.hasOwnProperty(k)) {
              console.log(`Updating user ${data.documentKey._id.toString()}, changing "${j[k]}" to "${updatedData[k]}"`); //temp
              j[k] = updatedData[k];
              if (k === 'username') await client.set(`users:byName:${j.id}`, j.username);
            }
          })
          client.set(key, JSON.stringify(j)); // Not an effective way to store JSON in reds
          client.publish(`user_update:${j.id}`, "_");
        }
      }
    }
  });
}
/*
var pending = new Map();

const sleepUntil = async (id, timeoutMs) => {
  return new Promise((resolve, reject) => {
    const timeWas = new Date();
    const wait = setInterval(function() {
      if (!pending.has(id)) {
        clearInterval(wait);
        resolve();
      } else if (new Date() - timeWas > timeoutMs) { // Timeout
        clearInterval(wait);
//        reject();
        resolve();
      }
    }, 20);
  });
}
*/
async function getUserByName(name) {
  const id = await client.get(`users:byName:${name}`);
  if (id) {
    const x = await client.get(`users:byId:${id}`);
    return JSON.parse(x);
  } else {
    let user = (await users.findOne({ 'username': name }));
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

function base64UrlEncode(obj) {
  return btoa(obj).replace(/\+/g, '-').replace(/\//g, '-').replace(/=+$/, '');
}
function base64UrlDecode(obj) {
  let base64 = obj.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
      base64 += '=';
  }
  return atob(base64);
}
//var a = "VGxR8Bire2mWvzAW4ifthmqmXdFtbK0m";
//var b = (Math.floor(Date.now()/1000) - 1743130420);
//var c = `${base64UrlEncode(a)}.${base64UrlEncode(b)}`;
//var d = base64UrlEncode(crypto.createHmac('sha256', "VGxR8Bire2mWvzAW4ifthmqmXdFtbK0m")
//                .update(c).digest('binary'));
//console.log(`${c}.${d}`);

function HandlePOST(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on("data", (chunk) => data += chunk);
    req.on("end", () => resolve(data))
  });
}
function VerifyHMAC(str, signature, secret) {
  const hash = crypto.createHmac('sha256', secret)
               .update(str)
               .digest('binary');
  const string = base64UrlEncode(hash);
  return string === signature;
}
// This is NOT for user auth
async function HandleAuth(req) {
  return { auth: true, client: "test" }; //TEST ONLY!
/*
  try {
    if (req.headers.hasOwnProperty('authorization')) {
      var header = req.headers['authorization'];
      var part = header.split(' ');
      if (part.length == 2 && ['service'].includes(part[0])) {
        var a = part[1].split('.');
        var server_id = base64UrlDecode(a[0]);
        var value = await client.get(`aa:${part[0]}_${server_id}`);
        if (value != null) {
          var data = JSON.parse(value);
          if (VerifyHMAC(`${a[0]}.${a[1]}`, a[2], data.token))
            return { auth: true, client: data };
          }
        }
      }
    }
    return { auth: false, client: null } //If nothing else returns, fail
  } catch (e) {
    console.log(e);
    return { auth: false, client: null }
  }
*/
}

async function QueryStreamer(res, url) {
  const val = url[1]; //.replace(/^[\x00-\x7F]+$/, '');
  const stream = await client.get(`ab:${val}`);
  if (stream) {
    const endpoint = JSON.parse(stream).endpoint;
    if (endpoint.hls) {
      res.setHeader('Content-Type', 'application/json');
      res.write(stream);
      return;
    }
  } else {
    const user = await getUserByName(val);
    if (user) {
      if (user.canStream) {
        let meta = (await vstream.findOne({ 'user_id': user.id }));
        if (meta) {
          meta = meta.toJSON();
          delete meta.stream_key; //Prevent the key from ever showing in either the cache or the response
          if (meta.endpoint.hls != "") {
            client.set(`ab:${user.username}`, JSON.stringify(meta)); //Not an effective way to store JSON in redis
            client.expire(`ab:${user.username}`, 600); //10 minutes
            res.setHeader('Content-Type', 'application/json');
            res.write(JSON.stringify(meta));
            return;
          }
        }
      }
    }
  }
  res.writeHead(404); //If nothing else returns
}
async function StreamKey(res, str, url) {
console.log(str);
  try {
    const post = JSON.parse(str);
    let meta = (await vstream.findOne({ 'stream_key': post.key }));
    res.setHeader('Content-Type', 'application/json');
    if (meta != null) {
      if (meta.endpoint.hls == null) {
        res.writeHead(200);
        res.write(JSON.stringify({url: meta.user_id}));
      } else {
        console.log("User tried to stream using a key that's already in use");
        res.writeHead(403);
        res.write(JSON.stringify({msg: 'already active!'}));
      }
    } else {
      console.log("User tried to stream with a invalid key");
      res.writeHead(404);
      res.write(JSON.stringify({msg: 'key not found'}));
    }
  } catch (e) {
    console.log(e);
  }
}

async function route(req,res) {
  const { auth, client } = await HandleAuth(req);
  if (auth) {
    const url=req.url.substring(1).trim().split('/');
    if (url.length > 0 && url[0].length > 0) {
      switch (url[0]) {
        case 'query':
          if (url.length > 1)
            await QueryStreamer(res, url);
          else res.writeHead(404);
          break;
        case 'key':
console.log("a");
          if (req.method === 'POST') {
            const data = await HandlePOST(req);
            await StreamKey(res, data, url);
          } else res.writeHead(405);
          break;
        default:
          res.writeHead(200);
          break;
      }
    } else {
      res.writeHead(404);
    }
//  });
  } else {
    res.writeHead(403);
  }
  res.end();
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
  const server = http.createServer(route);

  server.listen(8443).on('listening', () => {
    console.log("Server started");
  })
  console.log(`Worker ${process.pid} started`);
}

/* temp
server.on('tlsClientError', function(err) {
  console.log(err);
});
server.on('keylog', (line, tlsSocket) => {
  //if (tlsSocket.remoteAddress !== '...')
  //  return; // Only log keys for a particular IP
  console.log(String(line));
});
server.on('secureConnection', (tlsSocket) => {
  console.log(tlsSocket.getPeerCertificate(true));
});
*/
