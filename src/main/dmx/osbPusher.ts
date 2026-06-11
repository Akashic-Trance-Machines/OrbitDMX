/**
 * osbPusher.ts — Upload a compiled .osb to OrbitBridgeDeck over CDC
 *
 * Uses the Enttec Pro framing format with custom labels (0x90–0x96) to stream
 * the binary show down the existing USB cable. Works alongside normal DMX
 * traffic — the OBD firmware interleaves show upload packets with DMX frames.
 *
 * Protocol flow:
 *   1. SHOW_BEGIN  (0x90) → name, size, version, CRC
 *   2. SHOW_CHUNK  (0x91) × N → offset + data blocks
 *   3. SHOW_COMMIT (0x92) → firmware validates CRC → writes to flash
 *   4. Wait for SHOW_ACK (0x96) → OK / CRC_FAIL / FLASH_ERROR / SIZE_ERROR
 */

// Label constants (matching show_format.h)
const SHOW_LABEL_BEGIN   = 0x90;
const SHOW_LABEL_CHUNK   = 0x91;
const SHOW_LABEL_COMMIT  = 0x92;
const SHOW_LABEL_INFO    = 0x93;
const SHOW_LABEL_ACK     = 0x96;

// ACK status codes
const SHOW_ACK_OK        = 0x00;
const SHOW_ACK_CRC_FAIL  = 0x01;
const SHOW_ACK_FLASH_ERR = 0x02;
const SHOW_ACK_SIZE_ERR  = 0x03;

// Chunk size for SHOW_CHUNK packets (fits well within CDC packet limits)
const CHUNK_SIZE = 256;

// ============================================================================
// Enttec framing helper
// ============================================================================

/**
 * Wrap a payload in Enttec Pro framing: [0x7E][label][len_lsb][len_msb][data...][0xE7]
 */
function enttecFrame(label: number, data: Uint8Array): Uint8Array {
  const len = data.length;
  const frame = new Uint8Array(4 + len + 1);
  frame[0] = 0x7E;
  frame[1] = label;
  frame[2] = len & 0xFF;
  frame[3] = (len >> 8) & 0xFF;
  frame.set(data, 4);
  frame[4 + len] = 0xE7;
  return frame;
}

/** Compute CRC32 (IEEE 802.3, zlib-compatible). */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & (-(crc & 1)));
    }
  }
  return (~crc) >>> 0;
}

// ============================================================================
// Show info response
// ============================================================================

export interface ShowInfo {
  name: string;
  size: number;
  bpmCenti: number;
  versionMajor: number;
  versionMinor: number;
}

// ============================================================================
// Upload result
// ============================================================================

export type UploadResult = 'ok' | 'crc_fail' | 'flash_error' | 'size_error' | 'timeout' | 'error';

// ============================================================================
// Serial port abstraction (passed by the caller)
// ============================================================================

/**
 * Minimal interface for a serial port — the caller provides an object that
 * can write data and read responses. This decouples the pusher from the
 * specific serial library (serialport, WebUSB, etc.)
 */
export interface SerialPortLike {
  write(data: Uint8Array): Promise<void>;
  read(timeout: number): Promise<Uint8Array | null>;
}

// ============================================================================
// Push API
// ============================================================================

/**
 * Upload a compiled .osb to OBD over the serial port.
 *
 * @param osbData    The compiled .osb binary (from compileShow)
 * @param port       Serial port interface
 * @param onProgress Optional callback for upload progress (0.0–1.0)
 * @returns          Upload result status
 */
export async function pushShowToDevice(
  osbData: Uint8Array,
  port: SerialPortLike,
  onProgress?: (progress: number) => void,
): Promise<UploadResult> {
  const totalSize = osbData.length;

  // Extract the CRC from the last 4 bytes of the .osb
  const crcOffset = totalSize - 4;
  const osbCrc = new DataView(osbData.buffer, osbData.byteOffset + crcOffset, 4).getUint32(0, true);

  // Extract the show name from the header (bytes 12–43)
  const nameBytes = osbData.slice(12, 44);
  const nameEnd = nameBytes.indexOf(0);
  const showName = new TextDecoder().decode(nameBytes.slice(0, nameEnd >= 0 ? nameEnd : 32));

  // Extract version from header
  const versionMajor = osbData[4];
  const versionMinor = osbData[5];

  // ── Step 1: SHOW_BEGIN ──
  // Payload: name[32] + total_size[4] + format_ver_major[1] + format_ver_minor[1] + crc32[4] = 42 bytes
  const beginPayload = new Uint8Array(42);
  beginPayload.set(nameBytes, 0);  // name[32]
  const beginView = new DataView(beginPayload.buffer);
  beginView.setUint32(32, totalSize, true);    // total_size
  beginPayload[36] = versionMajor;              // format_ver_major
  beginPayload[37] = versionMinor;              // format_ver_minor
  beginView.setUint32(38, osbCrc, true);       // crc32

  await port.write(enttecFrame(SHOW_LABEL_BEGIN, beginPayload));

  // Wait for ACK
  const beginAck = await waitForAck(port);
  if (beginAck !== 'ok') return beginAck;

  onProgress?.(0);

  // ── Step 2: SHOW_CHUNK × N ──
  let offset = 0;
  while (offset < totalSize) {
    const chunkLen = Math.min(CHUNK_SIZE, totalSize - offset);
    // Payload: offset[4] + chunk_data[chunkLen]
    const chunkPayload = new Uint8Array(4 + chunkLen);
    const chunkView = new DataView(chunkPayload.buffer);
    chunkView.setUint32(0, offset, true);
    chunkPayload.set(osbData.slice(offset, offset + chunkLen), 4);

    await port.write(enttecFrame(SHOW_LABEL_CHUNK, chunkPayload));

    // Wait for ACK after each chunk
    const chunkAck = await waitForAck(port);
    if (chunkAck !== 'ok') return chunkAck;

    offset += chunkLen;
    onProgress?.(offset / totalSize);
  }

  // ── Step 3: SHOW_COMMIT ──
  await port.write(enttecFrame(SHOW_LABEL_COMMIT, new Uint8Array(0)));

  // Wait for final ACK (longer timeout — flash write takes ~10–30 ms)
  const commitAck = await waitForAck(port, 5000);
  if (commitAck !== 'ok') return commitAck;

  onProgress?.(1.0);
  return 'ok';
}

/**
 * Query the currently stored show info on OBD.
 *
 * @param port  Serial port interface
 * @returns     Show info, or null if no show is stored
 */
export async function queryShowInfo(
  port: SerialPortLike,
): Promise<ShowInfo | null> {
  await port.write(enttecFrame(SHOW_LABEL_INFO, new Uint8Array(0)));

  // Wait for SHOW_INFO response
  const resp = await port.read(3000);
  if (!resp) return null;

  // Parse the response (40 bytes inside an Enttec frame)
  const payload = extractEnttecPayload(resp, SHOW_LABEL_INFO);
  if (!payload || payload.length < 40) return null;

  const nameBytes = payload.slice(0, 32);
  const nameEnd = nameBytes.indexOf(0);
  const name = new TextDecoder().decode(nameBytes.slice(0, nameEnd >= 0 ? nameEnd : 32));

  const view = new DataView(payload.buffer, payload.byteOffset);
  const size = view.getUint32(32, true);
  const bpmCenti = view.getUint16(36, true);
  const vMajor = payload[38];
  const vMinor = payload[39];

  if (size === 0) return null;  // No show stored

  return { name, size, bpmCenti, versionMajor: vMajor, versionMinor: vMinor };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Wait for a SHOW_ACK (label 0x96) response from OBD.
 */
async function waitForAck(port: SerialPortLike, timeout = 2000): Promise<UploadResult> {
  const resp = await port.read(timeout);
  if (!resp) return 'timeout';

  const payload = extractEnttecPayload(resp, SHOW_LABEL_ACK);
  if (!payload || payload.length < 1) return 'error';

  switch (payload[0]) {
    case SHOW_ACK_OK:        return 'ok';
    case SHOW_ACK_CRC_FAIL:  return 'crc_fail';
    case SHOW_ACK_FLASH_ERR: return 'flash_error';
    case SHOW_ACK_SIZE_ERR:  return 'size_error';
    default:                 return 'error';
  }
}

/**
 * Extract the data payload from an Enttec-framed response.
 * Returns null if the frame is malformed or the label doesn't match.
 */
function extractEnttecPayload(frame: Uint8Array, expectedLabel: number): Uint8Array | null {
  // Find the start byte
  let start = -1;
  for (let i = 0; i < frame.length; i++) {
    if (frame[i] === 0x7E) { start = i; break; }
  }
  if (start < 0 || start + 4 >= frame.length) return null;

  const label = frame[start + 1];
  if (label !== expectedLabel) return null;

  const len = frame[start + 2] | (frame[start + 3] << 8);
  if (start + 4 + len >= frame.length) return null;

  if (frame[start + 4 + len] !== 0xE7) return null;

  return frame.slice(start + 4, start + 4 + len);
}
