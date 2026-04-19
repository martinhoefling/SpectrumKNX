import time
from datetime import UTC, datetime, timedelta


def run_benchmark():
    # Setup
    now = datetime.now(UTC)
    matching_timestamps = [now + timedelta(seconds=i) for i in range(100)]
    all_context_rows = [{"timestamp": now + timedelta(seconds=i/10)} for i in range(10000)]
    delta_before_ms = 500
    delta_after_ms = 500

    matching_ts_set = set(t.replace(tzinfo=None) if t.tzinfo else t for t in matching_timestamps)

    def is_in_delta_old(row_ts):
        ts = row_ts.replace(tzinfo=None) if hasattr(row_ts, 'tzinfo') and row_ts.tzinfo else row_ts
        for mts in matching_ts_set:
            mts_naive = mts.replace(tzinfo=None) if hasattr(mts, 'tzinfo') and mts.tzinfo else mts
            diff_ms = (ts - mts_naive).total_seconds() * 1000
            if -delta_before_ms <= diff_ms <= delta_after_ms:
                return True
        return False

    start_time = time.time()
    for _ in range(10):
        _ = [r for r in all_context_rows if is_in_delta_old(r["timestamp"])]
    end_time = time.time()
    old_duration = end_time - start_time
    print(f"Old implementation: {old_duration:.4f} seconds")

    def is_in_delta_new(row_ts):
        ts = row_ts.replace(tzinfo=None) if hasattr(row_ts, 'tzinfo') and row_ts.tzinfo else row_ts
        for mts in matching_ts_set:
            diff_ms = (ts - mts).total_seconds() * 1000
            if -delta_before_ms <= diff_ms <= delta_after_ms:
                return True
        return False

    start_time = time.time()
    for _ in range(10):
        _ = [r for r in all_context_rows if is_in_delta_new(r["timestamp"])]
    end_time = time.time()
    new_duration = end_time - start_time
    print(f"New implementation: {new_duration:.4f} seconds")
    print(f"Improvement: {(old_duration - new_duration) / old_duration * 100:.2f}%")

if __name__ == "__main__":
    run_benchmark()
