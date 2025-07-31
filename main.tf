module "netperf" {
  source                         = "./modules/netperf"
  for_each                       = var.benchmark
  location                       = each.key
  size                           = each.value
  storage_account_resource_group = var.storage_account_resource_group
  storage_account_name           = var.storage_account_name
}
