import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Lock,
  MessageSquare,
  ShieldCheck,
  Star,
  UserRound,
} from 'lucide-react';
import {
  EMPTY_RATING_SUMMARY,
  FEEDBACK_CATEGORIES,
  fetchApprovedReviewsPage,
  formatReviewDate,
  submitPrivateFeedback,
  submitPublicReview,
  type FeedbackCategory,
  type PublicReview,
  type RatingSummary,
} from '../lib/reviewsApi';
import {
  FIREBASE_PROJECT_ID,
  getRecentLocalFeedbackTimestamp,
  getRecentLocalReviewTimestamp,
  isFirebaseConfigured,
} from '../lib/firebase';

const REVIEWS_PAGE_SIZE = 6;
const RATING_LABELS: Record<number, string> = {
  1: '1 star · Needs work',
  2: '2 stars · Fair',
  3: '3 stars · Good',
  4: '4 stars · Very good',
  5: '5 stars · Excellent',
};

function StarRow({
  value,
  size = 15,
  className = '',
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(5, value));
  return (
    <span
      className={`rb-star-row ${className}`.trim()}
      aria-label={`${clamped.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((starIndex) => {
        const fillFraction = Math.max(0, Math.min(1, clamped - (starIndex - 1)));
        const fillPercent = Math.round(fillFraction * 100);
        return (
          <span
            key={starIndex}
            className="rb-star-glyph"
            style={{ width: size, height: size }}
            aria-hidden="true"
          >
            <Star size={size} className="rb-star-empty" />
            {fillPercent > 0 && (
              <span className="rb-star-fill-clip" style={{ width: `${fillPercent}%` }}>
                <Star size={size} className="rb-star-filled" />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function HeroRatingSummary({
  summary,
  loading,
}: {
  summary: RatingSummary;
  loading: boolean;
}) {
  const hasReviews = summary.totalReviews > 0;
  const reviewWord = summary.totalReviews === 1 ? 'review' : 'reviews';

  return (
    <a
      href="#ratings-reviews"
      className="hero-rating-summary"
      data-testid="hero_rating_summary"
      onClick={(event) => {
        event.preventDefault();
        document
          .getElementById('ratings-reviews')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
    >
      {loading ? (
        <span className="hero-rating-loading">
          <Star size={14} className="rb-star-empty" aria-hidden="true" />
          <span>Loading ratings…</span>
        </span>
      ) : hasReviews ? (
        <>
          <span className="hero-rating-score">{summary.averageRating.toFixed(1)}</span>
          <StarRow value={summary.averageRating} size={14} />
          <span className="hero-rating-count">
            ({summary.totalReviews.toLocaleString()} {reviewWord})
          </span>
        </>
      ) : (
        <>
          <StarRow value={0} size={14} />
          <span className="hero-rating-count">0 reviews</span>
        </>
      )}
      <span className="hero-rating-divider" aria-hidden="true">
        •
      </span>
      <span className="hero-rating-link">
        View all reviews <ChevronDown size={14} aria-hidden="true" />
      </span>
    </a>
  );
}

export function RatingsAndReviewsSection({
  summary,
  summaryLoading,
  summaryError,
  onSummaryRefresh,
}: {
  summary: RatingSummary;
  summaryLoading: boolean;
  summaryError: string | null;
  onSummaryRefresh: () => Promise<void>;
}) {
  const formIdPrefix = useId();
  const [activeTab, setActiveTab] = useState<'review' | 'feedback'>('review');

  // Public reviews list & pagination state
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [totalMatching, setTotalMatching] = useState(0);
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState<boolean>(isFirebaseConfigured);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Public review form state
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoveredRating, setHoveredRating] = useState<number>(0);
  const [displayName, setDisplayName] = useState('');
  const [postAnonymously, setPostAnonymously] = useState(false);
  const [reviewText, setReviewText] = useState('');
  const [reviewHoneypot, setReviewHoneypot] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const reviewFormOpenedAt = useRef<number>(Date.now());

  // Private feedback form state
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory>('Bug Report');
  const [feedbackName, setFeedbackName] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackHoneypot, setFeedbackHoneypot] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const feedbackFormOpenedAt = useRef<number>(Date.now());

  const loadInitialReviews = useCallback(async (filter: number | null) => {
    if (!isFirebaseConfigured) {
      setListLoading(false);
      setReviews([]);
      setTotalMatching(0);
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const page = await fetchApprovedReviewsPage({
        offset: 0,
        limit: REVIEWS_PAGE_SIZE,
        starFilter: filter,
      });
      setReviews(page.reviews);
      setTotalMatching(page.totalMatching);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Unable to load reviews.');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitialReviews(starFilter);
  }, [loadInitialReviews, starFilter]);

  const handleLoadMore = async () => {
    if (loadingMore || reviews.length >= totalMatching) return;
    setLoadingMore(true);
    setListError(null);
    try {
      const nextPage = await fetchApprovedReviewsPage({
        offset: reviews.length,
        limit: REVIEWS_PAGE_SIZE,
        starFilter,
      });
      setReviews((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const uniqueNext = nextPage.reviews.filter((item) => !existingIds.has(item.id));
        return [...prev, ...uniqueNext];
      });
      setTotalMatching(nextPage.totalMatching);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Unable to load more reviews.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleReviewSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setReviewError(null);
    setReviewSuccess(null);

    if (!isFirebaseConfigured) {
      setReviewError(
        `Firebase Web SDK is not configured yet for "${FIREBASE_PROJECT_ID}". Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_APP_ID to enable ratings.`
      );
      return;
    }

    if (selectedRating < 1 || selectedRating > 5) {
      setReviewError('Please tap a star from 1 to 5 to rate ReturnBond.');
      return;
    }

    const recentTs = getRecentLocalReviewTimestamp();
    if (recentTs && Date.now() - recentTs < 24 * 60 * 60 * 1000) {
      setReviewError(
        'You have already submitted a rating from this browser within the last 24 hours. Thank you!'
      );
      return;
    }

    const elapsedMs = Math.max(900, Date.now() - reviewFormOpenedAt.current);
    setReviewSubmitting(true);
    try {
      const submitted = await submitPublicReview({
        rating: selectedRating,
        displayName: postAnonymously ? '' : displayName,
        reviewText,
        honeypot: reviewHoneypot,
        elapsedMs,
      });

      setSelectedRating(0);
      setHoveredRating(0);
      setDisplayName('');
      setPostAnonymously(false);
      setReviewText('');
      reviewFormOpenedAt.current = Date.now();

      if (submitted.status === 'pending') {
        setReviewSuccess(
          'Thank you! Your review has been submitted and is awaiting administrator approval before appearing publicly.'
        );
      } else {
        setReviewSuccess('Thank you! Your rating has been published.');
        await Promise.all([onSummaryRefresh(), loadInitialReviews(starFilter)]);
      }
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Unable to submit review.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleFeedbackSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedbackError(null);
    setFeedbackSuccess(null);

    if (!isFirebaseConfigured) {
      setFeedbackError(
        `Firebase Web SDK is not configured yet for "${FIREBASE_PROJECT_ID}". Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_APP_ID to enable feedback.`
      );
      return;
    }

    if (feedbackMessage.trim().length < 10) {
      setFeedbackError('Please enter at least 10 characters describing your feedback.');
      return;
    }

    const recentFeedbackTs = getRecentLocalFeedbackTimestamp();
    if (recentFeedbackTs && Date.now() - recentFeedbackTs < 2 * 60 * 1000) {
      setFeedbackError(
        'Please wait a couple of minutes before sending another feedback message.'
      );
      return;
    }

    const elapsedMs = Math.max(900, Date.now() - feedbackFormOpenedAt.current);
    setFeedbackSubmitting(true);
    try {
      await submitPrivateFeedback({
        category: feedbackCategory,
        senderName: feedbackName,
        message: feedbackMessage,
        honeypot: feedbackHoneypot,
        elapsedMs,
      });

      setFeedbackName('');
      setFeedbackMessage('');
      setFeedbackCategory('Bug Report');
      feedbackFormOpenedAt.current = Date.now();
      setFeedbackSuccess(
        'Thank you! Your private feedback has been sent directly to the developer and will never appear publicly.'
      );
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : 'Unable to send feedback.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const activeStarPreview = hoveredRating || selectedRating;
  const effectiveSummary = summary ?? EMPTY_RATING_SUMMARY;
  const hasApprovedRatings = effectiveSummary.totalReviews > 0;

  return (
    <section id="ratings-reviews" className="reviews-section section-pad">
      <div className="section-heading reviews-heading">
        <div>
          <div className="eyebrow">Community ratings &amp; feedback</div>
          <h2>
            Ratings and <span>reviews.</span>
          </h2>
        </div>
        <div className="reviews-header-actions">
          <p>
            Share an honest public rating for ReturnBond or send private product feedback directly
            to the developer — no account or login required.
          </p>
          <div className="reviews-mode-pills" role="tablist" aria-label="Submission mode">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'review'}
              className={`mode-pill ${activeTab === 'review' ? 'is-active' : ''}`}
              data-testid="tab_write_review"
              onClick={() => setActiveTab('review')}
            >
              <Star size={14} aria-hidden="true" /> Rate &amp; Review
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'feedback'}
              className={`mode-pill ${activeTab === 'feedback' ? 'is-active' : ''}`}
              data-testid="open_private_feedback_button"
              onClick={() => setActiveTab('feedback')}
            >
              <MessageSquare size={14} aria-hidden="true" /> Send Feedback
            </button>
          </div>
        </div>
      </div>

      {!isFirebaseConfigured && (
        <div className="rb-config-banner" role="status">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>Firebase Web SDK configuration required ({FIREBASE_PROJECT_ID})</strong>
            <p>
              To activate live ratings, public reviews, and private feedback on{' '}
              <code>{FIREBASE_PROJECT_ID}</code>, set <code>VITE_FIREBASE_API_KEY</code> and{' '}
              <code>VITE_FIREBASE_APP_ID</code> in your environment variables and merge{' '}
              <code>firestore.website.rules</code> into your Cloud Firestore Rules (keeping your
              existing <code>users</code> and <code>requests</code> rules intact).
            </p>
          </div>
        </div>
      )}

      {isFirebaseConfigured && summaryError && (
        <div className="rb-config-banner rb-banner-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>Could not load live rating statistics</strong>
            <p>{summaryError}</p>
          </div>
        </div>
      )}

      <div className="reviews-top-grid">
        {/* Google Play Store-inspired Rating Overview Card */}
        <div className="play-rating-card" data-testid="rating_overview_card">
          <div className="play-score-col">
            <div className="play-big-score">
              {summaryLoading
                ? '—'
                : hasApprovedRatings
                  ? effectiveSummary.averageRating.toFixed(1)
                  : '0.0'}
            </div>
            <StarRow
              value={hasApprovedRatings ? effectiveSummary.averageRating : 0}
              size={18}
              className="play-score-stars"
            />
            <div className="play-total-count">
              {summaryLoading
                ? 'Loading ratings…'
                : hasApprovedRatings
                  ? `${effectiveSummary.totalReviews.toLocaleString()} ${
                      effectiveSummary.totalReviews === 1 ? 'rating' : 'ratings'
                    }`
                  : 'No ratings yet'}
            </div>
          </div>

          <div className="play-bars-col" aria-label="Star rating distribution">
            {([5, 4, 3, 2, 1] as const).map((star) => {
              const count = effectiveSummary.distribution[star] ?? 0;
              const pct =
                effectiveSummary.totalReviews > 0
                  ? Math.round((count / effectiveSummary.totalReviews) * 100)
                  : 0;
              const isSelectedFilter = starFilter === star;
              return (
                <button
                  key={star}
                  type="button"
                  className={`play-bar-row ${isSelectedFilter ? 'is-selected' : ''}`}
                  onClick={() => setStarFilter((prev) => (prev === star ? null : star))}
                  title={`Filter by ${star}-star reviews (${count})`}
                  aria-label={`${star} stars: ${count} ratings (${pct}%). Click to filter.`}
                >
                  <span className="play-bar-label">{star}</span>
                  <Star size={12} className="rb-star-filled" aria-hidden="true" />
                  <span className="play-bar-track">
                    <span className="play-bar-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="play-bar-count">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Submission Composer Card: Public Review OR Private Feedback */}
        <div className="reviews-composer-card">
          {activeTab === 'review' ? (
            <form onSubmit={handleReviewSubmit} noValidate data-testid="public_review_form">
              <div className="composer-header">
                <div>
                  <h3>Rate ReturnBond</h3>
                  <p>Your rating helps others keep everyday lending clear.</p>
                </div>
                <span className="composer-badge">
                  <ShieldCheck size={14} aria-hidden="true" /> Public
                </span>
              </div>

              <div className="star-selector-block">
                <span className="field-label" id={`${formIdPrefix}-rating-label`}>
                  Your rating <span className="req-mark">*</span>
                </span>
                <div
                  className="interactive-stars"
                  role="radiogroup"
                  aria-labelledby={`${formIdPrefix}-rating-label`}
                  onMouseLeave={() => setHoveredRating(0)}
                >
                  {[1, 2, 3, 4, 5].map((star) => {
                    const active = star <= activeStarPreview;
                    return (
                      <button
                        key={star}
                        type="button"
                        role="radio"
                        aria-checked={selectedRating === star}
                        aria-label={`Rate ${star} out of 5 stars`}
                        data-testid={`star_selector_${star}`}
                        className={`star-pick-btn ${active ? 'is-lit' : ''}`}
                        onMouseEnter={() => setHoveredRating(star)}
                        onClick={() => {
                          setSelectedRating(star);
                          setReviewError(null);
                        }}
                      >
                        <Star size={28} />
                      </button>
                    );
                  })}
                  <span className="star-pick-caption">
                    {activeStarPreview ? RATING_LABELS[activeStarPreview] : 'Tap a star to rate'}
                  </span>
                </div>
              </div>

              <div className="composer-row">
                <div className="composer-field">
                  <div className="field-label-row">
                    <label className="field-label" htmlFor={`${formIdPrefix}-display-name`}>
                      Display name <span className="opt-mark">(optional)</span>
                    </label>
                    <label className="anon-toggle">
                      <input
                        type="checkbox"
                        checked={postAnonymously}
                        onChange={(e) => setPostAnonymously(e.target.checked)}
                      />
                      <span>Post as Anonymous</span>
                    </label>
                  </div>
                  <input
                    id={`${formIdPrefix}-display-name`}
                    type="text"
                    maxLength={60}
                    disabled={postAnonymously || reviewSubmitting}
                    value={postAnonymously ? '' : displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={
                      postAnonymously
                        ? 'Posting publicly as Anonymous'
                        : 'Your name (or leave blank for Anonymous)'
                    }
                    className="rb-input"
                    data-testid="review_name_input"
                  />
                </div>
              </div>

              <div className="composer-field">
                <div className="field-label-row">
                  <label className="field-label" htmlFor={`${formIdPrefix}-review-text`}>
                    Written review <span className="opt-mark">(optional)</span>
                  </label>
                  <span className="char-count">{reviewText.length}/1500</span>
                </div>
                <textarea
                  id={`${formIdPrefix}-review-text`}
                  rows={3}
                  maxLength={1500}
                  disabled={reviewSubmitting}
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  placeholder="What do you find most helpful about ReturnBond? (Optional)"
                  className="rb-textarea"
                  data-testid="review_text_input"
                />
              </div>

              {/* Offscreen honeypot field for bot filtering */}
              <div className="rb-hp-field" aria-hidden="true">
                <label htmlFor={`${formIdPrefix}-review-hp`}>Website</label>
                <input
                  id={`${formIdPrefix}-review-hp`}
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={reviewHoneypot}
                  onChange={(e) => setReviewHoneypot(e.target.value)}
                />
              </div>

              {reviewError && (
                <div className="rb-form-alert rb-alert-error" role="alert">
                  <AlertCircle size={16} aria-hidden="true" />
                  <span>{reviewError}</span>
                </div>
              )}

              {reviewSuccess && (
                <div className="rb-form-alert rb-alert-success" role="status">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{reviewSuccess}</span>
                </div>
              )}

              <div className="composer-actions">
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={reviewSubmitting}
                  data-testid="submit_review_button"
                >
                  {reviewSubmitting ? (
                    <>
                      <Loader2 size={16} className="rb-spin" aria-hidden="true" /> Submitting…
                    </>
                  ) : (
                    <>
                      Submit rating <Check size={16} aria-hidden="true" />
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="button button-quiet rb-switch-link"
                  onClick={() => setActiveTab('feedback')}
                >
                  Have a bug report or idea? Send private feedback
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleFeedbackSubmit} noValidate data-testid="private_feedback_form">
              <div className="composer-header">
                <div>
                  <h3>Send Private Feedback</h3>
                  <p>
                    Report bugs, request features, or share suggestions directly with the
                    developer.
                  </p>
                </div>
                <span className="composer-badge composer-badge-private">
                  <Lock size={13} aria-hidden="true" /> Private
                </span>
              </div>

              <div className="composer-row composer-two-col">
                <div className="composer-field">
                  <label className="field-label" htmlFor={`${formIdPrefix}-fb-category`}>
                    Category <span className="req-mark">*</span>
                  </label>
                  <select
                    id={`${formIdPrefix}-fb-category`}
                    value={feedbackCategory}
                    disabled={feedbackSubmitting}
                    onChange={(e) => setFeedbackCategory(e.target.value as FeedbackCategory)}
                    className="rb-select"
                    data-testid="feedback_category_select"
                  >
                    {FEEDBACK_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="composer-field">
                  <label className="field-label" htmlFor={`${formIdPrefix}-fb-name`}>
                    Your name <span className="opt-mark">(optional)</span>
                  </label>
                  <input
                    id={`${formIdPrefix}-fb-name`}
                    type="text"
                    maxLength={60}
                    disabled={feedbackSubmitting}
                    value={feedbackName}
                    onChange={(e) => setFeedbackName(e.target.value)}
                    placeholder="Optional"
                    className="rb-input"
                    data-testid="feedback_name_input"
                  />
                </div>
              </div>

              <div className="composer-field">
                <div className="field-label-row">
                  <label className="field-label" htmlFor={`${formIdPrefix}-fb-message`}>
                    Message <span className="req-mark">*</span>
                  </label>
                  <span className="char-count">{feedbackMessage.length}/3000</span>
                </div>
                <textarea
                  id={`${formIdPrefix}-fb-message`}
                  rows={4}
                  required
                  maxLength={3000}
                  disabled={feedbackSubmitting}
                  value={feedbackMessage}
                  onChange={(e) => setFeedbackMessage(e.target.value)}
                  placeholder="Describe the issue, feature idea, or suggestion in detail..."
                  className="rb-textarea"
                  data-testid="feedback_message_input"
                />
              </div>

              <div className="rb-hp-field" aria-hidden="true">
                <label htmlFor={`${formIdPrefix}-fb-hp`}>Company</label>
                <input
                  id={`${formIdPrefix}-fb-hp`}
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={feedbackHoneypot}
                  onChange={(e) => setFeedbackHoneypot(e.target.value)}
                />
              </div>

              {feedbackError && (
                <div className="rb-form-alert rb-alert-error" role="alert">
                  <AlertCircle size={16} aria-hidden="true" />
                  <span>{feedbackError}</span>
                </div>
              )}

              {feedbackSuccess && (
                <div className="rb-form-alert rb-alert-success" role="status">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{feedbackSuccess}</span>
                </div>
              )}

              <div className="composer-actions">
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={feedbackSubmitting}
                  data-testid="submit_feedback_button"
                >
                  {feedbackSubmitting ? (
                    <>
                      <Loader2 size={16} className="rb-spin" aria-hidden="true" /> Sending…
                    </>
                  ) : (
                    <>
                      Send private feedback <MessageSquare size={16} aria-hidden="true" />
                    </>
                  )}
                </button>
                <span className="private-privacy-note">
                  <Lock size={13} aria-hidden="true" /> Never displayed in public reviews.
                </span>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Approved Public Reviews Feed */}
      <div className="reviews-feed-wrap">
        <div className="reviews-feed-toolbar">
          <h3>Recent community reviews</h3>
          <div className="star-filter-chips" role="group" aria-label="Filter reviews by star rating">
            <button
              type="button"
              className={`filter-chip ${starFilter === null ? 'is-active' : ''}`}
              onClick={() => setStarFilter(null)}
            >
              All
            </button>
            {([5, 4, 3, 2, 1] as const).map((star) => (
              <button
                key={star}
                type="button"
                className={`filter-chip ${starFilter === star ? 'is-active' : ''}`}
                onClick={() => setStarFilter((prev) => (prev === star ? null : star))}
              >
                {star} ★
              </button>
            ))}
          </div>
        </div>

        {listError && (
          <div className="rb-form-alert rb-alert-error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{listError}</span>
          </div>
        )}

        {listLoading ? (
          <div className="reviews-empty-state">
            <Loader2 size={22} className="rb-spin" aria-hidden="true" />
            <p>Loading approved reviews…</p>
          </div>
        ) : reviews.length === 0 ? (
          <div className="reviews-empty-state" data-testid="reviews_empty_state">
            <Star size={24} className="rb-star-empty" aria-hidden="true" />
            <p>
              {starFilter
                ? `No approved ${starFilter}-star reviews yet.`
                : 'No public reviews yet. Be the first to rate ReturnBond above.'}
            </p>
          </div>
        ) : (
          <>
            <div className="reviews-grid" data-testid="approved_reviews_list">
              {reviews.map((review) => {
                const author = review.display_name?.trim() || 'Anonymous';
                const initial = author.charAt(0).toUpperCase();
                const dateLabel = formatReviewDate(review.created_at);
                const hasText = Boolean(review.review_text && review.review_text.trim());

                return (
                  <article key={review.id} className="public-review-card">
                    <div className="review-card-top">
                      <div className="review-author">
                        <div className="review-avatar" aria-hidden="true">
                          {author === 'Anonymous' ? <UserRound size={16} /> : initial}
                        </div>
                        <div>
                          <strong>{author}</strong>
                          <div className="review-meta-line">
                            <StarRow value={review.rating} size={13} />
                            {dateLabel && <span>{dateLabel}</span>}
                          </div>
                        </div>
                      </div>
                      {review.app_version && (
                        <span className="review-version-tag">v{review.app_version}</span>
                      )}
                    </div>

                    {hasText ? (
                      <p className="review-body-text">{review.review_text}</p>
                    ) : (
                      <p className="review-body-muted">
                        Rated {review.rating} out of 5 stars
                      </p>
                    )}
                  </article>
                );
              })}
            </div>

            {reviews.length < totalMatching && (
              <div className="reviews-load-more">
                <button
                  type="button"
                  className="button button-quiet rb-load-more-btn"
                  disabled={loadingMore}
                  onClick={() => void handleLoadMore()}
                  data-testid="load_more_reviews_button"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 size={16} className="rb-spin" aria-hidden="true" /> Loading more…
                    </>
                  ) : (
                    <>
                      Load more reviews ({reviews.length} of {totalMatching})
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
