"""Store attributes as key/value pairs so user keys never become MongoDB field paths."""

from collections.abc import Mapping
from typing import TypedDict

from pydantic import TypeAdapter


class StoredAttribute(TypedDict):
    k: str
    v: str


_stored_attributes = TypeAdapter(list[StoredAttribute])


def encode_attributes(attributes: Mapping[str, str]) -> list[StoredAttribute]:
    return [{"k": key, "v": value} for key, value in attributes.items()]


def decode_attributes(value: object) -> dict[str, str]:
    entries = _stored_attributes.validate_python(value)
    attributes = {entry["k"]: entry["v"] for entry in entries}
    if len(attributes) != len(entries):
        msg = "Stored attribute keys must be unique"
        raise ValueError(msg)
    return attributes
