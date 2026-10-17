export function resolve(specifier, context, nextResolve) {
  if (specifier === "@github/copilot-sdk/extension") {
    return { url: new URL("./brainstorm-sdk.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
