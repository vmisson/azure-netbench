output "resource_group_name" {
  description = "The name of the resource group where the resources are deployed."
  value       = values(module.netperf)[0].resource_group_name
}