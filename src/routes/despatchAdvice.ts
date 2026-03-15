import { PutItemCommand, GetItemCommand, ScanCommand, DeleteItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { dynamo, DESPATCH_ADVICES_TABLE } from "../db.js";

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Types (from swagger.yaml) ////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

interface PostalAddress {
    streetName?: string;
    buildingName?: string;
    buildingNumber?: string;
    cityName?: string;
    postalZone?: string;
    country?: string;
    addressLine?: string;
    countryIdentificationCode?: string;
}

interface Contact {
    name?: string;
    telephone?: string;
    telefax?: string;
    email?: string;
}

interface Party {
    name?: string;
    postalAddress?: PostalAddress;
    contact?: Contact;
}

interface DespatchSupplierParty {
    customerAssignedAccountId?: string;
    party?: Party;
}

interface DespatchAdvice {
    despatchAdviceId: string;   // partition key — auto-generated UUID
    documentId: string;
    senderId: string;
    receiverId: string;
    despatchSupplierParty?: DespatchSupplierParty;
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Body parsing /////////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

// Extracts the request body from either:
//   - a plain object passed directly (unit tests)
//   - an API Gateway event with event.body as a string (Lambda)
function parseBody(event: any): { body: any; error?: string } {
    // unit tests pass the body object directly — no event wrapper
    if (event && event.documentId !== undefined) {
        return { body: event };
    }
    if (event && event.senderId !== undefined) {
        return { body: event };
    }
    if (event && event.despatchSupplierParty !== undefined) {
        return { body: event };
    }

    // Lambda / API Gateway — body is a JSON string on event.body
    if (event && typeof event.body === "string") {
        try {
            return { body: JSON.parse(event.body) };
        } catch {
            return { body: null, error: "Invalid JSON body" };
        }
    }

    // event.body is already an object (some Lambda proxy configurations)
    if (event && event.body && typeof event.body === "object") {
        return { body: event.body };
    }

    // fallback — treat the whole event as the body
    return { body: event ?? {} };
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Validation ///////////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

// Validates required fields from swagger DespatchAdvice schema.
// Returns an error message string if invalid, null if valid.
function validateDespatchAdvice(body: any): string | null {
    if (!body.documentId) return "documentId is required";
    if (!body.senderId) return "senderId is required";
    if (!body.receiverId) return "receiverId is required";
    if (!body.despatchSupplierParty) return "despatchSupplierParty is required";
    if (!body.despatchSupplierParty.party) return "despatchSupplierParty.party is required";
    if (!body.despatchSupplierParty.party.name) return "despatchSupplierParty.party.name is required";
    return null;
}

// Strips any fields not defined in the swagger DespatchAdvice schema.
// Ensures we never persist or return undeclared fields.
function sanitiseDespatchAdvice(body: any): DespatchAdvice {
    const sanitised: DespatchAdvice = {
        despatchAdviceId: uuidv4(),   // partition key — generated here, never from client
        documentId: body.documentId,
        senderId: body.senderId,
        receiverId: body.receiverId,
    };

    if (body.despatchSupplierParty) {
        sanitised.despatchSupplierParty = {};

        // optional: customerAssignedAccountId
        if (body.despatchSupplierParty.customerAssignedAccountId) {
            sanitised.despatchSupplierParty.customerAssignedAccountId =
                body.despatchSupplierParty.customerAssignedAccountId;
        }

        // required: party
        if (body.despatchSupplierParty.party) {
            const rawParty = body.despatchSupplierParty.party;
            const party: Party = {};

            if (rawParty.name) party.name = rawParty.name;

            // optional: postalAddress — all subfields optional per swagger
            if (rawParty.postalAddress) {
                const raw = rawParty.postalAddress;
                const postalAddress: PostalAddress = {};
                if (raw.streetName)                postalAddress.streetName = raw.streetName;
                if (raw.buildingName)              postalAddress.buildingName = raw.buildingName;
                if (raw.buildingNumber)            postalAddress.buildingNumber = raw.buildingNumber;
                if (raw.cityName)                  postalAddress.cityName = raw.cityName;
                if (raw.postalZone)                postalAddress.postalZone = raw.postalZone;
                if (raw.country)                   postalAddress.country = raw.country;
                if (raw.addressLine)               postalAddress.addressLine = raw.addressLine;
                if (raw.countryIdentificationCode) {
                    postalAddress.countryIdentificationCode = raw.countryIdentificationCode;
                }
                party.postalAddress = postalAddress;
            }

            // optional: contact — all subfields optional per swagger
            if (rawParty.contact) {
                const raw = rawParty.contact;
                const contact: Contact = {};
                if (raw.name)      contact.name = raw.name;
                if (raw.telephone) contact.telephone = raw.telephone;
                if (raw.telefax)   contact.telefax = raw.telefax;
                if (raw.email)     contact.email = raw.email;
                party.contact = contact;
            }

            sanitised.despatchSupplierParty.party = party;
        }
    }

    return sanitised;
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// createDespatchAdvice /////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

/**
 * Creates a new despatch advice document and writes it to DynamoDB.
 *
 * Accepts two calling conventions:
 *   - createDespatchAdvice(bodyObject)        — used by unit tests
 *   - createDespatchAdvice(apiGatewayEvent)   — used by Lambda
 *
 * POST /despatch-advices
 * Responses:
 *   201 — document created, returns DespatchAdvice
 *   400 — missing or invalid required fields
 *   409 — document with same documentId already exists
 *   500 — DynamoDB or unexpected error
 */
export async function createDespatchAdvice(event: any) {
    // parse body — handles both direct object (tests) and Lambda event
    const { body, error: parseError } = parseBody(event);
    if (parseError) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: "BadRequest",
                message: parseError,
            }),
        };
    }

    // validate required fields before touching DynamoDB
    const validationError = validateDespatchAdvice(body);
    if (validationError) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: "BadRequest",
                message: validationError,
            }),
        };
    }

    // sanitise — only keep fields defined in the swagger schema
    const item = sanitiseDespatchAdvice(body);

    // write to DynamoDB
    try {
        await dynamo.send(
            new PutItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Item: marshall(item, { removeUndefinedValues: true }),
                ConditionExpression: "attribute_not_exists(documentId)",
            })
        );
    } catch (err: any) {
        if (err.name === "ConditionalCheckFailedException") {
            return {
                statusCode: 409,
                body: JSON.stringify({
                    error: "Conflict",
                    message: `A despatch advice with documentId '${body.documentId}' already exists`,
                }),
            };
        }

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "InternalServerError",
                message: err.message ?? "Internal server error",
            }),
        };
    }

    // return the created document
    return {
        statusCode: 201,
        body: JSON.stringify(item),
    };
}

export async function listDespatchAdvices(event: any) {
    return {
        statusCode: 501,
        body: JSON.stringify({
            error: "NotImplemented",
            message: "listDespatchAdvices is not implemented yet",
        }),
    };
}

export async function getDespatchAdvice(event: any) {
    return {
        statusCode: 501,
        body: JSON.stringify({
            error: "NotImplemented",
            message: "getDespatchAdvice is not implemented yet",
        }),
    };
}

export async function updateDespatchAdvice(event: any) {
    return {
        statusCode: 501,
        body: JSON.stringify({
            error: "NotImplemented",
            message: "updateDespatchAdvice is not implemented yet",
        }),
    };
}

export async function deleteDespatchAdvice(event: any) {
    return {
        statusCode: 501,
        body: JSON.stringify({
            error: "NotImplemented",
            message: "deleteDespatchAdvice is not implemented yet",
        }),
    };
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// cancelFulfilment /////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

/**
 * Cancels the fulfilment of a despatch advice.
 *
 * POST /despatch-advices/{despatchId}/fulfilment-cancellation
 * Responses:
 *   200 — cancelled successfully, returns { status: "FULFILMENT_CANCELLED" }
 *   404 — despatch advice not found
 *   409 — already received or already cancelled
 *   500 — DynamoDB or unexpected error
 */
export async function cancelFulfilment(event: any, despatchId: string) {
    try {
        const result = await dynamo.send(
            new GetItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Key: marshall({ despatchAdviceId: despatchId }),
            })
        );

        if (!result.Item) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    error: "NotFound",
                    message: "Despatch advice not found",
                }),
            };
        }

        const item = unmarshall(result.Item) as { status?: string };

        if (item.status === "RECEIVED") {
            return {
                statusCode: 409,
                body: JSON.stringify({
                    error: "Conflict",
                    message: "Despatch advice has already been received",
                }),
            };
        }

        if (item.status === "FULFILMENT_CANCELLED") {
            return {
                statusCode: 409,
                body: JSON.stringify({
                    error: "Conflict",
                    message: "Despatch advice has already been cancelled",
                }),
            };
        }

        if (item.status === undefined) {
            return {
                statusCode: 409,
                body: JSON.stringify({
                    error: "Conflict",
                    message: "Unknown status on despatch advice",
                }),
            };
        }

        await dynamo.send(
            new UpdateItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Key: marshall({ despatchAdviceId: despatchId }),
                UpdateExpression: "SET #s = :s",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: marshall({ ":s": "FULFILMENT_CANCELLED" }),
            })
        );

        return {
            statusCode: 200,
            body: JSON.stringify({ status: "FULFILMENT_CANCELLED" }),
        };
    } catch (err: any) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "InternalServerError",
                message: err.message ?? "Internal server error",
            }),
        };
    }
}
