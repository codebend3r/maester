-- One live link per Seerr user, so a request and its ready DM belong to one person.
-- Links made before this rule may share a Seerr user: keep the earliest active
-- one (else the earliest pending one) and revoke the rest.
UPDATE users SET status = 'revoked'
WHERE status != 'revoked' AND seerr_user_id IS NOT NULL
  AND discord_id NOT IN (
    SELECT discord_id FROM (
      SELECT discord_id, ROW_NUMBER() OVER (
        PARTITION BY seerr_user_id
        ORDER BY status = 'active' DESC, linked_at IS NULL, linked_at, created_at, discord_id
      ) AS rank
      FROM users
      WHERE status != 'revoked' AND seerr_user_id IS NOT NULL
    )
    WHERE rank = 1
  );

CREATE UNIQUE INDEX users_one_live_link_per_seerr_user
    ON users (seerr_user_id)
    WHERE status != 'revoked' AND seerr_user_id IS NOT NULL;
