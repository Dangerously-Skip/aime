/**
 * The main-process log file, rotated by size while the app runs.
 *
 * Rotation used to happen once, at launch. The app is left open for days, the
 * Next server's whole stdout/stderr is piped through here, and a chatty session
 * (or a crash loop) wrote without bound until the next restart. Now every write
 * counts bytes, and crossing `maxBytes` moves the file to `<file>.1` (replacing
 * the previous one) and starts a fresh file — so the logs cost at most about
 * twice `maxBytes` on disk.
 *
 * Synchronous writes to an open descriptor, deliberately. A write stream opens
 * its file asynchronously, so a rotation soon after creation raced the open: the
 * rename found no file, and the "rotated" stream then created one under the live
 * name. Sync writes also mean the lines before a crash are on disk — which is
 * the one time anybody reads this file.
 */
const fs = require("fs");
const path = require("path");

function createRotatingLog({ file, maxBytes }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rotated = `${file}.1`;
  let fd = null;
  let size = 0;

  function open() {
    fd = fs.openSync(file, "a");
    try {
      size = fs.fstatSync(fd).size;
    } catch {
      size = 0;
    }
  }

  function rotate() {
    try {
      fs.closeSync(fd);
    } catch {
      // already closed
    }
    fd = null;
    let renamed = true;
    try {
      fs.renameSync(file, rotated);
    } catch {
      // Windows refuses to rename a file something else holds open. Carry on
      // appending, and count from zero so the next attempt is another
      // `maxBytes` away rather than on every single write.
      renamed = false;
    }
    open();
    if (!renamed) size = 0;
  }

  // Over the limit already (a previous run that ended big): rotate before use.
  try {
    if (fs.statSync(file).size > maxBytes) fs.renameSync(file, rotated);
  } catch {
    // no file yet
  }
  open();

  return {
    write(line) {
      const bytes = Buffer.byteLength(line);
      try {
        if (size > 0 && size + bytes > maxBytes) rotate();
        fs.writeSync(fd, line);
        size += bytes;
      } catch {
        // A logger that throws (full disk, revoked permission) would take the
        // main process down with it. Lose the line instead.
      }
    },
    close() {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // already closed
        }
        fd = null;
      }
      return Promise.resolve();
    },
    get path() {
      return file;
    },
  };
}

module.exports = { createRotatingLog };
