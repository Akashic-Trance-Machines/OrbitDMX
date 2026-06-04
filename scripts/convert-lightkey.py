#!/usr/bin/env python3
"""
convert-lightkey.py — Convert Lightkey .lightkeyfxt fixture files to OrbitDMX rig JSON.

Lightkey fixture files are Apple binary plists using NSKeyedArchive encoding.
This script decodes the archive, resolves UID references to reconstruct the
object graph (personalities → capabilities → channels), and maps Lightkey
capability classes to OrbitDMX channel types.

Usage:
    python3 scripts/convert-lightkey.py <file_or_dir> [--outdir src/fixtures] [--dry-run]

Examples:
    # Convert a single file
    python3 scripts/convert-lightkey.py "scripts/Fun Generation - PartyPAR 12 DMX.lightkeyfxt"

    # Convert all .lightkeyfxt files in a directory
    python3 scripts/convert-lightkey.py scripts/lightkey-downloads/ --outdir src/fixtures
"""

import argparse
import json
import os
import plistlib
import re
import sys
from pathlib import Path


# ─── Lightkey class name → OrbitDMX channel type ─────────────────────────────

# Classes that carry a 'componentName' parameter (the name determines the type)
COLOR_COMPONENT_MAP = {
    'red':        'red',
    'green':      'green',
    'blue':       'blue',
    'white':      'white',
    'warm white': 'white',
    'cool white': 'white',
    'amber':      'amber',
    'uv':         'uv',
}

# Classes where the class name alone determines the type (no params needed)
CLASS_TYPE_MAP = {
    'LXIntensityCapability':       'dimmer',
    'LXShutterStrobeCapability':   'strobe',
    'LXPanCapability':             'pan',
    'LXTiltCapability':            'tilt',
    'LXPanFineCapability':         'pan-fine',
    'LXTiltFineCapability':        'tilt-fine',
    'LXPanTiltSpeedCapability':    'speed',
    'LXColorWheelCapability':      'color-wheel',
    'LXGoboWheelCapability':       'gobo',
    'LXGoboRotationCapability':    'gobo-rotation',
    'LXPrismCapability':           'prism',
    'LXFocusCapability':           'focus',
    'LXZoomCapability':            'zoom',
    'LXFrostCapability':           'frost',
    'LXIrisCapability':            'iris',
    'LXSpeedCapability':           'speed',
    'LXMacroCapability':           'macro',
}


# ─── NSKeyedArchive helpers ──────────────────────────────────────────────────

def uid_val(uid) -> int:
    """Extract the integer index from a plistlib.UID object."""
    if isinstance(uid, plistlib.UID):
        return uid.data if hasattr(uid, 'data') else int(uid)
    if isinstance(uid, int):
        return uid
    if isinstance(uid, dict):
        return uid.get('CF$UID', 0)
    return 0


def resolve(objects: list, uid) -> object:
    """Resolve a UID to the actual object in the $objects array."""
    idx = uid_val(uid)
    if 0 <= idx < len(objects):
        return objects[idx]
    return None


def get_class_name(objects: list, obj: dict) -> str:
    """Get the Objective-C class name for an archived object."""
    cls_ref = obj.get('$class')
    if cls_ref is None:
        return ''
    cls_obj = resolve(objects, cls_ref)
    if isinstance(cls_obj, dict):
        return cls_obj.get('$classname', '')
    return ''


def resolve_array(objects: list, uid) -> list:
    """Resolve a UID to an NSArray/NSMutableArray/NSSet and return its items."""
    arr = resolve(objects, uid)
    if isinstance(arr, dict) and 'NS.objects' in arr:
        return arr['NS.objects']
    return []


def resolve_dict(objects: list, uid) -> dict:
    """Resolve a UID to an NSDictionary and return it as a Python dict."""
    d = resolve(objects, uid)
    if isinstance(d, dict) and 'NS.keys' in d:
        keys = [resolve(objects, k) for k in d['NS.keys']]
        vals = [resolve(objects, v) for v in d['NS.objects']]
        return dict(zip(keys, vals))
    return {}


# ─── Capability decoder ─────────────────────────────────────────────────────

def decode_capability(objects: list, cap_uid) -> dict | None:
    """
    Decode an LXCapability object into an OrbitDMX channel definition.

    Returns dict with: offset, name, type, minValue, maxValue, defaultValue
    """
    cap = resolve(objects, cap_uid)
    if not isinstance(cap, dict) or 'channel' not in cap:
        return None

    offset = cap['channel']
    class_name = get_class_name(objects, cap)

    # Custom name override (Lightkey lets you name a channel)
    custom_name_uid = cap.get('customName')
    custom_name = resolve(objects, custom_name_uid) if custom_name_uid else None
    if custom_name == '$null' or custom_name is None:
        custom_name = None

    # Resolve settings to find componentName or other params
    settings_items = resolve_array(objects, cap.get('settings'))
    params = {}
    for setting_uid in settings_items:
        setting = resolve(objects, setting_uid)
        if isinstance(setting, dict):
            # An LXSetting has $0 (range array) and params (dict)
            setting_params_uid = setting.get('params')
            if setting_params_uid:
                p = resolve_dict(objects, setting_params_uid)
                params.update(p)

    # Determine channel type and name
    channel_type = 'other'
    channel_name = custom_name or class_name.replace('LX', '').replace('Capability', '')

    if class_name == 'LXColorComponentCapability':
        comp = params.get('componentName', '').lower()
        channel_type = COLOR_COMPONENT_MAP.get(comp, 'other')
        channel_name = custom_name or params.get('componentName', channel_name)
    elif class_name in CLASS_TYPE_MAP:
        channel_type = CLASS_TYPE_MAP[class_name]
        # Use the class-derived name unless there's a custom override
        if not custom_name:
            channel_name = channel_type.replace('-', ' ').title()
    elif class_name == 'LXCustomCapability':
        # Try to infer from settings
        setting_name = params.get('name', '')
        if setting_name:
            channel_name = custom_name or setting_name
        
        # Ensure channel_name is a string before calling lower
        if isinstance(channel_name, dict):
            channel_name = str(channel_name.get('name', channel_name))
        elif not isinstance(channel_name, str):
            channel_name = str(channel_name)

        # Try to detect common custom types
        name_lower = channel_name.lower()
        if 'gobo' in name_lower:
            channel_type = 'gobo'
        elif 'speed' in name_lower:
            channel_type = 'speed'
        elif 'macro' in name_lower or 'color macro' in name_lower:
            channel_type = 'macro'
        elif 'strobe' in name_lower:
            channel_type = 'strobe'
        elif 'dimmer' in name_lower or 'intensity' in name_lower:
            channel_type = 'dimmer'
        else:
            channel_type = 'other'

    return {
        'offset': offset,
        'name': channel_name,
        'type': channel_type,
        'minValue': 0,
        'maxValue': 255,
        'defaultValue': 0,
    }


# ─── Main converter ─────────────────────────────────────────────────────────

def convert_lightkey(filepath: str) -> dict | None:
    """
    Convert a .lightkeyfxt file to an OrbitDMX rig definition dict.
    Returns None if the file cannot be parsed.
    """
    with open(filepath, 'rb') as f:
        try:
            data = plistlib.load(f)
        except Exception as e:
            print(f'  ✗ Failed to parse plist: {e}', file=sys.stderr)
            return None

    objects = data.get('$objects', [])
    if not objects:
        print(f'  ✗ No $objects in archive', file=sys.stderr)
        return None

    # Find the root object (fixtureProfile)
    top = data.get('$top', {})
    root_uid = top.get('root') or top.get('fixtureProfile')
    root = resolve(objects, root_uid) if root_uid else None

    # Fallback: scan for LXFixtureProfile
    if not isinstance(root, dict) or 'name' not in root:
        for obj in objects:
            if isinstance(obj, dict) and 'name' in obj and 'manufacturer' in obj:
                root = obj
                break

    if root is None:
        print(f'  ✗ Could not find fixture profile root', file=sys.stderr)
        return None

    # Extract metadata
    name = resolve(objects, root.get('name', ''))
    manufacturer = resolve(objects, root.get('manufacturer', ''))
    if name == '$null':
        name = ''
    if manufacturer == '$null':
        manufacturer = ''

    # Extract personalities
    personality_uids = resolve_array(objects, root.get('personalities'))
    personalities = []

    for p_uid in personality_uids:
        p = resolve(objects, p_uid)
        if not isinstance(p, dict) or 'footprint' not in p:
            continue

        footprint = p['footprint']
        cap_uids = resolve_array(objects, p.get('capabilities'))

        channels = []
        for cap_uid in cap_uids:
            ch = decode_capability(objects, cap_uid)
            if ch is not None:
                channels.append(ch)

        # Sort by channel offset
        channels.sort(key=lambda c: c['offset'])

        personality_name = f'{footprint}-channel mode'

        personalities.append({
            'name': personality_name,
            'channelCount': footprint,
            'channels': channels,
        })

    if not personalities:
        print(f'  ✗ No personalities found', file=sys.stderr)
        return None

    # Sort personalities by channel count
    personalities.sort(key=lambda p: p['channelCount'])

    # Pick the largest personality as default
    default_personality = personalities[-1]['name']

    # Build the rig definition
    rig_id = f'{manufacturer} {name}'.strip()

    return {
        'id': rig_id,
        'brand': manufacturer,
        'model': name,
        'defaultPersonality': default_personality,
        'personalities': personalities,
    }


def slugify(text: str) -> str:
    """Convert a fixture name to a filesystem-friendly slug."""
    s = text.lower().strip()
    s = re.sub(r'[°×·]', '', s)               # remove special chars
    s = re.sub(r'[^a-z0-9]+', '-', s)          # non-alphanum → hyphen
    s = re.sub(r'-+', '-', s)                  # collapse runs
    s = s.strip('-')
    return s


def main():
    parser = argparse.ArgumentParser(
        description='Convert Lightkey .lightkeyfxt files to OrbitDMX rig JSON'
    )
    parser.add_argument(
        'input',
        help='Path to a .lightkeyfxt file or directory containing them'
    )
    parser.add_argument(
        '--outdir',
        default='src/fixtures',
        help='Output directory for JSON files (default: src/fixtures)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Print JSON to stdout instead of writing files'
    )
    args = parser.parse_args()

    # Collect input files
    input_path = Path(args.input)
    if input_path.is_dir():
        files = sorted(input_path.glob('*.lightkeyfxt'))
    elif input_path.is_file():
        files = [input_path]
    else:
        print(f'Error: {args.input} not found', file=sys.stderr)
        sys.exit(1)

    if not files:
        print(f'No .lightkeyfxt files found in {args.input}', file=sys.stderr)
        sys.exit(1)

    outdir = Path(args.outdir)
    if not args.dry_run:
        outdir.mkdir(parents=True, exist_ok=True)

    converted = 0
    failed = 0

    for fpath in files:
        print(f'Converting: {fpath.name}')
        rig = convert_lightkey(str(fpath))

        if rig is None:
            failed += 1
            continue

        slug = slugify(f'{rig["brand"]}-{rig["model"]}')
        json_str = json.dumps(rig, indent=2, ensure_ascii=False) + '\n'

        if args.dry_run:
            print(json_str)
        else:
            out_file = outdir / f'{slug}.json'
            out_file.write_text(json_str, encoding='utf-8')
            n_pers = len(rig['personalities'])
            n_ch = rig['personalities'][-1]['channelCount']
            print(f'  ✓ {out_file}  ({n_pers} personalities, up to {n_ch}ch)')

        converted += 1

    print(f'\nDone: {converted} converted, {failed} failed, {len(files)} total')


if __name__ == '__main__':
    main()
