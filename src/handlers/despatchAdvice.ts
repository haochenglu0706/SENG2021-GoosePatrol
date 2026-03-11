import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME = process.env.TABLE_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const body = JSON.parse(event.body || '{}');
  const documentId = uuidv4();

  await client.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      documentId: { S: documentId },
      documentType: { S: 'DESPATCH_ADVICE' },
      status: { S: 'SENT' },
      createdAt: { S: new Date().toISOString() },
    }
  }));

  return {
    statusCode: 201,
    body: JSON.stringify({ documentId, message: 'Despatch advice created' })
  };
};