import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        format: "module",
        shortCircuit: true,
        url: "data:text/javascript,export%20{}",
      }
    }

    return nextResolve(specifier, context)
  },
})
