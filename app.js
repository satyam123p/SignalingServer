
const DynamoDBService = require('./dynamo.service');
const S3Service = require('./s3.service');
const SQSService = require('./sqs.service');
const { logger } = require('./logger.service');

const Type = {
    CONTENT: 'CONTENT',
    PLAYLIST: 'PLAYLIST',
    SCHEDULE: 'SCHEDULE',
    PROGRAM: 'PROGRAM',
    SYNCPLAY: 'SYNCPLAY',
    GENERAL: 'GENERAL',
};

class PublishingService {
    constructor({ region = 'ap-northeast-1', dbInstance = null, bucket = '', sqsUrl = '', delayBatchTime = 10 }) {
        this.dynamoDB = DynamoDBService.getInstance(region);
        this.tableName = 'fcms-screens-publishing-dm';
        this.s3Service = new S3Service(region);
        this.sqsService = new SQSService(region);
        this.dbService = dbInstance;
        this.bucket = bucket;
        this.sqsUrl = sqsUrl;
        this.delayBatchTime = delayBatchTime;
    }

    getSharedStatusByContentId = async (id) => { // to get shared status
        try {
            let result = await this.dbService.selectRows({
                text: `SELECT is_shared, place_id from cms_content
               WHERE content_id = $1`,
                values: [id],
            });
            result.originalPlaceId = result[0].placeId;
            result.isShared = result[0].isShared;
            return result;
        } catch (e) {
            logger.error(`[PublishingService][getSharedStatusByContentId] Failed to get shared status`, e);
            return [];
        }
    };

    getSharedStatusByPlaylistId = async (id) => {
        try {
            let result = await this.dbService.selectRows({
                text: `SELECT is_shared, place_id from cms_playlist
               WHERE playlist_id = $1`,
                values: [id],
            });
            result.originalPlaceId = result[0].placeId;
            result.isShared = result[0].isShared;
            return result;
        } catch (e) {
            logger.error(`[PublishingService][getSharedStatusByPlaylistId] Failed to get shared status`, e);
            return [];
        }
    };

    getSharedStatusByProgramId = async (id) => {
        try {
            let result = await this.dbService.selectRows({
                text: `SELECT is_shared, place_id from pms_program
               WHERE program_id = $1`,
                values: [id],
            });
            result.originalPlaceId = result[0].placeId;
            result.isShared = result[0].isShared;
            return result;
        } catch (e) {
            logger.error(`[PublishingService][getSharedStatusByProgramId] Failed to get shared status`, e);
            return [];
        }
    };

    getScreensWithPublishingId = async (id, conn, placeId = undefined) => {
        try {
            let rows;
            if (placeId) {
                rows = await this.dbService.selectRows({
                    text: `SELECT SCREEN_ID
                 FROM CMS_SCREEN_DISTRIBUTION
                 WHERE ID = $1 AND PLACE_ID=$2`,
                    values: [id, placeId],
                }, conn);
            } else {
                rows = await this.dbService.selectRows({
                    text: `SELECT SCREEN_ID
                 FROM CMS_SCREEN_DISTRIBUTION
                 WHERE ID = $1`,
                    values: [id],
                }, conn);
            }
            if (rows.length) {
                logger.info(
                    `[PublishingService][getScreensWithPublishingId] ${rows.length} screen ids for distribution id: ${id} , ${JSON.stringify(
                        rows.map(row => row.screenId))}`);
                return rows.map(row => row.screenId);
            }
            return [];
        } catch (e) {
            logger.error(`[PublishingService][getScreensWithPublishingId] Fail to get screens ids by distribution id: ${id}`, e);

            return [];
        }
    };

    getPublishing = async (screenId) => {
        try {
            const rows = await this.dbService.selectRows({
                text: `SELECT *
               FROM CMS_SCREEN_DISTRIBUTION
               WHERE SCREEN_ID = $1`,
                values: [screenId],
            });

            if (rows.length) {
                return rows[0];
            }

            return [];
        } catch (e) {
            logger.error(`[PublishingService][getPublishing] Fail to get publishing by screen id: ${screenId}`, e);

            return [];
        }
    };

    getPublishingByContentId = async (id) => {
        try {
            return await this.dbService.selectRows({
                text: `SELECT *
               FROM CMS_SCREEN_DISTRIBUTION
               WHERE ID = $1 OR POPUP_ID = $1`,
                values: [id],
            });
        } catch (e) {
            logger.error(`[PublishingService][getPublishingByContentId] Fail to get publishing by distribution id: ${id}`, e);

            return [];
        }
    };

    deleteWithScreenId = async (screenId, conn) => {
        try {
            await this.dbService.deleteRows({
                text: `DELETE
               FROM CMS_SCREEN_DISTRIBUTION
               WHERE SCREEN_ID = $1`,
                values: [screenId],
            }, conn);
        } catch (e) {
            logger.error(`[PublishingService][deleteWithScreenId] Fail to delete publishing by screen id: ${screenId}`, e);

            throw e;
        }
    };

    getProgram = async (id) => {
        try {
            const program = await this.dbService.selectRows({
                text: 'SELECT * FROM PMS_PROGRAM WHERE PROGRAM_ID = $1',
                values: [id],
            });

            return program.length ? program[0] : undefined;
        } catch (e) {
            logger.error(`[PublishingService][getProgram] Fail to get program by program id: ${id}`, e);

            throw e;
        }
    };

    getContent = async (contentId) => {
        let rowData = await this.dbService.selectRows({
            text: `SELECT A.*,
                    B.VERSION,
                    B.MEDIA_TYPE,
                    B.TOTAL_SIZE,
                    B.PLAY_TIME,
                    B.THUMBNAIL_ID,
                    b.MAIN_FILE_ID,
                    c.FILE_NAME,
                    B.RESOLUTION,
                    B.ORIENTATION
             FROM CMS_CONTENT A,
                  CMS_CONTENT_VERSION B
                      LEFT JOIN CMS_FILE C ON B.MAIN_FILE_ID = C.FILE_ID
             WHERE A.CONTENT_ID = B.CONTENT_ID
               AND B.IS_ACTIVE = TRUE
               AND A.CONTENT_ID = $1`,
            values: [contentId],
        });

        let content, data;
        if (rowData.length) {
            data = rowData[0];
            content = { ...data };
        }

        if (content) {
            rowData = await this.dbService.selectRows({
                query: `SELECT *
                FROM CMS_FILE
                WHERE FILE_ID = $1`,
                values: [content.mainFileId],
            });

            if (rowData.length) {
                content.mainFileName = rowData[0].fileName;
                content.file = rowData[0];
            }
        }

        return content;
    };

    getPlaylist = async (playlistId) => {
        let playlist = {};
        const q = `SELECT A.*, B.VERSION, B.TOTAL_SIZE, B.PLAY_TIME, B.IS_SHUFFLE, B.OUT_EFFECT, B.IN_EFFECT
               FROM CMS_PLAYLIST A,
                    CMS_PLAYLIST_VERSION B
               WHERE A.PLAYLIST_ID = B.PLAYLIST_ID
                 and B.IS_ACTIVE = TRUE
                 AND A.PLAYLIST_ID = $1`;

        const playlistResult = await this.dbService.selectRows({
            text: q,
            values: [playlistId],
        });
        logger.info(`[PublishingService][getPlaylist] playlistResult: ${JSON.stringify(playlistResult)}`);

        if (playlistResult.length) {
            playlist = {
                ...playlistResult[0],
            };
            const { version } = playlistResult[0];
            const contentsQuery = `SELECT A.*,
                                    B.CONTENT_NAME,
                                    C.MEDIA_TYPE,
                                    C.MAIN_FILE_ID,
                                    C.THUMBNAIL_ID,
                                    C.TOTAL_SIZE,
                                    D.FILE_NAME,
                                    D.FILE_WIDTH,
                                    D.FILE_HEIGHT,
                                    D.FILE_ROTATION,
                                    D.FILE_DURATION,
                                    D.FIlE_HASH,
                                    (SELECT ARRAY_AGG(TAGS.TAG_KEY) FROM (SELECT TAG_KEY FROM CMS_PLAYLIST_TAG_CONDITION WHERE PLAYLIST_ID = A.PLAYLIST_ID AND CONTENT_ID = A.CONTENT_ID AND CONTENT_ORDER = A.CONTENT_ORDER AND SYNC_ID = A.SYNC_ID AND TAG_CONDITION_TYPE = 'ALLOW') AS TAGS) AS ALLOW_TAGS,
                                    (SELECT ARRAY_AGG(TAGS.TAG_KEY) FROM (SELECT TAG_KEY FROM CMS_PLAYLIST_TAG_CONDITION WHERE PLAYLIST_ID = A.PLAYLIST_ID AND CONTENT_ID = A.CONTENT_ID AND CONTENT_ORDER = A.CONTENT_ORDER AND SYNC_ID = A.SYNC_ID AND TAG_CONDITION_TYPE = 'SKIP') AS TAGS) AS SKIP_TAGS,
                                    (SELECT DISTINCT TAG_APPLY_TYPE FROM CMS_PLAYLIST_TAG_CONDITION WHERE PLAYLIST_ID = A.PLAYLIST_ID AND CONTENT_ID = A.CONTENT_ID AND CONTENT_ORDER = A.CONTENT_ORDER AND SYNC_ID = A.SYNC_ID AND TAG_CONDITION_TYPE = 'ALLOW') AS ALLOW_TAGS_CONDITION,
                                    (SELECT DISTINCT TAG_APPLY_TYPE FROM CMS_PLAYLIST_TAG_CONDITION WHERE PLAYLIST_ID = A.PLAYLIST_ID AND CONTENT_ID = A.CONTENT_ID AND CONTENT_ORDER = A.CONTENT_ORDER AND SYNC_ID = A.SYNC_ID AND TAG_CONDITION_TYPE = 'SKIP') AS SKIP_TAGS_CONDITION
                             FROM CMS_PLAYLIST_RELATION_CONTENT A,
                                  CMS_CONTENT B,
                                  CMS_CONTENT_VERSION C,
                                  CMS_FILE D
                             WHERE A.PLAYLIST_ID = $1
                               AND A.VERSION = $2
                               AND A.CONTENT_ID = B.CONTENT_ID
                               AND A.CONTENT_ID = C.CONTENT_ID
                               AND C.MAIN_FILE_ID = D.FILE_ID
                             ORDER BY A.CONTENT_ORDER ASC`;

            const contents = await this.dbService.selectRows({
                text: contentsQuery,
                values: [playlistId, version],
            });
            logger.info(`[PublishingService][getPlaylist] contents: ${JSON.stringify(contents)}`);

            for (const content of contents) {
                if (!content.allowTags || !content.allowTags.length || !content.allowTagsCondition) {
                    if (content.hasOwnProperty('allowTags')) {
                        delete content.allowTags;
                    }
                    if (content.hasOwnProperty('allowTagsCondition')) {
                        delete content.allowTagsCondition;
                    }
                }
                if (!content.skipTags || !content.skipTags.length || !content.skipTagsCondition) {
                    if (content.hasOwnProperty('skipTags')) {
                        delete content.skipTags;
                    }
                    if (content.hasOwnProperty('skipTagsCondition')) {
                        delete content.skipTagsCondition;
                    }
                }
            }

            if (contents.length) {
                playlist.contents = contents;
            }
            playlist.userName = playlist.updaterName ? playlist.updaterName : '';

            const subPlaylistQuery = `SELECT * FROM CMS_PLAYLIST_RELATION_SUB_PLAYLIST WHERE PLAYLIST_ID = $1 AND VERSION = $2 ORDER BY CONTENT_ORDER`;
            const subPlaylists = await this.dbService.selectRows({
                text: subPlaylistQuery,
                values: [playlistId, version],
            });
            logger.info(`[PublishingService][getPlaylist] subPlaylists: ${JSON.stringify(subPlaylists)}`);

            if (subPlaylists.length) {
                if (playlist.contents) {
                    playlist.contents.push(...subPlaylists);
                } else {
                    playlist.contents = [...subPlaylists];
                }
                playlist.contents.sort((a, b) => a.contentOrder - b.contentOrder);

                for (let index = playlist.contents.length - 1; index >= 0; index--) {
                    if (playlist.contents[index].subPlaylistId) {
                        const subContentsQuery = `SELECT A.*,
                                    B.CONTENT_NAME,
                                    C.MEDIA_TYPE,
                                    C.MAIN_FILE_ID,
                                    C.THUMBNAIL_ID,
                                    C.TOTAL_SIZE,
                                    D.FILE_NAME,
                                    D.FILE_WIDTH,
                                    D.FILE_HEIGHT,
                                    D.FILE_ROTATION,
                                    D.FILE_DURATION,
                                    D.FIlE_HASH
                             FROM CMS_PLAYLIST_RELATION_CONTENT A,
                                  CMS_CONTENT B,
                                  CMS_CONTENT_VERSION C,
                                  CMS_FILE D
                             WHERE A.PLAYLIST_ID = $1
                               AND A.VERSION = (SELECT VERSION FROM CMS_PLAYLIST_VERSION WHERE PLAYLIST_ID = $1)
                               AND A.CONTENT_ID = B.CONTENT_ID
                               AND A.CONTENT_ID = C.CONTENT_ID
                               AND C.MAIN_FILE_ID = D.FILE_ID
                             ORDER BY A.CONTENT_ORDER ASC`;

                        let subContents = await this.dbService.selectRows({
                            text: subContentsQuery,
                            values: [playlist.contents[index].subPlaylistId],
                        });

                        if (subContents.length) {
                            logger.info(`[PublishingService][getPlaylist] subContents: ${JSON.stringify(subContents)}`);
                            for (const subContent of subContents) {
                                subContent.contentOrder += playlist.contents[index].contentOrder;
                            }
                            logger.info(`[PublishingService][getPlaylist] ${playlist.contents[index].subPlaylistId}'s length: ${subContents.length}, contents: ${JSON.stringify(subContents)}`);
                            playlist.contents.splice(index, 1, ...subContents);
                        }
                    }
                }
                for (let index = 0; index < playlist.contents.length; index++) {
                    playlist.contents[index].contentOrder = index;
                }
            }
        }

        logger.info(`[PublishingService][getPlaylist] playlist: ${JSON.stringify(playlist)}`);
        return playlist;
    };

    getPlaylistIdsByContentId = async (contentId) => {
        try {
            const playlistIds = await this.dbService.selectRows({
                text: 'SELECT DISTINCT PLAYLIST_ID FROM CMS_PLAYLIST_RELATION_CONTENT WHERE CONTENT_ID = $1',
                values: [contentId],
            });

            logger.info(`[PublishingService][getPlaylistIdsByContentId] contentId: ${contentId}, playlistIds: ${JSON.stringify(playlistIds)}`);
            return playlistIds.map(row => row.playlistId) || [];
        } catch (e) {
            logger.error(`[PublishingService][getPlaylistIdsByContentId] Fail to get playlist ids by content id: ${contentId}`, e);

            throw e;
        }
    };

    getPlaylistIdsBySubPlaylistIds = async (subPlaylistIds) => {
        try {
            const playlistIds = await this.dbService.selectRows({
                text: `SELECT DISTINCT PLAYLIST_ID FROM CMS_PLAYLIST_RELATION_SUB_PLAYLIST WHERE SUB_PLAYLIST_ID IN (${subPlaylistIds.map((t, index) => `$${Number(index + 1)}`).join(',')})`,
                values: subPlaylistIds,
            });
            logger.info(`[PublishingService][getPlaylistIdsBySubPlaylistIds] subPlaylistIds: ${subPlaylistIds}, playlistIds: ${JSON.stringify(playlistIds)}`);
            return playlistIds.map(row => row.playlistId) || [];
        } catch (e) {
            logger.error(`[PublishingService][getPlaylistIdsBySubPlaylistIds] Fail to get playlist ids by subPlaylistIds: ${subPlaylistIds}`, e);

            throw e;
        }
    };

    getProgramIdsByContentId = async (contentId) => {
        try {
            const programIds = await this.dbService.selectRows({
                text: `SELECT DISTINCT program_id
               FROM PMS_PROGRAM_RELATION_SCHEDULE
               WHERE SCHEDULE_ID IN (SELECT SCHEDULE_ID FROM PMS_SCHEDULE WHERE CONTENT_ID = $1)
                 AND PROGRAM_ID != $1`,
                values: [contentId],
            });

            logger.info(`[PublishingService][getProgramIdsByContentId] contentId: ${contentId}, programIds: ${JSON.stringify(programIds)}`);
            return programIds.map(row => row.programId) || [];
        } catch (e) {
            logger.error(`[PublishingService][getProgramIdsByContentId] Fail to get program ids by content id: ${contentId}`, e);

            throw e;
        }
    };

    getSyncGroup = async (id) => {
        try {
            const syncData = await this.getPublishingByContentId(id);
            let sync = [];
            if (syncData.length) {
                let syncId = syncData[0].popupId === id ? 'popupSyncId' : 'syncId';
                syncData.forEach((data) => {
                    let screens = sync.filter(group => data[syncId] === group.syncId);
                    if (screens && !screens.length) {
                        sync.push({ syncId: data[syncId], screenIds: [] });
                    }
                    sync.forEach((group, index) => {
                        if (group.syncId === data[syncId]) {
                            sync[index].screenIds.push({ screenId: data.screenId, order: data.order });
                        }
                    });
                });

                const syncDiff = sync.sort((a, b) => {
                    return a.syncId - b.syncId;
                });

                for (const screensIdsArray of syncDiff) {
                    if (screensIdsArray.screenIds.length > 1) {
                        screensIdsArray.screenIds.sort((a, b) => {
                            return a.order - b.order;
                        });
                    }
                }
                sync = syncDiff;

                logger.info(`[PublishingService][getSyncGroup] id: ${id}, sync: ${JSON.stringify(sync)}`);
            }
            return sync;
        } catch (e) {
            logger.error(`[PublishingService][getSyncGroup] Fail to get sync group by id: ${id}`, e);
        }
    };

    checkPublishingAndInit = async (id, type, conn, parentId, placeId, screenIds) => {
        try {
            const isPublished = await this.checkIsPublished(id, type, parentId, placeId, screenIds);
            if (!isPublished) {
                await this.updatePublishingToDB(id, type, false, conn, placeId);
            }
        } catch (e) {
            logger.error(`[PublishingService][checkPublishingAndInit] Fail to check and update,  type: ${type}, id: ${id}`, e);

            throw e;
        }
    };

    checkIsPublished = async (id, type, parentId, placeId, screenIds) => {
        try {
            logger.info(`[PublishingService][checkIsPublished] id: ${id}, type: ${type}, parentId: ${parentId}, placeId: ${placeId}`);
            let ids = [id];

            let playlistIds = [];
            if (type.toUpperCase() === Type.CONTENT) {
                playlistIds = await this.getPlaylistIdsByContentId(id);
            } else {
                playlistIds = await this.getPlaylistIdsBySubPlaylistIds([id]);
            }

            if (parentId) {
                playlistIds = playlistIds.filter(id => id !== parentId);
            }
            logger.info(`[PublishingService][checkIsPublished] playlistIds: ${playlistIds}`);
            if (playlistIds.length) {
                ids = ids.concat(playlistIds);
                for (const playlistId of playlistIds) {
                    ids = ids.concat(await this.getProgramIdsByContentId(playlistId));
                }
            }

            const programIds = await this.getProgramIdsByContentId(id);
            if (programIds && programIds.length) {
                ids = ids.concat(programIds);
            }
            if (ids.length) {
                if (parentId) {
                    ids = ids.filter(id => id !== parentId);
                }
                ids = [...new Set(ids)];
                logger.info(`ids: ${ids}`);

                let rows = await this.dbService.selectRows({
                    text: `SELECT *
                 FROM CMS_SCREEN_DISTRIBUTION
                 WHERE place_id = $1 AND ID IN (${ids.map((t, index) => `$${Number(index + 2)}`).join(',')})`,
                    values: [placeId, ...ids],
                });

                if (screenIds && screenIds.length) {
                    const screenIdsSet = new Set(screenIds);
                    rows = rows.filter(item => !screenIdsSet.has(item.screenId));
                }
                logger.info(`[PublishingService][checkIsPublished] id: ${id}, type: ${type}, ids: ${ids}, rows: ${JSON.stringify(rows)}`);
                return rows.length ? true : false;
            }
        } catch (e) {
            logger.error(`[PublishingService][checkIsPublished] Fail to check publishing status, type: ${type}, id: ${id}`, e);
            throw new Error(`Fail to check publishing status from dynamo ${id}`);
        }
    };

    removePublished = async (screenId, conn) => {
        try {
            const content = await this.getPublishing(screenId);
            await this.deleteWithScreenId(screenId, conn);
            let contentResponse = {};
            if (content) {
                const screenIdsPlayingContent = await this.getScreensWithPublishingId(content.id, conn, content.placeId);
                if (!screenIdsPlayingContent.length) {
                    contentResponse = { contentId: content.id, contentType: content.type };
                }
            }
            logger.info(`[PublishingService][removePublished] Completed, screen id: ${screenId}`);
            return contentResponse;
        } catch (e) {
            logger.error(`[PublishingService][removePublished] Fail to remove publishing by screen ids: ${screenId}`, e);

            throw e;
        }
    };

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

    getRelatedContentsById = async (id, type) => {
        try {
            let rows;
            if (type.toUpperCase() === Type.PLAYLIST) {
                const contentRows = await this.dbService.selectRows({
                    text: `SELECT DISTINCT CONTENT_ID AS ID FROM CMS_PLAYLIST_RELATION_CONTENT WHERE PLAYLIST_ID = $1`,
                    values: [id],
                });
                rows = contentRows.map(row => ({ id: row.id, type: Type.CONTENT })) || [];

                const subPlaylistRows = await this.dbService.selectRows({
                    text: `SELECT DISTINCT SUB_PLAYLIST_ID AS ID FROM CMS_PLAYLIST_RELATION_SUB_PLAYLIST WHERE PLAYLIST_ID = $1`,
                    values: [id],
                });
                rows.push(...subPlaylistRows.map(row => ({ id: row.id, type: Type.PLAYLIST })));
            } else if (type.toUpperCase() === Type.PROGRAM || type.toUpperCase() === Type.SCHEDULE) {
                rows = await this.dbService.selectRows({
                    text: `SELECT DISTINCT CONTENT_ID AS ID, CONTENT_TYPE AS TYPE FROM PMS_SCHEDULE WHERE SCHEDULE_ID IN (SELECT SCHEDULE_ID FROM PMS_PROGRAM_RELATION_SCHEDULE WHERE PROGRAM_ID = $1)`,
                    values: [id],
                });
                rows = rows.map(row => ({ ...row })) || [];
            }

            logger.info(`[PublishingService][getRelatedContentsById] type: ${type}, id: ${id}, rows: ${JSON.stringify(rows)}`);
            return rows;
        } catch (e) {
            logger.error(`[PublishingService][getRelatedContentsById] Fail to get related contents,  type: ${type}, id: ${id}`, e);

            throw e;
        }
    };

    updatePublishingToDB = async (id, type, status, conn, placeId) => {
        logger.info(`[PublishingService][updatePublishingToDB] type: ${type}, id: ${id}, status: ${status}`);

        try {
            if (type.toUpperCase() === Type.CONTENT) {
                const { isShared, originalPlaceId } = await this.getSharedStatusByContentId(id);
                logger.info(`[isShared]: ${isShared} and [Original_PlaceId]: ${originalPlaceId} and [PLACE_ID]: ${placeId}`);
                if (isShared && originalPlaceId != placeId) {
                    const result = await this.dbService.updateRow({
                        table: 'CMS_CONTENT_SHARE',
                        columnsValues: {
                            SHARED_PUBLISHED: status,
                        },
                        wheres: {
                            CONTENT_ID: id,
                            PLACE_ID: placeId,
                        },
                        returning: '*',
                    }, conn);
                    logger.info(`[PublishingService][updatePublishingToDB] type: ${type}, result: ${JSON.stringify(result)}`);
                } else {
                    const result = await this.dbService.updateRow({
                        table: 'CMS_CONTENT',
                        columnsValues: {
                            PUBLISHED: status,
                        },
                        wheres: {
                            CONTENT_ID: id,
                        },
                        returning: '*',
                    }, conn);
                    logger.info(`[PublishingService][updatePublishingToDB] type: ${type}, result: ${JSON.stringify(result)}`);
                }
            } else if (type.toUpperCase() === Type.PLAYLIST) {
                const { isShared, originalPlaceId } = await this.getSharedStatusByPlaylistId(id);
                if (isShared && originalPlaceId != placeId) {
                    const result = await this.dbService.updateRow({
                        table: 'CMS_PLAYLIST_SHARE',
                        columnsValues: {
                            SHARED_PUBLISHED: status,
                        },
                        wheres: {
                            PLAYLIST_ID: id,
                            PLACE_ID: placeId,
                        },
                        returning: '*',
                    }, conn);
                    logger.info(`[PublishingService][updatePublishingToDB] type: ${type}, result: ${JSON.stringify(result)}`);
                } else {
                    const result = await this.dbService.updateRow({
                        table: 'CMS_PLAYLIST',
                        columnsValues: {
                            PUBLISHED: status,
                        },
                        wheres: {
                            PLAYLIST_ID: id,
                        },
                        returning: '*',
                    }, conn);
                    logger.info(`[PublishingService][updatePublishingToDB] type: ${type}, result: ${JSON.stringify(result)}`);
                }
                if (!status) {
                    const rows = await this.getRelatedContentsById(id, type);
                    for (const row of rows) {
                        await this.checkPublishingAndInit(row.id, row.type, conn, id, placeId);
                    }
                } else {
                    await this.setPublishingByPlaylistId(id, status, conn, placeId);
                }
            } else if (type.toUpperCase() === Type.PROGRAM || type.toUpperCase() === Type.SCHEDULE) {
                const { isShared, originalPlaceId } = await this.getSharedStatusByProgramId(id);
                if (isShared && originalPlaceId != placeId) {
                    const result = await this.dbService.updateRow({
                        table: 'PMS_PROGRAM_SHARE',
                        columnsValues: {
                            SHARED_PUBLISHED: status,
                        },
                        wheres: {
                            PROGRAM_ID: id,
                            PLACE_ID: placeId,
                        },
                        returning: '*',
                    }, conn);
                    logger.info(`[PublishingService][updatePublishingToDB] type: ${type}, result: ${JSON.stringify(result)}`);
                } else {
                    const result = await this.dbService.updateRow({
                        table: 'PMS_PROGRAM',
                        columnsValues: {
                            PUBLISHED: status,
                        },
                        wheres: {
                            PROGRAM_ID: id,
                        },
                        returning: '*',
                    }, conn);
                    logger.info(`[PublishingService][updatePublishingToDB] type: ${type}, result: ${JSON.stringify(result)}`);
                }
                if (!status) {
                    const rows = await this.getRelatedContentsById(id, type);
                    for (const row of rows) {
                        await this.checkPublishingAndInit(row.id, row.type, conn, id, placeId);
                    }
                } else {
                    await this.setPublishingByProgramId(id, status, conn, placeId);
                }
            }
            logger.info(`[PublishingService][updatePublishingToDB] Completed, type: ${type}, id: ${id}, status: ${status}`);
        } catch (e) {
            logger.error(`[PublishingService][updatePublishingToDB] Fail to update publishing, type: ${type}, id: ${id}, status: ${status}`, e);
        }
    };
}

module.exports = PublishingService;
