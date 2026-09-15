// The integration suite injects a real in-memory SQLite handle, so the native
// Expo module must not initialize inside the Node test process.
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function loadForStalkerSqliteIntegration(request, parent, isMain) {
  if (request === "expo-sqlite") {
    return {
      openDatabaseAsync() {
        throw new Error("The Stalker SQLite integration suite must inject its database handle.");
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
