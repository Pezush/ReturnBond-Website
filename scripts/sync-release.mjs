import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readApkManifestFromBuffer, sdkToAndroidLabel } from './lib/apkManifestReader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

export const DEFAULT_SOURCE_REPO = 'Pezush/ReturnBond';
export const EXPECTED_ANDROID_PACKAGE = process.env.EXPECTED_ANDROID_PACKAGE || 'com.aistudio.returnbond.kxytpm';
export const DEFAULT_UPDATE_JSON_PATH = path.join(REPO_ROOT, 'public', 'update.json');
export const DEFAULT_RELEASE_METADATA_PATH = path.join(REPO_ROOT, 'src', 'data', 'releaseMetadata.json');

const APK_FILENAME_REGEX = /^ReturnBond(?:[-_.]?v?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?))?\.apk$/i;
const VERSION_NAME_REGEX = /^\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$/;
const MANIFEST_ASSET_NAMES = new Set([
  'release-manifest.json',
  'release-metadata.json',
  'manifest.json',
  'output-metadata.json',
]);

export function normalizeVersionName(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^[vV]\s*/, '');
  return VERSION_NAME_REGEX.test(cleaned) ? cleaned : null;
}

export function parsePositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function extractVersionFromApkFileName(fileName) {
  if (typeof fileName !== 'string') return null;
  const match = fileName.trim().match(APK_FILENAME_REGEX);
  if (!match) return null;
  return match[1] ? normalizeVersionName(match[1]) : null;
}

export function isMatchingReturnBondApkName(fileName) {
  return typeof fileName === 'string' && APK_FILENAME_REGEX.test(fileName.trim());
}

export function parseStructuredReleaseBody(rawBody) {
  if (typeof rawBody !== 'string' || !rawBody.trim()) {
    return {
      versionCode: null,
      versionName: null,
      forceUpdate: null,
      releaseTitle: null,
      minimumAndroid: null,
      releaseNotes: [],
    };
  }

  let working = rawBody.replace(/\r\n/g, '\n');
  let versionCode = null;
  let versionName = null;
  let forceUpdate = null;
  let releaseTitle = null;
  let minimumAndroid = null;
  let jsonNotes = null;

  // 1. Optional YAML frontmatter block at start of body
  const frontmatterMatch = working.match(/^---\n([\s\S]*?)\n---\n?/);
  if (frontmatterMatch) {
    working = working.slice(frontmatterMatch[0].length);
    for (const line of frontmatterMatch[1].split('\n')) {
      applyDirectiveLine(line);
    }
  }

  // 2. Optional fenced ```json metadata block
  working = working.replace(/```json\s*\n([\s\S]*?)\n```/gi, (fullMatch, jsonText) => {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const vc = parsePositiveInteger(parsed.versionCode ?? parsed.latestVersionCode ?? parsed.version_code);
        const vn = normalizeVersionName(parsed.versionName ?? parsed.latestVersionName ?? parsed.version_name ?? '');
        if (vc !== null || vn !== null || typeof parsed.forceUpdate === 'boolean') {
          if (vc !== null) versionCode = vc;
          if (vn !== null) versionName = vn;
          if (typeof parsed.forceUpdate === 'boolean') forceUpdate = parsed.forceUpdate;
          if (typeof parsed.releaseTitle === 'string' && parsed.releaseTitle.trim()) {
            releaseTitle = parsed.releaseTitle.trim();
          }
          if (typeof parsed.minimumAndroid === 'string' && parsed.minimumAndroid.trim()) {
            minimumAndroid = parsed.minimumAndroid.trim();
          }
          if (Array.isArray(parsed.releaseNotes)) {
            jsonNotes = parsed.releaseNotes
              .filter((item) => typeof item === 'string' && item.trim())
              .map((item) => item.trim());
          }
          return '';
        }
      }
    } catch {
      // Leave non-metadata JSON blocks intact
    }
    return fullMatch;
  });

  function applyDirectiveLine(line) {
    const cleaned = line
      .trim()
      .replace(/^[-*•]\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '');
    const kv = cleaned.match(/^([A-Za-z][A-Za-z0-9_ -]{1,32})\s*:\s*(.+)$/);
    if (!kv) return false;
    const key = kv[1].trim().toLowerCase().replace(/[\s_-]+/g, '');
    const val = kv[2].trim();

    if (key === 'versioncode' || key === 'latestversioncode' || key === 'androidversioncode') {
      const parsed = parsePositiveInteger(val);
      if (parsed === null) {
        throw new Error(`Invalid structured versionCode value in release description: "${val}"`);
      }
      versionCode = parsed;
      return true;
    }
    if (key === 'versionname' || key === 'latestversionname' || key === 'version') {
      const parsed = normalizeVersionName(val);
      if (!parsed) {
        throw new Error(`Invalid structured versionName value in release description: "${val}"`);
      }
      versionName = parsed;
      return true;
    }
    if (key === 'forceupdate' || key === 'mandatoryupdate') {
      if (/^(true|yes)$/i.test(val)) {
        forceUpdate = true;
        return true;
      }
      if (/^(false|no)$/i.test(val)) {
        forceUpdate = false;
        return true;
      }
      throw new Error(`Invalid structured forceUpdate value in release description: "${val}"`);
    }
    if (key === 'releasetitle' || key === 'title') {
      if (val) releaseTitle = val;
      return true;
    }
    if (key === 'minandroid' || key === 'minimumandroid') {
      if (val) minimumAndroid = val;
      return true;
    }
    return false;
  }

  const noteLines = [];
  const bulletLines = [];
  for (const rawLine of working.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (applyDirectiveLine(trimmed)) continue;
    if (/^#{1,6}\s*(release\s*notes|what'?s\s*changed|changelog|changes|metadata)\s*:?$/i.test(trimmed)) {
      continue;
    }
    if (/^\*\*Full Changelog\*\*\s*:/i.test(trimmed)) {
      continue;
    }
    const bulletMatch = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);
    if (bulletMatch) {
      bulletLines.push(bulletMatch[1].trim());
      continue;
    }
    if (!trimmed.startsWith('#')) {
      noteLines.push(trimmed);
    }
  }

  const extractedNotes = jsonNotes ?? (bulletLines.length > 0 ? bulletLines : noteLines);

  return {
    versionCode,
    versionName,
    forceUpdate,
    releaseTitle,
    minimumAndroid,
    releaseNotes: extractedNotes.slice(0, 20),
  };
}

export function parseReleaseManifestJson(manifestObj) {
  if (!manifestObj || typeof manifestObj !== 'object' || Array.isArray(manifestObj)) {
    throw new Error('Release manifest asset must be a JSON object.');
  }

  // Android Gradle Plugin output-metadata.json compatibility
  if (Array.isArray(manifestObj.elements) && manifestObj.elements.length > 0) {
    const first = manifestObj.elements[0];
    const vc = parsePositiveInteger(first?.versionCode);
    const vn = normalizeVersionName(String(first?.versionName ?? ''));
    return {
      versionCode: vc,
      versionName: vn,
      forceUpdate: null,
      releaseTitle: null,
      minimumAndroid: null,
      releaseNotes: null,
    };
  }

  const rawVc = manifestObj.versionCode ?? manifestObj.latestVersionCode;
  const vc = rawVc !== undefined && rawVc !== null ? parsePositiveInteger(rawVc) : null;
  if (rawVc !== undefined && rawVc !== null && vc === null) {
    throw new Error(`Invalid versionCode in release manifest JSON: "${rawVc}"`);
  }

  const rawVn = manifestObj.versionName ?? manifestObj.latestVersionName;
  const vn = rawVn !== undefined && rawVn !== null ? normalizeVersionName(String(rawVn)) : null;
  if (rawVn !== undefined && rawVn !== null && !vn) {
    throw new Error(`Invalid versionName in release manifest JSON: "${rawVn}"`);
  }

  let forceUpdate = null;
  if (manifestObj.forceUpdate !== undefined) {
    if (typeof manifestObj.forceUpdate !== 'boolean') {
      throw new Error('forceUpdate in release manifest JSON must be a boolean.');
    }
    forceUpdate = manifestObj.forceUpdate;
  }

  let releaseNotes = null;
  if (manifestObj.releaseNotes !== undefined) {
    if (!Array.isArray(manifestObj.releaseNotes) || !manifestObj.releaseNotes.every((n) => typeof n === 'string')) {
      throw new Error('releaseNotes in release manifest JSON must be an array of strings.');
    }
    releaseNotes = manifestObj.releaseNotes.map((n) => n.trim()).filter(Boolean);
  }

  return {
    versionCode: vc,
    versionName: vn,
    forceUpdate,
    releaseTitle: typeof manifestObj.releaseTitle === 'string' ? manifestObj.releaseTitle.trim() : null,
    minimumAndroid: typeof manifestObj.minimumAndroid === 'string' ? manifestObj.minimumAndroid.trim() : null,
    releaseNotes,
  };
}

export function validateAndroidUpdateJson(updateObj) {
  if (!updateObj || typeof updateObj !== 'object' || Array.isArray(updateObj)) {
    throw new Error('Generated update.json must be a JSON object.');
  }

  const expectedKeys = ['latestVersionName', 'latestVersionCode', 'downloadUrl', 'releaseNotes', 'forceUpdate'];
  const actualKeys = Object.keys(updateObj);
  if (
    actualKeys.length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(updateObj, key))
  ) {
    throw new Error(
      `Generated update.json schema mismatch: expected exact keys [${expectedKeys.join(', ')}], got [${actualKeys.join(', ')}].`
    );
  }

  if (!normalizeVersionName(updateObj.latestVersionName)) {
    throw new Error(`Invalid latestVersionName in update.json: "${updateObj.latestVersionName}"`);
  }
  if (parsePositiveInteger(updateObj.latestVersionCode) === null || typeof updateObj.latestVersionCode !== 'number') {
    throw new Error(`Invalid latestVersionCode in update.json: "${updateObj.latestVersionCode}"`);
  }
  if (typeof updateObj.downloadUrl !== 'string' || !updateObj.downloadUrl.startsWith('https://')) {
    throw new Error(`Invalid downloadUrl in update.json (HTTPS required): "${updateObj.downloadUrl}"`);
  }
  if (!Array.isArray(updateObj.releaseNotes) || !updateObj.releaseNotes.every((n) => typeof n === 'string')) {
    throw new Error('Invalid releaseNotes in update.json: must be an array of strings.');
  }
  if (typeof updateObj.forceUpdate !== 'boolean') {
    throw new Error('Invalid forceUpdate in update.json: must be a boolean.');
  }

  return true;
}

export function selectReturnBondApkAsset(release, sourceRepo = DEFAULT_SOURCE_REPO) {
  if (!release || !Array.isArray(release.assets)) return null;
  const expectedPrefix = `https://github.com/${sourceRepo}/releases/download/`;

  const candidates = release.assets.filter((asset) => {
    if (!asset || typeof asset !== 'object') return false;
    if (asset.state && asset.state !== 'uploaded') return false;
    if (!isMatchingReturnBondApkName(asset.name)) return false;
    if (typeof asset.browser_download_url !== 'string' || !asset.browser_download_url.startsWith(expectedPrefix)) {
      return false;
    }
    if (typeof asset.size === 'number' && asset.size <= 0) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const timeDiff = (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0);
    if (timeDiff !== 0) return timeDiff;
    return (b.id || 0) - (a.id || 0);
  });

  return candidates[0];
}

export function selectManifestAsset(release) {
  if (!release || !Array.isArray(release.assets)) return null;
  return (
    release.assets.find(
      (asset) =>
        asset &&
        (!asset.state || asset.state === 'uploaded') &&
        typeof asset.name === 'string' &&
        MANIFEST_ASSET_NAMES.has(asset.name.toLowerCase()) &&
        typeof asset.browser_download_url === 'string' &&
        asset.browser_download_url.startsWith('https://')
    ) || null
  );
}

async function fetchWithRetry(url, options = {}, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(options.timeoutMs || 20000),
      });
      if (response.status >= 500 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw new Error(`Network request failed for ${url}: ${lastError?.message || 'Unknown error'}`);
}

export async function fetchGitHubReleases(sourceRepo = DEFAULT_SOURCE_REPO, fetchImpl = fetchWithRetry) {
  const apiUrl = `https://api.github.com/repos/${sourceRepo}/releases?per_page=30`;
  const baseHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ReturnBond-Website-ReleaseSync/1.0',
  };

  // Unauthenticated public API access first (per least-privilege security design)
  let response = await fetchImpl(apiUrl, { headers: baseHeaders });

  if (
    (response.status === 403 || response.status === 429) &&
    response.headers.get('x-ratelimit-remaining') === '0' &&
    process.env.GITHUB_PUBLIC_READ_TOKEN
  ) {
    response = await fetchImpl(apiUrl, {
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${process.env.GITHUB_PUBLIC_READ_TOKEN}`,
      },
    });
  }

  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const resetEpoch = response.headers.get('x-ratelimit-reset');
    const resetIso = resetEpoch ? new Date(Number(resetEpoch) * 1000).toISOString() : 'unknown';
    const rateErr = new Error(
      `GitHub API rate limit reached (status ${response.status}, remaining=${remaining}, resets=${resetIso}).`
    );
    rateErr.code = 'RATE_LIMITED';
    throw rateErr;
  }

  if (!response.ok) {
    throw new Error(`GitHub Releases API returned HTTP ${response.status} for ${sourceRepo}.`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected GitHub Releases API payload: expected JSON array.');
  }
  return data;
}

export function filterStablePublishedReleases(releases) {
  if (!Array.isArray(releases)) return [];
  return releases
    .filter((rel) => {
      if (!rel || typeof rel !== 'object') return false;
      if (rel.draft === true || rel.prerelease === true) return false;
      if (!rel.published_at || Number.isNaN(Date.parse(rel.published_at))) return false;
      return true;
    })
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
}

export async function downloadAndInspectApk(apkAsset, fetchImpl = fetchWithRetry) {
  const response = await fetchImpl(apkAsset.browser_download_url, {
    headers: { 'User-Agent': 'ReturnBond-Website-ReleaseSync/1.0' },
    timeoutMs: 60000,
  });

  if (!response.ok) {
    throw new Error(`APK download URL is not accessible (HTTP ${response.status}): ${apkAsset.browser_download_url}`);
  }

  const finalUrl = response.url || apkAsset.browser_download_url;
  if (!finalUrl.startsWith('https://')) {
    throw new Error(`Insecure redirect detected when verifying APK URL: ${finalUrl}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new Error(`Downloaded APK asset is empty: ${apkAsset.name}`);
  }
  if (typeof apkAsset.size === 'number' && apkAsset.size > 0 && buffer.length !== apkAsset.size) {
    throw new Error(`APK size mismatch: expected ${apkAsset.size} bytes, downloaded ${buffer.length} bytes.`);
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (typeof apkAsset.digest === 'string' && apkAsset.digest.startsWith('sha256:')) {
    const expectedSha = apkAsset.digest.slice('sha256:'.length).toLowerCase();
    if (sha256.toLowerCase() !== expectedSha) {
      throw new Error(`APK SHA-256 digest mismatch: expected ${expectedSha}, got ${sha256}.`);
    }
  }

  const manifest = readApkManifestFromBuffer(buffer);
  return {
    sizeBytes: buffer.length,
    sha256,
    manifest,
  };
}

export async function evaluateReleaseCandidate({
  release,
  currentStore,
  sourceRepo = DEFAULT_SOURCE_REPO,
  inspectApkFn = downloadAndInspectApk,
  fetchManifestJsonFn = null,
  expectedPackage = EXPECTED_ANDROID_PACKAGE,
}) {
  if (!release || typeof release !== 'object') {
    throw new Error('Release candidate is missing.');
  }
  if (release.draft === true) {
    throw new Error(`Release "${release.tag_name || release.name}" is a draft and cannot be published.`);
  }
  if (release.prerelease === true) {
    throw new Error(`Release "${release.tag_name || release.name}" is marked as a prerelease.`);
  }
  if (!release.published_at || Number.isNaN(Date.parse(release.published_at))) {
    throw new Error(`Release "${release.tag_name || release.name}" does not have a valid published_at timestamp.`);
  }

  const apkAsset = selectReturnBondApkAsset(release, sourceRepo);
  if (!apkAsset) {
    throw new Error(
      `Release "${release.tag_name || release.name}" is missing a valid uploaded ReturnBond APK asset.`
    );
  }

  const currentLatest = currentStore?.latest;
  const assetShaFromDigest =
    typeof apkAsset.digest === 'string' && apkAsset.digest.startsWith('sha256:')
      ? apkAsset.digest.slice('sha256:'.length).toLowerCase()
      : null;

  // Fast idempotency check: exact same APK asset already synced
  if (
    currentLatest &&
    apkAsset.id &&
    apkAsset.id === currentLatest.assetId &&
    apkAsset.browser_download_url === currentLatest.downloadUrl &&
    (!assetShaFromDigest || assetShaFromDigest === currentLatest.apkSha256)
  ) {
    return { status: 'unchanged', latest: currentLatest };
  }

  const bodyMeta = parseStructuredReleaseBody(release.body || '');

  let manifestAssetMeta = null;
  const manifestAsset = selectManifestAsset(release);
  if (manifestAsset) {
    const loader =
      fetchManifestJsonFn ||
      (async (url) => {
        const res = await fetchWithRetry(url, {
          headers: { 'User-Agent': 'ReturnBond-Website-ReleaseSync/1.0', Accept: 'application/json' },
        });
        if (!res.ok) {
          throw new Error(`Failed to fetch release manifest asset (${manifestAsset.name}): HTTP ${res.status}`);
        }
        return res.json();
      });
    const rawManifestJson = await loader(manifestAsset.browser_download_url, manifestAsset);
    manifestAssetMeta = parseReleaseManifestJson(rawManifestJson);
  }

  const apkInspection = inspectApkFn ? await inspectApkFn(apkAsset) : null;
  const apkManifest = apkInspection?.manifest || null;

  if (apkManifest?.packageName && expectedPackage && apkManifest.packageName !== expectedPackage) {
    throw new Error(
      `APK package name mismatch: expected "${expectedPackage}", got "${apkManifest.packageName}".`
    );
  }

  // Cross-validate explicit versionCode sources — NEVER guess versionCode from versionName
  const versionCodeSources = [];
  if (manifestAssetMeta?.versionCode !== null && manifestAssetMeta?.versionCode !== undefined) {
    versionCodeSources.push({ source: 'release-manifest-json', value: manifestAssetMeta.versionCode });
  }
  if (bodyMeta.versionCode !== null) {
    versionCodeSources.push({ source: 'release-description', value: bodyMeta.versionCode });
  }
  if (apkManifest?.versionCode !== null && apkManifest?.versionCode !== undefined) {
    const parsedApkVc = parsePositiveInteger(apkManifest.versionCode);
    if (parsedApkVc === null) {
      throw new Error(`APK AndroidManifest.xml contains invalid versionCode: "${apkManifest.versionCode}"`);
    }
    versionCodeSources.push({ source: 'apk-android-manifest', value: parsedApkVc });
  }

  if (versionCodeSources.length === 0) {
    throw new Error(
      `Missing required versionCode metadata in release "${release.tag_name}". Provide versionCode in the release description, a release manifest JSON asset, or a valid compiled Android APK.`
    );
  }

  const resolvedVersionCode = versionCodeSources[0].value;
  for (const entry of versionCodeSources.slice(1)) {
    if (entry.value !== resolvedVersionCode) {
      throw new Error(
        `Conflicting versionCode metadata: ${versionCodeSources[0].source}=${resolvedVersionCode} vs ${entry.source}=${entry.value}.`
      );
    }
  }

  // Cross-validate versionName sources
  const fileNameVersion = extractVersionFromApkFileName(apkAsset.name);
  const tagVersion = normalizeVersionName(release.tag_name || '');
  const apkBinaryVersion = apkManifest?.versionName ? normalizeVersionName(apkManifest.versionName) : null;

  if (apkManifest?.versionName && !apkBinaryVersion) {
    throw new Error(`APK AndroidManifest.xml contains invalid versionName: "${apkManifest.versionName}"`);
  }

  const explicitVersionSources = [];
  if (manifestAssetMeta?.versionName) {
    explicitVersionSources.push({ source: 'release-manifest-json', value: manifestAssetMeta.versionName });
  }
  if (bodyMeta.versionName) {
    explicitVersionSources.push({ source: 'release-description', value: bodyMeta.versionName });
  }
  if (apkBinaryVersion) {
    explicitVersionSources.push({ source: 'apk-android-manifest', value: apkBinaryVersion });
  }
  if (fileNameVersion) {
    explicitVersionSources.push({ source: 'apk-filename', value: fileNameVersion });
  }

  const resolvedVersionName = explicitVersionSources[0]?.value || tagVersion;
  if (!resolvedVersionName) {
    throw new Error(`Unable to determine a valid versionName for release "${release.tag_name}".`);
  }

  for (const entry of explicitVersionSources) {
    if (entry.value !== resolvedVersionName) {
      throw new Error(
        `Conflicting versionName metadata: expected "${resolvedVersionName}", but ${entry.source} reported "${entry.value}".`
      );
    }
  }

  // Check if same versionCode & downloadUrl as current (idempotent fallback when assetId wasn't cached)
  if (
    currentLatest &&
    resolvedVersionCode === currentLatest.versionCode &&
    resolvedVersionName === currentLatest.versionName &&
    apkAsset.browser_download_url === currentLatest.downloadUrl
  ) {
    return { status: 'unchanged', latest: currentLatest };
  }

  // Enforce monotonic versionCode progression over previously published stable release
  const previousVersionCode = parsePositiveInteger(currentLatest?.versionCode) ?? 0;
  if (resolvedVersionCode <= previousVersionCode) {
    throw new Error(
      `Candidate versionCode (${resolvedVersionCode}) for v${resolvedVersionName} must be strictly greater than current published versionCode (${previousVersionCode}).`
    );
  }

  const publishedAt =
    apkAsset.created_at && Date.parse(apkAsset.created_at) > Date.parse(release.published_at)
      ? apkAsset.created_at
      : release.published_at;

  // Detect when a new APK asset (e.g. ReturnBond-v1.8.4.7.apk) is uploaded onto an older
  // shared release tag (e.g. v1.1.0) whose title/body belong to the older tag.
  const isSharedLegacyContainer =
    Boolean(tagVersion) &&
    tagVersion !== resolvedVersionName &&
    bodyMeta.versionName !== resolvedVersionName &&
    bodyMeta.versionCode !== resolvedVersionCode &&
    !(typeof release.body === 'string' && release.body.includes(resolvedVersionName));

  const cleanedReleaseName =
    !isSharedLegacyContainer &&
    typeof release.name === 'string' &&
    release.name.trim() &&
    normalizeVersionName(release.name.replace(/^ReturnBond\s*/i, '')) !== resolvedVersionName
      ? release.name.trim()
      : null;

  const releaseTitle =
    manifestAssetMeta?.releaseTitle ||
    bodyMeta.releaseTitle ||
    cleanedReleaseName ||
    `ReturnBond ${resolvedVersionName}`;

  const releaseNotes =
    manifestAssetMeta?.releaseNotes ?? (isSharedLegacyContainer ? [] : bodyMeta.releaseNotes);
  const forceUpdate = manifestAssetMeta?.forceUpdate ?? bodyMeta.forceUpdate ?? false;

  const sdkLabels = apkManifest?.minSdkVersion ? sdkToAndroidLabel(apkManifest.minSdkVersion) : null;
  const minimumAndroid =
    manifestAssetMeta?.minimumAndroid ||
    bodyMeta.minimumAndroid ||
    sdkLabels?.short ||
    currentStore?.minimumAndroid ||
    'Android 7.0+';
  const minimumAndroidFull =
    sdkLabels?.full ||
    (minimumAndroid.endsWith('+')
      ? `${minimumAndroid.slice(0, -1)} and higher`
      : currentStore?.minimumAndroidFull || 'Android 7.0 and higher');
  const minimumSdk = apkManifest?.minSdkVersion || currentStore?.minimumSdk || 24;

  const nextLatest = {
    versionName: resolvedVersionName,
    versionCode: resolvedVersionCode,
    releaseTag: release.tag_name || `v${resolvedVersionName}`,
    releaseId: release.id || 0,
    assetId: apkAsset.id || 0,
    releaseTitle,
    publishedAt,
    apkFileName: apkAsset.name,
    apkSizeBytes: apkInspection?.sizeBytes ?? apkAsset.size ?? 0,
    apkSha256: apkInspection?.sha256 ?? assetShaFromDigest ?? '',
    downloadUrl: apkAsset.browser_download_url,
    releaseNotes,
    forceUpdate,
  };

  const nextUpdateJson = {
    latestVersionName: nextLatest.versionName,
    latestVersionCode: nextLatest.versionCode,
    downloadUrl: nextLatest.downloadUrl,
    releaseNotes: nextLatest.releaseNotes,
    forceUpdate: nextLatest.forceUpdate,
  };

  validateAndroidUpdateJson(nextUpdateJson);

  return {
    status: 'updated',
    latest: nextLatest,
    updateJson: nextUpdateJson,
    minimumAndroid,
    minimumAndroidFull,
    minimumSdk,
  };
}

export function mergeReleaseHistory(existingHistory, newEntries) {
  const byVersionCode = new Map();
  for (const item of Array.isArray(existingHistory) ? existingHistory : []) {
    if (item && Number.isInteger(item.versionCode)) {
      byVersionCode.set(item.versionCode, item);
    }
  }
  for (const entry of newEntries) {
    byVersionCode.set(entry.versionCode, {
      versionName: entry.versionName,
      versionCode: entry.versionCode,
      releaseTag: entry.releaseTag,
      releaseTitle: entry.releaseTitle,
      publishedAt: entry.publishedAt,
      apkFileName: entry.apkFileName,
      downloadUrl: entry.downloadUrl,
      releaseNotes: entry.releaseNotes,
    });
  }
  return Array.from(byVersionCode.values()).sort((a, b) => b.versionCode - a.versionCode);
}

function writeJsonAtomically(targetPath, data) {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = `${targetPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, serialized, 'utf8');
  fs.renameSync(tempPath, targetPath);
}

export async function runReleaseSync({
  sourceRepo = DEFAULT_SOURCE_REPO,
  dryRun = false,
  targetTag = '',
  metadataPath = DEFAULT_RELEASE_METADATA_PATH,
  updateJsonPath = DEFAULT_UPDATE_JSON_PATH,
  fetchReleasesFn = fetchGitHubReleases,
  inspectApkFn = downloadAndInspectApk,
} = {}) {
  const currentStore = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const currentUpdateJson = JSON.parse(fs.readFileSync(updateJsonPath, 'utf8'));
  validateAndroidUpdateJson(currentUpdateJson);

  const rawReleases = await fetchReleasesFn(sourceRepo);
  const stableReleases = filterStablePublishedReleases(rawReleases);

  if (stableReleases.length === 0) {
    throw new Error(`No published stable releases found in ${sourceRepo}.`);
  }

  const candidateReleases = targetTag
    ? stableReleases.filter((r) => r.tag_name === targetTag)
    : stableReleases;

  if (candidateReleases.length === 0) {
    throw new Error(`Target release tag "${targetTag}" was not found among published stable releases.`);
  }

  // Evaluate newest published stable release first
  const primaryRelease = candidateReleases[0];
  const primaryResult = await evaluateReleaseCandidate({
    release: primaryRelease,
    currentStore,
    sourceRepo,
    inspectApkFn,
  });

  if (primaryResult.status === 'unchanged') {
    return {
      updated: false,
      dryRun,
      latest: currentStore.latest,
      updateJson: currentUpdateJson,
      store: currentStore,
    };
  }

  // Also collect any intermediate stable releases published after currentStore.latest.versionCode
  const newlyDiscovered = [primaryResult.latest];
  for (const olderRel of candidateReleases.slice(1)) {
    if (targetTag) break;
    const apk = selectReturnBondApkAsset(olderRel, sourceRepo);
    if (!apk) continue;
    if (apk.id === currentStore.latest.assetId || apk.browser_download_url === currentStore.latest.downloadUrl) {
      break;
    }
    try {
      const olderEval = await evaluateReleaseCandidate({
        release: olderRel,
        currentStore,
        sourceRepo,
        inspectApkFn,
      });
      if (olderEval.status === 'updated' && olderEval.latest.versionCode < primaryResult.latest.versionCode) {
        newlyDiscovered.push(olderEval.latest);
      }
    } catch {
      // Stop backfilling if an older historic release precedes current baseline
      break;
    }
  }

  const nextStore = {
    schemaVersion: 1,
    sourceRepository: sourceRepo,
    minimumAndroid: primaryResult.minimumAndroid,
    minimumAndroidFull: primaryResult.minimumAndroidFull,
    minimumSdk: primaryResult.minimumSdk,
    latest: primaryResult.latest,
    history: mergeReleaseHistory(currentStore.history, newlyDiscovered),
  };

  if (!dryRun) {
    writeJsonAtomically(updateJsonPath, primaryResult.updateJson);
    writeJsonAtomically(metadataPath, nextStore);
  }

  return {
    updated: true,
    dryRun,
    latest: primaryResult.latest,
    updateJson: primaryResult.updateJson,
    store: nextStore,
  };
}

function appendGitHubOutput(key, value) {
  const outPath = process.env.GITHUB_OUTPUT;
  if (!outPath) return;
  fs.appendFileSync(outPath, `${key}=${String(value)}\n`, 'utf8');
}

function appendGitHubSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || process.env.DRY_RUN === 'true';
  const tagIdx = args.indexOf('--tag');
  const targetTag = tagIdx >= 0 && args[tagIdx + 1] ? args[tagIdx + 1] : process.env.TARGET_TAG || '';
  const repoIdx = args.indexOf('--repo');
  const sourceRepo = repoIdx >= 0 && args[repoIdx + 1] ? args[repoIdx + 1] : DEFAULT_SOURCE_REPO;

  try {
    const result = await runReleaseSync({ sourceRepo, dryRun, targetTag });
    appendGitHubOutput('updated', result.updated ? 'true' : 'false');
    appendGitHubOutput('version_name', result.latest.versionName);
    appendGitHubOutput('version_code', result.latest.versionCode);
    appendGitHubOutput('apk_filename', result.latest.apkFileName);

    if (!result.updated) {
      const msg = `No new stable release detected. Current release v${result.latest.versionName} (versionCode ${result.latest.versionCode}) is already synchronized.`;
      console.log(msg);
      appendGitHubSummary(`### ReturnBond Release Sync\n- **Status:** Up to date\n- **Version:** \`${result.latest.versionName}\` (code \`${result.latest.versionCode}\`)\n`);
      return;
    }

    const modeLabel = dryRun ? 'DRY RUN (no files written)' : 'UPDATED';
    console.log(
      `[${modeLabel}] Synchronized ReturnBond v${result.latest.versionName} (versionCode ${result.latest.versionCode}, asset ${result.latest.apkFileName}).`
    );
    appendGitHubSummary(
      `### ReturnBond Release Sync (${modeLabel})\n` +
        `- **New Version:** \`${result.latest.versionName}\`\n` +
        `- **Version Code:** \`${result.latest.versionCode}\`\n` +
        `- **APK Asset:** \`${result.latest.apkFileName}\`\n` +
        `- **Download URL:** ${result.latest.downloadUrl}\n`
    );
  } catch (error) {
    appendGitHubOutput('updated', 'false');
    if (error?.code === 'RATE_LIMITED' && process.env.GITHUB_EVENT_NAME === 'schedule') {
      console.warn(`[WARN] ${error.message} Preserving existing release metadata and retrying on next schedule.`);
      appendGitHubSummary(`### ReturnBond Release Sync\n- **Status:** Skipped due to shared IP rate limit\n- **Details:** ${error.message}\n`);
      process.exit(0);
    }
    console.error(`[ERROR] Release sync aborted safely without modifying metadata: ${error.message}`);
    appendGitHubSummary(`### ReturnBond Release Sync Failed Safely\n- **Reason:** ${error.message}\n- **Safety:** Existing production metadata was preserved untouched.\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
