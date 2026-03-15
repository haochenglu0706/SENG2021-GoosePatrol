import { handler, getReceiptAdvice } from '../src/handlers/Receipt-Advice/receiptAdvice';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
  ddbMock.reset(); //This resets the table
});

describe('getReceiptAdvice', () => {
  test('returns item when found', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: {
        documentId: { S: 'RECEIPT-001' },
        documentType: { S: 'RECEIPT_ADVICE' },
        status: { S: 'PENDING' },
        createdAt: { S: '2026-03-15T00:00:00.000Z' }
      }
    });

    const result = await getReceiptAdvice('RECEIPT-001');
    expect(result?.documentId?.S).toBe('RECEIPT-001');
  });

  test('returns undefined when not found', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });
    const result = await getReceiptAdvice('INVALID-ID');
    expect(result).toBeUndefined();
  });
});

describe('handler', () => {
  test('returns 400 when receiptAdviceId is missing', async () => {
    const event = { pathParameters: null } as any;
    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  test('returns 404 when receipt advice not found', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });
    const event = { pathParameters: { receiptAdviceId: 'INVALID-ID' } } as any;
    const response = await handler(event);
    expect(response.statusCode).toBe(404);
  });

  test('returns 409 when already fully received', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: {
        documentId: { S: 'RECEIPT-001' },
        documentType: { S: 'RECEIPT_ADVICE' },
        status: { S: 'FULLY_RECEIVED' },
        createdAt: { S: '2026-03-15T00:00:00.000Z' }
      }
    });
    const event = { pathParameters: { receiptAdviceId: 'RECEIPT-001' } } as any;
    const response = await handler(event);
    expect(response.statusCode).toBe(409);
  });

  test('returns 200 with receipt advice data', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: {
        documentId: { S: 'RECEIPT-001' },
        documentType: { S: 'RECEIPT_ADVICE' },
        status: { S: 'PENDING' },
        createdAt: { S: '2026-03-15T00:00:00.000Z' }
      }
    });
    const event = { pathParameters: { receiptAdviceId: 'RECEIPT-001' } } as any;
    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.receiptAdviceId).toBe('RECEIPT-001');
  });
});