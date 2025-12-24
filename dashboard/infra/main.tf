terraform {
  required_version = ">= 1.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.0"
    }
    azurecaf = {
      source  = "aztfmod/azurecaf"
      version = "~>1.2.0"
    }
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
  storage_use_azuread = true
}

data "azurerm_client_config" "current" {}

# Resource naming
resource "azurecaf_name" "resource_group" {
  name          = var.environment_name
  resource_type = "azurerm_resource_group"
  random_length = 0
}

resource "azurecaf_name" "static_web_app" {
  name          = var.environment_name
  resource_type = "azurerm_static_site"
  random_length = 0
}

resource "azurecaf_name" "function_storage" {
  name          = var.environment_name
  resource_type = "azurerm_storage_account"
  random_length = 0
  suffixes      = ["func"]
}

resource "azurecaf_name" "app_service_plan" {
  name          = var.environment_name
  resource_type = "azurerm_app_service_plan"
  random_length = 0
}

resource "azurecaf_name" "function_app" {
  name          = var.environment_name
  resource_type = "azurerm_function_app"
  random_length = 0
}

# Resource Group
resource "azurerm_resource_group" "main" {
  name     = azurecaf_name.resource_group.result
  location = var.location

  tags = local.tags
}

# Data source to reference existing storage account
data "azurerm_storage_account" "netbench" {
  name                = "sanetprdfrc001"
  resource_group_name = "rg-net-prd-frc-001"
}

# Static Web App - Minimal version
resource "azurerm_static_web_app" "main" {
  name                = azurecaf_name.static_web_app.result
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku_tier            = "Standard"
  sku_size            = "Standard"

  identity {
    type = "SystemAssigned"
  }

  tags = merge(local.tags, {
    "azd-service-name" = "network-benchmark-web"
  })
}

# Storage Account for Function App
resource "azurerm_storage_account" "function" {
  name                     = azurecaf_name.function_storage.result
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  
  tags = merge(local.tags, {
    "SecurityControl" = "Ignore"
  })
}

# App Service Plan for Function App
resource "azurerm_service_plan" "main" {
  name                = azurecaf_name.app_service_plan.result
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "Y1"
  
  tags = local.tags
}

# Function App
resource "azurerm_linux_function_app" "main" {
  name                = azurecaf_name.function_app.result
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  
  storage_account_name       = azurerm_storage_account.function.name
  storage_account_access_key = azurerm_storage_account.function.primary_access_key
  service_plan_id            = azurerm_service_plan.main.id
  
  identity {
    type = "SystemAssigned"
  }

  app_settings = {
    "FUNCTIONS_WORKER_RUNTIME"                    = "node"
    "WEBSITE_NODE_DEFAULT_VERSION"                = "~18"
    "AZURE_STORAGE_ACCOUNT_NAME"                  = data.azurerm_storage_account.netbench.name
    "AZURE_STORAGE_TABLE_NAME"                    = "perf"
    "WEBSITE_CONTENTAZUREFILECONNECTIONSTRING"    = "DefaultEndpointsProtocol=https;AccountName=${azurerm_storage_account.function.name};AccountKey=${azurerm_storage_account.function.primary_access_key};EndpointSuffix=core.windows.net"
    "AzureWebJobsStorage"                         = "DefaultEndpointsProtocol=https;AccountName=${azurerm_storage_account.function.name};AccountKey=${azurerm_storage_account.function.primary_access_key};EndpointSuffix=core.windows.net"
    "WEBSITE_CONTENTSHARE"                        = "${azurecaf_name.function_app.result}-content"
  }

  site_config {
    application_stack {
      node_version = "18"
    }
    
    cors {
      allowed_origins = ["*"]
      support_credentials = false
    }
  }

  tags = merge(local.tags, {
    "azd-service-name" = "network-benchmark-api"
  })
}

# Role assignment for Static Web App to access Storage Table
resource "azurerm_role_assignment" "static_web_app_storage" {
  scope                = data.azurerm_storage_account.netbench.id
  role_definition_name = "Storage Table Data Reader"
  principal_id         = azurerm_static_web_app.main.identity[0].principal_id
}

# Role assignment for Function App to access Storage Table
resource "azurerm_role_assignment" "function_app_storage" {
  scope                = data.azurerm_storage_account.netbench.id
  role_definition_name = "Storage Table Data Reader"
  principal_id         = azurerm_linux_function_app.main.identity[0].principal_id
}

locals {
  tags = {
    "azd-env-name" = var.environment_name
  }
}
