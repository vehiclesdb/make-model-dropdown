// ESM entry. The core is a classic UMD file (so one file serves `<script>`
// tags, CommonJS and bundlers without a build step); importing it for its
// side effect defines the global, which this module re-exports as a proper
// default export.
import "./make-model-dropdown.js"

const VehiclesDropdown = globalThis.VehiclesDropdown
export default VehiclesDropdown
export const attach = VehiclesDropdown.attach
