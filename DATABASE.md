# MongoDB indexes and performance

Each deployment stores its attributes as a key/value array in the same document.
Explicit preparation creates
ten indexes, including `_id`; [models.py](backend/app/models.py) defines them.

## Indexes

| Index                                            | Count | Purpose                                |
| ------------------------------------------------ | ----: | -------------------------------------- |
| `_id`                                            |     1 | MongoDB identity                       |
| Unique `deployment_id`                           |     1 | Public identity and conditional writes |
| `(deleted_at ASC, field ASC, deployment_id ASC)` |     7 | Active browsing in either direction    |
| TTL on `deleted_at`                              |     1 | Cleanup after thirty days              |

Browse fields: `created_at`, `updated_at`, `name_sort`, `status`, `type`,
`environment`, `created_by`. Active queries fix `deleted_at` to null. ID ties follow
the primary direction, so reversing an index serves descending order too.
`name_sort` is maintained on writes. Indexes trade storage and write work for ordered reads.
TTL cleanup is asynchronous; [API predicates enforce expiry](DECISIONS.md#recovery-and-preparation).

## Performance

Row limits and virtualization bound fetched/rendered rows, not scans or bytes.
Substring search on `attrs.v` avoids map conversion but still scans. No attribute
index is added for this case-insensitive, unanchored search. Combined filters and
Trash may need extra filtering/sorting.
Full attribute maps increase transfer and memory costs, and polling repeats reads.
Large valid maps can hit memory or timeout limits. No latency or capacity guarantee
is claimed; assess representative data and concurrent viewers before expanding the workload.
