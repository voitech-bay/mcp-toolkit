# AWS deployment (web+api together, MCP separate)

This setup deploys:

- `web-api` service: Vue frontend + Node API on the same origin (no CORS issues).
- `mcp` service: standalone MCP HTTP server on a separate endpoint.

Both services are containerized and deployed to AWS App Runner.

## Why this matches your requirement

- Frontend and backend are served by one process (`src/api-server.ts`) and one public URL.
- API endpoints stay under `/api/*` on the same domain/port as the frontend.
- MCP server is isolated as a separate App Runner service with its own URL.

## Prerequisites

- AWS CLI v2 configured (`aws configure`)
- Docker installed and running
- IAM permission for ECR + App Runner + IAM role creation/passing
- Region chosen (examples below use `us-east-1`)

## One-command reusable deploy (recommended)

From repo root:

```powershell
.\deploy\aws\deploy-apprunner.ps1
```

Useful variants:

```powershell
# Deploy to another EU region
.\deploy\aws\deploy-apprunner.ps1 -Region eu-west-1

# Deploy a versioned image tag
.\deploy\aws\deploy-apprunner.ps1 -ImageTag v0.2.0

# Repoint/redeploy services to an already-pushed tag (no local docker build)
.\deploy\aws\deploy-apprunner.ps1 -ImageTag v0.2.0 -SkipBuild
```

The script is idempotent: it creates missing repos/role/services and updates existing services on repeated runs.

## CI/CD with GitHub Actions

Workflow file: `.github/workflows/deploy-aws.yml`

It provides manual deploy via **Actions -> Deploy to AWS App Runner -> Run workflow** with inputs:

- `region` (default `eu-central-1`)
- `image_tag`
- `web_service_name`
- `mcp_service_name`

### Required GitHub secret

- `AWS_DEPLOY_ROLE_ARN`: IAM role ARN used by GitHub OIDC (`aws-actions/configure-aws-credentials`)

### Minimal IAM permissions for that role

- ECR: create/describe repos, push images
- IAM: get/create role and attach policy for `AppRunnerECRAccessRole` (or pre-create and remove these permissions)
- App Runner: list/create/update/describe services
- STS: caller identity

### Optional hardening

- Pre-create `AppRunnerECRAccessRole` yourself and remove IAM create/attach permissions from CI role.
- Restrict deploy role trust policy to this repo/branch/environment only.

## Manual deployment steps

## 1) Create ECR repositories

```powershell
aws ecr create-repository --repository-name mcp-toolkit-web --region us-east-1
aws ecr create-repository --repository-name mcp-toolkit-mcp --region us-east-1
```

## 2) Build and push images

```powershell
$REGION="us-east-1"
$ACCOUNT_ID=(aws sts get-caller-identity --query Account --output text)
$REGISTRY="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REGISTRY

docker build -f Dockerfile.web -t mcp-toolkit-web:latest .
docker tag mcp-toolkit-web:latest $REGISTRY/mcp-toolkit-web:latest
docker push $REGISTRY/mcp-toolkit-web:latest

docker build -f Dockerfile.mcp -t mcp-toolkit-mcp:latest .
docker tag mcp-toolkit-mcp:latest $REGISTRY/mcp-toolkit-mcp:latest
docker push $REGISTRY/mcp-toolkit-mcp:latest
```

## 3) Create App Runner services

Create an App Runner ECR access role once (skip if already exists):

```powershell
aws iam create-role --role-name AppRunnerECRAccessRole --assume-role-policy-document file://deploy/aws/apprunner-ecr-trust-policy.json
aws iam attach-role-policy --role-name AppRunnerECRAccessRole --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess
```

Then create `web-api`:

```powershell
$ACCESS_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/AppRunnerECRAccessRole"

aws apprunner create-service `
  --service-name mcp-toolkit-web-api `
  --region $REGION `
  --source-configuration "AuthenticationConfiguration={AccessRoleArn=$ACCESS_ROLE_ARN},ImageRepository={ImageIdentifier=$REGISTRY/mcp-toolkit-web:latest,ImageRepositoryType=ECR,ImageConfiguration={Port=3000,RuntimeEnvironmentVariables={PORT=3000}}}" `
  --instance-configuration "Cpu=1 vCPU,Memory=2 GB"
```

Create `mcp`:

```powershell
aws apprunner create-service `
  --service-name mcp-toolkit-mcp `
  --region $REGION `
  --source-configuration "AuthenticationConfiguration={AccessRoleArn=$ACCESS_ROLE_ARN},ImageRepository={ImageIdentifier=$REGISTRY/mcp-toolkit-mcp:latest,ImageRepositoryType=ECR,ImageConfiguration={Port=3000,RuntimeEnvironmentVariables={PORT=3000}}}" `
  --instance-configuration "Cpu=1 vCPU,Memory=2 GB"
```

## 4) Add runtime env vars

Set these on the **web-api** service:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`)
- `ENCRYPTION_SECRET`
- `SOURCE_API_BASE_URL` (if not stored per project)
- `SOURCE_API_KEY` (if not stored per project)
- `APOLLO_API_KEY` (if Apollo enrichment used)
- `OCEAN_API_TOKEN` (if Ocean enrichment used)

Set env vars on the **mcp** service if MCP tools need them:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`)
- `APOLLO_API_KEY` / `OCEAN_API_TOKEN` as needed

Use:

```powershell
aws apprunner update-service --service-arn <service-arn> --source-configuration file://deploy/aws/<source-config-json-file>.json
```

## 5) Connect frontend and MCP client

- Web app URL: `https://<web-api-service>.awsapprunner.com`
- MCP URL: `https://<mcp-service>.awsapprunner.com/mcp`

The web app calls `/api/*` on the same origin, so no browser CORS preflight issues.

## Dev-size monthly cost estimate (rough)

- App Runner `web-api` (1 vCPU, 2 GB, low traffic): ~$25-$45/month
- App Runner `mcp` (1 vCPU, 2 GB, low traffic): ~$25-$45/month
- ECR storage + data transfer: typically low single-digit dollars for small images/traffic

Estimated total: **~$55-$95/month** for a dev environment.
