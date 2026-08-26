// Test-only CommonJS loader hook. Production code never imports this module.
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "@noble/hashes/hmac.js") {
    return { hmac: undefined };
  }
  return originalLoad.call(this, request, parent, isMain);
};
