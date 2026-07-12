"""Delayed and cyclic send-to-bus jobs (#167).

A single job at a time (mirroring telegram_import): an optional one-shot
delay before the first send, then optionally repeating at a fixed interval
until cancelled. Jobs live in memory only and do not survive restarts.
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


current_job: SendJob | None = None
_job_task: asyncio.Task | None = None


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


def start_send(
    address: str,
    payload: Any,
    dpt: str | None,
    response: bool,
    delay_seconds: float,
    interval_seconds: float | None,
) -> SendJob:
    """Starts a background delayed/cyclic send. Raises if one is active."""
    global current_job, _job_task
    if current_job is not None and current_job.state in ("waiting", "running"):
        raise RuntimeError("A scheduled send is already active")
    current_job = SendJob(
        address=address,
        payload=payload,
        dpt=dpt,
        response=response,
        delay_seconds=delay_seconds,
        interval_seconds=interval_seconds,
    )
    _job_task = asyncio.get_running_loop().create_task(_run_job(current_job))
    return current_job


def cancel_send() -> bool:
    """Cancels the active scheduled send. Returns False if none is active."""
    if current_job is None or current_job.state not in ("waiting", "running"):
        return False
    if _job_task is not None:
        _job_task.cancel()
    return True


async def shutdown() -> None:
    """Cancels and awaits the job task on application shutdown."""
    if _job_task is not None and not _job_task.done():
        _job_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _job_task
