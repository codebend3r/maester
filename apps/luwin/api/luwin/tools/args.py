"""Arguments several tools take, typed once with what the model reads about them."""

from __future__ import annotations

from typing import Annotated

from pydantic import Field

TmdbId = Annotated[int, Field(description="The TMDB id from search_media.")]
FriendId = Annotated[str, Field(description="The friend's user id.")]
