import { PutItemCommand, GetItemCommand, ScanCommand, DeleteItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamo } from "../db.js";

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
    documentId: string;
    senderId: string;
    receiverId: string;
    despatchSupplierParty?: DespatchSupplierParty;
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

            // optional: name
            if (rawParty.name) party.name = rawParty.name;

            // optional: postalAddress — all subfields are optional per swagger
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

            // optional: contact — all subfields are optional per swagger
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
 * Creates a new despatch advice document.
 *
 * POST /despatch-advices
 * Request body: DespatchAdvice schema (swagger.yaml)
 * Responses:
 *   201 — document created, returns DespatchAdvice
 *   400 — missing required fields
 *   409 — document with same documentId already exists
 *   500 — DynamoDB error
 *
 * @param body - raw request body
 */
export async function createDespatchAdvice(body: any) {
    // 1. validate required fields before touching DynamoDB
    const validationError = validateDespatchAdvice(body);
    if (validationError) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: validationError }),
        };
    }

    // 2. sanitise — only keep fields defined in the swagger schema
    const item = sanitiseDespatchAdvice(body);

    // 3. write to DynamoDB
    try {
        await dynamo.send(
            new PutItemCommand({
                TableName: "DespatchAdvices",
                Item: marshall(item, { removeUndefinedValues: true }),
                // prevent silent overwrite of an existing document
                ConditionExpression: "attribute_not_exists(documentId)",
            })
        );

        return {
            statusCode: 201,
            body: JSON.stringify(item),
        };

    } catch (err: any) {
        if (err.name === "ConditionalCheckFailedException") {
            return {
                statusCode: 409,
                body: JSON.stringify({
                    message: `Despatch advice with documentId '${body.documentId}' already exists`,
                }),
            };
        }

        return {
            statusCode: 500,
            body: JSON.stringify({
                message: err.message ?? "Internal server error",
            }),
        };
    }
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// remaining routes (TODO) //////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

export async function listDespatchAdvices(event: any) {
    return {
        statusCode: 501,
        body: JSON.stringify({
            message: "listDespatchAdvices is not implemented yet",
        }),
    };
}

export async function getDespatchAdvice(event: any) {
    return {
        statusCode: 501,
        body: JSON.stringify({
            message: "getDespatchAdvice is not implemented yet",
        }),
    };
}

export async function updateDespatchAdvice(event: any) {
    return {
        statusCode: 501,
        body: JSON.stringify({
            message: "updateDespatchAdvice is not implemented yet",
        }),
    };
}

export async function deleteDespatchAdvice(event: any) {
    return {
        statusCode: 501,
        body: JSON.stringify({
            message: "deleteDespatchAdvice is not implemented yet",
        }),
    };
}
