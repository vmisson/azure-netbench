variable "subscription_id" {
  description = "The ID of the Azure subscription where the resources will be created."
  type        = string
}

variable "benchmark" {
  description = "Region and size of VM to be used for the benchmark."
  type        = map(string)
}

variable "storage_account_name" {
  description = "The name of the storage account to be used for boot diagnostics."
  type        = string
}

variable "storage_account_resource_group" {
  description = "The resource group where the storage account is located."
  type        = string
}
