import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { marshall } from '@aws-sdk/util-dynamodb';
import { createReceiptAdvice } from '../src/routes/receiptAdvice.js';

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
  ddbMock.reset();
});

// ---------------------------------------------------------------------------
// Helper: build a minimal valid despatch advice item in DynamoDB wire format
// ---------------------------------------------------------------------------
const makeDespatchItem = (status = 'DESPATCHED') =>
  marshall(
    {
      despatchAdviceId: 'DESPATCH-001',
      status,
      senderId: 'SUPPLIER-1',
      receiverId: 'BUYER-1',
    },
    { removeUndefinedValues: true }
  );

// ---------------------------------------------------------------------------
// Helper: build a minimal valid event
// ---------------------------------------------------------------------------
const makeEvent = (despatchAdviceId: string, body: any) => ({
  httpMethod: 'POST',
  path: `/despatch-advices/${despatchAdviceId}/receipt-advices`,
  pathParameters: { despatchAdviceId },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createReceiptAdvice', () => {
  test('returns 400 when despatchAdviceId is missing', async () => {
    const event = { httpMethod: 'POST', path: '/despatch-advices//receipt-advices', pathParameters: {}, body: '{}' };
    const res = await createReceiptAdvice(event);
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when body is invalid JSON', async () => {
    const event = { httpMethod: 'POST', path: '...', pathParameters: { despatchAdviceId: 'X' }, body: 'not-json' };
    const res = await createReceiptAdvice(event);
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when receiptLines is missing', async () => {
    const res = await createReceiptAdvice(makeEvent('DESPATCH-001', {}));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when receiptLines is empty', async () => {
    const res = await createReceiptAdvice(makeEvent('DESPATCH-001', { receiptLines: [] }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when a receiptLine is missing receivedQuantity', async () => {
    const res = await createReceiptAdvice(
      makeEvent('DESPATCH-001', { receiptLines: [{ id: 'line-1' }] })
    );
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when despatch advice is not found', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });

    const res = await createReceiptAdvice(
      makeEvent('DESPATCH-001', { receiptLines: [{ receivedQuantity: 5 }] })
    );
    expect(res.statusCode).toBe(404);
  });

  test('returns 409 when despatch advice is already RECEIVED', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem('RECEIVED') });

    const res = await createReceiptAdvice(
      makeEvent('DESPATCH-001', { receiptLines: [{ receivedQuantity: 5 }] })
    );
    expect(res.statusCode).toBe(409);
  });

  test('returns 200 with receiptAdviceId on success', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem('DESPATCHED') });
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(UpdateItemCommand).resolves({});

    const res = await createReceiptAdvice(
      makeEvent('DESPATCH-001', {
        receiptLines: [{ receivedQuantity: 10, shortQuantity: 2 }],
      })
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.receiptAdviceId).toBe('string');
    expect(body.receiptAdviceId.length).toBeGreaterThan(0);
  });

  test('still returns 200 even when the status update fails (non-fatal)', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem('DESPATCHED') });
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(UpdateItemCommand).rejects(new Error('update failed'));

    const res = await createReceiptAdvice(
      makeEvent('DESPATCH-001', { receiptLines: [{ receivedQuantity: 3 }] })
    );

    expect(res.statusCode).toBe(200);
  });

  test('returns 400 when receivedQuantity is not a number', async () => {
  const res = await createReceiptAdvice(
    makeEvent('DESPATCH-001', { receiptLines: [{ receivedQuantity: 'five' }] })
  );
  expect(res.statusCode).toBe(400);
});

  test('returns 500 when DynamoDB GetItem throws', async () => {
    ddbMock.on(GetItemCommand).rejects(new Error('connection error'));

    const res = await createReceiptAdvice(
      makeEvent('DESPATCH-001', { receiptLines: [{ receivedQuantity: 5 }] })
    );
    expect(res.statusCode).toBe(500);
  });

  test('returns 500 when DynamoDB PutItem throws', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem('DESPATCHED') });
    ddbMock.on(PutItemCommand).rejects(new Error('write error'));

    const res = await createReceiptAdvice(
      makeEvent('DESPATCH-001', { receiptLines: [{ receivedQuantity: 5 }] })
    );
    expect(res.statusCode).toBe(500);
  });

  test('returns 400 when pathParameters is null', async () => {
    const res = await createReceiptAdvice({
      httpMethod: 'POST',
      path: '/despatch-advices//receipt-advices',
      pathParameters: null,
      body: JSON.stringify({ receiptLines: [{ receivedQuantity: 5 }] }),
    });
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when pathParameters is undefined', async () => {
    const res = await createReceiptAdvice({
      httpMethod: 'POST',
      path: '/despatch-advices//receipt-advices',
      body: JSON.stringify({ receiptLines: [{ receivedQuantity: 5 }] }),
    });
    expect(res.statusCode).toBe(400);
  });

  test('handles despatch item with no senderId or receiverId', async () => {
    // covers the optional spread branches at lines 143-147
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({ despatchAdviceId: 'DESPATCH-001', status: 'DESPATCHED' }),
    });
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(UpdateItemCommand).resolves({});

    const res = await createReceiptAdvice(
      makeEvent('DESPATCH-001', { receiptLines: [{ receivedQuantity: 5 }] })
    );
    expect(res.statusCode).toBe(200);
  });

  test('handles receipt line with all optional fields present', async () => {
    // covers the optional field branches at line 137
    ddbMock.on(GetItemCommand).resolves({ Item: makeDespatchItem('DESPATCHED') });
    ddbMock.on(PutItemCommand).resolves({});
    ddbMock.on(UpdateItemCommand).resolves({});

    const res = await createReceiptAdvice(
      makeEvent('DESPATCH-001', {
        receiptLines: [{
          id: 'line-1',
          receivedQuantity: 10,
          receivedQuantityUnitCode: 'EA',
          shortQuantity: 2,
          shortQuantityUnitCode: 'EA',
          note: 'damaged',
          item: { name: 'Widget', description: 'A widget' },
        }],
      })
    );
    expect(res.statusCode).toBe(200);
  });
});