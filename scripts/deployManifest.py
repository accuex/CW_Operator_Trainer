#!/usr/bin/env python3
"""NUL-delimited deploy manifest: tracked + nonignored new files, never broad rsync."""
import argparse
from pathlib import Path
import subprocess
import sys

BLOCKED = {'docs', 'private', 'work', 'outputs', 'tmp', '.git', '.openai', '.claude', '.wrangler', '.codex', '.agents', '.history', '.next', '.vinext', 'dist', 'out', 'coverage', 'node_modules', 'vendor', '.vscode', '.ssh', '.aws', '__pycache__'}
RUNTIME_FILES = ['ecosystem.config.cjs', '.openai/hosting.json', 'app/styles/views/houki-kakomon.css', 'tooling/houki/dev-kakomon.mjs', 'lib/cardRarity.ts']
RUNTIME_GLOBS = ['app/dev/houki-kakomon/*', 'lib/houki/kakomon/*', 'public/assets/achievement_level/R*.png', 'private/houki-kakomon/sets/1sou-houki-*.json']


def permitted(path: str) -> bool:
    parts = Path(path).parts
    return not any(part in BLOCKED or part.startswith('.env') for part in parts) and not path.endswith(('.pem', '.key', '.tsbuildinfo', '.DS_Store', '.pyc', '.log'))


def collect(root: Path, area: str):
    raw = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    paths = {p.decode() for p in raw.split(b'\0') if p}
    paths = {p for p in paths if permitted(p) and (root / p).is_file() and not (root / p).is_symlink()}
    if area == 'api':
        return sorted(p[4:] for p in paths if p.startswith('api/') and not p.startswith('api/tests/'))
    paths = {p for p in paths if not p.startswith(('api/', 'bin/'))}
    # Existing build inputs that deliberately live outside Git. No broad private wildcard.
    for relative in RUNTIME_FILES:
        if (root / relative).is_file() and not (root / relative).is_symlink():
            paths.add(relative)
    for pattern in RUNTIME_GLOBS:
        for p in root.glob(pattern):
            if p.is_file() and not p.is_symlink():
                paths.add(p.relative_to(root).as_posix())
    return sorted(paths)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--area', choices=['app', 'api'], default='app')
    parser.add_argument('--print', action='store_true', dest='readable')
    args = parser.parse_args()
    paths = collect(args.root.resolve(), args.area)
    separator = '\n' if args.readable else '\0'
    sys.stdout.buffer.write((separator.join(paths) + separator).encode())
