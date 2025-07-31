#!/bin/bash

# Script to configure GitHub secrets for Azure Network Benchmark workflows
# Usage: ./setup-github-secrets.sh

set -e

echo "=== GitHub Secrets Setup for Azure Network Benchmark ==="
echo

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Install it from https://cli.github.com/"
    exit 1
fi

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI (az) is not installed. Install it from https://docs.microsoft.com/cli/azure/install-azure-cli"
    exit 1
fi

# Check GitHub authentication
if ! gh auth status &> /dev/null; then
    echo "❌ You are not authenticated with GitHub CLI. Run 'gh auth login'"
    exit 1
fi

# Check Azure authentication
if ! az account show &> /dev/null; then
    echo "❌ You are not authenticated with Azure CLI. Run 'az login'"
    exit 1
fi

echo "✅ GitHub CLI and Azure CLI are installed and authenticated"
echo

# Get current Azure subscription ID
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
echo "🔍 Detected Azure subscription: $SUBSCRIPTION_ID"

# Ask for confirmation or allow manual input
read -p "Use this Azure subscription? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    read -p "Enter Azure subscription ID: " SUBSCRIPTION_ID
fi

# Create a service principal
echo
echo "🔧 Creating Azure service principal..."
SP_NAME="azure-netbench-sp-$(date +%s)"

SP_OUTPUT=$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --role "Contributor" \
    --scopes "/subscriptions/$SUBSCRIPTION_ID" \
    --output json) 

SP_OUTPUT=$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --role "Role Based Access Control Administrator" \
    --scopes "/subscriptions/$SUBSCRIPTION_ID" \
    --output json)

CLIENT_ID=$(echo $SP_OUTPUT | jq -r '.appId')
CLIENT_SECRET=$(echo $SP_OUTPUT | jq -r '.password')
TENANT_ID=$(echo $SP_OUTPUT | jq -r '.tenant')

echo "✅ Service principal created: $SP_NAME"
echo "   Client ID: $CLIENT_ID"
echo "   Tenant ID: $TENANT_ID"

# Terraform backend configuration (uses values from existing providers.tf)
TERRAFORM_STATE_RG="rg-net-prd-frc-001"
TERRAFORM_STATE_SA="sanetprdfrc001"
TERRAFORM_STATE_CONTAINER="tfstate"
TERRAFORM_STATE_SUBSCRIPTION_ID="$SUBSCRIPTION_ID"  # Use the same subscription by default

echo
echo "📦 Terraform backend configuration:"
echo "   Resource Group: $TERRAFORM_STATE_RG"
echo "   Storage Account: $TERRAFORM_STATE_SA"
echo "   Container: $TERRAFORM_STATE_CONTAINER"
echo "   Subscription ID: $TERRAFORM_STATE_SUBSCRIPTION_ID"

# Ask if the user wants to use a different subscription for Terraform state
read -p "Use a different subscription for Terraform state storage? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -p "Enter Terraform state subscription ID: " TERRAFORM_STATE_SUBSCRIPTION_ID
fi

# Configure GitHub secrets
echo
echo "🔐 Configuring GitHub secrets..."

gh secret set AZURE_SUBSCRIPTION_ID --body "$SUBSCRIPTION_ID"
gh secret set AZURE_CLIENT_ID --body "$CLIENT_ID"
gh secret set AZURE_CLIENT_SECRET --body "$CLIENT_SECRET"
gh secret set AZURE_TENANT_ID --body "$TENANT_ID"
gh secret set TERRAFORM_STATE_RG --body "$TERRAFORM_STATE_RG"
gh secret set TERRAFORM_STATE_SA --body "$TERRAFORM_STATE_SA"
gh secret set TERRAFORM_STATE_CONTAINER --body "$TERRAFORM_STATE_CONTAINER"
gh secret set TERRAFORM_STATE_SUBSCRIPTION_ID --body "$TERRAFORM_STATE_SUBSCRIPTION_ID"

echo "✅ All GitHub secrets have been configured"

echo
echo "🎉 Setup complete!"
echo
echo "📋 Summary of configured secrets:"
echo "   - AZURE_SUBSCRIPTION_ID"
echo "   - AZURE_CLIENT_ID"  
echo "   - AZURE_CLIENT_SECRET"
echo "   - AZURE_TENANT_ID"
echo "   - TERRAFORM_STATE_RG"
echo "   - TERRAFORM_STATE_SA"
echo "   - TERRAFORM_STATE_CONTAINER"
echo "   - TERRAFORM_STATE_SUBSCRIPTION_ID"
echo
echo "🚀 You can now trigger GitHub Actions workflows!"
echo "   - Check the 'Actions' tab of your repository"
echo "   - Workflows run automatically daily at 2 AM UTC"
echo "   - You can trigger them manually via the GitHub interface"
