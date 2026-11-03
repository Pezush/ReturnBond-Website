import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react';
import {
  EMPTY_RATING_SUMMARY,
  FEEDBACK_CATEGORIES,
  adminDeleteFeedback,
  adminDeleteReview,
  adminFetchAllReviews,
  adminFetchPrivateFeedback,
  adminGetModerationSettings,
  adminSetFeedbackResolved,
  adminUpdateModerationSettings,
  adminUpdateReviewStatus,
  checkUserAdminAccess,
  fetchPublicRatingSummary,
  formatReviewDate,
  type FeedbackCategory,
  type PrivateFeedbackItem,
  type PublicReview,
  type RatingSummary,
  type ReviewStatus,
} from '../lib/reviewsApi';
import {
  FIREBASE_PROJECT_ID,
  firebaseAuth,
  googleAuthProvider,
  isFirebaseConfigured,
} from '../lib/firebase';

export function AdminReviewsPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(isFirebaseConfigured);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Admin sign-in state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Dashboard state
  const [activeArea, setActiveArea] = useState<'reviews' | 'feedback'>('reviews');
  const [summary, setSummary] = useState<RatingSummary>(EMPTY_RATING_SUMMARY);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [feedbackItems, setFeedbackItems] = useState<PrivateFeedbackItem[]>([]);
  const [requireManualApproval, setRequireManualApproval] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Filters
  const [reviewStatusFilter, setReviewStatusFilter] = useState<'all' | ReviewStatus>('all');
  const [reviewStarFilter, setReviewStarFilter] = useState<'all' | number>('all');
  const [reviewQuery, setReviewQuery] = useState('');

  const [feedbackCategoryFilter, setFeedbackCategoryFilter] = useState<'all' | FeedbackCategory>(
    'all'
  );
  const [feedbackStateFilter, setFeedbackStateFilter] = useState<'all' | 'open' | 'resolved'>(
    'all'
  );
  const [feedbackQuery, setFeedbackQuery] = useState('');

  // Prevent search engines from indexing /admin
  useEffect(() => {
    document.title = 'Admin Moderation | ReturnBond';
    let robots = document.head.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    const previousContent = robots?.content ?? null;
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }
    robots.content = 'noindex, nofollow';
    return () => {
      if (previousContent !== null && robots) {
        robots.content = previousContent;
      } else {
        robots?.remove();
      }
    };
  }, []);

  const loadAdminDashboardData = useCallback(async () => {
    setDataLoading(true);
    setActionError(null);
    try {
      const [summaryRes, reviewsRes, feedbackRes, settingsRes] = await Promise.all([
        fetchPublicRatingSummary(),
        adminFetchAllReviews(),
        adminFetchPrivateFeedback(),
        adminGetModerationSettings(),
      ]);
      setSummary(summaryRes);
      setReviews(reviewsRes);
      setFeedbackItems(feedbackRes);
      setRequireManualApproval(settingsRes.requireManualApproval);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to load admin data.');
    } finally {
      setDataLoading(false);
    }
  }, []);

  const verifyAdminUser = useCallback(
    async (user: User | null) => {
      setCurrentUser(user);
      if (!user) {
        setIsAdmin(false);
        setAuthChecking(false);
        return;
      }
      setAuthChecking(true);
      try {
        const allowed = await checkUserAdminAccess(user.uid);
        setIsAdmin(allowed);
        if (allowed) {
          await loadAdminDashboardData();
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Failed to verify admin permissions.');
        setIsAdmin(false);
      } finally {
        setAuthChecking(false);
      }
    },
    [loadAdminDashboardData]
  );

  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseAuth) {
      setAuthChecking(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      void verifyAdminUser(user);
    });

    return () => unsubscribe();
  }, [verifyAdminUser]);

  const handleGoogleSignIn = async () => {
    if (!firebaseAuth) return;
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithPopup(firebaseAuth, googleAuthProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleEmailSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firebaseAuth) return;
    setAuthError(null);
    setSigningIn(true);
    try {
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (!firebaseAuth) return;
    await signOut(firebaseAuth);
    setReviews([]);
    setFeedbackItems([]);
    setIsAdmin(false);
  };

  const handleStatusChange = async (id: string, status: ReviewStatus) => {
    setBusyId(id);
    setActionError(null);
    try {
      await adminUpdateReviewStatus(id, status);
      const updatedSummary = await fetchPublicRatingSummary();
      setSummary(updatedSummary);
      setReviews((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteReview = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await adminDeleteReview(id);
      setConfirmDeleteId(null);
      setReviews((prev) => prev.filter((item) => item.id !== id));
      const updatedSummary = await fetchPublicRatingSummary();
      setSummary(updatedSummary);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete review.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleResolved = async (item: PrivateFeedbackItem) => {
    setBusyId(item.id);
    setActionError(null);
    try {
      const next = !item.is_resolved;
      await adminSetFeedbackResolved(item.id, next);
      setFeedbackItems((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, is_resolved: next } : row))
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update feedback status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteFeedback = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await adminDeleteFeedback(id);
      setConfirmDeleteId(null);
      setFeedbackItems((prev) => prev.filter((row) => row.id !== id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete feedback.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleApprovalSetting = async (checked: boolean) => {
    setActionError(null);
    const previous = requireManualApproval;
    setRequireManualApproval(checked);
    try {
      await adminUpdateModerationSettings(checked);
    } catch (err) {
      setRequireManualApproval(previous);
      setActionError(
        err instanceof Error ? err.message : 'Could not update moderation configuration.'
      );
    }
  };

  const reviewCounts = useMemo(() => {
    return {
      pending: reviews.filter((r) => r.status === 'pending').length,
      approved: reviews.filter((r) => r.status === 'approved').length,
      hidden: reviews.filter((r) => r.status === 'hidden').length,
    };
  }, [reviews]);

  const openFeedbackCount = useMemo(
    () => feedbackItems.filter((item) => !item.is_resolved).length,
    [feedbackItems]
  );

  const filteredReviews = useMemo(() => {
    const q = reviewQuery.trim().toLowerCase();
    return reviews.filter((item) => {
      if (reviewStatusFilter !== 'all' && item.status !== reviewStatusFilter) return false;
      if (reviewStarFilter !== 'all' && item.rating !== reviewStarFilter) return false;
      if (q) {
        const hay = `${item.display_name ?? 'anonymous'} ${item.review_text ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reviews, reviewStatusFilter, reviewStarFilter, reviewQuery]);

  const filteredFeedback = useMemo(() => {
    const q = feedbackQuery.trim().toLowerCase();
    return feedbackItems.filter((item) => {
      if (feedbackCategoryFilter !== 'all' && item.category !== feedbackCategoryFilter) {
        return false;
      }
      if (feedbackStateFilter === 'open' && item.is_resolved) return false;
      if (feedbackStateFilter === 'resolved' && !item.is_resolved) return false;
      if (q) {
        const hay = `${item.sender_name ?? 'anonymous'} ${item.category} ${item.message}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [feedbackItems, feedbackCategoryFilter, feedbackStateFilter, feedbackQuery]);

  return (
    <main>
      <section className="page-hero section-pad">
        <div className="eyebrow">Administrator console</div>
        <h1>Reviews &amp; feedback management.</h1>
        <p>
          Moderate public ratings and reviews, and review private user feedback securely through
          Firebase Authentication and Cloud Firestore Security Rules.
        </p>
      </section>

      <section className="section-pad admin-shell">
        {!isFirebaseConfigured ? (
          <div className="admin-auth-card">
            <div className="rb-config-banner" role="alert">
              <AlertCircle size={20} aria-hidden="true" />
              <div>
                <strong>Missing Firebase Web SDK environment variables</strong>
                <p>
                  Configure <code>VITE_FIREBASE_API_KEY</code> and <code>VITE_FIREBASE_APP_ID</code>{' '}
                  for Firebase project <code>{FIREBASE_PROJECT_ID}</code>, and merge{' '}
                  <code>firestore.website.rules</code> into your Cloud Firestore Rules without
                  removing your existing <code>users</code> or <code>requests</code> rules.
                </p>
              </div>
            </div>
          </div>
        ) : authChecking ? (
          <div className="reviews-empty-state">
            <Loader2 size={24} className="rb-spin" aria-hidden="true" />
            <p>Verifying Firebase administrator session…</p>
          </div>
        ) : !currentUser ? (
          <div className="admin-auth-card" data-testid="admin_login_card">
            <div className="composer-header">
              <div>
                <h2>Administrator sign-in</h2>
                <p>Sign in with your authorized Firebase account ({FIREBASE_PROJECT_ID}).</p>
              </div>
              <span className="composer-badge composer-badge-private">
                <Lock size={14} aria-hidden="true" /> Restricted
              </span>
            </div>

            <button
              type="button"
              className="button button-dark admin-google-btn"
              disabled={signingIn}
              onClick={() => void handleGoogleSignIn()}
              data-testid="admin_google_signin_button"
            >
              <ShieldCheck size={16} aria-hidden="true" /> Continue with Google
            </button>

            <div className="admin-auth-divider">
              <span>or sign in with email</span>
            </div>

            <form onSubmit={handleEmailSignIn} className="admin-login-form">
              <div className="composer-field">
                <label className="field-label" htmlFor="admin-email">
                  Admin email
                </label>
                <input
                  id="admin-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rb-input"
                  data-testid="admin_email_input"
                />
              </div>

              <div className="composer-field">
                <label className="field-label" htmlFor="admin-password">
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rb-input"
                  data-testid="admin_password_input"
                />
              </div>

              {authError && (
                <div className="rb-form-alert rb-alert-error" role="alert">
                  <AlertCircle size={16} aria-hidden="true" />
                  <span>{authError}</span>
                </div>
              )}

              <button
                type="submit"
                className="button button-primary"
                disabled={signingIn}
                data-testid="admin_signin_button"
              >
                {signingIn ? (
                  <>
                    <Loader2 size={16} className="rb-spin" aria-hidden="true" /> Signing in…
                  </>
                ) : (
                  <>
                    Sign in with Email <ShieldCheck size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          </div>
        ) : !isAdmin ? (
          <div className="admin-auth-card">
            <div className="rb-form-alert rb-alert-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <strong>Account is not authorized in website_admins</strong>
                <p>
                  Signed in as <code>{currentUser.email ?? currentUser.uid}</code>, which is not yet
                  listed in the <code>website_admins</code> collection of{' '}
                  <code>{FIREBASE_PROJECT_ID}</code>. In Firebase Console → Firestore Database,
                  create a document in collection <code>website_admins</code> with this exact
                  Document ID:
                </p>
              </div>
            </div>
            <pre className="admin-sql-snippet">
              {`Collection: website_admins\nDocument ID: ${currentUser.uid}\nFields: {\n  "email": "${currentUser.email ?? ''}",\n  "role": "admin"\n}`}
            </pre>
            <div className="composer-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => void verifyAdminUser(currentUser)}
              >
                <RefreshCw size={15} aria-hidden="true" /> Re-check access
              </button>
              <button type="button" className="button button-quiet" onClick={handleSignOut}>
                <LogOut size={15} aria-hidden="true" /> Sign out
              </button>
            </div>
          </div>
        ) : (
          <div className="admin-dashboard" data-testid="admin_dashboard">
            {/* Top Bar */}
            <div className="admin-topbar">
              <div className="admin-stats-grid">
                <div className="admin-stat-box">
                  <span>Live Avg Rating</span>
                  <strong>
                    {summary.totalReviews > 0 ? `${summary.averageRating.toFixed(2)} ★` : '—'}
                  </strong>
                </div>
                <div className="admin-stat-box">
                  <span>Approved</span>
                  <strong>{reviewCounts.approved}</strong>
                </div>
                <div className="admin-stat-box">
                  <span>Pending Review</span>
                  <strong>{reviewCounts.pending}</strong>
                </div>
                <div className="admin-stat-box">
                  <span>Hidden</span>
                  <strong>{reviewCounts.hidden}</strong>
                </div>
                <div className="admin-stat-box">
                  <span>Open Feedback</span>
                  <strong>{openFeedbackCount}</strong>
                </div>
              </div>

              <div className="admin-session-bar">
                <label className="anon-toggle admin-approval-toggle">
                  <input
                    type="checkbox"
                    checked={requireManualApproval}
                    onChange={(e) => void handleToggleApprovalSetting(e.target.checked)}
                  />
                  <span>Hold all new public reviews as Pending until approved</span>
                </label>
                <div className="admin-session-buttons">
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={dataLoading}
                    onClick={() => void loadAdminDashboardData()}
                  >
                    <RefreshCw
                      size={15}
                      className={dataLoading ? 'rb-spin' : ''}
                      aria-hidden="true"
                    />{' '}
                    Refresh
                  </button>
                  <button type="button" className="button button-quiet" onClick={handleSignOut}>
                    <LogOut size={15} aria-hidden="true" /> Sign out (
                    {currentUser.email ?? currentUser.uid})
                  </button>
                </div>
              </div>
            </div>

            {actionError && (
              <div className="rb-form-alert rb-alert-error" role="alert">
                <AlertCircle size={16} aria-hidden="true" />
                <span>{actionError}</span>
              </div>
            )}

            {/* Area Switcher */}
            <div className="reviews-mode-pills admin-area-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeArea === 'reviews'}
                className={`mode-pill ${activeArea === 'reviews' ? 'is-active' : ''}`}
                data-testid="admin_tab_reviews"
                onClick={() => setActiveArea('reviews')}
              >
                <Star size={14} aria-hidden="true" /> Public Ratings &amp; Reviews (
                {reviews.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeArea === 'feedback'}
                className={`mode-pill ${activeArea === 'feedback' ? 'is-active' : ''}`}
                data-testid="admin_tab_feedback"
                onClick={() => setActiveArea('feedback')}
              >
                <MessageSquare size={14} aria-hidden="true" /> Private Feedback (
                {feedbackItems.length})
              </button>
            </div>

            {activeArea === 'reviews' ? (
              <div className="admin-panel-section" data-testid="admin_reviews_area">
                <div className="admin-filters-bar">
                  <label className="search-box admin-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      value={reviewQuery}
                      onChange={(e) => setReviewQuery(e.target.value)}
                      placeholder="Search reviews by author or text"
                      aria-label="Search reviews"
                    />
                  </label>

                  <select
                    className="rb-select admin-filter-select"
                    value={reviewStatusFilter}
                    onChange={(e) =>
                      setReviewStatusFilter(e.target.value as 'all' | ReviewStatus)
                    }
                    aria-label="Filter by review status"
                  >
                    <option value="all">All statuses</option>
                    <option value="pending">Pending ({reviewCounts.pending})</option>
                    <option value="approved">Approved ({reviewCounts.approved})</option>
                    <option value="hidden">Hidden ({reviewCounts.hidden})</option>
                  </select>

                  <select
                    className="rb-select admin-filter-select"
                    value={String(reviewStarFilter)}
                    onChange={(e) =>
                      setReviewStarFilter(
                        e.target.value === 'all' ? 'all' : Number(e.target.value)
                      )
                    }
                    aria-label="Filter by star rating"
                  >
                    <option value="all">All ratings</option>
                    {[5, 4, 3, 2, 1].map((s) => (
                      <option key={s} value={s}>
                        {s} stars
                      </option>
                    ))}
                  </select>
                </div>

                {filteredReviews.length === 0 ? (
                  <div className="reviews-empty-state">
                    <p>No reviews match the current filter.</p>
                  </div>
                ) : (
                  <div className="admin-items-list">
                    {filteredReviews.map((item) => {
                      const isBusy = busyId === item.id;
                      const author = item.display_name?.trim() || 'Anonymous';
                      return (
                        <article key={item.id} className="admin-item-card">
                          <div className="admin-item-head">
                            <div>
                              <strong>{author}</strong>
                              <span className="admin-stars-inline">
                                {'★'.repeat(item.rating)}
                                {'☆'.repeat(5 - item.rating)} ({item.rating}/5)
                              </span>
                              <span className="admin-date-inline">
                                {formatReviewDate(item.created_at)}
                              </span>
                              {item.app_version && (
                                <span className="review-version-tag">v{item.app_version}</span>
                              )}
                            </div>
                            <span className={`status-pill status-${item.status}`}>
                              {item.status}
                            </span>
                          </div>

                          <p className="admin-item-body">
                            {item.review_text?.trim() || (
                              <em>Star-only rating (no written comment)</em>
                            )}
                          </p>

                          <div className="admin-item-actions">
                            {item.status !== 'approved' && (
                              <button
                                type="button"
                                className="admin-btn admin-btn-approve"
                                disabled={isBusy}
                                onClick={() => void handleStatusChange(item.id, 'approved')}
                              >
                                <Eye size={14} aria-hidden="true" /> Approve
                              </button>
                            )}
                            {item.status !== 'hidden' && (
                              <button
                                type="button"
                                className="admin-btn"
                                disabled={isBusy}
                                onClick={() => void handleStatusChange(item.id, 'hidden')}
                              >
                                <EyeOff size={14} aria-hidden="true" /> Hide
                              </button>
                            )}

                            {confirmDeleteId === item.id ? (
                              <div className="admin-confirm-delete">
                                <span>Delete permanently?</span>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn-danger"
                                  disabled={isBusy}
                                  onClick={() => void handleDeleteReview(item.id)}
                                >
                                  Confirm delete
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn"
                                  disabled={isBusy}
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="admin-btn admin-btn-danger"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteId(item.id)}
                              >
                                <Trash2 size={14} aria-hidden="true" /> Delete
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="admin-panel-section" data-testid="admin_feedback_area">
                <div className="admin-filters-bar">
                  <label className="search-box admin-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      value={feedbackQuery}
                      onChange={(e) => setFeedbackQuery(e.target.value)}
                      placeholder="Search private feedback"
                      aria-label="Search private feedback"
                    />
                  </label>

                  <select
                    className="rb-select admin-filter-select"
                    value={feedbackCategoryFilter}
                    onChange={(e) =>
                      setFeedbackCategoryFilter(e.target.value as 'all' | FeedbackCategory)
                    }
                    aria-label="Filter by feedback category"
                  >
                    <option value="all">All categories</option>
                    {FEEDBACK_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>

                  <select
                    className="rb-select admin-filter-select"
                    value={feedbackStateFilter}
                    onChange={(e) =>
                      setFeedbackStateFilter(e.target.value as 'all' | 'open' | 'resolved')
                    }
                    aria-label="Filter by resolution status"
                  >
                    <option value="all">All states</option>
                    <option value="open">Open ({openFeedbackCount})</option>
                    <option value="resolved">
                      Resolved ({feedbackItems.length - openFeedbackCount})
                    </option>
                  </select>
                </div>

                {filteredFeedback.length === 0 ? (
                  <div className="reviews-empty-state">
                    <p>No private feedback messages match the current filter.</p>
                  </div>
                ) : (
                  <div className="admin-items-list">
                    {filteredFeedback.map((item) => {
                      const isBusy = busyId === item.id;
                      return (
                        <article key={item.id} className="admin-item-card">
                          <div className="admin-item-head">
                            <div>
                              <span className="feedback-cat-badge">{item.category}</span>
                              <strong>{item.sender_name?.trim() || 'Anonymous'}</strong>
                              <span className="admin-date-inline">
                                {formatReviewDate(item.created_at)}
                              </span>
                              {item.app_version && (
                                <span className="review-version-tag">v{item.app_version}</span>
                              )}
                            </div>
                            <span
                              className={`status-pill ${
                                item.is_resolved ? 'status-approved' : 'status-pending'
                              }`}
                            >
                              {item.is_resolved ? 'Resolved' : 'Open'}
                            </span>
                          </div>

                          <p className="admin-item-body">{item.message}</p>

                          <div className="admin-item-actions">
                            <button
                              type="button"
                              className="admin-btn admin-btn-approve"
                              disabled={isBusy}
                              onClick={() => void handleToggleResolved(item)}
                            >
                              {item.is_resolved ? (
                                <>Reopen</>
                              ) : (
                                <>
                                  <Check size={14} aria-hidden="true" /> Mark resolved
                                </>
                              )}
                            </button>

                            {confirmDeleteId === item.id ? (
                              <div className="admin-confirm-delete">
                                <span>Delete permanently?</span>
                                <button
                                  type="button"
                                  className="admin-btn admin-btn-danger"
                                  disabled={isBusy}
                                  onClick={() => void handleDeleteFeedback(item.id)}
                                >
                                  Confirm delete
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn"
                                  disabled={isBusy}
                                  onClick={() => setConfirmDeleteId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="admin-btn admin-btn-danger"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteId(item.id)}
                              >
                                <Trash2 size={14} aria-hidden="true" /> Delete
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
