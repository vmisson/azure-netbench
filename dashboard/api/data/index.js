const { TableClient } = require('@azure/data-tables');
const { DefaultAzureCredential } = require('@azure/identity');

module.exports = async function (context, req) {
    context.log('Data function called');
    
    try {
        // Configuration - utilisez vos vraies valeurs
        const storageAccountName = process.env.AZURE_STORAGE_ACCOUNT_NAME || 'sanetprdfrc001';
        const tableName = process.env.AZURE_STORAGE_TABLE_NAME || 'perf';
        const maxResults = parseInt(process.env.MAX_RESULTS || '200000'); // Limite configurable, défaut 200000
        
        context.log(`Connecting to storage account: ${storageAccountName}, table: ${tableName}, max results: ${maxResults}`);
        
        // Construire l'URL du service de table
        const tableServiceUrl = `https://${storageAccountName}.table.core.windows.net`;
        
        // Créer le client de table avec l'identité managée
        const tableClient = new TableClient(
            tableServiceUrl,
            tableName,
            new DefaultAzureCredential()
        );

        // Requête pour récupérer les données des 30 derniers jours
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        context.log(`Querying data from ${thirtyDaysAgo.toISOString()}`);
        
        const entities = [];
        
        // Lister les entités avec limite configurable
        const pageableEntities = tableClient.listEntities({
            filter: `Timestamp ge datetime'${thirtyDaysAgo.toISOString()}'`
        });

        let count = 0;
        for await (const entity of pageableEntities) {
            if (count >= maxResults) {
                context.log(`Reached maximum limit of ${maxResults} entities`);
                break;
            }
            
            entities.push({
                PartitionKey: entity.partitionKey,
                RowKey: entity.rowKey,
                Source: entity.Source,
                Destination: entity.Destination,
                Bandwidth: entity.Bandwidth,
                Latency: entity.Latency,
                Timestamp: entity.timestamp
            });
            count++;
        }
        
        context.log(`Successfully retrieved ${entities.length} entities`);

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify(entities)
        };

    } catch (error) {
        context.error('Error retrieving data from Azure Table Storage:', error);
        
        // En cas d'erreur, retourner des données de test
        const fallbackData = [
            {
                PartitionKey: "fallback",
                RowKey: "1", 
                Source: "East US",
                Destination: "West US",
                Bandwidth: "1000",
                Latency: "50",
                Timestamp: new Date().toISOString()
            },
            {
                PartitionKey: "fallback",
                RowKey: "2",
                Source: "North Europe", 
                Destination: "West Europe",
                Bandwidth: "1500",
                Latency: "25",
                Timestamp: new Date().toISOString()
            }
        ];

        context.res = {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify(fallbackData)
        };
    }
};
