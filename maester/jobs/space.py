"""The daily free-space sample: every volume's free space, for the disk forecast."""

from __future__ import annotations

import logging
from datetime import datetime

from maester.clients import Services
from maester.config import Settings
from maester.notify import Notice
from maester.storage import read_space, sample_of
from maester.store import Store

log = logging.getLogger("maester.jobs")


async def sample_space(services: Services, store: Store, settings: Settings) -> list[Notice]:
    """Today's free space per volume, taken once a day.

    A day an arr can't answer is skipped whole: a share it sees would come back
    seen by fewer hosts, which reads as another volume. The fit takes a missing day.
    """
    space = await read_space(services)
    if space.unreachable:
        log.warning("no space sample today: %s", "; ".join(space.unreachable))
        return []
    today = datetime.now(settings.jobs.zone).date()
    store.record_space(today, [sample_of(v, today) for v in space.volumes])
    return []
