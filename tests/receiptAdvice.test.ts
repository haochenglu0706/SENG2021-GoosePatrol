import { getReceiptAdvice } from '../src/routes/receiptAdvice.js';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { marshall } from '@aws-sdk/util-dynamodb';

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('getReceiptAdvice', () => {

  test('returns 400 when receiptAdviceId is missing', async () => {
    const event = { pathParameters: null };
    const response = await getReceiptAdvice(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('BadRequest');
  });

  test('returns 404 when receipt advice not found', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });
    const event = { pathParameters: { receiptAdviceId: 'INVALID-ID' } };
    const response = await getReceiptAdvice(event);
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('NotFound');
  });

  test('returns 409 when already fully received', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        receiptAdviceId: 'RECEIPT-001',
        despatchAdviceId: 'DESPATCH-001',
        documentStatusCode: 'FULLY_RECEIVED',
        issueDate: '2026-03-15',
      })
    });
    const event = { pathParameters: { receiptAdviceId: 'RECEIPT-001' } };
    const response = await getReceiptAdvice(event);
    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Conflict');
  });

  test('returns 200 with receipt advice document', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        receiptAdviceId: 'RECEIPT-001',
        despatchAdviceId: 'DESPATCH-001',
        documentStatusCode: 'RECEIVED',
        issueDate: '2026-03-15',
        receiptLines: [
          {
            id: 'LINE-001',
            receivedQuantity: 10,
          }
        ]
      })
    });
    const event = { pathParameters: { receiptAdviceId: 'RECEIPT-001' } };
    const response = await getReceiptAdvice(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.receiptAdviceId).toBe('RECEIPT-001');
    expect(body.documentStatusCode).toBe('RECEIVED');
  });

  test('returns 500 on DynamoDB error', async () => {
    ddbMock.on(GetItemCommand).rejects(new Error('DynamoDB connection error'));
    const event = { pathParameters: { receiptAdviceId: 'RECEIPT-001' } };
    const response = await getReceiptAdvice(event);
    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('InternalServerError');
  });

});
