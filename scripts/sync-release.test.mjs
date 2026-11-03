import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sdkToAndroidLabel } from './lib/apkManifestReader.mjs';
import {
  DEFAULT_RELEASE_METADATA_PATH,
  DEFAULT_SOURCE_REPO,
  DEFAULT_UPDATE_JSON_PATH,
  downloadAndInspectApk,
  evaluateReleaseCandidate,
  extractVersionFromApkFileName,
  fetchGitHubReleases,
  filterStablePublishedReleases,
  isMatchingReturnBondApkName,
  mergeReleaseHistory,
  normalizeVersionName,
  parseReleaseManifestJson,
  parseStructuredReleaseBody,
  runReleaseSync,
  selectReturnBondApkAsset,
  validateAndroidUpdateJson,
} from './sync-release.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function createBaseStore() {
  return JSON.parse(fs.readFileSync(DEFAULT_RELEASE_METADATA_PATH, 'utf8'));
}

test('1. APK filename & versionName normalization rules', () => {
  assert.equal(isMatchingReturnBondApkName('ReturnBond-v1.8.4.7.apk'), true);
  assert.equal(isMatchingReturnBondApkName('ReturnBond-2.0.0.apk'), true);
  assert.equal(isMatchingReturnBondApkName('ReturnBond.apk'), true);
  assert.equal(isMatchingReturnBondApkName('UnrelatedApp-v1.8.4.7.apk'), false);
  assert.equal(isMatchingReturnBondApkName('ReturnBond-v1.8.4.7.zip'), false);

  assert.equal(extractVersionFromApkFileName('ReturnBond-v1.8.4.7.apk'), '1.8.4.7');
  assert.equal(extractVersionFromApkFileName('ReturnBond-1.9.0.apk'), '1.9.0');
  assert.equal(extractVersionFromApkFileName('ReturnBond.apk'), null);

  assert.equal(normalizeVersionName('v1.8.4.7'), '1.8.4.7');
  assert.equal(normalizeVersionName('1.10.0'), '1.10.0');
  assert.equal(normalizeVersionName('invalid'), null);
  assert.deepEqual(sdkToAndroidLabel(24), {
    short: 'Android 7.0+',
    full: 'Android 7.0 and higher',
  });
});

test('2. Structured release description & Gradle/manifest JSON extraction', () => {
  const parsedBody = parseStructuredReleaseBody(`
## Release Metadata
- **Version Code:** 19
- **Version Name:** v1.8.4.7
- **Force Update:** false
- **Release Title:** Faster Sync & Cleaner Reminders

## What's Changed
- Improved reminder scheduling accuracy on Android 14+
- Fixed partial repayment summary rounding
**Full Changelog**: https://github.com/Pezush/ReturnBond/compare/v1.8.4.6...v1.8.4.7
`);

  assert.equal(parsedBody.versionCode, 19);
  assert.equal(parsedBody.versionName, '1.8.4.7');
  assert.equal(parsedBody.forceUpdate, false);
  assert.equal(parsedBody.releaseTitle, 'Faster Sync & Cleaner Reminders');
  assert.deepEqual(parsedBody.releaseNotes, [
    'Improved reminder scheduling accuracy on Android 14+',
    'Fixed partial repayment summary rounding',
  ]);

  const gradleMeta = parseReleaseManifestJson({
    version: 3,
    artifactType: { type: 'APK', kind: 'Directory' },
    applicationId: 'com.aistudio.returnbond.kxytpm',
    variantName: 'release',
    elements: [
      {
        type: 'SINGLE',
        versionCode: 20,
        versionName: '1.9.0',
        outputFile: 'ReturnBond-v1.9.0.apk',
      },
    ],
  });
  assert.equal(gradleMeta.versionCode, 20);
  assert.equal(gradleMeta.versionName, '1.9.0');
});

test('3. Never guesses versionCode from versionName when explicit metadata is absent', async () => {
  const baseStore = createBaseStore();
  const fakeRelease = {
    id: 999001,
    tag_name: 'v1.8.4.7',
    name: 'ReturnBond 1.8.4.7',
    draft: false,
    prerelease: false,
    published_at: '2026-11-02T10:00:00Z',
    body: '- Added CSV export\n- Bug fixes',
    assets: [
      {
        id: 888001,
        name: 'ReturnBond-v1.8.4.7.apk',
        state: 'uploaded',
        size: 21500000,
        created_at: '2026-11-02T10:00:00Z',
        browser_download_url:
          'https://github.com/Pezush/ReturnBond/releases/download/v1.8.4.7/ReturnBond-v1.8.4.7.apk',
      },
    ],
  };

  await assert.rejects(
    () =>
      evaluateReleaseCandidate({
        release: fakeRelease,
        currentStore: baseStore,
        inspectApkFn: null, // No APK binary manifest and no structured versionCode
      }),
    /Missing required versionCode metadata/
  );
});

test('4. Rejects drafts, prereleases, missing APK, versionCode downgrades, and mismatched metadata', async () => {
  const baseStore = createBaseStore();
  const currentCode = baseStore.latest.versionCode;
  const nextCode = currentCode + 1;
  const validAsset = {
    id: 888002,
    name: 'ReturnBond-v99.0.0.apk',
    state: 'uploaded',
    size: 21500000,
    created_at: '2026-11-02T10:00:00Z',
    browser_download_url:
      'https://github.com/Pezush/ReturnBond/releases/download/v99.0.0/ReturnBond-v99.0.0.apk',
  };

  // Draft rejected
  await assert.rejects(
    () =>
      evaluateReleaseCandidate({
        release: {
          tag_name: 'v99.0.0',
          draft: true,
          prerelease: false,
          published_at: '2026-11-02T10:00:00Z',
          body: `versionCode: ${nextCode}`,
          assets: [validAsset],
        },
        currentStore: baseStore,
        inspectApkFn: null,
      }),
    /draft/i
  );

  // Prerelease rejected
  await assert.rejects(
    () =>
      evaluateReleaseCandidate({
        release: {
          tag_name: 'v99.0.0-beta.1',
          draft: false,
          prerelease: true,
          published_at: '2026-11-02T10:00:00Z',
          body: `versionCode: ${nextCode}`,
          assets: [validAsset],
        },
        currentStore: baseStore,
        inspectApkFn: null,
      }),
    /prerelease/i
  );

  // Unincremented versionCode rejected
  await assert.rejects(
    () =>
      evaluateReleaseCandidate({
        release: {
          tag_name: 'v99.0.0',
          draft: false,
          prerelease: false,
          published_at: '2026-11-02T10:00:00Z',
          body: `versionCode: ${currentCode}`,
          assets: [validAsset],
        },
        currentStore: baseStore,
        inspectApkFn: null,
      }),
    /strictly greater than current published versionCode/
  );

  // Conflicting versionCode between release description and APK manifest rejected
  await assert.rejects(
    () =>
      evaluateReleaseCandidate({
        release: {
          tag_name: 'v99.0.0',
          draft: false,
          prerelease: false,
          published_at: '2026-11-02T10:00:00Z',
          body: `versionCode: ${nextCode + 1}`,
          assets: [validAsset],
        },
        currentStore: baseStore,
        inspectApkFn: async () => ({
          sizeBytes: 21500000,
          sha256: 'abc123',
          manifest: {
            packageName: 'com.aistudio.returnbond.kxytpm',
            versionCode: nextCode,
            versionName: '99.0.0',
            minSdkVersion: 24,
          },
        }),
      }),
    /Conflicting versionCode metadata/
  );
});

test('5. Android update.json schema validator enforces exact installed-app compatibility', () => {
  const currentUpdate = JSON.parse(fs.readFileSync(DEFAULT_UPDATE_JSON_PATH, 'utf8'));
  assert.equal(validateAndroidUpdateJson(currentUpdate), true);

  // Reject extra invented keys
  assert.throws(
    () =>
      validateAndroidUpdateJson({
        ...currentUpdate,
        extraInventedField: true,
      }),
    /schema mismatch/
  );

  // Reject insecure HTTP URL
  assert.throws(
    () =>
      validateAndroidUpdateJson({
        ...currentUpdate,
        downloadUrl: 'http://example.com/ReturnBond.apk',
      }),
    /HTTPS required/
  );
});

test('6. End-to-end sandbox sync updates update.json, releaseMetadata.json & preserves release history', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'returnbond-sync-test-'));
  try {
    const baseStore = createBaseStore();
    const initialHistoryLen = baseStore.history.length;
    const prevCode = baseStore.latest.versionCode;
    const nextCode = prevCode + 1;

    const tempMetaPath = path.join(tmpDir, 'releaseMetadata.json');
    const tempUpdatePath = path.join(tmpDir, 'update.json');
    fs.copyFileSync(DEFAULT_RELEASE_METADATA_PATH, tempMetaPath);
    fs.copyFileSync(DEFAULT_UPDATE_JSON_PATH, tempUpdatePath);

    const simulatedReleases = [
      {
        id: 500020,
        tag_name: 'v99.1.0',
        name: 'Reliability and Faster Reminders',
        draft: false,
        prerelease: false,
        published_at: '2026-11-05T12:30:00Z',
        body: `Version Code: ${nextCode}\n- Added improved reminder diagnostics\n- Faster startup offline`,
        assets: [
          {
            id: 700020,
            name: 'ReturnBond-v99.1.0.apk',
            state: 'uploaded',
            size: 21400000,
            digest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
            created_at: '2026-11-05T12:29:00Z',
            browser_download_url:
              'https://github.com/Pezush/ReturnBond/releases/download/v99.1.0/ReturnBond-v99.1.0.apk',
          },
        ],
      },
    ];

    const mockInspectApk = async () => ({
      sizeBytes: 21400000,
      sha256: '1111111111111111111111111111111111111111111111111111111111111111',
      manifest: {
        packageName: 'com.aistudio.returnbond.kxytpm',
        versionCode: nextCode,
        versionName: '99.1.0',
        minSdkVersion: 24,
      },
    });

    // First sync: updates to nextCode
    const firstRun = await runReleaseSync({
      metadataPath: tempMetaPath,
      updateJsonPath: tempUpdatePath,
      fetchReleasesFn: async () => simulatedReleases,
      inspectApkFn: mockInspectApk,
    });

    assert.equal(firstRun.updated, true);
    assert.equal(firstRun.latest.versionName, '99.1.0');
    assert.equal(firstRun.latest.versionCode, nextCode);

    const writtenUpdate = JSON.parse(fs.readFileSync(tempUpdatePath, 'utf8'));
    validateAndroidUpdateJson(writtenUpdate);
    assert.equal(writtenUpdate.latestVersionName, '99.1.0');
    assert.equal(writtenUpdate.latestVersionCode, nextCode);
    assert.equal(
      writtenUpdate.downloadUrl,
      'https://github.com/Pezush/ReturnBond/releases/download/v99.1.0/ReturnBond-v99.1.0.apk'
    );

    const writtenMeta = JSON.parse(fs.readFileSync(tempMetaPath, 'utf8'));
    assert.equal(writtenMeta.history.length, initialHistoryLen + 1);
    assert.equal(writtenMeta.history[0].versionCode, nextCode);
    assert.equal(writtenMeta.history[1].versionCode, prevCode);

    // Second sync with identical release: idempotent no-op (updated === false)
    const secondRun = await runReleaseSync({
      metadataPath: tempMetaPath,
      updateJsonPath: tempUpdatePath,
      fetchReleasesFn: async () => simulatedReleases,
      inspectApkFn: () => {
        throw new Error('Should not re-download APK when assetId/digest is unchanged');
      },
    });
    assert.equal(secondRun.updated, false);

    // Failed validation on broken next release preserves 99.1.0 untouched
    const beforeFailedUpdate = fs.readFileSync(tempUpdatePath, 'utf8');
    const beforeFailedMeta = fs.readFileSync(tempMetaPath, 'utf8');
    await assert.rejects(() =>
      runReleaseSync({
        metadataPath: tempMetaPath,
        updateJsonPath: tempUpdatePath,
        fetchReleasesFn: async () => [
          {
            id: 500021,
            tag_name: 'v99.2.0',
            name: 'Broken Release Without APK',
            draft: false,
            prerelease: false,
            published_at: '2026-11-06T12:30:00Z',
            body: `versionCode: ${nextCode + 1}`,
            assets: [],
          },
        ],
        inspectApkFn: mockInspectApk,
      })
    );
    assert.equal(fs.readFileSync(tempUpdatePath, 'utf8'), beforeFailedUpdate);
    assert.equal(fs.readFileSync(tempMetaPath, 'utf8'), beforeFailedMeta);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('7. Live GitHub Releases API, APK manifest extraction & dry-run against Pezush/ReturnBond', async () => {
  const releases = await fetchGitHubReleases(DEFAULT_SOURCE_REPO);
  assert.ok(releases.length >= 1, 'Expected at least 1 release in Pezush/ReturnBond');

  const stable = filterStablePublishedReleases(releases);
  assert.ok(stable.length >= 1, 'Expected at least 1 published stable release');

  const latestApk = selectReturnBondApkAsset(stable[0], DEFAULT_SOURCE_REPO);
  assert.ok(latestApk, 'Expected a valid ReturnBond APK asset');
  assert.equal(isMatchingReturnBondApkName(latestApk.name), true);

  // Verify live binary APK download + pure-Node AndroidManifest.xml extraction
  const inspected = await downloadAndInspectApk(latestApk);
  assert.equal(inspected.manifest.packageName, 'com.aistudio.returnbond.kxytpm');
  assert.ok(inspected.manifest.versionCode >= 18, 'Expected versionCode >= 18');
  const expectedFileNameVer = extractVersionFromApkFileName(latestApk.name);
  if (expectedFileNameVer) {
    assert.equal(inspected.manifest.versionName, expectedFileNameVer);
  }
  assert.equal(inspected.manifest.minSdkVersion, 24);

  // Verify dry-run sync executes safely without modifying production files on disk
  const beforeUpdate = fs.readFileSync(DEFAULT_UPDATE_JSON_PATH, 'utf8');
  const beforeMeta = fs.readFileSync(DEFAULT_RELEASE_METADATA_PATH, 'utf8');
  const dryRunResult = await runReleaseSync({ dryRun: true });
  assert.equal(dryRunResult.latest.versionName, inspected.manifest.versionName);
  assert.equal(dryRunResult.latest.versionCode, inspected.manifest.versionCode);
  assert.equal(fs.readFileSync(DEFAULT_UPDATE_JSON_PATH, 'utf8'), beforeUpdate);
  assert.equal(fs.readFileSync(DEFAULT_RELEASE_METADATA_PATH, 'utf8'), beforeMeta);
});

test('8. Workflow permissions and Vercel configuration safety checks', () => {
  const workflowYaml = fs.readFileSync(
    path.join(REPO_ROOT, '.github', 'workflows', 'sync-android-release.yml'),
    'utf8'
  );
  assert.match(workflowYaml, /cron:\s*'?\*\/5 \* \* \* \*'?/);
  assert.match(workflowYaml, /workflow_dispatch:/);
  assert.match(workflowYaml, /contents:\s*write/);
  assert.doesNotMatch(workflowYaml, /--force/);
  assert.doesNotMatch(workflowYaml, /backup-before-ai-studio/);

  const vercelConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8'));
  const updateHeaderRule = vercelConfig.headers?.find((h) => h.source === '/update.json');
  assert.ok(updateHeaderRule, 'Expected no-cache header rule for /update.json in vercel.json');
  assert.equal(mergeReleaseHistory([{ versionCode: 18, versionName: '1.8.4.6' }], []).length, 1);
});
