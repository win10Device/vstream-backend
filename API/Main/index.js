/*
--- NOTE ---
The main database is moving away from supabase
*/
const config = require('./config.json');
const { exec, execSync } = require('child_process');
const { createClient: sbClient } = require('@supabase/supabase-js')
const { createCluster, createClient } = require('redis');
const crypto = require('node:crypto');
const { cpus } = require('os');
//var https = require('https'); //Temp
var http = require('http');
var cluster = require('cluster');

const supabase = sbClient(config.supabase.url, config.supabase.key);
const client = createClient();

client.on('error', err => console.log('Redis Client Error', err));

var pending = new Map();

(async () => {
  await client.connect();
})();

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
    var data = '';
    req.on("data", (chunk) => data += chunk);
    req.on("end", () => resolve(data))
  });
}
function VerifyHMAC(str, signature, secret) {
  var hash = crypto.createHmac('sha256', secret)
               .update(str)
               .digest('binary');
  var string = base64UrlEncode(hash);
  return string === signature;
}
// This is NOT for user auth
async function HandleAuth(req) {
  try {
    if (req.headers.hasOwnProperty('authorization')) {
      var header = req.headers['authorization'];
      var part = header.split(' ');
      if (part.length == 2 && ['ingest', 'relays', 'service'].includes(part[0])) {
        var a = part[1].split('.');
        var server_id = base64UrlDecode(a[0]);
        /*
           Wait for object to be removed from Map
           This is because calling the database takes time for a token that's not been cached,
           so if the client calls the endpoint again before it's finished processing, this ensures it waits
        */
        if (pending.has(`${part[0]}_${server_id}`))
          await sleepUntil(`${part[0]}_${server_id}`, 5000);
        var value = await client.get(`aa:${part[0]}_${server_id}`);
        if (value != null) {
          if (VerifyHMAC(`${a[0]}.${a[1]}`, a[2], value))
            return { auth: true, client: server_id }
        } else {
          pending.set(`${part[0]}_${server_id}`, null);
          const {data, error} = await supabase
            .from(`vstream_${part[0]}`)
            .select()
            .eq('id', server_id)
            .maybeSingle();
          if (data != null) {
            if (VerifyHMAC(`${a[0]}.${a[1]}`, a[2], data.token.auth)) {
              client.set(`aa:${part[0]}_${server_id}`, data.token.auth);
              client.expire(`aa:${part[0]}_${server_id}`, 86400); //24 hours
              console.log(`cached ${server_id}`);
              pending.delete(`${part[0]}_${server_id}`);
              return { auth: true, client: server_id };
            }
          }
          pending.delete(`${part[0]}_${server_id}`);
        }
      }
    }
    return { auth: false, client: null } //If nothing else returns, fail
  } catch (e) {
    console.log(e);
    return { auth: false, client: null }
  }
}

async function QueryStreamer(res, url) {
  var val = url[1]; //.replace(/^[\x00-\x7F]+$/, '');
  var stream = await client.get(`ab:${val}`);
  if (stream) {
    var endpoint = JSON.parse(stream).endpoint;
    if (endpoint) {
      res.setHeader('Content-Type', 'application/json');
      res.write(stream);
      return;
    }
  } else {
    const {data, error} = await supabase
        .from('users')
        .select()
        .eq('username', val)
        .maybeSingle();
    if (data != null) {
      if (data.can_stream) {
        const {data: meta, error} = await supabase
          .from('streams')
          .select()
          .eq('user_id', data.id)
          .maybeSingle();
        if (meta != null) {
          delete meta.key; //Prevent the key from ever showing in either the cache or the response
          client.set(`ab:${data.username}`, JSON.stringify(meta)); //Not an effective way to store JSON in redis
          client.expire(`ab:${data.username}`, 600); //10 minutes
          if (meta.endpoint) {
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
  try {
    var post = JSON.parse(str);
    const {data, error} = await supabase
      .from('streams')
      .select()
      .eq('key', post.key)
      .maybeSingle();
    res.setHeader('Content-Type', 'application/json');
    if (data != null) {
      if (data.endpoint) {
        res.writeHead(200);
        res.write(JSON.stringify({url: data.user_id}));
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
