import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = {
  markdownee: ["schema", "conversion", "extraction", "crawler", "standalone", "apify-actor"],
  trafilaturacore: ["standalone"],
};
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function checkReleaseFamily(mode, { root = ROOT, tag, product } = {}) {
  if (mode !== "tools" && !Object.hasOwn(PACKAGES, mode)) {
    throw new Error("expected tools, markdownee, or trafilaturacore");
  }
  if (product !== undefined && (mode !== "tools" || !Object.hasOwn(PACKAGES, product))) {
    throw new Error("--product is valid only for tools with markdownee or trafilaturacore");
  }
  const read = (relative) => readFileSync(path.join(root, relative), "utf8");
  const json = (relative) => JSON.parse(read(relative));
  const declaration = json("scripts/engine-release-family.json");
  const { releaseVersion, versions, dependencies } = declaration;
  if (typeof releaseVersion !== "string" || !STABLE_VERSION.test(releaseVersion)) {
    throw new Error("release family must declare a stable releaseVersion");
  }
  const productNames = Object.keys(PACKAGES);
  if (
    versions === null ||
    typeof versions !== "object" ||
    Object.keys(versions).length !== productNames.length ||
    productNames.some(
      (product) => typeof versions[product] !== "string" || !STABLE_VERSION.test(versions[product]),
    )
  ) {
    throw new Error("release family must declare stable product versions");
  }
  if (
    dependencies === null ||
    typeof dependencies !== "object" ||
    typeof dependencies.markdowneeTrafilaturacore !== "string" ||
    !STABLE_VERSION.test(dependencies.markdowneeTrafilaturacore)
  ) {
    throw new Error("release family must declare Markdownee's stable Trafilatura Core dependency");
  }
  const maximumProductVersion = Object.values(versions).sort((left, right) => {
    const leftParts = left.split(".").map(Number);
    const rightParts = right.split(".").map(Number);
    return (
      leftParts[0] - rightParts[0] || leftParts[1] - rightParts[1] || leftParts[2] - rightParts[2]
    );
  })[1];
  if (releaseVersion !== maximumProductVersion) {
    throw new Error("releaseVersion must equal the greatest product version");
  }
  const actorVersion = versions.markdownee.split(".").slice(0, 2).join(".");
  function equal(actual, expected, source) {
    if (actual !== expected) {
      throw new Error(`${source}: expected ${expected}, found ${String(actual)}`);
    }
  }
  if (tag !== undefined) {
    equal(
      tag,
      `v${mode === "tools" ? (product ? versions[product] : releaseVersion) : versions[mode]}`,
      "release tag",
    );
  }
  const products = mode === "tools" ? Object.keys(PACKAGES) : [mode];
  for (const product of products) {
    const version = versions[product];
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
            mode === "tools" && suffix === ""
              ? "workspace:*"
              : dependencies.markdowneeTrafilaturacore,
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
      const dependencyLines = project.match(
        /^dependencies[ \t]*=[ \t]*\[[ \t]*(?:#.*)?\r?\n([\s\S]*?)^[ \t]*\][ \t]*(?:#.*)?$/m,
      )?.[1];
      if (dependencyLines === undefined)
        throw new Error(`${pythonSource}: unsupported dependency array format`);
      const pins = dependencyLines
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
      equal(
        pins[0],
        `trafilaturacore==${dependencies.markdowneeTrafilaturacore}`,
        `${pythonSource} trafilaturacore dependency`,
      );
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
      ["packageVersion", versions.markdownee],
      ["trafilaturacoreVersion", dependencies.markdowneeTrafilaturacore],
      ["actorVersion", actorVersion],
    ]) {
      equal(
        template?.parameters.find((item) => item.name === name)?.value,
        expected,
        `${source} ${name}`,
      );
    }
  }
  return {
    releaseVersion,
    version: mode === "tools" ? (product ? versions[product] : releaseVersion) : versions[mode],
    versions,
    actorVersion,
    products,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    const options = {};
    while (args.length > 0) {
      const flag = args.shift();
      const value = args.shift();
      if (
        (flag !== "--tag" && flag !== "--product") ||
        value === undefined ||
        options[flag] !== undefined
      ) {
        throw new Error(
          "usage: check-engine-release-family.mjs <tools|markdownee|trafilaturacore> [--product markdownee|trafilaturacore] [--tag vX.Y.Z]",
        );
      }
      options[flag] = value;
    }
    if (mode === undefined) {
      throw new Error(
        "usage: check-engine-release-family.mjs <tools|markdownee|trafilaturacore> [--product markdownee|trafilaturacore] [--tag vX.Y.Z]",
      );
    }
    console.log(
      JSON.stringify(
        checkReleaseFamily(mode, { product: options["--product"], tag: options["--tag"] }),
      ),
    );
  } catch (error) {
    console.error(`release family check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
