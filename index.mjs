// ESM entry.
//
// The core is a classic UMD file so ONE artifact serves `<script>` tags,
// `require()` and bundlers with no build step. Node treats that file as
// CommonJS (the package deliberately declares no `"type": "module"`, which
// is what makes `require("make-model-dropdown")` work), and Node's CJS
// interop hands its `module.exports` to ESM as the default import.
//
// Read the default export rather than a global: when the file loads as
// CommonJS it assigns `module.exports` and never touches `globalThis`, so
// reading the global here would land on undefined in exactly the Node paths
// this entry exists to serve.
import VehiclesDropdown from "./make-model-dropdown.js"

export default VehiclesDropdown
export const attach = VehiclesDropdown.attach
