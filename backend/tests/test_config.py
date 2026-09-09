from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings
from tests.conftest import SECRET

pytestmark = pytest.mark.usefixtures("isolated_settings")


@pytest.fixture
def isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setitem(Settings.model_config, "env_file", tmp_path / ".env")
    monkeypatch.delenv("CURSOR_SECRET", raising=False)
    monkeypatch.delenv("CURSOR_SECRET_FILE", raising=False)


@pytest.mark.parametrize("environment_override", [False, True])
def test_secret_file_from_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, environment_override: bool
) -> None:
    path = tmp_path / "secret"
    path.write_text(f"  {SECRET}\n", encoding="utf-8")
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text(
        f"CURSOR_SECRET_FILE={'missing' if environment_override else path}\n",
        encoding="utf-8",
    )
    if environment_override:
        monkeypatch.setenv("CURSOR_SECRET_FILE", str(path))
    settings = Settings()
    assert settings.cursor_secret_file == path
    assert settings.cursor_secret.get_secret_value() == SECRET


@pytest.mark.parametrize("source", ["dotenv", "environment"])
def test_direct_secret_precedes_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, source: str
) -> None:
    (tmp_path / ".env").write_text(
        f"CURSOR_SECRET_FILE=missing\nCURSOR_SECRET={SECRET}\n",
        encoding="utf-8",
    )
    expected = SECRET
    if source == "environment":
        expected = SECRET + "-environment"
        monkeypatch.setenv("CURSOR_SECRET", expected)
    assert Settings().cursor_secret.get_secret_value() == expected


@pytest.mark.parametrize("value", ["", "short", " " * 40])
def test_invalid_file_secret(tmp_path: Path, value: str) -> None:
    path = tmp_path / "secret"
    path.write_text(value, encoding="utf-8")
    with pytest.raises(ValidationError):
        Settings(cursor_secret_file=path)


@pytest.mark.parametrize("value", ["", "short"])
def test_invalid_direct_secret_does_not_fall_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    path = tmp_path / "secret"
    path.write_text(SECRET, encoding="utf-8")
    monkeypatch.setenv("CURSOR_SECRET", value)
    with pytest.raises(ValidationError):
        Settings(cursor_secret_file=path)


def test_missing_secret() -> None:
    with pytest.raises(ValueError, match="Set CURSOR_SECRET or CURSOR_SECRET_FILE"):
        Settings()
