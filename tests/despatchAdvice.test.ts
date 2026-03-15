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

describe("despatchAdvice", () => {
    beforeEach(() => {
        mockSend.mockReset();
    });

    
});