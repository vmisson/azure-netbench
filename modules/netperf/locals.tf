locals {
  availabilityZoneMappings = jsondecode(file("availabilityZoneMappings.json"))

  locationMappings = {
    for location in local.availabilityZoneMappings :
    location.name => {
      for mapping in location.availabilityZoneMappings :
      split("-", mapping.physicalZone)[1] => mapping.logicalZone
    }
  }
}
