// Minimal `gi://GLib` stand-in so the shell-free modules (emojiModule,
// store, transforms) can be imported and tested under plain Node. Only the
// surface those modules actually touch is implemented.
import { createHash } from 'node:crypto';

export class Variant {
    constructor(type, value) { this.type = type; this.value = value; }
    deep_unpack() { return this.value; }
    is_of_type() { return true; }
}

function sha256(str) { return createHash('sha256').update(str, 'utf8').digest('hex'); }

export const ChecksumType = { SHA256: 1 };
export const PRIORITY_DEFAULT = 0;
export const PRIORITY_DEFAULT_IDLE = 200;
export const SOURCE_REMOVE = false;
export const SOURCE_KEEP = true;
export const USEC_PER_SEC = 1000000;

export function compute_checksum_for_string(_type, str) { return sha256(str); }
export function compute_checksum_for_bytes(_type, bytes) { return sha256(String(bytes)); }
export function build_filenamev(parts) { return parts.join('/'); }
export function get_user_config_dir() { return '/tmp/cliplet-test-config'; }
export function get_monotonic_time() { return Number(process.hrtime.bigint() / 1000n); }
export function timeout_add(_p, _ms, cb) { cb(); return 1; }
export function timeout_add_seconds(_p, _s, cb) { cb(); return 1; }
export function idle_add(_p, cb) { cb(); return 1; }
export function source_remove() {}
export function getenv() { return null; }
export function file_get_contents() { throw new Error('stub: no filesystem in GLib stub'); }
export function file_set_contents() { throw new Error('stub: no filesystem in GLib stub'); }
export function path_get_dirname(p) { return p.split('/').slice(0, -1).join('/'); }
export function find_program_in_path() { return null; }

export default {
    Variant, ChecksumType, PRIORITY_DEFAULT, PRIORITY_DEFAULT_IDLE,
    SOURCE_REMOVE, SOURCE_KEEP, USEC_PER_SEC,
    compute_checksum_for_string, compute_checksum_for_bytes,
    build_filenamev, get_user_config_dir, get_monotonic_time,
    timeout_add, timeout_add_seconds, idle_add, source_remove, getenv,
    file_get_contents, file_set_contents, path_get_dirname, find_program_in_path,
};
