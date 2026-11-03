import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { latestRelease } from '../releaseConfig';
import {
  FIREBASE_PROJECT_ID,
  firestoreDb,
  getOrCreateClientToken,
  isFirebaseConfigured,
  recordLocalFeedbackTimestamp,
  recordLocalReviewTimestamp,
  sha256Hex,
} from './firebase';

// Dedicated website-only Firestore collections (never touches Android `users` or `requests`)
const REVIEWS_COLLECTION = 'website_reviews';
const FEEDBACK_COLLECTION = 'website_feedback';
const RATE_LIMITS_COLLECTION = 'website_rate_limits';
const ADMINS_COLLECTION = 'website_admins';
const CONFIG_COLLECTION = 'website_config';
const MODERATION_DOC_ID = 'moderation';

export type ReviewStatus = 'pending' | 'approved' | 'hidden';

export type FeedbackCategory =
  | 'Bug Report'
  | 'Feature Request'
  | 'General Suggestion'
  | 'Other';

export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = [
  'Bug Report',
  'Feature Request',
  'General Suggestion',
  'Other',
] as const;

export interface StarDistribution {
  5: number;
  4: number;
  3: number;
  2: number;
  1: number;
}

export interface RatingSummary {
  averageRating: number;
  totalReviews: number;
  writtenReviewsCount: number;
  distribution: StarDistribution;
}

export interface PublicReview {
  id: string;
  rating: number;
  display_name: string | null;
  review_text: string | null;
  status: ReviewStatus;
  app_version: string | null;
  created_at: string;
}

export interface PrivateFeedbackItem {
  id: string;
  category: FeedbackCategory;
  sender_name: string | null;
  message: string;
  is_resolved: boolean;
  app_version: string | null;
  created_at: string;
}

export const EMPTY_RATING_SUMMARY: RatingSummary = {
  averageRating: 0,
  totalReviews: 0,
  writtenReviewsCount: 0,
  distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
};

function ensureFirestore(): Firestore {
  if (!isFirebaseConfigured || !firestoreDb) {
    throw new Error(
      `Firebase Web SDK is not configured yet for project "${FIREBASE_PROJECT_ID}". Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_APP_ID in your environment variables.`
    );
  }
  return firestoreDb;
}

function timestampToIso(value: unknown): string {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (
    value &&
    typeof value === 'object' &&
    'seconds' in value &&
    typeof (value as { seconds: unknown }).seconds === 'number'
  ) {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function timestampToMs(value: unknown): number {
  const iso = timestampToIso(value);
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapReviewDoc(id: string, data: DocumentData): PublicReview {
  return {
    id,
    rating: Number(data.rating ?? 0) || 0,
    display_name: typeof data.displayName === 'string' ? data.displayName : null,
    review_text: typeof data.reviewText === 'string' ? data.reviewText : null,
    status:
      data.status === 'pending' || data.status === 'hidden' || data.status === 'approved'
        ? data.status
        : 'approved',
    app_version: typeof data.appVersion === 'string' ? data.appVersion : null,
    created_at: timestampToIso(data.createdAt),
  };
}

function mapFeedbackDoc(id: string, data: DocumentData): PrivateFeedbackItem {
  const cat = data.category as FeedbackCategory;
  return {
    id,
    category: FEEDBACK_CATEGORIES.includes(cat) ? cat : 'Other',
    sender_name: typeof data.senderName === 'string' ? data.senderName : null,
    message: typeof data.message === 'string' ? data.message : '',
    is_resolved: Boolean(data.isResolved),
    app_version: typeof data.appVersion === 'string' ? data.appVersion : null,
    created_at: timestampToIso(data.createdAt),
  };
}

function normalizeFirestoreError(error: unknown, context: 'read' | 'review' | 'feedback' | 'admin'): string {
  if (error && typeof error === 'object') {
    const code = 'code' in error ? String((error as { code: unknown }).code) : '';
    const message = 'message' in error ? String((error as { message: unknown }).message) : '';

    if (code === 'permission-denied' || message.includes('Missing or insufficient permissions')) {
      if (context === 'review') {
        return 'Submission rejected by Firestore security rules: either you have already submitted a rating in the last 24 hours, or the website_reviews rules in firestore.website.rules still need to be added to returnbond-7c6ae.';
      }
      if (context === 'feedback') {
        return 'Feedback rejected by Firestore security rules: either you submitted feedback in the last 2 minutes, or the website_feedback rules in firestore.website.rules still need to be added to returnbond-7c6ae.';
      }
      if (context === 'admin') {
        return 'Permission denied. Ensure your Firebase Auth UID is added to website_admins/{uid} in Cloud Firestore.';
      }
      return 'Firestore read access for website_reviews is not enabled yet. Merge firestore.website.rules into your returnbond-7c6ae Firestore Rules.';
    }

    if (message.trim()) {
      return message.trim();
    }
  }
  return 'An unexpected error occurred while communicating with Cloud Firestore.';
}

export async function fetchPublicRatingSummary(): Promise<RatingSummary> {
  const db = ensureFirestore();
  const reviewsRef = collection(db, REVIEWS_COLLECTION);

  try {
    const stars = [5, 4, 3, 2, 1] as const;
    const snapshots = await Promise.all(
      stars.map((star) =>
        getCountFromServer(
          query(reviewsRef, where('status', '==', 'approved'), where('rating', '==', star))
        )
      )
    );

    const distribution: StarDistribution = {
      5: snapshots[0].data().count,
      4: snapshots[1].data().count,
      3: snapshots[2].data().count,
      2: snapshots[3].data().count,
      1: snapshots[4].data().count,
    };

    const totalReviews =
      distribution[5] + distribution[4] + distribution[3] + distribution[2] + distribution[1];

    const weightedSum =
      5 * distribution[5] +
      4 * distribution[4] +
      3 * distribution[3] +
      2 * distribution[2] +
      1 * distribution[1];

    const averageRating =
      totalReviews > 0 ? Math.round((weightedSum / totalReviews) * 100) / 100 : 0;

    return {
      averageRating,
      totalReviews,
      writtenReviewsCount: totalReviews,
      distribution,
    };
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'read'));
  }
}

export async function fetchApprovedReviewsPage(options: {
  offset: number;
  limit: number;
  starFilter?: number | null;
}): Promise<{ reviews: PublicReview[]; totalMatching: number }> {
  const db = ensureFirestore();
  const { offset, limit, starFilter } = options;
  const reviewsRef = collection(db, REVIEWS_COLLECTION);

  const hasValidStar = Boolean(starFilter && starFilter >= 1 && starFilter <= 5);

  try {
    const countQuery = hasValidStar
      ? query(reviewsRef, where('status', '==', 'approved'), where('rating', '==', starFilter))
      : query(reviewsRef, where('status', '==', 'approved'));

    const totalSnap = await getCountFromServer(countQuery);
    const totalMatching = totalSnap.data().count;

    if (totalMatching === 0) {
      return { reviews: [], totalMatching: 0 };
    }

    try {
      const indexedQuery = hasValidStar
        ? query(
            reviewsRef,
            where('status', '==', 'approved'),
            where('rating', '==', starFilter),
            orderBy('createdAt', 'desc'),
            firestoreLimit(offset + limit)
          )
        : query(
            reviewsRef,
            where('status', '==', 'approved'),
            orderBy('createdAt', 'desc'),
            firestoreLimit(offset + limit)
          );

      const snap = await getDocs(indexedQuery);
      const sliced = snap.docs
        .slice(offset, offset + limit)
        .map((docSnap) => mapReviewDoc(docSnap.id, docSnap.data()));

      return { reviews: sliced, totalMatching };
    } catch (indexErr) {
      const errCode =
        indexErr && typeof indexErr === 'object' && 'code' in indexErr
          ? String((indexErr as { code: unknown }).code)
          : '';
      if (errCode !== 'failed-precondition') {
        throw indexErr;
      }

      // Automatic zero-composite-index fallback (uses built-in single-field indexes)
      const fallbackSnap = await getDocs(query(countQuery, firestoreLimit(250)));
      const sorted = fallbackSnap.docs
        .map((docSnap) => ({
          ms: timestampToMs(docSnap.data().createdAt),
          item: mapReviewDoc(docSnap.id, docSnap.data()),
        }))
        .sort((a, b) => b.ms - a.ms)
        .map((entry) => entry.item);

      return {
        reviews: sorted.slice(offset, offset + limit),
        totalMatching: Math.min(totalMatching, sorted.length),
      };
    }
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'read'));
  }
}

function containsSuspiciousContent(text: string): boolean {
  return /(https?:\/\/|www\.|<script|<a\s)/i.test(text) || /(.)\1{11,}/.test(text);
}

function sanitizeSingleLine(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      out += input[i];
    }
  }
  return out.trim();
}

function sanitizeMultiLine(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if ((code >= 0x20 && code !== 0x7f) || code === 0x09 || code === 0x0a || code === 0x0d) {
      out += input[i];
    }
  }
  return out.trim();
}

async function isManualApprovalEnabled(db: Firestore): Promise<boolean> {
  try {
    const configSnap = await getDoc(doc(db, CONFIG_COLLECTION, MODERATION_DOC_ID));
    return configSnap.exists() && configSnap.data()?.requireManualApproval === true;
  } catch {
    return false;
  }
}

export async function submitPublicReview(input: {
  rating: number;
  displayName: string;
  reviewText: string;
  honeypot: string;
  elapsedMs: number;
}): Promise<{ id: string; status: ReviewStatus; createdAt: string }> {
  const db = ensureFirestore();

  if (input.honeypot.trim() !== '' || input.elapsedMs < 800) {
    throw new Error('Submission blocked by automated spam protection.');
  }

  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) {
    throw new Error('Please choose a rating from 1 to 5 stars.');
  }

  const trimmedName = sanitizeSingleLine(input.displayName);
  if (trimmedName.length > 60) {
    throw new Error('Display name must be 60 characters or fewer.');
  }

  const trimmedText = sanitizeMultiLine(input.reviewText);
  if (trimmedText.length > 1500) {
    throw new Error('Review text must be 1,500 characters or fewer.');
  }
  if (trimmedText.length > 0 && trimmedText.length < 2) {
    throw new Error('Written review is too short (or leave it empty for a star-only rating).');
  }

  const [manualApproval, tokenHash] = await Promise.all([
    isManualApprovalEnabled(db),
    sha256Hex(`rb-review-token-v1:${getOrCreateClientToken()}`),
  ]);

  const status: ReviewStatus =
    manualApproval || (trimmedText && containsSuspiciousContent(trimmedText))
      ? 'pending'
      : 'approved';

  const reviewRef = doc(collection(db, REVIEWS_COLLECTION));
  const rateLimitRef = doc(db, RATE_LIMITS_COLLECTION, `review_${tokenHash}`);

  try {
    const batch = writeBatch(db);
    batch.set(rateLimitRef, {
      kind: 'review',
      lastSubmittedAt: serverTimestamp(),
    });
    batch.set(reviewRef, {
      rating,
      displayName: trimmedName || null,
      reviewText: trimmedText || null,
      status,
      appVersion: latestRelease.versionName,
      tokenHash,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'review'));
  }

  recordLocalReviewTimestamp();
  return {
    id: reviewRef.id,
    status,
    createdAt: new Date().toISOString(),
  };
}

export async function submitPrivateFeedback(input: {
  category: FeedbackCategory;
  senderName: string;
  message: string;
  honeypot: string;
  elapsedMs: number;
}): Promise<{ id: string; createdAt: string }> {
  const db = ensureFirestore();

  if (input.honeypot.trim() !== '' || input.elapsedMs < 800) {
    throw new Error('Submission blocked by automated spam protection.');
  }

  if (!FEEDBACK_CATEGORIES.includes(input.category)) {
    throw new Error('Please select a valid feedback category.');
  }

  const trimmedName = sanitizeSingleLine(input.senderName);
  if (trimmedName.length > 60) {
    throw new Error('Name must be 60 characters or fewer.');
  }

  const trimmedMessage = sanitizeMultiLine(input.message);
  if (trimmedMessage.length < 10) {
    throw new Error('Please write at least 10 characters so we can understand your feedback.');
  }
  if (trimmedMessage.length > 3000) {
    throw new Error('Feedback message must be 3,000 characters or fewer.');
  }

  const tokenHash = await sha256Hex(`rb-feedback-token-v1:${getOrCreateClientToken()}`);
  const feedbackRef = doc(collection(db, FEEDBACK_COLLECTION));
  const rateLimitRef = doc(db, RATE_LIMITS_COLLECTION, `feedback_${tokenHash}`);

  try {
    const batch = writeBatch(db);
    batch.set(rateLimitRef, {
      kind: 'feedback',
      lastSubmittedAt: serverTimestamp(),
    });
    batch.set(feedbackRef, {
      category: input.category,
      senderName: trimmedName || null,
      message: trimmedMessage,
      isResolved: false,
      appVersion: latestRelease.versionName,
      tokenHash,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'feedback'));
  }

  recordLocalFeedbackTimestamp();
  return {
    id: feedbackRef.id,
    createdAt: new Date().toISOString(),
  };
}

export async function checkUserAdminAccess(uid: string): Promise<boolean> {
  const db = ensureFirestore();
  try {
    const adminSnap = await getDoc(doc(db, ADMINS_COLLECTION, uid));
    return adminSnap.exists();
  } catch {
    return false;
  }
}

export async function adminFetchAllReviews(): Promise<PublicReview[]> {
  const db = ensureFirestore();
  try {
    const snap = await getDocs(
      query(collection(db, REVIEWS_COLLECTION), orderBy('createdAt', 'desc'), firestoreLimit(500))
    );
    return snap.docs.map((docSnap) => mapReviewDoc(docSnap.id, docSnap.data()));
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'admin'));
  }
}

export async function adminUpdateReviewStatus(id: string, status: ReviewStatus): Promise<void> {
  const db = ensureFirestore();
  try {
    await updateDoc(doc(db, REVIEWS_COLLECTION, id), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'admin'));
  }
}

export async function adminDeleteReview(id: string): Promise<void> {
  const db = ensureFirestore();
  try {
    await deleteDoc(doc(db, REVIEWS_COLLECTION, id));
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'admin'));
  }
}

export async function adminFetchPrivateFeedback(): Promise<PrivateFeedbackItem[]> {
  const db = ensureFirestore();
  try {
    const snap = await getDocs(
      query(collection(db, FEEDBACK_COLLECTION), orderBy('createdAt', 'desc'), firestoreLimit(500))
    );
    return snap.docs.map((docSnap) => mapFeedbackDoc(docSnap.id, docSnap.data()));
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'admin'));
  }
}

export async function adminSetFeedbackResolved(id: string, isResolved: boolean): Promise<void> {
  const db = ensureFirestore();
  try {
    await updateDoc(doc(db, FEEDBACK_COLLECTION, id), {
      isResolved,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'admin'));
  }
}

export async function adminDeleteFeedback(id: string): Promise<void> {
  const db = ensureFirestore();
  try {
    await deleteDoc(doc(db, FEEDBACK_COLLECTION, id));
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'admin'));
  }
}

export async function adminGetModerationSettings(): Promise<{ requireManualApproval: boolean }> {
  const db = ensureFirestore();
  try {
    const snap = await getDoc(doc(db, CONFIG_COLLECTION, MODERATION_DOC_ID));
    return {
      requireManualApproval: snap.exists() && snap.data()?.requireManualApproval === true,
    };
  } catch {
    return { requireManualApproval: false };
  }
}

export async function adminUpdateModerationSettings(requireManualApproval: boolean): Promise<void> {
  const db = ensureFirestore();
  try {
    await setDoc(doc(db, CONFIG_COLLECTION, MODERATION_DOC_ID), {
      requireManualApproval,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    throw new Error(normalizeFirestoreError(err, 'admin'));
  }
}

export function formatReviewDate(isoDate: string): string {
  if (!isoDate) return '';
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}
