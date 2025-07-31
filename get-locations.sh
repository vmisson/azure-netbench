#!/bin/bash
az rest --method get --uri "/subscriptions/$1/locations?api-version=2022-12-01" --query 'value[?availabilityZoneMappings != `null`].{displayName: displayName, name: name, availabilityZoneMappings: availabilityZoneMappings}' --output json > availabilityZoneMappings.json
