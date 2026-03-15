import { jest } from "@jest/globals";
import { randomBytes, scryptSync } from "crypto";

jest.unstable_mockModule("../src/db.js", () => ({
    dynamo: {
        send: jest.fn(),
    },
    CLIENTS_TABLE: "Clients",
    SESSIONS_TABLE: "Sessions",
    DESPATCH_ADVICES_TABLE: "DespatchAdvices",
}));

const { createDespatchAdvice, getDespatchAdvice, updateDespatchAdvice, 
    listDespatchAdvices, deleteDespatchAdvice } = await import("../src/routes/despatchAdvice.js");
const { dynamo } = await import("../src/db.js");

const mockSend = dynamo.send as ReturnType<typeof jest.fn>;

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Shared fields ////////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////
 
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
            // First send: PutItem succeeds
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
    });
});