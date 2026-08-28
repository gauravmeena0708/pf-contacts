# EPFO Contacts static API

This repository publishes a versioned, read-only JSON API alongside the existing
GitHub Pages site. The API is generated from `contacts-data.json`; it does not
require a Python web server or database.

## Base URL

When GitHub Pages is configured to publish the repository root from `main`, the
base URL is:

```text
https://gauravmeena0708.github.io/pf-contacts/api/v1
```

For local development, serve the repository root with any static web server and
use `/api/v1` as the base path.

## Endpoints

| Resource | Purpose |
| --- | --- |
| `manifest.json` | API/data versions, hashes, counts and endpoint discovery |
| `offices.json` | All normalized office-level records; no named officials |
| `offices/{id}.json` | One office and its named officials |
| `officials.json` | Named officials linked to offices by `office_id` |
| `hierarchy.json` | Parent/child office tree |
| `categories.json` | Available categories and their record counts |
| `schema.json` | JSON Schema for an office record |

GitHub Pages serves static files, so query parameters are not evaluated on the
server. Download `offices.json` once and filter it in the consuming application.

## Data semantics

- `id` is a stable, URL-safe identifier generated from the source office identity.
  Once published, the builder reuses it while the same source key remains present.
- `source_key` preserves the source directory query key.
- `parent_id` and `ancestor_ids` describe the normalized hierarchy.
- `coordinates` are derived from the best available geocode. Many records use
  a verified postal-code centroid and should be treated as approximate rather
  than as a precise building entrance.
- `contact.emails` contains only email addresses published for the office itself.
- Named officials and their contact details are deliberately excluded from the
  main office list. They are available through `officials.json` and individual
  office resources.
- The API does not invent missing office email addresses. A consumer may derive a
  login identifier such as `do.amravati@epfindia.gov.in`, but must not represent it
  as a verified contact address unless EPFO publishes it.
- Exact duplicate scrape records are removed. The manifest reports the raw count,
  canonical count and number of duplicates removed.

## Examples

JavaScript:

```js
const base = 'https://gauravmeena0708.github.io/pf-contacts/api/v1';
const response = await fetch(`${base}/offices.json`);
const payload = await response.json();
const districtOffices = payload.offices.filter(
  office => office.category === 'district_office',
);
```

PHP/Laravel:

```php
$base = 'https://gauravmeena0708.github.io/pf-contacts/api/v1';
$manifest = Http::timeout(20)->retry(3, 500)->get("{$base}/manifest.json")->throw()->json();
$offices = Http::timeout(30)->retry(3, 500)->get("{$base}/offices.json")->throw()->json('offices');
```

Python:

```python
import requests

base = "https://gauravmeena0708.github.io/pf-contacts/api/v1"
offices = requests.get(f"{base}/offices.json", timeout=30).json()["offices"]
```

Consumers should cache the dataset and compare `manifest.json`'s `data_version`
or `source_sha256` before importing it again. Applications should use their local
database during normal requests instead of calling this API on every page load.

## Building locally

```text
python -m pip install -r requirements.txt
python scripts/build_api.py
python -m unittest discover -s tests -p "test_*.py"
```

The builder itself has no third-party dependencies. The test suite uses
`jsonschema` to validate every generated office against the published contract.
The builder reuses `generated_at` when the source files have not changed, so
no-change builds remain reproducible.

## Compatibility policy

Fields will not be removed or reinterpreted within `/api/v1`. Additive fields may
be introduced. A breaking contract change will be published under `/api/v2`.
