"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client = new client_dynamodb_1.DynamoDBClient({
    region: "ap-southeast-2",
    endpoint: "http://localhost:8000"
});
await client.send(new client_dynamodb_1.CreateTableCommand({
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
//# sourceMappingURL=createTables.js.map