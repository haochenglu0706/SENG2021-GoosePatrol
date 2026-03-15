import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/db.js", () => ({
    dynamo: {
        send: jest.fn(),
    },
    CLIENTS_TABLE: "Clients",
    SESSIONS_TABLE: "Sessions",
    DESPATCH_ADVICES_TABLE: "DespatchAdvices",
}));

const { createDespatchAdvice, getDespatchAdvice, updateDespatchAdvice,
    listDespatchAdvices, deleteDespatchAdvice, cancelFulfilment } = await import("../src/routes/despatchAdvice.js");
const { dynamo } = await import("../src/db.js");

const mockSend = dynamo.send as ReturnType<typeof jest.fn>;

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Shared fixtures /////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

// Minimum valid DespatchAdvice body per swagger.yaml schema:
// required fields: documentId, senderId, receiverId, despatchSupplierParty
const VALID_DESPATCH_ADVICE = {
    documentId: "DA-001",
    senderId: "sender-123",
    receiverId: "receiver-456",
    despatchSupplierParty: {
        customerAssignedAccountId: "account-123",
        party: {
            name: "Acme Supplies",
            postalAddress: {
                streetName: "1 Warehouse Rd",
                buildingName: "Acme HQ",
                buildingNumber: "1",
                cityName: "Sydney",
                postalZone: "2000",
                country: "Australia",
                addressLine: "Level 1",
                countryIdentificationCode: "AU",
            },
            contact: {
                name: "Jane Smith",
                telephone: "0412345678",
                telefax: "0298765432",
                email: "jane@acme.com",
            },
        },
    },
};

// What DynamoDB returns when a document is found (PutItem/GetItem response)
const MOCK_DYNAMODB_ITEM = {
    documentId: { S: "DA-001" },
    senderId: { S: "sender-123" },
    receiverId: { S: "receiver-456" },
    despatchSupplierParty: {
        M: {
            customerAssignedAccountId: { S: "account-123" },
            party: {
                M: {
                    name: { S: "Acme Supplies" },
                    postalAddress: {
                        M: {
                            streetName: { S: "1 Warehouse Rd" },
                            buildingName: { S: "Acme HQ" },
                            buildingNumber: { S: "1" },
                            cityName: { S: "Sydney" },
                            postalZone: { S: "2000" },
                            country: { S: "Australia" },
                            addressLine: { S: "Level 1" },
                            countryIdentificationCode: { S: "AU" },
                        },
                    },
                    contact: {
                        M: {
                            name: { S: "Jane Smith" },
                            telephone: { S: "0412345678" },
                            telefax: { S: "0298765432" },
                            email: { S: "jane@acme.com" },
                        },
                    },
                },
            },
        },
    },
};

/// /////////////////////////////////////////////////////////////////////////////

describe("despatchAdvice", () => {
    beforeEach(() => {
        mockSend.mockReset();
    });

    /// /////////////////////////////////////////////////////////////////////////
    /// ////////////////////// createDespatchAdvice /////////////////////////////
    /// /////////////////////////////////////////////////////////////////////////

    describe("createDespatchAdvice", () => {

        // -----------------------------------------------------------------
        // Success cases
        // -----------------------------------------------------------------

        test("returns 201 when despatch advice is successfully created", async () => {
            mockSend.mockResolvedValueOnce({});

            const result = await createDespatchAdvice(VALID_DESPATCH_ADVICE);

            expect(result.statusCode).toBe(201);
        });

        test("returns the created document in the response body", async () => {
            mockSend.mockResolvedValueOnce({});

            const result = await createDespatchAdvice(VALID_DESPATCH_ADVICE);
            const body = JSON.parse(result.body);

            expect(body).toMatchObject({
                documentId: "DA-001",
                senderId: "sender-123",
                receiverId: "receiver-456",
            });
        });

        test("response body includes despatchSupplierParty", async () => {
            mockSend.mockResolvedValueOnce({});

            const result = await createDespatchAdvice(VALID_DESPATCH_ADVICE);
            const body = JSON.parse(result.body);

            expect(body.despatchSupplierParty).toBeDefined();
            expect(body.despatchSupplierParty.party.name).toBe("Acme Supplies");
        });

        test("response body includes nested postalAddress fields", async () => {
            mockSend.mockResolvedValueOnce({});

            const result = await createDespatchAdvice(VALID_DESPATCH_ADVICE);
            const body = JSON.parse(result.body);

            const address = body.despatchSupplierParty.party.postalAddress;
            expect(address.streetName).toBe("1 Warehouse Rd");
            expect(address.cityName).toBe("Sydney");
            expect(address.postalZone).toBe("2000");
            expect(address.countryIdentificationCode).toBe("AU");
        });

        test("response body includes nested contact fields", async () => {
            mockSend.mockResolvedValueOnce({});

            const result = await createDespatchAdvice(VALID_DESPATCH_ADVICE);
            const body = JSON.parse(result.body);

            const contact = body.despatchSupplierParty.party.contact;
            expect(contact.name).toBe("Jane Smith");
            expect(contact.email).toBe("jane@acme.com");
        });

        test("calls dynamo.send exactly once (PutItem)", async () => {
            mockSend.mockResolvedValueOnce({});

            await createDespatchAdvice(VALID_DESPATCH_ADVICE);

            expect(mockSend).toHaveBeenCalledTimes(1);
        });

        test("works without optional customerAssignedAccountId", async () => {
            mockSend.mockResolvedValueOnce({});

            const bodyWithoutAccountId = {
                ...VALID_DESPATCH_ADVICE,
                despatchSupplierParty: {
                    party: VALID_DESPATCH_ADVICE.despatchSupplierParty.party,
                },
            };

            const result = await createDespatchAdvice(bodyWithoutAccountId);
            expect(result.statusCode).toBe(201);
        });

        test("works without optional contact in party", async () => {
            mockSend.mockResolvedValueOnce({});

            const bodyWithoutContact = {
                ...VALID_DESPATCH_ADVICE,
                despatchSupplierParty: {
                    ...VALID_DESPATCH_ADVICE.despatchSupplierParty,
                    party: {
                        name: "Acme Supplies",
                        postalAddress:
                            VALID_DESPATCH_ADVICE.despatchSupplierParty.party.postalAddress,
                    },
                },
            };

            const result = await createDespatchAdvice(bodyWithoutContact);
            expect(result.statusCode).toBe(201);
        });

        test("works with only required postalAddress fields", async () => {
            mockSend.mockResolvedValueOnce({});

            const bodyMinimalAddress = {
                ...VALID_DESPATCH_ADVICE,
                despatchSupplierParty: {
                    party: {
                        name: "Acme Supplies",
                        postalAddress: {
                            streetName: "1 Warehouse Rd",
                            cityName: "Sydney",
                            postalZone: "2000",
                            countryIdentificationCode: "AU",
                        },
                    },
                },
            };

            const result = await createDespatchAdvice(bodyMinimalAddress);
            expect(result.statusCode).toBe(201);
        });

        // -----------------------------------------------------------------
        // despatchAdviceId — partition key sent to DynamoDB
        // -----------------------------------------------------------------

        test("sends despatchAdviceId as partition key to DynamoDB", async () => {
            mockSend.mockResolvedValueOnce({});

            await createDespatchAdvice(VALID_DESPATCH_ADVICE);

            const sentCommand = mockSend.mock.calls[0][0];
            const sentItem = sentCommand.input.Item;

            expect(sentItem).toHaveProperty("despatchAdviceId");
            expect(sentItem.despatchAdviceId).toMatchObject({ S: expect.any(String) });
        });

        test("despatchAdviceId sent to DynamoDB is a valid UUID", async () => {
            mockSend.mockResolvedValueOnce({});

            await createDespatchAdvice(VALID_DESPATCH_ADVICE);

            const sentCommand = mockSend.mock.calls[0][0];
            const sentItem = sentCommand.input.Item;
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

            expect(sentItem.despatchAdviceId.S).toMatch(uuidRegex);
        });

        test("response body includes despatchAdviceId", async () => {
            mockSend.mockResolvedValueOnce({});

            const result = await createDespatchAdvice(VALID_DESPATCH_ADVICE);
            const body = JSON.parse(result.body);

            expect(body).toHaveProperty("despatchAdviceId");
            expect(typeof body.despatchAdviceId).toBe("string");
        });

        test("each call generates a unique despatchAdviceId", async () => {
            mockSend.mockResolvedValue({});

            const result1 = await createDespatchAdvice(VALID_DESPATCH_ADVICE);
            const result2 = await createDespatchAdvice({
                ...VALID_DESPATCH_ADVICE,
                documentId: "DA-002",
            });

            const id1 = JSON.parse(result1.body).despatchAdviceId;
            const id2 = JSON.parse(result2.body).despatchAdviceId;

            expect(id1).not.toBe(id2);
        });

        // -----------------------------------------------------------------
        // Missing required fields — swagger schema: documentId, senderId,
        // receiverId, despatchSupplierParty are all required
        // -----------------------------------------------------------------

        describe("returns 400 when required fields are missing", () => {
            test("missing documentId", async () => {
                const { documentId, ...body } = VALID_DESPATCH_ADVICE;

                const result = await createDespatchAdvice(body);

                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });

            test("missing senderId", async () => {
                const { senderId, ...body } = VALID_DESPATCH_ADVICE;

                const result = await createDespatchAdvice(body);

                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });

            test("missing receiverId", async () => {
                const { receiverId, ...body } = VALID_DESPATCH_ADVICE;

                const result = await createDespatchAdvice(body);

                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });

            test("missing despatchSupplierParty", async () => {
                const { despatchSupplierParty, ...body } = VALID_DESPATCH_ADVICE;

                const result = await createDespatchAdvice(body);

                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });

            test("missing party inside despatchSupplierParty", async () => {
                const result = await createDespatchAdvice({
                    ...VALID_DESPATCH_ADVICE,
                    despatchSupplierParty: {
                        customerAssignedAccountId: "account-123",
                    },
                });

                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });

            test("missing party.name inside despatchSupplierParty", async () => {
                const result = await createDespatchAdvice({
                    ...VALID_DESPATCH_ADVICE,
                    despatchSupplierParty: {
                        party: {
                            postalAddress:
                                VALID_DESPATCH_ADVICE.despatchSupplierParty.party.postalAddress,
                        },
                    },
                });

                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });

            test("empty string documentId", async () => {
                const result = await createDespatchAdvice({
                    ...VALID_DESPATCH_ADVICE,
                    documentId: "",
                });

                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });

            test("empty string senderId", async () => {
                const result = await createDespatchAdvice({
                    ...VALID_DESPATCH_ADVICE,
                    senderId: "",
                });

                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });

            test("empty string receiverId", async () => {
                const result = await createDespatchAdvice({
                    ...VALID_DESPATCH_ADVICE,
                    receiverId: "",
                });

                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });

            test("400 response body contains an error message", async () => {
                const { documentId, ...body } = VALID_DESPATCH_ADVICE;

                const result = await createDespatchAdvice(body);
                const parsed = JSON.parse(result.body);

                expect(parsed).toHaveProperty("message");
                expect(typeof parsed.message).toBe("string");
            });
        });

        // -----------------------------------------------------------------
        // DynamoDB failure
        // -----------------------------------------------------------------

        describe("handles DynamoDB errors", () => {
            test("returns 500 when DynamoDB PutItem throws", async () => {
                mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

                const result = await createDespatchAdvice(VALID_DESPATCH_ADVICE);

                expect(result.statusCode).toBe(500);
            });

            test("returns 500 response body with error info when DynamoDB fails", async () => {
                mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

                const result = await createDespatchAdvice(VALID_DESPATCH_ADVICE);
                const body = JSON.parse(result.body);

                expect(body).toHaveProperty("message");
            });

            test("returns 409 when document with same documentId already exists", async () => {
                const conditionalError = new Error("Condition check failed");
                conditionalError.name = "ConditionalCheckFailedException";
                mockSend.mockRejectedValueOnce(conditionalError);

                const result = await createDespatchAdvice(VALID_DESPATCH_ADVICE);

                expect(result.statusCode).toBe(409);
            });
        });

        describe("handles Lambda API Gateway event format", () => {
            test("accepts body as a JSON string on event.body", async () => {
                mockSend.mockResolvedValueOnce({});
 
                const result = await createDespatchAdvice({
                    body: JSON.stringify(VALID_DESPATCH_ADVICE),
                });
 
                expect(result.statusCode).toBe(201);
            });
 
            test("accepts body as a pre-parsed object on event.body", async () => {
                mockSend.mockResolvedValueOnce({});
 
                const result = await createDespatchAdvice({
                    body: VALID_DESPATCH_ADVICE,
                });
 
                expect(result.statusCode).toBe(201);
            });
 
            test("returns 400 when event.body is invalid JSON string", async () => {
                const result = await createDespatchAdvice({
                    body: "not-valid-json{{{",
                });
 
                expect(result.statusCode).toBe(400);
                expect(mockSend).not.toHaveBeenCalled();
            });
 
            test("returns correct document in body when called with event.body string", async () => {
                mockSend.mockResolvedValueOnce({});
 
                const result = await createDespatchAdvice({
                    body: JSON.stringify(VALID_DESPATCH_ADVICE),
                });
                const body = JSON.parse(result.body);
 
                expect(body.documentId).toBe("DA-001");
                expect(body.senderId).toBe("sender-123");
            });
        });
    });
 
    /// /////////////////////////////////////////////////////////////////////////
    /// ////////////////////// getDespatchAdvice ////////////////////////////////
    /// /////////////////////////////////////////////////////////////////////////
 
    describe("getDespatchAdvice", () => {
 
        // -----------------------------------------------------------------
        // Success cases
        // -----------------------------------------------------------------
 
        test("returns 200 when despatch advice is found", async () => {
            mockSend.mockResolvedValueOnce({ Item: MOCK_DYNAMODB_ITEM });
 
            const result = await getDespatchAdvice({
                pathParameters: { despatchId: "DA-001" },
            });
 
            expect(result.statusCode).toBe(200);
        });
 
        test("response body contains the despatch advice document", async () => {
            mockSend.mockResolvedValueOnce({ Item: MOCK_DYNAMODB_ITEM });
 
            const result = await getDespatchAdvice({
                pathParameters: { despatchId: "DA-001" },
            });
            const body = JSON.parse(result.body);
 
            expect(body).toHaveProperty("documentId");
            expect(body).toHaveProperty("senderId");
            expect(body).toHaveProperty("receiverId");
        });
 
        test("response body includes despatchSupplierParty", async () => {
            mockSend.mockResolvedValueOnce({ Item: MOCK_DYNAMODB_ITEM });
 
            const result = await getDespatchAdvice({
                pathParameters: { despatchId: "DA-001" },
            });
            const body = JSON.parse(result.body);
 
            expect(body.despatchSupplierParty).toBeDefined();
        });
 
        test("calls dynamo.send exactly once (GetItem)", async () => {
            mockSend.mockResolvedValueOnce({ Item: MOCK_DYNAMODB_ITEM });
 
            await getDespatchAdvice({
                pathParameters: { despatchId: "DA-001" },
            });
 
            expect(mockSend).toHaveBeenCalledTimes(1);
        });
 
        // -----------------------------------------------------------------
        // Not found
        // -----------------------------------------------------------------
 
        test("returns 404 when despatch advice does not exist", async () => {
            mockSend.mockResolvedValueOnce({ Item: undefined });
 
            const result = await getDespatchAdvice({
                pathParameters: { despatchId: "nonexistent-id" },
            });
 
            expect(result.statusCode).toBe(404);
        });
 
        test("returns 404 response body with error message", async () => {
            mockSend.mockResolvedValueOnce({ Item: undefined });
 
            const result = await getDespatchAdvice({
                pathParameters: { despatchId: "nonexistent-id" },
            });
            const body = JSON.parse(result.body);
 
            expect(body).toHaveProperty("message");
            expect(typeof body.message).toBe("string");
        });
 
        test("returns 404 when despatchId is empty string", async () => {
            mockSend.mockResolvedValueOnce({ Item: undefined });
 
            const result = await getDespatchAdvice({
                pathParameters: { despatchId: "" },
            });
 
            expect(result.statusCode).toBe(404);
        });
 
        // -----------------------------------------------------------------
        // DynamoDB failure
        // -----------------------------------------------------------------
 
        test("returns 500 when DynamoDB GetItem throws", async () => {
            mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));
 
            const result = await getDespatchAdvice({
                pathParameters: { despatchId: "DA-001" },
            });
 
            expect(result.statusCode).toBe(500);
        });
 
        test("returns 500 response body with error message when DynamoDB fails", async () => {
            mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));
 
            const result = await getDespatchAdvice({
                pathParameters: { despatchId: "DA-001" },
            });
            const body = JSON.parse(result.body);
 
            expect(body).toHaveProperty("message");
        });
    });

    /// /////////////////////////////////////////////////////////////////////////
    /// ////////////////////// cancelFulfilment /////////////////////////////////
    /// /////////////////////////////////////////////////////////////////////////

    describe("cancelFulfilment", () => {
        test("returns 404 when despatch advice does not exist", async () => {
            mockSend.mockResolvedValueOnce({ Item: undefined });

            const res = await cancelFulfilment({}, "nonexistent-id");
            expect(res.statusCode).toBe(404);
        });

        test("returns 409 when despatch advice has already been received", async () => {
            mockSend.mockResolvedValueOnce({
                Item: {
                    despatchAdviceId: { S: "abc-123" },
                    status: { S: "RECEIVED" },
                },
            });

            const res = await cancelFulfilment({}, "abc-123");
            expect(res.statusCode).toBe(409);
            const body = JSON.parse(res.body);
            expect(body.message).toMatch(/received/i);
        });

        test("returns 409 when despatch advice has already been cancelled", async () => {
            mockSend.mockResolvedValueOnce({
                Item: {
                    despatchAdviceId: { S: "abc-123" },
                    status: { S: "FULFILMENT_CANCELLED" },
                },
            });

            const res = await cancelFulfilment({}, "abc-123");
            expect(res.statusCode).toBe(409);
            const body = JSON.parse(res.body);
            expect(body.message).toMatch(/cancelled/i);
        });

        test("returns 200 with FULFILMENT_CANCELLED status on success", async () => {
            mockSend
                .mockResolvedValueOnce({
                    Item: {
                        despatchAdviceId: { S: "abc-123" },
                        status: { S: "DESPATCHED" },
                    },
                })
                .mockResolvedValueOnce({});

            const res = await cancelFulfilment({}, "abc-123");
            expect(res.statusCode).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.status).toBe("FULFILMENT_CANCELLED");
            expect(mockSend).toHaveBeenCalledTimes(2);
        });

        test("returns 404 when despatchId is empty string", async () => {
            mockSend.mockResolvedValueOnce({ Item: undefined });

            const res = await cancelFulfilment({}, "");
            expect(res.statusCode).toBe(404);
        });

        test("returns 500 when DynamoDB throws an error", async () => {
            mockSend.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

            const res = await cancelFulfilment({}, "abc-123");
            expect(res.statusCode).toBe(500);
        });

        test("returns 409 when status is missing on the item", async () => {
            mockSend.mockResolvedValueOnce({
                Item: {
                    despatchAdviceId: { S: "abc-123" },
                },
            });

            const res = await cancelFulfilment({}, "abc-123");
            expect(res.statusCode).toBe(409);
            const body = JSON.parse(res.body);
            expect(body.message).toMatch(/unknown status/i);
        });
    });
});
