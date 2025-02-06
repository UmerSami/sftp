"use strict";

const fs = require('fs');
const { Server } = require('ssh2');
const SftpServer = require('ssh2-sftp-server');

const HOST = '0.0.0.0';
const PORT = 2222;
const USERNAME = 'testuser';
const PASSWORD = 'testpass';

const server = new Server({
  hostKeys: [fs.readFileSync('host.key')]
}, (client) => {
  console.log('Client connected!');

  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === USERNAME && ctx.password === PASSWORD) {
      console.log('Authentication successful');
      ctx.accept();
    } else {
      console.log('Authentication failed');
      ctx.reject();
    }
  }).on('ready', () => {
    console.log('Client authenticated and ready');

    client.on('session', (accept) => {
      const session = accept();
      session.on('sftp', (accept) => {
        console.log('New SFTP session started');
        const sftpStream = accept();
        new SftpServer(sftpStream);
      });
    });
  }).on('end', () => {
    console.log('Client disconnected.');
  }).on('error', (err) => {
    console.error('Client error:', err);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SFTP Server running at sftp://${HOST}:${PORT}`);
});


/* client.on("authentication", (ctx: AuthContext) => {
    console.log(`🔹 Authentication attempt: ${ctx.username}, method: ${ctx.method}`);

    if (ctx.method === "password") {
      console.log(`🔑 Password received: "${ctx.password}"`); // ✅ Debugging only

      if (ctx.username === USERNAME && ctx.password === PASSWORD) {
        console.log("✅ Authentication successful");
        ctx.accept();
      } else {
        console.log("❌ Wrong password");
        ctx.reject();
      }
    } else if (ctx.method === "none") {
      console.log('❗ Client is using "none" authentication');
      console.log("➡️ Sending authentication failure, expecting password next");

      ctx.reject(["password"]);
    } else {
      console.log(`❌ Unsupported authentication method: ${ctx.method}`);
      ctx.reject();
    }
  }); */