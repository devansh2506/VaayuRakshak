#!/usr/bin/env bash
# One command to put VayuRahshak on AWS: backend, web app, cache warm-up.
#
#   cd smoke-path && bash scripts/deploy_aws.sh
#
# Needs: the AWS CLI and the SAM CLI (brew install awscli aws-sam-cli), `aws configure` done once, and your keys in
# smoke-path/.env (FIRMS_MAP_KEY=..., OPENAQ_API_KEY=...). The keys go to AWS as hidden stack parameters; this
# script never prints them. Run it again after any change: it updates the same stack.
set -euo pipefail

STACK="${STACK:-parali-mitra}"
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1. Install it with: brew install $2"; exit 1; }; }

need aws awscli
need sam aws-sam-cli
need python3.12 python@3.12

# The region comes from `aws configure` (or REGION=... on the command line); Mumbai if neither is set.
REGION="${REGION:-$(aws configure get region 2>/dev/null || true)}"
REGION="${REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$REGION"
echo "Region: $REGION"

say "1/6 Checking your AWS login"
aws sts get-caller-identity --query '[Account,Arn]' --output text || { echo "Not logged in. Run: aws configure"; exit 1; }

if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ -z "${FIRMS_MAP_KEY:-}" ]; then echo "FIRMS_MAP_KEY is missing in smoke-path/.env (the fires need it)."; exit 1; fi
[ -z "${OPENAQ_API_KEY:-}" ] && echo "Note: OPENAQ_API_KEY is empty, so the measured air stations will be missing."
[ -z "${GEMINI_API_KEY:-}" ] && echo "Note: GEMINI_API_KEY is empty, so the farmer's AI crop doctor will be off (the symptom guide still works)."

say "2/6 Building the backend"
sam build

# A stack whose first deploy failed is left in ROLLBACK_COMPLETE and cannot be updated: remove it and start clean.
STATUS="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)"
while [ "$STATUS" = "ROLLBACK_IN_PROGRESS" ]; do echo "Waiting for the failed attempt to finish rolling back..."; sleep 15
  STATUS="$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true)"; done
if [ "$STATUS" = "ROLLBACK_COMPLETE" ]; then
  echo "Removing the failed earlier attempt ($STACK)..."
  aws cloudformation delete-stack --stack-name "$STACK" --region "$REGION"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$REGION"
fi

say "3/6 Deploying the stack (first time: about 10 minutes, CloudFront is slow)"
sam deploy --stack-name "$STACK" --region "$REGION" --resolve-s3 --capabilities CAPABILITY_IAM \
  --no-confirm-changeset --no-fail-on-empty-changeset \
  --parameter-overrides "FirmsMapKey=${FIRMS_MAP_KEY}" "OpenAqApiKey=${OPENAQ_API_KEY:-}" "GeminiApiKey=${GEMINI_API_KEY:-}"

out() { aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
SITE_URL="$(out SiteUrl)"; BUCKET="$(out SiteBucketName)"; DIST="$(out DistributionId)"; FN="$(out FunctionName)"

say "4/6 Uploading the web app"
BUILD="$(mktemp -d)"
cp -R frontend/. "$BUILD/"
# On AWS the web app and the API share one address (CloudFront forwards the API paths), so the API address is "/".
perl -pi -e 's/window\.PM_CONFIG = \{ api: ""/window.PM_CONFIG = { api: "\/"/' "$BUILD/index.html"
grep -q 'api: "/"' "$BUILD/index.html" || { echo "Could not set the API address in index.html"; exit 1; }
rm -f "$BUILD/vercel.json"
aws s3 sync "$BUILD" "s3://$BUCKET/" --delete --region "$REGION" --only-show-errors
rm -rf "$BUILD"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' --query 'Invalidation.Status' --output text

say "5/6 Fetching the first data (the scheduled refresh does this every 30 minutes; this makes the first visit fast)"
WARM="$(mktemp)"
aws lambda invoke --function-name "$FN" --region "$REGION" --payload '{"warm": true}' \
  --cli-binary-format raw-in-base64-out --cli-read-timeout 150 "$WARM" --query StatusCode --output text || true
echo "Result (a status per source; 200 is good): $(head -c 300 "$WARM")"
rm -f "$WARM"

say "6/6 Done"
echo "Open: $SITE_URL"
echo "Logs: aws logs tail /aws/lambda/$FN --region $REGION --follow"
