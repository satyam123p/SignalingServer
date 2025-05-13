{
  "function": "createPlaylistSchema",
  "data": {
    "playlistName": "My Playlist",
    "playlistId": "123e4567-e89b-12d3-a456-426614174000",
    "playlistType": "SYNCPLAY",
    "inEffect": "fade",
    "contents": [
      {
        "contentId": "862B04BF-8DA4-41AA-8697-FA5ADF29742C",
        "contentName": "Video 1",
        "thumbnailId": "00000000-0000-0000-0000-000000000000",
        "contentDuration": 3600,
        "startDate": "2023-01-01",
        "expiredDate": "2024-12-31",
        "mainFileId": "1a868319b3886f4cf874393da793cc09",
        "fileName": "video1.mp4",
        "totalSize": "10485760",
        "syncId": "1"
      }
    ]
  },
  "syncGroups": [
    {
      "syncId": "1",
      "screenIds": ["screen1", "screen2"]
    }
  ]
}





import json
import logging
from uuid import UUID
from typing import Dict, List, Any

# Configure logging for Lambda (logs to CloudWatch)
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Schema definitions
playlist_schema_format = {
    "playlist_name": "playlist 1",
    "playlist_id": "00000000-0000-0000-0000-000000000000",
    "shuffle": False,
    "contents": [
        {
            "content_id": "862B04BF-8DA4-41AA-8697-FA5ADF29742C",
            "content_name": "content 1",
            "thumbnail_id": "00000000-0000-0000-0000-000000000000",
            "duration": 86399,
            "start_date": "2022-03-03",
            "expired_date": "2999-12-31",
            "file": {
                "file_hash": "BDA91024-54D1-654E-F1CA-364D13A325BC-D0475D75",
                "file_id": "1a868319b3886f4cf874393da793cc09",
                "file_name": "00-00-00-00-00-00.jpg",
                "file_size": "5427",
            },
            "tag": {
                "match_type": "or",
                "tag_names": [],
            },
        }
    ],
}

content_schema_format = {
    "content_id": "862B04BF-8DA4-41AA-8697-FA5ADF29742C",
    "content_name": "content 1",
    "thumbnail_id": "00000000-0000-0000-0000-000000000000",
    "is_streaming": False,
    "duration": 86399,
    "file": {
        "file_hash": "BDA91024-54D1-654E-F1CA-364D13A325BC-D0475D75",
        "file_id": "1a868319b3886f4cf874393da793cc09",
        "file_name": "00-00-00-00-00-00.jpg",
        "file_size": "5427",
    },
}

program_schema_format = {
    "program_id": "",
    "program_name": "",
    "deploy_type": "PROGRAM",
    "resume": 0,
    "program_type": "GENERAL",
    "version": "1",
    "channels": [
        {
            "channel_name": "channel 1",
            "channel_number": 1,
            "frames": [
                {
                    "frame_index": 0,
                    "frame_name": "frame 1",
                    "frame_version": 1,
                    "width": 100,
                    "height": 100,
                    "x": 0,
                    "y": 0,
                    "schedules": [],
                }
            ],
        }
    ],
}

schedule_schema_format = {
    "start_date": "1969-01-01",
    "start_time": "00:00:00",
    "stop_date": "2999-12-31",
    "duration": 86399,
    "priority": "0",
    "repeat": {
        "type": "daily",
    },
}

def create_program_schema(program: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a program schema from the provided program data.
    """
    program_schema = program_schema_format.copy()
    
    program_schema["program_id"] = program.get("programId", "")
    program_schema["program_name"] = program.get("programName", "")
    program_schema["deploy_type"] = program.get("deployType", "PROGRAM").upper()
    program_schema["program_type"] = program.get("programType", "GENERAL")
    program_schema["version"] = program.get("version", "1")
    
    return program_schema

def create_schedule_schema(schedule: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a schedule schema from the provided schedule data.
    """
    schedule_schema = schedule_schema_format.copy()
    
    schedule_schema["start_date"] = schedule.get("startDate", "1969-01-01")
    schedule_schema["stop_date"] = schedule.get("stopDate", "2999-12-31")
    schedule_schema["start_time"] = schedule.get("startTime", "00:00:00")
    schedule_schema["duration"] = schedule.get("duration", 86399)
    schedule_schema["priority"] = schedule.get("priority", "0")
    
    repeat_type = schedule.get("repeat", "daily")
    if repeat_type == "monthly":
        schedule_schema["repeat"] = {
            "type": "day_of_month",
            "monthday": schedule.get("monthdays", []),
        }
    elif repeat_type == "weekly":
        schedule_schema["repeat"] = {
            "type": "day_of_week",
            "weekday": schedule.get("weekdays", "").lower(),
        }
    else:
        schedule_schema["repeat"] = {"type": repeat_type}
    
    logger.info(f"[PublishingService][create_schedule_schema] scheduleSchema: {json.dumps(schedule_schema)}")
    return schedule_schema

def create_playlist_schema(playlist: Dict[str, Any], sync_groups: List[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Create a playlist schema from the provided playlist data and optional sync groups.
    """
    playlist_type = playlist.get("playlistType", "")
    in_effect = playlist.get("inEffect", "none")
    playlist_schema = playlist_schema_format.copy()
    
    playlist_schema["playlist_name"] = playlist.get("playlistName", "playlist 1")
    playlist_schema["playlist_id"] = playlist.get("playlistId", "00000000-0000-0000-0000-000000000000")
    
    if playlist_type == "SYNCPLAY" and sync_groups:
        sync = [{"Group" + str(sync_group.get("syncId", "")): sync_group.get("screenIds", [])} for sync_group in sync_groups]
        playlist_schema["syncplay"] = sync
    
    contents = []
    for dbcontent in playlist.get("contents", []):
        content = {
            "content_id": dbcontent.get("contentId"),
            "content_name": dbcontent.get("contentName"),
            "thumbnail_id": dbcontent.get("thumbnailId"),
            "duration": dbcontent.get("contentDuration", 86399),
            "start_date": dbcontent.get("startDate"),
            "expired_date": dbcontent.get("expiredDate"),
            "file": {
                "file_hash": dbcontent.get("fileHash", dbcontent.get("mainFileId")),
                "file_id": dbcontent.get("mainFileId"),
                "file_size": dbcontent.get("totalSize"),
                "file_name": dbcontent.get("fileName"),
                "file_width": dbcontent.get("fileWidth"),
                "file_height": dbcontent.get("fileHeight"),
                "file_rotation": dbcontent.get("fileRotation"),
                "file_duration": dbcontent.get("fileDuration"),
            },
            "effects": [] if in_effect == "none" else [{"type": "IN", "name": in_effect, "duration": 5}],
        }
        
        if playlist_type == "SYNCPLAY":
            content["sync"] = f"Group{dbcontent.get('syncId', '')}"
        
        if dbcontent.get("allowTags") and dbcontent.get("allowTagsCondition"):
            content["allow_tags"] = dbcontent.get("allowTags", [])
            content["allow_tags_condition"] = dbcontent.get("allowTagsCondition")
        
        if dbcontent.get("skipTags") and dbcontent.get("skipTagsCondition"):
            content["skip_tags"] = dbcontent.get("skipTags", [])
            content["skip_tags_condition"] = dbcontent.get("skipTagsCondition")
        
        contents.append(content)
    
    playlist_schema["contents"] = contents
    logger.info(f"[PublishingService][create_playlist_schema] playlistSchema: {json.dumps(playlist_schema)}")
    return playlist_schema

def create_content_schema(content: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a content schema from the provided content data.
    """
    content_schema = content_schema_format.copy()
    file = content.get("file", {})
    
    content_schema["content_id"] = content.get("contentId")
    content_schema["content_name"] = content.get("contentName")
    content_schema["thumbnail_id"] = content.get("thumbnailId")
    content_schema["duration"] = content.get("duration", 86399)
    content_schema["file"] = {
        "file_hash": file.get("fileHash", content.get("mainFileId")),
        "file_id": content.get("mainFileId"),
        "file_size": content.get("totalSize"),
        "file_name": content.get("fileName"),
        "file_width": file.get("fileWidth"),
        "file_height": file.get("fileHeight"),
        "file_rotation": file.get("fileRotation"),
        "file_duration": file.get("fileDuration"),
    }
    
    logger.info(f"[PublishingService][create_content_schema] contentSchema: {json.dumps(content_schema)}")
    return content_schema

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler to process schema creation requests.
    Expected event format:
    {
        "function": "createProgramSchema|createScheduleSchema|createPlaylistSchema|createContentSchema",
        "data": {...schema-specific data...},
        "syncGroups": [...] (optional, for createPlaylistSchema)
    }
    """
    try:
        function_name = event.get("function")
        data = event.get("data", {})
        sync_groups = event.get("syncGroups", [])
        
        logger.info(f"Received event: function={function_name}, data={json.dumps(data)}")
        
        if function_name == "createProgramSchema":
            result = create_program_schema(data)
        elif function_name == "createScheduleSchema":
            result = create_schedule_schema(data)
        elif function_name == "createPlaylistSchema":
            result = create_playlist_schema(data, sync_groups)
        elif function_name == "createContentSchema":
            result = create_content_schema(data)
        else:
            logger.error(f"Invalid function name: {function_name}")
            return {
                "statusCode": 400,
                "body": json.dumps({"error": f"Invalid function name: {function_name}"}),
            }
        
        return {
            "statusCode": 200,
            "body": json.dumps(result),
        }
    
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)}),
        }









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
