import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({
  region: "ap-southeast-2",
  endpoint: "http://localhost:8000"
});

await client.send(new CreateTableCommand({
  TableName: "StackfeedDocuments",
  AttributeDefinitions: [
    { AttributeName: "documentId", AttributeType: "S" }
  ],
  KeySchema: [
    { AttributeName: "documentId", KeyType: "HASH" }
  ],
  BillingMode: "PAY_PER_REQUEST"
}));

console.log("Table created");