"""Seed sample deployments explicitly, with the API stopped.

Run from backend/: uv run --env-file .env python ../seed/seed.py
"""

import argparse
import os
import random
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, get_args

from faker import Faker
from pymongo import MongoClient

from app.attributes import encode_attributes
from app.models import INDEXES, Deployment, DeploymentType, Environment, Status

fake = Faker()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB", "deployments")
COLLECTION_NAME = "deployments"

NUM_DEPLOYMENTS = 5000

STATUSES = list(get_args(Status))
STATUS_WEIGHTS = [0.6, 0.15, 0.25]

TYPES = list(get_args(DeploymentType))
TYPE_WEIGHTS = [0.5, 0.3, 0.2]

ENVIRONMENTS = list(get_args(Environment))
ENV_WEIGHTS = [0.4, 0.35, 0.25]

TEAM_NAMES = [
    "payments",
    "checkout",
    "identity",
    "platform",
    "data-pipeline",
    "notifications",
    "search",
    "analytics",
    "onboarding",
    "billing",
    "infrastructure",
    "ml-ops",
    "content",
    "marketplace",
    "security",
]

SERVICE_PREFIXES = [
    "api",
    "worker",
    "gateway",
    "proxy",
    "scheduler",
    "processor",
    "indexer",
    "aggregator",
    "dispatcher",
    "monitor",
    "collector",
    "transformer",
    "validator",
    "exporter",
    "importer",
]

SERVICE_SUFFIXES = [
    "service",
    "handler",
    "engine",
    "daemon",
    "relay",
    "bridge",
    "adapter",
    "connector",
    "runner",
    "agent",
]

ATTRIBUTE_PROBABILITIES = {
    "description": 0.7,
    "region": 0.5,
    "language": 0.3,
    "framework": 0.2,
    "priority": 0.4,
    "oncall": 0.25,
}

CREATORS = [fake.email() for _ in range(30)]


def generate_service_name() -> str:
    prefix = random.choice(SERVICE_PREFIXES)
    suffix = random.choice(SERVICE_SUFFIXES)
    domain = random.choice([
        "auth",
        "user",
        "order",
        "payment",
        "inventory",
        "catalog",
        "shipping",
        "email",
        "sms",
        "log",
        "metric",
        "event",
        "cache",
        "session",
        "config",
        "feature-flag",
        "rate-limit",
        "webhook",
    ])
    patterns = [
        f"{domain}-{prefix}",
        f"{domain}-{suffix}",
        f"{prefix}-{domain}-{suffix}",
        f"{domain}-{prefix}-{suffix}",
    ]
    return random.choice(patterns)


def generate_version() -> str:
    major = random.randint(0, 5)
    minor = random.randint(0, 20)
    patch = random.randint(0, 50)
    return f"{major}.{minor}.{patch}"


def generate_attributes() -> dict[str, str]:
    attrs = {}

    attrs["name"] = generate_service_name()

    if random.random() < ATTRIBUTE_PROBABILITIES["description"]:
        attrs["description"] = fake.sentence(nb_words=random.randint(4, 12))

    attrs["team"] = random.choice(TEAM_NAMES)

    if random.random() < ATTRIBUTE_PROBABILITIES["region"]:
        attrs["region"] = random.choice([
            "us-east-1",
            "us-west-2",
            "eu-west-1",
            "ap-southeast-1",
        ])

    if random.random() < ATTRIBUTE_PROBABILITIES["language"]:
        attrs["language"] = random.choice([
            "python",
            "typescript",
            "go",
            "java",
            "rust",
        ])

    if random.random() < ATTRIBUTE_PROBABILITIES["framework"]:
        attrs["framework"] = random.choice([
            "fastapi",
            "express",
            "gin",
            "spring",
            "actix",
        ])

    if random.random() < ATTRIBUTE_PROBABILITIES["priority"]:
        attrs["priority"] = random.choice(["critical", "high", "medium", "low"])

    if random.random() < ATTRIBUTE_PROBABILITIES["oncall"]:
        attrs["oncall"] = fake.email()

    return attrs


def generate_deployment() -> dict[str, Any]:
    created_at = fake.date_time_between(
        start_date="-2y",
        end_date="now",
        tzinfo=UTC,
    )

    updated_at = created_at + timedelta(
        seconds=random.randint(0, int((datetime.now(UTC) - created_at).total_seconds()))
    )

    attributes = generate_attributes()
    record = {
        "deployment_id": str(uuid.uuid4()),
        "version": generate_version(),
        "status": random.choices(STATUSES, weights=STATUS_WEIGHTS, k=1)[0],
        "type": random.choices(TYPES, weights=TYPE_WEIGHTS, k=1)[0],
        "environment": random.choices(ENVIRONMENTS, weights=ENV_WEIGHTS, k=1)[0],
        "attrs": encode_attributes(attributes),
        "name_sort": attributes.get("name", "").lower(),
        "revision": 1,
        "created_at": created_at,
        "created_by": random.choice(CREATORS),
        "updated_at": updated_at,
        "deleted_at": None,
    }

    Deployment.model_validate(record)
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed with the API stopped.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Erase existing data and dataset metadata",
    )
    args = parser.parse_args()
    with MongoClient[dict[str, Any]](
        MONGO_URI, serverSelectionTimeoutMS=5000
    ) as client:
        db = client[DB_NAME]
        collection = db[COLLECTION_NAME]

        existing = collection.count_documents({})
        if existing and not args.reset:
            print(f"{existing} deployments already present; skipping seed.")
            return
        if args.reset:
            collection.drop()
            # Preparation assigns a new generation, invalidating pre-reset cursors.
            db.dataset.drop()
        print(f"Generating {NUM_DEPLOYMENTS} deployments...")

        deployments = [generate_deployment() for _ in range(NUM_DEPLOYMENTS)]
        collection.insert_many(deployments)
        print(
            f"Inserted {NUM_DEPLOYMENTS} deployments into {DB_NAME}.{COLLECTION_NAME}"
        )

        collection.create_indexes(INDEXES)
        sample = collection.find_one()
        print(f"\nSample record:\n{sample}")


if __name__ == "__main__":
    main()
