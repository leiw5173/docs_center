#!/usr/bin/env bash
set -euo pipefail

repository=leiw5173/docs_center
number=${1:-}
[[ $number =~ ^[1-9][0-9]*$ ]] || { echo '用法：bash scripts/document-governance/preview-local.sh <候选 PR 编号>' >&2; exit 1; }
cd "$(dirname "$0")/../.."

directory=$(mktemp -d)
trap 'rm -rf "$directory"' EXIT
gh api "repos/$repository/pulls/$number" --jq '{pull_request:.}' > "$directory/event.json"
revision=$(node -p "require(process.argv[1]).pull_request.head.sha" "$directory/event.json")
run=$(gh run list -R "$repository" --commit "$revision" --event pull_request \
  --workflow document-governance.yml --limit 5 --json databaseId --jq '.[0].databaseId')
[[ $run =~ ^[0-9]+$ ]] || { echo '当前候选还没有内容检查记录' >&2; exit 1; }
gh run download "$run" -R "$repository" -n "document-preview-$revision" -D "$directory/check-report"

preview_token=$(docker inspect document-onboarding-test-backend --format '{{json .Config.Env}}' |
  python3 -c 'import json,sys; print(dict(item.split("=",1) for item in json.load(sys.stdin)).get("DOCUMENT_PREVIEW_TOKEN",""))')
GH_TOKEN=$(gh auth token) GITHUB_REPOSITORY=$repository GITHUB_EVENT_PATH=$directory/event.json \
  DOCUMENT_PREVIEW_MODE=local DOCUMENT_PREVIEW_TOKEN=$preview_token \
  node scripts/document-governance/run.cjs backend-preview --output "$directory/preview.zip" \
    --check-report "$directory/check-report" --sites-file "$directory/sites.json"

# Chromium runs beside the existing local gateway, so its loopback is different.
node -e 'const fs=require("node:fs"); const [source,target]=process.argv.slice(1);
  const {localBrowserOrigin,localPreviewOrigin}=require("./scripts/document-governance/preview-sites.cjs");
  fs.writeFileSync(target,fs.readFileSync(source,"utf8").replaceAll(localBrowserOrigin+"/",localPreviewOrigin+"/"));' \
  "$directory/sites.json" "$directory/browser-sites.json"
browser_result=0
docker run --rm --network document-onboarding-test_default \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD/scripts/document-governance:/governance:ro" -v "$directory:/preview" \
  -e NODE_PATH=/opt -e DOCUMENT_PREVIEW_MODE=local -e DOCUMENT_PREVIEW_SITES_FILE=/preview/browser-sites.json \
  -e GITHUB_STEP_SUMMARY=/preview/summary.md --entrypoint node spacemit-acceptance-browser:r37-cjk \
  /governance/review-preview.cjs /preview/review.json || browser_result=$?

node -e 'const [number,revision,sites,review]=process.argv.slice(1);
  console.log(JSON.stringify({number:Number(number),revision,sites:require(sites),review:require(review)}));' \
  "$number" "$revision" "$directory/sites.json" "$directory/review.json" > "$directory/result.json"
gh workflow run document-governance.yml -R "$repository" --ref main -F "local_preview=@$directory/result.json"
exit "$browser_result"
