variable "location" {
  description = "The Azure region where the resources will be deployed."
  type        = string
}

variable "size" {
  description = "The size of the virtual machines."
  type        = string
  default     = "Standard_D8as_v5"
}

variable "storage_account_name" {
  description = "The name of the storage account to be used for boot diagnostics."
  type        = string
}

variable "storage_account_resource_group" {
  description = "The resource group where the storage account is located."
  type        = string
}
