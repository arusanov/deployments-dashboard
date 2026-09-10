#!/usr/bin/env python3
"""Run checks against a uniquely owned, disposable Compose stack."""

import argparse
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("backend", "frontend"))
    parser.add_argument("--api-port", type=int, default=18000)
    parser.add_argument("--frontend-port", type=int, default=3001)
    parser.add_argument("--image-port", type=int, default=13000)
    args = parser.parse_args()
    ports = (args.api_port, args.frontend_port, args.image_port)
    if any(port < 1 or port > 65535 for port in ports) or len(set(ports)) != 3:
        parser.error("ports must be distinct integers between 1 and 65535")

    workspace = Path(tempfile.mkdtemp(prefix=f"deployments-{args.mode}-"))
    project = workspace.name.lower().replace("_", "-")
    env = dict(os.environ)
    # Explicit files/project and no inherited profiles or interpolation overrides.
    for key in list(env):
        if key.startswith("COMPOSE_"):
            del env[key]
    env.update(
        TEST_API_PORT=str(args.api_port),
        TEST_FRONTEND_PORT=str(args.frontend_port),
        TEST_IMAGE_PORT=str(args.image_port),
        NEXT_PUBLIC_API_BASE_URL=f"http://localhost:{args.api_port}",
        TEST_API_URL=f"http://localhost:{args.api_port}",
    )
    compose = [
        "docker",
        "compose",
        "--project-name",
        project,
        "--env-file",
        os.devnull,
        "-f",
        str(ROOT / "docker-compose.yml"),
        "-f",
        str(ROOT / "docker-compose.test.yml"),
    ]
    if args.mode == "frontend":
        compose += ["-f", str(ROOT / "docker-compose.frontend-test.yml")]
    status = 0
    child = None

    def interrupted(signum, _frame):
        nonlocal status
        status = 128 + signum
        if child is not None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        raise KeyboardInterrupt

    def run(command, cwd=ROOT):
        nonlocal child
        print("+ " + " ".join(map(str, command)), flush=True)
        child = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
        try:
            result = child.wait()
        finally:
            if child.poll() is None:
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            child = None
        if result:
            raise subprocess.CalledProcessError(result, command)

    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    print(f"Disposable project: {project}\nWorkspace/reports: {workspace}", flush=True)
    try:
        run(compose + ["run", "--build", "--rm", "seed"])
        run(compose + ["up", "--build", "-d", "--wait", "backend"])
        if args.mode == "backend":
            checks = [
                ["ruff", "check", ".", "/seed/seed.py"],
                ["ruff", "format", "--check", ".", "/seed/seed.py"],
                ["mypy"],
                ["pyright"],
                ["pytest"],
            ]
            for check in checks:
                run(
                    compose
                    + [
                        "run",
                        "--rm",
                        "--no-deps",
                        "-e",
                        "TEST_MONGO_URI=mongodb://mongodb:27017",
                        "-e",
                        "TEST_API_URL=http://backend:8000",
                        "-e",
                        "TEST_API_ALLOW_MUTATIONS=1",
                        "seed",
                    ]
                    + check
                )
        else:
            frontend = workspace / "frontend"
            shutil.copytree(
                ROOT / "frontend",
                frontend,
                ignore=shutil.ignore_patterns(
                    "node_modules",
                    ".next",
                    ".env*",
                    "test-results",
                    "playwright-report",
                    "*.tsbuildinfo",
                ),
            )
            (workspace / "backend").mkdir()
            shutil.copy2(
                ROOT / "backend/openapi.json", workspace / "backend/openapi.json"
            )
            shutil.copy2(ROOT / ".gitignore", workspace / ".gitignore")
            run(["npm", "ci"], frontend)
            for check in (
                "lint",
                "format:check",
                "typecheck",
                "knip",
                "test",
                "api:check",
                "build",
            ):
                run(["npm", "run", check], frontend)
            run(["npx", "playwright", "install", "chromium"], frontend)
            run(["npm", "run", "test:e2e"], frontend)
            run(
                compose
                + [
                    "--profile",
                    "frontend-image",
                    "up",
                    "--build",
                    "-d",
                    "--wait",
                    "frontend",
                ]
            )
    except subprocess.CalledProcessError as exc:
        status = exc.returncode if exc.returncode > 0 else 128 - exc.returncode
    except KeyboardInterrupt:
        status = status or 130
    except (OSError, shutil.Error) as exc:
        print(exc, file=sys.stderr)
        status = 1
    finally:
        # A second interrupt must not prevent cleanup of our own project.
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            with (workspace / "compose.log").open("w") as log:
                subprocess.run(
                    compose + ["logs", "--no-color"],
                    env=env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    check=False,
                )
            cleanup = subprocess.run(
                compose
                + [
                    "--profile",
                    "frontend-image",
                    "--profile",
                    "tools",
                    "down",
                    "--volumes",
                    "--remove-orphans",
                    "--rmi",
                    "local",
                ],
                env=env,
                check=False,
            ).returncode
        except OSError as exc:
            print(exc, file=sys.stderr)
            cleanup = 1
        if cleanup:
            print(
                f"Cleanup failed for {project}; retry the printed Compose command with down --volumes.",
                file=sys.stderr,
            )
            status = status or 1
        if status:
            print(
                f"Verification failed ({status}); reports retained at {workspace}",
                file=sys.stderr,
            )
        else:
            shutil.rmtree(workspace)
            print("Verification passed; disposable resources removed.")
    return status


if __name__ == "__main__":
    sys.exit(main())
