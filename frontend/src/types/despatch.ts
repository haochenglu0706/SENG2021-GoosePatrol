export type DespatchAdviceRow = {
  despatchAdviceId: string;
  documentId?: string;
  documentID?: string;
  senderId?: string;
  receiverId?: string;
  status?: string;
  issueDate?: string;
  documentStatusCode?: string;
  copyIndicator?: boolean;
  note?: string;
  orderReference?: { id?: string };
  despatchSupplierParty?: {
    party?: {
      name?: string;
      postalAddress?: Record<string, string | undefined>;
      contact?: Record<string, string | undefined>;
    };
  };
  deliveryCustomerParty?: {
    party?: {
      name?: string;
      postalAddress?: Record<string, string | undefined>;
    };
  };
  shipment?: Record<string, unknown>;
  despatchLines?: Array<{
    id?: string;
    deliveredQuantity?: number;
    deliveredQuantityUnitCode?: string;
    item?: { name?: string; description?: string };
    orderLineReference?: { lineId?: string; orderReference?: { id?: string } };
  }>;
};
