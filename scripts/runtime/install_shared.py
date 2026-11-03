"""Developer-owned AC7 provisioning: no sudo, no model weights loaded, no change to the app."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
SHARED = Path('/Users/Shared/Memoria')
PYTHON = Path('/opt/homebrew/bin/python3.11')
FFMPEG = Path('/opt/homebrew/bin/ffmpeg')


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def public_tree(root):
    # Never follow venv interpreter symlinks and chmod the Homebrew installation.
    for path in [root, *root.rglob('*')]:
        if not path.is_symlink():
            path.chmod(0o755 if path.is_dir() or path.stat().st_mode & 0o111 else 0o644)


def copy_if_changed(source, target):
    """Link the model file into the shared cache when both are on one volume (no second copy of
    several GB; the file is the same, made world-readable), else copy it."""
    source, target = Path(source).resolve(), Path(target)
    if target.is_symlink():
        raise ValueError(f'Refusing destination symlink: {target}')
    if target.is_file() and target.stat().st_ino == source.stat().st_ino:
        return str(target)
    if not target.is_file() or source.stat().st_size != target.stat().st_size or source.stat().st_mtime_ns != target.stat().st_mtime_ns:
        target.unlink(missing_ok=True)
        try:
            os.link(source, target)
        except OSError:
            shutil.copy2(source, target)
    return str(target)


def validate_snapshot(root, files):
    for name, size in files.items():
        path = root / name
        if not path.is_file() or path.stat().st_size != size:
            raise ValueError(f'Missing/incomplete model file: {path} (expected {size} bytes)')


def offline_requirements(text):
    # pip freeze preserves provenance URLs; offline pip must use cached wheels,
    # not retry those URLs. Exact installed versions are recorded here.
    direct_versions = {'mlx-audio': '0.6.3', 'en_core_web_sm': '3.8.0'}
    result = []
    for line in text.splitlines():
        if ' @ ' in line:
            name = line.split(' @ ', 1)[0]
            line = f'{name}=={direct_versions[name]}'
        result.append(line)
    return '\n'.join(result) + '\n'


def install_offline(interpreter, lock, wheelhouse):
    """Install the exact lock from the wheelhouse and pip's wheel cache, never from an index."""
    cache = Path(subprocess.check_output([str(PYTHON), '-m', 'pip', 'cache', 'dir'], text=True).strip())
    with tempfile.TemporaryDirectory(prefix='memoria-wheels-', dir=wheelhouse) as temporary:
        links = Path(temporary)
        for root in (wheelhouse, cache / 'wheels'):
            for wheel in root.rglob('*.whl'):
                if links not in wheel.parents:
                    link = links / wheel.name
                    if not link.exists():
                        link.symlink_to(wheel.resolve())
        requirements = links / 'requirements.txt'
        requirements.write_text(offline_requirements(lock.read_text()))
        try:
            run(interpreter, '-m', 'pip', 'install', '--no-deps', '--no-index', '--find-links', links, '-r', requirements)
        except subprocess.CalledProcessError:
            raise SystemExit('Offline wheels incomplete. Retry with --allow-downloads while online, supply --wheelhouse '
                             'with all pinned wheels, or use --copy-developer.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='read-only plan with exact snapshot sizes')
    parser.add_argument('--allow-downloads', action='store_true', help='allow pip to obtain missing wheels online')
    parser.add_argument('--copy-developer', action='store_true', help="copy the developer's working .speech-runtime/.embed-runtime packages (same interpreter) instead of installing wheels")
    parser.add_argument('--source-hf', type=Path, default=Path(os.environ.get('HF_HOME', str(Path.home() / '.cache/huggingface'))))
    parser.add_argument('--wheelhouse', type=Path, default=Path.home() / 'Library/Caches/Memoria/wheels', help='persistent wheel cache, outside the shared install')
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.error('Run as the developer, not sudo/root.')
    models = json.loads((HERE / 'models.json').read_text())
    total = 0
    for model in models:
        relative = Path('hub') / ('models--' + model['repo'].replace('/', '--'))
        source = args.source_hf / relative / 'snapshots' / model['revision']
        validate_snapshot(source, model['files'])
        size = sum(model['files'].values())
        total += size
        print(f"COPY {model['repo']} @ {model['revision']}: {len(model['files'])} files, {size:,} bytes ({size / 1024**3:.2f} GiB)", flush=True)
        print(f'  {source} -> {SHARED / "hf" / relative / "snapshots" / model["revision"]}', flush=True)
    for kind in ('speech', 'embed'):
        lock = HERE / f'{kind}-requirements.txt'
        count = len(lock.read_text().splitlines())
        print(f'CREATE/VERIFY {SHARED / "runtime" / kind}: {PYTHON} -m venv; {count} frozen packages from {lock.name}', flush=True)
    print(f'Total model copy: {total:,} bytes ({total / 1024**3:.2f} GiB); venv/package disk usage additional (not estimated).', flush=True)
    print(f'Pip mode: {"online allowed, existing pip cache reused" if args.allow_downloads else "offline only, wheelhouse + existing pip wheel cache"}; wheelhouse: {args.wheelhouse}', flush=True)
    print('VERIFY imports only (no weights); chmod directories/executables 755, files 644; publish completion markers last.', flush=True)
    if args.dry_run:
        print('DRY RUN: no directories/files created, packages installed, weights loaded or permissions changed.')
        return
    os.umask(0o077)
    # An untrusted user must not be able to replace files executed by another account.
    # Shared artifacts are developer-owned, never world/group-writable.
    for path in [SHARED, *SHARED.rglob('*')] if SHARED.exists() else []:
        if path.is_symlink() and (path == SHARED or path.is_dir() or 'runtime' not in path.relative_to(SHARED).parts):
            raise ValueError(f'Refusing shared symlink: {path}')
        if path.lstat().st_uid != os.getuid():
            raise ValueError(f'Not owned by current developer: {path}')
    if not FFMPEG.is_file():
        raise ValueError('Install shared Homebrew ffmpeg before provisioning (brew install ffmpeg).')
    SHARED.mkdir(parents=True, exist_ok=True)
    SHARED.chmod(0o755)
    args.wheelhouse.mkdir(parents=True, exist_ok=True)
    for kind in ('speech', 'embed'):
        base = SHARED / 'runtime' / kind
        marker = base / '.memoria-complete'
        lock = HERE / f'{kind}-requirements.txt'
        signature = hashlib.sha256(lock.read_bytes()).hexdigest()
        complete = (marker.exists() and marker.read_text().strip() == signature
                    and (base / 'bin/python').is_file() and (base / 'pyvenv.cfg').is_file())
        marker.unlink(missing_ok=True)
        if not complete:
            # A changed lock or interrupted install must not retain old packages
            # (pip otherwise treats damaged .dist-info as already installed).
            if base.exists():
                shutil.rmtree(base)
            developer = HERE.parents[1] / f'.{kind}-runtime'
            # The developer speech runtime layers its packages over Homebrew's shared site-packages
            # (readable by every account); mirror that so the same imports resolve.
            layered = args.copy_developer and 'include-system-site-packages = true' in (developer / 'pyvenv.cfg').read_text()
            run(PYTHON, '-m', 'venv', *(['--system-site-packages'] if layered else []), base)
            interpreter = base / 'bin/python'
            if args.copy_developer:
                # Same Homebrew interpreter, so the installed packages are reused as they are, without
                # an index (the configured package mirror lacks some pinned wheels).
                source = developer / 'lib' / 'python3.11' / 'site-packages'
                if not source.is_dir():
                    raise SystemExit(f'No developer runtime at {source}')
                run('rsync', '-a', '--delete', f'{source}/', f'{base}/lib/python3.11/site-packages/')
            elif args.allow_downloads:
                # This consults pip's HTTP cache too. Download/build once, install
                # from wheels afterwards; direct URLs remain pinned in the lock.
                # Reproduce the complete freeze, not a fresh dependency solve:
                # speech's pinned mlx-audio metadata requests newer MLX and
                # Transformers than the developer's working installed versions.
                run(interpreter, '-m', 'pip', 'wheel', '--no-deps', '-r', lock, '--wheel-dir', args.wheelhouse)
            if not args.copy_developer:
                install_offline(interpreter, lock, args.wheelhouse)
        modules = ('mlx.core, mlx_lm, mlx_audio.stt, resemblyzer, soundfile, huggingface_hub' if kind == 'speech'
                   else 'mlx.core, mlx_vlm.embedding_loader, transformers, huggingface_hub')
        env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', PYTHONDONTWRITEBYTECODE='1')
        check_voice = ("; from pathlib import Path; assert (Path(resemblyzer.__file__).parent / 'pretrained.pt').is_file(), 'Missing packaged voice encoder'"
                       if kind == 'speech' else '')
        run(base / 'bin/python', '-c', f'import {modules}{check_voice}; print("{kind}: imports OK (no weights loaded)")', env=env)
        public_tree(base)
        marker.write_text(signature + '\n')
        marker.chmod(0o644)
    home = SHARED / 'hf'
    home.mkdir(exist_ok=True)
    marker = home / '.memoria-complete'
    marker.unlink(missing_ok=True)
    for model in models:
        relative = Path('hub') / ('models--' + model['repo'].replace('/', '--'))
        source = args.source_hf / relative / 'snapshots' / model['revision']
        target = home / relative / 'snapshots' / model['revision']
        # Copy only the locked snapshot files, dereferencing HF blob symlinks.
        # Nothing in the result points back into the developer's home directory.
        for name in model['files']:
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            copy_if_changed(source / name, destination)
        validate_snapshot(target, model['files'])
        refs = home / relative / 'refs'
        refs.mkdir(exist_ok=True)
        (refs / 'main').write_text(model['revision'])
    public_tree(home)
    marker.write_text(hashlib.sha256((HERE / 'models.json').read_bytes()).hexdigest() + '\n')
    marker.chmod(0o644)
    public_tree(SHARED / 'runtime')
    print('Shared runtime ready. No app was launched and no model weights were loaded.')


if __name__ == '__main__':
    main()
