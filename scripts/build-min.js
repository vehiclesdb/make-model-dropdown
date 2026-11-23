#!/usr/bin/env node
// Writes make-model-dropdown.min.js, the minified <script> build, from the
// one source: make-model-dropdown.js (UMD). terser is a devDependency only;
// the published files have no dependencies at all.
//
//   node scripts/build-min.js          # write make-model-dropdown.min.js
//   node scripts/build-min.js --check  # exit 1 if it is out of date (CI, prepublish)
"use strict"

const fs = require("node:fs")
const path = require("node:path")

const ROOT = path.join(__dirname, "..")
const SOURCE = path.join(ROOT, "make-model-dropdown.js")
const TARGET = path.join(ROOT, "make-model-dropdown.min.js")

async function build() {
  const { minify } = require("terser")
  const source = fs.readFileSync(SOURCE, "utf8")
  const result = await minify({ "make-model-dropdown.js": source }, {
    ecma: 2020,
    compress: { passes: 2 },
    mangle: true,
    // Keep the /*! licence banner.
    format: { comments: /^!/ }
  })
  return result.code + "\n"
}

if (require.main === module) {
  build().then((output) => {
    if (process.argv.includes("--check")) {
      const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : ""
      if (current !== output) {
        console.error("make-model-dropdown.min.js is out of date: run `node scripts/build-min.js`")
        process.exit(1)
      }
    } else {
      fs.writeFileSync(TARGET, output)
    }
  }).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = { build }
