import asyncio
import contextlib
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

import cyclic_send


@pytest_asyncio.fixture(autouse=True)
async def _reset_job_state():
    yield
    active = [t for t in list(cyclic_send._tasks.values()) if not t.done()]
    for task in active:
        task.cancel()
    for task in active:
        with contextlib.suppress(asyncio.CancelledError):
            await task
    cyclic_send.jobs.clear()
    cyclic_send._tasks.clear()


@pytest.mark.asyncio
async def test_one_shot_delayed_read_does_not_write():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()) as send,
        patch.object(cyclic_send.knx_daemon, "read_group_value", new=AsyncMock()) as read,
    ):
        job = cyclic_send.start_send("1/2/3", None, None, False, delay_seconds=0.01, interval_seconds=None, read=True)
        await cyclic_send._tasks[job.id]

    assert job.state == "done"
    assert job.read is True
    assert job.sends_done == 1
    read.assert_awaited_once_with("1/2/3")
    send.assert_not_awaited()
    assert job.to_dict()["read"] is True


@pytest.mark.asyncio
async def test_cyclic_read_ticks_until_cancelled():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "read_group_value", new=AsyncMock()) as read,
    ):
        job = cyclic_send.start_send("1/2/3", None, None, False, delay_seconds=0, interval_seconds=0.01, read=True)
        task = cyclic_send._tasks[job.id]
        await asyncio.sleep(0.05)
        assert job.state == "running"
        assert cyclic_send.cancel_send(job.id) is True
        with contextlib.suppress(asyncio.CancelledError):
            await task

    assert job.state == "cancelled"
    assert job.sends_done >= 2
    assert read.await_count == job.sends_done


@pytest.mark.asyncio
async def test_read_and_write_jobs_same_address_run_together():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()) as send,
        patch.object(cyclic_send.knx_daemon, "read_group_value", new=AsyncMock()) as read,
    ):
        write = cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=0.01)
        read_job = cyclic_send.start_send(
            "1/2/3", None, None, False, delay_seconds=0, interval_seconds=0.01, read=True,
        )
        await asyncio.sleep(0.05)
        assert write.state == "running"
        assert read_job.state == "running"
        assert send.await_count >= 1
        assert read.await_count >= 1
        assert cyclic_send.cancel_send(write.id) is True
        assert read_job.state == "running"
        assert cyclic_send.cancel_send(read_job.id) is True


@pytest.mark.asyncio
async def test_one_shot_delayed_send():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()) as send,
    ):
        job = cyclic_send.start_send("1/2/3", 50, "5.001", False, delay_seconds=0.01, interval_seconds=None)
        assert job.state == "waiting"
        await cyclic_send._tasks[job.id]

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
        task = cyclic_send._tasks[job.id]
        await asyncio.sleep(0.05)
        assert job.state == "running"
        assert cyclic_send.cancel_send(job.id) is True
        with contextlib.suppress(asyncio.CancelledError):
            await task

    assert job.state == "cancelled"
    assert job.sends_done >= 2
    assert job.finished_at is not None
    assert job.next_send_at is None
    assert send.await_count == job.sends_done


@pytest.mark.asyncio
async def test_two_jobs_run_concurrently():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()),
    ):
        a = cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=1.0)
        b = cyclic_send.start_send("4/5/6", False, "1.001", False, delay_seconds=0, interval_seconds=1.0)
        await asyncio.sleep(0)
        active = cyclic_send.list_active_jobs()
        assert {j.id for j in active} == {a.id, b.id}
        assert cyclic_send.cancel_send(a.id) is True
        with contextlib.suppress(asyncio.CancelledError):
            task_a = cyclic_send._tasks.get(a.id)
            if task_a:
                await task_a
        assert b.state == "running"
        assert cyclic_send.cancel_send(b.id) is True


@pytest.mark.asyncio
async def test_two_jobs_same_address_are_independent():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()),
    ):
        a = cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=1.0)
        b = cyclic_send.start_send("1/2/3", False, "1.001", False, delay_seconds=0, interval_seconds=1.0)
        await asyncio.sleep(0)
        assert a.id != b.id
        active = cyclic_send.list_active_jobs()
        assert {j.id for j in active} == {a.id, b.id}
        assert all(j.address == "1/2/3" for j in active)
        assert cyclic_send.cancel_send(a.id) is True
        with contextlib.suppress(asyncio.CancelledError):
            task_a = cyclic_send._tasks.get(a.id)
            if task_a:
                await task_a
        assert b.state == "running"
        assert {j.id for j in cyclic_send.list_active_jobs()} == {b.id}
        assert cyclic_send.cancel_send(b.id) is True


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
        await cyclic_send._tasks[job.id]

    assert job.state == "failed"
    assert job.error == "boom"


@pytest.mark.asyncio
async def test_cancel_unknown_returns_false():
    assert cyclic_send.cancel_send("missing") is False


@pytest.mark.asyncio
async def test_cancel_all_sends_cancels_multiple_jobs():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()),
    ):
        a = cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=60.0)
        b = cyclic_send.start_send("4/5/6", False, "1.001", False, delay_seconds=0, interval_seconds=60.0)
        await asyncio.sleep(0)
        assert cyclic_send.cancel_all_sends() == 2
        for job_id in (a.id, b.id):
            task = cyclic_send._tasks.get(job_id)
            if task:
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    assert a.state == "cancelled"
    assert b.state == "cancelled"


@pytest.mark.asyncio
async def test_cancel_all_sends_idle_returns_zero():
    assert cyclic_send.cancel_all_sends() == 0


@pytest.mark.asyncio
async def test_shutdown_cancels_active_jobs():
    with (
        patch.object(cyclic_send.knx_daemon, "write_enabled", return_value=True),
        patch.object(cyclic_send.knx_daemon, "send_group_value", new=AsyncMock()),
    ):
        a = cyclic_send.start_send("1/2/3", True, "1.001", False, delay_seconds=0, interval_seconds=60.0)
        b = cyclic_send.start_send("4/5/6", False, "1.001", False, delay_seconds=0, interval_seconds=60.0)
        await asyncio.sleep(0)
        await cyclic_send.shutdown()

    assert a.state == "cancelled"
    assert b.state == "cancelled"
