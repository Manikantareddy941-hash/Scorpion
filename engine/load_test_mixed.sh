#!/bin/bash
REPOS=(
  "https://github.com/octocat/Hello-World"
  "https://github.com/expressjs/express"
  "https://github.com/lodash/lodash"
)

echo "Triggering Mixed Workload Scans (Small, Med, Large-ish)..."

for repo in "${REPOS[@]}"; do
  echo "Scanning $repo..."
  curl -s -X POST http://localhost:3000/scan \
    -H 'Content-Type: application/json' \
    -d "{\"repo_url\":\"$repo\"}"
  echo ""
done

echo "Done."
