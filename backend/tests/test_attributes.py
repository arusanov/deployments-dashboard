import pytest
from pydantic import ValidationError

from app.attributes import decode_attributes
from app.models import Deployment
from tests.conftest import RecordFactory


def test_stored_attribute_keys_are_unique(record: RecordFactory) -> None:
    entries = [{"k": "team", "v": "payments"}, {"k": "team", "v": "platform"}]
    with pytest.raises(ValueError, match="keys must be unique"):
        decode_attributes(entries)
    with pytest.raises(ValidationError, match="keys must be unique"):
        Deployment.model_validate(record(attrs=entries))


def test_stored_attribute_limit(record: RecordFactory) -> None:
    with pytest.raises(ValidationError, match="at most 100"):
        Deployment.model_validate(record(attributes={str(i): "v" for i in range(101)}))
