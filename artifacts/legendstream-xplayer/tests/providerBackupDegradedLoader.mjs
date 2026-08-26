// Test-only ESM override. Production code never imports this module.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@noble/hashes/hmac.js") {
    return {
      url: "data:text/javascript,export const hmac = undefined;",
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
