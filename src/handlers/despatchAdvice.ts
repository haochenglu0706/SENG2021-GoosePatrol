import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TABLE_NAME = process.env.TABLE_NAME || 'StackfeedDocuments';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const documentId = uuidv4();

    await client.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        documentId: { S: documentId },
        documentType: { S: 'DESPATCH_ADVICE' },
        status: { S: 'SENT' },
        supplierId: { S: body.supplierId || '' },
        customerId: { S: body.customerId || '' },
        createdAt: { S: new Date().toISOString() },
      }
    }));

    return {
      statusCode: 201,
      body: JSON.stringify({ documentId, message: 'Despatch advice created' })
    };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error', error: String(error) })
    };
  }
};