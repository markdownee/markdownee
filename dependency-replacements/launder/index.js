// Licence-clean replacement for the `launder` package's `naughtyHref` export.
//
// Why this exists: `sanitize-html@2.17.7` imports `naughtyHref` from
// `launder@1.7.1` (`index.js:7`) and calls it in the href sanitization path
// (`index.js:781`). No published `launder` release — including `1.7.1` and
// `1.7.2-alpha.1` — ships a copyright-and-permission notice in its tarball,
// though its `package.json` declares MIT. A pnpm override scoped to sanitize-html
// installs this directory in launder's place, so that notice-less package is
// neither resolved nor redistributed (and its own `dayjs` dependency, unused by
// `naughtyHref`, leaves the graph with it).
//
// PROVENANCE — the dangerous-href algorithm below is ported from the last
// `sanitize-html` release that carried it inline, before the maintainer
// extracted it into `launder`:
//
//     package: sanitize-html
//     version: 2.17.3 (published 2026-04-15)
//     source:  index.js lines 728-768 (`naughtyHref`)
//     tarball: https://registry.npmjs.org/sanitize-html/-/sanitize-html-2.17.3.tgz
//     sha256:  e2aabbca6594ad144b601401585c9871ec2216d1cc93d7432cca6663d04bcd1d
//
// That tarball ships the full MIT licence text reproduced below. No code here is
// copied from the `launder` package; only the `(href, options)` call signature
// and its option defaults are reproduced, because that is the interface
// `sanitize-html@2.17.7` calls. Those adapter lines are original to this file.
//
// ---------------------------------------------------------------------------
// sanitize-html LICENSE (verbatim, from the 2.17.3 tarball):
//
// Copyright (c) 2013, 2014, 2015 P'unk Avenue LLC
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// (The npm `author` for that release is Apostrophe Technologies, Inc., the
// successor to P'unk Avenue LLC named in the licence text. Both are recorded.)
// ---------------------------------------------------------------------------
//
// See ../README.md for the maintenance obligation: this file now tracks the
// upstream dangerous-href check, so a `sanitize-html` bump must be diffed
// against it.

// Ported from sanitize-html 2.17.3 index.js:729-747.
//
// Strips the characters browsers ignore inside URLs, then clobbers embedded
// HTML comments. The comment removal MUST stay an index-based loop that
// re-scans from the start after every excision: splicing out one comment can
// fuse a new `<!--` opener from the surrounding text. A single lazy global
// regex is NOT equivalent and is a real bypass — for
// `<!<!--x-->--comment-->javascript:alert(1)` the loop keeps the payload
// blocked, while `/<!--[\s\S]*?-->/g` leaves `javascript:` reachable.
function cleanHref(href) {
  // Browsers ignore character codes of 32 (space) and below in a surprising
  // number of situations.
  // https://owasp.org/www-community/xss-filter-evasion-cheatsheet
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching the control characters browsers ignore is the point
  href = href.replace(/[\x00-\x20]+/g, '');
  while (true) {
    const firstIndex = href.indexOf('<!--');
    if (firstIndex === -1) {
      break;
    }
    const lastIndex = href.indexOf('-->', firstIndex + 4);
    if (lastIndex === -1) {
      break;
    }
    href = href.substring(0, firstIndex) + href.substring(lastIndex + 3);
  }
  return href;
}

// Returns true when `href` must be rejected as unsafe.
//
// Scheme matching and the protocol-relative check are ported from
// sanitize-html 2.17.3 index.js:748-767. The `(href, options)` signature, the
// option defaults and the non-string guard are the adapter for the interface
// sanitize-html 2.17.7 calls; they reproduce the behaviour of the package this
// file replaces, including its permissive edges:
//
//   - a non-string `href` returns false (allowed), matching the replaced
//     package rather than the stricter 2.17.3 inline code, which threw;
//   - `allowProtocolRelative` blocks only on exactly `false`, not on any falsy
//     value;
//   - a non-array `allowedSchemes` throws TypeError from `.indexOf`.
//
// The default scheme list is unreachable from sanitize-html, whose wrapper
// always passes an array (`options.allowedSchemes || []`), but is kept so this
// module is a faithful drop-in.
function naughtyHref(href, options) {
  options = options || {};
  const allowedSchemes = options.allowedSchemes || ['http', 'https', 'ftp', 'mailto', 'tel', 'sms'];
  const allowProtocolRelative = options.allowProtocolRelative !== false;
  if (typeof href !== 'string') {
    return false;
  }
  href = cleanHref(href);
  // Case insensitive so we don't get faked out by JAVASCRIPT #1. Allow more
  // characters after the first so we don't get faked out by certain schemes
  // browsers accept.
  const matches = href.match(/^([a-zA-Z][a-zA-Z0-9.\-+]*):/);
  if (!matches) {
    // Protocol-relative URL starting with any combination of '/' and '\'.
    if (href.match(/^[/\\]{2}/)) {
      return !allowProtocolRelative;
    }
    // No scheme.
    return false;
  }
  const scheme = matches[1].toLowerCase();
  return allowedSchemes.indexOf(scheme) === -1;
}

// The replaced package's default export is a factory used by ApostropheCMS for
// unrelated field-laundering. Nothing in this repository's graph uses it, so it
// fails loudly rather than silently returning something unusable, which would
// hide a future sanitize-html release that started depending on it.
module.exports = function launderReplacement() {
  throw new Error(
    'The trafilaturacore launder replacement implements only the `naughtyHref` export. ' +
      'A consumer now needs the full launder API — see ' +
      'packages/standalone/dependency-replacements/README.md.',
  );
};

module.exports.naughtyHref = naughtyHref;
