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
const { WebSocketServer } = require('ws');
//var https = require('https'); //Temp
var http = require('http');
var cluster = require('cluster');

const supabase = sbClient(config.supabase.url, config.supabase.key);
const client = createClient();

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
  wss.on('connection', function connection(ws, req) {
console.log(req);
    ws.on('error', console.error);
    ws.on('message', async function message(data) {
      console.log(data);
    });
  });
}
