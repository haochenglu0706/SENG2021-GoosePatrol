import { PutItemCommand, GetItemCommand, ScanCommand, DeleteItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { dynamo, DESPATCH_ADVICES_TABLE } from "../db.js";
import { verifySession } from "./auth.js";

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
/// ////////////////////// Shared response helpers //////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

function ok(data: object, statusCode = 200) {
    return { statusCode, body: JSON.stringify(data) };
}

function notFound(message: string) {
    return { statusCode: 404, body: JSON.stringify({ error: "NotFound", message }) };
}

function badRequest(message: string) {
    return { statusCode: 400, body: JSON.stringify({ error: "BadRequest", message }) };
}

function conflict(message: string) {
    return { statusCode: 409, body: JSON.stringify({ error: "Conflict", message }) };
}

function internalError(err: any) {
    return {
        statusCode: 500,
        body: JSON.stringify({
            error: "InternalServerError",
            message: err?.message ?? "Internal server error",
        }),
    };
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Body parsing /////////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

// Extracts the request body from either:
//   - a plain object passed directly (unit tests)
//   - an API Gateway event with event.body as a string (Lambda)
function parseBody(event: any): { body: any; error?: string } {
    if (event && event.documentId !== undefined) return { body: event };
    if (event && event.senderId !== undefined) return { body: event };
    if (event && event.despatchSupplierParty !== undefined) return { body: event };

    if (event && typeof event.body === "string") {
        try {
            return { body: JSON.parse(event.body) };
        } catch {
            return { body: null, error: "Invalid JSON body" };
        }
    }

    if (event && event.body && typeof event.body === "object") {
        return { body: event.body };
    }

    return { body: event ?? {} };
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Validation ///////////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

function validateDespatchAdvice(body: any): string | null {
    if (!body.documentId) return "documentId is required";
    if (!body.senderId) return "senderId is required";
    if (!body.receiverId) return "receiverId is required";
    if (!body.despatchSupplierParty) return "despatchSupplierParty is required";
    if (!body.despatchSupplierParty.party) return "despatchSupplierParty.party is required";
    if (!body.despatchSupplierParty.party.name) return "despatchSupplierParty.party.name is required";
    return null;
}

function sanitiseDespatchAdvice(body: any): DespatchAdvice {
    const sanitised: DespatchAdvice = {
        despatchAdviceId: uuidv4(),
        documentId: body.documentId,
        senderId: body.senderId,
        receiverId: body.receiverId,
    };

    if (body.despatchSupplierParty) {
        sanitised.despatchSupplierParty = {};

        if (body.despatchSupplierParty.customerAssignedAccountId) {
            sanitised.despatchSupplierParty.customerAssignedAccountId =
                body.despatchSupplierParty.customerAssignedAccountId;
        }

        if (body.despatchSupplierParty.party) {
            const rawParty = body.despatchSupplierParty.party;
            const party: Party = {};

            if (rawParty.name) party.name = rawParty.name;

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
 * POST /despatch-advices
 */
export async function createDespatchAdvice(event: any) {
    const { body, error: parseError } = parseBody(event);
    if (parseError) return badRequest(parseError);

    const validationError = validateDespatchAdvice(body);
    if (validationError) return badRequest(validationError);

    const item = sanitiseDespatchAdvice(body);

    try {
        await dynamo.send(
            new PutItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Item: marshall(item, { removeUndefinedValues: true }),
                ConditionExpression: "attribute_not_exists(documentId)",
            })
        );
        return ok(item, 201);
    } catch (err: any) {
        if (err.name === "ConditionalCheckFailedException") {
            return conflict(`A despatch advice with documentId '${body.documentId}' already exists`);
        }
        return internalError(err);
    }
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// listDespatchAdvices //////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

/**
 * Returns all despatch advices via a full table scan.
 * For testing/admin use only.
 * GET /despatch-advices
 */
export async function listDespatchAdvices(event: any) {
    try {
        const result = await dynamo.send(
            new ScanCommand({ TableName: DESPATCH_ADVICES_TABLE })
        );
        const items = (result.Items ?? []).map((item) => unmarshall(item));
        return ok(items);
    } catch (err: any) {
        return internalError(err);
    }
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// getDespatchAdvice ////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

/**
 * Retrieves a single despatch advice by its despatchAdviceId path parameter.
 * GET /despatch-advices/{despatchId}
 */
export async function getDespatchAdvice(event: any) {
    const despatchId = event?.pathParameters?.despatchId;

    try {
        const result = await dynamo.send(
            new GetItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Key: marshall({ despatchAdviceId: despatchId }),
            })
        );

        if (!result.Item) return notFound(`Despatch advice not found: ${despatchId}`);

        return ok(unmarshall(result.Item));
    } catch (err: any) {
        return internalError(err);
    }
}

export async function updateDespatchAdvice(
    event: any,
    documentId: string,
    sessionId: string | undefined
) {
    // authorisation: session must exist
    const clientId = await verifySession(sessionId);
    if (!clientId) {
        return {
            statusCode: 401,
            body: JSON.stringify({
                error: "Unauthorized",
                message: "Invalid or missing session",
            }),
        };
    }

    // parse body — supports both direct object (tests) and Lambda event
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

    // ensure path ID and body ID are consistent (when both provided)
    if (body.documentId && body.documentId !== documentId) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: "BadRequest",
                message: "documentId in path and body must match",
            }),
        };
    }

    // always use the path parameter as the canonical documentId
    body.documentId = documentId;

    // validate required fields according to swagger schema
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

    try {
        // look up existing item by documentId
        const scanResult = await dynamo.send(
            new ScanCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                FilterExpression: "documentId = :d",
                ExpressionAttributeValues: marshall({ ":d": documentId }),
                Limit: 1,
            })
        );

        if (!scanResult.Items || scanResult.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    error: "NotFound",
                    message: "Despatch advice not found",
                }),
            };
        }

        const existing = unmarshall(scanResult.Items[0]) as any;

        // optional: simple ownership check — only allow sender to update
        if (existing.senderId && existing.senderId !== body.senderId) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Unauthorized",
                    message: "You are not allowed to modify this despatch advice",
                }),
            };
        }

        // sanitise the incoming body according to swagger schema
        const updated = sanitiseDespatchAdvice(body) as any;

        // preserve primary key and any existing status field
        updated.despatchAdviceId = existing.despatchAdviceId;
        if (existing.status !== undefined) {
            updated.status = existing.status;
        }

        await dynamo.send(
            new PutItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Item: marshall(updated, { removeUndefinedValues: true }),
                ConditionExpression: "attribute_exists(despatchAdviceId)",
            })
        );

        return {
            statusCode: 200,
            body: JSON.stringify(updated),
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

export async function deleteDespatchAdvice(
    event: any,
    documentId: string,
    sessionId: string | undefined
) {
    // authorisation: session must exist
    const clientId = await verifySession(sessionId);
    if (!clientId) {
        return {
            statusCode: 401,
            body: JSON.stringify({
                error: "Unauthorized",
                message: "Invalid or missing session",
            }),
        };
    }

    try {
        // find the item by documentId
        const scanResult = await dynamo.send(
            new ScanCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                FilterExpression: "documentId = :d",
                ExpressionAttributeValues: marshall({ ":d": documentId }),
                Limit: 1,
            })
        );

        if (!scanResult.Items || scanResult.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({
                    error: "NotFound",
                    message: "Despatch advice not found",
                }),
            };
        }

        const existing = unmarshall(scanResult.Items[0]) as any;

        // optional: only allow sender to delete
        if (existing.senderId && existing.senderId !== clientId) {
            return {
                statusCode: 401,
                body: JSON.stringify({
                    error: "Unauthorized",
                    message: "You are not allowed to delete this despatch advice",
                }),
            };
        }

        await dynamo.send(
            new DeleteItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Key: marshall({ despatchAdviceId: existing.despatchAdviceId }),
                ConditionExpression: "attribute_exists(despatchAdviceId)",
            })
        );

        // 204 No Content as per swagger.yaml
        return {
            statusCode: 204,
            body: "",
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
/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// cancelFulfilment /////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

/**
 * Cancels the fulfilment of a despatch advice.
 * POST /despatch-advices/{despatchId}/fulfilment-cancellation
 */
export async function cancelFulfilment(event: any, despatchId: string) {
    try {
        const result = await dynamo.send(
            new GetItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Key: marshall({ despatchAdviceId: despatchId }),
            })
        );

        if (!result.Item) return notFound("Despatch advice not found");

        const item = unmarshall(result.Item) as { status?: string };

        if (item.status === "RECEIVED")             return conflict("Despatch advice has already been received");
        if (item.status === "FULFILMENT_CANCELLED") return conflict("Despatch advice has already been cancelled");
        if (item.status === undefined)              return conflict("Unknown status on despatch advice");

        await dynamo.send(
            new UpdateItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Key: marshall({ despatchAdviceId: despatchId }),
                UpdateExpression: "SET #s = :s",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: marshall({ ":s": "FULFILMENT_CANCELLED" }),
            })
        );

        return ok({ status: "FULFILMENT_CANCELLED" });
    } catch (err: any) {
        return internalError(err);
    }
}
