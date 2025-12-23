module "locations" {
  source   = "azurerm/locations/azure"
  location = var.location
}

module "resource_group" {
  source      = "azurerm/resources/azure//modules/resource_group"
  location    = var.location
  environment = "tst"
  workload    = "netperf"
  instance    = "001"
}

module "virtual_network" {
  source              = "azurerm/resources/azure//modules/virtual_network"
  location            = var.location
  environment         = "tst"
  workload            = "netperf"
  instance            = "001"
  resource_group_name = module.resource_group.name
  address_space       = ["10.200.0.0/24"]
}

module "subnet" {
  source               = "azurerm/resources/azure//modules/subnet"
  location             = var.location
  environment          = "tst"
  workload             = "netperf"
  instance             = "001"
  resource_group_name  = module.resource_group.name
  virtual_network_name = module.virtual_network.name
  address_prefixes     = ["10.200.0.0/25"]
}

module "linux_virtual_machine_server" {
  count                         = 3
  source                        = "azurerm/resources/azure//modules/linux_virtual_machine"
  location                      = var.location
  environment                   = module.locations.short_name
  workload                      = "srv"
  instance                      = "az${count.index + 1}"
  resource_group_name           = module.resource_group.name
  subnet_id                     = module.subnet.id
  size                          = var.size
  priority                      = "Spot"
  zone                          = lookup(local.locationMappings[var.location], "az${count.index + 1}")
  custom_data                   = base64encode(file("${path.module}/cloud-init-server.txt"))
  enable_accelerated_networking = true
  tags = {
    "logical-zone"  = lookup(local.locationMappings[var.location], "az${count.index + 1}")
    "physical-zone" = "az${count.index + 1}"
  }
}

module "linux_virtual_machine_client_1" {
  source                        = "azurerm/resources/azure//modules/linux_virtual_machine"
  location                      = var.location
  environment                   = module.locations.short_name
  workload                      = "cli"
  instance                      = "az1"
  resource_group_name           = module.resource_group.name
  subnet_id                     = module.subnet.id
  size                          = var.size
  priority                      = "Spot"  
  zone                          = lookup(local.locationMappings[var.location], "az1")
  custom_data                   = base64encode(file("${path.module}/cloud-init-client.txt"))
  enable_accelerated_networking = true
  identity_type                 = "UserAssigned"
  identity_ids = [
    azurerm_user_assigned_identity.this.id
  ]
  tags = {
    "logical-zone"  = lookup(local.locationMappings[var.location], "az1")
    "physical-zone" = "az1"
  }
  depends_on = [module.linux_virtual_machine_server]
}

resource "time_sleep" "wait_client_2" {
  create_duration = "60s"
  depends_on      = [module.linux_virtual_machine_client_1]
}

module "linux_virtual_machine_client_2" {
  source                        = "azurerm/resources/azure//modules/linux_virtual_machine"
  location                      = var.location
  environment                   = module.locations.short_name
  workload                      = "cli"
  instance                      = "az2"
  resource_group_name           = module.resource_group.name
  subnet_id                     = module.subnet.id
  size                          = var.size
  priority                      = "Spot"  
  zone                          = lookup(local.locationMappings[var.location], "az2")
  custom_data                   = base64encode(file("${path.module}/cloud-init-client.txt"))
  enable_accelerated_networking = true
  identity_type                 = "UserAssigned"
  identity_ids = [
    azurerm_user_assigned_identity.this.id
  ]
  tags = {
    "logical-zone"  = lookup(local.locationMappings[var.location], "az2")
    "physical-zone" = "az2"
  }
  depends_on = [time_sleep.wait_client_2]
}

resource "time_sleep" "wait_client_3" {
  create_duration = "60s"
  depends_on      = [module.linux_virtual_machine_client_2]
}

module "linux_virtual_machine_client_3" {
  source                        = "azurerm/resources/azure//modules/linux_virtual_machine"
  location                      = var.location
  environment                   = module.locations.short_name
  workload                      = "cli"
  instance                      = "az3"
  resource_group_name           = module.resource_group.name
  subnet_id                     = module.subnet.id
  size                          = var.size
  priority                      = "Spot"  
  zone                          = lookup(local.locationMappings[var.location], "az3")
  custom_data                   = base64encode(file("${path.module}/cloud-init-client.txt"))
  enable_accelerated_networking = true
  identity_type                 = "UserAssigned"
  identity_ids = [
    azurerm_user_assigned_identity.this.id
  ]
  tags = {
    "logical-zone"  = lookup(local.locationMappings[var.location], "az3")
    "physical-zone" = "az3"
  }
  depends_on = [time_sleep.wait_client_3]
}

resource "azurerm_user_assigned_identity" "this" {
  location            = var.location
  name                = "mi-net-tst-${module.locations.short_name}-001"
  resource_group_name = module.resource_group.name
}

resource "azurerm_role_assignment" "this" {
  scope                = data.azurerm_storage_account.this.id
  role_definition_name = "Storage Table Data Contributor"
  principal_id         = azurerm_user_assigned_identity.this.principal_id
}

resource "azurerm_private_endpoint" "this" {
  name                = "${data.azurerm_storage_account.this.name}-${module.locations.short_name}-pe"
  location            = var.location
  resource_group_name = module.resource_group.name
  subnet_id           = module.subnet.id

  private_service_connection {
    name                           = "${data.azurerm_storage_account.this.name}-${module.locations.short_name}-psc"
    private_connection_resource_id = data.azurerm_storage_account.this.id
    subresource_names              = ["table"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "terraform-dns-group"
    private_dns_zone_ids = [azurerm_private_dns_zone.this.id]
  }
}

resource "azurerm_private_dns_zone" "this" {
  name                = "privatelink.table.core.windows.net"
  resource_group_name = module.resource_group.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  name                  = "${module.locations.short_name}-link"
  resource_group_name   = module.resource_group.name
  private_dns_zone_name = azurerm_private_dns_zone.this.name
  virtual_network_id    = module.virtual_network.id
}