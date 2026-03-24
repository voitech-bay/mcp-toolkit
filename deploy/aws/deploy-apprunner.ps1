param(
    [string]$Region = "eu-central-1",
    [string]$WebRepositoryName = "mcp-toolkit-web",
    [string]$McpRepositoryName = "mcp-toolkit-mcp",
    [string]$WebServiceName = "mcp-toolkit-web-api",
    [string]$McpServiceName = "mcp-toolkit-mcp",
    [string]$ImageTag = "latest",
    [string]$AppRunnerEcrAccessRoleName = "AppRunnerECRAccessRole",
    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Command {
    param([string]$CommandName)
    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $CommandName"
    }
}

function Ensure-EcrRepository {
    param(
        [string]$RepositoryName,
        [string]$RegionName
    )
    $null = aws ecr describe-repositories --repository-names $RepositoryName --region $RegionName 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Creating ECR repository: $RepositoryName"
        aws ecr create-repository --repository-name $RepositoryName --region $RegionName | Out-Null
    } else {
        Write-Host "ECR repository exists: $RepositoryName"
    }
}

function Ensure-AppRunnerEcrAccessRole {
    param(
        [string]$RoleName,
        [string]$TrustPolicyPath
    )
    $null = aws iam get-role --role-name $RoleName 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Creating IAM role: $RoleName"
        aws iam create-role --role-name $RoleName --assume-role-policy-document "file://$TrustPolicyPath" | Out-Null
    } else {
        Write-Host "IAM role exists: $RoleName"
    }

    # Attach required policy every run; duplicate attachment is harmless.
    aws iam attach-role-policy `
        --role-name $RoleName `
        --policy-arn "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess" | Out-Null
}

function Build-And-PushImage {
    param(
        [string]$Dockerfile,
        [string]$LocalImage,
        [string]$RemoteImage
    )
    Write-Host "Building $LocalImage from $Dockerfile"
    docker build -f $Dockerfile -t $LocalImage .
    Write-Host "Tagging $LocalImage -> $RemoteImage"
    docker tag $LocalImage $RemoteImage
    Write-Host "Pushing $RemoteImage"
    docker push $RemoteImage
}

function Get-AppRunnerServiceArnByName {
    param(
        [string]$ServiceName,
        [string]$RegionName
    )
    $serviceArn = aws apprunner list-services `
        --region $RegionName `
        --query "ServiceSummaryList[?ServiceName=='$ServiceName'].ServiceArn | [0]" `
        --output text

    if ($serviceArn -eq "None" -or [string]::IsNullOrWhiteSpace($serviceArn)) {
        return $null
    }
    return $serviceArn.Trim()
}

function Create-Or-UpdateAppRunnerService {
    param(
        [string]$ServiceName,
        [string]$RegionName,
        [string]$AccessRoleArn,
        [string]$ImageIdentifier,
        [string]$ServiceArn
    )

    $sourceConfig = "AuthenticationConfiguration={AccessRoleArn=$AccessRoleArn},ImageRepository={ImageIdentifier=$ImageIdentifier,ImageRepositoryType=ECR,ImageConfiguration={Port=3000,RuntimeEnvironmentVariables={PORT=3000}}},AutoDeploymentsEnabled=true"

    if ([string]::IsNullOrWhiteSpace($ServiceArn)) {
        Write-Host "Creating App Runner service: $ServiceName"
        aws apprunner create-service `
            --service-name $ServiceName `
            --region $RegionName `
            --source-configuration $sourceConfig `
            --instance-configuration "Cpu=1 vCPU,Memory=2 GB" | Out-Null
    } else {
        Write-Host "Updating App Runner service: $ServiceName"
        aws apprunner update-service `
            --service-arn $ServiceArn `
            --region $RegionName `
            --source-configuration $sourceConfig | Out-Null
    }
}

Write-Step "Validating prerequisites"
Ensure-Command aws
Ensure-Command docker

if (-not (Test-Path "Dockerfile.web")) {
    throw "Run this script from the repository root. Missing Dockerfile.web."
}
if (-not (Test-Path "Dockerfile.mcp")) {
    throw "Run this script from the repository root. Missing Dockerfile.mcp."
}

$TrustPolicyPath = "deploy/aws/apprunner-ecr-trust-policy.json"
if (-not (Test-Path $TrustPolicyPath)) {
    throw "Missing trust policy file at $TrustPolicyPath"
}

Write-Step "Loading AWS account details"
$AccountId = (aws sts get-caller-identity --query Account --output text).Trim()
if ([string]::IsNullOrWhiteSpace($AccountId)) {
    throw "Failed to resolve AWS account ID."
}
$Registry = "$AccountId.dkr.ecr.$Region.amazonaws.com"
$AccessRoleArn = "arn:aws:iam::$AccountId:role/$AppRunnerEcrAccessRoleName"

Write-Host "AWS Account: $AccountId"
Write-Host "Region: $Region"
Write-Host "Registry: $Registry"

Write-Step "Ensuring ECR repositories exist"
Ensure-EcrRepository -RepositoryName $WebRepositoryName -RegionName $Region
Ensure-EcrRepository -RepositoryName $McpRepositoryName -RegionName $Region

Write-Step "Ensuring App Runner ECR access role exists"
Ensure-AppRunnerEcrAccessRole -RoleName $AppRunnerEcrAccessRoleName -TrustPolicyPath $TrustPolicyPath

Write-Step "Logging Docker into ECR"
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $Registry | Out-Null

$WebLocalImage = "$WebRepositoryName`:$ImageTag"
$McpLocalImage = "$McpRepositoryName`:$ImageTag"
$WebRemoteImage = "$Registry/$WebRepositoryName`:$ImageTag"
$McpRemoteImage = "$Registry/$McpRepositoryName`:$ImageTag"

if (-not $SkipBuild) {
    Write-Step "Building and pushing images"
    Build-And-PushImage -Dockerfile "Dockerfile.web" -LocalImage $WebLocalImage -RemoteImage $WebRemoteImage
    Build-And-PushImage -Dockerfile "Dockerfile.mcp" -LocalImage $McpLocalImage -RemoteImage $McpRemoteImage
} else {
    Write-Step "Skipping build and push (SkipBuild enabled)"
    Write-Host "Will redeploy existing images:"
    Write-Host "  $WebRemoteImage"
    Write-Host "  $McpRemoteImage"
}

Write-Step "Creating or updating App Runner services"
$WebServiceArn = Get-AppRunnerServiceArnByName -ServiceName $WebServiceName -RegionName $Region
$McpServiceArn = Get-AppRunnerServiceArnByName -ServiceName $McpServiceName -RegionName $Region

Create-Or-UpdateAppRunnerService `
    -ServiceName $WebServiceName `
    -RegionName $Region `
    -AccessRoleArn $AccessRoleArn `
    -ImageIdentifier $WebRemoteImage `
    -ServiceArn $WebServiceArn

Create-Or-UpdateAppRunnerService `
    -ServiceName $McpServiceName `
    -RegionName $Region `
    -AccessRoleArn $AccessRoleArn `
    -ImageIdentifier $McpRemoteImage `
    -ServiceArn $McpServiceArn

Write-Step "Fetching service URLs"
$WebServiceArn = Get-AppRunnerServiceArnByName -ServiceName $WebServiceName -RegionName $Region
$McpServiceArn = Get-AppRunnerServiceArnByName -ServiceName $McpServiceName -RegionName $Region

if ($WebServiceArn) {
    $WebUrl = aws apprunner describe-service --service-arn $WebServiceArn --region $Region --query "Service.ServiceUrl" --output text
    Write-Host "Web/API URL: https://$WebUrl"
}
if ($McpServiceArn) {
    $McpUrl = aws apprunner describe-service --service-arn $McpServiceArn --region $Region --query "Service.ServiceUrl" --output text
    Write-Host "MCP URL: https://$McpUrl/mcp"
}

Write-Step "Done"
Write-Host "Next: set environment variables in App Runner services if not already set."
