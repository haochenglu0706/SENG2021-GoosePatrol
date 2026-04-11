import { TopBar } from "../../components/layout/TopBar";
import { UnderConstruction } from "../../components/ui/UnderConstruction";
import styles from "./style/invoices.module.css";

export default function InvoicesPage() {
  return (
    <>
      <TopBar title="Invoices" subtitle="Accounts payable and receivable" />
      <div className={`page-body ${styles.page}`}>
        <UnderConstruction name="Invoices" />
      </div>
    </>
  );
}
