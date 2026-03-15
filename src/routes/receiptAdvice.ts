import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-southeast-2' });
const TABLE_NAME = process.env.TABLE_NAME || 'StackfeedDocuments';

export const getReceiptAdvice = async (receiptAdviceId: string) => {
  const result = await client.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: {
      documentId: { S: receiptAdviceId },
      documentType: { S: 'RECEIPT_ADVICE' }
    }
  }));
  return result.Item;
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const receiptAdviceId = event.pathParameters?.receiptAdviceId;

    if (!receiptAdviceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'receiptAdviceId is required' })
      };
    }

    const item = await getReceiptAdvice(receiptAdviceId);

    if (!item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: 'Receipt advice not found' })
      };
    }

    if (item.status?.S === 'FULLY_RECEIVED') {
      return {
        statusCode: 409,
        body: JSON.stringify({ message: 'Already fully received' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        receiptAdviceId: item.documentId?.S,
        documentType: item.documentType?.S,
        status: item.status?.S,
        createdAt: item.createdAt?.S,
      })
    };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error', error: String(error) })
    };
  }
};