## Why

When performing a historical telegram search with a custom date range, the datetime-local input yields values in the user's local timezone. Currently, the application appends `:00Z` to these inputs, treating them as UTC and causing the queried range to be offset by the user's timezone difference (e.g., 2 hours off in CEST). The application needs to correctly interpret custom absolute start/end times in the local timezone and convert them to UTC before querying the backend.

## What Changes

- **Frontend URL Builder**: Update `buildHistoryUrl` in `frontend/src/utils/historyLoad.ts` to parse the selected local datetimes in local time and convert them to UTC ISO strings.
- **Frontend Range to Epoch MS**: Update `rangeToMs` in `frontend/src/utils/historyLoad.ts` to parse local datetimes as local time and return the correct epoch milliseconds.
- **Tests**: Add/update tests to verify that local datetimes are correctly mapped to UTC and epoch milliseconds.

## Capabilities

### New Capabilities
- `search-range-timezone`: Ensures date-range searches in the history loader correctly honor the user's local timezone.

### Modified Capabilities
<!-- None -->

## Impact

- `frontend/src/utils/historyLoad.ts`: `buildHistoryUrl` and `rangeToMs` functions.
- `frontend/src/utils/historyLoad.test.ts` (or similar): Range parsing and API URL builder tests.
