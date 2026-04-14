import { GetItemCommand, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { CORS_HEADERS } from "../cors.js";
import {
  dynamo,
  CLIENTS_TABLE,
  DESPATCH_ADVICES_TABLE,
  RECEIPT_ADVICES_TABLE,
} from "../db.js";
import { verifySession } from "./auth.js";
import { findDespatchAdviceByDocumentId } from "./despatchAdvice.js";

/// /////////////////////////////////////////////////////////////////////////////
/// Types (aligned with swagger.yaml ReceiptAdviceCreateRequest + nested schemas)
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

interface ReceiptDelivery {
  id?: string;
  quantity?: number;
  quantityUnitCode?: string;
  actualDeliveryDate?: string;
  actualDeliveryTime?: string;
  requestedDeliveryPeriod?: DeliveryPeriod;
}

interface ReceiptAdviceShipment {
  id?: string;
  consignmentId?: string;
  delivery?: ReceiptDelivery;
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

interface DocumentReference {
  id?: string;
  uuid?: string;
  issueDate?: string;
}

interface ReceiptLine {
  id?: string;
  note?: string;
  receivedQuantity?: number;
  receivedQuantityUnitCode?: string;
  shortQuantity?: number;
  shortQuantityUnitCode?: string;
  item?: Item;
}

/// /////////////////////////////////////////////////////////////////////////////
/// Response helpers
/// /////////////////////////////////////////////////////////////////////////////

function badRequest(message: string) {
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "BadRequest", message }),
  };
}

function notFound(message: string) {
  return {
    statusCode: 404,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "NotFound", message }),
  };
}

function internalError(err: unknown) {
  const message = err instanceof Error ? err.message : "Unexpected error";
  return {
    statusCode: 500,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "InternalServerError", message }),
  };
}

function unauthorized(message: string) {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: "Unauthorized", message }),
  };
}

/** Session header on API Gateway events (aligned with despatchAdvice.ts). */
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
 * Receipt advice is created by the receiving party (buyer), often a different client than
 * whoever created the despatch (supplier). `clientId` on the despatch row is the supplier’s
 * session when they created it — we must not use that here or the supplier could post a receipt.
 * Authorisation: session client must match `receiverId` (set despatch.receiverId to the buyer’s
 * registered clientId so the buyer’s login matches).
 */
function sessionMayCreateReceiptAdvice(
  despatch: { receiverId?: string },
  sessionClientId: string,
  sessionUsername?: string
): boolean {
  if (despatch.receiverId != null && despatch.receiverId === sessionClientId) return true;
  if (sessionUsername && despatch.receiverId != null && despatch.receiverId === sessionUsername) {
    return true;
  }
  return false;
}

async function getUsernameByClientId(clientId: string): Promise<string | undefined> {
  const result = await dynamo.send(
    new GetItemCommand({
      TableName: CLIENTS_TABLE,
      Key: marshall({ clientId }),
    })
  );
  if (!result.Item) return undefined;
  const row = unmarshall(result.Item) as { username?: unknown };
  return typeof row.username === "string" ? row.username : undefined;
}

function sessionMayReadReceiptAdvice(
  receipt: { senderId?: string; receiverId?: string; clientId?: string },
  sessionClientId: string,
  sessionUsername?: string
): boolean {
  if (receipt.clientId != null && receipt.clientId === sessionClientId) return true;
  if (receipt.senderId != null && receipt.senderId === sessionClientId) return true;
  if (receipt.receiverId != null && receipt.receiverId === sessionClientId) return true;
  if (sessionUsername) {
    if (receipt.senderId != null && receipt.senderId === sessionUsername) return true;
    if (receipt.receiverId != null && receipt.receiverId === sessionUsername) return true;
  }
  return false;
}

/// /////////////////////////////////////////////////////////////////////////////
/// Body parsing (mirror despatchAdvice.ts)
/// /////////////////////////////////////////////////////////////////////////////

/** Swagger uses `documentID`; we store `documentId` in DynamoDB. */
function normalizeReceiptAdviceBody(body: Record<string, unknown>): void {
  if (body.documentID != null && body.documentId == null) {
    body.documentId = body.documentID;
  }
}

function parseBody(event: any): { body: Record<string, unknown>; error?: string } {
  if (event == null) {
    return { body: {} };
  }

  if (typeof event.body === "string") {
    try {
      const parsed = JSON.parse(event.body) as Record<string, unknown>;
      normalizeReceiptAdviceBody(parsed);
      return { body: parsed };
    } catch {
      return { body: {}, error: "Invalid JSON body" };
    }
  }

  if (event.body !== undefined && typeof event.body === "object" && event.body !== null) {
    const b = event.body as Record<string, unknown>;
    normalizeReceiptAdviceBody(b);
    return { body: b };
  }

  if (typeof event === "object") {
    const b = event as Record<string, unknown>;
    normalizeReceiptAdviceBody(b);
    return { body: b };
  }

  return { body: {} };
}

/// /////////////////////////////////////////////////////////////////////////////
/// Validation (swagger ReceiptAdviceCreateRequest required + nested required)
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
  if (!nonEmptyString(a.countryIdentificationCode)) {
    return `${path}.countryIdentificationCode is required`;
  }
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

function validateReceiptDelivery(d: unknown, path: string): string | null {
  if (!d || typeof d !== "object") return `${path} is required`;
  const x = d as Record<string, unknown>;
  if (x.requestedDeliveryPeriod !== undefined && x.requestedDeliveryPeriod !== null) {
    return validateDeliveryPeriod(x.requestedDeliveryPeriod, `${path}.requestedDeliveryPeriod`);
  }
  return null;
}

function validateReceiptShipment(ship: unknown, path: string): string | null {
  if (!ship || typeof ship !== "object") return `${path} is required`;
  const s = ship as Record<string, unknown>;
  if (!nonEmptyString(s.id)) return `${path}.id is required`;
  if (!nonEmptyString(s.consignmentId)) return `${path}.consignmentId is required`;
  return validateReceiptDelivery(s.delivery, `${path}.delivery`);
}

function validateOrderReference(or: unknown, path: string): string | null {
  if (!or || typeof or !== "object") return `${path} is required`;
  const o = or as Record<string, unknown>;
  if (!nonEmptyString(o.id)) return `${path}.id is required`;
  return null;
}

function validateDocumentReference(dr: unknown, path: string): string | null {
  if (!dr || typeof dr !== "object") return `${path} must be an object`;
  const d = dr as Record<string, unknown>;
  if (!nonEmptyString(d.id)) return `${path}.id is required`;
  return null;
}

function validateItem(item: unknown, path: string): string | null {
  if (!item || typeof item !== "object") return `${path} is required`;
  const i = item as Record<string, unknown>;
  if (!nonEmptyString(i.name)) return `${path}.name is required`;
  if (!nonEmptyString(i.description)) return `${path}.description is required`;
  return null;
}

function validateReceiptLine(line: unknown, index: number): string | null {
  const prefix = `receiptLines[${index}]`;
  if (!line || typeof line !== "object") return `${prefix} is required`;
  const l = line as Record<string, unknown>;
  if (!nonEmptyString(l.id)) return `${prefix}.id is required`;
  if (typeof l.receivedQuantity !== "number") {
    return `${prefix}.receivedQuantity is required and must be a number`;
  }
  if (!nonEmptyString(l.receivedQuantityUnitCode)) {
    return `${prefix}.receivedQuantityUnitCode is required`;
  }
  return validateItem(l.item, `${prefix}.item`);
}

function validateReceiptAdviceCreateRequest(body: Record<string, unknown>): string | null {
  normalizeReceiptAdviceBody(body);

  if (!nonEmptyString(body.documentId)) return "documentId (or documentID) is required";
  if (!nonEmptyString(body.senderId)) return "senderId is required";
  if (!nonEmptyString(body.receiverId)) return "receiverId is required";
  if (typeof body.copyIndicator !== "boolean") {
    return "copyIndicator is required and must be a boolean";
  }
  if (!nonEmptyString(body.documentStatusCode)) return "documentStatusCode is required";

  const orderRef = validateOrderReference(body.orderReference, "orderReference");
  if (orderRef) return orderRef;

  if (body.despatchDocumentReference != null) {
    const dr = validateDocumentReference(
      body.despatchDocumentReference,
      "despatchDocumentReference"
    );
    if (dr) return dr;
  }

  const dsp = body.despatchSupplierParty;
  if (!dsp || typeof dsp !== "object") return "despatchSupplierParty is required";
  const supplierParty = validateParty(
    (dsp as Record<string, unknown>).party,
    "despatchSupplierParty.party"
  );
  if (supplierParty) return supplierParty;

  const dcp = body.deliveryCustomerParty;
  if (!dcp || typeof dcp !== "object") return "deliveryCustomerParty is required";
  const deliveryParty = validateParty(
    (dcp as Record<string, unknown>).party,
    "deliveryCustomerParty.party"
  );
  if (deliveryParty) return deliveryParty;

  const ship = body.shipment;
  const shipErr = validateReceiptShipment(ship, "shipment");
  if (shipErr) return shipErr;

  const lines = body.receiptLines;
  if (!Array.isArray(lines) || lines.length < 1) {
    return "receiptLines is required and must be a non-empty array";
  }
  for (let i = 0; i < lines.length; i++) {
    const err = validateReceiptLine(lines[i], i);
    if (err) return err;
  }

  return null;
}

/// /////////////////////////////////////////////////////////////////////////////
/// Sanitisation
/// /////////////////////////////////////////////////////////////////////////////

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

function sanitiseOrderReference(raw: Record<string, unknown>): OrderReference {
  const o: OrderReference = {};
  if (nonEmptyString(raw.id)) o.id = raw.id;
  if (nonEmptyString(raw.salesOrderId)) o.salesOrderId = raw.salesOrderId;
  if (nonEmptyString(raw.uuid)) o.uuid = raw.uuid;
  if (nonEmptyString(raw.issueDate)) o.issueDate = raw.issueDate;
  return o;
}

function sanitiseDocumentReference(raw: Record<string, unknown>): DocumentReference {
  const d: DocumentReference = {};
  if (nonEmptyString(raw.id)) d.id = raw.id;
  if (nonEmptyString(raw.uuid)) d.uuid = raw.uuid;
  if (nonEmptyString(raw.issueDate)) d.issueDate = raw.issueDate;
  return d;
}

function sanitiseDeliveryPeriod(raw: Record<string, unknown>): DeliveryPeriod {
  const d: DeliveryPeriod = {};
  if (nonEmptyString(raw.startDate)) d.startDate = raw.startDate;
  if (nonEmptyString(raw.startTime)) d.startTime = raw.startTime;
  if (nonEmptyString(raw.endDate)) d.endDate = raw.endDate;
  if (nonEmptyString(raw.endTime)) d.endTime = raw.endTime;
  return d;
}

function sanitiseReceiptDelivery(raw: Record<string, unknown>): ReceiptDelivery {
  const d: ReceiptDelivery = {};
  if (nonEmptyString(raw.id)) d.id = raw.id;
  if (typeof raw.quantity === "number") d.quantity = raw.quantity;
  if (nonEmptyString(raw.quantityUnitCode)) d.quantityUnitCode = raw.quantityUnitCode;
  if (nonEmptyString(raw.actualDeliveryDate)) d.actualDeliveryDate = raw.actualDeliveryDate;
  if (nonEmptyString(raw.actualDeliveryTime)) d.actualDeliveryTime = raw.actualDeliveryTime;
  if (raw.requestedDeliveryPeriod && typeof raw.requestedDeliveryPeriod === "object") {
    d.requestedDeliveryPeriod = sanitiseDeliveryPeriod(
      raw.requestedDeliveryPeriod as Record<string, unknown>
    );
  }
  return d;
}

function sanitiseReceiptShipment(raw: Record<string, unknown>): ReceiptAdviceShipment {
  const s: ReceiptAdviceShipment = {};
  if (nonEmptyString(raw.id)) s.id = raw.id;
  if (nonEmptyString(raw.consignmentId)) s.consignmentId = raw.consignmentId;
  if (raw.delivery && typeof raw.delivery === "object") {
    s.delivery = sanitiseReceiptDelivery(raw.delivery as Record<string, unknown>);
  }
  return s;
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

function sanitiseReceiptLine(raw: Record<string, unknown>): ReceiptLine {
  const line: ReceiptLine = {};
  if (nonEmptyString(raw.id)) line.id = raw.id;
  if (nonEmptyString(raw.note)) line.note = raw.note;
  if (typeof raw.receivedQuantity === "number") line.receivedQuantity = raw.receivedQuantity;
  if (nonEmptyString(raw.receivedQuantityUnitCode)) {
    line.receivedQuantityUnitCode = raw.receivedQuantityUnitCode;
  }
  if (typeof raw.shortQuantity === "number") line.shortQuantity = raw.shortQuantity;
  if (nonEmptyString(raw.shortQuantityUnitCode)) {
    line.shortQuantityUnitCode = raw.shortQuantityUnitCode;
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

function sanitiseReceiptAdviceCreate(
  body: Record<string, unknown>,
  receiptAdviceId: string,
  despatchAdviceId: string
): Record<string, unknown> {
  normalizeReceiptAdviceBody(body);

  const item: Record<string, unknown> = {
    receiptAdviceId,
    uuid: receiptAdviceId,
    despatchAdviceId,
    documentId: String(body.documentId),
    senderId: String(body.senderId),
    receiverId: String(body.receiverId),
    copyIndicator: body.copyIndicator,
    documentStatusCode: String(body.documentStatusCode),
  };

  item.issueDate = nonEmptyString(body.issueDate)
    ? body.issueDate
    : new Date().toISOString().slice(0, 10);

  if (nonEmptyString(body.replaces)) item.replaces = body.replaces;
  if (nonEmptyString(body.note)) item.note = body.note;

  if (body.orderReference && typeof body.orderReference === "object") {
    item.orderReference = sanitiseOrderReference(body.orderReference as Record<string, unknown>);
  }
  if (body.despatchDocumentReference && typeof body.despatchDocumentReference === "object") {
    item.despatchDocumentReference = sanitiseDocumentReference(
      body.despatchDocumentReference as Record<string, unknown>
    );
  }
  if (body.despatchSupplierParty && typeof body.despatchSupplierParty === "object") {
    item.despatchSupplierParty = sanitiseDespatchSupplierParty(
      body.despatchSupplierParty as Record<string, unknown>
    );
  }
  if (body.deliveryCustomerParty && typeof body.deliveryCustomerParty === "object") {
    item.deliveryCustomerParty = sanitiseDeliveryCustomerParty(
      body.deliveryCustomerParty as Record<string, unknown>
    );
  }
  if (body.shipment && typeof body.shipment === "object") {
    item.shipment = sanitiseReceiptShipment(body.shipment as Record<string, unknown>);
  }
  if (Array.isArray(body.receiptLines)) {
    item.receiptLines = body.receiptLines.map((line) =>
      sanitiseReceiptLine(line as Record<string, unknown>)
    );
  }

  return item;
}

// ---------------------------------------------------------------------------
// GET /receipt-advices/{receiptAdviceId}
// ---------------------------------------------------------------------------
export async function getReceiptAdvice(event: any) {
  const receiptAdviceId: string | undefined = event.pathParameters?.receiptAdviceId;

  if (!receiptAdviceId) {
    return badRequest("receiptAdviceId path parameter is required");
  }

  const sessionClientId = await verifySession(getSessionIdFromEvent(event));
  if (!sessionClientId) {
    return unauthorized("Invalid or missing session");
  }

  let receiptItem: Record<string, any>;
  try {
    const result = await dynamo.send(
      new GetItemCommand({
        TableName: RECEIPT_ADVICES_TABLE,
        Key: marshall({ receiptAdviceId }),
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "NotFound",
          message: `Receipt advice '${receiptAdviceId}' not found`,
        }),
      };
    }

    receiptItem = unmarshall(result.Item);
  } catch (err) {
    console.error("DynamoDB GetItem (ReceiptAdvices) error:", err);
    return internalError(err);
  }

  if (
    !sessionMayReadReceiptAdvice(
      receiptItem as { senderId?: string; receiverId?: string; clientId?: string },
      sessionClientId
    )
  ) {
    let sessionUsername: string | undefined;
    try {
      sessionUsername = await getUsernameByClientId(sessionClientId);
    } catch (err) {
      return internalError(err);
    }
    if (
      !sessionMayReadReceiptAdvice(
        receiptItem as { senderId?: string; receiverId?: string; clientId?: string },
        sessionClientId,
        sessionUsername
      )
    ) {
      return unauthorized("You are not allowed to read this receipt advice");
    }
  }

  if (receiptItem.documentStatusCode === "FULLY_RECEIVED") {
    return {
      statusCode: 409,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Conflict",
        message: "This receipt advice has already been fully received",
      }),
    };
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(receiptItem),
  };
}

/// /////////////////////////////////////////////////////////////////////////////
/// ////////////////////// UBL 2.1 ReceiptAdvice XML export /////////////////////
/// /////////////////////////////////////////////////////////////////////////////

interface ReceiptAdviceRecord {
  receiptAdviceId: string;
  despatchAdviceId?: string;
  documentId: string;
  senderId?: string;
  receiverId?: string;
  /** Set when receipt is created with a session — used for read auth. */
  clientId?: string;
  copyIndicator?: boolean;
  documentStatusCode?: string;
  issueDate?: string;
  uuid?: string;
  note?: string;
  orderReference?: OrderReference;
  despatchDocumentReference?: DocumentReference;
  despatchSupplierParty?: DespatchSupplierParty;
  deliveryCustomerParty?: DeliveryCustomerParty;
  shipment?: ReceiptAdviceShipment;
  receiptLines?: ReceiptLine[];
}

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

function despatchDocumentReferenceXml(dr: DocumentReference | undefined): string {
  if (!dr) return "";
  let s = "<cac:DespatchDocumentReference>";
  if (dr.id) s += cbc("ID", dr.id);
  if (dr.uuid) s += cbc("UUID", dr.uuid);
  if (dr.issueDate) s += cbc("IssueDate", dr.issueDate);
  s += "</cac:DespatchDocumentReference>";
  if (s === "<cac:DespatchDocumentReference></cac:DespatchDocumentReference>") return "";
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

function receiptDeliveryXml(d: ReceiptDelivery | undefined): string {
  if (!d) return "";
  let s = "<cac:Delivery>";
  if (d.id) s += cbc("ID", d.id);
  if (d.quantity != null && d.quantityUnitCode) {
    s += `<cbc:Quantity unitCode="${escapeXml(d.quantityUnitCode)}">${escapeXml(
      d.quantity
    )}</cbc:Quantity>`;
  }
  if (d.actualDeliveryDate) s += cbc("ActualDeliveryDate", d.actualDeliveryDate);
  if (d.actualDeliveryTime) s += cbc("ActualDeliveryTime", d.actualDeliveryTime);
  s += deliveryPeriodXml(d.requestedDeliveryPeriod);
  s += "</cac:Delivery>";
  if (s === "<cac:Delivery></cac:Delivery>") return "";
  return s;
}

function receiptShipmentXml(sh: ReceiptAdviceShipment | undefined): string {
  if (!sh) return "";
  let s = "<cac:Shipment>";
  s += cbc("ID", sh.id != null && String(sh.id) !== "" ? String(sh.id) : "1");
  s += "<cac:Consignment>";
  s += cbc(
    "ID",
    sh.consignmentId != null && String(sh.consignmentId) !== ""
      ? String(sh.consignmentId)
      : "1"
  );
  s += "</cac:Consignment>";
  s += receiptDeliveryXml(sh.delivery);
  s += "</cac:Shipment>";
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

function receiptLineXml(line: ReceiptLine, fallbackId: string): string {
  const id = line.id != null && String(line.id) !== "" ? String(line.id) : fallbackId;
  let s = "<cac:ReceiptLine>";
  s += cbc("ID", id);
  if (line.note) s += cbc("Note", line.note);
  if (line.receivedQuantity != null) {
    const u = line.receivedQuantityUnitCode ?? "C62";
    s += `<cbc:ReceivedQuantity unitCode="${escapeXml(u)}">${escapeXml(
      line.receivedQuantity
    )}</cbc:ReceivedQuantity>`;
  }
  if (line.shortQuantity != null) {
    const u = line.shortQuantityUnitCode ?? "C62";
    s += `<cbc:ShortQuantity unitCode="${escapeXml(u)}">${escapeXml(
      line.shortQuantity
    )}</cbc:ShortQuantity>`;
  }
  s += itemXml(line.item);
  s += "</cac:ReceiptLine>";
  return s;
}

function buildReceiptUblXml(doc: ReceiptAdviceRecord): string {
  const header =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<ReceiptAdvice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" ' +
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
    'xmlns="urn:oasis:names:specification:ubl:schema:xsd:ReceiptAdvice-2">';

  const ublUuid = (doc.uuid ?? doc.receiptAdviceId).toUpperCase();

  let body = "";
  body += cbc("UBLVersionID", "2.1");
  body += cbc(
    "CustomizationID",
    "urn:oasis:names:specification:ubl:xpath:ReceiptAdvice-2"
  );
  body += cbc(
    "ProfileID",
    "bpid:urn:oasis:names:draft:bpss:ubl-2-sbs-receipt-advice-notification-draft"
  );
  body += cbc("ID", doc.documentId);
  body += cbc("CopyIndicator", doc.copyIndicator === true);
  body += cbc("UUID", ublUuid);
  if (doc.issueDate) body += cbc("IssueDate", doc.issueDate);
  if (doc.documentStatusCode) body += cbc("DocumentStatusCode", doc.documentStatusCode);
  if (doc.note) body += cbc("Note", doc.note);

  body += orderReferenceXml(doc.orderReference);
  const despatchRef: DocumentReference | undefined =
    doc.despatchDocumentReference ??
    (doc.despatchAdviceId ? { uuid: doc.despatchAdviceId } : undefined);
  body += despatchDocumentReferenceXml(despatchRef);

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

  body += receiptShipmentXml(doc.shipment);

  const lines = doc.receiptLines ?? [];
  lines.forEach((line, i) => {
    body += receiptLineXml(line, String(i + 1));
  });

  return `${header}\n${body}\n</ReceiptAdvice>`;
}

/**
 * GET /receipt-advices/{receiptAdviceId}/ubl
 * Serialises a stored receipt advice to UBL ReceiptAdvice XML (2.1-style metadata and OASIS 2.x namespaces).
 * Unlike GET /receipt-advices/{id}, this succeeds even when documentStatusCode is FULLY_RECEIVED.
 */
export async function exportReceiptAdviceAsUblXml(receiptAdviceId: string, event: any) {
  if (!receiptAdviceId?.trim()) {
    return badRequest("receiptAdviceId is required");
  }

  const sessionClientId = await verifySession(getSessionIdFromEvent(event));
  if (!sessionClientId) {
    return unauthorized("Invalid or missing session");
  }

  try {
    const result = await dynamo.send(
      new GetItemCommand({
        TableName: RECEIPT_ADVICES_TABLE,
        Key: marshall({ receiptAdviceId }),
      })
    );
    if (!result.Item) {
      return notFound(`Receipt advice not found: ${receiptAdviceId}`);
    }
    const doc = unmarshall(result.Item) as ReceiptAdviceRecord;

    if (!sessionMayReadReceiptAdvice(doc, sessionClientId)) {
      let sessionUsername: string | undefined;
      try {
        sessionUsername = await getUsernameByClientId(sessionClientId);
      } catch (err) {
        return internalError(err);
      }
      if (!sessionMayReadReceiptAdvice(doc, sessionClientId, sessionUsername)) {
        return unauthorized("You are not allowed to read this receipt advice");
      }
    }

    const xml = buildReceiptUblXml(doc);
    return {
      statusCode: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: xml,
    };
  } catch (err) {
    console.error("DynamoDB GetItem (ReceiptAdvice UBL export) error:", err);
    return internalError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /despatch-advices/{despatchAdviceId}/receipt-advices
// ---------------------------------------------------------------------------
export async function createReceiptAdvice(event: any) {
  const pathSegment: string | undefined = event.pathParameters?.despatchAdviceId;

  if (!pathSegment || !nonEmptyString(pathSegment)) {
    return badRequest("despatchAdviceId path parameter is required");
  }

  const sessionClientId = await verifySession(getSessionIdFromEvent(event));
  if (!sessionClientId) {
    return unauthorized("Invalid or missing session");
  }

  const { body, error: parseError } = parseBody(event);
  if (parseError) return badRequest(parseError);

  const validationError = validateReceiptAdviceCreateRequest(body);
  if (validationError) return badRequest(validationError);

  let despatchItem: Record<string, any>;
  try {
    const byKey = await dynamo.send(
      new GetItemCommand({
        TableName: DESPATCH_ADVICES_TABLE,
        Key: marshall({ despatchAdviceId: pathSegment }),
      })
    );

    if (byKey.Item) {
      despatchItem = unmarshall(byKey.Item);
    } else {
      const found = await findDespatchAdviceByDocumentId(pathSegment);
      if (!found) {
        return {
          statusCode: 404,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: "NotFound",
            message: `Despatch advice '${pathSegment}' not found`,
          }),
        };
      }
      despatchItem = found as Record<string, any>;
    }
  } catch (err) {
    console.error("DynamoDB GetItem (DespatchAdvices) error:", err);
    return internalError(err);
  }

  let sessionUsername: string | undefined;
  const receiverId = (despatchItem as { receiverId?: unknown }).receiverId;
  if (receiverId != null && receiverId !== sessionClientId) {
    try {
      sessionUsername = await getUsernameByClientId(sessionClientId);
    } catch (err) {
      return internalError(err);
    }
  }

  if (
    !sessionMayCreateReceiptAdvice(
      despatchItem as { receiverId?: string },
      sessionClientId,
      sessionUsername
    )
  ) {
    return unauthorized("You are not allowed to create a receipt advice for this despatch");
  }

  const despatchAdviceId = String(despatchItem.despatchAdviceId);

  if (despatchItem.status === "RECEIVED") {
    return {
      statusCode: 409,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Conflict",
        message: "This despatch advice has already been fully received",
      }),
    };
  }

  const receiptAdviceId = uuidv4();
  const receiptAdviceItem = sanitiseReceiptAdviceCreate(body, receiptAdviceId, despatchAdviceId);
  receiptAdviceItem.clientId = sessionClientId;

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: RECEIPT_ADVICES_TABLE,
        Item: marshall(receiptAdviceItem, { removeUndefinedValues: true }),
      })
    );
  } catch (err) {
    console.error("DynamoDB PutItem (ReceiptAdvices) error:", err);
    return internalError(err);
  }

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: DESPATCH_ADVICES_TABLE,
        Key: marshall({ despatchAdviceId }),
        UpdateExpression: "SET #st = :s",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: marshall({ ":s": "RECEIVED" }),
      })
    );
  } catch (err) {
    console.error("DynamoDB UpdateItem (DespatchAdvices) error:", err);
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ receiptAdviceId }),
  };
}
