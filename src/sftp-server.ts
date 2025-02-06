import {
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  openSync,
  closeSync,
  readSync,
  writeSync,
  constants,
} from "fs";
import { Server, type AuthContext, type SFTPStream } from "ssh2";
import upath from "upath";
import os from "os";
import path from "path";

// Configuration
const HOST = "0.0.0.0";
const PORT = 2222;
const USERNAME = "testuser";
const PASSWORD = "testpass";
const UPLOADS_DIR = upath.toUnix(path.join(os.homedir(), "sftp-uploads"));

// Ensure the SFTP root directory exists
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Load SSH Private Key
const PRIVATE_KEY = readFileSync(path.join(__dirname, "server-key.pem"));

// Create SSH2 Server
const server = new Server({ hostKeys: [PRIVATE_KEY] });

// Store directory handles
const directoryHandles: Record<string, { path: string; files: string[] }> = {};

// Store file handles
const openFiles: Record<string, number> = {};

// Helper function to resolve paths properly
function resolvePath(givenPath: string): string {
  console.log(`🔹 Given Path: ${givenPath}`);

  let normalizedPath = upath.toUnix(givenPath);

  // Ensure relative paths are resolved against the root directory
  if (!upath.isAbsolute(normalizedPath)) {
      normalizedPath = upath.join(UPLOADS_DIR, normalizedPath);
  }

  // Normalize the resolved path
  const resolvedPath = upath.normalize(normalizedPath);
  console.log(`✅ Resolved Path: ${resolvedPath}`);

  // Prevent path traversal attacks
  if (!resolvedPath.startsWith(UPLOADS_DIR)) {
      throw new Error(`❌ Path escape attempt detected (${resolvedPath})`);
  }

  return resolvedPath;
}

// Helper function to convert SSH2 flags to Node.js file system flags
function convertFlagsToFs(flags: number): number {
  const FLAG_MAP: { [key: number]: number } = {
      1: constants.O_RDONLY, // SSH2_FXF_READ
      2: constants.O_WRONLY, // SSH2_FXF_WRITE
      8: constants.O_EXCL,   // SSH2_FXF_EXCL
      16: constants.O_TRUNC, // SSH2_FXF_TRUNC
      32: constants.O_APPEND, // SSH2_FXF_APPEND
      64: constants.O_CREAT, // SSH2_FXF_CREAT
  };

  let fsFlags = 0;
  for (const [sshFlag, fsFlag] of Object.entries(FLAG_MAP)) {
      if (flags & Number(sshFlag)) {
          fsFlags |= fsFlag;
      }
  }

  return fsFlags || constants.O_RDONLY; // Default to read-only if no flags match
}

server.on("connection", (client) => {
  console.log("🟢 Client connected!");

  client.on("authentication", (ctx: AuthContext) => {
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
  });

  client.on("ready", () => {
      console.log("🟢 Client authenticated and ready");

      client.on("session", (accept: () => any) => {
          const session = accept();
          session.on("sftp", (accept: () => SFTPStream) => {
              console.log("📂 New SFTP session started");
              const sftpStream: SFTPStream = accept();

              sftpStream.on("REALPATH", (reqid, givenPath) => {
                  try {
                      const resolvedPath = resolvePath(givenPath);
                      console.log(`✅ Resolved REALPATH: ${resolvedPath}`);
                      sftpStream.name(reqid, [{ filename: resolvedPath, longname: "", attrs: {} }]);
                  } catch (error) {
                      console.log(`❌ REALPATH failed: ${error}`);
                      sftpStream.status(reqid, 4);
                  }
              });

              sftpStream.on("OPENDIR", (reqid, directoryPath) => {
                  try {
                      const resolvedPath = resolvePath(directoryPath);

                      if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
                          console.log(`❌ OPENDIR failed: Not a directory - ${resolvedPath}`);
                          return sftpStream.status(reqid, 4);
                      }

                      const files = readdirSync(resolvedPath);
                      const handleId = `dir-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                      directoryHandles[handleId] = { path: resolvedPath, files };

                      console.log(`📂 Directory opened successfully: ${resolvedPath}`);
                      sftpStream.handle(reqid, Buffer.from(handleId));
                  } catch (error) {
                      console.error("OPENDIR error:", error);
                      sftpStream.status(reqid, 4);
                  }
              });

              sftpStream.on("READDIR", (reqid, handle) => {
                  const handleStr = handle.toString();
                  console.log(`READDIR requested for handle: ${handleStr}`);

                  if (!directoryHandles[handleStr]) {
                      console.log(`❌ READDIR failed: invalid handle ${handleStr}`);
                      return sftpStream.status(reqid, 4);
                  }

                  const { path: dirPath, files } = directoryHandles[handleStr];

                  if (files.length === 0) {
                      console.log(`READDIR completed for handle: ${handleStr}`);
                      delete directoryHandles[handleStr];
                      return sftpStream.status(reqid, 1);
                  }

                  try {
                      const nextFiles = files.splice(0, 10);
                      const fileDetails = nextFiles.map((file) => {
                          const filePath = upath.join(dirPath, file);
                          const stats = statSync(filePath);
                          const isDirectory = stats.isDirectory();

                          return {
                              filename: file,
                              longname: `${isDirectory ? "d" : "-"}rwxr-xr-x 1 user group ${stats.size} ${file}`,
                              attrs: {
                                  mode: isDirectory ? 0o755 : 0o644,
                                  uid: 0,
                                  gid: 0,
                                  size: stats.size,
                                  atime: Math.floor(stats.atime.getTime() / 1000),
                                  mtime: Math.floor(stats.mtime.getTime() / 1000),
                              },
                          };
                      });

                      sftpStream.name(reqid, fileDetails);
                  } catch (error) {
                      console.error("READDIR error:", error);
                      sftpStream.status(reqid, 4);
                  }
              });

              sftpStream.on("CLOSE", (reqid, handle) => {
                  const handleStr = handle.toString();

                  if (openFiles[handleStr]) {
                      console.log(`CLOSE requested for file handle: ${handleStr}`);
                      closeSync(openFiles[handleStr]);
                      delete openFiles[handleStr];
                      sftpStream.status(reqid, 0);
                  } else if (directoryHandles[handleStr]) {
                      console.log(`CLOSE requested for directory handle: ${handleStr}`);
                      delete directoryHandles[handleStr];
                      sftpStream.status(reqid, 0);
                  } else {
                      console.log(`❌ CLOSE failed: invalid handle ${handleStr}`);
                      sftpStream.status(reqid, 4);
                  }
              });
          });
      });
  });

  client.on("error", (err: any) => {
      console.error("SFTP Client Error:", err);
  });

  client.on("end", () => {
      console.log("Client disconnected.");
  });
});

// Start Listening
server.listen(PORT, HOST, () => {
  console.log(`✅ SFTP Server running at sftp://${HOST}:${PORT}`);
});
