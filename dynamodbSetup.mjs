import {
    DynamoDBClient,
    CreateTableCommand,
    UpdateTimeToLiveCommand,
  } from "@aws-sdk/client-dynamodb";
  
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  // For local development with DynamoDB Local:
  //   endpoint: 'http://localhost:8000'
  // For AWS deployment:
  //   remove endpoint and set region to your target region
  // ---------------------------------------------------------------------------
  
  const client = new DynamoDBClient({
    region: "ap-southeast-2",
    endpoint: "http://localhost:8000",  // uncomment for DynamoDB Local
  });
  
  
  // ---------------------------------------------------------------------------
  // Helper — create a table, skipping gracefully if it already exists
  // ---------------------------------------------------------------------------
  async function createTableSafe(tableDefinition) {
    const tableName = tableDefinition.TableName;
    try {
      await client.send(new CreateTableCommand(tableDefinition));
      console.log(`[+] Created table: ${tableName}`);
    } catch (err) {
      if (err.name === "ResourceInUseException") {
        console.log(`[~] Table already exists, skipping: ${tableName}`);
      } else {
        throw err;
      }
    }
  }
  
  
  // ---------------------------------------------------------------------------
  // Table: Clients
  //
  // Stores registered API clients (businesses or systems) that interact with
  // the service. Each client has a unique username and a hashed password.
  //
  // Security: passwords are stored as bcrypt/argon2 hashes — plain-text
  // passwords must never be persisted.
  //
  // Performance: the GSI on 'username' enables an O(1) lookup during login
  // instead of a full table scan.
  // ---------------------------------------------------------------------------
  const CLIENTS_TABLE = {
    TableName: "Clients",
    KeySchema: [
      { AttributeName: "clientId", KeyType: "HASH" },   // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: "clientId", AttributeType: "S" },
      { AttributeName: "username", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "username-index",
        KeySchema: [
          { AttributeName: "username", KeyType: "HASH" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
    // Item shape (DynamoDB is schemaless beyond the key attributes):
    // {
    //   clientId:     String  — UUID, PK; auto-generated on registration
    //   username:     String  — GSI key; unique login identifier
    //   passwordHash: String  — bcrypt/argon2 hash (NEVER store plain-text)
    //   createdAt:    String  — ISO-8601 timestamp
    // }
  };
  
  
  // ---------------------------------------------------------------------------
  // Table: Sessions
  //
  // Tracks active authenticated sessions. A session is created on login and
  // invalidated on logout or expiry. The sessionId is passed as a header on
  // every protected request and validated before the request is processed.
  //
  // Security: session IDs are UUIDs generated server-side and are never
  // derived from user-supplied input.
  //
  // Performance: DynamoDB TTL automatically removes expired session items
  // without requiring any application-layer cleanup job.
  // ---------------------------------------------------------------------------
  const SESSIONS_TABLE = {
    TableName: "Sessions",
    KeySchema: [
      { AttributeName: "sessionId", KeyType: "HASH" },  // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: "sessionId", AttributeType: "S" },
    ],
    BillingMode: "PAY_PER_REQUEST",
    // Item shape:
    // {
    //   sessionId: String  — UUID, PK; returned to the client on login
    //   clientId:  String  — FK → Clients.clientId
    //   createdAt: String  — ISO-8601 timestamp
    //   ttl:       Number  — Unix epoch timestamp; DynamoDB auto-deletes after this time
    // }
  };
  
  
  // ---------------------------------------------------------------------------
  // Enable TTL on Sessions table (must be called after table creation)
  // ---------------------------------------------------------------------------
  async function enableSessionsTTL() {
    try {
      await client.send(new UpdateTimeToLiveCommand({
        TableName: "Sessions",
        TimeToLiveSpecification: {
          Enabled: true,
          AttributeName: "ttl",
        },
      }));
      console.log("[+] TTL enabled on Sessions table (attribute: 'ttl')");
    } catch (err) {
      console.error(`[!] Could not enable TTL on Sessions: ${err.message}`);
    }
  }
  
  
  // ---------------------------------------------------------------------------
  // Table: DespatchAdvices
  //
  // Stores despatch advice documents sent by a despatch party to a delivery
  // party to confirm that goods have been shipped. Each document captures the
  // supplier party details, shipment information, and individual despatch
  // lines describing the items being sent.
  //
  // Nested objects (DespatchSupplierParty, DeliveryCustomerParty, Party,
  // PostalAddress, Contact, Shipment, Delivery, DeliveryPeriod, DespatchLine,
  // Item, OrderReference) are stored as embedded Maps alongside their parent
  // document — reads and writes always involve the full document together, so
  // no joins or separate table lookups are needed.
  //
  // Performance: the GSI on 'senderId' allows the despatch party to list all
  // of their own documents without scanning the full table.
  // ---------------------------------------------------------------------------
  const DESPATCH_ADVICES_TABLE = {
    TableName: "DespatchAdvices",
    KeySchema: [
      { AttributeName: "despatchAdviceId", KeyType: "HASH" },  // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: "despatchAdviceId", AttributeType: "S" },
      { AttributeName: "senderId",         AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "sender-index",
        KeySchema: [
          { AttributeName: "senderId", KeyType: "HASH" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
    // Item shape:
    // {
    //   despatchAdviceId:        String   — UUID, PK; auto-generated
    //   documentId:              String   — user-provided despatch advice number
    //   senderId:                String   — GSI key; FK → Clients.clientId (despatch party)
    //   receiverId:              String   — FK → Clients.clientId (delivery party)
    //   copyIndicator:           Boolean  — true if this is a copy of another document
    //   replaces:                String?  — documentId of the advice this supersedes
    //   issueDate:               String   — date the document was issued (YYYY-MM-DD)
    //   documentStatusCode:      String   — current status of the document
    //   despatchAdviceTypeCode:  String   — type code, default "delivery"
    //   note:                    String?  — general note
    //   status:                  String   — "DESPATCHED" | "RECEIVED" | "FULFILMENT_CANCELLED"
    //   orderReference: {                 ← OrderReference (embedded Map)
    //     id:           String,
    //     salesOrderId: String?,
    //     uuid:         String?,
    //     issueDate:    String?,
    //   },
    //   despatchSupplierParty: {          ← DespatchSupplierParty (embedded Map)
    //     customerAssignedAccountId: String?,
    //     party: {                        ← Party (embedded Map)
    //       name: String,
    //       postalAddress: {              ← PostalAddress (embedded Map)
    //         streetName:                String,
    //         buildingName:              String?,
    //         buildingNumber:            String?,
    //         cityName:                  String,
    //         postalZone:                String,
    //         countrySubentity:          String?,
    //         addressLine:               String?,
    //         countryIdentificationCode: String,
    //       },
    //       contact: {                    ← Contact (embedded Map)
    //         name:      String?,
    //         telephone: String?,
    //         telefax:   String?,
    //         email:     String?,
    //       }
    //     }
    //   },
    //   deliveryCustomerParty: {          ← DeliveryCustomerParty (embedded Map)
    //     customerAssignedAccountId: String?,
    //     supplierAssignedAccountId: String?,
    //     party: { ... }                  ← same Party shape as above
    //   },
    //   shipment: {                       ← Shipment (embedded Map)
    //     id:            String,
    //     consignmentId: String,
    //     delivery: {                     ← Delivery (embedded Map)
    //       id:              String?,
    //       deliveryAddress: { ... },     ← PostalAddress (embedded Map)
    //       requestedDeliveryPeriod: {    ← DeliveryPeriod (embedded Map)
    //         startDate: String,
    //         startTime: String?,
    //         endDate:   String,
    //         endTime:   String?,
    //       }
    //     }
    //   },
    //   despatchLines: [                  ← Array of DespatchLine (embedded List)
    //     {
    //       id:                        String,
    //       note:                      String?,
    //       lineStatusCode:            String?,
    //       deliveredQuantity:         Number,
    //       deliveredQuantityUnitCode: String,
    //       backorderQuantity:         Number?,
    //       backorderQuantityUnitCode: String?,
    //       backorderReason:           String?,
    //       orderLineReference: {      ← OrderLineReference (embedded Map)
    //         lineId:          String,
    //         salesOrderLineId:String?,
    //         orderReference:  { ... }
    //       },
    //       item: {                    ← Item (embedded Map)
    //         description: String,
    //         name:        String,
    //         buyersItemIdentification:  { id: String }?,
    //         sellersItemIdentification: { id: String }?,
    //         itemInstance: {
    //           lotIdentification: { lotNumberId: String?, expiryDate: String? }?
    //         }?
    //       }
    //     }
    //   ]
    // }
  };
  
  
  // ---------------------------------------------------------------------------
  // Table: ReceiptAdvices
  //
  // Stores receipt advice documents sent by the delivery party back to the
  // despatch party to confirm that goods have been received. The document can
  // also report shortages or damaged items against the original despatch,
  // with each receipt line capturing the quantity actually received alongside
  // any short-shipped quantities.
  //
  // Each receipt advice is linked to a parent despatch advice. The full
  // document — including party details, shipment, and receipt lines — is
  // stored as a single item with all nested objects as embedded Maps, since
  // the data is always read and written together.
  //
  // Security: only the authenticated delivery party (submitterId) may create
  // a receipt advice for a given despatch. The application layer enforces this
  // by comparing the session's clientId against the despatch's receiverId
  // before writing.
  //
  // Performance: the GSI on 'despatchAdviceId' supports an O(1) lookup when
  // fetching the receipt advice for a given despatch (GET /receiptadvices).
  // The GSI on 'submitterId' supports listing all receipts raised by a
  // particular delivery party without a full table scan.
  // ---------------------------------------------------------------------------
  const RECEIPT_ADVICES_TABLE = {
    TableName: "ReceiptAdvices",
    KeySchema: [
      { AttributeName: "receiptAdviceId", KeyType: "HASH" },  // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: "receiptAdviceId",  AttributeType: "S" },
      { AttributeName: "despatchAdviceId", AttributeType: "S" },
      { AttributeName: "submitterId",      AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        // Supports GET /api/v1/receiptadvices/{despatchAdviceId}
        IndexName: "despatch-advice-index",
        KeySchema: [
          { AttributeName: "despatchAdviceId", KeyType: "HASH" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
      {
        // Supports listing all receipt advices submitted by a delivery party
        IndexName: "submitter-index",
        KeySchema: [
          { AttributeName: "submitterId", KeyType: "HASH" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
    // Item shape:
    // {
    //   receiptAdviceId:    String   — UUID, PK; auto-generated
    //   documentId:         String   — user-provided receipt advice number
    //   despatchAdviceId:   String   — GSI key; FK → DespatchAdvices.despatchAdviceId
    //   submitterId:        String   — GSI key; FK → Clients.clientId (delivery party submitting)
    //   receiverId:         String   — FK → Clients.clientId (despatch party receiving this doc)
    //   copyIndicator:      Boolean  — true if this is a copy of another document
    //   replaces:           String?  — receiptAdviceId of the document this supersedes
    //   issueDate:          String?  — date the document was issued (YYYY-MM-DD); defaults to today
    //   documentStatusCode: String   — current status of the document
    //   note:               String?  — general note
    //   orderReference: {            ← OrderReference (embedded Map)
    //     id:           String,
    //     salesOrderId: String?,
    //     uuid:         String?,
    //     issueDate:    String?,
    //   },
    //   despatchDocumentReference: { ← DocumentReference (embedded Map)
    //     id:        String,
    //     uuid:      String?,
    //     issueDate: String?,
    //   }?,
    //   despatchSupplierParty: {     ← DespatchSupplierParty (embedded Map)
    //     customerAssignedAccountId: String?,
    //     party: {                   ← Party (embedded Map)
    //       name: String,
    //       postalAddress: {         ← PostalAddress (embedded Map)
    //         streetName:                String,
    //         buildingName:              String?,
    //         buildingNumber:            String?,
    //         cityName:                  String,
    //         postalZone:                String,
    //         countrySubentity:          String?,
    //         addressLine:               String?,
    //         countryIdentificationCode: String,
    //       },
    //       contact: {               ← Contact (embedded Map)
    //         name:      String?,
    //         telephone: String?,
    //         telefax:   String?,
    //         email:     String?,
    //       }
    //     }
    //   },
    //   deliveryCustomerParty: {     ← DeliveryCustomerParty (embedded Map)
    //     customerAssignedAccountId: String?,
    //     supplierAssignedAccountId: String?,
    //     party: { ... }             ← same Party shape as above
    //   },
    //   shipment: {                  ← ReceiptShipment (embedded Map)
    //     id:            String,
    //     consignmentId: String,
    //     delivery: {                ← ReceiptDelivery (embedded Map)
    //       id:                   String?,
    //       quantity:             Number?,
    //       quantityUnitCode:     String?,
    //       actualDeliveryDate:   String?,  (YYYY-MM-DD)
    //       actualDeliveryTime:   String?,
    //       requestedDeliveryPeriod: {      ← DeliveryPeriod (embedded Map)
    //         startDate: String,
    //         startTime: String?,
    //         endDate:   String,
    //         endTime:   String?,
    //       }?
    //     }
    //   },
    //   receiptLines: [              ← Array of ReceiptLine (embedded List)
    //     {
    //       id:                       String,
    //       note:                     String?,
    //       receivedQuantity:         Number,
    //       receivedQuantityUnitCode: String,
    //       shortQuantity:            Number?,
    //       shortQuantityUnitCode:    String?,
    //       item: {                   ← Item (embedded Map)
    //         description: String,
    //         name:        String,
    //         buyersItemIdentification:  { id: String }?,
    //         sellersItemIdentification: { id: String }?,
    //         itemInstance: {
    //           lotIdentification: { lotNumberId: String?, expiryDate: String? }?
    //         }?
    //       }
    //     }
    //   ]
    // }
  };
  
  
  // ---------------------------------------------------------------------------
  // Table: OrderChanges
  //
  // Records changes made to an existing order, capturing the buyer and seller
  // parties involved and a description of what was modified. Multiple change
  // records can exist for the same order reference.
  //
  // Performance: the GSI on 'orderReferenceId' allows all changes for a given
  // order to be retrieved in a single query without a full table scan.
  // ---------------------------------------------------------------------------
  const ORDER_CHANGES_TABLE = {
    TableName: "OrderChanges",
    KeySchema: [
      { AttributeName: "id", KeyType: "HASH" },           // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: "id",               AttributeType: "S" },
      { AttributeName: "orderReferenceId", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "order-ref-index",
        KeySchema: [
          { AttributeName: "orderReferenceId", KeyType: "HASH" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
    // Item shape:
    // {
    //   id:               String  — UUID, PK
    //   issueDate:        String  — date the change was recorded (YYYY-MM-DD)
    //   orderReferenceId: String  — GSI key; the order being changed
    //   changesMade:      String  — description of what was changed
    //   buyer:  { name: String, postalAddress: {...}, contact: {...} }  ← Party
    //   seller: { name: String, postalAddress: {...}, contact: {...} }  ← Party
    // }
  };
  
  
  // ---------------------------------------------------------------------------
  // Table: OrderCancellations
  //
  // Records requests to cancel a previously submitted document. Cancellations
  // move through a status lifecycle: pending → approved or rejected.
  //
  // Performance: the GSI on 'documentId' supports checking whether a document
  // has already been cancelled before allowing further operations on it,
  // avoiding redundant writes.
  // ---------------------------------------------------------------------------
  const ORDER_CANCELLATIONS_TABLE = {
    TableName: "OrderCancellations",
    KeySchema: [
      { AttributeName: "cancellationId", KeyType: "HASH" }, // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: "cancellationId", AttributeType: "S" },
      { AttributeName: "documentId",     AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "document-index",
        KeySchema: [
          { AttributeName: "documentId", KeyType: "HASH" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
    // Item shape:
    // {
    //   cancellationId:    String  — UUID, PK
    //   documentType:      String  — type of document being cancelled, e.g. "DespatchAdvice"
    //   documentId:        String  — GSI key; the document being cancelled
    //   reason:            String  — reason for cancellation
    //   status:            String  — "pending" | "approved" | "rejected"
    //   cancelledByUserId: String  — FK → Clients.clientId
    //   cancelledAt:       String  — ISO-8601 timestamp
    // }
  };
  
  
  // ---------------------------------------------------------------------------
  // Table: FulfilmentCancellations
  //
  // Stores fulfilment cancellation documents, which are used to formally
  // retract a previously submitted despatch advice or receipt advice. For
  // example, a supplier may cancel a despatch advice when a shipment cannot
  // proceed due to unavailable stock or a cancelled order. Similarly, a
  // delivery party may cancel a receipt advice if an error is discovered
  // after submission, such as incorrect product identification or a problem
  // with a delivered item.
  //
  // Shipment, Delivery, and DeliveryPeriod are embedded as nested Maps since
  // they are always read and written as part of the same document.
  //
  // Performance: the GSI on 'submitterId' supports listing all cancellations
  // raised by a particular client without a full table scan.
  // ---------------------------------------------------------------------------
  const FULFILMENT_CANCELLATIONS_TABLE = {
    TableName: "FulfilmentCancellations",
    KeySchema: [
      { AttributeName: "documentId", KeyType: "HASH" },   // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: "documentId",  AttributeType: "S" },
      { AttributeName: "submitterId", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "submitter-index",
        KeySchema: [
          { AttributeName: "submitterId", KeyType: "HASH" },
        ],
        Projection: { ProjectionType: "ALL" },
      },
    ],
    BillingMode: "PAY_PER_REQUEST",
    // Item shape:
    // {
    //   documentId:  String  — PK
    //   receiverId:  String  — FK → Clients.clientId
    //   submitterId: String  — GSI key; FK → Clients.clientId
    //   issueDate:   String  — date the cancellation was issued (YYYY-MM-DD)
    //   note:        String  — reason or general note for the cancellation
    //   shipment: {                           ← Shipment (embedded Map)
    //     id:            String,
    //     consignmentId: String,
    //     delivery: {                         ← Delivery (embedded Map)
    //       id:              String?,
    //       deliveryAddress: { ... },         ← PostalAddress (embedded Map)
    //       requestedDeliveryPeriod: {        ← DeliveryPeriod (embedded Map)
    //         startDate: String,
    //         startTime: String?,
    //         endDate:   String,
    //         endTime:   String?,
    //       }
    //     }
    //   }
    // }
  };
  
  
  // ---------------------------------------------------------------------------
  // Main — create all tables
  // ---------------------------------------------------------------------------
  const ALL_TABLES = [
    CLIENTS_TABLE,
    SESSIONS_TABLE,
    DESPATCH_ADVICES_TABLE,
    RECEIPT_ADVICES_TABLE,
    ORDER_CHANGES_TABLE,
    ORDER_CANCELLATIONS_TABLE,
    FULFILMENT_CANCELLATIONS_TABLE,
  ];
  
  async function main() {
    console.log("=== Creating DynamoDB tables ===\n");
  
    for (const tableDef of ALL_TABLES) {
      await createTableSafe(tableDef);
    }
  
    console.log();
    await enableSessionsTTL();
    console.log("\n=== Done ===");
  }
  
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });