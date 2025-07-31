# GitHub Actions Workflows - Azure Network Benchmark

This repository contains GitHub Actions workflows to automatically deploy Azure network benchmark infrastructure across different regions.

## Workflow Structure

Each region has its own workflow that:
1. Triggers daily at 2 AM UTC
2. Deploys Terraform infrastructure
3. Waits 5 minutes for benchmark completion
4. Automatically destroys infrastructure (even if deployment fails)

### Available Workflows

- `asia-region.yml` - Deploys in Asian regions
- `europe-region.yml` - Deploys in European regions  
- `france-region.yml` - Deploys in French regions
- `sweden-region.yml` - Deploys in Swedish regions
- `us-region.yml` - Deploys in US regions

## Required Configuration

### GitHub Secrets

You must configure the following secrets in your GitHub repository (Settings > Secrets and variables > Actions):

#### Azure Authentication
- `AZURE_SUBSCRIPTION_ID` - Your Azure subscription ID
- `AZURE_CLIENT_ID` - Service principal client ID
- `AZURE_CLIENT_SECRET` - Service principal secret  
- `AZURE_TENANT_ID` - Azure tenant ID

#### Terraform Backend
- `TERRAFORM_STATE_RG` - Resource group name for Terraform state
- `TERRAFORM_STATE_SA` - Storage account name for Terraform state
- `TERRAFORM_STATE_CONTAINER` - Container name for Terraform state
- `TERRAFORM_STATE_SUBSCRIPTION_ID` - Subscription ID where the Terraform state storage account is located

### Azure Service Principal Setup

To create a service principal with necessary permissions:

```bash
# Create the service principal
az ad sp create-for-rbac --name "azure-netbench-sp" \
  --role "Contributor" \
  --scopes "/subscriptions/YOUR_SUBSCRIPTION_ID"

# The command will return:
{
  "appId": "CLIENT_ID",
  "displayName": "azure-netbench-sp",
  "name": "CLIENT_ID", 
  "password": "CLIENT_SECRET",
  "tenant": "TENANT_ID"
}
```

### Terraform Backend Setup

Create a storage account to store Terraform states:

```bash
# Variables
RESOURCE_GROUP_NAME="rg-terraform-state"
STORAGE_ACCOUNT_NAME="satfstate$(date +%s)"
CONTAINER_NAME="tfstate"

# Create the resource group
az group create --name $RESOURCE_GROUP_NAME --location "France Central"

# Create the storage account
az storage account create \
  --resource-group $RESOURCE_GROUP_NAME \
  --name $STORAGE_ACCOUNT_NAME \
  --sku Standard_LRS \
  --encryption-services blob

# Create the container
az storage container create \
  --name $CONTAINER_NAME \
  --account-name $STORAGE_ACCOUNT_NAME
```

## Separate Terraform States

Each region uses a separate Terraform state to avoid conflicts:

- Asia: `asia.tfstate`
- Europe: `europe.tfstate`  
- France: `france.tfstate`
- Sweden: `sweden.tfstate`
- US: `us.tfstate`

## Manual Execution

You can manually trigger any workflow via the GitHub Actions interface or GitHub API:

```bash
# Manually trigger the Europe workflow
gh workflow run "Europe Region Network Benchmark"
```

## Monitoring and Logs

- Check the "Actions" tab of your repository to see workflow status
- Each job displays detailed Terraform logs
- Deployment failures do not prevent resource destruction

## Customization

### Modify Schedule

To change the execution schedule, modify the `cron` line in each workflow:

```yaml
schedule:
  - cron: '0 14 * * *'  # Runs at 2 PM UTC instead of 2 AM
```

### Modify Wait Duration

To change the benchmark wait duration, modify the `sleep` value:

```yaml
- name: Wait for benchmark completion
  if: steps.apply.outcome == 'success'
  run: sleep 600  # Wait 10 minutes instead of 5
```

## Troubleshooting

### Authentication Failure
- Verify that all Azure secrets are correctly configured
- Ensure the service principal has `Contributor` permissions

### Terraform Backend Failure
- Verify that the storage account and container exist
- Check the names in the `TERRAFORM_STATE_*` secrets

### Deployment Failure
- Check the job logs to see Terraform errors
- Verify Azure quotas in target regions
- Ensure VM sizes are available in the regions