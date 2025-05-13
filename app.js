
const { logger } = require('./logger.service');

const playlistSchemaFormat = {
    playlist_name: 'playlist 1',
    playlist_id: '00000000-0000-0000-0000-000000000000',
    shuffle: false,
    contents: [
        {
            content_id: '862B04BF-8DA4-41AA-8697-FA5ADF29742C',
            content_name: 'content 1',
            thumbnail_id: '00000000-0000-0000-0000-000000000000',
            duration: 86399,
            start_date: '2022-03-03',
            expired_date: '2999-12-31',
            file: {
                file_hash: 'BDA91024-54D1-654E-F1CA-364D13A325BC-D0475D75',
                file_id: '1a868319b3886f4cf874393da793cc09',
                file_name: '00-00-00-00-00-00.jpg',
                file_size: '5427',
            },
            tag: {
                match_type: 'or',
                tag_names: [],
            },
        }],
};

const contentSchemaFormat = {
    content_id: '862B04BF-8DA4-41AA-8697-FA5ADF29742C',
    content_name: 'content 1',
    thumbnail_id: '00000000-0000-0000-0000-000000000000',
    is_streaming: false,
    duration: 86399,
    file: {
        file_hash: 'BDA91024-54D1-654E-F1CA-364D13A325BC-D0475D75',
        file_id: '1a868319b3886f4cf874393da793cc09',
        file_name: '00-00-00-00-00-00.jpg',
        file_size: '5427',
    },
};

const programSchemaFormat = {
    program_id: '',
    program_name: '',
    deploy_type: 'PROGRAM',
    resume: 0,
    program_type: 'GENERAL',
    version: '1',
    channels: [
        {
            channel_name: 'channel 1',
            channel_number: 1,
            frames: [
                {
                    frame_index: 0,
                    frame_name: 'frame 1',
                    frame_version: 1,
                    width: 100,
                    height: 100,
                    x: 0,
                    y: 0,
                    schedules: [],
                }],
        }],
};

const scheduleSchemaFormat = {
    start_date: '1969-01-01',
    start_time: '00:00:00',
    stop_date: '2999-12-31',
    duration: 86399,
    priority: '0',
    repeat: {
        type: 'daily',
    },
};

const createProgramSchema = (program) => {
    let programSchema = { ...programSchemaFormat };

    programSchema.program_id = program.programId;
    programSchema.program_name = program.programName;
    programSchema.deploy_type = program.deployType ? program.deployType.toUpperCase() : 'PROGRAM';
    programSchema.program_type = program.programType;
    programSchema.version = program.version;

    return programSchema;
};

const createScheduleSchema = (schedule) => {
    let scheduleSchema = { ...scheduleSchemaFormat };

    scheduleSchema.start_date = schedule.startDate;
    scheduleSchema.stop_date = schedule.stopDate;
    scheduleSchema.start_time = schedule.startTime;
    scheduleSchema.duration = schedule.duration;
    scheduleSchema.priority = schedule.priority;

    if (schedule.repeat == 'monthly') {
        scheduleSchema.repeat = {
            type: 'day_of_month',
            monthday: schedule.monthdays,
        };
    } else if (schedule.repeat == 'weekly') {
        scheduleSchema.repeat = {
            type: 'day_of_week',
            weekday: schedule.weekdays ? schedule.weekdays.toLowerCase() : '',
        };
    } else {
        scheduleSchema.repeat = {
            type: schedule.repeat || 'daily',
        };
    }

    logger.info(`[PublishingService][createScheduleSchema] playlistSchema: ${JSON.stringify(scheduleSchema)}`);
    return scheduleSchema;
};

const createPlaylistSchema = (playlist, syncGroups) => {
    const { playlistType, inEffect = 'none' } = playlist;
    let playlistSchema = { ...playlistSchemaFormat };
    playlistSchema.playlist_name = playlist.playlistName;
    playlistSchema.playlist_id = playlist.playlistId;
    if (playlistType === 'SYNCPLAY') {
        if (syncGroups && syncGroups.length > 0) {
            let sync = [];
            syncGroups.map((syncGroup) => {
                let data = {};
                data[`Group${syncGroup.syncId}`] = syncGroup.screenIds;
                sync.push(data);
            });
            playlistSchema.syncplay = sync;
        }
    }

    if (playlist.contents && playlist.contents.length) {
        let contents = [];

        for (const dbcontent of playlist.contents) {
            let content = {};
            content.content_id = dbcontent.contentId;
            content.content_name = dbcontent.contentName;
            content.thumbnail_id = dbcontent.thumbnailId;
            content.duration = dbcontent.contentDuration;
            content.start_date = dbcontent.startDate;
            content.expired_date = dbcontent.expiredDate;
            content.file = {
                file_hash: dbcontent.fileHash ? dbcontent.fileHash : dbcontent.mainFileId,
                file_id: dbcontent.mainFileId,
                file_size: dbcontent.totalSize,
                file_name: dbcontent.fileName,
                file_width: dbcontent.fileWidth,
                file_height: dbcontent.fileHeight,
                file_rotation: dbcontent.fileRotation,
                file_duration: dbcontent.fileDuration,
            };

            if (dbcontent.allowTags && dbcontent.allowTags.length && dbcontent.allowTagsCondition) {
                content.allow_tags = [...dbcontent.allowTags];
                content.allow_tags_condition = dbcontent.allowTagsCondition;
            }
            if (dbcontent.skipTags && dbcontent.skipTags.length && dbcontent.skipTagsCondition) {
                content.skip_tags = [...dbcontent.skipTags];
                content.skip_tags_condition = dbcontent.skipTagsCondition;
            }
            content.effects = [];

            if (inEffect && inEffect !== 'none') {
                content.effects = [{ type: 'IN', name: inEffect, duration: 5 }];
            }

            if (playlistType === 'SYNCPLAY') {
                content.sync = `Group${dbcontent.syncId}`;
            }

            contents.push(content);
        }
        playlistSchema.contents = contents;
    } else {
        playlistSchema.contents = [];
    }
    logger.info(`[PublishingService][createPlaylistSchema] playlistSchema: ${JSON.stringify(playlistSchema)}`);
    return playlistSchema;
};

const createContentSchema = (content) => {
    let contentSchema = { ...contentSchemaFormat };
    const { file } = content;
    const { fileWidth, fileHeight, fileDuration, fileRotation, fileHash } = file || {};

    contentSchema.content_id = content.contentId;
    contentSchema.content_name = content.contentName;
    contentSchema.thumbnail_id = content.thumbnailId;
    contentSchema.duration = content.duration || 86399;
    contentSchema.file = {
        file_hash: fileHash ? fileHash : content.mainFileId,
        file_id: content.mainFileId,
        file_size: content.totalSize,
        file_name: content.fileName,
        file_width: fileWidth,
        file_height: fileHeight,
        file_rotation: fileRotation,
        file_duration: fileDuration,
    };

    logger.info(`[PublishingService][createContentSchema] playlistSchema: ${JSON.stringify(contentSchema)}`);
    return contentSchema;
};

module.exports = {
    createProgramSchema,
    createScheduleSchema,
    createContentSchema,
    createPlaylistSchema,
};
