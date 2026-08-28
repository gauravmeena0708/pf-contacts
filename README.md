# PF Directory

PF Directory is an unofficial, community-maintained directory of Employees'
Provident Fund Organisation (EPFO) offices and publicly listed officials across
India. It provides a searchable web interface, an interactive map, and a
versioned static JSON API.

**Live site:** <https://gauravmeena0708.github.io/pf-contacts/>

> [!IMPORTANT]
> This project is not affiliated with or endorsed by EPFO. Contact information
> can change; confirm time-sensitive details on the
> [official EPFO website](https://www.epfindia.gov.in/).

## Features

- Search by office, city, official, designation, PIN code, or phone number.
- Browse the normalized Head, Zonal, Regional, and District Office hierarchy.
- View mapped offices and find nearby locations using browser geolocation.
- Explore mainland coverage and potential service gaps in the coverage planner.
- Consume office and official data through a versioned, read-only JSON API.
- Refresh source data automatically through a guarded weekly GitHub Actions job.

The current generated API contains 325 canonical offices and 1,684 publicly
listed officials. Current counts and content hashes are available in
[`api/v1/manifest.json`](api/v1/manifest.json).

## Run locally

The website is static, but its JavaScript fetches local JSON files. Serve the
repository over HTTP instead of opening `index.html` directly:

```bash
git clone https://github.com/gauravmeena0708/pf-contacts.git
cd pf-contacts
python -m http.server 8000
```

Then open <http://localhost:8000/>.

The main pages are:

- `/` — searchable contact directory and map
- `/planner.html` — geographic coverage analyzer
- `/privacy_policy.html` — privacy information
- `/api/v1/manifest.json` — static API discovery document

## Static API

The API is published from `api/v1` and requires no application server or
database. Its production base URL is:

```text
https://gauravmeena0708.github.io/pf-contacts/api/v1
```

For example:

```js
const response = await fetch(
  "https://gauravmeena0708.github.io/pf-contacts/api/v1/offices.json",
);
const { offices } = await response.json();
```

See [API.md](API.md) for the endpoint reference, data semantics, examples, and
compatibility policy.

## Data pipeline

The source dataset is scraped from EPFO's public office-wise contact directory.
The pipeline has safeguards to avoid replacing good data with a degraded scrape:

1. `fetch.py` retrieves and parses public contact records.
2. The scraper checks fetch failures, record-count drops, and error rates before
   atomically replacing `contacts-data.json`.
3. `scripts/build_api.py` deduplicates and normalizes records, assigns stable
   identifiers, resolves the hierarchy, and writes `api/v1`.
4. The test suite validates counts, identifiers, hierarchy integrity, category
   summaries, detail resources, and the published JSON Schema.

The scheduled workflow runs every Monday and commits only validated changes.
Geocoding is handled separately by a manually triggered workflow so contact-data
updates are not blocked by geocoding services.

## Development

Python 3.10 or newer is recommended.

```bash
python -m pip install -r requirements.txt
python scripts/build_api.py
python -m unittest discover -s tests -p "test_*.py"
```

The API builder itself uses only the Python standard library. `jsonschema` is
used by the test suite, while the remaining dependencies support scraping and
geocoding.

To refresh the upstream contact snapshot manually:

```bash
python fetch.py
python scripts/build_api.py
python -m unittest discover -s tests -p "test_*.py"
```

Scraping depends on the current structure and availability of EPFO's website.
Review generated changes before committing them.

## Repository layout

```text
.
|-- index.html                 Main directory interface
|-- planner.html               Coverage-analysis interface
|-- common.js                  Shared data and rendering helpers
|-- tokens.css                 Shared design tokens and styles
|-- contacts-data.json         Raw scraped contact snapshot
|-- geocodes.json              Office coordinate lookup
|-- api/v1/                    Generated versioned static API
|-- scripts/build_api.py       API normalization and build script
|-- tests/test_static_api.py   Static API contract tests
|-- fetch.py                   EPFO contact scraper
|-- geocode_data.py            Nominatim geocoding utility
|-- geocode_mappls.py          Mappls geocoding utility
`-- .github/workflows/         Scheduled and manual data workflows
```

## Contributing

Bug reports and focused pull requests are welcome. For data corrections, include
the corresponding official EPFO source where possible. Do not add private or
unpublished personal information.

Before opening a pull request, rebuild the API and run the complete test suite.
Generated API changes should be committed together with their source-data change.

## Privacy and data use

The directory republishes contact information that EPFO lists publicly. Search
runs locally in the browser. The interactive map uses OpenStreetMap tiles, and
the nearby-office feature requests browser location only after user interaction.
See the [privacy policy](privacy_policy.html) for details.

## License

This project is available under the [MIT License](LICENSE).
