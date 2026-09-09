"""Failure-path checks for the verification runner; no Docker daemon required."""

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

RUNNER = Path(__file__).with_name("verify.py")
FAKE = """#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["COMMAND_LOG"], "a") as log:
    log.write(json.dumps([Path(sys.argv[0]).name] + args) + "\\n")
if "down" in args:
    sys.exit(int(os.environ.get("CLEANUP_FAILURE", "0")))
if os.environ.get("INTERRUPT_AT") in args:
    Path(os.environ["INTERRUPT_READY"]).touch()
    time.sleep(60)
if os.environ.get("FAIL_AT") in args:
    sys.exit(23)
"""


class VerificationTests(unittest.TestCase):
    def run_case(self, mode="backend", *, fail="", cleanup="0", interrupt=""):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            for name in ("docker", "npm", "npx"):
                path = bin_dir / name
                path.write_text(FAKE)
                path.chmod(0o755)
            log = root / "commands.jsonl"
            ready = root / "interrupt-ready"
            env = dict(
                os.environ,
                PATH=str(bin_dir) + os.pathsep + os.environ["PATH"],
                TMPDIR=str(root),
                COMMAND_LOG=str(log),
                FAIL_AT=fail,
                CLEANUP_FAILURE=cleanup,
                INTERRUPT_AT=interrupt,
                INTERRUPT_READY=str(ready),
                COMPOSE_PROJECT_NAME="unrelated",
                COMPOSE_FILE="unrelated.yml",
                COMPOSE_PROFILES="unrelated",
            )
            process = subprocess.Popen(
                [sys.executable, str(RUNNER), mode],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            if interrupt:
                deadline = time.monotonic() + 15
                while (
                    not ready.exists()
                    and process.poll() is None
                    and time.monotonic() < deadline
                ):
                    time.sleep(0.02)
                self.assertTrue(ready.exists())
                process.send_signal(signal.SIGINT)
            output, _ = process.communicate(timeout=30)
            commands = [json.loads(line) for line in log.read_text().splitlines()]
            docker = [command for command in commands if command[0] == "docker"]
            self.assertEqual(sum("down" in command for command in docker), 1, output)
            projects = {
                command[command.index("--project-name") + 1] for command in docker
            }
            self.assertEqual(len(projects), 1)
            self.assertTrue(next(iter(projects)).startswith(f"deployments-{mode}-"))
            for command in docker:
                self.assertNotIn("unrelated", command)
                self.assertEqual(command.count("-f"), 3 if mode == "frontend" else 2)
            retained = list(root.glob(f"deployments-{mode}-*"))
            self.assertEqual(bool(retained), process.returncode != 0, output)
            if retained:
                self.assertTrue((retained[0] / "compose.log").exists())
            return process.returncode, output

    def test_success(self):
        self.assertEqual(self.run_case()[0], 0)

    def test_test_failure(self):
        self.assertEqual(self.run_case(fail="pytest")[0], 23)

    def test_build_failure(self):
        self.assertEqual(self.run_case("frontend", fail="build")[0], 23)

    def test_port_startup_failure(self):
        self.assertEqual(self.run_case("frontend", fail="up")[0], 23)

    def test_interruption(self):
        self.assertEqual(self.run_case(interrupt="pytest")[0], 130)

    def test_cleanup_failure_after_success(self):
        status, output = self.run_case(cleanup="17")
        self.assertEqual(status, 1)
        self.assertIn("Cleanup failed", output)

    def test_cleanup_preserves_original_failure(self):
        self.assertEqual(self.run_case(fail="pytest", cleanup="17")[0], 23)


if __name__ == "__main__":
    unittest.main()
