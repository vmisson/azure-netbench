# Organisation des fichiers tfvars par DC/région

Cette réorganisation permet une gestion plus granulaire de l'exécution des benchmarks en regroupant les régions Azure par proximité géographique et logique des data centers.

## Structure des fichiers

### Amériques
- `us-east.tfvars` - Côte Est des États-Unis (eastus, eastus2)
- `us-west.tfvars` - Côte Ouest des États-Unis (westus2, westus3)
- `us-central.tfvars` - Centre des États-Unis (centralus, southcentralus)
- `canada.tfvars` - Canada (canadacentral)
- `mexico.tfvars` - Mexique (mexicocentral)
- `south-america.tfvars` - Amérique du Sud (brazilsouth, chilecentral)

### Europe
- `europe-north.tfvars` - Europe du Nord (westeurope, northeurope, norwayeast)
- `western-europe.tfvars` - Europe de l'Ouest (uksouth, francecentral)
- `dach-region.tfvars` - Région DACH (germanywestcentral, switzerlandnorth)
- `europe-south.tfvars` - Europe du Sud (spaincentral)
- `nordic-alpine.tfvars` - Régions Nordique-Alpine (swedencentral, austriaeast)
- `mediterranean-central.tfvars` - Méditerranée-Europe Centrale (italynorth, polandcentral)

### Asie-Pacifique
- `asia-east-1.tfvars` - Asie de l'Est (eastasia, southeastasia)
- `japan.tfvars` - Japon (japaneast, japanwest)
- `korea.tfvars` - Corée (koreacentral)
- `asia-southeast.tfvars` - Asie du Sud-Est (malaysiawest, indonesiacentral)
- `india.tfvars` - Inde (centralindia)

### Moyen-Orient
- `middle-east-gulf.tfvars` - Golfe Persique (uaenorth, qatarcentral)
- `israel.tfvars` - Israël (israelcentral)

### Autres régions
- `oceania.tfvars` - Océanie (australiaeast, newzealandnorth)
- `africa.tfvars` - Afrique (southafricanorth)

## Avantages de cette organisation

1. **Exécution parallèle** : Possibilité d'exécuter les benchmarks par région/DC en parallèle
2. **Gestion des erreurs** : Isolation des problèmes par région
3. **Optimisation des coûts** : Déploiement sélectif par région selon les besoins
4. **Latence réseau** : Regroupement logique basé sur la proximité géographique
5. **Maintenance** : Mise à jour et maintenance plus facile par région

## Utilisation

```bash
# Exécuter un benchmark pour une région spécifique
terraform apply -var-file="tfvars-by-dc/us-east.tfvars"

# Exécuter plusieurs régions en parallèle
terraform apply -var-file="tfvars-by-dc/europe-north.tfvars" &
terraform apply -var-file="tfvars-by-dc/europe-west-1.tfvars" &
terraform apply -var-file="tfvars-by-dc/asia-east-1.tfvars" &
```

## Migration depuis l'ancienne structure

Les anciens fichiers tfvars par continent sont conservés dans le répertoire `tfvars/` pour compatibilité. Cette nouvelle structure dans `tfvars-by-dc/` offre une granularité plus fine.
