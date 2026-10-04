/**
 * The only way main-web.js registers an IPC handler.
 *
 * Every channel is refused unless the message came from a frame showing the app
 * (see nav-policy.js). The check lives in one wrapper instead of at the top of
 * each handler because "each handler remembers" is how a boundary ends up with
 * one handler that didn't: there are ~40 channels, including file write and a
 * shell. `ipc-guard.test.js` fails if main-web.js calls `ipcMain.handle`/`on`
 * directly anywhere, so a new channel cannot be added outside the wrapper.
 *
 * A handler that needs a DIFFERENT sender — the first-launch setup window, a
 * local file with no app origin — passes `{ trust: (event) => boolean }`, which
 * replaces the origin check for that one registration. It is still a check.
 */

function createIpcGuard({ ipcMain, isTrustedSender, log = console.warn }) {
  function allowed(event, channel, trust) {
    let ok = false;
    try {
      ok = trust ? !!trust(event) : !!isTrustedSender(event);
    } catch {
      ok = false;
    }
    if (!ok) {
      let from = "unknown";
      try {
        from = event?.senderFrame?.url || "no frame";
      } catch {
        // senderFrame throws when the frame is already gone
      }
      log(`[ipc] refused "${channel}" from untrusted sender: ${from}`);
    }
    return ok;
  }

  return {
    /** `ipcMain.handle`, refused with a rejected invoke() when untrusted. */
    handle(channel, listener, opts = {}) {
      ipcMain.handle(channel, (event, ...args) => {
        if (!allowed(event, channel, opts.trust)) {
          throw new Error(`IPC "${channel}" refused: untrusted sender`);
        }
        return listener(event, ...args);
      });
    },

    /**
     * `ipcMain.on`. A refused `sendSync` gets `returnValue = null` — leaving it
     * unset would block the sender's renderer until the IPC times out.
     */
    on(channel, listener, opts = {}) {
      ipcMain.on(channel, (event, ...args) => {
        if (!allowed(event, channel, opts.trust)) {
          event.returnValue = null;
          return;
        }
        return listener(event, ...args);
      });
    },
  };
}

module.exports = { createIpcGuard };
