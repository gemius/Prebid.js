import { logInfo, logError, isStr, getWindowTop, canAccessWindowTop, getWindowSelf } from '../src/utils.js';
import { submodule } from '../src/hook.js';

const MODULE_NAME = 'gemiusId';
const GVLID = 328;
const LOG_PREFIX = 'Gemius User ID: ';

const WAIT_FOR_PRIMARY_SCRIPT_MAX_TRIES = 7;
const WAIT_FOR_PRIMARY_SCRIPT_INITIAL_WAIT_MS = 150;
const GEMIUS_CMD_TIMEOUT = 8000;

function getPrimaryScriptWindow() {
  if (canAccessWindowTop()) {
    return getWindowTop();
  }

  return getWindowSelf();
}

function retrieveId(primaryScriptWindow, callback) {
  let resultResolved = false;
  let timeoutId = null;
  const setResult = function (...args) {
    if (resultResolved) {
      return;
    }

    resultResolved = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    callback(...args);
  }

  timeoutId = setTimeout(() => {
    logError(LOG_PREFIX + 'failed to get id, timeout');
    timeoutId = null;
    setResult();
  }, GEMIUS_CMD_TIMEOUT);

  try {
    primaryScriptWindow.gemius_cmd('get_ruid', function (ruid, desc) {
      if (desc.status === 'ok') {
        setResult({id: ruid});
      } else if (desc.status === 'no-consent') {
        logInfo(LOG_PREFIX + 'failed to get id, no consent');
        setResult({id: null});
      } else {
        logError(LOG_PREFIX + 'failed to get id, response: ' + desc.status);
        setResult();
      }
    });
  } catch (e) {
    logError(LOG_PREFIX + 'failed to get id, error: ' + e);
    setResult();
  }
}

export const gemiusIdSubmodule = {
  name: MODULE_NAME,
  gvlid: GVLID,
  decode(value) {
    if (isStr(value?.id)) {
      return { [MODULE_NAME]: value.id };
    }
    return undefined;
  },
  getId() {
    logInfo(LOG_PREFIX + 'getId');
    return {
      callback: function (callback) {
        const win = getPrimaryScriptWindow();

        (function waitForPrimaryScript(tryCount = 1, nextWaitTime = WAIT_FOR_PRIMARY_SCRIPT_INITIAL_WAIT_MS) {
          if (typeof win.gemius_cmd !== 'undefined') {
            retrieveId(win, callback);
          }

          if (tryCount < WAIT_FOR_PRIMARY_SCRIPT_MAX_TRIES) {
            setTimeout(() => waitForPrimaryScript(tryCount + 1, nextWaitTime * 2), nextWaitTime);
          } else {
            callback();
          }
        })();
      }
    };
  },
  eids: {
    [MODULE_NAME]: {
      source: 'gemius.com',
      atype: 1,
    },
  }
};

submodule('userId', gemiusIdSubmodule);
