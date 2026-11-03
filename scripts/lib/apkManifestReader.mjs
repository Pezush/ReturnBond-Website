import zlib from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CEN_SIGNATURE = 0x02014b50;
const LOC_SIGNATURE = 0x04034b50;

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const UTF8_FLAG = 0x00000100;

const ATTR_MIN_SDK_VERSION = 0x0101020c;
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;
const ATTR_TARGET_SDK_VERSION = 0x01010270;

const ANDROID_SDK_MAP = {
  21: { short: 'Android 5.0+', full: 'Android 5.0 and higher' },
  22: { short: 'Android 5.1+', full: 'Android 5.1 and higher' },
  23: { short: 'Android 6.0+', full: 'Android 6.0 and higher' },
  24: { short: 'Android 7.0+', full: 'Android 7.0 and higher' },
  25: { short: 'Android 7.1+', full: 'Android 7.1 and higher' },
  26: { short: 'Android 8.0+', full: 'Android 8.0 and higher' },
  27: { short: 'Android 8.1+', full: 'Android 8.1 and higher' },
  28: { short: 'Android 9.0+', full: 'Android 9.0 and higher' },
  29: { short: 'Android 10+', full: 'Android 10 and higher' },
  30: { short: 'Android 11+', full: 'Android 11 and higher' },
  31: { short: 'Android 12+', full: 'Android 12 and higher' },
  32: { short: 'Android 12L+', full: 'Android 12L and higher' },
  33: { short: 'Android 13+', full: 'Android 13 and higher' },
  34: { short: 'Android 14+', full: 'Android 14 and higher' },
  35: { short: 'Android 15+', full: 'Android 15 and higher' },
  36: { short: 'Android 16+', full: 'Android 16 and higher' },
};

export function sdkToAndroidLabel(sdkVersion) {
  if (!Number.isInteger(sdkVersion) || sdkVersion <= 0) return null;
  if (ANDROID_SDK_MAP[sdkVersion]) return ANDROID_SDK_MAP[sdkVersion];
  return {
    short: `API ${sdkVersion}+`,
    full: `Android API ${sdkVersion} and higher`,
  };
}

export function extractZipEntryFromBuffer(zipBuffer, targetEntryName) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    throw new Error('Invalid APK archive: buffer is too small to be a ZIP file.');
  }
  if (zipBuffer.readUInt32LE(0) !== LOC_SIGNATURE) {
    throw new Error('Invalid APK archive: missing ZIP local file header signature.');
  }

  const maxCommentScan = Math.min(zipBuffer.length - 22, 0xffff);
  let eocdOffset = -1;
  for (let commentLen = 0; commentLen <= maxCommentScan; commentLen += 1) {
    const candidate = zipBuffer.length - 22 - commentLen;
    if (zipBuffer.readUInt32LE(candidate) === EOCD_SIGNATURE) {
      eocdOffset = candidate;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid APK archive: ZIP End of Central Directory record not found.');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let cursor = centralDirOffset;
  for (let i = 0; i < totalEntries && cursor + 46 <= zipBuffer.length; i += 1) {
    if (zipBuffer.readUInt32LE(cursor) !== CEN_SIGNATURE) {
      throw new Error('Invalid APK archive: corrupted ZIP Central Directory entry.');
    }
    const compressionMethod = zipBuffer.readUInt16LE(cursor + 10);
    const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    const fileNameLen = zipBuffer.readUInt16LE(cursor + 28);
    const extraLen = zipBuffer.readUInt16LE(cursor + 30);
    const commentLen = zipBuffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cursor + 42);

    const fileName = zipBuffer.subarray(cursor + 46, cursor + 46 + fileNameLen).toString('utf8');
    if (fileName === targetEntryName) {
      if (localHeaderOffset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(localHeaderOffset) !== LOC_SIGNATURE) {
        throw new Error(`Invalid APK archive: local header missing for ${targetEntryName}.`);
      }
      const locNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
      const locExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + locNameLen + locExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > zipBuffer.length) {
        throw new Error(`Invalid APK archive: truncated entry data for ${targetEntryName}.`);
      }
      const rawData = zipBuffer.subarray(dataStart, dataEnd);
      if (compressionMethod === 0) {
        return Buffer.from(rawData);
      }
      if (compressionMethod === 8) {
        return zlib.inflateRawSync(rawData);
      }
      throw new Error(`Unsupported ZIP compression method (${compressionMethod}) for ${targetEntryName}.`);
    }

    cursor += 46 + fileNameLen + extraLen + commentLen;
  }

  throw new Error(`Invalid APK archive: ${targetEntryName} not found in archive.`);
}

function readUtf8Length(buf, offset) {
  const first = buf[offset];
  if ((first & 0x80) !== 0) {
    return { length: ((first & 0x7f) << 8) | buf[offset + 1], bytesRead: 2 };
  }
  return { length: first, bytesRead: 1 };
}

function readUtf16Length(buf, offset) {
  const first = buf.readUInt16LE(offset);
  if ((first & 0x8000) !== 0) {
    const second = buf.readUInt16LE(offset + 2);
    return { length: ((first & 0x7fff) << 16) | second, bytesRead: 4 };
  }
  return { length: first, bytesRead: 2 };
}

function parseStringPool(buf, chunkOffset) {
  const headerSize = buf.readUInt16LE(chunkOffset + 2);
  const stringCount = buf.readUInt32LE(chunkOffset + 8);
  const flags = buf.readUInt32LE(chunkOffset + 16);
  const stringsStart = buf.readUInt32LE(chunkOffset + 20);
  const isUtf8 = (flags & UTF8_FLAG) !== 0;

  const offsetsBase = chunkOffset + headerSize;
  const stringsDataBase = chunkOffset + stringsStart;
  const strings = new Array(stringCount);

  for (let i = 0; i < stringCount; i += 1) {
    const strRelOffset = buf.readUInt32LE(offsetsBase + i * 4);
    let pos = stringsDataBase + strRelOffset;
    if (isUtf8) {
      const charLenInfo = readUtf8Length(buf, pos);
      pos += charLenInfo.bytesRead;
      const byteLenInfo = readUtf8Length(buf, pos);
      pos += byteLenInfo.bytesRead;
      strings[i] = buf.subarray(pos, pos + byteLenInfo.length).toString('utf8');
    } else {
      const charLenInfo = readUtf16Length(buf, pos);
      pos += charLenInfo.bytesRead;
      strings[i] = buf.subarray(pos, pos + charLenInfo.length * 2).toString('utf16le');
    }
  }

  return strings;
}

export function parseBinaryAndroidManifest(axmlBuffer) {
  if (!Buffer.isBuffer(axmlBuffer) || axmlBuffer.length < 8) {
    throw new Error('Invalid AndroidManifest.xml: buffer too short.');
  }
  const xmlType = axmlBuffer.readUInt16LE(0);
  const xmlHeaderSize = axmlBuffer.readUInt16LE(2);
  const xmlTotalSize = axmlBuffer.readUInt32LE(4);
  if (xmlType !== RES_XML_TYPE || xmlTotalSize > axmlBuffer.length) {
    throw new Error('Invalid AndroidManifest.xml: unrecognized binary XML header.');
  }

  let strings = [];
  let resourceIds = [];
  let packageName = null;
  let versionCode = null;
  let versionName = null;
  let minSdkVersion = null;
  let targetSdkVersion = null;

  let offset = xmlHeaderSize;
  while (offset + 8 <= xmlTotalSize) {
    const chunkType = axmlBuffer.readUInt16LE(offset);
    const chunkHeaderSize = axmlBuffer.readUInt16LE(offset + 2);
    const chunkSize = axmlBuffer.readUInt32LE(offset + 4);
    if (chunkSize < 8 || offset + chunkSize > xmlTotalSize) {
      break;
    }

    if (chunkType === RES_STRING_POOL_TYPE) {
      strings = parseStringPool(axmlBuffer, offset);
    } else if (chunkType === RES_XML_RESOURCE_MAP_TYPE) {
      const count = Math.floor((chunkSize - chunkHeaderSize) / 4);
      resourceIds = new Array(count);
      for (let i = 0; i < count; i += 1) {
        resourceIds[i] = axmlBuffer.readUInt32LE(offset + chunkHeaderSize + i * 4);
      }
    } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
      const nameIdx = axmlBuffer.readInt32LE(offset + 20);
      const attrStart = axmlBuffer.readUInt16LE(offset + 24);
      const attrSize = axmlBuffer.readUInt16LE(offset + 26);
      const attrCount = axmlBuffer.readUInt16LE(offset + 28);
      const tagName = nameIdx >= 0 && nameIdx < strings.length ? strings[nameIdx] : '';
      const attrBase = offset + 16 + attrStart;

      if (tagName === 'manifest' || tagName === 'uses-sdk') {
        for (let i = 0; i < attrCount; i += 1) {
          const aOff = attrBase + i * attrSize;
          if (aOff + 20 > offset + chunkSize) break;
          const attrNameIdx = axmlBuffer.readInt32LE(aOff + 4);
          const rawValueIdx = axmlBuffer.readInt32LE(aOff + 8);
          const dataType = axmlBuffer.readUInt8(aOff + 15);
          const dataValue = axmlBuffer.readInt32LE(aOff + 16);

          const attrName = attrNameIdx >= 0 && attrNameIdx < strings.length ? strings[attrNameIdx] : '';
          const resId = attrNameIdx >= 0 && attrNameIdx < resourceIds.length ? resourceIds[attrNameIdx] : 0;
          const stringVal =
            rawValueIdx >= 0 && rawValueIdx < strings.length
              ? strings[rawValueIdx]
              : dataType === 0x03 && dataValue >= 0 && dataValue < strings.length
                ? strings[dataValue]
                : null;

          if (tagName === 'manifest') {
            if (attrName === 'package' && stringVal) {
              packageName = stringVal;
            } else if (resId === ATTR_VERSION_CODE || attrName === 'versionCode') {
              if (dataType === 0x10 || dataType === 0x11) {
                versionCode = dataValue;
              } else if (stringVal && /^\d+$/.test(stringVal)) {
                versionCode = Number.parseInt(stringVal, 10);
              }
            } else if (resId === ATTR_VERSION_NAME || attrName === 'versionName') {
              if (stringVal) {
                versionName = stringVal;
              }
            }
          } else if (tagName === 'uses-sdk') {
            if (resId === ATTR_MIN_SDK_VERSION || attrName === 'minSdkVersion') {
              if (dataType === 0x10 || dataType === 0x11) {
                minSdkVersion = dataValue;
              } else if (stringVal && /^\d+$/.test(stringVal)) {
                minSdkVersion = Number.parseInt(stringVal, 10);
              }
            } else if (resId === ATTR_TARGET_SDK_VERSION || attrName === 'targetSdkVersion') {
              if (dataType === 0x10 || dataType === 0x11) {
                targetSdkVersion = dataValue;
              }
            }
          }
        }
      }
    }

    offset += chunkSize;
  }

  return {
    packageName,
    versionCode,
    versionName,
    minSdkVersion,
    targetSdkVersion,
  };
}

export function readApkManifestFromBuffer(apkBuffer) {
  const axml = extractZipEntryFromBuffer(apkBuffer, 'AndroidManifest.xml');
  return parseBinaryAndroidManifest(axml);
}
