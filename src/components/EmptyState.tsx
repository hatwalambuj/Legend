/** Empty state (DESIGN §6): dashed frame, ghost ticket, h3, one line, one CTA. */
import type { ReactNode } from 'react';
import { GhostTicket } from './Icon';
import styles from './EmptyState.module.css';

export function EmptyState({
  title,
  children,
  action,
  headingLevel = 'h3',
  testId,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  headingLevel?: 'h1' | 'h2' | 'h3';
  testId?: string;
}) {
  const H = headingLevel;
  return (
    <div className={styles.empty} data-testid={testId}>
      <GhostTicket />
      <H className={styles.title}>{title}</H>
      {children && <p className={styles.body}>{children}</p>}
      {action}
    </div>
  );
}
