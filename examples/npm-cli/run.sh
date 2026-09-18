#!/usr/bin/env bash
# Demonstrates the full npm CLI surface for markdownee.
# Requires: npm install -g markdownee (or npx markdownee)
# One --storage path fully identifies a run's storage (always the 'default'
# buckets). When --storage is omitted, MARKDOWNEE_STORAGE_DIR controls
# where data is persisted.
set -euo pipefail

URL1="https://example.com"
URL2="https://www.iana.org/domains/reserved"

# Help for every subcommand (truncated — drop `| head -5` to see all flags)
markdownee --help | head -5
markdownee crawl --help | head -5
markdownee fetch --help | head -5
markdownee export --help | head -5
markdownee purge --help | head -5

# Multi-URL crawl into ./crawl-storage — markdown as a key-value-store blob
# AND plain text inline in the dataset record. --purge wipes the storage
# (datasets/, key_value_stores/, request_queues/) before extracting.
markdownee crawl "$URL1" "$URL2" --crawler-type cheerio \
  --save markdown-kvs --save txt-dataset \
  --storage ./crawl-storage --purge

# Input file — reads URLs line by line; a different run gets its own --storage
echo "$URL1" > /tmp/urls.txt
echo "$URL2" >> /tmp/urls.txt
markdownee crawl --start-urls-file /tmp/urls.txt --crawler-type cheerio \
  --storage ./file-run-storage --purge

# Crawler engine selection — adaptive starts HTTP-only and falls back to a
# headless browser per page when needed; firefox forces Playwright Firefox
# (cheerio appears above, chromium in the wait examples below)
markdownee crawl "$URL1" --crawler-type adaptive \
  --max-requests-per-crawl 1 --storage ./engine-storage --purge
markdownee crawl "$URL1" --crawler-type firefox \
  --max-requests-per-crawl 1 --storage ./engine-storage

# Rendering type detection ratio 0–1 (adaptive only) — the fraction of
# requests double-checked with a browser to detect client-side rendering
markdownee crawl "$URL1" --crawler-type adaptive --rendering-type-detection 0.2 \
  --max-requests-per-crawl 1 --storage ./engine-storage

# When --storage is omitted, MARKDOWNEE_STORAGE_DIR picks the storage dir
MARKDOWNEE_STORAGE_DIR=./env-storage markdownee crawl "$URL1" \
  --crawler-type cheerio --max-requests-per-crawl 1 --purge

# Wait for a CSS selector before extracting (fails on timeout) — browser
# engines only; example.com always renders an <h1>
markdownee crawl "$URL1" --crawler-type chromium --wait-for-selector "h1" \
  --max-requests-per-crawl 1 --storage ./wait-storage --purge

# Soft selector wait — logs and continues on timeout instead of failing;
# pairing it with --wait-for-dynamic-content caps the selector wait (here 3s)
# so the deliberate miss stays cheap
markdownee crawl "$URL1" --crawler-type chromium \
  --soft-wait-for-selector ".dynamic-section" --wait-for-dynamic-content 3 \
  --max-requests-per-crawl 1 --storage ./wait-storage

# Wait for network idle up to 5 seconds after navigation (also sets the
# selector wait timeout)
markdownee crawl "$URL1" --crawler-type chromium --wait-for-dynamic-content 5 \
  --max-requests-per-crawl 1 --storage ./wait-storage

# Media blocking (images, stylesheets, fonts, PDFs, ZIPs) is the default for
# browser engines — spell it out with --block-media, or load everything with
# --no-block-media
markdownee crawl "$URL1" --crawler-type chromium --block-media \
  --max-requests-per-crawl 1 --storage ./wait-storage
markdownee crawl "$URL1" --crawler-type chromium --no-block-media \
  --max-requests-per-crawl 1 --storage ./wait-storage

# Discover and enqueue URLs from sitemap.xml at each start URL domain root
markdownee crawl "$URL1" --crawler-type cheerio --use-sitemaps \
  --max-requests-per-crawl 2 --storage ./crawl-tuning-storage --purge

# Start with a fixed concurrency and let Crawlee scale up to the cap
markdownee crawl "$URL1" "$URL2" --crawler-type cheerio \
  --initial-concurrency 2 --max-concurrency 4 \
  --max-requests-per-crawl 2 --storage ./crawl-tuning-storage

# Disable canonical URL deduplication — extract every loaded URL
markdownee crawl "$URL1" --crawler-type cheerio --deduplication minimal \
  --max-requests-per-crawl 1 --storage ./crawl-tuning-storage

# Audit the crawl frontier — pushes a dataset record for each discovered URL
# that was skipped (excluded by globs, robots.txt, or the depth/request caps)
markdownee crawl "$URL1" --crawler-type cheerio --selector a \
  --store-skipped-urls --max-requests-per-crawl 2 \
  --storage ./crawl-tuning-storage

# Single page, no link-following — the default --save is markdown-stdout.
# stdout carries the raw markdown only (diagnostics go to stderr), so it
# pipes cleanly.
markdownee fetch "$URL1" --crawler-type cheerio | head -20

# Plain text to stdout
markdownee fetch "$URL1" --crawler-type cheerio --save txt-stdout | head -10

# Two files from one fetch — --output is a base prefix, each format appends
# its own extension: page.md + page.html
markdownee fetch "$URL1" --crawler-type cheerio \
  --save markdown-file --save html-file --output ./page
ls page.md page.html

# Mixed destinations — markdown to a file while the extracted HTML streams
# to stdout
markdownee fetch "$URL1" --crawler-type cheerio \
  --save markdown-file --save html-stdout --output ./example.md | head -5
ls example.md

# Directory --output (trailing slash) — files get URL-slug names inside it
markdownee fetch "$URL1" --crawler-type cheerio \
  --save markdown-file --output ./one-output/
ls ./one-output

# html + original together — original is tagged .original.html so the raw
# page never overwrites the extracted HTML
markdownee fetch "$URL1" --crawler-type cheerio \
  --save html-file --save original-file --output ./one-output/
ls ./one-output

# At most one format may target stdout — a second -stdout token is rejected
markdownee fetch "$URL1" --save markdown-stdout --save txt-stdout \
  && exit 1 || echo "rejected (expected): stdout carries one format"

# Export stored content to a user-facing output directory (human-named files
# + manifest.json)
markdownee export --storage ./crawl-storage --output-dir ./markdownee-output
ls ./markdownee-output

# Purge each storage — clears all three bucket dirs; purge resolves
# MARKDOWNEE_STORAGE_DIR the same way extract does when --storage is omitted
markdownee purge --storage ./crawl-storage
markdownee purge --storage ./file-run-storage
markdownee purge --storage ./engine-storage
markdownee purge --storage ./wait-storage
markdownee purge --storage ./crawl-tuning-storage
MARKDOWNEE_STORAGE_DIR=./env-storage markdownee purge
