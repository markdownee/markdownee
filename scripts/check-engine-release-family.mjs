import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = {
  markdownee: ["schema", "conversion", "extraction", "crawler", "standalone", "apify-actor"],
  trafilaturacore: ["standalone"],
};
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function checkReleaseFamily(mode, { root = ROOT, tag } = {}) {
  if (mode !== "tools" && !Object.hasOwn(PACKAGES, mode)) {
    throw new Error("expected tools, markdownee, or trafilaturacore");
  }
  const read = (relative) => readFileSync(path.join(root, relative), "utf8");
  const json = (relative) => JSON.parse(read(relative));
  const { version } = json("scripts/engine-release-family.json");
  if (typeof version !== "string" || !STABLE_VERSION.test(version)) {
    throw new Error("release family must declare a stable X.Y.Z version");
  }
  const actorVersion = version.split(".").slice(0, 2).join(".");
  function equal(actual, expected, source) {
    if (actual !== expected) {
      throw new Error(`${source}: expected ${expected}, found ${String(actual)}`);
    }
  }
  if (tag !== undefined) equal(tag, `v${version}`, "release tag");
  const products = mode === "tools" ? Object.keys(PACKAGES) : [mode];
  for (const product of products) {
    const prefix = mode === "tools" ? `solutions/${product}/engine/` : "";
    const suffixes = mode === "tools" ? ["", ".release"] : [""];
    for (const pkg of PACKAGES[product]) {
      for (const suffix of suffixes) {
        const source = `${prefix}packages/${pkg}/package${suffix}.json`;
        const manifest = json(source);
        equal(manifest.version, version, `${source} version`);
        if (product === "markdownee" && ["extraction", "standalone"].includes(pkg)) {
          equal(
            manifest.dependencies?.["@markdownee/trafilaturacore"],
            mode === "tools" && suffix === "" ? "workspace:*" : version,
            `${source} @markdownee/trafilaturacore dependency`,
          );
        }
      }
    }
    const pythonSource = `${prefix}packages/standalone-python/pyproject.toml`;
    // These authored manifests use quoted, literal project metadata. Restrict the scan to
    // [project] so another TOML table cannot accidentally satisfy a missing release value.
    const project = read(pythonSource).match(/^\[project\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m)?.[1];
    if (project === undefined) throw new Error(`${pythonSource}: missing [project] table`);
    equal(project.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1], version, pythonSource);
    if (product === "markdownee") {
      // Support the authored multiline literal array only; never discard active syntax
      // that could conceal a second requirement. A comment cannot close the array.
      const dependencies = project.match(
        /^dependencies[ \t]*=[ \t]*\[[ \t]*(?:#.*)?\r?\n([\s\S]*?)^[ \t]*\][ \t]*(?:#.*)?$/m,
      )?.[1];
      if (dependencies === undefined)
        throw new Error(`${pythonSource}: unsupported dependency array format`);
      const pins = dependencies
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
        .map((line) => {
          const entry = line.match(/^"([^"\\]+)"[ \t]*,?[ \t]*(?:#.*)?$/);
          if (!entry) throw new Error(`${pythonSource}: unsupported dependency entry format`);
          return entry[1].trim();
        })
        .filter((requirement) => /^trafilaturacore(?=[^A-Za-z0-9._-]|$)/i.test(requirement));
      equal(pins.length, 1, `${pythonSource} trafilaturacore dependency count`);
      equal(pins[0], `trafilaturacore==${version}`, `${pythonSource} trafilaturacore dependency`);
      for (const suffix of suffixes) {
        const source = `${prefix}packages/apify-actor/.actor/actor${suffix}.json`;
        equal(json(source).version, actorVersion, `${source} Actor version`);
      }
    }
  }
  if (mode === "tools") {
    const source = "solutions/common/shared/tools/glueosourcegenerator-data/config.json";
    const config = json(source);
    const template = config.projectTemplates.find((item) => item.name === "markdownee-engine");
    for (const [name, expected] of [
      ["packageVersion", version],
      ["trafilaturacoreVersion", version],
      ["actorVersion", actorVersion],
    ]) {
      equal(
        template?.parameters.find((item) => item.name === name)?.value,
        expected,
        `${source} ${name}`,
      );
    }
  }
  return { version, actorVersion, products };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== "--tag")) {
      throw new Error(
        "usage: check-engine-release-family.mjs <tools|markdownee|trafilaturacore> [--tag vX.Y.Z]",
      );
    }
    console.log(JSON.stringify(checkReleaseFamily(mode, { tag: args[1] })));
  } catch (error) {
    console.error(`release family check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
