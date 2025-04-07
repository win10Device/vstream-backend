var http = require('http');
var https = require('https');
var fs = require('fs');
var mime = require('mime');
const path = require('node:path');
const { exec, execSync } = require('child_process');
const crypto = require("crypto");

const certs = 'certs'; //folder name
if (!fs.existsSync('openssl.cnf')) {
  console.log('openssl.cnf missing!');
  process.exit(-1);
}
function RunOpenSSLCommand(args, path) {
  if( !(/^[\x00-\x7F]+$/.test(args)) || /(>|<|&|\||\$|;)+$/.test(args) ) return false;
  try {
    execSync(`openssl ${args}`, {
      cwd: path,
      stdio: 'pipe'
    });
  } catch (e) {
    console.log("\033[31;40m---------------------------------------\033[1m\n\033[31;40mNOTICE:\033[5m\nDO NOT share any buffers, any files, keys, etc\nONLY report the error itself!\033[0m");
    console.log(`Command: openssl ${args}\n\n${e.stderr.toString()}`);
    console.log("\033[31;40m---------------------------------------\033[0m");
    return false;
  }
  return true;
}
function GenerateRootKeypair() {
  console.log('Creating root certificate keypair');
  if ((() => {
    if (!RunOpenSSLCommand(`ecparam -out ${certs}/private/root.key -name secp384r1 -genkey`, __dirname)) return true;
    if (!RunOpenSSLCommand(`req -new -key ${certs}/private/root.key -out ${certs}/public/root.csr -config openssl.cnf -batch`, __dirname)) return true;
    if (!RunOpenSSLCommand(`x509 -req -sha512 -days 365 -in ${certs}/public/root.csr -signkey ${certs}/private/root.key -out ${certs}/public/root.crt -extfile openssl.cnf -extensions v3_req`, __dirname)) return true;
    return false;
  })()) throw new Error('Command failed during root certificate keypair generation');
  if (fs.existsSync(`${certs}/public/root.crt`)) {
    console.log(`Public ceritificate is at ${path.resolve(certs + "/public/root.crt")}`);
  } else throw new Error('Public key missing from root ceritifcate keypair');
}



function HTML(res, file) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (fs.existsSync(`${__dirname}/static/${file}`)) {
    res.writeHead(200);
    res.write(fs.readFileSync(`${__dirname}/static/${file}`));
  } else {
    res.writeHead(500);
    res.write("<!doctype html><html lang=\"en\"><head><title>Error</title></head><body><h3 style='color: red;'>500</h3><br><p>The resource that's suppose to be here is missing</p></body></html>");
  }
}
function HandleFile(res, url) {
  var uri = path.normalize(url.join("/")).replace(/^(\.\.(\/|\\|$))+/, '');
  var filepath = path.join(__dirname + "/static/", uri);
  if (filepath.indexOf(__dirname + "/static/") !== 0) {
    res.writeHead(403);
  } else {
    if (fs.existsSync(filepath)) {
      res.setHeader('Content-Type', mime.getType(filepath));
      res.writeHead(200);
      res.write(fs.readFileSync(filepath));
    } else {
      res.writeHead(404);
    }
  }
}
//Folder setup
if (!fs.existsSync(certs)){
  fs.mkdirSync(certs);
  fs.mkdirSync(`${certs}/private`);
  fs.mkdirSync(`${certs}/public`);
  fs.chmodSync(`${certs}/private`, 0o755);
  fs.chmodSync(`${certs}/public`, 0o755);
}
if (!fs.existsSync(`${certs}/private/root.key`)) GenerateRootKeypair();
console.log('a');

const server = http.createServer(async function (req, res) {
//  res.setHeader('Content-Type', 'text/plain');
  const url=req.url.substring(1).trim().split('/');
  switch (url[0]) {
    case 'root':
      RootDir(res, url);
      break;
    case '':
      HTML(res, 'index.html');
      break;
    default:
//      HTML(res, url[0]);
      HandleFile(res, url);
      break;
  }
//  res.end('Hello, encrypted world!');
  res.end();
});
server.listen(8443).on('listening', () => {
  console.log("Server started");
})

function RootDir(res, url) {
  if (url.length>2);
  switch (url[1]) {
    case 'ca.pem':
    case 'ca.crt':
      console.log('la');
      res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      res.writeHead(200);
      res.write(fs.readFileSync(`${certs}/public/root.crt`));
      break;
  }
}
