import {
    PutItemCommand,
    GetItemCommand,
    ScanCommand,
    DeleteItemCommand,
    UpdateItemCommand,
    type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { dynamo, DESPATCH_ADVICES_TABLE } from "../db.js";
import { verifySession } from "./auth.js";
import { CORS_HEADERS } from "../cors.js";

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Types (from swagger.yaml) ////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

interface PostalAddress {
    streetName?: string;
    buildingName?: string;
    buildingNumber?: string;
    cityName?: string;
    postalZone?: string;
    countrySubentity?: string;
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

interface DeliveryCustomerParty {
    customerAssignedAccountId?: string;
    supplierAssignedAccountId?: string;
    party?: Party;
}

interface DeliveryPeriod {
    startDate?: string;
    startTime?: string;
    endDate?: string;
    endTime?: string;
}

interface Delivery {
    id?: string;
    deliveryAddress?: PostalAddress;
    requestedDeliveryPeriod?: DeliveryPeriod;
}

interface Shipment {
    id?: string;
    consignmentId?: string;
    delivery?: Delivery;
}

interface ItemIdentification {
    id?: string;
}

interface LotIdentification {
    lotNumberId?: string;
    expiryDate?: string;
}

interface ItemInstance {
    lotIdentification?: LotIdentification;
}

interface Item {
    description?: string;
    name?: string;
    buyersItemIdentification?: ItemIdentification;
    sellersItemIdentification?: ItemIdentification;
    itemInstance?: ItemInstance;
}

interface OrderReference {
    id?: string;
    salesOrderId?: string;
    uuid?: string;
    issueDate?: string;
}

/** UBL cac:AdditionalDocumentReference → cbc:ID, cbc:DocumentType */
interface AdditionalDocumentReference {
    id: string;
    documentType: string;
}

interface OrderLineReference {
    lineId?: string;
    salesOrderLineId?: string;
    orderReference?: OrderReference;
}

interface DespatchLine {
    id?: string;
    note?: string;
    lineStatusCode?: string;
    deliveredQuantity?: number;
    deliveredQuantityUnitCode?: string;
    backorderQuantity?: number;
    backorderQuantityUnitCode?: string;
    backorderReason?: string;
    orderLineReference?: OrderLineReference;
    item?: Item;
}

interface DespatchAdviceCreateRequest {
    uuid?: string;
    documentID?: string;
    senderId?: string;
    receiverId?: string;
    copyIndicator?: boolean;
    replaces?: string;
    issueDate?: string;
    documentStatusCode?: string;
    orderReference?: OrderReference;
    despatchAdviceTypeCode?: string;
    note?: string;
    despatchSupplierParty?: DespatchSupplierParty;
    deliveryCustomerParty?: DeliveryCustomerParty;
    shipment?: Shipment;
    despatchLines?: DespatchLine[];
    additionalDocumentReference?: AdditionalDocumentReference | AdditionalDocumentReference[];
}

interface DespatchAdvice {
    despatchAdviceId: string;   // partition key — auto-generated UUID
    documentId: string;
    senderId: string;
    receiverId: string;
    /** Set from session on create — used for delete/update auth (distinct from payload senderId). */
    clientId?: string;
    copyIndicator?: boolean;
    replaces?: string;
    issueDate?: string;
    documentStatusCode?: string;
    orderReference?: OrderReference;
    despatchAdviceTypeCode?: string;
    note?: string;
    despatchSupplierParty?: DespatchSupplierParty;
    deliveryCustomerParty?: DeliveryCustomerParty;
    shipment?: Shipment;
    despatchLines?: DespatchLine[];
    additionalDocumentReference?: AdditionalDocumentReference[];
    status?: string;
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Shared response helpers //////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

function ok(data: object, statusCode = 200) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

function notFound(message: string) {
  return { statusCode: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: "NotFound", message }) };
}

function badRequest(message: string) {
  return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: "BadRequest", message }) };
}

function conflict(message: string) {
  return { statusCode: 409, headers: CORS_HEADERS, body: JSON.stringify({ error: "Conflict", message }) };
}

function internalError(err: any) {
  return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify(
    { error: "InternalServerError", message: err?.message ?? "Internal server error" }
 ) };
}

/** Session header on API Gateway events (and tests may omit). */
function getSessionIdFromEvent(event: any): string | undefined {
    if (!event || typeof event !== "object") return undefined;
    const h = event.headers;
    if (!h || typeof h !== "object") return undefined;
    const raw =
        (h as Record<string, unknown>).sessionId ??
        (h as Record<string, unknown>).SessionId ??
        (h as Record<string, unknown>).sessionid ??
        (h as Record<string, unknown>)["session-id"];
    return typeof raw === "string" ? raw : undefined;
}

/**
 * `senderId` is a document field (trading partner id) and often differs from the
 * logged-in user's `clientId`. Authorise if either matches the session client.
 */
function sessionMayModifyDespatchAdvice(
    existing: { senderId?: string; clientId?: string },
    sessionClientId: string
): boolean {
    if (existing.clientId != null && existing.clientId === sessionClientId) return true;
    if (existing.senderId != null && existing.senderId === sessionClientId) return true;
    return false;
}
/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Body parsing /////////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

/** Swagger uses `documentID`; we store `documentId` in DynamoDB. */
function normalizeDespatchAdviceBody(body: Record<string, unknown>): void {
    if (body.documentID != null && body.documentId == null) {
        body.documentId = body.documentID;
    }
    normalizeAdditionalDocumentReferenceField(body);
}

function normalizeAdditionalDocumentReferenceKeys(ref: Record<string, unknown>): void {
    if (ref.id == null && ref.ID != null) ref.id = ref.ID;
    if (ref.documentType == null && ref.DocumentType != null) {
        ref.documentType = ref.DocumentType;
    }
}

function normalizeAdditionalDocumentReferenceField(body: Record<string, unknown>): void {
    const raw = body.additionalDocumentReference;
    if (raw == null) return;
    if (Array.isArray(raw)) {
        for (const item of raw) {
            if (item && typeof item === "object") {
                normalizeAdditionalDocumentReferenceKeys(item as Record<string, unknown>);
            }
        }
        return;
    }
    if (typeof raw === "object") {
        normalizeAdditionalDocumentReferenceKeys(raw as Record<string, unknown>);
    }
}

// Extracts the request body from either:
//   - a plain object passed directly (unit tests)
//   - an API Gateway event with event.body as a string or object (Lambda)
function parseBody(event: any): { body: Record<string, unknown>; error?: string } {
    if (event == null) {
        return { body: {} };
    }

    if (typeof event.body === "string") {
        try {
            const parsed = JSON.parse(event.body) as Record<string, unknown>;
            normalizeDespatchAdviceBody(parsed);
            return { body: parsed };
        } catch {
            return { body: {}, error: "Invalid JSON body" };
        }
    }

    if (event.body !== undefined && typeof event.body === "object" && event.body !== null) {
        const b = event.body as Record<string, unknown>;
        normalizeDespatchAdviceBody(b);
        return { body: b };
    }

    if (typeof event === "object") {
        const b = event as Record<string, unknown>;
        normalizeDespatchAdviceBody(b);
        return { body: b };
    }

    return { body: {} };
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// Validation ///////////////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

function nonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.trim().length > 0;
}

function validatePostalAddress(addr: unknown, path: string): string | null {
    if (!addr || typeof addr !== "object") return `${path} is required`;
    const a = addr as Record<string, unknown>;
    if (!nonEmptyString(a.streetName)) return `${path}.streetName is required`;
    if (!nonEmptyString(a.cityName)) return `${path}.cityName is required`;
    if (!nonEmptyString(a.postalZone)) return `${path}.postalZone is required`;
    if (!nonEmptyString(a.countryIdentificationCode)) return `${path}.countryIdentificationCode is required`;
    if (String(a.countryIdentificationCode).length !== 2) {
        return `${path}.countryIdentificationCode must be exactly 2 characters`;
    }
    return null;
}

function validateParty(party: unknown, path: string): string | null {
    if (!party || typeof party !== "object") return `${path} is required`;
    const p = party as Record<string, unknown>;
    if (!nonEmptyString(p.name)) return `${path}.name is required`;
    return validatePostalAddress(p.postalAddress, `${path}.postalAddress`);
}

function validateDeliveryPeriod(dp: unknown, path: string): string | null {
    if (!dp || typeof dp !== "object") return `${path} is required`;
    const d = dp as Record<string, unknown>;
    if (!nonEmptyString(d.startDate)) return `${path}.startDate is required`;
    if (!nonEmptyString(d.endDate)) return `${path}.endDate is required`;
    return null;
}

function validateDelivery(d: unknown, path: string): string | null {
    if (!d || typeof d !== "object") return `${path} is required`;
    const x = d as Record<string, unknown>;
    const a = validatePostalAddress(x.deliveryAddress, `${path}.deliveryAddress`);
    if (a) return a;
    return validateDeliveryPeriod(x.requestedDeliveryPeriod, `${path}.requestedDeliveryPeriod`);
}

function validateOrderReference(or: unknown, path: string): string | null {
    if (!or || typeof or !== "object") return `${path} is required`;
    const o = or as Record<string, unknown>;
    if (!nonEmptyString(o.id)) return `${path}.id is required`;
    return null;
}

function validateOrderLineReference(olr: unknown, path: string): string | null {
    if (!olr || typeof olr !== "object") return `${path} is required`;
    const o = olr as Record<string, unknown>;
    if (!nonEmptyString(o.lineId)) return `${path}.lineId is required`;
    return validateOrderReference(o.orderReference, `${path}.orderReference`);
}

function validateItem(item: unknown, path: string): string | null {
    if (!item || typeof item !== "object") return `${path} is required`;
    const i = item as Record<string, unknown>;
    if (!nonEmptyString(i.name)) return `${path}.name is required`;
    if (!nonEmptyString(i.description)) return `${path}.description is required`;
    return null;
}

function validateAdditionalDocumentReference(ref: unknown, path: string): string | null {
    if (!ref || typeof ref !== "object") return `${path} must be an object`;
    const r = ref as Record<string, unknown>;
    normalizeAdditionalDocumentReferenceKeys(r);
    if (!nonEmptyString(r.id)) return `${path}.id is required`;
    if (!nonEmptyString(r.documentType)) return `${path}.documentType is required`;
    return null;
}

function validateOptionalAdditionalDocumentReference(body: Record<string, unknown>): string | null {
    const raw = body.additionalDocumentReference;
    if (raw === undefined || raw === null) return null;
    if (Array.isArray(raw)) {
        if (raw.length === 0) return null;
        for (let i = 0; i < raw.length; i++) {
            const err = validateAdditionalDocumentReference(raw[i], `additionalDocumentReference[${i}]`);
            if (err) return err;
        }
        return null;
    }
    return validateAdditionalDocumentReference(raw, "additionalDocumentReference");
}

function validateDespatchLine(line: unknown, index: number): string | null {
    const prefix = `despatchLines[${index}]`;
    if (!line || typeof line !== "object") return `${prefix} is required`;
    const l = line as Record<string, unknown>;
    if (!nonEmptyString(l.id)) return `${prefix}.id is required`;
    if (typeof l.deliveredQuantity !== "number") return `${prefix}.deliveredQuantity is required and must be a number`;
    if (!nonEmptyString(l.deliveredQuantityUnitCode)) {
        return `${prefix}.deliveredQuantityUnitCode is required`;
    }
    const olr = validateOrderLineReference(l.orderLineReference, `${prefix}.orderLineReference`);
    if (olr) return olr;
    return validateItem(l.item, `${prefix}.item`);
}

function validateDespatchAdvice(body: Record<string, unknown>): string | null {
    normalizeDespatchAdviceBody(body);

    if (!nonEmptyString(body.documentId)) return "documentId (or documentID) is required";
    if (!nonEmptyString(body.senderId)) return "senderId is required";
    if (!nonEmptyString(body.receiverId)) return "receiverId is required";
    if (typeof body.copyIndicator !== "boolean") return "copyIndicator is required and must be a boolean";
    if (!nonEmptyString(body.issueDate)) return "issueDate is required";
    if (!nonEmptyString(body.documentStatusCode)) return "documentStatusCode is required";

    const orderRef = validateOrderReference(body.orderReference, "orderReference");
    if (orderRef) return orderRef;

    const addDocRef = validateOptionalAdditionalDocumentReference(body);
    if (addDocRef) return addDocRef;

    const dsp = body.despatchSupplierParty;
    if (!dsp || typeof dsp !== "object") return "despatchSupplierParty is required";
    const supplierParty = validateParty((dsp as Record<string, unknown>).party, "despatchSupplierParty.party");
    if (supplierParty) return supplierParty;

    const dcp = body.deliveryCustomerParty;
    if (!dcp || typeof dcp !== "object") return "deliveryCustomerParty is required";
    const deliveryParty = validateParty((dcp as Record<string, unknown>).party, "deliveryCustomerParty.party");
    if (deliveryParty) return deliveryParty;

    const ship = body.shipment;
    if (!ship || typeof ship !== "object") return "shipment is required";
    const sh = ship as Record<string, unknown>;
    if (!nonEmptyString(sh.id)) return "shipment.id is required";
    if (!nonEmptyString(sh.consignmentId)) return "shipment.consignmentId is required";
    const del = validateDelivery(sh.delivery, "shipment.delivery");
    if (del) return del;

    const lines = body.despatchLines;
    if (!Array.isArray(lines) || lines.length < 1) {
        return "despatchLines is required and must be a non-empty array";
    }
    for (let i = 0; i < lines.length; i++) {
        const err = validateDespatchLine(lines[i], i);
        if (err) return err;
    }

    return null;
}

function sanitisePostalAddress(raw: Record<string, unknown>): PostalAddress {
    const postalAddress: PostalAddress = {};
    if (nonEmptyString(raw.streetName)) postalAddress.streetName = raw.streetName;
    if (nonEmptyString(raw.buildingName)) postalAddress.buildingName = raw.buildingName;
    if (nonEmptyString(raw.buildingNumber)) postalAddress.buildingNumber = raw.buildingNumber;
    if (nonEmptyString(raw.cityName)) postalAddress.cityName = raw.cityName;
    if (nonEmptyString(raw.postalZone)) postalAddress.postalZone = raw.postalZone;
    if (nonEmptyString(raw.countrySubentity)) postalAddress.countrySubentity = raw.countrySubentity;
    if (nonEmptyString(raw.addressLine)) postalAddress.addressLine = raw.addressLine;
    if (nonEmptyString(raw.countryIdentificationCode)) {
        postalAddress.countryIdentificationCode = raw.countryIdentificationCode;
    }
    return postalAddress;
}

function sanitiseContact(raw: Record<string, unknown>): Contact {
    const contact: Contact = {};
    if (nonEmptyString(raw.name)) contact.name = raw.name;
    if (nonEmptyString(raw.telephone)) contact.telephone = raw.telephone;
    if (nonEmptyString(raw.telefax)) contact.telefax = raw.telefax;
    if (nonEmptyString(raw.email)) contact.email = raw.email;
    return contact;
}

function sanitiseParty(raw: Record<string, unknown>): Party {
    const party: Party = {};
    if (nonEmptyString(raw.name)) party.name = raw.name;
    if (raw.postalAddress && typeof raw.postalAddress === "object") {
        party.postalAddress = sanitisePostalAddress(raw.postalAddress as Record<string, unknown>);
    }
    if (raw.contact && typeof raw.contact === "object") {
        party.contact = sanitiseContact(raw.contact as Record<string, unknown>);
    }
    return party;
}

function sanitiseAdditionalDocumentReference(raw: Record<string, unknown>): AdditionalDocumentReference {
    normalizeAdditionalDocumentReferenceKeys(raw);
    return {
        id: String(raw.id),
        documentType: String(raw.documentType),
    };
}

function sanitiseOrderReference(raw: Record<string, unknown>): OrderReference {
    const o: OrderReference = {};
    if (nonEmptyString(raw.id)) o.id = raw.id;
    if (nonEmptyString(raw.salesOrderId)) o.salesOrderId = raw.salesOrderId;
    if (nonEmptyString(raw.uuid)) o.uuid = raw.uuid;
    if (nonEmptyString(raw.issueDate)) o.issueDate = raw.issueDate;
    return o;
}

function sanitiseOrderLineReference(raw: Record<string, unknown>): OrderLineReference {
    const o: OrderLineReference = {};
    if (nonEmptyString(raw.lineId)) o.lineId = raw.lineId;
    if (nonEmptyString(raw.salesOrderLineId)) o.salesOrderLineId = raw.salesOrderLineId;
    if (raw.orderReference && typeof raw.orderReference === "object") {
        o.orderReference = sanitiseOrderReference(raw.orderReference as Record<string, unknown>);
    }
    return o;
}

function sanitiseItemIdentification(raw: Record<string, unknown>): ItemIdentification {
    const o: ItemIdentification = {};
    if (nonEmptyString(raw.id)) o.id = raw.id;
    return o;
}

function sanitiseLotIdentification(raw: Record<string, unknown>): LotIdentification {
    const o: LotIdentification = {};
    if (nonEmptyString(raw.lotNumberId)) o.lotNumberId = raw.lotNumberId;
    if (nonEmptyString(raw.expiryDate)) o.expiryDate = raw.expiryDate;
    return o;
}

function sanitiseItemInstance(raw: Record<string, unknown>): ItemInstance {
    const o: ItemInstance = {};
    if (raw.lotIdentification && typeof raw.lotIdentification === "object") {
        o.lotIdentification = sanitiseLotIdentification(raw.lotIdentification as Record<string, unknown>);
    }
    return o;
}

function sanitiseItem(raw: Record<string, unknown>): Item {
    const item: Item = {};
    if (nonEmptyString(raw.description)) item.description = raw.description;
    if (nonEmptyString(raw.name)) item.name = raw.name;
    if (raw.buyersItemIdentification && typeof raw.buyersItemIdentification === "object") {
        item.buyersItemIdentification = sanitiseItemIdentification(
            raw.buyersItemIdentification as Record<string, unknown>
        );
    }
    if (raw.sellersItemIdentification && typeof raw.sellersItemIdentification === "object") {
        item.sellersItemIdentification = sanitiseItemIdentification(
            raw.sellersItemIdentification as Record<string, unknown>
        );
    }
    if (raw.itemInstance && typeof raw.itemInstance === "object") {
        item.itemInstance = sanitiseItemInstance(raw.itemInstance as Record<string, unknown>);
    }
    return item;
}

function sanitiseDeliveryPeriod(raw: Record<string, unknown>): DeliveryPeriod {
    const d: DeliveryPeriod = {};
    if (nonEmptyString(raw.startDate)) d.startDate = raw.startDate;
    if (nonEmptyString(raw.startTime)) d.startTime = raw.startTime;
    if (nonEmptyString(raw.endDate)) d.endDate = raw.endDate;
    if (nonEmptyString(raw.endTime)) d.endTime = raw.endTime;
    return d;
}

function sanitiseDelivery(raw: Record<string, unknown>): Delivery {
    const d: Delivery = {};
    if (nonEmptyString(raw.id)) d.id = raw.id;
    if (raw.deliveryAddress && typeof raw.deliveryAddress === "object") {
        d.deliveryAddress = sanitisePostalAddress(raw.deliveryAddress as Record<string, unknown>);
    }
    if (raw.requestedDeliveryPeriod && typeof raw.requestedDeliveryPeriod === "object") {
        d.requestedDeliveryPeriod = sanitiseDeliveryPeriod(
            raw.requestedDeliveryPeriod as Record<string, unknown>
        );
    }
    return d;
}

function sanitiseShipment(raw: Record<string, unknown>): Shipment {
    const s: Shipment = {};
    if (nonEmptyString(raw.id)) s.id = raw.id;
    if (nonEmptyString(raw.consignmentId)) s.consignmentId = raw.consignmentId;
    if (raw.delivery && typeof raw.delivery === "object") {
        s.delivery = sanitiseDelivery(raw.delivery as Record<string, unknown>);
    }
    return s;
}

function sanitiseDespatchLine(raw: Record<string, unknown>): DespatchLine {
    const line: DespatchLine = {};
    if (nonEmptyString(raw.id)) line.id = raw.id;
    if (nonEmptyString(raw.note)) line.note = raw.note;
    if (nonEmptyString(raw.lineStatusCode)) line.lineStatusCode = raw.lineStatusCode;
    if (typeof raw.deliveredQuantity === "number") line.deliveredQuantity = raw.deliveredQuantity;
    if (nonEmptyString(raw.deliveredQuantityUnitCode)) {
        line.deliveredQuantityUnitCode = raw.deliveredQuantityUnitCode;
    }
    if (typeof raw.backorderQuantity === "number") line.backorderQuantity = raw.backorderQuantity;
    if (nonEmptyString(raw.backorderQuantityUnitCode)) {
        line.backorderQuantityUnitCode = raw.backorderQuantityUnitCode;
    }
    if (nonEmptyString(raw.backorderReason)) line.backorderReason = raw.backorderReason;
    if (raw.orderLineReference && typeof raw.orderLineReference === "object") {
        line.orderLineReference = sanitiseOrderLineReference(raw.orderLineReference as Record<string, unknown>);
    }
    if (raw.item && typeof raw.item === "object") {
        line.item = sanitiseItem(raw.item as Record<string, unknown>);
    }
    return line;
}

function sanitiseDespatchSupplierParty(raw: Record<string, unknown>): DespatchSupplierParty {
    const dsp: DespatchSupplierParty = {};
    if (nonEmptyString(raw.customerAssignedAccountId)) {
        dsp.customerAssignedAccountId = raw.customerAssignedAccountId;
    }
    if (raw.party && typeof raw.party === "object") {
        dsp.party = sanitiseParty(raw.party as Record<string, unknown>);
    }
    return dsp;
}

function sanitiseDeliveryCustomerParty(raw: Record<string, unknown>): DeliveryCustomerParty {
    const dcp: DeliveryCustomerParty = {};
    if (nonEmptyString(raw.customerAssignedAccountId)) {
        dcp.customerAssignedAccountId = raw.customerAssignedAccountId;
    }
    if (nonEmptyString(raw.supplierAssignedAccountId)) {
        dcp.supplierAssignedAccountId = raw.supplierAssignedAccountId;
    }
    if (raw.party && typeof raw.party === "object") {
        dcp.party = sanitiseParty(raw.party as Record<string, unknown>);
    }
    return dcp;
}

function sanitiseDespatchAdvice(body: Record<string, unknown>): DespatchAdvice {
    normalizeDespatchAdviceBody(body);

    const sanitised: DespatchAdvice = {
        despatchAdviceId: uuidv4(),
        documentId: String(body.documentId),
        senderId: String(body.senderId),
        receiverId: String(body.receiverId),
        status: "draft",
    };

    if (typeof body.copyIndicator === "boolean") sanitised.copyIndicator = body.copyIndicator;
    if (nonEmptyString(body.replaces)) sanitised.replaces = body.replaces;
    if (nonEmptyString(body.issueDate)) sanitised.issueDate = body.issueDate;
    if (nonEmptyString(body.documentStatusCode)) sanitised.documentStatusCode = body.documentStatusCode;
    if (body.orderReference && typeof body.orderReference === "object") {
        sanitised.orderReference = sanitiseOrderReference(body.orderReference as Record<string, unknown>);
    }
    if (nonEmptyString(body.despatchAdviceTypeCode)) {
        sanitised.despatchAdviceTypeCode = body.despatchAdviceTypeCode;
    }
    if (nonEmptyString(body.note)) sanitised.note = body.note;

    if (body.despatchSupplierParty && typeof body.despatchSupplierParty === "object") {
        sanitised.despatchSupplierParty = sanitiseDespatchSupplierParty(
            body.despatchSupplierParty as Record<string, unknown>
        );
    }
    if (body.deliveryCustomerParty && typeof body.deliveryCustomerParty === "object") {
        sanitised.deliveryCustomerParty = sanitiseDeliveryCustomerParty(
            body.deliveryCustomerParty as Record<string, unknown>
        );
    }
    if (body.shipment && typeof body.shipment === "object") {
        sanitised.shipment = sanitiseShipment(body.shipment as Record<string, unknown>);
    }
    if (Array.isArray(body.despatchLines)) {
        sanitised.despatchLines = body.despatchLines.map((line) =>
            sanitiseDespatchLine(line as Record<string, unknown>)
        );
    }

    const addRaw = body.additionalDocumentReference;
    if (addRaw != null) {
        const list = Array.isArray(addRaw) ? addRaw : [addRaw];
        const refs = list
            .filter((x) => x && typeof x === "object")
            .map((x) => sanitiseAdditionalDocumentReference(x as Record<string, unknown>));
        if (refs.length > 0) {
            sanitised.additionalDocumentReference = refs;
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

    const ownerClientId = await verifySession(getSessionIdFromEvent(event));
    if (ownerClientId) {
        item.clientId = ownerClientId;
    }

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
            return conflict(`A despatch advice with documentId '${String(body.documentId)}' already exists`);
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

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// UBL 2.1 XML export ///////////////////////////////////
/// /////////////////////////////////////////////////////////////////////////////

function escapeXml(text: string | number | boolean | undefined | null): string {
    if (text === undefined || text === null) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function cbc(tag: string, value: string | number | boolean): string {
    const body =
        typeof value === "boolean" ? (value ? "true" : "false") : escapeXml(value);
    return `<cbc:${tag}>${body}</cbc:${tag}>`;
}

function addressFieldsXml(addr: PostalAddress): string {
    let s = "";
    if (addr.streetName) s += cbc("StreetName", addr.streetName);
    if (addr.buildingName) s += cbc("BuildingName", addr.buildingName);
    if (addr.buildingNumber) s += cbc("BuildingNumber", addr.buildingNumber);
    if (addr.cityName) s += cbc("CityName", addr.cityName);
    if (addr.postalZone) s += cbc("PostalZone", addr.postalZone);
    if (addr.countrySubentity) s += cbc("CountrySubentity", addr.countrySubentity);
    if (addr.addressLine) {
        s += `<cac:AddressLine><cbc:Line>${escapeXml(addr.addressLine)}</cbc:Line></cac:AddressLine>`;
    }
    if (addr.countryIdentificationCode) {
        s += `<cac:Country><cbc:IdentificationCode>${escapeXml(
            addr.countryIdentificationCode
        )}</cbc:IdentificationCode></cac:Country>`;
    }
    return s;
}

function wrappedPostalAddress(addr: PostalAddress | undefined): string {
    if (!addr) return "";
    const inner = addressFieldsXml(addr);
    if (!inner) return "";
    return `<cac:PostalAddress>${inner}</cac:PostalAddress>`;
}

function wrappedDeliveryAddress(addr: PostalAddress | undefined): string {
    if (!addr) return "";
    const inner = addressFieldsXml(addr);
    if (!inner) return "";
    return `<cac:DeliveryAddress>${inner}</cac:DeliveryAddress>`;
}

function contactXml(c: Contact | undefined): string {
    if (!c) return "";
    let s = "<cac:Contact>";
    if (c.name) s += cbc("Name", c.name);
    if (c.telephone) s += cbc("Telephone", c.telephone);
    if (c.telefax) s += cbc("Telefax", c.telefax);
    if (c.email) s += cbc("ElectronicMail", c.email);
    s += "</cac:Contact>";
    if (s === "<cac:Contact></cac:Contact>") return "";
    return s;
}

function partyXml(party: Party | undefined): string {
    if (!party) return "";
    let s = "<cac:Party>";
    if (party.name) {
        s += `<cac:PartyName><cbc:Name>${escapeXml(party.name)}</cbc:Name></cac:PartyName>`;
    }
    s += wrappedPostalAddress(party.postalAddress);
    s += contactXml(party.contact);
    s += "</cac:Party>";
    if (s === "<cac:Party></cac:Party>") return "";
    return s;
}

function orderReferenceXml(oref: OrderReference | undefined): string {
    if (!oref) return "";
    let s = "<cac:OrderReference>";
    if (oref.id) s += cbc("ID", oref.id);
    if (oref.salesOrderId) s += cbc("SalesOrderID", oref.salesOrderId);
    if (oref.uuid) s += cbc("UUID", oref.uuid);
    if (oref.issueDate) s += cbc("IssueDate", oref.issueDate);
    s += "</cac:OrderReference>";
    if (s === "<cac:OrderReference></cac:OrderReference>") return "";
    return s;
}

function deliveryPeriodXml(p: DeliveryPeriod | undefined): string {
    if (!p) return "";
    let s = "<cac:RequestedDeliveryPeriod>";
    if (p.startDate) s += cbc("StartDate", p.startDate);
    if (p.startTime) s += cbc("StartTime", p.startTime);
    if (p.endDate) s += cbc("EndDate", p.endDate);
    if (p.endTime) s += cbc("EndTime", p.endTime);
    s += "</cac:RequestedDeliveryPeriod>";
    if (s === "<cac:RequestedDeliveryPeriod></cac:RequestedDeliveryPeriod>") return "";
    return s;
}

function deliveryXml(d: Delivery | undefined): string {
    if (!d) return "";
    let s = "<cac:Delivery>";
    s += wrappedDeliveryAddress(d.deliveryAddress);
    s += deliveryPeriodXml(d.requestedDeliveryPeriod);
    s += "</cac:Delivery>";
    if (s === "<cac:Delivery></cac:Delivery>") return "";
    return s;
}

function shipmentXml(sh: Shipment | undefined): string {
    if (!sh) return "";
    let s = "<cac:Shipment>";
    s += cbc("ID", sh.id != null && String(sh.id) !== "" ? String(sh.id) : "1");
    s += "<cac:Consignment>";
    s += cbc("ID", sh.consignmentId != null && String(sh.consignmentId) !== "" ? String(sh.consignmentId) : "1");
    s += "</cac:Consignment>";
    s += deliveryXml(sh.delivery);
    s += "</cac:Shipment>";
    return s;
}

function orderLineReferenceXml(ol: OrderLineReference | undefined): string {
    if (!ol) return "";
    let s = "<cac:OrderLineReference>";
    if (ol.lineId) s += cbc("LineID", ol.lineId);
    if (ol.salesOrderLineId) s += cbc("SalesOrderLineID", ol.salesOrderLineId);
    s += orderReferenceXml(ol.orderReference);
    s += "</cac:OrderLineReference>";
    if (s === "<cac:OrderLineReference></cac:OrderLineReference>") return "";
    return s;
}

function itemXml(item: Item | undefined): string {
    if (!item) return "";
    let s = "<cac:Item>";
    if (item.description) s += cbc("Description", item.description);
    if (item.name) s += cbc("Name", item.name);
    if (item.buyersItemIdentification?.id) {
        s += `<cac:BuyersItemIdentification>${cbc("ID", item.buyersItemIdentification.id)}</cac:BuyersItemIdentification>`;
    }
    if (item.sellersItemIdentification?.id) {
        s += `<cac:SellersItemIdentification>${cbc("ID", item.sellersItemIdentification.id)}</cac:SellersItemIdentification>`;
    }
    if (item.itemInstance?.lotIdentification) {
        const lot = item.itemInstance.lotIdentification;
        s += "<cac:ItemInstance><cac:LotIdentification>";
        if (lot.lotNumberId) s += cbc("LotNumberID", lot.lotNumberId);
        if (lot.expiryDate) s += cbc("ExpiryDate", lot.expiryDate);
        s += "</cac:LotIdentification></cac:ItemInstance>";
    }
    s += "</cac:Item>";
    if (s === "<cac:Item></cac:Item>") return "";
    return s;
}

function despatchLineXml(line: DespatchLine, fallbackId: string): string {
    const id = line.id != null && String(line.id) !== "" ? String(line.id) : fallbackId;
    let s = "<cac:DespatchLine>";
    s += cbc("ID", id);
    if (line.note) s += cbc("Note", line.note);
    if (line.lineStatusCode) s += cbc("LineStatusCode", line.lineStatusCode);
    if (line.deliveredQuantity != null) {
        const u = line.deliveredQuantityUnitCode ?? "C62";
        s += `<cbc:DeliveredQuantity unitCode="${escapeXml(u)}">${escapeXml(
            line.deliveredQuantity
        )}</cbc:DeliveredQuantity>`;
    }
    if (line.backorderQuantity != null) {
        const u = line.backorderQuantityUnitCode ?? "C62";
        s += `<cbc:BackorderQuantity unitCode="${escapeXml(u)}">${escapeXml(
            line.backorderQuantity
        )}</cbc:BackorderQuantity>`;
    }
    if (line.backorderReason) s += cbc("BackorderReason", line.backorderReason);
    s += orderLineReferenceXml(line.orderLineReference);
    s += itemXml(line.item);
    s += "</cac:DespatchLine>";
    return s;
}

function buildUblXml(doc: DespatchAdvice): string {
    const header =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<DespatchAdvice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" ' +
        'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
        'xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2">';

    let body = "";
    body += cbc("UBLVersionID", "2.1");
    body += cbc(
        "CustomizationID",
        "urn:oasis:names:specification:ubl:xpath:DespatchAdvice-2"
    );
    body += cbc(
        "ProfileID",
        "bpid:urn:oasis:names:draft:bpss:ubl-2-sbs-despatch-advice-notification-draft"
    );
    body += cbc("ID", doc.documentId);
    body += cbc("CopyIndicator", doc.copyIndicator === true);
    body += cbc("UUID", doc.despatchAdviceId.toUpperCase());
    if (doc.issueDate) body += cbc("IssueDate", doc.issueDate);
    if (doc.documentStatusCode) body += cbc("DocumentStatusCode", doc.documentStatusCode);
    body += cbc(
        "DespatchAdviceTypeCode",
        doc.despatchAdviceTypeCode && doc.despatchAdviceTypeCode !== ""
            ? doc.despatchAdviceTypeCode
            : "delivery"
    );
    if (doc.note) body += cbc("Note", doc.note);

    body += orderReferenceXml(doc.orderReference);

    if (doc.despatchSupplierParty) {
        const dsp = doc.despatchSupplierParty;
        body += "<cac:DespatchSupplierParty>";
        if (dsp.customerAssignedAccountId) {
            body += cbc("CustomerAssignedAccountID", dsp.customerAssignedAccountId);
        }
        body += partyXml(dsp.party);
        body += "</cac:DespatchSupplierParty>";
    }

    if (doc.deliveryCustomerParty) {
        const dcp = doc.deliveryCustomerParty;
        body += "<cac:DeliveryCustomerParty>";
        if (dcp.customerAssignedAccountId) {
            body += cbc("CustomerAssignedAccountID", dcp.customerAssignedAccountId);
        }
        if (dcp.supplierAssignedAccountId) {
            body += cbc("SupplierAssignedAccountID", dcp.supplierAssignedAccountId);
        }
        body += partyXml(dcp.party);
        body += "</cac:DeliveryCustomerParty>";
    }

    body += shipmentXml(doc.shipment);

    const lines = doc.despatchLines ?? [];
    lines.forEach((line, i) => {
        body += despatchLineXml(line, String(i + 1));
    });

    for (const ref of doc.additionalDocumentReference ?? []) {
        body += "<cac:AdditionalDocumentReference>";
        body += cbc("ID", ref.id);
        body += cbc("DocumentType", ref.documentType);
        body += "</cac:AdditionalDocumentReference>";
    }

    return `${header}\n${body}\n</DespatchAdvice>`;
}

/**
 * GET /despatch-advices/{despatchAdviceId}/ubl
 * Serialises a stored despatch advice to UBL DespatchAdvice XML (2.1-style metadata and OASIS 2.x namespaces).
 */
/**
 * Table key is despatchAdviceId; documentId is a plain attribute (no GSI in app code).
 * Scan with FilterExpression must not use Limit: 1 — DynamoDB applies the filter after
 * reading at most Limit items, so a match on a later row would never be seen.
 */
export async function findDespatchAdviceByDocumentId(documentId: string): Promise<Record<string, unknown> | null> {
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;
    do {
        const result = await dynamo.send(
            new ScanCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                FilterExpression: "documentId = :d",
                ExpressionAttributeValues: marshall({ ":d": documentId }),
                ExclusiveStartKey: exclusiveStartKey,
            })
        );
        if (result.Items && result.Items.length > 0) {
            return unmarshall(result.Items[0]) as Record<string, unknown>;
        }
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return null;
}

export async function exportDespatchAdviceAsUblXml(despatchAdviceId: string) {
    if (!despatchAdviceId?.trim()) {
        return badRequest("Despatch advice id is required");
    }
    try {
        const result = await dynamo.send(
            new GetItemCommand({
                TableName: DESPATCH_ADVICES_TABLE,
                Key: marshall({ despatchAdviceId }),
            })
        );
        if (!result.Item) {
            return notFound(`Despatch advice not found: ${despatchAdviceId}`);
        }
        const doc = unmarshall(result.Item) as DespatchAdvice;
        const xml = buildUblXml(doc);
        return {
            statusCode: 200,
            headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/xml; charset=utf-8",
            },
            body: xml,
        };
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
            headers: CORS_HEADERS,
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
            headers: CORS_HEADERS,
            body: JSON.stringify({
                error: "BadRequest",
                message: parseError,
            }),
        };
    }

    // ensure path ID and body ID are consistent (when both provided)
    const bodyDocId = body.documentId ?? body.documentID;
    if (bodyDocId != null && String(bodyDocId) !== documentId) {
        return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                error: "BadRequest",
                message: "documentId in path and body must match",
            }),
        };
    }

    // always use the path parameter as the canonical documentId
    body.documentId = documentId;
    if ("documentID" in body) delete body.documentID;

    // validate required fields according to swagger schema
    const validationError = validateDespatchAdvice(body);
    if (validationError) {
        return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({
                error: "BadRequest",
                message: validationError,
            }),
        };
    }

    try {
        const existing = await findDespatchAdviceByDocumentId(documentId);

        if (!existing) {
            return {
                statusCode: 404,
                headers: CORS_HEADERS,
                body: JSON.stringify({
                    error: "NotFound",
                    message: "Despatch advice not found",
                }),
            };
        }

        if (!sessionMayModifyDespatchAdvice(existing as { senderId?: string; clientId?: string }, clientId)) {
            return {
                statusCode: 401,
                headers: CORS_HEADERS,
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
        if (existing.clientId !== undefined) {
            updated.clientId = existing.clientId;
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
            headers: CORS_HEADERS,
            body: JSON.stringify(updated),
        };
    } catch (err: any) {
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
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
            headers: CORS_HEADERS,
            body: JSON.stringify({
                error: "Unauthorized",
                message: "Invalid or missing session",
            }),
        };
    }

    try {
        const existing = await findDespatchAdviceByDocumentId(documentId);

        if (!existing) {
            return {
                statusCode: 404,
                headers: CORS_HEADERS,
                body: JSON.stringify({
                    error: "NotFound",
                    message: "Despatch advice not found",
                }),
            };
        }

        if (!sessionMayModifyDespatchAdvice(existing as { senderId?: string; clientId?: string }, clientId)) {
            return {
                statusCode: 401,
                headers: CORS_HEADERS,
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
            headers: CORS_HEADERS,
            body: "",
        };
    } catch (err: any) {
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
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
