terraform {
  required_version = ">= 1.0.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">=4.0.0"
    }
    azapi = {
      source  = "Azure/azapi"
      version = ">=1.0.0"
    }
  }
  backend "azurerm" {
    use_azuread_auth     = true
    subscription_id      = ""
    resource_group_name  = ""
    storage_account_name = ""
    container_name       = ""
    key                  = ""
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}