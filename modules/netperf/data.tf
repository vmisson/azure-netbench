data "azurerm_storage_account" "this" {
  name                = var.storage_account_name
  resource_group_name = var.storage_account_resource_group
}