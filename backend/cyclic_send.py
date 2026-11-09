"""Delayed and cyclic send-to-bus jobs (#167).

Multiple jobs may run at once (one per Write-to-bus panel row): each has an
optional one-shot delay before the first send, then optionally repeats at a
fixed interval until cancelled. Jobs live in memory only and do not survive
restarts.
"""

import asyncio
import contextlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import knx_daemon

logger = logging.getLogger("cyclic_send")


@dataclass
class SendJob:
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    state: str = "waiting"  # waiting | running | done | cancelled | failed
    address: str = ""
    payload: Any = None
    dpt: str | None = None
    response: bool = False
    delay_seconds: float = 0.0
    interval_seconds: float | None = None
    sends_done: int = 0
    sends_skipped: int = 0
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    next_send_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "state": self.state,
            "address": self.address,
            "payload": self.payload,
            "dpt": self.dpt,
            "response": self.response,
            "delay_seconds": self.delay_seconds,
            "interval_seconds": self.interval_seconds,
            "sends_done": self.sends_done,
            "sends_skipped": self.sends_skipped,
            "started_at": self.started_at.isoformat(),
            "next_send_at": self.next_send_at.isoformat() if self.next_send_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "error": self.error,
        }


# Active + recently finished jobs, keyed by job id.
jobs: dict[str, SendJob] = {}
_tasks: dict[str, asyncio.Task] = {}


async def _attempt_send(job: SendJob) -> None:
    """Send one telegram; skip (but keep the job alive) while the bus is unavailable."""
    if not knx_daemon.write_enabled():
        job.sends_skipped += 1
        logger.warning(f"Skipping scheduled send to {job.address}: bus not writable")
        return
    await knx_daemon.send_group_value(job.address, job.payload, job.dpt, job.response)
    job.sends_done += 1


async def _run_job(job: SendJob) -> None:
    try:
        if job.delay_seconds > 0:
            job.next_send_at = datetime.now(UTC) + timedelta(seconds=job.delay_seconds)
            await asyncio.sleep(job.delay_seconds)
        job.state = "running"
        while True:
            job.next_send_at = None
            await _attempt_send(job)
            if job.interval_seconds is None:
                job.state = "done"
                return
            job.next_send_at = datetime.now(UTC) + timedelta(seconds=job.interval_seconds)
            await asyncio.sleep(job.interval_seconds)
    except asyncio.CancelledError:
        job.state = "cancelled"
        raise
    except Exception as e:
        logger.error(f"Scheduled send to {job.address} failed: {e}")
        job.state = "failed"
        job.error = str(e)
    finally:
        job.finished_at = datetime.now(UTC)
        job.next_send_at = None
        _tasks.pop(job.id, None)


def start_send(
    address: str,
    payload: Any,
    dpt: str | None,
    response: bool,
    delay_seconds: float,
    interval_seconds: float | None,
) -> SendJob:
    """Starts a background delayed/cyclic send. Multiple jobs may run concurrently."""
    job = SendJob(
        address=address,
        payload=payload,
        dpt=dpt,
        response=response,
        delay_seconds=delay_seconds,
        interval_seconds=interval_seconds,
    )
    jobs[job.id] = job
    _tasks[job.id] = asyncio.get_running_loop().create_task(_run_job(job))
    return job


def cancel_send(job_id: str) -> bool:
    """Cancels the scheduled send with the given id. Returns False if none active."""
    job = jobs.get(job_id)
    if job is None or job.state not in ("waiting", "running"):
        return False
    task = _tasks.get(job_id)
    if task is not None and not task.done():
        task.cancel()
        return True
    return False


def cancel_all_sends() -> int:
    """Cancels every waiting/running scheduled send. Returns how many were cancelled."""
    cancelled = 0
    for job in list_active_jobs():
        if cancel_send(job.id):
            cancelled += 1
    return cancelled


def list_active_jobs() -> list[SendJob]:
    """Jobs currently waiting or running."""
    return [j for j in jobs.values() if j.state in ("waiting", "running")]


def get_job(job_id: str) -> SendJob | None:
    return jobs.get(job_id)


async def shutdown() -> None:
    """Cancels and awaits every job task on application shutdown."""
    active = [t for t in _tasks.values() if not t.done()]
    for task in active:
        task.cancel()
    for task in active:
        with contextlib.suppress(asyncio.CancelledError):
            await task
