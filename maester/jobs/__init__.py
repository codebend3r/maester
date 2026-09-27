"""Scheduled jobs: what the admin console does on its own, on the app's loop.

- `schedule.py`   when a job runs: at a time of day, or every so often
- `scheduler.py`  runs each job on time and delivers its notices
- `sweep.py`      stalled downloads blocklisted and searched again, or surfaced
"""

from __future__ import annotations

from maester.agent.limits import KillSwitch
from maester.clients import Services
from maester.config import Settings
from maester.jobs.schedule import At, Every
from maester.jobs.scheduler import Job, Scheduler
from maester.jobs.sweep import Sweeper
from maester.store import Store


def scheduled(
    services: Services, store: Store, settings: Settings, kill_switch: KillSwitch
) -> list[Job]:
    """Every job the app runs, on the schedule its settings give."""
    jobs = settings.jobs
    return [
        Job("sweep", Every(jobs.sweep_every), Sweeper(services, store, settings, kill_switch)),
    ]


__all__ = ["At", "Every", "Job", "Scheduler", "scheduled"]
