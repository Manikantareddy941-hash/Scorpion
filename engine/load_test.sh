#!/bin/bash
for i in {1..10}; do
  curl -s -X POST http://localhost:3000/scan \
    -H 'Content-Type: application/json' \
    -d "{\"repo_url\":\"https://github.com/octocat/Hello-World\"}"
  echo ""
done
