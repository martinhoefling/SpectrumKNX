import asyncio
import contextlib
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

import cyclic_send


@pytest_asyncio.fixture(autouse=True)
async def _reset_job_state():
    yield
    if cyclic_send._job_task is not None and not cyclic_send._job_task.done():
        cyclic_send._job_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await cyclic_send._job_task
    cyclic_send.current_job = None
    cyclic_send._job_task = None


@pytest.mark.asyncio
async def test_one_shot_delayed_send():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()) as send,
    ):
        job = cyclic_send.start_send("1/2/3", 50, "5.001", False, delay_seconds=0.01, interval_seconds=None)
        assert job.state == "waiting"
        await cyclic_send._job_task

    assert job.state == "done"
    assert job.sends_done == 1
    assert job.finished_at is not None
    send.assert_awaited_once_with("1/2/3", 50, "5.001", False)


@pytest.mark.asyncio
async def test_cyclic_send_ticks_until_cancelled():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()) as send,
    ):
        job = cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=0.01)
        await asyncio.sleep(0.05)
        assert job.state == "running"
        assert cyclic_send.cancel_send() is True
        with contextlib.suppress(asyncio.CancelledError):
            await cyclic_send._job_task

    assert job.state == "cancelled"
    assert job.sends_done >= 2
    assert job.finished_at is not None
    assert job.next_send_at is None
    assert send.await_count == job.sends_done


@pytest.mark.asyncio
async def test_second_job_rejected_while_active():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()),
    ):
        cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=1.0)
        await asyncio.sleep(0)
        with pytest.raises(RuntimeError, match="already active"):
            cyclic_send.start_send("4/5/6", False, "1.001", False, delay_seconds=0, interval_seconds=1.0)


@pytest.mark.asyncio
async def test_sends_skipped_while_disconnected():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=False),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()) as send,
    ):
        job = cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=0.01)
        await asyncio.sleep(0.05)

        # The job survives the outage and counts the skipped attempts
        assert job.state == "running"
        assert job.sends_done == 0
        assert job.sends_skipped >= 2
        send.assert_not_awaited()


@pytest.mark.asyncio
async def test_send_failure_marks_job_failed():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock(side_effect=RuntimeError("boom"))),
    ):
        job = cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=None)
        await cyclic_send._job_task

    assert job.state == "failed"
    assert job.error == "boom"


@pytest.mark.asyncio
async def test_cancel_when_idle_returns_false():
    assert cyclic_send.cancel_send() is False


@pytest.mark.asyncio
async def test_shutdown_cancels_active_job():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()),
    ):
        job = cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=60.0)
        await asyncio.sleep(0)
        await cyclic_send.shutdown()

    assert job.state == "cancelled"
