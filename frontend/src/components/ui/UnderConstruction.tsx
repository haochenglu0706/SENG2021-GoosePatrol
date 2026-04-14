import styles from "./UnderConstruction.module.css";

export function UnderConstruction({ name }: { name: string }) {
  return (
    <div className={styles.root}>
      <div className={styles.icon}>🚧</div>
      <div className={styles.title}>{name} Coming Soon</div>
      <p className={styles.sub}>
        This section is under active development. Check back soon for a full-featured{" "}
        {name.toLowerCase()} management interface.
      </p>
      <span className={styles.badge}>UNDER CONSTRUCTION</span>
    </div>
  );
}
