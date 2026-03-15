import { jest } from "@jest/globals";
import { randomBytes, scryptSync } from "crypto";

jest.unstable_mockModule("../src/db.js", () => ({
    dynamo: {
        send: jest.fn(),
    },
    CLIENTS_TABLE: "Clients",
    SESSIONS_TABLE: "Sessions",
}));

const { createDespatchAdvice, getDespatchAdvice, updateDespatchAdvice, 
    listDespatchAdvices, deleteDespatchAdvice } = await import("../src/routes/despatchAdvice.js");
const { dynamo } = await import("../src/db.js");

const mockSend = dynamo.send as ReturnType<typeof jest.fn>;

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Shared fields /////////////////////////////////////
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


});