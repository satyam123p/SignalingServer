setPublishingByPlaylistId = async (playlistId, status, conn, placeId) => {
        try {
            const { isShared, originalPlaceId } = await this.getSharedStatusByPlaylistId(playlistId);
            if (isShared && originalPlaceId != placeId) {
                await this.dbService.updateRow({
                    text: `UPDATE CMS_CONTENT_SHARE
               SET SHARED_PUBLISHED = $1
               WHERE PLACE_ID=$3 AND CONTENT_ID IN (SELECT DISTINCT CONTENT_ID
                                    FROM CMS_PLAYLIST_RELATION_CONTENT A, CMS_PLAYLIST_VERSION B
                                    WHERE A.PLAYLIST_ID = $2 AND A.PLAYLIST_ID = B.PLAYLIST_ID
                                    AND A.VERSION = B.VERSION AND B.IS_ACTIVE = TRUE)`,
                    values: [status, playlistId, placeId],
                }, conn);
            } else {
                await this.dbService.updateRow({
                    text: `UPDATE CMS_CONTENT
               SET PUBLISHED = $1
               WHERE CONTENT_ID IN (SELECT DISTINCT CONTENT_ID
                                    FROM CMS_PLAYLIST_RELATION_CONTENT A,
                                         CMS_PLAYLIST_VERSION B
                                    WHERE A.PLAYLIST_ID = $2 OR A.PLAYLIST_ID IN
                                    (SELECT SUB_PLAYLIST_ID FROM CMS_PLAYLIST_RELATION_SUB_PLAYLIST WHERE PLAYLIST_ID = $2)
                                      AND A.PLAYLIST_ID = B.PLAYLIST_ID
                                      AND A.VERSION = B.VERSION
                                      AND B.IS_ACTIVE = TRUE)`,
                    values: [status, playlistId],
                }, conn);

                await this.dbService.updateRow({
                    text: `UPDATE CMS_PLAYLIST
               SET PUBLISHED = $1
               WHERE PLAYLIST_ID IN (SELECT DISTINCT SUB_PLAYLIST_ID
                                    FROM CMS_PLAYLIST_RELATION_SUB_PLAYLIST A,
                                         CMS_PLAYLIST_VERSION B
                                    WHERE A.PLAYLIST_ID = $2
                                      AND A.PLAYLIST_ID = B.PLAYLIST_ID
                                      AND A.VERSION = B.VERSION
                                      AND B.IS_ACTIVE = TRUE)`,
                    values: [status, playlistId],
                }, conn);
            }

            logger.info(`[PublishingService][setPublishingByPlaylistId] Completed, playlist id ${playlistId}, status: ${status}`);
        } catch (e) {
            logger.error(`[PublishingService][setPublishingByPlaylistId] Fail to set publishing by playlist id ${playlistId}, status: ${status}`,
                e);

            throw e;
        }
    };

    setPublishingByProgramId = async (programId, status, conn, placeId) => {
        try {
            let updatedPlaylists;
            const { isShared, originalPlaceId } = await this.getSharedStatusByProgramId(programId); // todo
            if (isShared && originalPlaceId != placeId) {
                await this.dbService.updateRow({
                    text: `UPDATE CMS_CONTENT_SHARE
                 SET SHARED_PUBLISHED = $1
                 WHERE PLACE_ID=$3 AND CONTENT_ID IN (SELECT DISTINCT CONTENT_ID
                                      FROM PMS_SCHEDULE A,
                                           PMS_PROGRAM_RELATION_SCHEDULE B
                                      WHERE B.PROGRAM_ID = $2
                                        AND A.SCHEDULE_ID = B.SCHEDULE_ID
                                        AND A.CONTENT_TYPE = '${Type.CONTENT}')`,
                    values: [status, programId, placeId],
                }, conn);

                updatedPlaylists = await this.dbService.updateRow({
                    text: `UPDATE CMS_PLAYLIST_SHARE
                 SET SHARED_PUBLISHED = $1
                 WHERE PLACE_ID=$3 AND PLAYLIST_ID IN (SELECT DISTINCT CONTENT_ID
                                       FROM PMS_SCHEDULE A,
                                            PMS_PROGRAM_RELATION_SCHEDULE B
                                       WHERE B.PROGRAM_ID = $2
                                         AND A.SCHEDULE_ID = B.SCHEDULE_ID
                                         AND A.CONTENT_TYPE = '${Type.PLAYLIST}')
                 RETURNING *`,
                    values: [status, programId, placeId],
                }, conn);
            } else {
                await this.dbService.updateRow({
                    text: `UPDATE CMS_CONTENT
               SET PUBLISHED = $1
               WHERE CONTENT_ID IN (SELECT DISTINCT CONTENT_ID
                                    FROM PMS_SCHEDULE A,
                                         PMS_PROGRAM_RELATION_SCHEDULE B
                                    WHERE B.PROGRAM_ID = $2
                                      AND A.SCHEDULE_ID = B.SCHEDULE_ID
                                      AND A.CONTENT_TYPE = '${Type.CONTENT}')`,
                    values: [status, programId],
                }, conn);

                updatedPlaylists = await this.dbService.updateRow({
                    text: `UPDATE CMS_PLAYLIST
               SET PUBLISHED = $1
               WHERE PLAYLIST_ID IN (SELECT DISTINCT CONTENT_ID
                                     FROM PMS_SCHEDULE A,
                                          PMS_PROGRAM_RELATION_SCHEDULE B
                                     WHERE B.PROGRAM_ID = $2
                                       AND A.SCHEDULE_ID = B.SCHEDULE_ID
                                       AND A.CONTENT_TYPE = '${Type.PLAYLIST}')
               RETURNING *`,
                    values: [status, programId],
                }, conn);
            }
            logger.info(`[PublishingService][setPublishingByProgramId] Updated playlists: ${JSON.stringify(updatedPlaylists.rows)}`);

            if (updatedPlaylists.rows && updatedPlaylists.rows.length) {
                for (const playlist of updatedPlaylists.rows) {
                    await this.setPublishingByPlaylistId(playlist.playlist_id, status, conn, placeId);
                }
            }

            logger.info(`[PublishingService][setPublishingByProgramId] Completed, programId id ${programId}, status: ${status}`);
        } catch (e) {
            logger.error(`[PublishingService][setPublishingByProgramId] Fail to set publishing by programId id ${programId}, status: ${status}`,
                e);

            throw e;
        }
    };
