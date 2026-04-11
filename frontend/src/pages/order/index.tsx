import { TopBar } from "../../components/layout/TopBar";
import { UnderConstruction } from "../../components/ui/UnderConstruction";
import styles from "./style/order.module.css";

export default function OrdersPage() {
  return (
    <>
      <TopBar title="Orders" subtitle="Purchase and sales order management" />
      <div className={`page-body ${styles.page}`}>
        <UnderConstruction name="Orders" />
      </div>
    </>
  );
}
