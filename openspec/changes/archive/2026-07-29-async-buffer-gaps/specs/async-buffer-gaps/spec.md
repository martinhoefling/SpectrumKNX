## Purpose

This capability defines the synchronization between the IndexedDB persistent telegram cache and the coverage tracking system, as well as the behavior of the background history loader under buffer capacity pressure.

## ADDED Requirements

### Requirement: Synchronized Cache Coverage Ingestion
The system SHALL ensure that a time interval is marked as covered in the coverage tracker and persisted to local storage only after the telegrams within that interval have been successfully written to the IndexedDB persistent cache.

#### Scenario: Successful database write
- **WHEN** live or fetched telegrams are successfully written to the IndexedDB persistent cache
- **THEN** the corresponding time range is marked as covered in the coverage tracker and saved to local storage

#### Scenario: Failed database write
- **WHEN** a batch of telegrams fails to write to the IndexedDB persistent cache
- **THEN** the corresponding time range MUST NOT be marked as covered in the coverage tracker

### Requirement: Continuous History Paging and Eviction
The system SHALL continue paging backward and loading historical telegrams for a requested range even when the in-memory buffer is at maximum capacity. It must evict the oldest entries to maintain size limits while ensuring that the requested range is successfully filled and marked as covered.

#### Scenario: Load range on full buffer
- **WHEN** a user loads history for a specific range and the in-memory buffer is full
- **THEN** the history loader continues fetching and merging all chunks for that range, evicting older/newer entries to stay within the buffer limit rather than breaking out early
