'use client';
/**
 * "Report" on someone else's review (GAP-06): a mailto with the review id and title (MVP moderation is
 * the founder hiding the row). Hidden on your own reviews.
 */
import { useApp } from '@/hooks/useApp';
import { CONTACT_EMAIL, reportReviewHref } from '@/lib/contact';
import styles from './ReviewCard.module.css';

export function ReportReview({
  reviewId,
  titleKey,
  authorHandle,
  title,
}: {
  reviewId: string;
  titleKey: string;
  authorHandle: string;
  /** "Anora (2024)" */
  title: string;
}) {
  const { session } = useApp();
  if (session?.user.handle === authorHandle) return null;
  return (
    <a
      className={styles.report}
      href={reportReviewHref(
        { id: reviewId, titleKey: `${title}, ${titleKey}, by @${authorHandle}` },
        CONTACT_EMAIL,
      )}
      aria-label={`Report review by ${authorHandle}`}
      data-testid="report-review"
    >
      Report
    </a>
  );
}
