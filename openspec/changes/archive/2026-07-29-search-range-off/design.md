## Context

See proposal.md - Why. Currently, the local datetime string from `<input type="datetime-local" />` is incorrectly appended with `:00Z`, forcing it to be parsed as UTC and causing a timezone offset shift.

## Goals / Non-Goals

**Goals:**
- Interpret range values as local time when querying the backend.
- Interpret range values as local time when computing epoch ms ranges for the visualizer.
- Ensure the changes do not break any existing history search filters.

**Non-Goals:**
- Modifying backend datetime parsing or database storage (the backend correctly processes UTC datetimes).
- Adding heavy third-party date libraries (like moment.js).

## Decisions

### 1. Native Date Parsing for Timezone Offset Correction
We will use native JavaScript `Date` constructor to parse the `datetime-local` input string.
- **Why**: Passing `"YYYY-MM-DDTHH:mm"` directly to `new Date()` parses it in the client's local timezone, returning the correct local point.
- **Formatting for API**: We then call `.toISOString()` on the Date object to get the corresponding UTC timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`), which we pass to the backend.
- **Formatting for Epoch MS**: We call `.getTime()` on the Date object to get the correct local epoch milliseconds.
- **Alternatives**: Manually parsing and adding timezone offsets. This was rejected because `new Date()` does this automatically and is less error-prone.

## Risks / Trade-offs

None.
