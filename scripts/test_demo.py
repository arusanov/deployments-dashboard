"""Exercise demo command ordering and failures without touching Docker resources."""

import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
FAKE = """#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["COMMAND_LOG"], "a") as log:
    log.write(json.dumps({"args": args, "project": os.environ["COMPOSE_PROJECT_NAME"],
                         "profiles": os.environ["COMPOSE_PROFILES"]}) + "\\n")
if os.environ.get("INTERRUPT_AT") in args:
    Path(os.environ["INTERRUPT_READY"]).touch()
    time.sleep(30)
if os.environ.get("FAIL_AT") in args:
    sys.exit(23)
"""


class DemoTests(unittest.TestCase):
    def run_case(self, *args, fail="", interrupt=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            docker = root / "docker"
            docker.write_text(FAKE)
            docker.chmod(0o755)
            log = root / "commands.jsonl"
            ready = root / "ready"
            env = dict(
                os.environ,
                PATH=str(root) + os.pathsep + os.environ["PATH"],
                COMMAND_LOG=str(log),
                FAIL_AT=fail,
                INTERRUPT_AT="seed" if interrupt else "",
                INTERRUPT_READY=str(ready),
                COMPOSE_PROJECT_NAME="demo-disposable",
                COMPOSE_FILE="unrelated.yml",
                COMPOSE_PROFILES="tools",
            )
            process = subprocess.Popen(
                ["bash", str(ROOT / "scripts/demo.sh"), *args],
                cwd=root,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                if interrupt:
                    deadline = time.monotonic() + 10
                    while (
                        not ready.exists()
                        and process.poll() is None
                        and time.monotonic() < deadline
                    ):
                        time.sleep(0.02)
                    self.assertTrue(ready.exists())
                    process.send_signal(interrupt)
                output, _ = process.communicate(timeout=15)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
            entries = (
                [json.loads(line) for line in log.read_text().splitlines()]
                if log.exists()
                else []
            )
            commands = []
            for entry in entries:
                command = entry["args"]
                self.assertEqual(entry["project"], "demo-disposable")
                self.assertEqual(entry["profiles"], "")
                self.assertEqual(
                    command[:5],
                    [
                        "compose",
                        "--project-directory",
                        str(ROOT),
                        "-f",
                        str(ROOT / "docker-compose.yml"),
                    ],
                )
                self.assertNotIn("down", command)
                self.assertNotIn("--volumes", command)
                commands.append(command[5:])
            return process.returncode, commands, output

    def test_start_and_reset(self):
        for args in ((), ("--reset",)):
            with self.subTest(args=args):
                status, commands, output = self.run_case(*args)
                self.assertEqual(status, 0, output)
                self.assertEqual(
                    commands,
                    [
                        ["stop", "frontend", "backend"],
                        [
                            "run",
                            "--build",
                            "--rm",
                            "seed",
                            "python",
                            "/seed/seed.py",
                            *args,
                        ],
                        ["run", "--build", "--rm", "backend-init"],
                        ["up", "--build", "-d", "--wait"],
                    ],
                )

    def test_failure_stops_the_sequence(self):
        for fail, count in (
            ("stop", 1),
            ("seed", 2),
            ("backend-init", 3),
            ("up", 4),
            ("--build", 2),
        ):
            with self.subTest(fail=fail):
                status, commands, output = self.run_case(fail=fail)
                self.assertEqual(status, 23, output)
                self.assertEqual(len(commands), count)

    def test_interruption_stops_before_preparation_and_startup(self):
        for signum in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signum=signum):
                status, commands, output = self.run_case(interrupt=signum)
                self.assertEqual(status, 128 + signum, output)
                self.assertEqual(len(commands), 2)

    def test_invalid_arguments_touch_nothing(self):
        for args in (("--unknown",), ("--reset", "extra")):
            with self.subTest(args=args):
                status, commands, _ = self.run_case(*args)
                self.assertEqual(status, 2)
                self.assertEqual(commands, [])


if __name__ == "__main__":
    unittest.main()
