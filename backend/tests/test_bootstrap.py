from pathlib import Path

import pytest
from pydantic import ValidationError

from app.bootstrap import bootstrap_database, ensure_cursor_secret
from app.config import Settings
from app.init_db import prepare
from app.models import Database
from tests.conftest import SECRET, RecordFactory


def test_secret_survives_bootstrap_and_loads_from_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "cursor_secret"
    ensure_cursor_secret(path)
    original = path.read_bytes()
    ensure_cursor_secret(path)
    assert path.read_bytes() == original
    monkeypatch.delenv("CURSOR_SECRET", raising=False)
    monkeypatch.setenv("CURSOR_SECRET_FILE", str(path))
    settings = Settings()
    assert settings.cursor_secret.get_secret_value() == original.decode()
    assert len(original) >= 32


def test_environment_secret_takes_precedence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CURSOR_SECRET", SECRET)
    monkeypatch.setenv("CURSOR_SECRET_FILE", "/nonexistent/secret")
    assert Settings().cursor_secret.get_secret_value() == SECRET


def test_invalid_existing_secret_is_not_rotated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "cursor_secret"
    path.write_text("short", encoding="utf-8")
    ensure_cursor_secret(path)
    monkeypatch.delenv("CURSOR_SECRET", raising=False)
    monkeypatch.setenv("CURSOR_SECRET_FILE", str(path))
    with pytest.raises(ValidationError):
        Settings()
    assert path.read_text(encoding="utf-8") == "short"


async def test_bootstrap_prepares_new_database_once(db: Database) -> None:
    await db.dataset.drop()
    await db.deployments.drop()
    await bootstrap_database(db)
    assert len(await db.deployments.index_information()) == 10
    before = await db.dataset.find_one({})
    await bootstrap_database(db)
    assert await db.dataset.find_one({}) == before
    assert await db.deployments.count_documents({}) == 0
    assert (
        "deleted_at_1_name_sort_1_deployment_id_1"
        in await db.deployments.index_information()
    )


async def test_preparation_never_changes_records(
    db: Database, record: RecordFactory
) -> None:
    await db.deployments.insert_one(record())
    before = await db.deployments.find_one({})
    await prepare(db)
    assert await db.deployments.find_one({}) == before


async def test_bootstrap_rejects_missing_required_indexes(db: Database) -> None:
    await db.deployments.drop_index("deleted_at_1_name_sort_1_deployment_id_1")
    with pytest.raises(RuntimeError, match="Required indexes are missing"):
        await bootstrap_database(db)
    assert (
        "deleted_at_1_name_sort_1_deployment_id_1"
        not in await db.deployments.index_information()
    )
